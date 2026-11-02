import type { AssistantStatus } from "@/domain/assistant";
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
  /** Employee messages in this session and the PRD limit (30), whoever answers. */
  sessionMessageCount: number;
  sessionMessageLimit: number;
  assignedAnalyst: {
    id: string;
    name: string;
    supportLevel: string | null;
    /** The analyst's console is open right now (fresh heartbeat). */
    online: boolean;
    /** Last heartbeat: "offline há 5 min" counts from here. */
    lastSeenAt: string | null;
  } | null;
  employee: { id: string; name: string; email: string; department: string };
  lastActivityAt: string;
  closedAt: string | null;
  version: number;
  agentBusy: boolean;
  /** Who is typing right now (signals younger than TYPING_TTL_MS). */
  typing: { employee: boolean; analyst: boolean };
  /** The employee has this chat open and visible right now. */
  employeeOnline: boolean;
  /** Last time the chat was open and visible ("visto por último"). */
  employeeLastSeenAt: string | null;
  /** Messages up to this seq reached the employee's open chat ("lida", ✓✓). */
  employeeReadSeq: number;
};

export type MessagePageDTO = {
  conversation: ConversationDTO;
  messages: MessageDTO[];
  hasMoreBefore: boolean;
  /** Service-wide assistant health, refreshed by every poll. */
  assistant: AssistantStatus;
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
  employeeTyping: boolean;
  employeeOnline: boolean;
  /** The last message reached the employee's open chat (✓✓ vs ✓). */
  lastMessageRead: boolean;
  /** The agent is answering right now (a turn is running). */
  agentBusy: boolean;
  /** Waiting or assumed because of a critical case. */
  critical: boolean;
  /** Ever went to a person; a closed conversation without it was handled by the agent alone. */
  hadHandoff: boolean;
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
  /** Waiting conversations plus the analyst's own with unread messages: the rail badge. */
  attention: number;
};
