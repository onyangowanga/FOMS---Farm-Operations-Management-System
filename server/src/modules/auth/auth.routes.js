import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";

const router = Router();
const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  organizationName: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(10).max(72)
});
const loginSchema = z.object({ email: z.email().trim().toLowerCase(), password: z.string().min(1).max(72) });
const cookieOptions = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === "true",
  sameSite: "strict",
  path: "/"
};
const ACCESS_TTL = "15m";
const REFRESH_DAYS = 30;

function issueAccessToken(userId, organizationId) {
  return jwt.sign({ organizationId }, process.env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: ACCESS_TTL });
}

async function issueRefreshToken(userId, organizationId, res) {
  const rawToken = crypto.randomBytes(48).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { userId, organizationId, tokenHash, expiresAt } });
  res.cookie("refreshToken", rawToken, { ...cookieOptions, maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000 });
}

function setAccessCookie(userId, organizationId, res) {
  res.cookie("accessToken", issueAccessToken(userId, organizationId), {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000
  });
}

router.post("/register", async (req, res, next) => {
  try {
    const payload = registerSchema.parse(req.body);
    const emailExists = await prisma.user.findUnique({ where: { email: payload.email } });
    if (emailExists) throw new AppError(409, "An account with this email already exists");
    const baseSlug = payload.organizationName.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 45) || "farm";
    const passwordHash = await bcrypt.hash(payload.password, 12);
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: payload.organizationName, slug: `${baseSlug}-${crypto.randomBytes(3).toString("hex")}` }
      });
      const user = await tx.user.create({
        data: {
          name: payload.name,
          email: payload.email,
          passwordHash,
          memberships: { create: { organizationId: organization.id, role: "OWNER" } }
        }
      });
      return { user, organization };
    });
    setAccessCookie(result.user.id, result.organization.id, res);
    await issueRefreshToken(result.user.id, result.organization.id, res);
    res.status(201).json({
      success: true,
      message: "Your farm workspace is ready",
      data: { user: { id: result.user.id, name: result.user.name, email: result.user.email }, organization: { id: result.organization.id, name: result.organization.name }, role: "OWNER" }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: payload.email }, include: { memberships: { include: { organization: true } } } });
    if (!user || user.deletedAt || !(await bcrypt.compare(payload.password, user.passwordHash))) throw new AppError(401, "Email or password is incorrect");
    const membership = user.memberships.find((item) => !item.organization.deletedAt);
    if (!membership) throw new AppError(403, "This account has no active farm workspace");
    setAccessCookie(user.id, membership.organizationId, res);
    await issueRefreshToken(user.id, membership.organizationId, res);
    res.json({
      success: true,
      message: "Signed in successfully",
      data: { user: { id: user.id, name: user.name, email: user.email }, organization: { id: membership.organization.id, name: membership.organization.name }, role: membership.role }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const rawToken = req.cookies.refreshToken;
    if (!rawToken) throw new AppError(401, "Please sign in again");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!stored || stored.expiresAt <= new Date() || stored.user.deletedAt) throw new AppError(401, "Your session has expired");
    const newRawToken = crypto.randomBytes(48).toString("base64url");
    const newTokenHash = crypto.createHash("sha256").update(newRawToken).digest("hex");
    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { id: stored.id } }),
      prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          organizationId: stored.organizationId,
          tokenHash: newTokenHash,
          expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000)
        }
      })
    ]);
    setAccessCookie(stored.userId, stored.organizationId, res);
    res.cookie("refreshToken", newRawToken, { ...cookieOptions, maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000 });
    res.json({ success: true, message: "Session refreshed" });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    if (req.cookies.refreshToken) {
      const tokenHash = crypto.createHash("sha256").update(req.cookies.refreshToken).digest("hex");
      await prisma.refreshToken.deleteMany({ where: { tokenHash } });
    }
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);
    res.json({ success: true, message: "Signed out successfully" });
  } catch (error) {
    next(error);
  }
});

router.get("/me", authenticate, async (req, res) => {
  res.json({ success: true, data: { user: { id: req.auth.userId, name: req.auth.name, email: req.auth.email }, organization: { id: req.auth.organizationId, name: req.auth.organizationName }, role: req.auth.role } });
});

export default router;
