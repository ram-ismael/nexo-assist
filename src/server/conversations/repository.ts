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
  const preview = input.content.trim() || describeBlocks(input.blocks ?? []);
  await executor
    .update(conversations)
    .set({
      lastMessagePreview: preview.slice(0, 160),
      lastMessageKind: input.kind,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(conversations.id, input.conversationId));
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

export type MessagePage = {
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

export async function hasRunningTurn(executor: Executor, conversationId: string): Promise<boolean> {
  const rows = await executor
    .select({ id: agentTurns.id })
    .from(agentTurns)
    .where(and(eq(agentTurns.conversationId, conversationId), eq(agentTurns.status, "running")))
    .limit(1);
  return rows.length > 0;
}
