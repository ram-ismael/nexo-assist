import { sql } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { AppError } from "@/server/errors";

type LimitRule = { key: string; limit: number; windowSeconds: number; message: string };

function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Fixed-window counter stored in Postgres, so every serverless instance shares
 * it. The upsert is a single atomic statement; counts above the limit are
 * rejected after incrementing, which is the conservative side. The first hit
 * of a window drops that key's past windows, so the table never grows.
 */
export async function consume(
  executor: Executor,
  rule: LimitRule,
  now = new Date(),
): Promise<number> {
  const start = windowStart(now, rule.windowSeconds);
  const result = await executor.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${rule.key}, ${start.toISOString()}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count
  `);
  const count = Number(result.rows[0]?.count ?? 0);
  if (count === 1) {
    await executor.execute(
      sql`delete from rate_limits where key = ${rule.key} and window_start < ${start.toISOString()}`,
    );
  }
  if (count > rule.limit) {
    throw new AppError("rate_limited", rule.message, {
      retryAfterSeconds: Math.ceil(
        (start.getTime() + rule.windowSeconds * 1000 - now.getTime()) / 1000,
      ),
    });
  }
  return count;
}
