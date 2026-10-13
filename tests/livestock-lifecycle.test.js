import test from "node:test";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";
import { livestockEventSchema } from "../server/src/modules/resources/livestock.validation.js";

const occurredAt = () => new Date(Date.now() - 60_000).toISOString();

test("livestock lifecycle events validate event-specific data", () => {
  const date = occurredAt();
  const valid = [
    { type: "PURCHASE", title: "Spring purchase", quantity: 3, amount: 150, currency: "KES", occurredAt: date },
    { type: "BIRTH", quantity: 2, occurredAt: date },
    { type: "BREEDING", title: "Buck-17", occurredAt: date },
    { type: "SALE", quantity: 1, occurredAt: date }
  ];
  for (const payload of valid) assert.equal(livestockEventSchema.safeParse(payload).success, true);
  assert.equal(livestockEventSchema.safeParse({ ...valid[0], amount: 0 }).success, false);
  assert.equal(livestockEventSchema.safeParse({ ...valid[1], quantity: 0 }).success, false);
  assert.equal(livestockEventSchema.safeParse({ ...valid[2], title: "" }).success, false);
  assert.equal(livestockEventSchema.safeParse({ ...valid[3], unexpected: true }).success, false);
});

test("livestock lifecycle updates batch counts and links purchases and invoices transactionally", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const worker = await f.seed("WORKER", owner.organizationId);
    const farm = (await request("/farms", "POST", { name: "Lifecycle farm" }, owner.cookie)).body.data;
    const profile = (await request("/livestock", "POST", {
      farmId: farm.id, species: "GOAT", trackingMode: "BATCH", quantity: 5, identifier: "Goat herd"
    }, owner.cookie)).body.data;
    const individual = (await request("/livestock", "POST", {
      farmId: farm.id, species: "SHEEP", trackingMode: "INDIVIDUAL", quantity: 1, identifier: "Sheep-1"
    }, owner.cookie)).body.data;
    assert.equal((await request(`/livestock/${individual.id}/events`, "POST", {
      type: "PURCHASE", title: "One individually tracked sheep", quantity: 2, amount: 900, occurredAt: occurredAt()
    }, manager.cookie)).status, 400);
    assert.equal((await request(`/livestock/${individual.id}/events`, "POST", {
      type: "BIRTH", quantity: 1, occurredAt: occurredAt()
    }, manager.cookie)).status, 409);
    const individualPurchase = await request(`/livestock/${individual.id}/events`, "POST", {
      type: "PURCHASE", title: "One individually tracked sheep", quantity: 1, amount: 450, occurredAt: occurredAt()
    }, manager.cookie);
    assert.equal(individualPurchase.status, 201);
    assert.equal((await request(`/livestock/${individual.id}`, "GET", undefined, owner.cookie)).body.data.quantity, 1);

    const path = `/livestock/${profile.id}`;
    const purchaseId = crypto.randomUUID();
    const purchasePayload = {
      requestId: purchaseId, type: "PURCHASE", title: "Purchased goats", quantity: 3,
      amount: 4500, currency: "KES", supplier: "Valley breeder", occurredAt: occurredAt()
    };
    const purchase = await request(`${path}/events`, "POST", purchasePayload, manager.cookie);
    assert.equal(purchase.status, 201);
    assert.equal(purchase.body.data.purchaseExpense.category, "LIVESTOCK");
    assert.equal(purchase.body.data.purchaseExpense.approvedAt, null);
    assert.equal((await request(path, "GET", undefined, owner.cookie)).body.data.quantity, 8);
    assert.equal((await request(path, "GET", undefined, owner.cookie)).body.data.initialQuantity, 8);
    const replay = await request(`${path}/events`, "POST", purchasePayload, manager.cookie);
    assert.equal(replay.status, 201);
    assert.equal(replay.body.data.id, purchase.body.data.id);
    assert.equal(await prisma.expense.count({ where: { livestockEventId: purchase.body.data.id } }), 1);
    assert.equal((await request(`/expenses/${purchase.body.data.purchaseExpense.id}/approve`, "POST", {}, manager.cookie)).status, 403);
    assert.equal((await request(`/expenses/${purchase.body.data.purchaseExpense.id}/approve`, "POST", {}, owner.cookie)).status, 200);
    assert.equal((await request(`/expenses/${purchase.body.data.purchaseExpense.id}`, "DELETE", undefined, owner.cookie)).status, 409);

    const birth = await request(`${path}/events`, "POST", { type: "BIRTH", quantity: 2, occurredAt: occurredAt() }, manager.cookie);
    assert.equal(birth.status, 201);
    assert.equal((await request(path, "GET", undefined, owner.cookie)).body.data.quantity, 10);
    const breeding = await request(`${path}/events`, "POST", { type: "BREEDING", title: "Buck-17", occurredAt: occurredAt() }, manager.cookie);
    assert.equal(breeding.status, 201);
    assert.equal((await request(path, "GET", undefined, owner.cookie)).body.data.quantity, 10);
    assert.equal((await request(`${path}/events`, "POST", { type: "BIRTH", quantity: 1, occurredAt: occurredAt() }, worker.cookie)).status, 403);

    const saleEvent = await request(`${path}/events`, "POST", {
      type: "SALE", title: "Market sale", quantity: 4, occurredAt: occurredAt()
    }, manager.cookie);
    assert.equal(saleEvent.status, 201);
    assert.equal((await request(path, "GET", undefined, owner.cookie)).body.data.quantity, 6);
    const invoiceRequestId = crypto.randomUUID();
    const invoicePayload = {
      requestId: invoiceRequestId, unitPrice: 1200, currency: "KES",
      buyer: { name: "Lifecycle buyer" }
    };
    const invoice = await request(`/sales/livestock-events/${saleEvent.body.data.id}/invoice`, "POST", invoicePayload, manager.cookie);
    assert.equal(invoice.status, 201);
    assert.equal(invoice.body.data.quantity, 4);
    assert.equal(invoice.body.data.unit, "head");
    assert.equal(invoice.body.data.farmId, farm.id);
    assert.equal(invoice.body.data.livestockEventId, saleEvent.body.data.id);
    const invoiceReplay = await request(`/sales/livestock-events/${saleEvent.body.data.id}/invoice`, "POST", invoicePayload, manager.cookie);
    assert.equal(invoiceReplay.status, 201);
    assert.equal(invoiceReplay.body.data.id, invoice.body.data.id);
    assert.equal(await prisma.sale.count({ where: { livestockEventId: saleEvent.body.data.id } }), 1);
    assert.equal((await request(`/sales/${invoice.body.data.id}`, "PATCH", { quantity: 2 }, manager.cookie)).status, 409);
    assert.equal((await request(`/sales/${invoice.body.data.id}`, "PATCH", { unit: "crate" }, manager.cookie)).status, 409);
    assert.equal((await request(`/sales/${invoice.body.data.id}`, "DELETE", undefined, manager.cookie)).status, 409);
    assert.equal((await request(`/sales/livestock-events/${saleEvent.body.data.id}/invoice`, "POST", {
      requestId: crypto.randomUUID(), unitPrice: 900, buyerId: invoice.body.data.buyerId
    }, owner.cookie)).status, 409);
    assert.equal((await request(`${path}/events`, "POST", {
      type: "SALE", quantity: 7, occurredAt: occurredAt()
    }, manager.cookie)).status, 409);
    assert.equal((await request(path, "GET", undefined, owner.cookie)).body.data.quantity, 6);
  } finally { await f.cleanup(); }
});
