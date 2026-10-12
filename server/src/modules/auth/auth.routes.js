import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { usernameSchema, passwordSchema } from "./account.validation.js";

const router = Router();
const loginSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(72) });
const cookieOptions = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === "true",
  sameSite: "strict",
  path: "/"
};
const ACCESS_TTL = "15m";
const REFRESH_DAYS = 30;

function issueAccessToken(userId, organizationId, sessionVersion) {
  return jwt.sign({ organizationId, sessionVersion }, process.env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: ACCESS_TTL });
}

async function issueRefreshToken(userId, organizationId, res, sessionVersion) {
  const rawToken = crypto.randomBytes(48).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { userId, organizationId, tokenHash, expiresAt, sessionVersion } });
  res.cookie("refreshToken", rawToken, { ...cookieOptions, maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000 });
}

function setAccessCookie(userId, organizationId, res, sessionVersion) {
  res.cookie("accessToken", issueAccessToken(userId, organizationId, sessionVersion), {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000
  });
}

router.post("/register", (_req, _res, next) => {
  next(new AppError(403, "Public registration is disabled. Contact the FOMS administrator for an account."));
});

router.post("/setup", async (req, res, next) => {
  try {
    const payload = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema }).strict().parse(req.body);
    const tokenHash = crypto.createHash("sha256").update(payload.token).digest("hex");
    const passwordHash = await bcrypt.hash(payload.password, 12);
    const username = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AccountSetupToken" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const setup = await tx.accountSetupToken.findUnique({ where: { tokenHash }, include: { user: true } });
      if (!setup || setup.expiresAt <= new Date() || setup.user.deletedAt || !setup.user.isPlatformAdmin) throw new AppError(400, "This setup link is invalid, expired or already used");
      await tx.user.update({ where: { id: setup.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      await tx.refreshToken.deleteMany({ where: { userId: setup.userId } });
      await tx.accountSetupToken.delete({ where: { id: setup.id } });
      return setup.user.username;
    });
    res.json({ success: true, message: "Password set. Sign in with your username and new password.", data: { username } });
  } catch (error) { next(error); }
});

router.post("/login", async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: payload.username }, include: { memberships: { include: { organization: true } } } });
    if (!user || user.deletedAt || !(await bcrypt.compare(payload.password, user.passwordHash))) throw new AppError(401, "Username or password is incorrect");
    const membership = user.memberships.find((item) => !item.organization.deletedAt);
    if (!user.isPlatformAdmin && !membership) throw new AppError(403, "This account has no active farm workspace");
    const organizationId = user.isPlatformAdmin ? null : membership.organizationId;
    setAccessCookie(user.id, organizationId, res, user.sessionVersion);
    await issueRefreshToken(user.id, organizationId, res, user.sessionVersion);
    res.json({
      success: true,
      message: "Signed in successfully",
      data: { user: { id: user.id, name: user.name, email: user.email, username: user.username }, organization: user.isPlatformAdmin ? { id: null, name: "FOMS Administration" } : { id: membership.organization.id, name: membership.organization.name }, role: user.isPlatformAdmin ? "FOMS_ADMIN" : membership.role }
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
    if (!stored || stored.expiresAt <= new Date() || stored.user.deletedAt || stored.sessionVersion !== stored.user.sessionVersion) throw new AppError(401, "Your session has expired");
    if (stored.organizationId === null) {
      if (!stored.user.isPlatformAdmin) throw new AppError(401, "Your administrator access is no longer valid");
    } else {
      const membership = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: stored.organizationId, userId: stored.userId } }, include: { organization: true } });
      if (!membership || membership.organization.deletedAt) throw new AppError(401, "Your workspace access is no longer valid");
    }
    const newRawToken = crypto.randomBytes(48).toString("base64url");
    const newTokenHash = crypto.createHash("sha256").update(newRawToken).digest("hex");
    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { id: stored.id } }),
      prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          organizationId: stored.organizationId,
          sessionVersion: stored.user.sessionVersion,
          tokenHash: newTokenHash,
          expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000)
        }
      })
    ]);
    setAccessCookie(stored.userId, stored.organizationId, res, stored.user.sessionVersion);
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

router.post("/password", authenticate, async (req, res, next) => {
  try {
    const payload = z.object({ currentPassword: z.string().min(1).max(72), password: passwordSchema }).parse(req.body);
    if (payload.currentPassword === payload.password) throw new AppError(400, "Choose a different password");
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.auth.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
      if (!(await bcrypt.compare(payload.currentPassword, user.passwordHash))) throw new AppError(400, "Current password is incorrect");
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(payload.password, 12), sessionVersion: { increment: 1 } } });
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
    });
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);
    res.json({ success: true, message: "Password changed. Sign in again with your new password." });
  } catch (error) { next(error); }
});

router.get("/me", authenticate, async (req, res) => {
  res.json({ success: true, data: { user: { id: req.auth.userId, name: req.auth.name, email: req.auth.email, username: req.auth.username }, organization: { id: req.auth.organizationId, name: req.auth.organizationName }, role: req.auth.role } });
});

export default router;
