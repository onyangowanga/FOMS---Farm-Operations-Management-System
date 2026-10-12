import { z } from "zod";
import { AppError } from "../../shared/errors.js";

export const reportQuery = z.object({
  period: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date (YYYY-MM-DD)"),
  farmId: z.uuid().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional()
}).strict();

export function reportingPeriod(query) {
  const anchor = new Date(`${query.date}T00:00:00.000Z`);
  if (!Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== query.date || anchor.getUTCFullYear() < 2000 || anchor.getUTCFullYear() > 2100) {
    throw new AppError(400, "Choose a valid calendar date between 2000 and 2100");
  }
  const start = new Date(anchor);
  if (query.period === "WEEKLY") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (query.period === "MONTHLY") start.setUTCDate(1);
  const end = new Date(start);
  if (query.period === "MONTHLY") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + (query.period === "WEEKLY" ? 7 : 1));
  const through = new Date(end.getTime() - 86400000);
  const offset = 3 * 3600000;
  return {
    period: query.period, anchorDate: query.date, timeZone: "Africa/Nairobi",
    startDate: start.toISOString().slice(0, 10), throughDate: through.toISOString().slice(0, 10),
    from: new Date(start.getTime() - offset).toISOString(),
    to: new Date(end.getTime() - offset - 1).toISOString()
  };
}

export const reportDate = (value) => value ? new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short"
}).format(new Date(value)) : "";
