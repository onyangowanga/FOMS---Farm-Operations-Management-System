import { z } from "zod";
import { currency, money } from "../finance/finance.shared.js";

const text = z.string().trim().max(2000).nullable().optional();
const pastDate = z.coerce.date().refine((date) => date <= new Date(), "Date cannot be in the future");
const positive = z.number().finite().positive();
const count = positive.int().max(100000);
export const healthStatus = z.enum(["HEALTHY", "UNDER_TREATMENT", "SICK"]);
export const livestockSchema = z.object({
  farmId: z.uuid(),
  species: z.enum(["GOAT", "SHEEP", "POULTRY"]),
  trackingMode: z.enum(["INDIVIDUAL", "BATCH"]).optional(),
  identifier: text,
  breed: text,
  quantity: count.optional(),
  birthDate: pastDate.nullable().optional(),
  weightKg: positive.nullable().optional(),
  healthStatus: healthStatus.optional(),
  lastVaccinated: pastDate.nullable().optional(),
  notes: text
}).strict();

export const livestockEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("VACCINATION"), title: z.string().trim().min(1).max(200), quantity: count, nextDueAt: z.coerce.date().nullable().optional() }),
  z.object({ type: z.literal("HEALTH"), title: z.string().trim().min(1).max(200), healthStatus }),
  z.object({ type: z.literal("WEIGHT"), weightKg: positive }),
  z.object({ type: z.literal("MORTALITY"), quantity: count, title: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("FEED"), feedKg: positive, title: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("EGG_PRODUCTION"), quantity: count }),
  z.object({ type: z.literal("PURCHASE"), quantity: count, amount: money, currency: currency.default("KES"), supplier: text, title: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("BIRTH"), quantity: count, title: z.string().trim().max(200).optional() }),
  z.object({ type: z.literal("BREEDING"), title: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("SALE"), quantity: count, title: z.string().trim().max(200).optional() })
].map((schema) => schema.extend({ occurredAt: pastDate, notes: text, requestId: z.uuid().optional() }).strict()))
  .refine((event) => event.type !== "VACCINATION" || !event.nextDueAt || event.nextDueAt >= event.occurredAt, {
    path: ["nextDueAt"], message: "Next vaccination must not be before this vaccination"
  });
