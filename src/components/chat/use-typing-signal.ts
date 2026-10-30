"use client";

import { useCallback, useEffect, useRef } from "react";

const REFRESH_MS = 3_000;

/**
 * Tells the other person "estou escrevendo": at most one request every 3 s
 * while there is text, and an explicit stop when the text is cleared or the
 * field loses focus. Sending the message clears the signal on the server.
 * Failures are ignored on purpose: the signal is advisory and expires by itself.
 */
export function useTypingSignal(conversationId: string | null | undefined, enabled: boolean) {
  const lastSent = useRef(0);
  const active = useRef(false);

  const post = useCallback(
    (typing: boolean) => {
      if (!conversationId) return;
      void fetch(`/api/conversations/${conversationId}/typing`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typing }),
        keepalive: !typing,
      }).catch(() => undefined);
    },
    [conversationId],
  );

  const stop = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    lastSent.current = 0;
    post(false);
  }, [post]);

  const onTextChange = useCallback(
    (text: string) => {
      if (!enabled) return;
      if (!text.trim()) return stop();
      const now = Date.now();
      if (active.current && now - lastSent.current < REFRESH_MS) return;
      active.current = true;
      lastSent.current = now;
      post(true);
    },
    [enabled, post, stop],
  );

  /** After a send the server already cleared the signal; just forget it locally. */
  const onSent = useCallback(() => {
    active.current = false;
    lastSent.current = 0;
  }, []);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);
  useEffect(() => stop, [stop]);

  return { onTextChange, onBlur: stop, onSent };
}
