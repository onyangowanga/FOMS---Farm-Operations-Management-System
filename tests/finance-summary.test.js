import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fixture, request, base } from "./helpers.js";

test("finance: approved-only profit, pending totals, currency/farm/date separation and period collections", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const worker = await f.seed("WORKER", owner.organizationId);
    const foreign = await f.seed();
    assert.equal((await request("/finance")).status, 401);
    for (const actor of [agronomist, worker]) assert.equal((await request("/finance", "GET", undefined, actor.cookie)).status, 403);
    const farm = (await request("/farms", "POST", { name: "Finance farm" }, owner.cookie)).body.data;
    const soldAt = new Date().toISOString();
    const earlier = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 2).toISOString();
    const createSale = (currency, total, date = soldAt, farmId = farm.id) => request("/sales", "POST", {
      product: "Maize", quantity: 1, unit: "kg", unitPrice: total, currency, soldAt: date, farmId, buyer: { name: "Buyer" }, requestId: crypto.randomUUID()
    }, owner.cookie);
    const sale = await createSale("KES", 100.3);
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal((await createSale("USD", 30)).status, 201);
    assert.equal((await createSale("KES", 5, soldAt, null)).status, 201);
    const olderSale = await createSale("KES", 20, earlier);
    assert.equal((await request(`/sales/${sale.body.data.id}/payments`, "POST", { amount: 10.1, method: "MPESA", receivedAt: soldAt }, owner.cookie)).status, 201);
    assert.equal((await request(`/sales/${olderSale.body.data.id}/payments`, "POST", { amount: 20, method: "CASH", receivedAt: soldAt }, owner.cookie)).status, 201);
    const expense = async (currency, amount, approved) => {
      const response = await request("/expenses", "POST", { description: "Farm input", category: "SEED", currency, amount, farmId: farm.id, expenseDate: soldAt }, manager.cookie);
      assert.equal(response.status, 201);
      if (approved) assert.equal((await request(`/expenses/${response.body.data.id}/approve`, "POST", {}, owner.cookie)).status, 200);
      return response.body.data.id;
    };
    await expense("KES", 30.1, true);
    const pending = await expense("KES", 40.2, false);
    await expense("USD", 5, true);
    const from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const to = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString();
    const query = `/finance?${new URLSearchParams({ farmId: farm.id, from, to })}`;
    const response = await request(query, "GET", undefined, manager.cookie);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const kes = response.body.data.find((row) => row.currency === "KES");
    assert.equal(kes.revenue, 100.3);
    assert.equal(kes.approvedExpenses, 30.1);
    assert.equal(kes.pendingExpenses, 40.2);
    assert.equal(kes.profit, 70.2);
    assert.equal(kes.collected, 30.1, "Collections include an older invoice paid in this period");
    assert.equal(kes.outstanding, 90.2, "Outstanding is current balance of invoices sold in the period");
    assert.deepEqual(kes.expenseCategories, [{ category: "SEED", approved: 30.1, pending: 40.2 }]);
    assert.equal(response.body.data.find((row) => row.currency === "USD").profit, 25);
    assert.equal((await request(`${query}&currency=USD`, "GET", undefined, owner.cookie)).body.data.length, 1);
    assert.equal((await request(query, "GET", undefined, foreign.cookie)).body.data.length, 0);
    assert.equal((await request(`/finance?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`, "GET", undefined, owner.cookie)).status, 400);
    const dashboard = (await request("/dashboard", "GET", undefined, owner.cookie)).body.data;
    assert.equal(dashboard.monthlyProfit, 75.2, "Dashboard is KES only and includes unassigned invoices");
    assert.equal(dashboard.monthlyPendingExpenses, 40.2);
    assert.equal((await request(`/expenses/${pending}/approve`, "POST", {}, owner.cookie)).status, 200);
    const updated = (await request(query, "GET", undefined, owner.cookie)).body.data.find((row) => row.currency === "KES");
    assert.equal(updated.profit, 30);
    assert.equal(updated.pendingExpenses, 0);
    const expenseOnly = await request("/expenses", "POST", { description: "Expense before first sale", category: "SEED", amount: 12.25, expenseDate: soldAt }, foreign.cookie);
    assert.equal(expenseOnly.status, 201);
    assert.equal((await request(`/expenses/${expenseOnly.body.data.id}/approve`, "POST", {}, foreign.cookie)).status, 200);
    assert.equal((await request("/dashboard", "GET", undefined, foreign.cookie)).body.data.monthlyProfit, -12.25);
    assert.equal((await request("/finance", "GET", undefined, foreign.cookie)).body.data[0].profit, -12.25);
  } finally { await f.cleanup(); }
});
