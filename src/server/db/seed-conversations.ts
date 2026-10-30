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
import { DEMO_SEED_MODEL } from "@/server/db/demo";
import * as schema from "@/server/db/schema";
import type { MessageBlock } from "@/server/messages/blocks";
import { TicketService, ticketSnapshot, type TicketRow } from "@/server/tickets/service";

type Action = { tool: string; label: string; summary: string; visible?: boolean };
type Decision = {
  intent: string;
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

  let created = 0;
  const story = async (email: string, startedMinutesAgo: number) => {
    const employee = person(email);
    const existing = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.employeeId, employee.id))
      .limit(1);
    if (existing.length > 0) return null;
    const startedAt = new Date(now.getTime() - startedMinutesAgo * 60_000);
    const [conversation] = await db
      .insert(schema.conversations)
      .values({ employeeId: employee.id, createdAt: startedAt, lastActivityAt: startedAt })
      .returning();
    if (!conversation) throw new Error("Seed: conversa não criada");
    created += 1;
    return new Story(db, calendar, now, conversation, employee.id);
  };

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
    let level = "Suporte N2";
    await ana.agent(9.5, q3.seq, {
      actions: [
        {
          tool: "transferir_para_analista",
          label: "chamou um analista",
          summary: "Transferida para Suporte N2 (overdue).",
        },
      ],
      decision: {
        intent: "pedido_de_analista",
        understanding: "Ana aceitou falar com um analista sobre o chamado vencido.",
        action: "Transferir para o Suporte N2 com resumo.",
        certainty: "alta",
        reason: "Chamado vencido e pedido explícito de Ana.",
        rules: ["Chamado vencido vai para N2"],
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
        level = result.targetLevel;
      },
      text: () =>
        `Encaminhei para o ${level}. Um analista vai falar com você até ${
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
        intent: "pedido_de_acesso",
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
        intent: "encerramento",
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
        intent: "pedido_de_acesso",
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

  return created;
}
