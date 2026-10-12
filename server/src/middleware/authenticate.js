import jwt from "jsonwebtoken";
import { prisma } from "../config/database.js";
import { AppError } from "../shared/errors.js";

export async function authenticate(req, _res, next) {
  try {
    const token = req.cookies.accessToken;
    if (!token) throw new AppError(401, "Please sign in to continue");
    let claims;
    try { claims = jwt.verify(token, process.env.JWT_ACCESS_SECRET); }
    catch { throw new AppError(401, "Your session is invalid or expired"); }
    const user = await prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.deletedAt || (claims.sessionVersion ?? 0) !== user.sessionVersion) throw new AppError(401, "Your session is no longer valid");
    req.auth = { userId: user.id, name: user.name, email: user.email, username: user.username, sessionVersion: user.sessionVersion };
    if (user.isPlatformAdmin && claims.organizationId === null) {
      Object.assign(req.auth, { role: "FOMS_ADMIN", organizationId: null, organizationName: "FOMS Administration" });
    } else {
      const membership = await prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: claims.organizationId, userId: user.id } },
        include: { organization: true }
      });
      if (!membership || membership.organization.deletedAt) throw new AppError(401, "Your workspace access is no longer valid");
      Object.assign(req.auth, { role: membership.role, organizationId: membership.organizationId, organizationName: membership.organization.name });
    }
    next();
  } catch (error) { next(error); }
}

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) return next(new AppError(403, "You do not have permission to perform this action"));
    next();
  };
}
