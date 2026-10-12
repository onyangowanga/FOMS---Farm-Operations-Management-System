import { z } from "zod";

export const usernameSchema = z.string().trim().toLowerCase().min(3).max(80)
  .regex(/^[a-z0-9_.-]+$/, "Use letters, numbers, dots, underscores or hyphens");
export const passwordSchema = z.string().min(8).max(72)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must not exceed 72 UTF-8 bytes")
  .regex(/[a-zA-Z]/, "Include at least one letter")
  .regex(/[0-9]/, "Include at least one number")
  .regex(/[^a-zA-Z0-9\s]/, "Include at least one special character");
export const accountSchema = z.object({
  name: z.string().trim().min(2).max(100),
  username: usernameSchema,
  email: z.email().trim().toLowerCase(),
  password: passwordSchema
});
