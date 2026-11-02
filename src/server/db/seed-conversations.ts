import { eq, sql } from "drizzle-orm";
import type { BusinessCalendar } from "@/domain/sla";
import { untilLabel } from "@/lib/format";
import { performHandoff, type HandoffReason } from "@/server/conversations/handoff";
import {
  appendMessage,
  transitionConversation,
  type ConversationRow,
} from "@/server/conversations/repository";
import type { Executor } from "@/server/db/client";
import type { Intent } from "@/server/agent/turn-context";
import { DEMO_SEED_MODEL } from "@/server/db/demo";
import * as schema from "@/server/db/schema";
import type { MessageBlock } from "@/server/messages/blocks";
import { confirmationText, confirmDraft, createTicketDraft } from "@/server/tickets/drafts";
import { TicketService, ticketSnapshot, type TicketRow } from "@/server/tickets/service";

type Action = { tool: string; label: string; summary: string; visible?: boolean };
type Decision = {
  intent: Intent;
  understanding: string;
  action: string;
  certainty: "alta" | "media" | "baixa";
  reason: string;
  rules?: string[];
  missingInformation?: string[];
  escalationReason?: string;
};

/**
 * Writes conversations the way the product itself would have: every agent
 * answer belongs to a turn with its tool actions and decision, cards are
 * snapshots of the real seeded tickets, transfers go through performHandoff
 * (handoff row + ticket event), timestamps are backdated from `now`.
 */
class Story {
  constructor(
    private readonly db: Executor,
    private readonly calendar: BusinessCalendar,
    private readonly now: Date,
    readonly conversation: ConversationRow,
    private readonly employeeId: string,
  ) {}

  /** Minutes before `now`: a smaller number is later, so a story counts down. */
  at(minutesAgo: number): Date {
    return new Date(this.now.getTime() - minutesAgo * 60_000);
  }

  async employee(minutesAgo: number, content: string) {
    const message = await appendMessage(
      this.db,
      {
        conversationId: this.conversation.id,
        kind: "employee",
        senderId: this.employeeId,
        content,
      },
      this.at(minutesAgo),
    );
    // Writing means the chat was open: everything before is read, and this is
    // when the employee was last seen.
    await this.db
      .update(schema.conversations)
      .set({ employeeReadSeq: message.seq, employeeSeenAt: this.at(minutesAgo) })
      .where(eq(schema.conversations.id, this.conversation.id));
    return message;
  }

  async analyst(minutesAgo: number, analystId: string, content: string) {
    return appendMessage(
      this.db,
      { conversationId: this.conversation.id, kind: "analyst", senderId: analystId, content },
      this.at(minutesAgo),
    );
  }

  async system(minutesAgo: number, senderId: string | null, content: string) {
    return appendMessage(
      this.db,
      { conversationId: this.conversation.id, kind: "system", senderId, content },
      this.at(minutesAgo),
    );
  }

  /** One agent turn answering the employee message with `userSeq`. */
  async agent(
    minutesAgo: number,
    userSeq: number,
    input: {
      actions: Action[];
      decision: Decision;
      /** A function when the answer depends on what a tool did (the transfer deadline). */
      text: string | (() => string);
      blocks?: MessageBlock[];
      beforeAnswer?: (turnId: string) => Promise<void>;
    },
  ) {
    const startedAt = this.at(minutesAgo + 0.2);
    const finishedAt = this.at(minutesAgo);
    const [turn] = await this.db
      .insert(schema.agentTurns)
      .values({
        conversationId: this.conversation.id,
        userMessageSeq: userSeq,
        status: "completed",
        model: DEMO_SEED_MODEL,
        startedAt,
        finishedAt,
      })
      .returning({ id: schema.agentTurns.id });
    if (!turn) throw new Error("Seed: turno não criado");
    const actions = [
      ...input.actions,
      {
        tool: "registrar_decisao",
        label: "registrou a decisão",
        summary: `${input.decision.intent} · segurança ${input.decision.certainty}`,
        visible: false,
      },
    ];
    for (const action of actions) {
      await this.db.insert(schema.agentActions).values({
        turnId: turn.id,
        tool: action.tool,
        label: action.label,
        status: "ok",
        visible: action.visible ?? true,
        summary: action.summary,
        durationMs: 0,
        createdAt: startedAt,
      });
    }
    await this.db.insert(schema.agentDecisions).values({
      turnId: turn.id,
      conversationId: this.conversation.id,
      intent: input.decision.intent,
      understanding: input.decision.understanding,
      action: input.decision.action,
      certainty: input.decision.certainty,
      reason: input.decision.reason,
      rules: input.decision.rules ?? [],
      missingInformation: input.decision.missingInformation ?? [],
      escalationReason: input.decision.escalationReason ?? null,
      source: "agent",
      createdAt: finishedAt,
    });
    await this.db
      .update(schema.conversations)
      .set({ agentTurnCount: sql`${schema.conversations.agentTurnCount} + 1` })
      .where(eq(schema.conversations.id, this.conversation.id));
    // Tools that write (the transfer) run inside the turn, before the answer.
    await input.beforeAnswer?.(turn.id);
    return appendMessage(
      this.db,
      {
        conversationId: this.conversation.id,
        kind: "agent",
        senderId: null,
        content: typeof input.text === "function" ? input.text() : input.text,
        blocks: input.blocks ?? [],
        turnId: turn.id,
      },
      finishedAt,
    );
  }

  async handoff(
    minutesAgo: number,
    input: {
      origin: "agent" | "employee";
      reason: HandoffReason;
      summary: string;
      ticket: TicketRow | null;
    },
  ) {
    const fresh = await this.fresh();
    const service = new TicketService(this.db, this.calendar);
    return performHandoff(
      this.db,
      service,
      this.calendar,
      {
        conversation: fresh,
        origin: input.origin,
        reason: input.reason,
        summary: input.summary,
        ticket: input.ticket,
        actorId: input.origin === "employee" ? this.employeeId : null,
      },
      this.at(minutesAgo),
    );
  }

  async claim(minutesAgo: number, analyst: { id: string; name: string }) {
    const when = this.at(minutesAgo);
    await transitionConversation(
      this.db,
      await this.fresh(),
      "analyst_claimed",
      { assignedAnalystId: analyst.id },
      when,
    );
    await this.db
      .update(schema.handoffs)
      .set({ claimedById: analyst.id, claimedAt: when })
      .where(eq(schema.handoffs.conversationId, this.conversation.id));
    await this.system(minutesAgo, analyst.id, `${analyst.name} assumiu · agent pausado`);
  }

  async close(minutesAgo: number, by: { id: string; name: string } | null) {
    const when = this.at(minutesAgo);
    await transitionConversation(this.db, await this.fresh(), "closed", {}, when);
    await this.db
      .update(schema.handoffs)
      .set({ resolvedAt: when })
      .where(eq(schema.handoffs.conversationId, this.conversation.id));
    await this.system(
      minutesAgo,
      by?.id ?? null,
      by
        ? `Atendimento encerrado por ${by.name}`
        : "Sessão encerrada pelo funcionário para começar uma nova conversa",
    );
  }

  /** A draft the agent prepared, through the same rules as the real tool. */
  async draft(
    minutesAgo: number,
    input: Omit<
      Parameters<typeof createTicketDraft>[2],
      "employeeId" | "conversationId" | "turnId"
    >,
  ) {
    return createTicketDraft(
      this.db,
      this.calendar,
      {
        ...input,
        employeeId: this.employeeId,
        conversationId: this.conversation.id,
        turnId: null,
      },
      this.at(minutesAgo),
    );
  }

  /** The employee confirms on the card: the ticket is created and announced. */
  async confirm(minutesAgo: number, draftId: string) {
    const service = new TicketService(this.db, this.calendar);
    const when = this.at(minutesAgo);
    const { ticket, draft } = await confirmDraft(
      this.db,
      service,
      { employeeId: this.employeeId, draftId },
      when,
    );
    await appendMessage(
      this.db,
      {
        conversationId: this.conversation.id,
        kind: "agent",
        senderId: null,
        content: confirmationText(draft, ticket),
        blocks: [{ type: "ticket_card", ticket: ticketSnapshot(ticket, when) }],
      },
      when,
    );
    return ticket;
  }

  async markRead() {
    await this.db.execute(sql`
      update conversations set analyst_read_seq = coalesce(
        (select max(seq) from messages where conversation_id = ${this.conversation.id}), 0)
      where id = ${this.conversation.id}
    `);
  }

  private async fresh(): Promise<ConversationRow> {
    const [row] = await this.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, this.conversation.id));
    if (!row) throw new Error("Seed: conversa sumiu");
    return row;
  }
}

function daysSince(date: Date, now: Date): number {
  return Math.max(1, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

/**
 * Demo history for the console and the employee chat: professional, realistic
 * conversations over the seeded tickets. Idempotent and non-destructive: an
 * employee who already has any conversation (real use) is left untouched.
 * Not used by the automated tests, which start from the base seed only.
 */
export async function seedConversations(
  db: Executor,
  calendar: BusinessCalendar,
  now = new Date(),
): Promise<number> {
  const users = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users);
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  const person = (email: string) => {
    const found = byEmail.get(email);
    if (!found) throw new Error(`Seed: usuário ${email} não encontrado`);
    return found;
  };
  const service = new TicketService(db, calendar);
  const ticket = async (number: string) => {
    const found = await service.findByNumber(number);
    if (!found) throw new Error(`Seed: chamado ${number} não encontrado`);
    return found;
  };
  const tz = calendar.timeZone;
  const rafael = person("rafael.lima@nexo.com.br");
  const DAY = 24 * 60;

  let created = 0;
  // Decided once, before writing: an employee with any conversation (real use)
  // gets nothing, and one run may write several conversations for the others.
  const withHistory = new Set(
    (
      await db
        .selectDistinct({ employeeId: schema.conversations.employeeId })
        .from(schema.conversations)
    ).map((row) => row.employeeId),
  );
  const story = async (email: string, startedMinutesAgo: number) => {
    const employee = person(email);
    if (withHistory.has(employee.id)) return null;
    const startedAt = new Date(now.getTime() - startedMinutesAgo * 60_000);
    const [conversation] = await db
      .insert(schema.conversations)
      .values({ employeeId: employee.id, createdAt: startedAt, lastActivityAt: startedAt })
      .returning();
    if (!conversation) throw new Error("Seed: conversa não criada");
    created += 1;
    return new Story(db, calendar, now, conversation, employee.id);
  };

  // Earlier conversations, already closed: what "Conversas anteriores" shows.
  // They come first because an employee has at most one live conversation.

  // Ana Souza, 6 days ago: a repeat of an old problem, solved by the article.
  const anaEarlier = await story("ana.souza@nexo.com.br", 6 * DAY);
  if (anaEarlier) {
    const start = 6 * DAY;
    const q1 = await anaEarlier.employee(
      start,
      "O Outlook do meu celular parou de sincronizar de novo.",
    );
    await anaEarlier.agent(start - 0.5, q1.seq, {
      actions: [
        {
          tool: "consultar_meus_chamados",
          label: "consultou seus chamados",
          summary: "INC-19877 (Outlook não sincroniza no celular), encerrado",
        },
        {
          tool: "buscar_central_de_ajuda",
          label: "buscou na central de ajuda",
          summary: "KB-006 Outlook não sincroniza no celular",
        },
      ],
      decision: {
        intent: "duvida",
        understanding: "O Outlook do celular voltou a não sincronizar; já houve um chamado igual.",
        action: "Passar o procedimento do artigo KB-006 antes de abrir chamado.",
        certainty: "alta",
        reason: "O artigo vale para Android e iOS e foi o que resolveu o INC-19877, já encerrado.",
        rules: ["Dúvida comum é resolvida pela central antes de abrir chamado"],
      },
      text: 'Pelo artigo "Outlook não sincroniza no celular": remova a conta do aplicativo Outlook, atualize o app e adicione a conta de novo, aprovando o acesso no autenticador. Foi o mesmo procedimento do seu chamado anterior, o INC-19877.',
      blocks: [
        {
          type: "knowledge",
          articles: [{ id: "KB-006", title: "Outlook não sincroniza no celular" }],
        },
        {
          type: "quick_replies",
          question: null,
          options: ["Resolveu", "Continua sem sincronizar"],
        },
      ],
    });
    const q2 = await anaEarlier.employee(start - 7, "Resolveu");
    await anaEarlier.agent(start - 7.5, q2.seq, {
      actions: [],
      decision: {
        intent: "outro",
        understanding: "O procedimento do artigo resolveu.",
        action: "Confirmar e encerrar sem abrir chamado.",
        certainty: "alta",
        reason: "Ana confirmou que voltou a sincronizar.",
      },
      text: "Ótimo! Se voltar a acontecer, me chame por aqui.",
    });
    await anaEarlier.close(start - 40, null);
  }

  // Bruno Tavares, 4 days ago: locked network account, solved by self-service.
  const brunoEarlier = await story("bruno.tavares@nexo.com.br", 4 * DAY);
  if (brunoEarlier) {
    const start = 4 * DAY;
    const q1 = await brunoEarlier.employee(
      start,
      "Troquei a senha da rede e agora minha conta está bloqueada.",
    );
    await brunoEarlier.agent(start - 0.5, q1.seq, {
      actions: [
        {
          tool: "buscar_central_de_ajuda",
          label: "buscou na central de ajuda",
          summary: "KB-003 Senha da rede expirada ou conta bloqueada",
        },
      ],
      decision: {
        intent: "duvida",
        understanding: "Conta da rede bloqueada depois de uma troca de senha.",
        action: "Orientar o autoatendimento de senhas do artigo KB-003.",
        certainty: "alta",
        reason: "O autoatendimento resolve bloqueio de conta sem chamado (KB-003).",
      },
      text: 'Pelo artigo "Senha da rede expirada ou conta bloqueada": use o autoatendimento de senhas no Portal do Colaborador pelo celular, validando com o número cadastrado. Depois de redefinir, espere 15 minutos e entre de novo. Se não tiver celular cadastrado, eu abro um chamado de Acesso.',
      blocks: [
        {
          type: "knowledge",
          articles: [{ id: "KB-003", title: "Senha da rede expirada ou conta bloqueada" }],
        },
      ],
    });
    const q2 = await brunoEarlier.employee(start - 22, "Consegui pelo portal, já entrei. Valeu!");
    await brunoEarlier.agent(start - 22.5, q2.seq, {
      actions: [],
      decision: {
        intent: "outro",
        understanding: "O autoatendimento desbloqueou a conta.",
        action: "Confirmar e encerrar.",
        certainty: "alta",
        reason: "Bruno confirmou que voltou a entrar.",
      },
      text: "Perfeito. Qualquer coisa, estou por aqui.",
    });
    await brunoEarlier.close(start - 60, null);
  }

  // Diego Ramos, 3 days ago: not an IT matter, redirected without a ticket.
  const diegoEarlier = await story("diego.ramos@nexo.com.br", 3 * DAY);
  if (diegoEarlier) {
    const start = 3 * DAY;
    const q1 = await diegoEarlier.employee(start, "Quando cai o vale-refeição deste mês?");
    await diegoEarlier.agent(start - 0.5, q1.seq, {
      actions: [
        {
          tool: "buscar_central_de_ajuda",
          label: "buscou na central de ajuda",
          summary: "KB-010 Assuntos fora da TI",
        },
      ],
      decision: {
        intent: "fora_de_escopo",
        understanding: "Pergunta sobre benefício, não sobre TI.",
        action: "Redirecionar para o RH sem abrir chamado.",
        certainty: "alta",
        reason: "Benefícios são tratados pelo RH no Portal do Colaborador (KB-010).",
        rules: ["Escopo: apenas assuntos de TI"],
      },
      text: "Benefícios como o vale-refeição ficam com o RH, no Portal do Colaborador; lá aparecem as datas de crédito. Se o portal não abrir, aí é com a TI e eu ajudo.",
      blocks: [{ type: "knowledge", articles: [{ id: "KB-010", title: "Assuntos fora da TI" }] }],
    });
    await diegoEarlier.close(start - 30, null);
  }

  // Carla Mendes, 2 days ago: an equipment request opened only after she confirmed.
  const carlaEarlier = await story("carla.mendes@nexo.com.br", 2 * DAY);
  if (carlaEarlier) {
    const start = 2 * DAY;
    const q1 = await carlaEarlier.employee(
      start,
      "Preciso de um headset com microfone para as reuniões com clientes.",
    );
    await carlaEarlier.agent(start - 0.5, q1.seq, {
      actions: [
        {
          tool: "buscar_central_de_ajuda",
          label: "buscou na central de ajuda",
          summary: "KB-009 Pedir equipamento",
        },
        {
          tool: "verificar_duplicidade",
          label: "verificou duplicidade",
          summary: "Nenhum pedido de headset aberto",
        },
      ],
      decision: {
        intent: "abertura_de_chamado",
        understanding: "Pedido de headset para reuniões externas.",
        action: "Perguntar se há reunião hoje em risco antes de montar a requisição.",
        certainty: "alta",
        reason:
          "Equipamento é uma requisição de Hardware (KB-009); só falta saber a urgência para a prioridade.",
        missingInformation: ["Compromisso hoje"],
      },
      text: 'Equipamentos são pedidos por uma requisição de Hardware, com aprovação do gestor e entrega em até 5 dias úteis depois de aprovada ("Pedir equipamento"). Você tem alguma reunião hoje que dependa do headset?',
      blocks: [
        {
          type: "knowledge",
          articles: [{ id: "KB-009", title: "Pedir equipamento (monitor, teclado, headset)" }],
        },
        {
          type: "quick_replies",
          question: null,
          options: ["Sim, hoje", "Não, pode ser nos próximos dias"],
        },
      ],
    });
    const q2 = await carlaEarlier.employee(start - 3, "Não, pode ser nos próximos dias");
    const headset = await carlaEarlier.draft(start - 3.5, {
      type: "REQ",
      category: "Hardware",
      title: "Headset com microfone para reuniões com clientes",
      description:
        "Carla Mendes (Comercial) precisa de um headset com microfone para reuniões com clientes. Sem reunião dependente hoje; usa o áudio do notebook enquanto isso.",
      facts: { scope: "self", workBlocked: false, deadlineToday: false, hasWorkaround: true },
    });
    await carlaEarlier.agent(start - 3.5, q2.seq, {
      actions: [
        {
          tool: "montar_rascunho",
          label: "montou o rascunho",
          summary: `Rascunho ${headset.code}: ${headset.title} (baixa).`,
        },
      ],
      decision: {
        intent: "abertura_de_chamado",
        understanding: "Headset sem urgência, só para Carla.",
        action: "Montar o rascunho da requisição e pedir confirmação.",
        certainty: "alta",
        reason: "Pedido sem compromisso hoje: prioridade baixa pela regra de requisição.",
        rules: ["Só cria o chamado depois da confirmação do funcionário"],
      },
      text: `Montei o rascunho: requisição de Hardware com prioridade baixa, porque é um pedido sem urgência (resposta em até 5 dias úteis). Confira e confirme para eu abrir.`,
      blocks: [{ type: "draft", draftId: headset.id }],
    });
    await carlaEarlier.confirm(start - 6, headset.id);
    await carlaEarlier.close(start - 50, null);
  }

  // Ana Souza: status inquiry, overdue SLA, transfer to N2 (waiting in the queue).
  const ana = await story("ana.souza@nexo.com.br", 16);
  if (ana) {
    const open = await service.listForRequester(ana.conversation.employeeId, { onlyOpen: true });
    const slow = await ticket("INC-20311");
    const card = ticketSnapshot(slow, ana.at(12));
    const late = daysSince(slow.slaStartedAt, now);
    const q1 = await ana.employee(16, "Qual o status do meu chamado?");
    await ana.agent(15.5, q1.seq, {
      actions: [
        {
          tool: "consultar_meus_chamados",
          label: "consultou seus chamados",
          summary: `${open.length} chamados abertos`,
        },
      ],
      decision: {
        intent: "consulta_de_chamado",
        understanding: "Ana quer saber o status de um chamado sem informar o número.",
        action: "Listar os chamados abertos para escolher qual.",
        certainty: "alta",
        reason: `Há ${open.length} chamados abertos; sem o número, perguntar qual.`,
      },
      text: `Você tem ${open.length} chamados abertos. Sobre qual deles quer saber?`,
      blocks: [
        {
          type: "ticket_selection",
          prompt: "Sobre qual deles quer saber?",
          tickets: open.map((row) => {
            const snapshot = ticketSnapshot(row, ana.at(15.5));
            return {
              number: snapshot.number,
              title: snapshot.title,
              status: snapshot.status,
              updatedAt: snapshot.updatedAt,
              overdue: snapshot.overdue,
            };
          }),
        },
      ],
    });
    const q2 = await ana.employee(13, `${slow.number} · ${slow.title}`);
    await ana.agent(12, q2.seq, {
      actions: [
        { tool: "consultar_chamado", label: `consultou o ${slow.number}`, summary: slow.title },
        { tool: "consultar_chamado", label: "calculou o prazo", summary: card.slaLabel },
      ],
      decision: {
        intent: "consulta_de_chamado",
        understanding: `Status do ${slow.number}.`,
        action: "Mostrar o chamado e oferecer um analista porque o prazo venceu.",
        certainty: "alta",
        reason: `Prazo de ${card.slaLabel} para prioridade média vencido; regra: chamado vencido pode ir para um analista com o aceite de quem abriu.`,
        rules: ["Prazo vencido: oferecer transferência"],
      },
      text: `Está sem atualização há ${late} dias, acima do prazo de ${card.slaLabel} para prioridade média. Quer que eu chame um analista?`,
      blocks: [
        { type: "ticket_card", ticket: card },
        {
          type: "quick_replies",
          question: null,
          options: ["Falar com um analista", "Adicionar informação", "Agora não"],
        },
      ],
    });
    const q3 = await ana.employee(10, `Está parado há ${late} dias. Quero falar com um analista.`);
    let respondBy: Date | null = null;
    await ana.agent(9.5, q3.seq, {
      actions: [
        {
          tool: "transferir_para_analista",
          label: "chamou um analista",
          summary: "Transferida para o service desk, indicada ao Suporte N2 (overdue).",
        },
      ],
      decision: {
        intent: "pedido_de_analista",
        understanding: "Ana aceitou falar com um analista sobre o chamado vencido.",
        action: "Transferir para o service desk com resumo, indicando o Suporte N2.",
        certainty: "alta",
        reason: "Chamado vencido e pedido explícito de Ana.",
        rules: ["Chamado vencido é indicado ao N2"],
        escalationReason: "Prazo vencido",
      },
      beforeAnswer: async () => {
        const result = await ana.handoff(9.5, {
          origin: "agent",
          reason: "overdue",
          ticket: slow,
          summary: `${slow.number} · ${slow.title}. Sem atualização há ${late} dias, acima do prazo de ${card.slaLabel} (prioridade média). Já reiniciou e rodou o diagnóstico da central sem resultado. Pediu para falar com um analista.`,
        });
        respondBy = result.respondBy;
      },
      text: () =>
        `Chamei a equipe do service desk com o resumo do chamado. Um analista vai falar com você até ${
          respondBy
            ? untilLabel((respondBy as Date).toISOString(), tz, ana.at(9.5))
            : "o fim do prazo"
        }.`,
    });
  }

  // Carla Mendes: urgent SAP access, already has a REQ; asks for a person.
  const carla = await story("carla.mendes@nexo.com.br", 38);
  if (carla) {
    const sap = await ticket("REQ-10451");
    const carlaOpen = await service.listForRequester(carla.conversation.employeeId, {
      onlyOpen: true,
    });
    const card = ticketSnapshot(sap, carla.at(37));
    const q1 = await carla.employee(
      38,
      "Preciso de acesso ao módulo de vendas do SAP ainda hoje, tenho pedidos de um cliente para lançar.",
    );
    await carla.agent(37, q1.seq, {
      actions: [
        {
          tool: "consultar_meus_chamados",
          label: "consultou seus chamados",
          summary: `${carlaOpen.length} chamados abertos`,
        },
        {
          tool: "verificar_duplicidade",
          label: "verificou chamados parecidos",
          summary: sap.number,
        },
      ],
      decision: {
        intent: "pedido_de_analista",
        understanding: "Acesso ao SAP SD para hoje.",
        action: `Mostrar a ${sap.number}, que já pede esse acesso, em vez de abrir outra.`,
        certainty: "alta",
        reason: `Já existe a ${sap.number} aberta com prioridade alta; regra de duplicidade.`,
        rules: ["Sem duplicidade: atualizar o chamado aberto parecido"],
      },
      text: `Você já tem a ${sap.number} aberta para esse acesso, com prioridade alta e prazo ${card.overdue ? "vencido" : `até ${untilLabel(card.slaDueAt, tz, carla.at(37))}`}. Quer que eu chame um analista para agilizar?`,
      blocks: [
        { type: "ticket_card", ticket: card },
        { type: "quick_replies", question: null, options: ["Falar com um analista", "Agora não"] },
      ],
    });
    const q2 = await carla.employee(36, "Falar com um analista");
    await carla.agent(35.5, q2.seq, {
      actions: [
        {
          tool: "transferir_para_analista",
          label: "chamou um analista",
          summary: "Transferida (employee_request).",
        },
      ],
      decision: {
        intent: "pedido_de_analista",
        understanding: "Carla pediu um analista para agilizar o acesso.",
        action: "Transferir com o resumo da requisição.",
        certainty: "alta",
        reason: "Pedido explícito de Carla.",
      },
      beforeAnswer: async () => {
        await carla.handoff(35.5, {
          origin: "agent",
          reason: "employee_request",
          ticket: sap,
          summary: `${sap.number} · ${sap.title}. Precisa lançar pedidos de um cliente hoje; pediu um analista para agilizar a liberação.`,
        });
      },
      text: "Pronto, chamei a equipe. Um analista fala com você por aqui.",
    });
  }

  // Bruno Tavares: the agent is unsure and asks before deciding (low certainty).
  const bruno = await story("bruno.tavares@nexo.com.br", 7);
  if (bruno) {
    const teams = await ticket("INC-20501");
    const q1 = await bruno.employee(
      7,
      "O Teams continua caindo nas chamadas, agora também no áudio.",
    );
    await bruno.agent(6.5, q1.seq, {
      actions: [
        {
          tool: "consultar_meus_chamados",
          label: "consultou seus chamados",
          summary: teams.number,
        },
        {
          tool: "buscar_central_de_ajuda",
          label: "buscou na central de ajuda",
          summary: "Nenhum artigo específico",
        },
      ],
      decision: {
        intent: "atualizacao_de_chamado",
        understanding: `Piora do problema do ${teams.number}.`,
        action: "Perguntar onde acontece antes de complementar o chamado.",
        certainty: "baixa",
        reason: "Pode ser a mesma causa ou uma falha de rede nova; falta saber a rede usada.",
        missingInformation: ["Em qual rede acontece (casa, escritório ou ambas)"],
      },
      text: `Você já tem o ${teams.number} em andamento sobre as quedas do Teams. Para eu entender se é a mesma causa: isso acontece no Wi-Fi de casa, no escritório ou nos dois?`,
      blocks: [
        {
          type: "quick_replies",
          question: null,
          options: ["Em casa", "No escritório", "Nos dois"],
        },
      ],
    });
  }

  // Diego Ramos: answered from the help center, still with the agent.
  const diego = await story("diego.ramos@nexo.com.br", 95);
  if (diego) {
    const q1 = await diego.employee(
      95,
      "Meu notebook está muito lento desde a última atualização.",
    );
    await diego.agent(94.5, q1.seq, {
      actions: [
        {
          tool: "consultar_meus_chamados",
          label: "consultou seus chamados",
          summary: "Nenhum chamado aberto",
        },
        {
          tool: "buscar_central_de_ajuda",
          label: "buscou na central de ajuda",
          summary: "KB-008 Computador lento",
        },
      ],
      decision: {
        intent: "duvida",
        understanding: "Lentidão após atualização, sem chamado aberto.",
        action: "Orientar pelo artigo da central antes de abrir chamado.",
        certainty: "alta",
        reason:
          "O artigo KB-008 vale para o sistema operacional de Diego e resolve a maioria dos casos.",
      },
      text: "Vamos tentar o que costuma resolver: reinicie o computador, instale as atualizações pendentes e rode o diagnóstico Nexo Check no Portal de Softwares. Se continuar lento, eu abro um chamado de Hardware com o resultado do diagnóstico.",
      blocks: [
        { type: "knowledge", articles: [{ id: "KB-008", title: "Computador lento" }] },
        { type: "quick_replies", question: null, options: ["Resolveu", "Ainda está lento"] },
      ],
    });
    await diego.markRead();
  }

  // Elisa Prado: solved by the agent alone, closed yesterday.
  const elisa = await story("elisa.prado@nexo.com.br", 26 * 60);
  if (elisa) {
    const q1 = await elisa.employee(26 * 60, "Estou sem internet no Wi-Fi do escritório.");
    await elisa.agent(26 * 60 - 0.5, q1.seq, {
      actions: [
        {
          tool: "buscar_central_de_ajuda",
          label: "buscou na central de ajuda",
          summary: "KB-007 Wi-Fi corporativo",
        },
      ],
      decision: {
        intent: "duvida",
        understanding: "Sem internet no Wi-Fi corporativo, só no computador de Elisa.",
        action: "Passar o procedimento do artigo KB-007.",
        certainty: "alta",
        reason: "Falha individual: nenhum colega sem internet foi citado.",
      },
      text: "Conecte-se à rede Nexo-Corp com o usuário e a senha da rede. Se não conectar, esqueça a rede no computador e conecte de novo. Se ninguém do andar tiver internet, me avise que eu trato como falha coletiva.",
      blocks: [
        {
          type: "knowledge",
          articles: [{ id: "KB-007", title: "Sem internet no Wi-Fi corporativo" }],
        },
      ],
    });
    const q2 = await elisa.employee(
      26 * 60 - 4,
      "Esqueci a rede e conectei de novo. Funcionou, valeu!",
    );
    await elisa.agent(26 * 60 - 4.5, q2.seq, {
      actions: [],
      decision: {
        intent: "outro",
        understanding: "O procedimento resolveu.",
        action: "Confirmar e encerrar.",
        certainty: "alta",
        reason: "Elisa confirmou que voltou a funcionar.",
      },
      text: "Que bom que resolveu! Se voltar a acontecer, é só me chamar por aqui.",
    });
    await elisa.close(26 * 60 - 30, null);
    await elisa.markRead();
  }

  // Fábio Nunes: help center was not enough, N1 took over, solved and closed.
  const fabio = await story("fabio.nunes@nexo.com.br", 22 * 60);
  if (fabio) {
    const q1 = await fabio.employee(
      22 * 60,
      "Preciso instalar o Power BI Desktop para um relatório.",
    );
    await fabio.agent(22 * 60 - 0.5, q1.seq, {
      actions: [
        {
          tool: "buscar_central_de_ajuda",
          label: "buscou na central de ajuda",
          summary: "KB-005 Portal de Softwares",
        },
      ],
      decision: {
        intent: "duvida",
        understanding: "Instalação de programa homologado.",
        action: "Indicar o Portal de Softwares.",
        certainty: "alta",
        reason: "Programas homologados são instalados pelo portal, sem chamado (KB-005).",
      },
      text: 'O Power BI Desktop é homologado: você instala pelo Portal de Softwares, sem precisar de chamado. Procure por "Power BI" na categoria Análise de dados.',
      blocks: [
        {
          type: "knowledge",
          articles: [{ id: "KB-005", title: "Instalar programas pelo Portal de Softwares" }],
        },
      ],
    });
    const q2 = await fabio.employee(22 * 60 - 6, "Não aparece para mim no portal.");
    await fabio.agent(22 * 60 - 6.5, q2.seq, {
      actions: [
        {
          tool: "transferir_para_analista",
          label: "chamou um analista",
          summary: "Transferida (out_of_tools).",
        },
      ],
      decision: {
        intent: "pedido_de_analista",
        understanding: "O programa não aparece no portal para o perfil de Fábio.",
        action: "Transferir: liberar o catálogo exige um analista.",
        certainty: "alta",
        reason: "Liberar programa no perfil do portal está fora das ferramentas do agent.",
        escalationReason: "Fora das ferramentas",
      },
      beforeAnswer: async () => {
        await fabio.handoff(22 * 60 - 6.5, {
          origin: "agent",
          reason: "out_of_tools",
          ticket: null,
          summary:
            "Power BI Desktop não aparece no Portal de Softwares para o perfil do funcionário. Precisa para um relatório.",
        });
      },
      text: "Liberar o programa no seu perfil precisa de um analista. Já chamei a equipe; a resposta chega por aqui.",
    });
    await fabio.claim(22 * 60 - 14, rafael);
    await fabio.analyst(
      22 * 60 - 15,
      rafael.id,
      "Oi, Fábio! Aqui é o Rafael. Liberei o Power BI Desktop para o seu perfil. Atualize o portal que ele aparece em Análise de dados.",
    );
    await fabio.employee(22 * 60 - 19, "Apareceu e já instalou. Obrigado!");
    await fabio.analyst(
      22 * 60 - 20,
      rafael.id,
      "Perfeito. Vou encerrar por aqui; qualquer coisa é só chamar.",
    );
    await fabio.close(22 * 60 - 21, rafael);
    await fabio.markRead();
  }

  // Gabriela Rocha: a paid-license software request, confirmed and still open.
  const gabriela = await story("gabriela.rocha@nexo.com.br", 40);
  if (gabriela) {
    const q1 = await gabriela.employee(
      40,
      "Preciso do Adobe Acrobat Pro para editar contratos. Não achei no Portal de Softwares.",
    );
    await gabriela.agent(39.5, q1.seq, {
      actions: [
        {
          tool: "buscar_central_de_ajuda",
          label: "buscou na central de ajuda",
          summary: "KB-005 Instalar programas pelo Portal de Softwares",
        },
      ],
      decision: {
        intent: "abertura_de_chamado",
        understanding: "Programa de licença paga, fora do catálogo do portal.",
        action: "Explicar a regra e perguntar a urgência antes de montar a requisição.",
        certainty: "alta",
        reason:
          "Programas com licença paga precisam de requisição de Software com justificativa do gestor (KB-005).",
        missingInformation: ["Compromisso hoje"],
      },
      text: 'O Acrobat Pro tem licença paga, então não fica no Portal de Softwares: ele precisa de uma requisição de Software com a justificativa do seu gestor ("Instalar programas pelo Portal de Softwares"). Você tem algum contrato para editar hoje?',
      blocks: [
        {
          type: "knowledge",
          articles: [{ id: "KB-005", title: "Instalar programas pelo Portal de Softwares" }],
        },
        {
          type: "quick_replies",
          question: null,
          options: ["Sim, hoje", "Não, é para a próxima semana"],
        },
      ],
    });
    const q2 = await gabriela.employee(
      36,
      "Não, é para a próxima semana. Minha gestora já aprovou.",
    );
    const acrobat = await gabriela.draft(35.5, {
      type: "REQ",
      category: "Software",
      title: "Licença do Adobe Acrobat Pro para edição de contratos",
      description:
        "Gabriela Rocha (Recursos Humanos) precisa do Adobe Acrobat Pro para editar contratos. Licença paga, fora do Portal de Softwares. Gestora já aprovou; uso a partir da próxima semana.",
      facts: { scope: "self", workBlocked: false, deadlineToday: false, hasWorkaround: true },
    });
    await gabriela.agent(35.5, q2.seq, {
      actions: [
        {
          tool: "verificar_duplicidade",
          label: "verificou duplicidade",
          summary: "Nenhum pedido de Acrobat aberto",
        },
        {
          tool: "montar_rascunho",
          label: "montou o rascunho",
          summary: `Rascunho ${acrobat.code}: ${acrobat.title} (baixa).`,
        },
      ],
      decision: {
        intent: "abertura_de_chamado",
        understanding: "Licença de Acrobat Pro sem urgência, já aprovada pela gestora.",
        action: "Montar o rascunho da requisição e pedir confirmação.",
        certainty: "alta",
        reason: "Pedido sem compromisso hoje: prioridade baixa. A aprovação vai na descrição.",
        rules: ["Só cria o chamado depois da confirmação do funcionário"],
      },
      text: "Montei o rascunho com a aprovação da sua gestora na descrição. Prioridade baixa, porque é um pedido sem urgência (resposta em até 5 dias úteis). Confira e confirme para eu abrir.",
      blocks: [{ type: "draft", draftId: acrobat.id }],
    });
    await gabriela.confirm(33, acrobat.id);
    await gabriela.markRead();
  }

  return created;
}
