import { config } from "@/lib/config";
import { db } from "@/server/db/client";
import { json, route } from "@/server/http";
import { serializeConversation } from "@/server/conversations/serialize";
import { audit, returnToAgent } from "@/server/conversations/use-cases";

export const POST = route<"analyst", { id: string }>("analyst", async ({ user, params }) => {
  const conversation = await returnToAgent(user, params.id);
  await audit(user.id, "conversation", params.id, "returned_to_agent", "success");
  return json({
    conversation: await serializeConversation(
      db(),
      conversation,
      config().AGENT_SESSION_MESSAGE_LIMIT,
    ),
  });
});
