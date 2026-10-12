import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";

const router = Router();
router.use(authorize("OWNER", "MANAGER", "AGRONOMIST", "WORKER"));
const scope = (req) => ({
  organizationId: req.auth.organizationId, userId: req.auth.userId,
  OR: [
    { task: { organizationId: req.auth.organizationId, deletedAt: null, ...(req.auth.role === "WORKER" ? { assignedTo: req.auth.userId } : {}) } },
    ...(["OWNER", "MANAGER"].includes(req.auth.role) ? [{ inventoryItem: { organizationId: req.auth.organizationId, deletedAt: null } }] : [])
  ]
});
router.get("/", async (req, res, next) => {
  try {
    const query = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const where = scope(req);
    const [data, total, unread] = await prisma.$transaction([
      prisma.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, readAt: null } })
    ]);
    res.json({ success: true, data, meta: { ...query, total, unread } });
  } catch (error) { next(error); }
});
router.post("/read-all", async (req, res, next) => {
  try {
    await prisma.notification.updateMany({ where: { ...scope(req), readAt: null }, data: { readAt: new Date() } });
    res.json({ success: true, message: "Notifications marked read" });
  } catch (error) { next(error); }
});
router.patch("/:id", async (req, res, next) => {
  try {
    z.object({ read: z.literal(true) }).strict().parse(req.body);
    const result = await prisma.notification.updateMany({ where: { ...scope(req), id: z.uuid().parse(req.params.id) }, data: { readAt: new Date() } });
    if (!result.count) throw new AppError(404, "Notification was not found");
    res.json({ success: true, message: "Notification marked read" });
  } catch (error) { next(error); }
});
export default router;
