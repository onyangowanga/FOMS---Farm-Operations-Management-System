import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";

const router = Router();
const memberSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(12).max(72),
  role: z.enum(["OWNER", "MANAGER", "AGRONOMIST", "WORKER"])
});

router.get("/", async (req, res, next) => {
  try {
    const members = await prisma.membership.findMany({
      where: { organizationId: req.auth.organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" }
    });
    res.json({
      success: true,
      data: members.map(({ id, role, createdAt, user }) => ({ id, role, createdAt, user }))
    });
  } catch (error) { next(error); }
});

router.post("/", authorize("OWNER"), async (req, res, next) => {
  try {
    const payload = memberSchema.parse(req.body);
    if (await prisma.user.findUnique({ where: { email: payload.email }, select: { id: true } })) {
      throw new AppError(409, "An account with this email already exists");
    }
    const user = await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        passwordHash: await bcrypt.hash(payload.password, 12),
        memberships: {
          create: { organizationId: req.auth.organizationId, role: payload.role }
        }
      },
      select: { id: true, name: true, email: true }
    });
    await writeAudit({
      organizationId: req.auth.organizationId,
      userId: req.auth.userId,
      action: "CREATE",
      entity: "Membership",
      entityId: user.id
    });
    res.status(201).json({ success: true, message: "Team member added", data: user });
  } catch (error) { next(error); }
});

export default router;
