export const CONVERSATION_STATES = [
  "agent_active",
  "waiting_analyst",
  "analyst_active",
  "closed",
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export type ConversationEvent =
  "handoff_requested" | "analyst_claimed" | "returned_to_agent" | "closed";

/**
 * The only legal moves. Everything else is rejected on the server, so the agent
 * can never answer while a person owns the conversation.
 */
const TRANSITIONS: Record<
  ConversationState,
  Partial<Record<ConversationEvent, ConversationState>>
> = {
  agent_active: {
    handoff_requested: "waiting_analyst",
    analyst_claimed: "analyst_active",
    closed: "closed",
  },
  waiting_analyst: {
    analyst_claimed: "analyst_active",
    returned_to_agent: "agent_active",
    closed: "closed",
  },
  analyst_active: {
    returned_to_agent: "agent_active",
    closed: "closed",
  },
  closed: {},
};

export function nextState(
  current: ConversationState,
  event: ConversationEvent,
): ConversationState | null {
  return TRANSITIONS[current][event] ?? null;
}

export function agentMayRespond(state: ConversationState): boolean {
  return state === "agent_active";
}

export const STATE_LABEL: Record<ConversationState, string> = {
  agent_active: "Agent atendendo",
  waiting_analyst: "Aguardando atendente",
  analyst_active: "Analista atendendo",
  closed: "Encerrada",
};

export const MESSAGE_KINDS = ["employee", "agent", "analyst", "system"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
