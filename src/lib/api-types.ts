import type { ConversationState, MessageKind } from "@/domain/conversations";
import type {
  AffectedScope,
  Priority,
  TicketCategory,
  TicketStatus,
  TicketType,
} from "@/domain/tickets";
import type { MessageBlock, TicketSnapshot } from "@/server/messages/blocks";

export type { MessageBlock, TicketSnapshot };

export type DraftDTO = {
  id: string;
  code: string;
  kind: "create" | "update" | "reopen";
  status: "pending" | "confirmed" | "cancelled" | "expired";
  type: TicketType | null;
  category: TicketCategory | null;
  priority: Priority | null;
  scope: AffectedScope | null;
  title: string | null;
  description: string | null;
  note: string | null;
  priorityExplanation: string | null;
  slaDueAt: string | null;
  targetTicketNumber: string | null;
  resultTicketNumber: string | null;
  version: number;
  expiresAt: string;
};

export type ActionDTO = { tool: string; label: string; status: string };

export type MessageDTO = {
  id: string;
  seq: number;
  kind: MessageKind;
  content: string;
  blocks: MessageBlock[];
  drafts: Record<string, DraftDTO>;
  createdAt: string;
  sender: { name: string; supportLevel: string | null } | null;
  turnId: string | null;
  actions: ActionDTO[];
};

export type ConversationDTO = {
  id: string;
  state: ConversationState;
  agentTurnCount: number;
  agentTurnLimit: number;
  assignedAnalyst: { id: string; name: string; supportLevel: string | null } | null;
  employee: { id: string; name: string; email: string; department: string };
  lastActivityAt: string;
  closedAt: string | null;
  version: number;
  agentBusy: boolean;
};

export type MessagePageDTO = {
  conversation: ConversationDTO;
  messages: MessageDTO[];
  hasMoreBefore: boolean;
};

export type DecisionDTO = {
  turnId: string;
  status: "running" | "completed" | "failed" | "discarded";
  model: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: string;
  errorCode: string | null;
  decision: {
    intent: string;
    understanding: string;
    action: string;
    certainty: "alta" | "media" | "baixa";
    reason: string;
    rules: string[];
    missingInformation: string[];
    escalationReason: string | null;
    source: "agent" | "system";
  } | null;
  actions: {
    tool: string;
    label: string;
    status: string;
    summary: string;
    durationMs: number;
    input: Record<string, unknown> | null;
    output: Record<string, unknown> | null;
  }[];
};

export type TicketListItemDTO = {
  number: string;
  type: TicketType;
  title: string;
  category: TicketCategory;
  priority: Priority;
  status: TicketStatus;
  updatedAt: string;
  createdAt: string;
  slaDueAt: string;
  overdue: boolean;
  resolvedAt: string | null;
  version: number;
};

export type TicketDetailDTO = TicketListItemDTO & {
  description: string;
  subcategory: string | null;
  scope: AffectedScope;
  slaLabel: string;
  resolution: string | null;
  requester: { name: string; email: string };
  events: {
    id: number;
    action: string;
    actorKind: string;
    actorName: string | null;
    fromStatus: TicketStatus | null;
    toStatus: TicketStatus | null;
    note: string | null;
    createdAt: string;
  }[];
};

export type QueueItemDTO = {
  id: string;
  state: ConversationState;
  employee: { id: string; name: string; department: string };
  lastMessagePreview: string | null;
  lastMessageKind: MessageKind | null;
  lastActivityAt: string;
  unread: number;
  assignedAnalyst: { id: string; name: string } | null;
  handoff: {
    reason: string;
    respondBy: string | null;
    ticketNumber: string | null;
    createdAt: string;
  } | null;
  lowCertainty: boolean;
};

export type ApiError = {
  error: { code: string; message: string; requestId: string; details?: Record<string, unknown> };
};

export type ConversationDetailDTO = {
  conversation: ConversationDTO;
  focusTicketNumber: string | null;
  handoff: {
    reason: string;
    origin: string;
    summary: string;
    targetLevel: string;
    respondBy: string | null;
    createdAt: string;
    claimedAt: string | null;
    claimedBy: string | null;
    resolvedAt: string | null;
  } | null;
};

export type QueueResponseDTO = {
  items: QueueItemDTO[];
  counts: Record<"all" | "for_you" | "with_agent" | "mine", number>;
};
