"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConversationDTO, MessageDTO, MessagePageDTO } from "@/lib/api-types";
import { api, ApiRequestError, errorMessage } from "@/lib/api-client";
import { usePolling } from "@/lib/use-polling";
import { mergeMessages } from "@/components/chat/use-chat";

/**
 * Messages of one conversation for the console: latest page first, older
 * pages on demand, incremental polling by cursor. The owning component is keyed
 * by conversation id, so switching conversations starts from a clean state.
 */
export function useFeed(conversationId: string) {
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [conversation, setConversation] = useState<ConversationDTO | null>(null);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  /** False while incremental sync is failing; the panel says the view may be stale. */
  const [connected, setConnected] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const messagesRef = useRef<MessageDTO[]>([]);

  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let active = true;
    api<MessagePageDTO>(`/api/conversations/${conversationId}/messages?limit=30`)
      .then((page) => {
        if (!active) return;
        setMessages(page.messages);
        setConversation(page.conversation);
        setHasMoreBefore(page.hasMoreBefore);
      })
      .catch((reason: unknown) => active && setError(errorMessage(reason)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [conversationId, attempt]);

  /** Retries the first page after it failed to load. */
  const reload = useCallback(() => {
    setError(null);
    setLoading(true);
    setAttempt((value) => value + 1);
  }, []);

  const sync = useCallback(async () => {
    const last = messagesRef.current[messagesRef.current.length - 1]?.seq ?? 0;
    try {
      const page = await api<MessagePageDTO>(
        `/api/conversations/${conversationId}/messages?after=${last}&limit=100`,
      );
      setConversation(page.conversation);
      setMessages((list) => mergeMessages(list, page.messages));
      setConnected(true);
    } catch (reason) {
      // Network or server trouble: keep the last known state and retry on the
      // next tick. A rejected request (e.g. 404) is not a connection problem.
      if (!(reason instanceof ApiRequestError) || reason.status === 0 || reason.status >= 500) {
        setConnected(false);
      }
    }
  }, [conversationId]);

  // Incremental sync only makes sense once the first page is on screen.
  usePolling(sync, conversation?.state, !loading && !error);

  const loadOlder = useCallback(async () => {
    const first = messagesRef.current[0];
    if (!first) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await api<MessagePageDTO>(
        `/api/conversations/${conversationId}/messages?before=${first.seq}&limit=30`,
      );
      setMessages((list) => mergeMessages(list, page.messages));
      setHasMoreBefore(page.hasMoreBefore);
    } catch (reason) {
      setOlderError(errorMessage(reason));
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId]);

  const add = useCallback(
    (message: MessageDTO) => setMessages((list) => mergeMessages(list, [message])),
    [],
  );

  return {
    messages,
    conversation,
    hasMoreBefore,
    loading,
    loadingOlder,
    error,
    olderError,
    connected,
    loadOlder,
    reload,
    sync,
    add,
  };
}
