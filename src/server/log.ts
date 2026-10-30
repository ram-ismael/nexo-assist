type Level = "debug" | "info" | "warn" | "error";

/**
 * Structured JSON logs (one line per event) so Vercel's log search can filter by
 * requestId/turnId. Never pass message contents, tokens or e-mails here.
 */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
  return { errorMessage: String(error) };
}
