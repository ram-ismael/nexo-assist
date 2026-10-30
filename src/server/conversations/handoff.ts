import { computeDueAt, slaPolicyFor, slaState, type BusinessCalendar } from "@/domain/sla";
import type { Executor } from "@/server/db/client";
import { handoffs } from "@/server/db/schema";
import type { TicketService, TicketRow } from "@/server/tickets/service";
import { appendMessage, transitionConversation, type ConversationRow } from "./repository";

export type HandoffReason = (typeof handoffs.$inferInsert)["reason"];

export const HANDOFF_REASON_LABEL: Record<HandoffReason, string> = {
  employee_request: "Pedido do funcionário",
  critical: "Caso crítico",
  overdue: "Chamado com prazo vencido",
  low_confidence: "Agent sem segurança para decidir",
  out_of_tools: "Fora do que o agent pode fazer",
  failure: "Falha técnica no atendimento automático",
};

/**
 * Moves the conversation to the human queue with a summary for the analyst.
 * Runs inside the caller's transaction (the ticket-service transaction when a
 * ticket is involved), so state, handoff record and ticket transfer commit together.
 */
export async function performHandoff(
  executor: Executor,
  service: TicketService,
  calendar: BusinessCalendar,
  input: {
    conversation: ConversationRow;
    origin: "agent" | "employee" | "system";
    reason: HandoffReason;
    summary: string;
    ticket: TicketRow | null;
    actorId: string | null;
  },
  now = new Date(),
) {
  const critical = input.reason === "critical" || input.ticket?.priority === "critica";
  const overdue = input.ticket ? slaState(input.ticket.slaDueAt, now).overdue : false;
  const targetLevel =
    critical || overdue || input.reason === "overdue" ? "Suporte N2" : "Suporte N1";
  // First human contact: the ticket deadline when it is still ahead, otherwise
  // the "alta" window (4 business hours); critical cases follow the 1-hour clock.
  const respondBy = critical
    ? computeDueAt(now, slaPolicyFor("critica", calendar), calendar)
    : input.ticket && !overdue
      ? input.ticket.slaDueAt
      : computeDueAt(now, slaPolicyFor("alta", calendar), calendar);

  const conversation = await transitionConversation(
    executor,
    input.conversation,
    "handoff_requested",
    { focusTicketId: input.ticket?.id ?? input.conversation.focusTicketId },
    now,
  );
  const inserted = await executor
    .insert(handoffs)
    .values({
      conversationId: conversation.id,
      origin: input.origin,
      reason: input.reason,
      summary: input.summary,
      targetLevel,
      ticketIds: input.ticket ? [input.ticket.id] : [],
      respondBy,
      createdAt: now,
    })
    .returning();
  if (input.ticket) {
    await service.transfer(
      input.ticket,
      { id: input.actorId, kind: input.origin === "employee" ? "employee" : "agent" },
      HANDOFF_REASON_LABEL[input.reason],
      now,
    );
  }
  await appendMessage(
    executor,
    {
      conversationId: conversation.id,
      kind: "system",
      senderId: null,
      content: `Transferida para ${targetLevel}`,
      blocks: [
        {
          type: "handoff",
          level: targetLevel,
          reason: HANDOFF_REASON_LABEL[input.reason],
          respondBy: respondBy.toISOString(),
        },
      ],
    },
    now,
  );
  const handoff = inserted[0];
  if (!handoff) throw new Error("Falha ao registrar a transferência");
  return { conversation, handoff, targetLevel, respondBy };
}
