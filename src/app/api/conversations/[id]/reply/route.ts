import { z } from "zod";
import { db } from "@/server/db/client";
import { json, readJson, route } from "@/server/http";
import { serializeMessages } from "@/server/conversations/serialize";
import { postAnalystMessage } from "@/server/conversations/use-cases";

const schema = z.object({
  clientId: z.string().min(8).max(64),
  text: z.string().trim().min(1, "Escreva uma mensagem.").max(4000),
});

/** Analyst message: only the analyst who assumed the conversation may write. */
export const POST = route<"analyst", { id: string }>("analyst", async ({ req, user, params }) => {
  const body = await readJson(req, schema);
  const message = await postAnalystMessage(user, params.id, body);
  const [dto] = await serializeMessages(db(), [message]);
  return json({ message: dto });
});
