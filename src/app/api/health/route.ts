import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/server/db/client";

/** Liveness plus dependency status. Reports configuration presence, never values. */
export async function GET(): Promise<Response> {
  const started = Date.now();
  let database: "ok" | "error" = "ok";
  try {
    await db().execute(sql`select 1`);
  } catch {
    database = "error";
  }
  const env = config();
  const llm = env.NEXO_SCRIPTED_MODEL
    ? "scripted-test"
    : env.ANTHROPIC_API_KEY
      ? "configured"
      : "missing";
  const status = database === "ok" ? 200 : 503;
  return NextResponse.json(
    {
      status: status === 200 ? "ok" : "degraded",
      database,
      llm,
      model: env.LLM_MODEL,
      ms: Date.now() - started,
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}
