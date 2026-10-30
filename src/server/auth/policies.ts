import { AppError, forbidden, notFound } from "@/server/errors";
import type { SessionUser } from "./sessions";

/**
 * Central authorization rules. Employees only reach their own records;
 * analysts reach any service-desk record because triage is their job.
 * Resources an employee may not see are reported as "not found", so an
 * existing ticket number never leaks through a different error.
 */
export function assertRole(user: SessionUser, role: SessionUser["role"]): void {
  if (user.role !== role) throw forbidden();
}

export function assertCanViewConversation(
  user: SessionUser,
  conversation: { employeeId: string } | null | undefined,
): asserts conversation is { employeeId: string } {
  if (!conversation) throw notFound("Conversa");
  if (user.role === "analyst") return;
  if (conversation.employeeId !== user.id) throw notFound("Conversa");
}

export function assertCanViewTicket(
  user: SessionUser,
  ticket: { requesterId: string } | null | undefined,
): asserts ticket is { requesterId: string } {
  if (!ticket) throw notFound("Chamado");
  if (user.role === "analyst") return;
  if (ticket.requesterId !== user.id) throw notFound("Chamado");
}

export function assertEmployeeOwns(user: SessionUser, ownerId: string, what: string): void {
  if (user.role !== "employee" || user.id !== ownerId) {
    throw new AppError("not_found", `${what} não encontrado.`);
  }
}
