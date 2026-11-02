import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revokeSession, SESSION_COOKIE } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
import { analystPresence } from "@/server/db/schema";
import { json, route } from "@/server/http";

export const POST = route("public", async ({ user }) => {
  const jar = await cookies();
  if (user?.role === "analyst") {
    // Signed out means offline from now on; the availability preference itself is kept.
    const now = new Date();
    await db()
      .update(analystPresence)
      .set({ lastHeartbeatAt: now, leftAt: now })
      .where(eq(analystPresence.analystId, user.id));
  }
  await revokeSession(db(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  return json({ ok: true });
});
