import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { reportDate } from "./reporting.period.js";
import { AppError } from "../../shared/errors.js";

const GREEN = "14532D";
function metadata(report) {
  return [
    ["Organization", report.organization], ["Farm scope", report.farm], ["Report", report.title],
    ["Period", report.period], ["Dates (inclusive)", `${report.startDate} to ${report.throughDate}`],
    ["Time zone", report.timeZone], ["Generated", reportDate(report.generatedAt)],
    ...(report.currency ? [["Currency", report.currency]] : [])
  ];
}
export async function excelReport(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FOMS";
  workbook.created = new Date(report.generatedAt);
  const info = workbook.addWorksheet("Report information");
  info.columns = [{ width: 24 }, { width: 100 }];
  for (const row of metadata(report)) info.addRow(row);
  info.addRow([]);
  for (const note of report.notes) info.addRow(["Basis / limitation", note]);
  info.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  for (const item of report.sections) {
    const sheet = workbook.addWorksheet(item.id.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(item.columns);
    item.rows.forEach(row => sheet.addRow(row.map(value => value ?? "")));
    sheet.columns.forEach((column, index) => {
      column.width = Math.min(60, Math.max(18, item.columns[index].length + 2));
      column.alignment = { wrapText: true, vertical: "top" };
      if (/amount|price|revenue|expenses|profit|collected|balance|outstanding|approved$|pending$/i.test(item.columns[index])) column.numFmt = "#,##0.00;[Red]-#,##0.00";
    });
    const heading = sheet.getRow(1);
    heading.font = { bold: true, color: { argb: "FFFFFFFF" } };
    heading.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, item.rows.length + 1), column: item.columns.length } };
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
  }
  return workbook.xlsx.writeBuffer();
}
export function pdfReport(report) {
  // Built-in PDF fonts use WinAnsi; never silently corrupt unsupported names.
  const text = [...metadata(report).flat(), ...report.notes, ...report.sections.flatMap(item => [item.title, ...item.columns, ...item.rows.flat()])].join("\n");
  if (/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/u.test(text)) {
    throw new AppError(422, "This report contains characters unsupported by the PDF font. Download Excel to preserve the original text.");
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: report.title, Author: "FOMS", Subject: `${report.period} ${report.startDate} to ${report.throughDate}` } });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(22).fillColor(`#${GREEN}`).text(`FOMS - ${report.title}`);
    doc.moveDown().fontSize(10).fillColor("#111827");
    for (const [key, value] of metadata(report)) doc.text(`${key}: ${value}`);
    doc.moveDown();
    for (const note of report.notes) doc.text(note).moveDown(0.4);
    for (const item of report.sections) {
      doc.addPage().fontSize(15).fillColor(`#${GREEN}`).text(item.title);
      doc.moveDown().fontSize(10).fillColor("#111827").text(`${item.rows.length} records`);
      if (!item.rows.length) doc.moveDown().text("No matching records.");
      for (let index = 0; index < item.rows.length; index++) {
        doc.moveDown().font("Helvetica-Bold").text(`Record ${index + 1}`).font("Helvetica");
        item.columns.forEach((column, i) => {
          const value = item.rows[index][i];
          doc.text(`${column}: ${value === null || value === undefined || value === "" ? "-" : value}`);
        });
      }
    }
    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page++) {
      doc.switchToPage(page);
      doc.fontSize(8).fillColor("#6B7280").text(`FOMS | ${report.startDate} - ${report.throughDate} | Page ${page + 1} of ${pages.count}`, 40, doc.page.height - 30, { lineBreak: false, width: doc.page.width - 80, align: "center" });
    }
    doc.end();
  });
}
