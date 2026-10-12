import { z } from "zod";
import { Prisma } from "@prisma/client";

export const categories = ["SEED", "FERTILIZER", "CHEMICAL", "FEED", "VACCINE", "SUPPLEMENT", "ASSET", "OTHER"];
export const conditions = ["WORKING", "NEEDS_REPAIR", "OUT_OF_SERVICE", "RETIRED"];
const number = (places) => z.preprocess(
  (value) => typeof value === "string" && value.trim() ? Number(value) : value,
  z.number().finite().min(0).max(1000000000).refine((value) => new Prisma.Decimal(value).decimalPlaces() <= places, `Use at most ${places} decimal places`)
);
const nullableText = (max) => z.string().trim().max(max).transform((value) => value || null).nullable().optional();
export const itemFields = z.object({
  farmId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(120),
  sku: nullableText(80), category: z.enum(categories),
  unit: z.string().trim().min(1).max(30),
  reorderLevel: number(3).optional(),
  notes: nullableText(2000), trackingMode: z.enum(["BATCH", "INDIVIDUAL"]).optional(),
  serialNumber: nullableText(120)
}).strict();
export const itemSchema = itemFields.extend({
  requestId: z.uuid().optional(), quantity: number(3).default(0),
  trackingMode: z.enum(["BATCH", "INDIVIDUAL"]).default("BATCH"),
  reorderLevel: number(3).default(0)
}).superRefine((value, ctx) => {
  if (value.trackingMode === "INDIVIDUAL" && (value.category !== "ASSET" || !value.sku || value.quantity !== 1 || value.reorderLevel !== 0)) ctx.addIssue({
    code: "custom", message: "Individual equipment requires Asset category, unique asset ID / SKU, quantity 1 and reorder level 0"
  });
  if (value.trackingMode === "BATCH" && value.serialNumber) ctx.addIssue({ code: "custom", message: "Serial number applies only to individually tracked equipment" });
});
export const movementSchema = z.object({
  requestId: z.uuid().optional(), type: z.enum(["IN", "OUT", "ADJUSTMENT"]),
  quantity: number(3), unitCost: number(2).optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  occurredAt: z.coerce.date().default(() => new Date())
}).strict().superRefine((value, ctx) => {
  if (value.type !== "ADJUSTMENT" && value.quantity <= 0) ctx.addIssue({ code: "custom", message: "Movement quantity must be positive" });
  if (value.type === "ADJUSTMENT" && (!value.notes || value.notes.length < 2)) ctx.addIssue({ code: "custom", message: "Explain the physical stock correction" });
});
export const assetEventSchema = z.object({
  requestId: z.uuid(), type: z.enum(["MAINTENANCE", "CONDITION"]),
  condition: z.enum(conditions), notes: z.string().trim().min(2).max(4000),
  observedAt: z.coerce.date(), cost: number(2).optional(),
  nextMaintenanceDate: z.coerce.date().nullable().optional()
}).strict().refine((value) => !value.nextMaintenanceDate || value.nextMaintenanceDate >= value.observedAt, { message: "Next maintenance cannot precede this observation" });
