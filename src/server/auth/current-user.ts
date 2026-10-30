import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { resolveSession, SESSION_COOKIE, type SessionUser } from "./sessions";

/** Per-request memoized session lookup for Server Components and Route Handlers. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(db(), token);
});

export function homeFor(user: Pick<SessionUser, "role">): string {
  return user.role === "analyst" ? "/console" : "/atendimento";
}

export async function requirePageUser(role?: SessionUser["role"]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");
  if (role && user.role !== role) redirect(homeFor(user));
  return user;
}
