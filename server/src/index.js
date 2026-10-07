import "dotenv/config";
import app from "./app.js";
import { prisma } from "./config/database.js";

const required = ["DATABASE_URL", "JWT_ACCESS_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.JWT_ACCESS_SECRET.length < 32) {
  console.error("JWT_ACCESS_SECRET must contain at least 32 characters");
  process.exit(1);
}

const port = Number.parseInt(process.env.PORT || "3000", 10);
const server = app.listen(port, () => console.log(`FOMS listening on port ${port}`));

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
