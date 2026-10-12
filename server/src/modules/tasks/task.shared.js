import { z } from "zod";
import { AppError } from "../../shared/errors.js";

export const managers = ["OWNER", "MANAGER"];
export function taskScope(req) {
  return {
    organizationId: req.auth.organizationId, deletedAt: null,
    ...(req.auth.role === "WORKER" ? { assignedTo: req.auth.userId } : {})
  };
}
export async function findTask(tx, req) {
  const task = await tx.task.findFirst({ where: { ...taskScope(req), id: z.uuid().parse(req.params.id) } });
  if (!task) throw new AppError(404, "Task was not found");
  return task;
}
export async function notifyTask(tx, req, task, type, message, userIds) {
  const memberships = await tx.membership.findMany({
    where: { organizationId: req.auth.organizationId, userId: { in: [...new Set(userIds.filter(Boolean))] }, user: { deletedAt: null, isPlatformAdmin: false } },
    select: { userId: true }
  });
  const recipients = memberships.filter(({ userId }) => userId !== req.auth.userId);
  if (recipients.length) await tx.notification.createMany({
    data: recipients.map(({ userId }) => ({
      organizationId: req.auth.organizationId, userId, taskId: task.id, type, message
    }))
  });
}
export async function notifyManagers(tx, req, task, type, message) {
  const members = await tx.membership.findMany({ where: { organizationId: req.auth.organizationId, role: { in: managers } }, select: { userId: true } });
  await notifyTask(tx, req, task, type, message, members.map((member) => member.userId));
}
