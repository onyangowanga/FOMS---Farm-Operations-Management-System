import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { accountSchema } from "./account.validation.js";
import { writeAudit } from "../../shared/audit.js";

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
      await writeAudit({ organizationId: organization.id, userId: req.auth.userId, action: "ONBOARD_CLIENT", entity: "Organization", entityId: organization.id }, tx);
      return { organization, user };
    });
    res.status(201).json({ success: true, message: "Client workspace and owner account created", data: client });
  } catch (error) { next(error); }
});
export default router;
