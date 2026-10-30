import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import { runAgentTurn, submitEmployeeMessage, type StreamEvent } from "@/server/agent/turn";
import type { SessionUser } from "@/server/auth/sessions";
import { closeDb, db } from "@/server/db/client";
import { agentActions, agentDecisions, conversations } from "@/server/db/schema";
import { findConversation } from "@/server/conversations/repository";
import { claimConversation } from "@/server/conversations/use-cases";
import { ANA, RAFAEL, resetDatabase, sessionUser } from "../support/db";

let counter = 0;

async function say(user: SessionUser, text: string, conversationId: string | null = null) {
  counter += 1;
  const submitted = await submitEmployeeMessage(user, {
    conversationId,
    clientId: `client-${counter}-test`,
    text,
  });
  const events: StreamEvent[] = [];
  if (submitted.mode === "agent")
    await runAgentTurn(user, submitted, (event) => events.push(event));
  const done = events.find((event) => event.type === "done");
  const error = events.find((event) => event.type === "error");
  const conversationId_ =
    submitted.mode === "agent" ? submitted.conversation.id : submitted.conversation.id;
  return { submitted, events, done, error, conversationId: conversationId_ };
}

describe("agent turns (scripted model, real tools and database)", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("lists only the employee's own open tickets and records the action and decision", async () => {
    const ana = await sessionUser(ANA);
    const result = await say(ana, "Qual o status do meu chamado?");
    expect(result.done?.type).toBe("done");
    const message = result.done && result.done.type === "done" ? result.done.message : null;
    const selection = message?.blocks.find((block) => block.type === "ticket_selection");
    expect(
      selection && selection.type === "ticket_selection"
        ? selection.tickets.map((ticket) => ticket.number).sort()
        : [],
    ).toEqual(["INC-20298", "INC-20311", "REQ-10442"]);
    expect(message?.actions.map((action) => action.label)).toEqual(["consultou seus chamados"]);
    const decision = await db()
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.conversationId, result.conversationId));
    expect(decision[0]).toMatchObject({ intent: "consulta_de_chamado", source: "agent" });
  });

  it("detects the overdue SLA from stored timestamps", async () => {
    const ana = await sessionUser(ANA);
    const first = await say(ana, "INC-20311");
    const message = first.done && first.done.type === "done" ? first.done.message : null;
    const card = message?.blocks.find((block) => block.type === "ticket_card");
    expect(card && card.type === "ticket_card" ? card.ticket.overdue : null).toBe(true);
    expect(message?.content).toContain("vencido");
  });

  it("transfers on request and stops answering while a person owns the conversation", async () => {
    const ana = await sessionUser(ANA);
    const handoff = await say(ana, "Quero falar com um analista.");
    expect(
      handoff.done && handoff.done.type === "done" ? handoff.done.conversation.state : null,
    ).toBe("waiting_analyst");
    const followUp = await say(ana, "Está parado há 5 dias.", handoff.conversationId);
    expect(followUp.submitted.mode).toBe("human");
    const rafael = await sessionUser(RAFAEL);
    await claimConversation(rafael, handoff.conversationId);
    const during = await say(ana, "Posso sim, está ligado.", handoff.conversationId);
    expect(during.submitted.mode).toBe("human");
  });

  it("denies mutating tools once an analyst has taken over", async () => {
    const ana = await sessionUser(ANA);
    const opened = await say(ana, "Qual o status do meu chamado?");
    const rafael = await sessionUser(RAFAEL);
    // Analyst takes over between submission and execution of the next turn.
    counter += 1;
    const submitted = await submitEmployeeMessage(ana, {
      conversationId: opened.conversationId,
      clientId: `client-${counter}-race`,
      text: "Quero falar com um analista.",
    });
    expect(submitted.mode).toBe("agent");
    await claimConversation(rafael, opened.conversationId);
    const events: StreamEvent[] = [];
    if (submitted.mode === "agent")
      await runAgentTurn(ana, submitted, (event) => events.push(event));
    const actions = await db()
      .select()
      .from(agentActions)
      .where(eq(agentActions.tool, "transferir_para_analista"));
    expect(actions[0]?.status).toBe("denied");
    const done = events.find((event) => event.type === "done");
    expect(done && done.type === "done" ? done.discarded : null).toBe(true);
    expect((await findConversation(db(), opened.conversationId))?.state).toBe("analyst_active");
  });

  it("enforces the per-session message limit on the server", async () => {
    const ana = await sessionUser(ANA);
    const first = await say(ana, "Qual o status do meu chamado?");
    await db()
      .update(conversations)
      .set({ agentTurnCount: 30 })
      .where(eq(conversations.id, first.conversationId));
    await expect(
      submitEmployeeMessage(ana, {
        conversationId: first.conversationId,
        clientId: "client-limit-1",
        text: "mais uma",
      }),
    ).rejects.toMatchObject({ code: "limit_reached" });
  });

  it("is idempotent on the client message id", async () => {
    const ana = await sessionUser(ANA);
    const first = await say(ana, "Qual o status do meu chamado?");
    const again = await submitEmployeeMessage(ana, {
      conversationId: first.conversationId,
      clientId: `client-${counter}-test`,
      text: "Qual o status do meu chamado?",
    });
    expect(again.mode).toBe("duplicate");
  });

  it("reports provider unavailability truthfully and does not consume the session quota", async () => {
    process.env.NEXO_SCRIPTED_MODEL = "false";
    process.env.ANTHROPIC_API_KEY = "";
    resetConfigForTests();
    try {
      const ana = await sessionUser(ANA);
      const result = await say(ana, "Minha VPN não conecta");
      expect(result.error).toMatchObject({ type: "error", code: "unavailable" });
      expect(result.done).toBeUndefined();
      const conversation = await findConversation(db(), result.conversationId);
      expect(conversation?.agentTurnCount).toBe(0);
      const notice = result.error && result.error.type === "error" ? result.error.notice : null;
      expect(notice?.kind).toBe("system");
    } finally {
      process.env.NEXO_SCRIPTED_MODEL = "true";
      resetConfigForTests();
    }
  });
});
