import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { errorFields, log } from "@/server/log";

export type PublicMetrics = {
  avgFirstResponseSeconds: number | null;
  /** Share of recent assistant conversations that never went to the human queue. */
  withoutHandoffPercent: number | null;
  /** null when presence could not be read: the panel omits it instead of showing 0. */
  analystsOnline: number | null;
};

const UNKNOWN: PublicMetrics = {
  avgFirstResponseSeconds: null,
  withoutHandoffPercent: null,
  analystsOnline: null,
};

const MIN_SAMPLE = 5;

/**
 * Real operational numbers for the login panel. A metric is only returned
 * when there is enough data behind it; otherwise the UI omits it instead of
 * showing an invented value.
 */
export async function publicMetrics(): Promise<PublicMetrics> {
  try {
    const result = await db().execute<{
      turns: number;
      avg_ms: number | null;
      conversations: number;
      without_handoff: number;
      online: number;
    }>(sql`
      with recent_turns as (
        select coalesce(first_token_ms, latency_ms) as ms
        from agent_turns
        where status = 'completed' and started_at > now() - interval '7 days'
      ),
      recent_conversations as (
        select c.id, exists (select 1 from handoffs h where h.conversation_id = c.id) as handed_off
        from conversations c
        where exists (
          select 1 from agent_turns t
          where t.conversation_id = c.id and t.status = 'completed' and t.started_at > now() - interval '30 days'
        )
      )
      select
        (select count(*)::int from recent_turns) as turns,
        (select avg(ms)::float from recent_turns) as avg_ms,
        (select count(*)::int from recent_conversations) as conversations,
        (select count(*)::int from recent_conversations where not handed_off) as without_handoff,
        (select count(*)::int from analyst_presence where available and last_heartbeat_at > now() - interval '2 minutes') as online
    `);
    const row = result.rows[0];
    if (!row) return UNKNOWN;
    const turns = Number(row.turns);
    const conversations = Number(row.conversations);
    return {
      avgFirstResponseSeconds:
        turns >= MIN_SAMPLE && row.avg_ms !== null
          ? Math.max(1, Math.round(Number(row.avg_ms) / 1000))
          : null,
      withoutHandoffPercent:
        conversations >= MIN_SAMPLE
          ? Math.round((Number(row.without_handoff) / conversations) * 100)
          : null,
      analystsOnline: Number(row.online),
    };
  } catch (error) {
    log("warn", "public metrics unavailable", errorFields(error));
    return UNKNOWN;
  }
}
