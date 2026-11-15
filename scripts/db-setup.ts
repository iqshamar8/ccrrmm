/**
 * Applies Prisma migrations (incl. 0002_rls policies & grants) using the
 * OWNER connection. The runtime app never uses the owner role.
 *
 *   npm run db:setup              -> migrate main database
 *   tsx scripts/db-setup.ts --reset         -> drop & recreate main database schema
 *   tsx scripts/db-setup.ts --test --reset  -> same, for the test database
 */
import "dotenv/config";
import { execSync } from "node:child_process";

const isTest = process.argv.includes("--test");
const reset = process.argv.includes("--reset");
const url = isTest ? process.env.TEST_DATABASE_URL_OWNER : process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("Owner database URL missing in .env");

const env = { ...process.env, DATABASE_URL: url };
const cmd = reset
  ? "npx prisma migrate reset --force --skip-seed --skip-generate"
  : "npx prisma migrate deploy";

console.log(`[db-setup] ${isTest ? "TEST" : "MAIN"} database: ${cmd}`);
execSync(cmd, { stdio: "inherit", env });
