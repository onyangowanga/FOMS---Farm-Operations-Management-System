import { prisma } from "../config/database.js";

export function writeAudit({ organizationId, userId, action, entity, entityId }) {
  return prisma.auditLog.create({
    data: { organizationId, userId, action, entity, entityId }
  });
}
