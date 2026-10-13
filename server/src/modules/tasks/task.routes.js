import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";
import { storeUpload, readUpload, removeUpload } from "../../shared/uploads.js";
import { taskInputSchema, taskStatusSchema, taskQuerySchema } from "./task.validation.js";
import { managers, taskScope, findTask, notifyTask, notifyManagers } from "./task.shared.js";

const router = Router();
router.use(authorize("OWNER", "MANAGER", "AGRONOMIST", "WORKER"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 } });
const include = { farm: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } } };
const editable = (task) => {
  if (task.status === "VOID") throw new AppError(409, "Voided tasks cannot be changed");
  if (["COMPLETED", "APPROVED"].includes(task.status)) throw new AppError(409, "Submitted or approved tasks are locked. Request rework before making changes.");
};
async function related(tx, req, payload) {
  if (payload.farmId && !await tx.farm.findFirst({ where: { id: payload.farmId, organizationId: req.auth.organizationId, deletedAt: null } })) throw new AppError(400, "Farm is not available in this workspace");
  if (payload.assignedTo && !await tx.membership.findFirst({ where: { organizationId: req.auth.organizationId, userId: payload.assignedTo, user: { deletedAt: null, isPlatformAdmin: false } } })) throw new AppError(400, "Assignee is not an active workspace user");
}
async function recordEvent(tx, req, task, action, fromStatus, notes) {
  await tx.taskEvent.create({ data: { taskId: task.id, action, fromStatus, toStatus: task.status, notes, recordedBy: req.auth.userId } });
  await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action, entity: "Task", entityId: task.id }, tx);
}
const evidenceView = ({ storageName, mimeType, ...record }) => ({
  ...record, mimeType, downloadPath: `/api/v1/tasks/${record.taskId}/evidence/${record.id}/download`
});

router.get("/", async (req, res, next) => {
  try {
    const query = taskQuerySchema.parse(req.query);
    const where = { ...taskScope(req), ...(query.status ? { status: query.status } : {}), ...(query.farmId ? { farmId: query.farmId } : {}), ...(query.assignedTo && req.auth.role !== "WORKER" ? { assignedTo: query.assignedTo } : {}) };
    const [data, total] = await prisma.$transaction([
      prisma.task.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.task.count({ where })
    ]);
    res.json({ success: true, data, meta: { ...query, total } });
  } catch (error) { next(error); }
});
router.post("/", authorize(...managers), async (req, res, next) => {
  try {
    const payload = taskInputSchema.parse(req.body);
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      await related(tx, req, payload);
      const task = await tx.task.create({ data: { ...payload, organizationId: req.auth.organizationId, createdBy: req.auth.userId }, include });
      await recordEvent(tx, req, task, "CREATE", null);
      if (task.assignedTo) await notifyTask(tx, req, task, "TASK_ASSIGNED", `Assigned: ${task.title}`, [task.assignedTo]);
      return task;
    });
    res.status(201).json({ success: true, message: "Task created", data });
  } catch (error) { next(error); }
});
router.get("/:id", async (req, res, next) => {
  try {
    const data = await prisma.task.findFirst({ where: { ...taskScope(req), id: z.uuid().parse(req.params.id) }, include });
    if (!data) throw new AppError(404, "Task was not found");
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

async function changeStatus(req, res, next) {
  try {
    if (req.auth.role === "AGRONOMIST") throw new AppError(403, "Only owners, managers and assigned workers can change task status");
    const payload = taskStatusSchema.parse(req.body);
    if (payload.status === "APPROVED" && !managers.includes(req.auth.role)) throw new AppError(403, "Only owners and managers approve tasks");
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const task = await findTask(tx, req);
      if (task.status === payload.status) return tx.task.findUnique({ where: { id: task.id }, include });
      const rework = task.status === "COMPLETED" && payload.status === "IN_PROGRESS";
      const permitted = (task.status === "PENDING" && payload.status === "IN_PROGRESS") ||
        (task.status === "IN_PROGRESS" && payload.status === "COMPLETED") ||
        (task.status === "COMPLETED" && payload.status === "APPROVED") ||
        (rework && managers.includes(req.auth.role));
      if (!permitted) throw new AppError(409, "Use the task workflow: pending, in progress, completed, then approved");
      if (rework && !payload.notes?.trim()) throw new AppError(400, "Explain what needs rework");
      if (payload.status === "COMPLETED") {
        if (!task.assignedTo) throw new AppError(409, "Assign this task before submitting it");
        await related(tx, req, task);
        if (task.evidenceRequired && !await tx.taskEvidence.count({ where: { taskId: task.id, deletedAt: null } })) throw new AppError(409, "Attach at least one evidence photo or PDF before submitting");
      }
      const update = {
        status: payload.status,
        ...(payload.status === "COMPLETED" ? { completedAt: new Date(), submissionNotes: payload.notes || null, ...(payload.evidenceUrl ? { evidenceUrl: payload.evidenceUrl } : {}) } : {}),
        ...(payload.status === "APPROVED" ? { approvedAt: new Date(), approvedBy: req.auth.userId } : {}),
        ...(rework ? { completedAt: null, approvedAt: null, approvedBy: null, submissionNotes: null } : {})
      };
      const record = await tx.task.update({ where: { id: task.id }, data: update, include });
      const action = rework ? "REQUEST_REWORK" : payload.status === "APPROVED" ? "APPROVE" : payload.status === "COMPLETED" ? "SUBMIT" : "START";
      await recordEvent(tx, req, record, action, task.status, payload.notes);
      if (payload.status === "COMPLETED") await notifyManagers(tx, req, task, "TASK_SUBMITTED", `Ready for approval: ${task.title}`);
      if (payload.status === "APPROVED" || rework) await notifyTask(tx, req, task, rework ? "TASK_REWORK" : "TASK_APPROVED", `${rework ? "Rework requested" : "Approved"}: ${task.title}${rework ? ` - ${payload.notes}` : ""}`, [task.assignedTo]);
      return record;
    });
    res.json({ success: true, message: "Task workflow updated", data });
  } catch (error) { next(error); }
}
router.post("/:id/status", changeStatus);
router.patch("/:id", async (req, res, next) => {
  if (req.body && Object.hasOwn(req.body, "status")) {
    if (Object.keys(req.body).some((key) => !["status", "notes", "evidenceUrl"].includes(key))) return next(new AppError(403, "Change task status separately from its profile"));
    return changeStatus(req, res, next);
  }
  try {
    if (!managers.includes(req.auth.role)) throw new AppError(403, "Only owners and managers can edit task profiles");
    const payload = taskInputSchema.partial().parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide at least one field to update");
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const task = await findTask(tx, req);
      editable(task);
      await related(tx, req, { ...task, ...payload });
      const reassigned = payload.assignedTo !== undefined && payload.assignedTo !== task.assignedTo;
      const record = await tx.task.update({ where: { id: task.id }, data: { ...payload, ...(reassigned ? { status: "PENDING", completedAt: null, submissionNotes: null } : {}) }, include });
      await recordEvent(tx, req, record, reassigned ? "REASSIGN" : "UPDATE", task.status);
      if (reassigned && record.assignedTo) await notifyTask(tx, req, record, "TASK_ASSIGNED", `Assigned: ${record.title}`, [record.assignedTo]);
      return record;
    });
    res.json({ success: true, message: "Task updated", data });
  } catch (error) { next(error); }
});
router.get("/:id/events", async (req, res, next) => {
  try {
    const task = await findTask(prisma, req);
    const query = taskQuerySchema.parse(req.query);
    const where = { taskId: task.id, task: taskScope(req) };
    const [data, total] = await prisma.$transaction([
      prisma.taskEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.taskEvent.count({ where })
    ]);
    res.json({ success: true, data, meta: { page: query.page, limit: query.limit, total } });
  } catch (error) { next(error); }
});
router.get("/:id/evidence", async (req, res, next) => {
  try {
    const task = await findTask(prisma, req);
    const data = await prisma.taskEvidence.findMany({ where: { taskId: task.id, task: taskScope(req), deletedAt: null }, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data: data.map(evidenceView) });
  } catch (error) { next(error); }
});
router.post("/:id/evidence", authorize("OWNER", "MANAGER", "WORKER"), upload.single("file"), async (req, res, next) => {
  let stored;
  try {
    if (!req.file) throw new AppError(400, "Select an evidence photo or PDF");
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const task = await findTask(tx, req);
      editable(task);
      if (await tx.taskEvidence.count({ where: { taskId: task.id, deletedAt: null } }) >= 10) throw new AppError(409, "A task can have up to 10 active evidence files");
      stored = await storeUpload(req.auth.organizationId, req.file);
      const evidence = await tx.taskEvidence.create({ data: { taskId: task.id, storageName: stored.storageName, mimeType: stored.mimeType, originalName: stored.originalName, uploadedBy: req.auth.userId } });
      await recordEvent(tx, req, task, "ADD_EVIDENCE", task.status, stored.originalName);
      return evidenceView(evidence);
    });
    stored = null;
    res.status(201).json({ success: true, message: "Evidence uploaded", data });
  } catch (error) {
    if (stored) await removeUpload(stored.savedPath);
    next(error);
  }
});
router.get("/:id/evidence/:evidenceId/download", async (req, res, next) => {
  try {
    const task = await findTask(prisma, req);
    const evidence = await prisma.taskEvidence.findFirst({ where: { id: z.uuid().parse(req.params.evidenceId), taskId: task.id, task: taskScope(req), deletedAt: null } });
    if (!evidence) throw new AppError(404, "Evidence was not found");
    const data = await readUpload(evidence.storageName, req.auth.organizationId);
    res.setHeader("Content-Type", evidence.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(evidence.originalName)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(data);
  } catch (error) { next(error); }
});
router.delete("/:id/evidence/:evidenceId", authorize("OWNER", "MANAGER", "WORKER"), async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const task = await findTask(tx, req);
      editable(task);
      const evidence = await tx.taskEvidence.findFirst({ where: { id: z.uuid().parse(req.params.evidenceId), taskId: task.id, deletedAt: null, ...(req.auth.role === "WORKER" ? { uploadedBy: req.auth.userId } : {}) } });
      if (!evidence) throw new AppError(404, "Evidence was not found");
      await tx.taskEvidence.update({ where: { id: evidence.id }, data: { deletedAt: new Date() } });
      await recordEvent(tx, req, task, "REMOVE_EVIDENCE", task.status, evidence.originalName);
    });
    res.json({ success: true, message: "Evidence removed from active submission; history retained" });
  } catch (error) { next(error); }
});
router.post("/:id/void", authorize(...managers), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const task = await findTask(tx, req);
      if (task.status === "VOID") throw new AppError(409, "Task is already void");
      if (task.status === "APPROVED") throw new AppError(409, "Approved tasks are final and cannot be voided");
      const record = await tx.task.update({ where: { id: task.id }, data: { status: "VOID" }, include });
      await recordEvent(tx, req, record, "VOID", task.status, reason);
      if (task.assignedTo) await notifyTask(tx, req, task, "TASK_VOID", `Task cancelled: ${task.title} - ${reason}`, [task.assignedTo]);
      return record;
    });
    res.json({ success: true, message: "Task voided", data });
  } catch (error) { next(error); }
});
router.delete("/:id", authorize(...managers), async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const task = await findTask(tx, req);
      await tx.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
      await recordEvent(tx, req, task, "ARCHIVE", task.status);
    });
    res.json({ success: true, message: "Task archived; evidence and history retained" });
  } catch (error) { next(error); }
});
export default router;
