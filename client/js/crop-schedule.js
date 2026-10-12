export function addDays(start, days) {
  if (!start || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 3650) return "";
  const value = new Date(`${start}T00:00:00Z`);
  if (!Number.isFinite(value.getTime())) return "";
  value.setUTCDate(value.getUTCDate() + Number(days));
  return value.toISOString().slice(0, 10);
}

export function suggestCropSchedule(values) {
  const nursery = values.requiresNursery === true || values.requiresNursery === "true";
  const transplant = nursery ? addDays(values.nurseryDate, values.nurseryDays) : "";
  const fieldStart = values.transplantDate || values.plantingDate || transplant;
  return { transplant, harvest: addDays(fieldStart, values.yieldingDays) };
}
