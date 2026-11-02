import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/server/db/schema";
import { clearBusinessData } from "@/server/db/reset";
import { seedDatabase } from "@/server/db/seed";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    await clearBusinessData(db);
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
