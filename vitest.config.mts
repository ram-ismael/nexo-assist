import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // Next's guard package throws outside the React server bundler.
  "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/support/integration-env.ts"],
          globalSetup: ["tests/support/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "eval",
          include: ["tests/eval/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/support/integration-env.ts", "tests/support/eval-env.ts"],
          globalSetup: ["tests/support/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
