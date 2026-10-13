import { Router } from "express";
import { z } from "zod";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";

const router = Router();
const managers = ["OWNER", "MANAGER"];
const openStatuses = ["SCHEDULED", "REQUESTED"];
const DAY = 24 * 60 * 60 * 1000;
router.use(authorize("OWNER", "MANAGER", "AGRONOMIST"));

const text = z.string().trim().max(2000).nullish().transform((value) => value || null);
const createSchema = z.object({
  scheduledFor: z.coerce.date(), farmId: z.uuid().nullish(), purpose: text, agronomistId: z.uuid().nullish()
}).strict();
const updateSchema = z.object({ scheduledFor: z.coerce.date().optional(), farmId: z.uuid().nullish(), purpose: text.optional() }).strict();
const completeSchema = z.object({
  findings: z.string().trim().min(3).max(5000), nextVisitDate: z.coerce.date(), nextFarmId: z.uuid().nullish(), nextPurpose: text
}).strict();
const cancelSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

const include = { farm: { select: { id: true, name: true } }, agronomist: { select: { id: true, name: true } } };
const when = (value) => new Date(value).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const place = (visit) => visit.farm?.name ? ` to ${visit.farm.name}` : "";

async function notify(tx, organizationId, visitId, type, message, userIds, exceptUserId) {
  const unique = [...new Set(userIds.filter((id) => id && id !== exceptUserId))];
  if (!unique.length) return;
  const members = await tx.membership.findMany({ where: { organizationId, userId: { in: unique }, user: { deletedAt: null } }, select: { userId: true } });
  if (members.length) await tx.notification.createMany({ data: members.map(({ userId }) => ({ organizationId, userId, visitId, type, message })) });
}
async function managerIds(tx, organizationId) {
  return (await tx.membership.findMany({ where: { organizationId, role: { in: managers }, user: { deletedAt: null } }, select: { userId: true } })).map((member) => member.userId);
}
async function checkFarm(tx, organizationId, farmId) {
  if (farmId && !await tx.farm.findFirst({ where: { id: farmId, organizationId, deletedAt: null } })) throw new AppError(400, "Selected farm is unavailable");
}
async function findVisit(tx, req) {
  const visit = await tx.farmVisit.findFirst({
    where: { id: z.uuid().parse(req.params.id), organizationId: req.auth.organizationId, ...(req.auth.role === "AGRONOMIST" ? { agronomistId: req.auth.userId } : {}) },
    include
  });
  if (!visit) throw new AppError(404, "Visit was not found");
  return visit;
}
function assertDateWindow(date, label = "Visit date") {
  if (date.getTime() < Date.now() - DAY) throw new AppError(400, `${label} cannot be in the past`);
  if (date.getTime() > Date.now() + 180 * DAY) throw new AppError(400, `${label} must be within the next 6 months`);
}
const audit = (tx, req, action, id) => writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action, entity: "FarmVisit", entityId: id }, tx);

// Idempotent: each visit gets at most one reminder and one overdue alert per scheduled date.
export async function runVisitReminders(organizationId) {
  const now = new Date();
  const scope = { status: { in: openStatuses }, ...(organizationId ? { organizationId } : {}) };
  const due = await prisma.farmVisit.findMany({ where: { ...scope, reminderSentAt: null, scheduledFor: { lte: new Date(now.getTime() + DAY), gte: new Date(now.getTime() - DAY) } }, include, take: 500 });
  for (const visit of due) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.farmVisit.updateMany({ where: { id: visit.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (!claimed.count) return;
      await notify(tx, visit.organizationId, visit.id, "VISIT_REMINDER", `Reminder: farm visit${place(visit)} is due ${when(visit.scheduledFor)}.`, [visit.agronomistId]);
    });
  }
  const overdue = await prisma.farmVisit.findMany({ where: { ...scope, overdueSentAt: null, scheduledFor: { lt: new Date(now.getTime() - DAY) } }, include, take: 500 });
  for (const visit of overdue) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.farmVisit.updateMany({ where: { id: visit.id, overdueSentAt: null }, data: { overdueSentAt: now } });
      if (!claimed.count) return;
      const message = `Overdue: ${visit.agronomist.name}'s farm visit${place(visit)} planned for ${when(visit.scheduledFor)} has not been completed.`;
      await notify(tx, visit.organizationId, visit.id, "VISIT_OVERDUE", message, [visit.agronomistId, ...await managerIds(tx, visit.organizationId)]);
    });
  }
}

router.get("/agronomists", async (req, res, next) => {
  try {
    const members = await prisma.membership.findMany({
      where: { organizationId: req.auth.organizationId, role: "AGRONOMIST", user: { deletedAt: null } },
      select: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" }
    });
    res.json({ success: true, data: members.map((member) => member.user) });
  } catch (error) { next(error); }
});
router.get("/", async (req, res, next) => {
  try {
    await runVisitReminders(req.auth.organizationId);
    const query = z.object({
      status: z.enum(["OPEN", "CLOSED", "COMPLETED", "CANCELLED", "ALL"]).default("ALL"),
      limit: z.coerce.number().int().min(1).max(100).default(50), page: z.coerce.number().int().positive().default(1)
    }).parse(req.query);
    const scope = { organizationId: req.auth.organizationId, ...(req.auth.role === "AGRONOMIST" ? { agronomistId: req.auth.userId } : {}) };
    const where = { ...scope, ...(query.status === "OPEN" ? { status: { in: openStatuses } } : query.status === "CLOSED" ? { status: { in: ["COMPLETED", "CANCELLED"] } } : query.status === "ALL" ? {} : { status: query.status }) };
    const [data, total, upcoming] = await prisma.$transaction([
      prisma.farmVisit.findMany({ where, include, orderBy: [{ scheduledFor: query.status === "OPEN" ? "asc" : "desc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.farmVisit.count({ where }),
      prisma.farmVisit.findFirst({ where: { ...scope, status: { in: openStatuses } }, include, orderBy: { scheduledFor: "asc" } })
    ]);
    res.json({ success: true, data, meta: { ...query, total, next: upcoming } });
  } catch (error) { next(error); }
});
router.post("/", async (req, res, next) => {
  try {
    const payload = createSchema.parse(req.body);
    assertDateWindow(payload.scheduledFor);
    const isAgronomist = req.auth.role === "AGRONOMIST";
    if (isAgronomist && payload.agronomistId && payload.agronomistId !== req.auth.userId) throw new AppError(403, "Agronomists can only schedule their own visits");
    if (!isAgronomist && !payload.agronomistId) throw new AppError(400, "Choose the agronomist to request");
    const agronomistId = isAgronomist ? req.auth.userId : payload.agronomistId;
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      if (!await tx.membership.findFirst({ where: { organizationId: req.auth.organizationId, userId: agronomistId, role: "AGRONOMIST", user: { deletedAt: null } } })) throw new AppError(400, "Selected agronomist is not part of this workspace");
      await checkFarm(tx, req.auth.organizationId, payload.farmId);
      const visit = await tx.farmVisit.create({
        data: {
          organizationId: req.auth.organizationId, agronomistId, farmId: payload.farmId || null, purpose: payload.purpose,
          scheduledFor: payload.scheduledFor, status: isAgronomist ? "SCHEDULED" : "REQUESTED", source: isAgronomist ? "AGRONOMIST" : "MANAGER", requestedBy: req.auth.userId
        }, include
      });
      if (isAgronomist) await notify(tx, req.auth.organizationId, visit.id, "VISIT_SCHEDULED", `${visit.agronomist.name} scheduled a farm visit${place(visit)} for ${when(visit.scheduledFor)}.`, await managerIds(tx, req.auth.organizationId), req.auth.userId);
      else await notify(tx, req.auth.organizationId, visit.id, "VISIT_REQUESTED", `Farm visit${place(visit)} requested for ${when(visit.scheduledFor)}${visit.purpose ? `: ${visit.purpose}` : "."}`, [agronomistId], req.auth.userId);
      await audit(tx, req, isAgronomist ? "SCHEDULE_VISIT" : "REQUEST_VISIT", visit.id);
      return visit;
    });
    res.status(201).json({ success: true, message: isAgronomist ? "Visit scheduled" : "Visit requested; the agronomist has been notified", data });
  } catch (error) { next(error); }
});
router.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateSchema.parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide fields to update");
    if (payload.scheduledFor) assertDateWindow(payload.scheduledFor);
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const visit = await findVisit(tx, req);
      if (!openStatuses.includes(visit.status)) throw new AppError(409, "Only upcoming visits can be changed");
      await checkFarm(tx, req.auth.organizationId, payload.farmId);
      const rescheduled = payload.scheduledFor && payload.scheduledFor.getTime() !== visit.scheduledFor.getTime();
      const updated = await tx.farmVisit.update({ where: { id: visit.id }, data: { ...payload, ...(rescheduled ? { reminderSentAt: null, overdueSentAt: null } : {}) }, include });
      if (rescheduled) {
        const recipients = req.auth.role === "AGRONOMIST" ? await managerIds(tx, req.auth.organizationId) : [visit.agronomistId];
        await notify(tx, req.auth.organizationId, visit.id, "VISIT_RESCHEDULED", `Farm visit${place(updated)} moved to ${when(updated.scheduledFor)}.`, recipients, req.auth.userId);
      }
      await audit(tx, req, "UPDATE_VISIT", visit.id);
      return updated;
    });
    res.json({ success: true, message: "Visit updated", data });
  } catch (error) { next(error); }
});
router.post("/:id/complete", authorize("AGRONOMIST"), async (req, res, next) => {
  try {
    const payload = completeSchema.parse(req.body);
    assertDateWindow(payload.nextVisitDate, "Next visit date");
    if (payload.nextVisitDate.getTime() <= Date.now()) throw new AppError(400, "Next visit date must be in the future");
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const visit = await findVisit(tx, req);
      if (!openStatuses.includes(visit.status)) throw new AppError(409, "This visit is already closed");
      const nextFarmId = payload.nextFarmId === undefined ? visit.farmId : payload.nextFarmId;
      await checkFarm(tx, req.auth.organizationId, nextFarmId);
      const completed = await tx.farmVisit.update({ where: { id: visit.id }, data: { status: "COMPLETED", findings: payload.findings, completedAt: new Date(), completedBy: req.auth.userId }, include });
      const following = await tx.farmVisit.create({
        data: { organizationId: req.auth.organizationId, agronomistId: req.auth.userId, farmId: nextFarmId || null, purpose: payload.nextPurpose, scheduledFor: payload.nextVisitDate, status: "SCHEDULED", source: "AGRONOMIST", requestedBy: req.auth.userId },
        include
      });
      await notify(tx, req.auth.organizationId, visit.id, "VISIT_COMPLETED", `${completed.agronomist.name} completed the farm visit${place(completed)}. Next visit: ${when(following.scheduledFor)}.\nFindings: ${payload.findings.slice(0, 300)}`, await managerIds(tx, req.auth.organizationId), req.auth.userId);
      await audit(tx, req, "COMPLETE_VISIT", visit.id);
      return { completed, next: following };
    });
    res.json({ success: true, message: `Visit completed. Next visit set for ${when(data.next.scheduledFor)}.`, data });
  } catch (error) { next(error); }
});
router.post("/:id/cancel", async (req, res, next) => {
  try {
    const payload = cancelSchema.parse(req.body);
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const visit = await findVisit(tx, req);
      if (!openStatuses.includes(visit.status)) throw new AppError(409, "This visit is already closed");
      const updated = await tx.farmVisit.update({ where: { id: visit.id }, data: { status: "CANCELLED", cancelReason: payload.reason }, include });
      const recipients = req.auth.role === "AGRONOMIST" ? await managerIds(tx, req.auth.organizationId) : [visit.agronomistId];
      await notify(tx, req.auth.organizationId, visit.id, "VISIT_CANCELLED", `Farm visit${place(visit)} on ${when(visit.scheduledFor)} was cancelled: ${payload.reason}`, recipients, req.auth.userId);
      await audit(tx, req, "CANCEL_VISIT", visit.id);
      return updated;
    });
    res.json({ success: true, message: "Visit cancelled", data });
  } catch (error) { next(error); }
});

export function startVisitReminderJob() {
  const run = () => runVisitReminders().catch((error) => console.error("Visit reminder job failed:", error.message));
  setTimeout(run, 30_000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}
export default router;
