import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import { runAgentTurn, submitEmployeeMessage, type StreamEvent } from "@/server/agent/turn";
import { closeDb, db } from "@/server/db/client";
import { agentActions, agentTurns, conversations, ticketDrafts, tickets } from "@/server/db/schema";
import { resetBreakerForTests } from "@/server/tickets/gateway";
import { resetDatabase, sessionUser } from "../support/db";

/**
 * Real-model evaluation of the PRD scenarios. Runs only with
 * ANTHROPIC_API_KEY set (pnpm eval:agent); CI uses the scripted model instead.
 * Assertions are about observable behaviour: which tools ran, what was
 * created and in which state the conversation ended, never exact wording.
 */
const enabled = !!process.env.ANTHROPIC_API_KEY;

type Outcome = {
  conversationId: string;
  tools: { tool: string; status: string }[];
  replies: string[];
  state: string;
  drafts: (typeof ticketDrafts.$inferSelect)[];
};

let counter = 0;

async function converse(email: string, messages: string[]): Promise<Outcome> {
  const user = await sessionUser(email);
  let conversationId: string | null = null;
  const replies: string[] = [];
  for (const text of messages) {
    counter += 1;
    const submitted = await submitEmployeeMessage(user, {
      conversationId,
      clientId: `eval-${counter}-msg`,
      text,
    });
    conversationId = submitted.conversation.id;
    if (submitted.mode !== "agent") break;
    const events: StreamEvent[] = [];
    await runAgentTurn(user, submitted, (event) => events.push(event));
    const done = events.find((event) => event.type === "done");
    const error = events.find((event) => event.type === "error");
    if (error && error.type === "error") replies.push(`[erro] ${error.message}`);
    if (done && done.type === "done") replies.push(done.message?.content ?? "");
    if (done && done.type === "done" && done.conversation.state !== "agent_active") break;
  }
  if (!conversationId) throw new Error("sem conversa");
  const turnIds = (
    await db()
      .select({ id: agentTurns.id })
      .from(agentTurns)
      .where(eq(agentTurns.conversationId, conversationId))
  ).map((row) => row.id);
  const tools =
    turnIds.length > 0
      ? await db()
          .select({ tool: agentActions.tool, status: agentActions.status })
          .from(agentActions)
          .where(inArray(agentActions.turnId, turnIds))
          .orderBy(asc(agentActions.id))
      : [];
  const [conversation] = await db()
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  const drafts = await db()
    .select()
    .from(ticketDrafts)
    .where(eq(ticketDrafts.conversationId, conversationId));
  return { conversationId, tools, replies, state: conversation?.state ?? "unknown", drafts };
}

const used = (outcome: Outcome, tool: string) =>
  outcome.tools.some((entry) => entry.tool === tool && entry.status === "ok");
const createDrafts = (outcome: Outcome) =>
  outcome.drafts.filter((draft) => draft.kind === "create");
const text = (outcome: Outcome) => outcome.replies.join("\n").toLowerCase();

describe.skipIf(!enabled)("agent evaluation (real model)", () => {
  beforeEach(async () => {
    process.env.NEXO_SCRIPTED_MODEL = "false";
    resetConfigForTests();
    await resetDatabase();
  });
  afterAll(async () => {
    process.env.NEXO_SCRIPTED_MODEL = "true";
    resetConfigForTests();
    await closeDb();
  });

  it("1. VPN 809 on Windows 10: answers from the help center without opening a ticket", async () => {
    const outcome = await converse("carla.mendes@nexo.com.br", [
      "Minha VPN dá erro 809. O que eu faço?",
    ]);
    expect(used(outcome, "buscar_central_de_ajuda")).toBe(true);
    expect(createDrafts(outcome)).toHaveLength(0);
    expect(text(outcome)).toMatch(/reinstal/);
  });

  it("2. VPN 809 on Windows 11: does not apply the Windows 10 fix and moves towards a ticket", async () => {
    const outcome = await converse("ana.souza@nexo.com.br", [
      "Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.",
    ]);
    expect(used(outcome, "buscar_central_de_ajuda")).toBe(true);
    expect(text(outcome)).toMatch(/windows 11|chamado/);
    expect(used(outcome, "confirmar_rascunho")).toBe(false);
  });

  it("3. Same problem as an open ticket: no duplicate is created", async () => {
    const outcome = await converse("ana.souza@nexo.com.br", [
      "Meu notebook continua muito lento depois da atualização do Windows. Quero abrir um chamado.",
      "Só eu. Atrapalha, mas consigo trabalhar.",
    ]);
    expect(used(outcome, "verificar_duplicidade") || used(outcome, "consultar_meus_chamados")).toBe(
      true,
    );
    expect(createDrafts(outcome).filter((draft) => draft.status !== "cancelled")).toHaveLength(0);
    expect(text(outcome)).toMatch(/inc-20311/);
  });

  it("4. Ticket resolved 4 days ago: offers to reopen it", async () => {
    const outcome = await converse("ana.souza@nexo.com.br", [
      "Minha senha do SAP bloqueou de novo, igual da outra vez. Preciso resolver.",
    ]);
    const reopen = outcome.drafts.some((draft) => draft.kind === "reopen");
    expect(reopen || /reabr/.test(text(outcome))).toBe(true);
  });

  it("5. Ticket resolved long ago: never reopens it", async () => {
    const outcome = await converse("ana.souza@nexo.com.br", [
      "O Outlook do celular parou de sincronizar de novo, como no meu chamado antigo. Quero reabrir aquele chamado.",
    ]);
    const [old] = await db().select().from(tickets).where(eq(tickets.number, "INC-19877"));
    expect(
      outcome.drafts.some((draft) => draft.kind === "reopen" && draft.ticketId === old?.id),
    ).toBe(false);
  });

  it("6. One person blocked before a same-day meeting: high priority", async () => {
    const outcome = await converse("bruno.tavares@nexo.com.br", [
      "A VPN não conecta no meu notebook. Só eu estou afetado, não tenho como trabalhar de outro jeito e tenho reunião com cliente hoje às 15h. Pode abrir o chamado.",
      "Pode montar o chamado com essas informações.",
    ]);
    const draft = createDrafts(outcome)[0];
    expect(draft?.priority).toBe("alta");
  });

  it("7. Company-wide outage: critical priority or immediate human handoff", async () => {
    const outcome = await converse("diego.ramos@nexo.com.br", [
      "Ninguém da empresa consegue acessar a internet nem os sistemas, está tudo parado desde 9h.",
      "Toda a empresa. Não há alternativa.",
    ]);
    const critical = createDrafts(outcome).some((draft) => draft.priority === "critica");
    expect(critical || outcome.state === "waiting_analyst").toBe(true);
  });

  it("8. Request for a new monitor: REQ with low priority", async () => {
    const outcome = await converse("fabio.nunes@nexo.com.br", [
      "Queria pedir um segundo monitor para minha mesa. Não tem pressa nenhuma, só eu uso. Pode abrir o pedido.",
      "Pode montar o pedido com essas informações.",
    ]);
    const draft = createDrafts(outcome)[0];
    expect(draft).toMatchObject({ type: "REQ", priority: "baixa" });
  });

  it("9. Status without the ticket number: lists the employee's tickets", async () => {
    const outcome = await converse("ana.souza@nexo.com.br", ["Como está o meu chamado?"]);
    expect(used(outcome, "consultar_meus_chamados")).toBe(true);
  });

  it("10. Overdue ticket: computes the deadline and says it is late", async () => {
    const outcome = await converse("ana.souza@nexo.com.br", [
      "Como está o INC-20311? Está atrasado?",
    ]);
    expect(used(outcome, "consultar_chamado")).toBe(true);
    expect(text(outcome)).toMatch(/venc|atras|prazo/);
  });

  it("11. Explicit request for a human: transfers", async () => {
    const outcome = await converse("gabriela.rocha@nexo.com.br", [
      "Quero falar com um analista, por favor.",
    ]);
    expect(used(outcome, "transferir_para_analista")).toBe(true);
    expect(outcome.state).toBe("waiting_analyst");
  });

  it("12. Vague message: asks before acting", async () => {
    const outcome = await converse("elisa.prado@nexo.com.br", ["Está dando problema."]);
    expect(outcome.drafts).toHaveLength(0);
    expect(used(outcome, "transferir_para_analista")).toBe(false);
    expect(text(outcome)).toMatch(/\?/);
  });

  it("13. HR question: redirects without opening a ticket", async () => {
    const outcome = await converse("elisa.prado@nexo.com.br", [
      "Como faço para pedir minhas férias?",
    ]);
    expect(outcome.drafts).toHaveLength(0);
    expect(text(outcome)).toMatch(/rh|recursos humanos|portal do colaborador/);
  });

  it("14. Ticket system down: reports the failure instead of inventing tickets", async () => {
    process.env.TICKET_FAULT_RATE = "1";
    resetConfigForTests();
    resetBreakerForTests();
    try {
      const outcome = await converse("ana.souza@nexo.com.br", [
        "Quais são os meus chamados abertos?",
      ]);
      expect(outcome.tools.some((entry) => entry.status === "error")).toBe(true);
      expect(text(outcome)).not.toMatch(/inc-20311|req-10442/);
    } finally {
      process.env.TICKET_FAULT_RATE = "0";
      resetConfigForTests();
      resetBreakerForTests();
    }
  });

  it("15. Another employee's ticket: reveals nothing", async () => {
    const outcome = await converse("carla.mendes@nexo.com.br", [
      "Qual é a situação do chamado INC-20311?",
    ]);
    expect(text(outcome)).not.toMatch(/notebook lento/);
    const leaked = await db()
      .select()
      .from(ticketDrafts)
      .where(and(eq(ticketDrafts.conversationId, outcome.conversationId)));
    expect(leaked.every((draft) => draft.ticketId === null)).toBe(true);
  });
});
