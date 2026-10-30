import { execSync } from "node:child_process";

/** Fresh, seeded database for every E2E run. */
export default function globalSetup(): void {
  const url =
    process.env.DATABASE_URL_E2E ?? "postgresql:///nexo_assist_e2e?host=/var/run/postgresql";
  execSync("pnpm exec tsx tests/e2e/reset-db.ts", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
