import type {
  AffectedScope,
  Priority,
  TicketCategory,
  TicketStatus,
  TicketType,
} from "@/domain/tickets";

/** Snapshot of a ticket as it was when the agent showed it. */
export type TicketSnapshot = {
  number: string;
  type: TicketType;
  title: string;
  description: string;
  category: TicketCategory;
  subcategory: string | null;
  priority: Priority;
  scope: AffectedScope;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  slaDueAt: string;
  slaLabel: string;
  overdue: boolean;
  resolvedAt: string | null;
};

/**
 * Structured UI attached to a message. Blocks are produced by tools (never by
 * free text), so a ticket card always reflects a real record.
 */
export type MessageBlock =
  | { type: "quick_replies"; question: string | null; options: string[] }
  | {
      type: "ticket_selection";
      prompt: string;
      tickets: Pick<TicketSnapshot, "number" | "title" | "status" | "updatedAt" | "overdue">[];
    }
  | { type: "ticket_card"; ticket: TicketSnapshot }
  | { type: "draft"; draftId: string }
  | { type: "handoff"; level: string; reason: string; respondBy: string | null }
  | { type: "knowledge"; articles: { id: string; title: string }[] }
  | { type: "notice"; tone: "info" | "warning" | "error"; text: string };
