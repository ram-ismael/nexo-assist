import "server-only";
import { sql } from "drizzle-orm";
import { assistantStatusFrom, type AssistantStatus, type RecentTurn } from "@/domain/assistant";
import { config } from "@/lib/config";
import { db } from "@/server/db/client";
import { errorFields, log } from "@/server/log";

const CACHE_MS = 30_000;
let cached: { status: AssistantStatus; at: number } | null = null;

function configured(): boolean {
  const env = config();
  if (env.NEXO_SCRIPTED_MODEL) return true;
  return env.LLM_MODEL.startsWith("anthropic/") && !!env.ANTHROPIC_API_KEY;
}

/**
 * What the "Assistente online" pill shows: configuration plus how the latest
 * turns of the whole service actually ended. Memoized per instance for 30 s,
 * so polling clients cost one indexed query per instance and window.
 */
export async function assistantStatus(now = Date.now()): Promise<AssistantStatus> {
  if (cached && now - cached.at < CACHE_MS) return cached.status;
  let recent: RecentTurn[] = [];
  if (configured()) {
    try {
      const result = await db().execute<{ status: string; error_code: string | null }>(sql`
        select status, error_code from agent_turns
        where started_at > now() - interval '15 minutes' and status in ('completed', 'failed')
        order by started_at desc
        limit 3
      `);
      recent = result.rows.map((row) => ({
        status: row.status === "failed" ? "failed" : "completed",
        errorCode: row.error_code,
      }));
    } catch (error) {
      // Health must never break the page; without data we judge by configuration only.
      log("warn", "assistant health query failed", errorFields(error));
    }
  }
  const status = assistantStatusFrom(configured(), recent);
  cached = { status, at: now };
  return status;
}

export function resetAssistantStatusForTests(): void {
  cached = null;
}
