import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

const BUSINESS_TABLES = [
  "agent_actions",
  "agent_decisions",
  "agent_turns",
  "ticket_drafts",
  "handoffs",
  "messages",
  "conversations",
  "ticket_events",
  "tickets",
  "sessions",
  "analyst_presence",
  "audit_events",
  "rate_limits",
  "knowledge_articles",
  "users",
];

/**
 * Empties every business table and rewinds the public numbers (INC/REQ/draft
 * codes) to where the seed expects them. Destructive by design: used by the
 * test suites and by the explicit demo reset (`pnpm db:reset-demo`), never by
 * the application.
 */
export async function clearBusinessData(executor: NodePgDatabase<typeof schema>): Promise<void> {
  await executor.execute(
    sql.raw(`truncate ${BUSINESS_TABLES.join(", ")} restart identity cascade`),
  );
  await executor.execute(sql`select setval('inc_number_seq', 20520, false)`);
  await executor.execute(sql`select setval('req_number_seq', 10460, false)`);
  await executor.execute(sql`select setval('draft_code_seq', 300, false)`);
}
