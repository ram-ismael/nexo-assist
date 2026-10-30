import { z } from "zod";
import { TICKET_STATUSES } from "@/domain/tickets";
import { assertCanViewTicket } from "@/server/auth/policies";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { json, readJson, route } from "@/server/http";
import { audit } from "@/server/conversations/use-cases";
import { callTicketService } from "@/server/tickets/gateway";
import { toDetail } from "@/server/tickets/dto";

export const GET = route<"user", { number: string }>("user", async ({ user, params }) => {
  const result = await callTicketService("getTicket", async (service) => {
    const ticket = await service.findByNumber(params.number);
    assertCanViewTicket(user, ticket);
    return { ticket, events: await service.events(ticket.id) };
  });
  return json({ ticket: await toDetail(db(), result.ticket, result.events, new Date()) });
});

const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: z.enum(TICKET_STATUSES).optional(),
    note: z.string().trim().min(2).max(2000).optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.note !== undefined,
    "Informe status ou nota.",
  );

/** Analyst update: status change and/or note; renews the SLA window. */
export const PATCH = route<"analyst", { number: string }>(
  "analyst",
  async ({ req, user, params }) => {
    const body = await readJson(req, updateSchema);
    const result = await callTicketService("analystUpdate", async (service) => {
      const ticket = await service.findByNumber(params.number);
      if (!ticket) throw new AppError("not_found", "Chamado não encontrado.");
      const updated = await service.analystUpdate(ticket, body, { id: user.id, kind: "analyst" });
      return { ticket: updated, events: await service.events(updated.id) };
    });
    await audit(user.id, "ticket", result.ticket.id, "analyst_update", "success", {
      status: body.status ?? null,
    });
    return json({ ticket: await toDetail(db(), result.ticket, result.events, new Date()) });
  },
);
