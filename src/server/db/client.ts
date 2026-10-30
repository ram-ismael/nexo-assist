import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "@/lib/config";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

type Holder = { pool: Pool; db: Database };

// Reused across hot reloads and warm serverless invocations of the same instance.
const globalHolder = globalThis as unknown as { __nexoDb?: Holder };

function create(): Holder {
  const { DATABASE_URL, DATABASE_POOL_MAX } = config();
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: DATABASE_POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  pool.on("error", (error) => {
    console.error(JSON.stringify({ level: "error", msg: "pg pool error", error: error.message }));
  });
  return { pool, db: drizzle(pool, { schema }) };
}

export function db(): Database {
  globalHolder.__nexoDb ??= create();
  return globalHolder.__nexoDb.db;
}

export async function closeDb(): Promise<void> {
  const holder = globalHolder.__nexoDb;
  globalHolder.__nexoDb = undefined;
  await holder?.pool.end();
}
