import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import {
  nextState,
  type ConversationEvent,
  type ConversationState,
  type MessageKind,
} from "@/domain/conversations";
import type { Executor } from "@/server/db/client";
import {
  agentActions,
  agentTurns,
  conversations,
  messages,
  ticketDrafts,
  tickets,
  users,
} from "@/server/db/schema";
import { conflict } from "@/server/errors";
import type { MessageBlock } from "@/server/messages/blocks";

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type DraftRow = typeof ticketDrafts.$inferSelect;

export async function findConversation(
  executor: Executor,
  id: string,
): Promise<ConversationRow | null> {
  const rows = await executor.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function lockConversation(
  executor: Executor,
  id: string,
): Promise<ConversationRow | null> {
  const rows = await executor
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

export async function findLiveConversation(
  executor: Executor,
  employeeId: string,
): Promise<ConversationRow | null> {
  const rows = await executor
    .select()
    .from(conversations)
    .where(and(eq(conversations.employeeId, employeeId), sql`${conversations.state} <> 'closed'`))
    .limit(1);
  return rows[0] ?? null;
}

/** Race-safe: the partial unique index guarantees one live conversation per employee. */
export async function getOrCreateLiveConversation(
  executor: Executor,
  employeeId: string,
): Promise<ConversationRow> {
  const existing = await findLiveConversation(executor, employeeId);
  if (existing) return existing;
  const inserted = await executor
    .insert(conversations)
    .values({ employeeId })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const raced = await findLiveConversation(executor, employeeId);
  if (!raced) throw new Error("Falha ao abrir a conversa");
  return raced;
}

export async function listEmployeeConversations(
  executor: Executor,
  employeeId: string,
  limit = 20,
) {
  return executor
    .select({
      id: conversations.id,
      state: conversations.state,
      lastMessagePreview: conversations.lastMessagePreview,
      // What the conversation was about: the employee's first message. The outer
      // column is qualified by hand: inside a select list Drizzle renders it as a
      // bare "id", which the subquery would resolve to the message's own id.
      topic: sql<string | null>`(
        select m.content from ${messages} m
        where m.conversation_id = "conversations"."id" and m.kind = 'employee'
        order by m.seq limit 1
      )`,
      lastActivityAt: conversations.lastActivityAt,
      createdAt: conversations.createdAt,
      closedAt: conversations.closedAt,
    })
    .from(conversations)
    .where(eq(conversations.employeeId, employeeId))
    .orderBy(desc(conversations.lastActivityAt))
    .limit(limit);
}

export async function appendMessage(
  executor: Executor,
  input: {
    conversationId: string;
    kind: MessageKind;
    senderId: string | null;
    content: string;
    blocks?: MessageBlock[];
    turnId?: string | null;
    clientId?: string | null;
  },
  now = new Date(),
): Promise<MessageRow> {
  const preview = input.content.trim() || describeBlocks(input.blocks ?? []);
  // Touch the conversation first: the row lock it takes serializes writers of
  // the same conversation, so seq order equals commit order and the `after=<seq>`
  // polling cursor can never skip a message that commits late.
  await executor
    .update(conversations)
    .set({
      lastMessagePreview: preview.slice(0, 160),
      lastMessageKind: input.kind,
      lastActivityAt: now,
      updatedAt: now,
      // The message itself ends the "está escrevendo…" of whoever sent it,
      // in the same commit, so the indicator never outlives the message.
      ...(input.kind === "employee" ? { employeeTypingAt: null } : {}),
      ...(input.kind === "analyst" ? { analystTypingAt: null } : {}),
    })
    .where(eq(conversations.id, input.conversationId));
  const inserted = await executor
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      kind: input.kind,
      senderId: input.senderId,
      content: input.content,
      blocks: input.blocks ?? [],
      turnId: input.turnId ?? null,
      clientId: input.clientId ?? null,
      createdAt: now,
    })
    .returning();
  const message = inserted[0];
  if (!message) throw new Error("Falha ao gravar a mensagem");
  return message;
}

function describeBlocks(blocks: MessageBlock[]): string {
  const first = blocks[0];
  if (!first) return "";
  switch (first.type) {
    case "ticket_card":
      return `Chamado ${first.ticket.number}`;
    case "draft":
      return "Rascunho de chamado";
    case "ticket_selection":
      return first.prompt;
    case "handoff":
      return "Transferida para um analista";
    default:
      return "";
  }
}

/**
 * Messages the employee sent in this conversation: the PRD's "30 mensagens por
 * sessão", whoever answers them (assistant or analyst). Read from the stored
 * messages themselves, so it can never drift from what is on screen.
 */
export async function countEmployeeMessages(
  executor: Executor,
  conversationId: string,
): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.kind, "employee")));
  return Number(rows[0]?.count ?? 0);
}

export async function findMessageByClientId(
  executor: Executor,
  conversationId: string,
  clientId: string,
): Promise<MessageRow | null> {
  const rows = await executor
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.clientId, clientId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Applies a lifecycle event with a conditional update on the current state, so
 * two concurrent transitions can never both succeed.
 */
export async function transitionConversation(
  executor: Executor,
  conversation: ConversationRow,
  event: ConversationEvent,
  changes: Partial<typeof conversations.$inferInsert> = {},
  now = new Date(),
): Promise<ConversationRow> {
  const target = nextState(conversation.state, event);
  if (!target) {
    throw conflict(stateConflictMessage(conversation.state, event), { state: conversation.state });
  }
  const rows = await executor
    .update(conversations)
    .set({
      ...changes,
      state: target,
      version: conversation.version + 1,
      updatedAt: now,
      lastActivityAt: now,
      closedAt: target === "closed" ? now : conversation.closedAt,
    })
    .where(
      and(eq(conversations.id, conversation.id), eq(conversations.version, conversation.version)),
    )
    .returning();
  const updated = rows[0];
  if (!updated) {
    throw conflict("A conversa mudou de estado enquanto você agia. A tela foi atualizada.", {
      state: conversation.state,
    });
  }
  return updated;
}

function stateConflictMessage(state: ConversationState, event: ConversationEvent): string {
  if (state === "closed") return "Esta conversa já foi encerrada.";
  if (event === "analyst_claimed" && state === "analyst_active") {
    return "Outro analista já assumiu esta conversa.";
  }
  if (event === "handoff_requested" && state !== "agent_active") {
    return "Esta conversa já está com a equipe de atendimento.";
  }
  if (event === "returned_to_agent" && state === "agent_active") {
    return "Esta conversa já está com o agent.";
  }
  return "Esta ação não é possível no estado atual da conversa.";
}

type MessagePage = {
  messages: MessageRow[];
  hasMoreBefore: boolean;
};

/** Cursor pagination on the monotonic seq: the latest page first, older pages on demand. */
export async function pageMessages(
  executor: Executor,
  conversationId: string,
  options: { before?: number; after?: number; limit: number },
): Promise<MessagePage> {
  if (options.after !== undefined) {
    const rows = await executor
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), gt(messages.seq, options.after)))
      .orderBy(asc(messages.seq))
      .limit(options.limit);
    return { messages: rows, hasMoreBefore: false };
  }
  const conditions = [eq(messages.conversationId, conversationId)];
  if (options.before !== undefined) conditions.push(lt(messages.seq, options.before));
  const rows = await executor
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.seq))
    .limit(options.limit + 1);
  const hasMoreBefore = rows.length > options.limit;
  return { messages: rows.slice(0, options.limit).reverse(), hasMoreBefore };
}

export async function loadSenders(executor: Executor, ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; supportLevel: string | null }>();
  const rows = await executor
    .select({ id: users.id, name: users.name, supportLevel: users.supportLevel })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.id, { name: row.name, supportLevel: row.supportLevel }]));
}

export async function loadActionsForTurns(executor: Executor, turnIds: string[]) {
  if (turnIds.length === 0)
    return new Map<string, { tool: string; label: string; status: string }[]>();
  const rows = await executor
    .select({
      turnId: agentActions.turnId,
      tool: agentActions.tool,
      label: agentActions.label,
      status: agentActions.status,
    })
    .from(agentActions)
    .where(and(inArray(agentActions.turnId, turnIds), eq(agentActions.visible, true)))
    .orderBy(asc(agentActions.id));
  const map = new Map<string, { tool: string; label: string; status: string }[]>();
  for (const row of rows) {
    const list = map.get(row.turnId) ?? [];
    list.push({ tool: row.tool, label: row.label, status: row.status });
    map.set(row.turnId, list);
  }
  return map;
}

export async function loadDrafts(executor: Executor, ids: string[]) {
  if (ids.length === 0)
    return new Map<
      string,
      DraftRow & { resultNumber: string | null; targetNumber: string | null }
    >();
  const rows = await executor
    .select({ draft: ticketDrafts, resultNumber: tickets.number })
    .from(ticketDrafts)
    .leftJoin(tickets, eq(tickets.id, ticketDrafts.resultTicketId))
    .where(inArray(ticketDrafts.id, ids));
  const targetIds = rows.map((row) => row.draft.ticketId).filter((id): id is string => !!id);
  const targets =
    targetIds.length > 0
      ? await executor
          .select({ id: tickets.id, number: tickets.number })
          .from(tickets)
          .where(inArray(tickets.id, targetIds))
      : [];
  const targetMap = new Map(targets.map((row) => [row.id, row.number]));
  return new Map(
    rows.map((row) => [
      row.draft.id,
      {
        ...row.draft,
        resultNumber: row.resultNumber,
        targetNumber: row.draft.ticketId ? (targetMap.get(row.draft.ticketId) ?? null) : null,
      },
    ]),
  );
}

/**
 * Longer than any turn can live: the chat route stops at 60 s (`maxDuration`)
 * and the model call at LLM_TIMEOUT_MS. A turn still "running" after this was
 * killed with its function and will never finish on its own.
 */
export const ABANDONED_TURN_MS = 2 * 60_000;

function abandonedBefore(now: Date): Date {
  return new Date(now.getTime() - ABANDONED_TURN_MS);
}

export async function hasRunningTurn(
  executor: Executor,
  conversationId: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await executor
    .select({ id: agentTurns.id })
    .from(agentTurns)
    .where(
      and(
        eq(agentTurns.conversationId, conversationId),
        eq(agentTurns.status, "running"),
        gt(agentTurns.startedAt, abandonedBefore(now)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function hasAbandonedTurn(
  executor: Executor,
  conversationId: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await executor
    .select({ id: agentTurns.id })
    .from(agentTurns)
    .where(
      and(
        eq(agentTurns.conversationId, conversationId),
        eq(agentTurns.status, "running"),
        lt(agentTurns.startedAt, abandonedBefore(now)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Closes turns whose function died mid-answer, like a failed turn: the session
 * quota is given back and the employee sees that the answer was interrupted.
 * Call with the conversation row locked.
 */
export async function reapAbandonedTurns(
  executor: Executor,
  conversationId: string,
  now = new Date(),
): Promise<number> {
  const reaped = await executor
    .update(agentTurns)
    .set({ status: "failed", errorCode: "abandoned", finishedAt: now })
    .where(
      and(
        eq(agentTurns.conversationId, conversationId),
        eq(agentTurns.status, "running"),
        lt(agentTurns.startedAt, abandonedBefore(now)),
      ),
    )
    .returning({ id: agentTurns.id });
  if (reaped.length === 0) return 0;
  await executor
    .update(conversations)
    .set({
      agentTurnCount: sql`greatest(${conversations.agentTurnCount} - ${reaped.length}, 0)`,
    })
    .where(eq(conversations.id, conversationId));
  for (const turn of reaped) {
    await appendMessage(
      executor,
      {
        conversationId,
        kind: "system",
        senderId: null,
        content: "O Nexo Assist não conseguiu responder: a resposta foi interrompida",
        blocks: [
          {
            type: "notice",
            tone: "error",
            text: "Sua mensagem foi registrada. Envie de novo ou fale com um analista.",
          },
        ],
        turnId: turn.id,
      },
      now,
    );
  }
  return reaped.length;
}
