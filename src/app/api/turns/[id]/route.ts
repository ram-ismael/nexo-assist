import { asc, eq } from "drizzle-orm";
import type { DecisionDTO } from "@/lib/api-types";
import { assertCanViewConversation } from "@/server/auth/policies";
import { db } from "@/server/db/client";
import { agentActions, agentDecisions, agentTurns, conversations } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { json, route } from "@/server/http";

/**
 * Decision record of one agent turn: what it understood, what it did, how sure
 * it was and why, plus every tool execution. Employees see their own turns
 * without raw tool payloads; analysts also get inputs, outputs and usage.
 */
export const GET = route<"user", { id: string }>("user", async ({ user, params }) => {
  const rows = await db()
    .select({ turn: agentTurns, employeeId: conversations.employeeId })
    .from(agentTurns)
    .innerJoin(conversations, eq(conversations.id, agentTurns.conversationId))
    .where(eq(agentTurns.id, params.id))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("Registro");
  assertCanViewConversation(user, { employeeId: row.employeeId });
  const analyst = user.role === "analyst";
  const [decisionRows, actionRows] = await Promise.all([
    db().select().from(agentDecisions).where(eq(agentDecisions.turnId, row.turn.id)).limit(1),
    db()
      .select()
      .from(agentActions)
      .where(eq(agentActions.turnId, row.turn.id))
      .orderBy(asc(agentActions.id)),
  ]);
  const decision = decisionRows[0];
  const body: DecisionDTO = {
    turnId: row.turn.id,
    status: row.turn.status,
    model: row.turn.model,
    latencyMs: row.turn.latencyMs,
    inputTokens: analyst ? row.turn.inputTokens : null,
    outputTokens: analyst ? row.turn.outputTokens : null,
    startedAt: row.turn.startedAt.toISOString(),
    errorCode: row.turn.errorCode,
    decision: decision
      ? {
          intent: decision.intent,
          understanding: decision.understanding,
          action: decision.action,
          certainty: decision.certainty,
          reason: decision.reason,
          rules: decision.rules,
          missingInformation: decision.missingInformation,
          escalationReason: decision.escalationReason,
          source: decision.source,
        }
      : null,
    actions: actionRows.map((action) => ({
      tool: action.tool,
      label: action.label,
      status: action.status,
      summary: action.summary,
      durationMs: action.durationMs,
      input: analyst ? action.input : null,
      output: analyst ? action.output : null,
    })),
  };
  return json(body);
});
