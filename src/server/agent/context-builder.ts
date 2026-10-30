import { TZDate } from "@date-fns/tz";
import { and, desc, eq } from "drizzle-orm";
import { isWithinBusinessHours, type BusinessCalendar } from "@/domain/sla";
import { PRIORITY_LABEL } from "@/domain/tickets";
import type { SessionUser } from "@/server/auth/sessions";
import type { Executor } from "@/server/db/client";
import { messages, ticketDrafts, tickets } from "@/server/db/schema";
import type { MessageBlock } from "@/server/messages/blocks";
import type { ConversationRow, MessageRow } from "@/server/conversations/repository";

/** Recent messages replayed to the model. Older context lives in tickets and handoffs. */
export const CONTEXT_MESSAGES = 16;

export type ModelMessage =
  { role: "user"; content: string } | { role: "assistant"; content: string };

function describeBlock(block: MessageBlock): string {
  switch (block.type) {
    case "ticket_card":
      return `[cartão do chamado ${block.ticket.number} exibido: ${block.ticket.title}]`;
    case "ticket_selection":
      return `[lista para escolha exibida: ${block.tickets.map((ticket) => ticket.number).join(", ")}]`;
    case "draft":
      return "[rascunho exibido para confirmação]";
    case "quick_replies":
      return `[opções oferecidas: ${block.options.join(" / ")}]`;
    case "handoff":
      return `[conversa transferida para ${block.level}: ${block.reason}]`;
    case "knowledge":
      return `[artigos consultados: ${block.articles.map((article) => article.id).join(", ")}]`;
    case "notice":
      return `[aviso: ${block.text}]`;
  }
}

export function toModelMessages(
  rows: MessageRow[],
  senderNames: Map<string, string>,
): ModelMessage[] {
  return rows.map((row) => {
    const extras = row.blocks.map(describeBlock).join(" ");
    switch (row.kind) {
      case "employee":
        return { role: "user", content: row.content };
      case "agent":
        return { role: "assistant", content: [row.content, extras].filter(Boolean).join("\n") };
      case "analyst": {
        const name = (row.senderId && senderNames.get(row.senderId)) ?? "Analista";
        return { role: "assistant", content: `[mensagem do analista ${name}]: ${row.content}` };
      }
      case "system":
        return { role: "assistant", content: `[evento: ${row.content}] ${extras}`.trim() };
    }
  });
}

export async function recentMessages(executor: Executor, conversationId: string, uptoSeq: number) {
  const rows = await executor
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.seq))
    .limit(CONTEXT_MESSAGES);
  return rows.filter((row) => row.seq <= uptoSeq).reverse();
}

function formatLocal(date: Date, calendar: BusinessCalendar): string {
  const local = new TZDate(date.getTime(), calendar.timeZone);
  return local.toLocaleString("pt-BR", {
    timeZone: calendar.timeZone,
    weekday: "long",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Per-turn facts appended to the instructions. Small and deterministic. */
export async function turnFacts(
  executor: Executor,
  input: {
    user: SessionUser;
    conversation: ConversationRow;
    calendar: BusinessCalendar;
    now: Date;
  },
): Promise<string> {
  const { user, conversation, calendar, now } = input;
  const pending = await executor
    .select()
    .from(ticketDrafts)
    .where(
      and(eq(ticketDrafts.conversationId, conversation.id), eq(ticketDrafts.status, "pending")),
    )
    .orderBy(desc(ticketDrafts.createdAt))
    .limit(1);
  const focus = conversation.focusTicketId
    ? (
        await executor
          .select({ number: tickets.number, title: tickets.title })
          .from(tickets)
          .where(and(eq(tickets.id, conversation.focusTicketId), eq(tickets.requesterId, user.id)))
          .limit(1)
      )[0]
    : undefined;
  const draft = pending[0];
  const lines = [
    "# Contexto deste atendimento",
    `- Funcionário: ${user.name}, área ${user.department}. Computador: ${user.deviceOs ?? "não informado"}.`,
    `- Agora: ${formatLocal(now, calendar)} (${calendar.timeZone}). Service desk ${isWithinBusinessHours(now, calendar) ? "aberto" : "fora do horário (só críticos têm plantão)"}; expediente seg-sex ${calendar.dayStartHour}h-${calendar.dayEndHour}h.`,
    `- Mensagens do funcionário nesta sessão: ${conversation.agentTurnCount}.`,
  ];
  if (focus) lines.push(`- Chamado em foco: ${focus.number} (${focus.title}).`);
  if (draft) {
    lines.push(
      `- Rascunho pendente ${draft.code} (${draft.kind === "create" ? "novo chamado" : draft.kind === "reopen" ? "reabertura" : "atualização"}): ${draft.title ?? ""}${draft.priority ? `, prioridade ${PRIORITY_LABEL[draft.priority]}` : ""}.`,
    );
  }
  return lines.join("\n");
}
