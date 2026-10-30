import { z } from "zod";
import { config } from "@/lib/config";
import type { MessagePageDTO } from "@/lib/api-types";
import { assistantStatus } from "@/server/agent/health";
import { assertCanViewConversation } from "@/server/auth/policies";
import { db } from "@/server/db/client";
import { json, route } from "@/server/http";
import { findConversation, pageMessages } from "@/server/conversations/repository";
import { serializeConversation, serializeMessages } from "@/server/conversations/serialize";
import { recoverAbandonedTurns, touchEmployeePresence } from "@/server/conversations/use-cases";

const query = z.object({
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * Cursor pagination on message seq. No cursor: latest page. `before`: older
 * page (upward scroll). `after`: incremental sync used by polling.
 */
export const GET = route<"user", { id: string }>("user", async ({ req, user, params }) => {
  let conversation = await findConversation(db(), params.id);
  assertCanViewConversation(user, conversation);
  // Polls only run while the tab is visible, so this is real presence.
  if (user.role === "employee") await touchEmployeePresence(user.id, conversation.id);
  if (await recoverAbandonedTurns(conversation.id)) {
    conversation = (await findConversation(db(), params.id)) ?? conversation;
  }
  const options = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const page = await pageMessages(db(), conversation.id, options);
  const body: MessagePageDTO = {
    conversation: await serializeConversation(
      db(),
      conversation,
      config().AGENT_SESSION_MESSAGE_LIMIT,
    ),
    messages: await serializeMessages(db(), page.messages),
    hasMoreBefore: page.hasMoreBefore,
    assistant: await assistantStatus(),
  };
  return json(body);
});
