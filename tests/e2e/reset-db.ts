import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/server/db/schema";
import { seedDatabase } from "@/server/db/seed";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    await db.execute(sql`
      truncate agent_actions, agent_decisions, agent_turns, ticket_drafts, handoffs, messages,
        conversations, ticket_events, tickets, sessions, analyst_presence, audit_events,
        rate_limits, knowledge_articles, users restart identity cascade`);
    await db.execute(sql`select setval('inc_number_seq', 20520, false)`);
    await seedDatabase(db, {
      timeZone: "America/Sao_Paulo",
      dayStartHour: 8,
      dayEndHour: 18,
      workdays: [1, 2, 3, 4, 5],
      holidays: new Set(),
    });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
