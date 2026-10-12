import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";
import { accountSchema } from "../auth/account.validation.js";

const router = Router();
const roles = z.enum(["OWNER", "MANAGER", "AGRONOMIST", "WORKER"]);
const memberSchema = accountSchema.extend({ role: roles });
const publicUser = { id: true, name: true, email: true, username: true };

async function assertManager(tx, auth, target, newRole) {
  const actor = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: auth.organizationId, userId: auth.userId } } });
  if (!actor || !["OWNER", "MANAGER"].includes(actor.role)) throw new AppError(403, "Workspace management access is required");
  if (actor.role === "MANAGER" && (target?.role === "OWNER" || newRole === "OWNER")) throw new AppError(403, "Only owners can manage owner accounts");
  if (target?.role === "OWNER" && newRole !== "OWNER") {
    const count = await tx.membership.count({ where: { organizationId: auth.organizationId, role: "OWNER", user: { deletedAt: null } } });
    if (count <= 1) throw new AppError(409, "The workspace must retain at least one owner");
  }
}

router.get("/", async (req, res, next) => {
  try {
    const members = await prisma.membership.findMany({
      where: { organizationId: req.auth.organizationId, user: { deletedAt: null } },
      include: { user: { select: publicUser } }, orderBy: { createdAt: "asc" }
    });
    res.json({ success: true, data: members.map(({ id, role, createdAt, user }) => ({ id, role, createdAt, user })) });
  } catch (error) { next(error); }
});

router.post("/", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const payload = memberSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(payload.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      await assertManager(tx, req.auth, null, payload.role);
      const { role, password, ...profile } = payload;
      const record = await tx.user.create({ data: { ...profile, passwordHash, memberships: { create: { organizationId: req.auth.organizationId, role } } }, select: publicUser });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "Membership", entityId: record.id }, tx);
      return record;
    });
    res.status(201).json({ success: true, message: "Team member added", data: user });
  } catch (error) { next(error); }
});

router.patch("/:id", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    const payload = memberSchema.omit({ password: true }).partial().strict().parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide fields to update");
    const member = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const target = await tx.membership.findFirst({ where: { id, organizationId: req.auth.organizationId, user: { deletedAt: null, isPlatformAdmin: false } }, include: { user: { include: { _count: { select: { memberships: true } } } } } });
      if (!target) throw new AppError(404, "Workspace member not found");
      await assertManager(tx, req.auth, target, payload.role ?? target.role);
      const { role, ...profile } = payload;
      if (Object.keys(profile).length && target.user._count.memberships > 1) throw new AppError(409, "A shared account's profile must be managed by the FOMS administrator");
      await tx.user.update({ where: { id: target.userId }, data: { ...profile, sessionVersion: { increment: 1 } } });
      await tx.refreshToken.deleteMany({ where: { userId: target.userId } });
      const record = await tx.membership.update({ where: { id }, data: role ? { role } : {}, include: { user: { select: publicUser } } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "UPDATE", entity: "Membership", entityId: id }, tx);
      return record;
    });
    res.json({ success: true, message: "Team member updated. Their existing sessions have been revoked.", data: member });
  } catch (error) { next(error); }
});

router.delete("/:id", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const target = await tx.membership.findFirst({ where: { id, organizationId: req.auth.organizationId, user: { isPlatformAdmin: false } } });
      if (!target) throw new AppError(404, "Workspace member not found");
      if (target.userId === req.auth.userId) throw new AppError(409, "You cannot remove your own access");
      await assertManager(tx, req.auth, target, null);
      await tx.membership.delete({ where: { id } });
      await tx.refreshToken.deleteMany({ where: { userId: target.userId, organizationId: req.auth.organizationId } });
      await tx.user.update({ where: { id: target.userId }, data: { sessionVersion: { increment: 1 } } });
      await tx.task.updateMany({ where: { organizationId: req.auth.organizationId, assignedTo: target.userId }, data: { assignedTo: null } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "REMOVE", entity: "Membership", entityId: id }, tx);
    });
    res.json({ success: true, message: "User removed from this workspace. Historical records are preserved." });
  } catch (error) { next(error); }
});

export default router;
