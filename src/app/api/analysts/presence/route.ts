import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { analystPresence } from "@/server/db/schema";
import { json, readJson, route } from "@/server/http";
import { ANALYST_ONLINE_SQL } from "@/server/presence";

const schema = z.object({ available: z.boolean().optional(), leaving: z.boolean().optional() });

/**
 * Heartbeat (every ANALYST_HEARTBEAT_MS while the console is open), availability
 * toggle, and `leaving` when the console closes, so it goes offline at once
 * with the right "offline há…" time instead of after the heartbeat expires.
 */
export const PUT = route("analyst", async ({ req, user }) => {
  const body = await readJson(req, schema);
  const now = new Date();
  const rows = await db()
    .insert(analystPresence)
    .values({
      analystId: user.id,
      available: body.available ?? true,
      lastHeartbeatAt: now,
      leftAt: body.leaving ? now : null,
    })
    .onConflictDoUpdate({
      target: analystPresence.analystId,
      set: {
        lastHeartbeatAt: now,
        ...(body.leaving ? { leftAt: now } : {}),
        ...(body.available !== undefined ? { available: body.available } : {}),
      },
    })
    .returning();
  return json({ available: rows[0]?.available ?? true });
});

export const GET = route("analyst", async ({ user }) => {
  const result = await db().execute<{ available: boolean | null; online: number }>(sql`
    select
      (select available from analyst_presence where analyst_id = ${user.id}) as available,
      (select count(*)::int from analyst_presence where available and ${ANALYST_ONLINE_SQL}) as online
  `);
  const row = result.rows[0];
  return json({ available: row?.available ?? true, online: Number(row?.online ?? 0) });
});
