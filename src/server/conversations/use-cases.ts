import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { config } from "@/lib/config";
import type { SessionUser } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
import { auditEvents, conversations, handoffs, messages } from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/errors";
import { callTicketService } from "@/server/tickets/gateway";
import { confirmDraft, confirmationText } from "@/server/tickets/drafts";
import { ticketSnapshot, type TicketRow } from "@/server/tickets/service";
import { performHandoff } from "./handoff";
import {
  appendMessage,
  countEmployeeMessages,
  findLiveConversation,
  findMessageByClientId,
  getOrCreateLiveConversation,
  hasAbandonedTurn,
  lockConversation,
  reapAbandonedTurns,
  transitionConversation,
  type ConversationRow,
  type MessageRow,
} from "./repository";

export async function audit(
  actorId: string | null,
  entity: string,
  entityId: string | null,
  action: string,
  outcome: "success" | "denied" | "failed",
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db()
    .insert(auditEvents)
    .values({ actorId, entity, entityId, action, outcome, metadata: metadata ?? null });
}

/**
 * Confirms a draft (from the card button or from the agent after a textual
 * "pode criar") and, for the button path, posts the outcome in the chat.
 * PRD rule applied here, not in the prompt: a confirmed critical ticket goes
 * straight to a human.
 */
export async function confirmDraftAndAnnounce(
  employeeId: string,
  draftId: string,
  expectedVersion: number | undefined,
  options: { announce: boolean },
): Promise<{ ticket: TicketRow; handedOff: boolean; alreadyConfirmed: boolean }> {
  const calendar = config().calendar;
  const result = await callTicketService("confirmDraft", async (service, tx) => {
    const confirmed = await confirmDraft(tx, service, { employeeId, draftId, expectedVersion });
    if (confirmed.alreadyConfirmed) return { ...confirmed, handedOff: false };
    const now = new Date();
    let conversation = await lockConversation(tx, confirmed.draft.conversationId);
    if (!conversation) throw notFound("Conversa");
    if (options.announce) {
      await appendMessage(
        tx,
        {
          conversationId: conversation.id,
          kind: "agent",
          senderId: null,
          content: confirmationText(confirmed.draft, confirmed.ticket),
          blocks: [{ type: "ticket_card", ticket: ticketSnapshot(confirmed.ticket, now) }],
        },
        now,
      );
    }
    let handedOff = false;
    if (confirmed.ticket.priority === "critica" && conversation.state === "agent_active") {
      const handoff = await performHandoff(
        tx,
        service,
        calendar,
        {
          conversation,
          origin: "system",
          reason: "critical",
          summary: `Chamado crítico ${confirmed.ticket.number} confirmado pelo funcionário: ${confirmed.ticket.title}. ${confirmed.ticket.description}`,
          ticket: confirmed.ticket,
          actorId: employeeId,
        },
        now,
      );
      conversation = handoff.conversation;
      handedOff = true;
    }
    return { ...confirmed, handedOff };
  });
  await audit(
    employeeId,
    "ticket",
    result.ticket.id,
    `draft_${result.draft.kind}_confirmed`,
    "success",
    {
      draft: result.draft.code,
      alreadyConfirmed: result.alreadyConfirmed,
    },
  );
  return {
    ticket: result.ticket,
    handedOff: result.handedOff,
    alreadyConfirmed: result.alreadyConfirmed,
  };
}

/** Direct, model-free path to a human: works even when the LLM provider is down. */
export async function employeeRequestsAnalyst(user: SessionUser, conversationId: string) {
  const calendar = config().calendar;
  return callTicketService("employeeHandoff", async (service, tx) => {
    const conversation = await lockConversation(tx, conversationId);
    if (!conversation || conversation.employeeId !== user.id) throw notFound("Conversa");
    if (conversation.state !== "agent_active") {
      throw conflict("Esta conversa já está com a equipe de atendimento.");
    }
    const ticket = conversation.focusTicketId
      ? await service.findById(conversation.focusTicketId)
      : null;
    return performHandoff(tx, service, calendar, {
      conversation,
      origin: "employee",
      reason: "employee_request",
      summary: ticket
        ? `O funcionário pediu um analista pelo botão. Chamado em foco: ${ticket.number} · ${ticket.title}. Veja o histórico da conversa.`
        : "O funcionário pediu um analista pelo botão. Veja o histórico da conversa.",
      ticket,
      actorId: user.id,
    });
  });
}

/**
 * Read paths call this so a turn killed with its function stops showing as
 * "processing" and the employee learns the answer was interrupted. The cheap
 * indexed check runs first; the locking transaction only when there is work.
 */
export async function recoverAbandonedTurns(conversationId: string): Promise<boolean> {
  if (!(await hasAbandonedTurn(db(), conversationId))) return false;
  return db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, conversationId);
    if (!conversation) return false;
    return (await reapAbandonedTurns(tx, conversationId)) > 0;
  });
}

export async function claimConversation(analyst: SessionUser, conversationId: string) {
  return db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, conversationId);
    if (!conversation) throw notFound("Conversa");
    if (conversation.state === "analyst_active" && conversation.assignedAnalystId === analyst.id) {
      return conversation;
    }
    const now = new Date();
    const updated = await transitionConversation(
      tx,
      conversation,
      "analyst_claimed",
      { assignedAnalystId: analyst.id },
      now,
    );
    await tx
      .update(handoffs)
      .set({ claimedById: analyst.id, claimedAt: now })
      .where(and(eq(handoffs.conversationId, conversationId), isNull(handoffs.claimedAt)));
    await appendMessage(
      tx,
      {
        conversationId,
        kind: "system",
        senderId: analyst.id,
        content: `${analyst.name} assumiu · agent pausado`,
      },
      now,
    );
    return updated;
  });
}

function assertAssigned(analyst: SessionUser, conversation: ConversationRow): void {
  if (conversation.state === "analyst_active" && conversation.assignedAnalystId !== analyst.id) {
    throw new AppError("conflict", "Esta conversa está sendo atendida por outro analista.");
  }
}

export async function returnToAgent(analyst: SessionUser, conversationId: string) {
  return db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, conversationId);
    if (!conversation) throw notFound("Conversa");
    assertAssigned(analyst, conversation);
    const now = new Date();
    const updated = await transitionConversation(
      tx,
      conversation,
      "returned_to_agent",
      { assignedAnalystId: null },
      now,
    );
    await tx
      .update(handoffs)
      .set({ resolvedAt: now })
      .where(and(eq(handoffs.conversationId, conversationId), isNull(handoffs.resolvedAt)));
    await appendMessage(
      tx,
      {
        conversationId,
        kind: "system",
        senderId: analyst.id,
        content: `${analyst.name} devolveu a conversa ao Nexo Assist`,
      },
      now,
    );
    return updated;
  });
}

export async function closeConversation(analyst: SessionUser, conversationId: string) {
  return db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, conversationId);
    if (!conversation) throw notFound("Conversa");
    assertAssigned(analyst, conversation);
    const now = new Date();
    const updated = await transitionConversation(tx, conversation, "closed", {}, now);
    await tx
      .update(handoffs)
      .set({ resolvedAt: now })
      .where(and(eq(handoffs.conversationId, conversationId), isNull(handoffs.resolvedAt)));
    // Closing the conversation never resolves tickets: those follow their own lifecycle.
    await appendMessage(
      tx,
      {
        conversationId,
        kind: "system",
        senderId: analyst.id,
        content: `Atendimento encerrado por ${analyst.name}`,
      },
      now,
    );
    return updated;
  });
}

export async function postAnalystMessage(
  analyst: SessionUser,
  conversationId: string,
  input: { clientId: string; text: string },
): Promise<MessageRow> {
  return db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, conversationId);
    if (!conversation) throw notFound("Conversa");
    const existing = await findMessageByClientId(tx, conversationId, input.clientId);
    if (existing) return existing;
    if (conversation.state !== "analyst_active" || conversation.assignedAnalystId !== analyst.id) {
      throw conflict("Assuma o atendimento para responder.");
    }
    return appendMessage(tx, {
      conversationId,
      kind: "analyst",
      senderId: analyst.id,
      content: input.text,
      clientId: input.clientId,
    });
  });
}

export async function latestHandoff(conversationId: string) {
  const rows = await db()
    .select()
    .from(handoffs)
    .where(eq(handoffs.conversationId, conversationId))
    .orderBy(desc(handoffs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * "Está escrevendo…" between people. Ownership and state are part of the
 * update itself: only the conversation's employee while a person handles it,
 * or the analyst who assumed it, can signal. Returns false when not allowed.
 */
export async function signalTyping(
  user: SessionUser,
  conversationId: string,
  typing: boolean,
): Promise<boolean> {
  const at = typing ? new Date() : null;
  const rows =
    user.role === "employee"
      ? await db()
          .update(conversations)
          .set({ employeeTypingAt: at })
          .where(
            and(
              eq(conversations.id, conversationId),
              eq(conversations.employeeId, user.id),
              inArray(conversations.state, ["waiting_analyst", "analyst_active"]),
            ),
          )
          .returning({ id: conversations.id })
      : await db()
          .update(conversations)
          .set({ analystTypingAt: at })
          .where(
            and(
              eq(conversations.id, conversationId),
              eq(conversations.assignedAnalystId, user.id),
              eq(conversations.state, "analyst_active"),
            ),
          )
          .returning({ id: conversations.id });
  return rows.length > 0;
}

/**
 * The employee's chat is open and visible (it only polls then): record it for
 * the console's "online" / "visto por último" and mark everything in the
 * conversation as read ("lida", ✓✓). Presence is written at most every 10 s;
 * the read mark moves as soon as there is something new to mark.
 */
export async function touchEmployeePresence(employeeId: string, conversationId: string) {
  const latest = sql`(select coalesce(max(seq), 0) from ${messages} where conversation_id = ${conversationId})`;
  await db()
    .update(conversations)
    .set({
      employeeSeenAt: new Date(),
      employeeReadSeq: sql`greatest(${conversations.employeeReadSeq}, ${latest})`,
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.employeeId, employeeId),
        or(
          isNull(conversations.employeeSeenAt),
          lt(conversations.employeeSeenAt, sql`now() - interval '10 seconds'`),
          lt(conversations.employeeReadSeq, latest),
        ),
      ),
    );
}

/**
 * "Nova conversa". Allowed when the current one is closed, still empty, or has
 * used up its message limit (PRD: 30 per session). While a person is handling
 * the employee and messages are left, the current one must go on. A session
 * that hit the limit with an analyst is closed for the analyst too, with a
 * system line saying why, so nobody is left waiting on it.
 */
export async function startNewConversation(employeeId: string, limit: number) {
  return db().transaction(async (tx) => {
    const live = await findLiveConversation(tx, employeeId);
    if (live) {
      const locked = await lockConversation(tx, live.id);
      if (!locked) throw conflict("Tente novamente.");
      const sent = await countEmployeeMessages(tx, locked.id);
      const exhausted = sent >= limit;
      if (locked.state !== "agent_active" && !exhausted) {
        throw conflict(
          locked.state === "waiting_analyst"
            ? "Sua conversa está na fila do service desk e um analista vai responder por ela. Continue por aqui."
            : "Você está sendo atendido por um analista nesta conversa. Continue por ela.",
        );
      }
      if (sent === 0 && locked.state === "agent_active") return locked;
      const now = new Date();
      await transitionConversation(tx, locked, "closed", {}, now);
      await tx
        .update(handoffs)
        .set({ resolvedAt: now })
        .where(and(eq(handoffs.conversationId, locked.id), isNull(handoffs.resolvedAt)));
      await appendMessage(
        tx,
        {
          conversationId: locked.id,
          kind: "system",
          senderId: null,
          content: exhausted
            ? `Sessão encerrada: limite de ${limit} mensagens atingido. O funcionário começou uma nova conversa`
            : "Sessão encerrada pelo funcionário para começar uma nova conversa",
        },
        now,
      );
    }
    return getOrCreateLiveConversation(tx, employeeId);
  });
}
