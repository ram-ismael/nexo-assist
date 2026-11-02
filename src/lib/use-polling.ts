"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { ConversationDTO } from "./api-types";

const POLL_MS = 3000;
// With a person on the other side, poll faster so messages and
// "está escrevendo…" show up within ~2 s.
const HUMAN_POLL_MS = 2000;

export function pollInterval(state: ConversationDTO["state"] | undefined): number {
  return state === "waiting_analyst" || state === "analyst_active" ? HUMAN_POLL_MS : POLL_MS;
}

/**
 * Runs `sync` on a timer while the tab is visible, and at once when the tab
 * comes back or the network returns. A tick waits for the previous one, so
 * slow responses never pile up.
 */
export function usePolling(
  sync: () => Promise<void>,
  state: ConversationDTO["state"] | undefined,
  enabled: boolean,
): void {
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await sync();
      timer = setTimeout(tick, pollInterval(stateRef.current));
    };
    timer = setTimeout(tick, pollInterval(stateRef.current));
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const onOnline = () => void sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [sync, enabled]);
}
