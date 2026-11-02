/** The analyst console sends a heartbeat this often while it is open. */
export const ANALYST_HEARTBEAT_MS = 15_000;
/** Three missed heartbeats and the analyst counts as offline. */
export const ANALYST_ONLINE_TTL_MS = 45_000;

export type AnalystPresence = { lastHeartbeatAt: Date; leftAt: Date | null };

/** Connected now: a fresh heartbeat that came after the last sign-out/close. */
export function analystOnline(presence: AnalystPresence, now = Date.now()): boolean {
  return (
    now - presence.lastHeartbeatAt.getTime() < ANALYST_ONLINE_TTL_MS &&
    (!presence.leftAt || presence.leftAt < presence.lastHeartbeatAt)
  );
}
