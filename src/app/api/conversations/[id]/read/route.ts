import { db } from "@/server/db/client";
import { json, route } from "@/server/http";
import { findConversation } from "@/server/conversations/repository";
import { markRead } from "@/server/conversations/queue";
import { notFound } from "@/server/errors";

export const POST = route<"analyst", { id: string }>("analyst", async ({ params }) => {
  if (!(await findConversation(db(), params.id))) throw notFound("Conversa");
  await markRead(db(), params.id);
  return json({ ok: true });
});
