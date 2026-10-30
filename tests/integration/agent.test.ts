import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import { runAgentTurn, submitEmployeeMessage, type StreamEvent } from "@/server/agent/turn";
import type { SessionUser } from "@/server/auth/sessions";
import { closeDb, db } from "@/server/db/client";
import { agentActions, agentDecisions, agentTurns } from "@/server/db/schema";
import { appendMessage, findConversation, pageMessages } from "@/server/conversations/repository";
import { serializeConversation } from "@/server/conversations/serialize";
import { claimConversation, recoverAbandonedTurns } from "@/server/conversations/use-cases";
import { ANA, RAFAEL, resetDatabase, sessionUser } from "../support/db";

let counter = 0;

/** Stores `count` more employee messages, as if they had been sent earlier. */
async function fillSession(conversationId: string, employeeId: string, count: number) {
  for (let index = 0; index < count; index += 1) {
    await appendMessage(db(), {
      conversationId,
      kind: "employee",
      senderId: employeeId,
      content: `mensagem ${index + 1}`,
    });
  }
}

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

  it("does not ask to choose when there is nothing or only one ticket", async () => {
    const gabriela = await sessionUser("gabriela.rocha@nexo.com.br");
    const none = await say(gabriela, "Qual o status do meu chamado?");
    const noneMessage = none.done && none.done.type === "done" ? none.done.message : null;
    expect(noneMessage?.blocks.some((block) => block.type === "ticket_selection")).toBe(false);
    expect(noneMessage?.content).toContain("não tem chamados abertos");

    const bruno = await sessionUser("bruno.tavares@nexo.com.br");
    const one = await say(bruno, "Qual o status do meu chamado?");
    const oneMessage = one.done && one.done.type === "done" ? one.done.message : null;
    expect(oneMessage?.blocks.some((block) => block.type === "ticket_selection")).toBe(false);
    const card = oneMessage?.blocks.find((block) => block.type === "ticket_card");
    expect(card && card.type === "ticket_card" ? card.ticket.number : null).toBe("INC-20501");
    const conversation = await findConversation(db(), one.conversationId);
    expect(conversation?.focusTicketId).not.toBeNull();
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

  it("enforces the 30-message session limit on the server", async () => {
    const ana = await sessionUser(ANA);
    const first = await say(ana, "Qual o status do meu chamado?");
    await fillSession(first.conversationId, ana.id, 29);
    await expect(
      submitEmployeeMessage(ana, {
        conversationId: first.conversationId,
        clientId: "client-limit-1",
        text: "mais uma",
      }),
    ).rejects.toMatchObject({ code: "limit_reached" });
    const stored = await findConversation(db(), first.conversationId);
    if (!stored) throw new Error("conversation missing");
    expect(await serializeConversation(db(), stored, 30)).toMatchObject({
      sessionMessageCount: 30,
      sessionMessageLimit: 30,
    });
  });

  it("counts messages to the analyst too, as the PRD limit is per session", async () => {
    const ana = await sessionUser(ANA);
    const handoff = await say(ana, "Quero falar com um analista.");
    await fillSession(handoff.conversationId, ana.id, 29);
    await expect(
      submitEmployeeMessage(ana, {
        conversationId: handoff.conversationId,
        clientId: "client-limit-human",
        text: "Alguém aí?",
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

  it("recovers a conversation whose turn died with its function", async () => {
    const ana = await sessionUser(ANA);
    const submitted = await submitEmployeeMessage(ana, {
      conversationId: null,
      clientId: "client-abandoned-1",
      text: "Qual o status do meu chamado?",
    });
    if (submitted.mode !== "agent") throw new Error("expected an agent turn");
    const conversationId = submitted.conversation.id;
    // The function is killed here: runAgentTurn never finishes. Age the turn.
    await db()
      .update(agentTurns)
      .set({ startedAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(agentTurns.id, submitted.turnId));

    const stuck = await findConversation(db(), conversationId);
    if (!stuck) throw new Error("conversation missing");
    expect((await serializeConversation(db(), stuck, 30)).agentBusy).toBe(false);

    expect(await recoverAbandonedTurns(conversationId)).toBe(true);
    expect(await recoverAbandonedTurns(conversationId)).toBe(false);
    const [turn] = await db().select().from(agentTurns).where(eq(agentTurns.id, submitted.turnId));
    expect(turn).toMatchObject({ status: "failed", errorCode: "abandoned" });
    const after = await findConversation(db(), conversationId);
    expect(after?.agentTurnCount).toBe(0);
    const page = await pageMessages(db(), conversationId, { limit: 10 });
    expect(page.messages.at(-1)?.content).toContain("interrompida");

    const next = await say(ana, "Qual o status do meu chamado?", conversationId);
    expect(next.done?.type).toBe("done");
  });

  it("does not deliver an answer for a turn already closed as abandoned", async () => {
    const ana = await sessionUser(ANA);
    const submitted = await submitEmployeeMessage(ana, {
      conversationId: null,
      clientId: "client-abandoned-2",
      text: "Qual o status do meu chamado?",
    });
    if (submitted.mode !== "agent") throw new Error("expected an agent turn");
    await db()
      .update(agentTurns)
      .set({ status: "failed", errorCode: "abandoned" })
      .where(eq(agentTurns.id, submitted.turnId));
    const events: StreamEvent[] = [];
    await runAgentTurn(ana, submitted, (event) => events.push(event));
    const done = events.find((event) => event.type === "done");
    expect(done && done.type === "done" ? done.discarded : null).toBe(true);
    expect(done && done.type === "done" ? done.message : "missing").toBeNull();
    const [turn] = await db().select().from(agentTurns).where(eq(agentTurns.id, submitted.turnId));
    expect(turn?.status).toBe("failed");
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

describe("abuse controls", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("stops model calls once the per-minute limit is reached", async () => {
    process.env.RATE_LIMIT_TURNS_PER_MINUTE = "2";
    resetConfigForTests();
    try {
      const ana = await sessionUser(ANA);
      const first = await say(ana, "Qual o status do meu chamado?");
      await say(ana, "INC-20311", first.conversationId);
      await expect(
        submitEmployeeMessage(ana, {
          conversationId: first.conversationId,
          clientId: "client-burst-3",
          text: "mais uma",
        }),
      ).rejects.toMatchObject({ code: "rate_limited" });
      const turns = await db()
        .select()
        .from(agentTurns)
        .where(eq(agentTurns.conversationId, first.conversationId));
      expect(turns).toHaveLength(2);
    } finally {
      process.env.RATE_LIMIT_TURNS_PER_MINUTE = "1000";
      resetConfigForTests();
    }
  });
});
