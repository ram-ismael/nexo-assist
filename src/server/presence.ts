import "server-only";
import { sql } from "drizzle-orm";
import { ANALYST_ONLINE_TTL_MS } from "@/domain/presence";

/** SQL twin of `analystOnline` over `analyst_presence`, for counts. */
export const ANALYST_ONLINE_SQL = sql.raw(
  `last_heartbeat_at > now() - interval '${ANALYST_ONLINE_TTL_MS / 1000} seconds'` +
    ` and (left_at is null or left_at < last_heartbeat_at)`,
);
