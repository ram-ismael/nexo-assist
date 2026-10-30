import { and, eq, ne, sql } from "drizzle-orm";
import { classifyPriority, type PriorityFacts } from "@/domain/priority";
import { computeDueAt, slaPolicyFor, type BusinessCalendar } from "@/domain/sla";
import {
  PRIORITY_LABEL,
  type AffectedScope,
  type TicketCategory,
  type TicketType,
} from "@/domain/tickets";
import type { Executor } from "@/server/db/client";
import { ticketDrafts } from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/errors";
import type { DraftRow } from "@/server/conversations/repository";
import type { TicketRow } from "./service";
import { TicketService } from "./service";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type CreateDraftInput = {
  employeeId: string;
  conversationId: string;
  turnId: string | null;
  type: TicketType;
  category: TicketCategory;
  title: string;
  description: string;
  facts: Omit<PriorityFacts, "type">;
};

async function nextDraftCode(executor: Executor): Promise<string> {
  const result = await executor.execute<{ value: string }>(
    sql`select nextval('draft_code_seq')::text as value`,
  );
  return `D-${result.rows[0]?.value ?? Date.now()}`;
}

/** Older pending drafts in the same conversation are superseded by the new one. */
async function supersedePending(executor: Executor, conversationId: string, keepId?: string) {
  const conditions = [
    eq(ticketDrafts.conversationId, conversationId),
    eq(ticketDrafts.status, "pending"),
  ];
  if (keepId) conditions.push(ne(ticketDrafts.id, keepId));
  await executor
    .update(ticketDrafts)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(...conditions));
}

export async function createTicketDraft(
  executor: Executor,
  calendar: BusinessCalendar,
  input: CreateDraftInput,
  now = new Date(),
): Promise<DraftRow> {
  const facts: PriorityFacts = { ...input.facts, type: input.type };
  const decision = classifyPriority(facts);
  const policy = slaPolicyFor(decision.priority, calendar);
  await supersedePending(executor, input.conversationId);
  const inserted = await executor
    .insert(ticketDrafts)
    .values({
      code: await nextDraftCode(executor),
      kind: "create",
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      type: input.type,
      category: input.category,
      priority: decision.priority,
      scope: input.facts.scope,
      title: input.title,
      description: input.description,
      priorityFacts: facts,
      priorityRule: decision.rule,
      priorityExplanation: decision.explanation,
      // Preview only: the real deadline is computed again at confirmation time.
      slaDueAt: computeDueAt(now, policy, calendar),
      turnId: input.turnId,
      expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
    })
    .returning();
  const draft = inserted[0];
  if (!draft) throw new Error("Falha ao criar o rascunho");
  return draft;
}

export async function createChangeDraft(
  executor: Executor,
  input: {
    kind: "update" | "reopen";
    employeeId: string;
    conversationId: string;
    turnId: string | null;
    ticket: TicketRow;
    note: string;
  },
  now = new Date(),
): Promise<DraftRow> {
  await supersedePending(executor, input.conversationId);
  const inserted = await executor
    .insert(ticketDrafts)
    .values({
      code: await nextDraftCode(executor),
      kind: input.kind,
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      ticketId: input.ticket.id,
      type: input.ticket.type,
      category: input.ticket.category,
      priority: input.ticket.priority,
      scope: input.ticket.scope,
      title: input.ticket.title,
      note: input.note,
      turnId: input.turnId,
      expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
    })
    .returning();
  const draft = inserted[0];
  if (!draft) throw new Error("Falha ao criar o rascunho");
  return draft;
}

export async function findDraftForEmployee(
  executor: Executor,
  employeeId: string,
  draftId: string,
  options: { lock?: boolean } = {},
): Promise<DraftRow> {
  const query = executor
    .select()
    .from(ticketDrafts)
    .where(and(eq(ticketDrafts.id, draftId), eq(ticketDrafts.employeeId, employeeId)))
    .limit(1);
  const rows = options.lock ? await query.for("update") : await query;
  const draft = rows[0];
  if (!draft) throw notFound("Rascunho");
  return draft;
}

export type DraftEdit = {
  expectedVersion: number;
  title?: string;
  description?: string;
  note?: string;
  category?: TicketCategory;
  type?: TicketType;
  scope?: AffectedScope;
};

/** Edits recompute the priority from the stored facts: the employee never sets it directly. */
export async function editDraft(
  executor: Executor,
  calendar: BusinessCalendar,
  draft: DraftRow,
  edit: DraftEdit,
  now = new Date(),
): Promise<DraftRow> {
  assertPending(draft, now);
  if (draft.version !== edit.expectedVersion) {
    throw conflict("Este rascunho mudou desde que você o abriu. Confira a versão atual.");
  }
  const changes: Partial<typeof ticketDrafts.$inferInsert> = {
    updatedAt: now,
    version: draft.version + 1,
  };
  if (draft.kind === "create") {
    if (edit.title !== undefined) changes.title = edit.title;
    if (edit.description !== undefined) changes.description = edit.description;
    if (edit.category !== undefined) changes.category = edit.category;
    const baseFacts = draft.priorityFacts;
    if (baseFacts && (edit.type !== undefined || edit.scope !== undefined)) {
      const facts: PriorityFacts = {
        ...baseFacts,
        type: edit.type ?? baseFacts.type,
        scope: edit.scope ?? baseFacts.scope,
      };
      const decision = classifyPriority(facts);
      changes.type = facts.type;
      changes.scope = facts.scope;
      changes.priorityFacts = facts;
      changes.priority = decision.priority;
      changes.priorityRule = decision.rule;
      changes.priorityExplanation = decision.explanation;
      changes.slaDueAt = computeDueAt(now, slaPolicyFor(decision.priority, calendar), calendar);
    }
  } else if (edit.note !== undefined) {
    changes.note = edit.note;
  }
  const rows = await executor
    .update(ticketDrafts)
    .set(changes)
    .where(and(eq(ticketDrafts.id, draft.id), eq(ticketDrafts.version, draft.version)))
    .returning();
  const updated = rows[0];
  if (!updated)
    throw conflict("Este rascunho mudou desde que você o abriu. Confira a versão atual.");
  return updated;
}

function assertPending(draft: DraftRow, now: Date): void {
  if (draft.status === "confirmed") throw conflict("Este rascunho já foi confirmado.");
  if (draft.status === "cancelled")
    throw conflict("Este rascunho foi cancelado ou substituído por outro.");
  if (draft.status === "expired" || draft.expiresAt.getTime() < now.getTime()) {
    throw conflict("Este rascunho expirou. Peça ao Nexo para montar um novo.");
  }
}

export type ConfirmResult = { ticket: TicketRow; draft: DraftRow; alreadyConfirmed: boolean };

/**
 * The only path that creates, updates or reopens a ticket on behalf of an
 * employee. Runs inside the ticket-service transaction with the draft row
 * locked, so a double click or a retried request yields the same ticket.
 */
export async function confirmDraft(
  executor: Executor,
  service: TicketService,
  input: { employeeId: string; draftId: string; expectedVersion?: number },
  now = new Date(),
): Promise<ConfirmResult> {
  const draft = await findDraftForEmployee(executor, input.employeeId, input.draftId, {
    lock: true,
  });
  if (draft.status === "confirmed" && draft.resultTicketId) {
    const ticket = await service.findById(draft.resultTicketId);
    if (!ticket) throw notFound("Chamado");
    return { ticket, draft, alreadyConfirmed: true };
  }
  assertPending(draft, now);
  if (input.expectedVersion !== undefined && draft.version !== input.expectedVersion) {
    throw conflict("O rascunho foi alterado. Confira a versão atual antes de confirmar.");
  }

  const actor = { id: input.employeeId, kind: "employee" as const };
  let ticket: TicketRow;
  if (draft.kind === "create") {
    if (
      !draft.type ||
      !draft.category ||
      !draft.priority ||
      !draft.scope ||
      !draft.title ||
      !draft.description
    ) {
      throw new AppError(
        "validation",
        "O rascunho está incompleto. Complete os dados antes de confirmar.",
      );
    }
    ticket = await service.create(
      {
        requesterId: input.employeeId,
        type: draft.type,
        category: draft.category,
        priority: draft.priority,
        priorityRule: draft.priorityRule,
        scope: draft.scope,
        title: draft.title,
        description: draft.description,
        sourceConversationId: draft.conversationId,
      },
      actor,
      now,
    );
  } else {
    if (!draft.ticketId || !draft.note)
      throw new AppError("validation", "O rascunho está incompleto.");
    const target = await service.findById(draft.ticketId);
    if (!target || target.requesterId !== input.employeeId) throw notFound("Chamado");
    ticket =
      draft.kind === "reopen"
        ? await service.reopen(target, draft.note, actor, now)
        : await service.addEmployeeNote(target, draft.note, actor, now);
  }

  const rows = await executor
    .update(ticketDrafts)
    .set({
      status: "confirmed",
      resultTicketId: ticket.id,
      updatedAt: now,
      version: draft.version + 1,
    })
    .where(eq(ticketDrafts.id, draft.id))
    .returning();
  return { ticket, draft: rows[0] ?? draft, alreadyConfirmed: false };
}

export async function cancelDraft(executor: Executor, draft: DraftRow): Promise<DraftRow> {
  if (draft.status !== "pending") throw conflict("Este rascunho não está mais pendente.");
  const rows = await executor
    .update(ticketDrafts)
    .set({ status: "cancelled", updatedAt: new Date(), version: draft.version + 1 })
    .where(and(eq(ticketDrafts.id, draft.id), eq(ticketDrafts.status, "pending")))
    .returning();
  const updated = rows[0];
  if (!updated) throw conflict("Este rascunho não está mais pendente.");
  return updated;
}

export function confirmationText(draft: DraftRow, ticket: TicketRow): string {
  if (draft.kind === "reopen")
    return `Pronto: reabri o chamado ${ticket.number}. O prazo de atendimento recomeçou.`;
  if (draft.kind === "update") return `Pronto: adicionei a informação ao chamado ${ticket.number}.`;
  return `Pronto: abri o chamado ${ticket.number} com prioridade ${PRIORITY_LABEL[ticket.priority].toLowerCase()}. Prazo de resposta: ${ticket.slaPolicy.label}.`;
}
