import { prisma } from "../server/src/config/database.js";
import { base } from "./helpers.js";

export const query = "period=DAILY&date=2026-01-15";
export const inside = new Date("2026-01-14T21:00:00.000Z");
export const outside = new Date("2026-01-15T21:00:00.000Z");
export async function reportingFixture(owner) {
  const farm = await prisma.farm.create({ data: { organizationId: owner.organizationId, name: "Report farm" } });
  const crop = await prisma.cropCycle.create({ data: { organizationId: owner.organizationId, farmId: farm.id, cropName: "Report onions", status: "GROWING", acreage: 2 } });
  await prisma.cropStage.create({ data: { cropId: crop.id, stage: "GROWING", occurredAt: inside } });
  await prisma.cropActivity.createMany({ data: [
    { cropId: crop.id, type: "OTHER", customActivity: "Hand weeding", quantity: 2.5, unit: "OTHER", customUnit: "hours", occurredAt: inside },
    { cropId: crop.id, type: "OTHER", customActivity: "Outside period", quantity: 1, unit: "hours", occurredAt: outside }
  ] });
  await prisma.journalEntry.create({ data: { organizationId: owner.organizationId, farmId: farm.id, cropId: crop.id, subjectType: "CROP", title: "Crop issue", body: "Aphids observed", category: "PEST_DISEASE", incidentStatus: "OPEN", incidentSeverity: "HIGH", cost: 9876, observedAt: inside } });
  await prisma.journalEntry.create({ data: { organizationId: owner.organizationId, farmId: farm.id, subjectType: "GENERAL", title: "Private general report", body: "Non-crop report", observedAt: inside } });
  const livestock = await prisma.livestock.create({ data: { organizationId: owner.organizationId, farmId: farm.id, species: "POULTRY", identifier: "Report birds", quantity: 10, initialQuantity: 10, trackingMode: "BATCH" } });
  await prisma.livestockEvent.create({ data: { livestockId: livestock.id, type: "EGG_PRODUCTION", quantity: 7, occurredAt: inside, recordedBy: owner.user.id } });
  const task = await prisma.task.create({ data: { organizationId: owner.organizationId, farmId: farm.id, title: "Report task", status: "COMPLETED", assignedTo: owner.user.id } });
  await prisma.taskEvent.create({ data: { taskId: task.id, action: "COMPLETE", toStatus: "COMPLETED", recordedBy: owner.user.id, createdAt: inside } });
  return { farm, crop, livestock };
}
export async function binary(path, cookie = "") {
  const response = await fetch(`${base}/api/v1/reporting/${path}`, { headers: { Cookie: cookie } });
  return { status: response.status, headers: response.headers, content: Buffer.from(await response.arrayBuffer()) };
}
