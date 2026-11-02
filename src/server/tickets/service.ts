import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { computeDueAt, slaPolicyFor, slaState, type BusinessCalendar } from "@/domain/sla";
import {
  canAnalystMoveTo,
  canReopen,
  formatTicketNumber,
  isOpenStatus,
  OPEN_STATUSES,
  STATUS_LABEL,
  type AffectedScope,
  type Priority,
  type TicketCategory,
  type TicketStatus,
  type TicketType,
} from "@/domain/tickets";
import type { Executor } from "@/server/db/client";
import { ticketEvents, tickets } from "@/server/db/schema";
import { AppError, conflict } from "@/server/errors";
import type { TicketSnapshot } from "@/server/messages/blocks";

export type TicketRow = typeof tickets.$inferSelect;
export type TicketEventRow = typeof ticketEvents.$inferSelect;

type Actor = { id: string | null; kind: "employee" | "analyst" | "agent" | "system" };

type NewTicketInput = {
  requesterId: string;
  type: TicketType;
  category: TicketCategory;
  subcategory?: string | null;
  priority: Priority;
  priorityRule?: string | null;
  scope: AffectedScope;
  title: string;
  description: string;
  sourceConversationId?: string | null;
};

/**
 * The ticket service: the system of record for tickets. It is deliberately
 * independent from the agent; the agent reaches it through the gateway and the
 * use cases, like any other client would reach a corporate service-desk API.
 */
export class TicketService {
  constructor(
    private readonly executor: Executor,
    private readonly calendar: BusinessCalendar,
  ) {}

  async listForRequester(
    requesterId: string,
    options: { onlyOpen?: boolean; limit?: number } = {},
  ): Promise<TicketRow[]> {
    const conditions = [eq(tickets.requesterId, requesterId)];
    if (options.onlyOpen) conditions.push(inArray(tickets.status, [...OPEN_STATUSES]));
    return this.executor
      .select()
      .from(tickets)
      .where(and(...conditions))
      .orderBy(desc(tickets.updatedAt))
      .limit(options.limit ?? 50);
  }

  async findByNumber(number: string): Promise<TicketRow | null> {
    const rows = await this.executor
      .select()
      .from(tickets)
      .where(eq(tickets.number, number.trim().toUpperCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<TicketRow | null> {
    const rows = await this.executor.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /** Lookup scoped to the requester: another employee's ticket is simply "not found". */
  async findForRequester(requesterId: string, number: string): Promise<TicketRow | null> {
    const rows = await this.executor
      .select()
      .from(tickets)
      .where(
        and(eq(tickets.number, number.trim().toUpperCase()), eq(tickets.requesterId, requesterId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async events(ticketId: string): Promise<TicketEventRow[]> {
    return this.executor
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, ticketId))
      .orderBy(asc(ticketEvents.id));
  }

  async create(input: NewTicketInput, actor: Actor, now = new Date()): Promise<TicketRow> {
    const sequenceName = input.type === "INC" ? "inc_number_seq" : "req_number_seq";
    const result = await this.executor.execute<{ value: string }>(
      sql`select nextval(${sequenceName})::text as value`,
    );
    const sequence = Number(result.rows[0]?.value);
    if (!Number.isFinite(sequence)) throw new Error("Falha ao gerar o número do chamado");
    const policy = slaPolicyFor(input.priority, this.calendar);
    const inserted = await this.executor
      .insert(tickets)
      .values({
        number: formatTicketNumber(input.type, sequence),
        requesterId: input.requesterId,
        type: input.type,
        category: input.category,
        subcategory: input.subcategory ?? null,
        priority: input.priority,
        priorityRule: input.priorityRule ?? null,
        scope: input.scope,
        title: input.title,
        description: input.description,
        status: "open",
        slaStartedAt: now,
        slaDueAt: computeDueAt(now, policy, this.calendar),
        slaPolicy: { ...policy, timeZone: this.calendar.timeZone },
        sourceConversationId: input.sourceConversationId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const ticket = inserted[0];
    if (!ticket) throw new Error("Falha ao criar o chamado");
    await this.recordEvent(ticket.id, actor, "created", null, "open", null, now, {
      priority: input.priority,
      priorityRule: input.priorityRule ?? null,
    });
    return ticket;
  }

  /**
   * Employee complement. It does not restart the SLA: the deadline belongs to
   * the service desk and only a support update renews it.
   */
  async addEmployeeNote(
    ticket: TicketRow,
    note: string,
    actor: Actor,
    now = new Date(),
  ): Promise<TicketRow> {
    if (!isOpenStatus(ticket.status)) {
      throw conflict(
        `O chamado ${ticket.number} não está aberto. Ele pode ser reaberto se foi resolvido há até 7 dias.`,
      );
    }
    const updated = await this.bump(ticket, { updatedAt: now }, now);
    await this.recordEvent(ticket.id, actor, "employee_note", null, null, note, now);
    return updated;
  }

  async reopen(
    ticket: TicketRow,
    note: string,
    actor: Actor,
    now = new Date(),
  ): Promise<TicketRow> {
    if (!canReopen(ticket, now)) {
      throw conflict(
        `O chamado ${ticket.number} não pode ser reaberto: só chamados resolvidos há até 7 dias podem voltar.`,
      );
    }
    const policy = slaPolicyFor(ticket.priority, this.calendar);
    const updated = await this.bump(
      ticket,
      {
        status: "open",
        resolvedAt: null,
        slaStartedAt: now,
        slaDueAt: computeDueAt(now, policy, this.calendar),
        slaPolicy: { ...policy, timeZone: this.calendar.timeZone },
        updatedAt: now,
      },
      now,
    );
    await this.recordEvent(ticket.id, actor, "reopened", ticket.status, "open", note, now);
    return updated;
  }

  /** Transfer to the human queue (PRD: the ticket service can "transferir chamados"). */
  async transfer(
    ticket: TicketRow,
    actor: Actor,
    reason: string,
    now = new Date(),
  ): Promise<TicketRow> {
    if (!isOpenStatus(ticket.status)) return ticket;
    const updated =
      ticket.status === "waiting_analyst"
        ? ticket
        : await this.bump(ticket, { status: "waiting_analyst", updatedAt: now }, now);
    await this.recordEvent(
      ticket.id,
      actor,
      "transferred",
      ticket.status,
      "waiting_analyst",
      reason,
      now,
    );
    return updated;
  }

  /** Analyst update: changes status and/or adds a note, renewing the SLA window. */
  async analystUpdate(
    ticket: TicketRow,
    input: { status?: TicketStatus; note?: string; expectedVersion: number },
    actor: Actor,
    now = new Date(),
  ): Promise<TicketRow> {
    if (ticket.version !== input.expectedVersion) {
      throw conflict("Este chamado foi alterado por outra pessoa. Recarregue e tente de novo.", {
        currentVersion: ticket.version,
      });
    }
    const target = input.status ?? ticket.status;
    if (
      input.status &&
      input.status !== ticket.status &&
      !canAnalystMoveTo(ticket.status, input.status)
    ) {
      throw new AppError(
        "validation",
        `Não é possível mudar de "${STATUS_LABEL[ticket.status]}" para "${STATUS_LABEL[input.status]}".`,
      );
    }
    const policy = slaPolicyFor(ticket.priority, this.calendar);
    const resolving = target === "resolved" && ticket.status !== "resolved";
    const updated = await this.bump(
      ticket,
      {
        status: target,
        slaStartedAt: now,
        slaDueAt: computeDueAt(now, policy, this.calendar),
        resolvedAt: resolving
          ? now
          : target === "resolved" || target === "closed"
            ? ticket.resolvedAt
            : null,
        resolution: resolving ? (input.note ?? ticket.resolution) : ticket.resolution,
        assigneeId: actor.id,
        updatedAt: now,
      },
      now,
    );
    await this.recordEvent(
      ticket.id,
      actor,
      target !== ticket.status ? "status_changed" : "analyst_note",
      ticket.status,
      target,
      input.note ?? null,
      now,
    );
    return updated;
  }

  /** Conditional update on version: a stale writer gets a conflict instead of overwriting. */
  private async bump(
    ticket: TicketRow,
    changes: Partial<typeof tickets.$inferInsert>,
    now: Date,
  ): Promise<TicketRow> {
    const rows = await this.executor
      .update(tickets)
      .set({ ...changes, version: ticket.version + 1, updatedAt: changes.updatedAt ?? now })
      .where(and(eq(tickets.id, ticket.id), eq(tickets.version, ticket.version)))
      .returning();
    const updated = rows[0];
    if (!updated) {
      throw conflict(
        `O chamado ${ticket.number} foi alterado enquanto você agia. Tente novamente.`,
      );
    }
    return updated;
  }

  private async recordEvent(
    ticketId: string,
    actor: Actor,
    action: string,
    fromStatus: TicketStatus | null,
    toStatus: TicketStatus | null,
    note: string | null,
    now: Date,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.executor.insert(ticketEvents).values({
      ticketId,
      actorId: actor.id,
      actorKind: actor.kind,
      action,
      fromStatus,
      toStatus,
      note,
      metadata: metadata ?? null,
      createdAt: now,
    });
  }
}

export function ticketSnapshot(ticket: TicketRow, now: Date): TicketSnapshot {
  const open = isOpenStatus(ticket.status);
  return {
    number: ticket.number,
    type: ticket.type,
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    subcategory: ticket.subcategory,
    priority: ticket.priority,
    scope: ticket.scope,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    slaDueAt: ticket.slaDueAt.toISOString(),
    slaLabel: ticket.slaPolicy.label,
    overdue: open && slaState(ticket.slaDueAt, now).overdue,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
  };
}
