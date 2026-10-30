import { db } from "@/server/db/client";
import { json, route } from "@/server/http";
import { appendMessage } from "@/server/conversations/repository";
import { cancelDraft, findDraftForEmployee } from "@/server/tickets/drafts";

export const POST = route<"employee", { id: string }>("employee", async ({ user, params }) => {
  const draft = await db().transaction(async (tx) => {
    const locked = await findDraftForEmployee(tx, user.id, params.id, { lock: true });
    const cancelled = await cancelDraft(tx, locked);
    await appendMessage(tx, {
      conversationId: cancelled.conversationId,
      kind: "system",
      senderId: user.id,
      content: `Rascunho ${cancelled.code} cancelado. Nenhum chamado foi alterado.`,
    });
    return cancelled;
  });
  return json({ id: draft.id, status: draft.status });
});
