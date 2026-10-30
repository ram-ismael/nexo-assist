import { z } from "zod";
import { config } from "@/lib/config";
import { db } from "@/server/db/client";
import { json, readJson, route } from "@/server/http";
import { findConversation } from "@/server/conversations/repository";
import { serializeConversation } from "@/server/conversations/serialize";
import { confirmDraftAndAnnounce } from "@/server/conversations/use-cases";
import { ticketSnapshot } from "@/server/tickets/service";

const schema = z.object({ expectedVersion: z.number().int().positive().optional() });

/** Explicit employee confirmation: the only way a draft becomes a ticket change. */
export const POST = route<"employee", { id: string }>("employee", async ({ req, user, params }) => {
  const body = await readJson(req, schema);
  const result = await confirmDraftAndAnnounce(user.id, params.id, body.expectedVersion, {
    announce: true,
  });
  const conversationId = result.ticket.sourceConversationId;
  const conversation = conversationId ? await findConversation(db(), conversationId) : null;
  return json({
    ticket: ticketSnapshot(result.ticket, new Date()),
    handedOff: result.handedOff,
    alreadyConfirmed: result.alreadyConfirmed,
    conversation:
      conversation && conversation.employeeId === user.id
        ? await serializeConversation(db(), conversation, config().AGENT_SESSION_MESSAGE_LIMIT)
        : null,
  });
});
