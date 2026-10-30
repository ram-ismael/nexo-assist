export const TICKET_TYPES = ["INC", "REQ"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_CATEGORIES = [
  "Acesso",
  "Rede e VPN",
  "Hardware",
  "Software",
  "E-mail",
  "Outros",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const PRIORITIES = ["critica", "alta", "media", "baixa"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const AFFECTED_SCOPES = ["self", "team", "company"] as const;
export type AffectedScope = (typeof AFFECTED_SCOPES)[number];

export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_analyst",
  "approved",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Statuses in which the ticket still owes the employee an answer. */
export const OPEN_STATUSES: readonly TicketStatus[] = [
  "open",
  "in_progress",
  "waiting_analyst",
  "approved",
];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Aberto",
  in_progress: "Em andamento",
  waiting_analyst: "Aguardando analista",
  approved: "Aprovado",
  resolved: "Resolvido",
  closed: "Fechado",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const SCOPE_LABEL: Record<AffectedScope, string> = {
  self: "Somente você",
  team: "Equipe",
  company: "Toda a empresa",
};

/** The same scopes seen from the service desk side (the employee is not "você"). */
export const SCOPE_LABEL_DESK: Record<AffectedScope, string> = {
  self: "Só quem abriu",
  team: "Equipe",
  company: "Toda a empresa",
};

export const TYPE_LABEL: Record<TicketType, string> = {
  INC: "Incidente",
  REQ: "Requisição",
};

export const REOPEN_WINDOW_DAYS = 7;

export function isOpenStatus(status: TicketStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/**
 * PRD rule: a ticket resolved up to seven days ago may be reopened.
 * Closed tickets (formally closed after resolution) are never reopened.
 */
export function canReopen(
  ticket: { status: TicketStatus; resolvedAt: Date | null },
  now: Date,
): boolean {
  if (ticket.status !== "resolved" || !ticket.resolvedAt) return false;
  const ageMs = now.getTime() - ticket.resolvedAt.getTime();
  return ageMs >= 0 && ageMs <= REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Analyst-side status transitions. Reopening is handled separately by canReopen. */
const ANALYST_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["in_progress", "waiting_analyst", "approved", "resolved"],
  in_progress: ["waiting_analyst", "approved", "resolved"],
  waiting_analyst: ["in_progress", "approved", "resolved"],
  approved: ["in_progress", "resolved"],
  resolved: ["closed", "in_progress"],
  closed: [],
};

export function canAnalystMoveTo(from: TicketStatus, to: TicketStatus): boolean {
  return ANALYST_TRANSITIONS[from].includes(to);
}

export function formatTicketNumber(type: TicketType, sequence: number): string {
  return `${type}-${sequence}`;
}

const TICKET_NUMBER_PATTERN = /^(INC|REQ)-(\d{3,9})$/;

export function parseTicketNumber(value: string): { type: TicketType; sequence: number } | null {
  const match = TICKET_NUMBER_PATTERN.exec(value.trim().toUpperCase());
  if (!match) return null;
  return { type: match[1] as TicketType, sequence: Number(match[2]) };
}
