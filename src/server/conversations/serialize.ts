import { eq, inArray } from "drizzle-orm";
import type { ConversationDTO, DraftDTO, MessageDTO } from "@/lib/api-types";
import type { Executor } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
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

export async function serializeConversation(
  executor: Executor,
  conversation: ConversationRow,
  agentTurnLimit: number,
): Promise<ConversationDTO> {
  const ids = [conversation.employeeId, conversation.assignedAnalystId].filter(
    (id): id is string => !!id,
  );
  const [people, busy] = await Promise.all([
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
    hasRunningTurn(executor, conversation.id),
  ]);
  const employee = people.find((person) => person.id === conversation.employeeId);
  const analyst = people.find((person) => person.id === conversation.assignedAnalystId);
  if (!employee) throw new Error("Conversa sem funcionário");
  return {
    id: conversation.id,
    state: conversation.state,
    agentTurnCount: conversation.agentTurnCount,
    agentTurnLimit,
    assignedAnalyst: analyst
      ? { id: analyst.id, name: analyst.name, supportLevel: analyst.supportLevel }
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
  };
}
