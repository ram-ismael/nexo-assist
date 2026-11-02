import { eq, inArray } from "drizzle-orm";
import type { ConversationDTO, DraftDTO, MessageDTO } from "@/lib/api-types";
import type { Executor } from "@/server/db/client";
import { analystOnline } from "@/domain/presence";
import { analystPresence, users } from "@/server/db/schema";
import {
  countEmployeeMessages,
  hasRunningTurn,
  loadActionsForTurns,
  loadDrafts,
  loadSenders,
  type ConversationRow,
  type DraftRow,
  type MessageRow,
} from "./repository";

export function draftToDTO(
  draft: DraftRow & { resultNumber: string | null; targetNumber: string | null },
): DraftDTO {
  return {
    id: draft.id,
    code: draft.code,
    kind: draft.kind,
    status: draft.status,
    type: draft.type,
    category: draft.category,
    priority: draft.priority,
    scope: draft.scope,
    title: draft.title,
    description: draft.description,
    note: draft.note,
    priorityExplanation: draft.priorityExplanation,
    slaDueAt: draft.slaDueAt?.toISOString() ?? null,
    targetTicketNumber: draft.targetNumber,
    resultTicketNumber: draft.resultNumber,
    version: draft.version,
    expiresAt: draft.expiresAt.toISOString(),
  };
}

/** Batched: one query per related table for a whole page, no N+1. */
export async function serializeMessages(
  executor: Executor,
  rows: MessageRow[],
): Promise<MessageDTO[]> {
  const senderIds = [
    ...new Set(rows.map((row) => row.senderId).filter((id): id is string => !!id)),
  ];
  const turnIds = [...new Set(rows.map((row) => row.turnId).filter((id): id is string => !!id))];
  const draftIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.blocks.filter((block) => block.type === "draft").map((block) => block.draftId),
      ),
    ),
  ];
  const [senders, actions, drafts] = await Promise.all([
    loadSenders(executor, senderIds),
    loadActionsForTurns(executor, turnIds),
    loadDrafts(executor, draftIds),
  ]);
  return rows.map((row) => {
    const messageDrafts: Record<string, DraftDTO> = {};
    for (const block of row.blocks) {
      if (block.type !== "draft") continue;
      const draft = drafts.get(block.draftId);
      if (draft) messageDrafts[draft.id] = draftToDTO(draft);
    }
    return {
      id: row.id,
      seq: row.seq,
      kind: row.kind,
      content: row.content,
      blocks: row.blocks,
      drafts: messageDrafts,
      createdAt: row.createdAt.toISOString(),
      sender: row.senderId ? (senders.get(row.senderId) ?? null) : null,
      turnId: row.turnId,
      actions: row.turnId && row.kind === "agent" ? (actions.get(row.turnId) ?? []) : [],
    };
  });
}

/** A typing signal stays valid this long; clients refresh it every ~3 s while typing. */
export const TYPING_TTL_MS = 6_000;
/** The employee's chat polls every 2–3.5 s while visible; 20 s without one means away. */
export const ONLINE_TTL_MS = 20_000;

function typingNow(at: Date | null, now: number): boolean {
  return !!at && now - at.getTime() < TYPING_TTL_MS;
}

export function employeeOnline(seenAt: Date | null, now = Date.now()): boolean {
  return !!seenAt && now - seenAt.getTime() < ONLINE_TTL_MS;
}

export function employeeTyping(
  conversation: { state: string; employeeTypingAt: Date | null },
  now = Date.now(),
): boolean {
  return (
    conversation.state !== "closed" &&
    conversation.state !== "agent_active" &&
    typingNow(conversation.employeeTypingAt, now)
  );
}

export async function serializeConversation(
  executor: Executor,
  conversation: ConversationRow,
  sessionMessageLimit: number,
): Promise<ConversationDTO> {
  const ids = [conversation.employeeId, conversation.assignedAnalystId].filter(
    (id): id is string => !!id,
  );
  const [people, presence, busy, sent] = await Promise.all([
    executor
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        department: users.department,
        supportLevel: users.supportLevel,
      })
      .from(users)
      .where(ids.length === 1 ? eq(users.id, conversation.employeeId) : inArray(users.id, ids)),
    conversation.assignedAnalystId
      ? executor
          .select({
            lastHeartbeatAt: analystPresence.lastHeartbeatAt,
            leftAt: analystPresence.leftAt,
          })
          .from(analystPresence)
          .where(eq(analystPresence.analystId, conversation.assignedAnalystId))
          .then((rows) => rows[0] ?? null)
      : null,
    hasRunningTurn(executor, conversation.id),
    countEmployeeMessages(executor, conversation.id),
  ]);
  const employee = people.find((person) => person.id === conversation.employeeId);
  const analyst = people.find((person) => person.id === conversation.assignedAnalystId);
  if (!employee) throw new Error("Conversa sem funcionário");
  return {
    id: conversation.id,
    state: conversation.state,
    sessionMessageCount: sent,
    sessionMessageLimit,
    assignedAnalyst: analyst
      ? {
          id: analyst.id,
          name: analyst.name,
          supportLevel: analyst.supportLevel,
          online: !!presence && analystOnline(presence),
          lastSeenAt: presence?.lastHeartbeatAt.toISOString() ?? null,
        }
      : null,
    employee: {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      department: employee.department,
    },
    lastActivityAt: conversation.lastActivityAt.toISOString(),
    closedAt: conversation.closedAt?.toISOString() ?? null,
    version: conversation.version,
    agentBusy: busy,
    typing: {
      // Only meaningful while a person is on the other side.
      employee: employeeTyping(conversation),
      analyst:
        conversation.state === "analyst_active" &&
        typingNow(conversation.analystTypingAt, Date.now()),
    },
    employeeOnline: employeeOnline(conversation.employeeSeenAt),
    employeeLastSeenAt: conversation.employeeSeenAt?.toISOString() ?? null,
    employeeReadSeq: conversation.employeeReadSeq,
  };
}
