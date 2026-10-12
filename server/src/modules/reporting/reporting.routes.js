import { Router } from "express";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { reportQuery, reportingPeriod } from "./reporting.period.js";
import { operationsReport, financeReport } from "./reporting.data.js";
import { pdfReport, excelReport } from "./reporting.exports.js";

const router = Router();
router.use(authorize("OWNER", "MANAGER", "AGRONOMIST"));
const types = ["operations", "financial"];
router.get("/:type{/:format}", async (req, res, next) => {
  try {
    if (!types.includes(req.params.type)) throw new AppError(404, "Report type was not found");
    if (req.params.type === "financial" && !["OWNER", "MANAGER"].includes(req.auth.role)) throw new AppError(403, "Financial reports are available to owners and managers only");
    if (req.params.format && !["pdf", "xlsx"].includes(req.params.format)) throw new AppError(404, "Choose a PDF or Excel report");
    const query = reportQuery.parse(req.query);
    const period = reportingPeriod(query);
    const report = await prisma.$transaction(tx => req.params.type === "financial" ? financeReport(tx, req, query, period) : operationsReport(tx, req, query, period), { isolationLevel: "RepeatableRead", timeout: 30000 });
    if (!req.params.format) return res.json({ success: true, data: report });
    const pdf = req.params.format === "pdf";
    const content = pdf ? await pdfReport(report) : await excelReport(report);
    const filename = `FOMS-${report.type.toLowerCase()}-${report.period.toLowerCase()}-${report.startDate}.${req.params.format}`;
    res.set({
      "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"
    }).send(Buffer.from(content));
  } catch (error) { next(error); }
});
export default router;
