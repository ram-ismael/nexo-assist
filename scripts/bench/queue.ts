// Times the analyst queue queries (polled every 5 s per analyst) against a
// database filled by scripts/bench/volume.sql. Usage:
//   DATABASE_URL=postgresql:///nexo_assist_bench pnpm tsx scripts/bench/queue.ts
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { listQueue, queueCounts } from "@/server/conversations/queue";
import * as schema from "@/server/db/schema";

async function time(label: string, fn: () => Promise<unknown>) {
  for (let i = 0; i < 3; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `${label.padEnd(28)} p50 ${samples[10]!.toFixed(1)} ms  p95 ${samples[18]!.toFixed(1)} ms`,
  );
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const db = drizzle(pool, { schema });
  const analyst = (
    await db.execute<{ id: string }>(sql`select id from users where role='analyst' limit 1`)
  ).rows[0]!.id;
  await time("queueCounts", () => queueCounts(db, analyst));
  await time("listQueue all", () => listQueue(db, analyst, { filter: "all", query: "" }));
  await time("listQueue for_you", () => listQueue(db, analyst, { filter: "for_you", query: "" }));
  await time("listQueue all + search", () =>
    listQueue(db, analyst, { filter: "all", query: "impressora" }),
  );
  await pool.end();
}

void main();
