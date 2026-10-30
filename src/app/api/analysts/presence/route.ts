import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { analystPresence } from "@/server/db/schema";
import { json, readJson, route } from "@/server/http";

const schema = z.object({ available: z.boolean().optional() });

/** Heartbeat (every ~60 s while the console is open) and availability toggle. */
export const PUT = route("analyst", async ({ req, user }) => {
  const body = await readJson(req, schema);
  const rows = await db()
    .insert(analystPresence)
    .values({ analystId: user.id, available: body.available ?? true, lastHeartbeatAt: new Date() })
    .onConflictDoUpdate({
      target: analystPresence.analystId,
      set: {
        lastHeartbeatAt: new Date(),
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
      (select count(*)::int from analyst_presence where available and last_heartbeat_at > now() - interval '2 minutes') as online
  `);
  const row = result.rows[0];
  return json({ available: row?.available ?? true, online: Number(row?.online ?? 0) });
});
