import test from "node:test";
import assert from "node:assert/strict";
import { fixture, request, base } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";
import { reportingFixture, query, inside, outside } from "./reporting.helpers.js";

test("reporting: separate financial basis, calendar boundaries, currency totals and approval persistence", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed(), manager = await f.seed("MANAGER", owner.organizationId), agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const { farm } = await reportingFixture(owner);
    const sale = await request("/sales", "POST", { product: "Report eggs", quantity: 1, unit: "tray", unitPrice: 100.3, farmId: farm.id, buyer: { name: "Report buyer" }, soldAt: inside }, owner.cookie);
    assert.equal(sale.status, 201);
    assert.equal((await request(`/sales/${sale.body.data.id}/payments`, "POST", { amount: 10.1, method: "CASH", receivedAt: inside }, owner.cookie)).status, 201);
    const pending = await request("/expenses", "POST", { description: "Report seeds", category: "SEED", amount: 30.1, farmId: farm.id, expenseDate: inside }, manager.cookie);
    assert.equal(pending.status, 201);
    await prisma.expense.create({ data: { organizationId: owner.organizationId, farmId: farm.id, description: "USD approved", category: "SEED", amount: 5, currency: "USD", approvedAt: inside, expenseDate: inside } });
    await prisma.expense.create({ data: { organizationId: owner.organizationId, farmId: farm.id, description: "Excluded tomorrow", category: "SEED", amount: 999, expenseDate: outside } });
    const path = `/reporting/financial?${query}&farmId=${farm.id}`;
    assert.equal((await request(path)).status, 401);
    for (const suffix of ["", "/pdf", "/xlsx"]) assert.equal((await request(`/reporting/financial${suffix}?${query}`, "GET", undefined, agronomist.cookie)).status, 403);
    const result = await request(path, "GET", undefined, manager.cookie);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const summary = result.body.data.sections.find(s => s.id === "summary").rows;
    assert.deepEqual(summary, [["KES", 100.3, 0, 30.1, 100.3, 10.1, 90.2], ["USD", 0, 5, 0, -5, 0, 0]]);
    assert.equal(JSON.stringify(result.body).includes("Excluded tomorrow"), false);
    assert.equal(JSON.stringify(result.body).includes("9876"), false);
    assert.equal(result.body.data.sections.find(s => s.id === "invoices").rows[0][11], 90.2);
    assert.equal((await request(`/expenses/${pending.body.data.id}/approve`, "POST", {}, owner.cookie)).status, 200);
    const updated = (await request(path, "GET", undefined, owner.cookie)).body.data;
    assert.deepEqual(updated.sections[0].rows[0], ["KES", 100.3, 30.1, 0, 70.2, 10.1, 90.2]);
    assert.equal((await request(`${path}&currency=USD`, "GET", undefined, owner.cookie)).body.data.sections[0].rows.length, 1);
    assert.equal((await request(`/reporting/financial?period=WEEKLY&date=2026-01-15`, "GET", undefined, owner.cookie)).body.data.startDate, "2026-01-12");
    assert.equal((await request(`/reporting/financial?period=MONTHLY&date=2026-02-15`, "GET", undefined, owner.cookie)).body.data.throughDate, "2026-02-28");
  } finally { await f.cleanup(); }
});
