import test from "node:test";
import assert from "node:assert/strict";
import { reportingPeriod, reportQuery } from "../server/src/modules/reporting/reporting.period.js";

test("reporting calendar periods cover Kenya midnight, Monday weeks, leap months and invalid dates", () => {
  const daily = reportingPeriod({ period: "DAILY", date: "2026-01-01" });
  assert.equal(daily.from, "2025-12-31T21:00:00.000Z");
  assert.equal(daily.to, "2026-01-01T20:59:59.999Z");
  const week = reportingPeriod({ period: "WEEKLY", date: "2026-01-04" });
  assert.equal(week.startDate, "2025-12-29"); assert.equal(week.throughDate, "2026-01-04");
  const month = reportingPeriod({ period: "MONTHLY", date: "2024-02-29" });
  assert.equal(month.startDate, "2024-02-01"); assert.equal(month.throughDate, "2024-02-29");
  for (const date of ["2026-02-29", "2026-13-01", "1999-12-31", "2101-01-01"]) assert.throws(() => reportingPeriod({ period: "DAILY", date }));
  assert.throws(() => reportQuery.parse({ period: "YEARLY", date: "2026-01-01" }));
});
