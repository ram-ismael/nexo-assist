import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { parseHolidays } from "@/domain/sla";
import * as schema from "@/server/db/schema";
import { seedDatabase } from "@/server/db/seed";
import { seedConversations } from "@/server/db/seed-conversations";
import { clearBusinessData } from "@/server/db/reset";

/**
 * `--reset` (pnpm db:reset-demo) first erases every business table, so the
 * demo starts over with ages relative to today. It refuses to run unless
 * CONFIRM_RESET_DEMO names the database being erased.
 */
const RESET = process.argv.includes("--reset");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    if (RESET) {
      const database = new URL(url).hostname || "localhost";
      if (process.env.CONFIRM_RESET_DEMO !== database) {
        throw new Error(
          `--reset apaga todos os dados de ${database}. Para confirmar: CONFIRM_RESET_DEMO=${database}`,
        );
      }
      await clearBusinessData(db);
      console.log(`Dados de ${database} apagados.`);
    }
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
