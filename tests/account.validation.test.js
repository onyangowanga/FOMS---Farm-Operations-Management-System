import test from "node:test";
import assert from "node:assert/strict";
import { passwordSchema, usernameSchema } from "../server/src/modules/auth/account.validation.js";

test("password policy accepts 8 characters with a letter, digit and special character", () => {
  assert.equal(passwordSchema.parse("Abcd12!x"), "Abcd12!x");
  for (const password of ["Abc1!x", "abcdefgh", "Abcdef!x", "Abcdef12", "123456!@"]) assert.equal(passwordSchema.safeParse(password).success, false, password);
  assert.equal(passwordSchema.safeParse(`Ab1!${"é".repeat(35)}`).success, false);
});
test("usernames normalize case and reject email login input", () => {
  assert.equal(usernameSchema.parse(" Farmer.One "), "farmer.one");
  assert.equal(usernameSchema.safeParse("farmer@example.test").success, false);
  assert.equal(usernameSchema.safeParse("ab").success, false);
});
