import { z } from "zod";

const text = z.string().trim().max(2000).nullable().optional();
const acreage = z.number().finite().nonnegative().nullable().optional();
const coordinates = {
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional()
};

export const farmSchema = z.object({
  name: z.string().trim().min(2).max(120),
  location: text,
  acreage,
  description: text,
  ...coordinates
}).strict();

export const blockSchema = z.object({
  farmId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  acreage,
  currentUse: text,
  soilType: text,
  ...coordinates
}).strict();

export function validateCoordinates(record) {
  const schema = z.object(coordinates).refine(
    (value) => (value.latitude == null) === (value.longitude == null),
    { message: "Provide both latitude and longitude, or clear both", path: ["longitude"] }
  );
  schema.parse(record);
}
