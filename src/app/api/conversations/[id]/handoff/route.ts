import { config } from "@/lib/config";
import { db } from "@/server/db/client";
import { json, route } from "@/server/http";
import { serializeConversation } from "@/server/conversations/serialize";
import { audit, employeeRequestsAnalyst } from "@/server/conversations/use-cases";

/** "Falar com um analista" without going through the model. */
export const POST = route<"employee", { id: string }>("employee", async ({ user, params }) => {
  const result = await employeeRequestsAnalyst(user, params.id);
  await audit(user.id, "conversation", params.id, "handoff_requested", "success", {
    origin: "employee",
  });
  return json({
    conversation: await serializeConversation(
      db(),
      result.conversation,
      config().AGENT_SESSION_MESSAGE_LIMIT,
    ),
    targetLevel: result.targetLevel,
    respondBy: result.respondBy.toISOString(),
  });
});
