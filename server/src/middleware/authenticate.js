import jwt from "jsonwebtoken";
import { prisma } from "../config/database.js";
import { AppError } from "../shared/errors.js";

export async function authenticate(req, _res, next) {
  try {
    const token = req.cookies.accessToken;
    if (!token) throw new AppError(401, "Please sign in to continue");
    const claims = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const membership = await prisma.membership.findFirst({
      where: { userId: claims.sub, organizationId: claims.organizationId },
      include: { user: { select: { id: true, name: true, email: true } }, organization: { select: { id: true, name: true } } }
    });
    if (!membership || membership.user.deletedAt) throw new AppError(401, "Your session is no longer valid");
    req.auth = {
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role
    };
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(401, "Your session is invalid or expired"));
  }
}

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) return next(new AppError(403, "You do not have permission to perform this action"));
    next();
  };
}
