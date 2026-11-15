import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    env: { MEDCRM_DB: "test", UPLOAD_DIR: path.join(os.tmpdir(), "medcrm-test-uploads") },
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
