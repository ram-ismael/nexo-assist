import { z } from "zod";
import { json, route } from "@/server/http";
import { callTicketService } from "@/server/tickets/gateway";
import { toListItem } from "@/server/tickets/dto";

const query = z.object({ employeeId: z.uuid().optional() });

/**
 * Employees always get their own tickets (any employeeId param is ignored);
 * analysts may list a given employee's tickets for the console side panel.
 */
export const GET = route("user", async ({ req, user }) => {
  const params = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const requesterId = user.role === "analyst" && params.employeeId ? params.employeeId : user.id;
  const tickets = await callTicketService("listTickets", (service) =>
    service.listForRequester(requesterId, { onlyOpen: false, limit: 50 }),
  );
  const now = new Date();
  return json({ items: tickets.map((ticket) => toListItem(ticket, now)) });
});
