import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import ExcelJS from "exceljs";
import { fixture, request, base } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";
import { binary, reportingFixture, query, inside } from "./reporting.helpers.js";

test("reporting: real PDF/XLSX exports, spreadsheet-safe text, crop-only exports and explicit size limits", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed(), manager = await f.seed("MANAGER", owner.organizationId), agronomist = await f.seed("AGRONOMIST", owner.organizationId), foreign = await f.seed();
    const { farm, crop } = await reportingFixture(owner);
    await prisma.cropCycle.update({ where: { id: crop.id }, data: { cropName: '=HYPERLINK("https://example.test")' } });
    const url = `operations/xlsx?${query}&farmId=${farm.id}`;
    assert.equal((await binary(url)).status, 401);
    assert.equal((await binary(url, foreign.cookie)).status, 404);
    const excel = await binary(url, manager.cookie);
    assert.equal(excel.status, 200, excel.content.toString());
    assert.equal(excel.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.match(excel.headers.get("content-disposition"), /FOMS-operations-daily-2026-01-15.xlsx/);
    assert.equal(excel.headers.get("cache-control"), "private, no-store");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(excel.content);
    const cell = workbook.getWorksheet("crops").getCell("B2");
    assert.equal(cell.value, '=HYPERLINK("https://example.test")');
    assert.equal(cell.type, ExcelJS.ValueType.String, "User text must not become spreadsheet formulas");
    assert.equal(workbook.getWorksheet("activities").getCell("E2").value, 2.5);
    assert.ok(workbook.getWorksheet("livestock"));
    const cropExcel = new ExcelJS.Workbook(); await cropExcel.xlsx.load((await binary(url, agronomist.cookie)).content);
    assert.equal(cropExcel.getWorksheet("livestock"), undefined);
    assert.equal(cropExcel.getWorksheet("completedTasks"), undefined);
    assert.equal(cropExcel.getWorksheet("observations").rowCount, 2);
    const pdf = await binary(`operations/pdf?${query}&farmId=${farm.id}`, owner.cookie);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.content.subarray(0, 8).toString(), /^%PDF-1\./);
    assert.match(pdf.content.toString("latin1"), /%%EOF/);
    const streams = [...pdf.content.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => inflateSync(Buffer.from(m[1], "latin1")).toString());
    const text = streams.flatMap(stream => [...stream.matchAll(/<([0-9a-f]+)>/gi)].map(m => Buffer.from(m[1], "hex").toString("latin1"))).join("");
    assert.match(text, /Hand weeding/);
    assert.match(text, /Africa\/Nairobi/);
    const cropPdf = await binary(`operations/pdf?${query}&farmId=${farm.id}`, agronomist.cookie);
    assert.equal(cropPdf.status, 200);
    const unicodeName = "\u7389\u7c73";
    await prisma.cropCycle.update({ where: { id: crop.id }, data: { cropName: unicodeName } });
    const unicodePdf = await binary(`operations/pdf?${query}&farmId=${farm.id}`, owner.cookie);
    assert.equal(unicodePdf.status, 422);
    assert.match(JSON.parse(unicodePdf.content.toString()).message, /Download Excel/);
    const unicodeExcel = new ExcelJS.Workbook(); await unicodeExcel.xlsx.load((await binary(url, owner.cookie)).content);
    assert.equal(unicodeExcel.getWorksheet("crops").getCell("B2").value, unicodeName);
    await prisma.expense.create({ data: { organizationId: owner.organizationId, farmId: farm.id, description: "Financial fixture", category: "SEED", amount: 12.25, expenseDate: inside, approvedAt: inside } });
    const finance = new ExcelJS.Workbook(); await finance.xlsx.load((await binary(`financial/xlsx?${query}`, owner.cookie)).content);
    assert.equal(finance.getWorksheet("summary").getCell("E2").value, -12.25);
    assert.equal((await binary(`financial/pdf?${query}`, manager.cookie)).status, 200);
    await prisma.cropActivity.createMany({ data: Array.from({ length: 2000 }, () => ({ cropId: crop.id, type: "OTHER", occurredAt: inside, quantity: 1, unit: "hours" })) });
    for (const suffix of ["", "/xlsx", "/pdf"]) {
      const limit = await request(`/reporting/operations${suffix}?${query}`, "GET", undefined, owner.cookie);
      assert.equal(limit.status, 413);
      assert.match(limit.body.message, /nothing has been truncated/);
    }
    assert.equal(await prisma.cropActivity.count({ where: { cropId: crop.id } }), 2002, "Read-only report requests must not change records");
  } finally { await f.cleanup(); }
});
