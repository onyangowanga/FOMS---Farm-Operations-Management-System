import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { writeAudit } from "../../shared/audit.js";

const router = Router();
router.use(authorize("OWNER", "MANAGER", "AGRONOMIST", "WORKER"));
const boardSchema = z.object({
  headline: z.string().trim().max(300).nullish().transform((value) => value || null),
  items: z.array(z.object({ text: z.string().trim().min(1).max(200), done: z.boolean().default(false) })).max(30)
});
const view = (board) => ({
  headline: board?.headline ?? null,
  items: Array.isArray(board?.items) ? board.items : [],
  updatedAt: board?.updatedAt ?? null,
  updatedBy: board?.updater?.name ?? null
});
async function load(organizationId) {
  const board = await prisma.dailyBoard.findUnique({ where: { organizationId } });
  if (!board?.updatedBy) return board;
  const updater = await prisma.user.findUnique({ where: { id: board.updatedBy }, select: { name: true } });
  return { ...board, updater };
}

router.get("/", async (req, res, next) => {
  try { res.json({ success: true, data: view(await load(req.auth.organizationId)) }); } catch (error) { next(error); }
});
router.put("/", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const payload = boardSchema.parse(req.body);
    await prisma.$transaction(async (tx) => {
      const data = { headline: payload.headline, items: payload.items, updatedBy: req.auth.userId };
      await tx.dailyBoard.upsert({ where: { organizationId: req.auth.organizationId }, create: { organizationId: req.auth.organizationId, ...data }, update: data });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "UPDATE_BOARD", entity: "DailyBoard", entityId: req.auth.organizationId }, tx);
    });
    res.json({ success: true, message: "Today's board updated", data: view(await load(req.auth.organizationId)) });
  } catch (error) { next(error); }
});
export default router;