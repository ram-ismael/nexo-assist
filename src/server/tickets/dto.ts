import { inArray } from "drizzle-orm";
import { slaState } from "@/domain/sla";
import { isOpenStatus } from "@/domain/tickets";
import type { TicketDetailDTO, TicketListItemDTO } from "@/lib/api-types";
import type { Executor } from "@/server/db/client";
import { users } from "@/server/db/schema";
import type { TicketEventRow, TicketRow } from "./service";

export function toListItem(ticket: TicketRow, now: Date): TicketListItemDTO {
  return {
    number: ticket.number,
    type: ticket.type,
    title: ticket.title,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    updatedAt: ticket.updatedAt.toISOString(),
    createdAt: ticket.createdAt.toISOString(),
    slaDueAt: ticket.slaDueAt.toISOString(),
    overdue: isOpenStatus(ticket.status) && slaState(ticket.slaDueAt, now).overdue,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    version: ticket.version,
  };
}

export async function toDetail(
  executor: Executor,
  ticket: TicketRow,
  events: TicketEventRow[],
  now: Date,
): Promise<TicketDetailDTO> {
  const ids = [
    ...new Set([
      ticket.requesterId,
      ...events.map((event) => event.actorId).filter((id): id is string => !!id),
    ]),
  ];
  const people = await executor
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  const byId = new Map(people.map((person) => [person.id, person]));
  const requester = byId.get(ticket.requesterId);
  return {
    ...toListItem(ticket, now),
    description: ticket.description,
    subcategory: ticket.subcategory,
    scope: ticket.scope,
    slaLabel: ticket.slaPolicy.label,
    resolution: ticket.resolution,
    requester: { name: requester?.name ?? "", email: requester?.email ?? "" },
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      actorKind: event.actorKind,
      actorName: event.actorId ? (byId.get(event.actorId)?.name ?? null) : null,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
