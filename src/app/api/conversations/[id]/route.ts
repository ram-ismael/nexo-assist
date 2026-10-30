import { eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { db } from "@/server/db/client";
import { tickets, users } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { json, route } from "@/server/http";
import { HANDOFF_REASON_LABEL } from "@/server/conversations/handoff";
import { findConversation } from "@/server/conversations/repository";
import { serializeConversation } from "@/server/conversations/serialize";
import { latestHandoff } from "@/server/conversations/use-cases";

/** Analyst view of a conversation: state, latest handoff summary and ticket in focus. */
export const GET = route<"analyst", { id: string }>("analyst", async ({ params }) => {
  const conversation = await findConversation(db(), params.id);
  if (!conversation) throw notFound("Conversa");
  const [dto, handoff, focus] = await Promise.all([
    serializeConversation(db(), conversation, config().AGENT_SESSION_MESSAGE_LIMIT),
    latestHandoff(conversation.id),
    conversation.focusTicketId
      ? db()
          .select({ number: tickets.number })
          .from(tickets)
          .where(eq(tickets.id, conversation.focusTicketId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const claimer = handoff?.claimedById
    ? (
        await db()
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, handoff.claimedById))
          .limit(1)
      )[0]
    : undefined;
  return json({
    conversation: dto,
    focusTicketNumber: focus[0]?.number ?? null,
    handoff: handoff
      ? {
          reason: HANDOFF_REASON_LABEL[handoff.reason],
          origin: handoff.origin,
          summary: handoff.summary,
          targetLevel: handoff.targetLevel,
          respondBy: handoff.respondBy?.toISOString() ?? null,
          createdAt: handoff.createdAt.toISOString(),
          claimedAt: handoff.claimedAt?.toISOString() ?? null,
          claimedBy: claimer?.name ?? null,
          resolvedAt: handoff.resolvedAt?.toISOString() ?? null,
        }
      : null,
  });
});
