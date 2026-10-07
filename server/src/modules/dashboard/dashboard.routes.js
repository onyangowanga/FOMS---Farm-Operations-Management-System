import { Router } from "express";
import { prisma } from "../../config/database.js";

const router = Router();
router.get("/", async (req, res, next) => {
  try {
    const org = req.auth.organizationId;
    const canSeeFinancials = ["OWNER", "MANAGER"].includes(req.auth.role);
    const farmWhere = { organizationId: org, deletedAt: null };
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [farms, blocks, crops, livestock, tasks, expenses, sales, payments, lowStockItems] = await Promise.all([
      prisma.farm.findMany({ where: farmWhere, select: { id: true, name: true, acreage: true, location: true }, orderBy: { createdAt: "asc" } }),
      prisma.block.count({ where: farmWhere }),
      prisma.cropCycle.findMany({ where: farmWhere, select: { id: true, cropName: true, status: true, acreage: true, expectedHarvest: true }, orderBy: { createdAt: "desc" }, take: 5 }),
      prisma.livestock.groupBy({ by: ["species"], where: farmWhere, _sum: { quantity: true }, _count: { id: true } }),
      prisma.task.groupBy({ by: ["status"], where: farmWhere, _count: { id: true } }),
      canSeeFinancials
        ? prisma.expense.aggregate({ where: { ...farmWhere, expenseDate: { gte: monthStart } }, _sum: { amount: true } })
        : Promise.resolve({ _sum: { amount: null } }),
      canSeeFinancials
        ? prisma.sale.aggregate({ where: { ...farmWhere, soldAt: { gte: monthStart } }, _sum: { totalAmount: true }, _count: { id: true } })
        : Promise.resolve({ _sum: { totalAmount: null }, _count: { id: 0 } }),
      canSeeFinancials
        ? prisma.payment.aggregate({ where: { organizationId: org, receivedAt: { gte: monthStart } }, _sum: { amount: true } })
        : Promise.resolve({ _sum: { amount: null } }),
      prisma.inventoryItem.findMany({
        where: { organizationId: org, deletedAt: null },
        select: { quantity: true, reorderLevel: true }
      })
    ]);
    const taskCounts = Object.fromEntries(tasks.map((item) => [item.status.toLowerCase(), item._count.id]));
    res.json({
      success: true,
      data: {
        farmCount: farms.length,
        totalAcreage: farms.reduce((sum, farm) => sum + (farm.acreage || 0), 0),
        blockCount: blocks,
        crops,
        livestock: Object.fromEntries(livestock.map((item) => [item.species.toLowerCase(), item._sum.quantity || 0])),
        tasks: { pending: taskCounts.pending || 0, inProgress: taskCounts.in_progress || 0, completed: taskCounts.completed || 0, approved: taskCounts.approved || 0 },
        monthlyExpenses: expenses._sum.amount || 0,
        monthlyRevenue: Number(sales._sum.totalAmount || 0),
        monthlyCollected: Number(payments._sum.amount || 0),
        monthlyProfit: canSeeFinancials ? Number((Number(sales._sum.totalAmount || 0) - Number(expenses._sum.amount || 0)).toFixed(2)) : null,
        monthlySalesCount: sales._count.id,
        lowStockItems: lowStockItems.filter((item) => item.quantity <= item.reorderLevel).length,
        farms
      }
    });
  } catch (error) { next(error); }
});
export default router;
