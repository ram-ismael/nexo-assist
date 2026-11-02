import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";

export const SESSION_COOKIE = "nexo_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "employee" | "analyst";
  department: string;
  supportLevel: string | null;
  deviceOs: string | null;
  sessionId: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function findActiveUserByEmail(executor: Executor, email: string) {
  const rows = await executor
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`, eq(users.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSession(
  executor: Executor,
  input: { userId: string; rememberMe: boolean; userAgent: string | null },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + (input.rememberMe ? REMEMBER_TTL_MS : SESSION_TTL_MS));
  await executor.insert(sessions).values({
    tokenHash: hashToken(token),
    userId: input.userId,
    expiresAt,
    rememberMe: input.rememberMe,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

/** Identity and role always come from the stored user, never from the client. */
export async function resolveSession(
  executor: Executor,
  token: string | undefined,
  now = new Date(),
): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const rows = await executor
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      department: users.department,
      supportLevel: users.supportLevel,
      deviceOs: users.deviceOs,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(users.active, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Touch at most once every 5 minutes to avoid a write per request.
  if (now.getTime() - row.lastSeenAt.getTime() > 5 * 60_000) {
    await executor.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    department: row.department,
    supportLevel: row.supportLevel,
    deviceOs: row.deviceOs,
  };
}

export async function revokeSession(executor: Executor, token: string | undefined): Promise<void> {
  if (!token) return;
  await executor
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}
