import { prisma } from "../config/database.js";

export function writeAudit({ organizationId, userId, action, entity, entityId }, client = prisma) {
  return client.auditLog.create({
    data: { organizationId, userId, action, entity, entityId }
  });
}
