import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import multer from "multer";
import { z } from "zod";
import authRoutes from "./modules/auth/auth.routes.js";
import adminRoutes from "./modules/auth/admin.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import teamRoutes from "./modules/team/team.routes.js";
import inventoryRoutes from "./modules/inventory/inventory.routes.js";
import salesRoutes from "./modules/sales/sales.routes.js";
import documentsRoutes from "./modules/documents/documents.routes.js";
import cropRoutes from "./modules/resources/crop.routes.js";
import journalRoutes from "./modules/resources/journal.routes.js";
import livestockRoutes from "./modules/resources/livestock.routes.js";
import taskRoutes from "./modules/tasks/task.routes.js";
import boardRoutes from "./modules/board/board.routes.js";
import notificationRoutes from "./modules/tasks/notification.routes.js";
import financeRoutes from "./modules/finance/finance.routes.js";
import expenseRoutes from "./modules/finance/expense.routes.js";
import reportingRoutes from "./modules/reporting/reporting.routes.js";
import { createStructureRouter, organizationRouter } from "./modules/resources/structure.routes.js";
import { authenticate } from "./middleware/authenticate.js";
import { AppError } from "./shared/errors.js";
import { errorHandler } from "./shared/errors.js";
import { prisma } from "./config/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(__dirname, "../../client");
const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: { "script-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "img-src": ["'self'", "data:"] } } }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api/v1", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.get("/api/v1/health", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: "ok", database: "connected" } });
  } catch (error) { next(error); }
});
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", authenticate);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1", (req, _res, next) => {
  if (!req.auth.organizationId) return next(new AppError(403, "FOMS Admin access is separate from client workspaces"));
  if (req.auth.role === "WORKER" && !["dashboard", "tasks", "journal", "notifications", "inventory", "board"].includes(req.path.split("/")[1])) return next(new AppError(403, "Workers can access assigned tasks, their daily reports and personal notifications only"));
  next();
});
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/team", teamRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/sales", salesRoutes);
app.use("/api/v1/finance", financeRoutes);
app.use("/api/v1/expenses", expenseRoutes);
app.use("/api/v1/reporting", reportingRoutes);
app.use("/api/v1/documents", documentsRoutes);
app.use("/api/v1/organization", organizationRouter);
app.use("/api/v1/farms", createStructureRouter("farms"));
app.use("/api/v1/blocks", createStructureRouter("blocks"));
app.use("/api/v1/crops", cropRoutes);
app.use("/api/v1/journal", journalRoutes);
app.use("/api/v1/livestock", livestockRoutes);
app.use("/api/v1/tasks", taskRoutes);
app.use("/api/v1/board", boardRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1", (_req, res) => res.status(404).json({ success: false, message: "API endpoint was not found" }));
app.use(express.static(clientPath, { index: false, maxAge: 0 }));
app.get("*splat", (_req, res) => res.sendFile(path.join(clientPath, "index.html")));

app.use((error, _req, res, next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: "Please check the submitted information", errors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ success: false, message: error.code === "LIMIT_FILE_SIZE" ? "File is too large. The maximum upload size is 10 MB." : "The upload request is invalid" });
  }
  next(error);
});
app.use(errorHandler);

export default app;
