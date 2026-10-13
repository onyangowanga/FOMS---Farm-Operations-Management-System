import { z } from "zod";

const text = z.string().trim().max(4000).nullable().optional();
export const taskInputSchema = z.object({
  farmId: z.uuid().nullable().optional(),
  title: z.string().trim().min(2).max(160),
  description: text,
  category: z.string().trim().max(100).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  assignedTo: z.uuid().nullable().optional(),
  evidenceRequired: z.boolean().optional()
}).strict();
export const taskStatusSchema = z.object({
  status: z.enum(["IN_PROGRESS", "COMPLETED", "APPROVED"]),
  notes: text,
  evidenceUrl: z.url().refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS evidence link").nullable().optional()
}).strict();
export const taskQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "APPROVED", "VOID"]).optional(),
  farmId: z.uuid().optional(),
  assignedTo: z.uuid().optional()
});
