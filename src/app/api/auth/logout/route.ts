import { cookies } from "next/headers";
import { revokeSession, SESSION_COOKIE } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
import { json, route } from "@/server/http";

export const POST = route("public", async () => {
  const jar = await cookies();
  await revokeSession(db(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  return json({ ok: true });
});
