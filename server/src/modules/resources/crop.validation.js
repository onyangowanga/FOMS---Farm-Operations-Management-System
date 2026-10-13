import { z } from "zod";
import { AppError } from "../../shared/errors.js";

export const cropStages = ["PLANNED", "NURSERY", "TRANSPLANTED", "GROWING", "FLOWERING", "FRUITING", "READY_TO_HARVEST", "HARVESTED", "CANCELLED"];
export const activeCropStages = cropStages.filter((stage) => !["HARVESTED", "CANCELLED"].includes(stage));
const text = z.string().trim().max(2000).nullable().optional();
const date = z.coerce.date().nullable().optional();
const number = z.number().finite().nonnegative().nullable().optional();
export const cropTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  requiresNursery: z.boolean().default(false),
  nurseryDays: z.number().int().min(1).max(730).nullable().optional(),
  maturityDays: z.number().int().min(1).max(3650).nullable().optional()
}).strict();
export const cropSchema = z.object({
  farmId: z.uuid(), blockId: z.uuid().nullable().optional(), cropTypeId: z.uuid().nullable().optional(),
  cropName: z.string().trim().min(1).max(120), variety: text,
  status: z.enum(cropStages).optional(), acreage: number, bedCount: z.number().int().min(1).max(100000).nullable().optional(), expectedYield: number,
  requiresNursery: z.boolean().optional(), nurseryDays: z.number().int().min(1).max(730).nullable().optional(),
  yieldingDays: z.number().int().min(1).max(3650).nullable().optional(),
  nurseryDate: date, plantingDate: date, transplantDate: date, expectedHarvest: date, notes: text
}).strict();
export const stageSchema = z.object({
  stage: z.enum(cropStages), occurredAt: z.coerce.date(), notes: z.string().trim().min(2).max(2000)
}).strict();
export const activitySchema = z.object({
  type: z.enum(["IRRIGATION", "FERTILIZER", "HARVEST", "CUSTOM"]),
  customActivity: z.string().trim().min(2).max(120).nullable().optional(),
  occurredAt: z.coerce.date(), quantity: z.number().finite().positive(),
  unit: z.enum(["litres", "m3", "mm", "kg", "g", "tonnes", "bags", "crates", "pieces", "OTHER"]),
  customUnit: z.string().trim().toLowerCase().min(1).max(40).nullable().optional(),
  product: text, notes: text
}).strict().superRefine((value, context) => {
  const units = { IRRIGATION: ["litres", "m3", "mm"], FERTILIZER: ["kg", "g", "litres"], HARVEST: ["kg", "tonnes", "bags", "crates", "pieces"] };
  if (value.type !== "CUSTOM" && value.unit !== "OTHER" && !units[value.type].includes(value.unit)) context.addIssue({ code: "custom", path: ["unit"], message: "Choose a unit suitable for this activity" });
  if (value.type === "CUSTOM" && !value.customActivity) context.addIssue({ code: "custom", path: ["customActivity"], message: "Specify the custom activity" });
  if (value.type !== "CUSTOM" && value.customActivity) context.addIssue({ code: "custom", path: ["customActivity"], message: "Only custom activities accept a custom name" });
  if (value.unit === "OTHER" && !value.customUnit) context.addIssue({ code: "custom", path: ["customUnit"], message: "Specify the unit" });
  if (value.unit !== "OTHER" && value.customUnit) context.addIssue({ code: "custom", path: ["customUnit"], message: "Choose Other to specify a unit" });
  if (value.type === "FERTILIZER" && !value.product) context.addIssue({ code: "custom", path: ["product"], message: "Enter the fertilizer product" });
  if (value.occurredAt > new Date()) context.addIssue({ code: "custom", path: ["occurredAt"], message: "Activity date cannot be in the future" });
});

export function validateCropDates(crop) {
  if (crop.requiresNursery && (!crop.nurseryDate || !crop.nurseryDays)) throw new AppError(400, "Nursery crops require a nursery sowing date and nursery duration");
  if (["NURSERY", "TRANSPLANTED"].includes(crop.status) && !crop.requiresNursery) throw new AppError(400, "This stage requires a nursery crop");
  const sowing = crop.nurseryDate && new Date(crop.nurseryDate);
  const planting = crop.plantingDate && new Date(crop.plantingDate);
  const transplant = crop.transplantDate && new Date(crop.transplantDate);
  const harvest = crop.expectedHarvest && new Date(crop.expectedHarvest);
  if (sowing && planting && planting < sowing) throw new AppError(400, "Field planting must be on or after nursery sowing");
  if (transplant && (!crop.requiresNursery || !sowing || transplant < sowing)) throw new AppError(400, "Transplanting must be on or after nursery sowing for a nursery crop");
  if (harvest && [sowing, planting, transplant].some((value) => value && harvest < value)) throw new AppError(400, "Expected harvest must be on or after sowing, planting and transplanting");
}
