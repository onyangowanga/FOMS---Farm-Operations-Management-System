import test from "node:test";
import assert from "node:assert/strict";
import { farmSchema, blockSchema, validateCoordinates } from "../server/src/modules/resources/structure.validation.js";

test("GPS supports southern and western hemispheres and zero", () => {
  for (const [latitude, longitude] of [[-1.2921, 36.8219], [-90, -180], [90, 180], [0, 0]]) {
    const farm = farmSchema.parse({ name: "Test farm", latitude, longitude });
    validateCoordinates(farm);
    assert.equal(farm.latitude, latitude);
    assert.equal(farm.longitude, longitude);
  }
});

test("GPS rejects out-of-range, non-finite and nonnumeric coordinates", () => {
  for (const latitude of [-91, 91, Infinity, NaN, ""]) {
    assert.throws(() => farmSchema.parse({ name: "Test farm", latitude, longitude: 0 }));
  }
  for (const longitude of [-181, 181, Infinity, "36"]) {
    assert.throws(() => blockSchema.parse({ farmId: "f9f9f9f9-aaaa-4aaa-8aaa-f9f9f9f9f9f9", name: "A", latitude: 0, longitude }));
  }
});

test("GPS requires a complete pair and can be cleared", () => {
  assert.throws(() => validateCoordinates({ latitude: -1 }));
  assert.throws(() => validateCoordinates({ longitude: 36 }));
  assert.throws(() => validateCoordinates({ latitude: null, longitude: 36 }));
  validateCoordinates({});
  validateCoordinates({ latitude: null, longitude: null });
  validateCoordinates({ latitude: -1, longitude: 36, name: "Existing farm" });
});

test("structure schemas reject malformed farms, blocks and unexpected fields", () => {
  assert.throws(() => farmSchema.parse({ name: " ", acreage: 2 }));
  assert.throws(() => farmSchema.parse({ name: "Farm", acreage: -1 }));
  assert.throws(() => farmSchema.parse({ name: "Farm", organizationId: "override" }));
  assert.throws(() => blockSchema.parse({ name: "A", farmId: "invalid" }));
  assert.equal(farmSchema.partial().parse({ latitude: -1 }).latitude, -1);
});
