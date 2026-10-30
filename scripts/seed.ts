import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { parseHolidays } from "@/domain/sla";
import * as schema from "@/server/db/schema";
import { seedDatabase } from "@/server/db/seed";
import { seedConversations } from "@/server/db/seed-conversations";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    const calendar = {
      timeZone: process.env.BUSINESS_TIMEZONE ?? "America/Sao_Paulo",
      dayStartHour: Number(process.env.BUSINESS_DAY_START ?? 8),
      dayEndHour: Number(process.env.BUSINESS_DAY_END ?? 18),
      workdays: [1, 2, 3, 4, 5],
      holidays: parseHolidays(process.env.BUSINESS_HOLIDAYS),
    };
    const result = await seedDatabase(db, calendar);
    // Demo history in one transaction: all of it or none. Skipped per
    // employee once they have any conversation, so real use is never touched.
    const conversations = await db.transaction((tx) => seedConversations(tx, calendar));
    console.log(
      `Seed concluído: ${result.users} usuários, ${result.tickets} chamados novos, ${result.articles} artigos, ${conversations} conversas de demonstração novas.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
