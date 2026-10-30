import { z } from "zod";
import { notFound } from "@/server/errors";
import { json, readJson, route } from "@/server/http";
import { signalTyping } from "@/server/conversations/use-cases";

const schema = z.object({ typing: z.boolean() });

/** Typing signal between employee and analyst; clients send it at most every ~3 s. */
export const PUT = route<"user", { id: string }>("user", async ({ req, user, params }) => {
  if (!z.uuid().safeParse(params.id).success) throw notFound("Conversa");
  const body = await readJson(req, schema);
  return json({ accepted: await signalTyping(user, params.id, body.typing) });
});
