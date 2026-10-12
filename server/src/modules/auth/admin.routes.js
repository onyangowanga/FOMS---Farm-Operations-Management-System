import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { accountSchema } from "./account.validation.js";
import { writeAudit } from "../../shared/audit.js";
import { AppError } from "../../shared/errors.js";

const router = Router();
router.use(authorize("FOMS_ADMIN"));
router.get("/clients", async (_req, res, next) => {
  try {
    const clients = await prisma.organization.findMany({
      where: { deletedAt: null }, orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true, _count: { select: { farms: { where: { deletedAt: null } }, memberships: true } },
        memberships: { where: { role: "OWNER" }, select: { user: { select: { id: true, name: true, username: true, email: true } } } } }
    });
    res.json({ success: true, data: clients });
  } catch (error) { next(error); }
});
router.post("/clients", async (req, res, next) => {
  try {
    const payload = accountSchema.extend({ organizationName: z.string().trim().min(2).max(120) }).strict().parse(req.body);
    const passwordHash = await bcrypt.hash(payload.password, 12);
    const client = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: payload.organizationName, slug: `client-${crypto.randomUUID()}` } });
      const user = await tx.user.create({
        data: { name: payload.name, username: payload.username, email: payload.email, passwordHash, memberships: { create: { role: "OWNER", organizationId: organization.id } } },
        select: { id: true, name: true, username: true, email: true }
      });
      router.patch("/clients/:id", async (req, res, next) => {
        try {
          const id = z.uuid().parse(req.params.id);
          const payload = accountSchema.omit({ password: true }).extend({
            organizationName: z.string().trim().min(2).max(120),
            ownerId: z.uuid()
          }).strict().parse(req.body);
          await prisma.$transaction(async (tx) => {
            await lockOrganization(tx, id);
            const client = await tx.organization.findFirst({ where: { id, deletedAt: null } });
            const owner = await tx.membership.findFirst({ where: { organizationId: id, userId: payload.ownerId, role: "OWNER", user: { deletedAt: null, isPlatformAdmin: false } } });
            if (!client || !owner) throw new AppError(404, "Client or owner account was not found");
            await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${payload.ownerId}::uuid FOR UPDATE`;
            await tx.organization.update({ where: { id }, data: { name: payload.organizationName } });
            await tx.user.update({ where: { id: payload.ownerId }, data: { name: payload.name, username: payload.username, email: payload.email, sessionVersion: { increment: 1 } } });
            await tx.refreshToken.deleteMany({ where: { userId: payload.ownerId } });
            await writeAudit({ organizationId: id, userId: req.auth.userId, action: "EDIT_CLIENT", entity: "User", entityId: payload.ownerId }, tx);
          });
          res.json({ success: true, message: "Client and owner profile updated. The owner must sign in again." });
        } catch (error) { next(error); }
      });
      router.post("/clients/:id/owners/:userId/reset-password", async (req, res, next) => {
        try {
          const id = z.uuid().parse(req.params.id);
          const userId = z.uuid().parse(req.params.userId);
          const temporaryPassword = `F1!${crypto.randomBytes(18).toString("base64url")}`;
          const temporaryPasswordHash = await bcrypt.hash(temporaryPassword, 12);
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await prisma.$transaction(async (tx) => {
            await lockOrganization(tx, id);
            const owner = await tx.membership.findFirst({ where: { organizationId: id, userId, role: "OWNER", organization: { deletedAt: null }, user: { deletedAt: null, isPlatformAdmin: false } } });
            if (!owner) throw new AppError(404, "Client owner account was not found");
            await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
            await tx.user.update({ where: { id: userId }, data: { temporaryPasswordHash, temporaryPasswordExpiresAt: expiresAt, mustChangePassword: true, sessionVersion: { increment: 1 } } });
            await tx.refreshToken.deleteMany({ where: { userId } });
            await writeAudit({ organizationId: id, userId: req.auth.userId, action: "RESET_CLIENT_PASSWORD", entity: "User", entityId: userId }, tx);
          });
          res.json({ success: true, message: "One-time password generated. Share it securely; it is shown only now.", data: { temporaryPassword, expiresAt } });
        } catch (error) { next(error); }
      });
      await writeAudit({ organizationId: organization.id, userId: req.auth.userId, action: "ONBOARD_CLIENT", entity: "Organization", entityId: organization.id }, tx);
      return { organization, user };
    });
    res.status(201).json({ success: true, message: "Client workspace and owner account created", data: client });
  } catch (error) { next(error); }
});
export default router;
