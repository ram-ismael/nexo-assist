export type AssistantStatus = "online" | "degraded" | "unavailable";

export type RecentTurn = { status: "completed" | "failed"; errorCode: string | null };

/** Failures that come from the model provider, not from the employee or our rules. */
const PROVIDER_FAILURE = /^llm_/;
const WINDOW = 3;

/**
 * "online" is a claim about the service, so it needs evidence: the provider is
 * configured and the latest turns did not all fail at the provider. Three
 * provider failures in a row (within the caller's recency window) mean
 * "degraded"; rejected credentials mean nobody will get an answer.
 */
export function assistantStatusFrom(configured: boolean, recent: RecentTurn[]): AssistantStatus {
  if (!configured) return "unavailable";
  const latest = recent.slice(0, WINDOW);
  const allFailed =
    latest.length === WINDOW &&
    latest.every((turn) => turn.status === "failed" && PROVIDER_FAILURE.test(turn.errorCode ?? ""));
  if (!allFailed) return "online";
  return latest[0]?.errorCode === "llm_auth" ? "unavailable" : "degraded";
}
