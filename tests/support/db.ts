import { eq, sql } from "drizzle-orm";
import { resetConfigForTests } from "@/lib/config";
import type { SessionUser } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { seedDatabase } from "@/server/db/seed";
import { resetBreakerForTests } from "@/server/tickets/gateway";

const TABLES = [
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

export const calendar = {
  timeZone: "America/Sao_Paulo",
  dayStartHour: 8,
  dayEndHour: 18,
  workdays: [1, 2, 3, 4, 5],
  holidays: new Set<string>(),
};

export async function resetDatabase(): Promise<void> {
  resetConfigForTests();
  resetBreakerForTests();
  await db().execute(sql.raw(`truncate ${TABLES.join(", ")} restart identity cascade`));
  await db().execute(sql`select setval('inc_number_seq', 20520, false)`);
  await db().execute(sql`select setval('req_number_seq', 10460, false)`);
  await seedDatabase(db(), calendar);
}

export async function sessionUser(email: string): Promise<SessionUser> {
  const rows = await db().select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user) throw new Error(`usuário de teste ${email} não existe`);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    department: user.department,
    supportLevel: user.supportLevel,
    deviceOs: user.deviceOs,
    sessionId: "test-session",
  };
}

export const ANA = "ana.souza@nexo.com.br";
export const CARLA = "carla.mendes@nexo.com.br";
export const RAFAEL = "rafael.lima@nexo.com.br";
export const MARINA = "marina.costa@nexo.com.br";
