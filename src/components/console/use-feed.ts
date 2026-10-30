"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConversationDTO, MessageDTO, MessagePageDTO } from "@/lib/api-types";
import { api, errorMessage } from "@/lib/api-client";
import { mergeMessages } from "@/components/chat/use-chat";

const POLL_MS = 3000;

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
  }, [conversationId]);

  const sync = useCallback(async () => {
    const last = messagesRef.current[messagesRef.current.length - 1]?.seq ?? 0;
    try {
      const page = await api<MessagePageDTO>(
        `/api/conversations/${conversationId}/messages?after=${last}&limit=100`,
      );
      setConversation(page.conversation);
      setMessages((list) => mergeMessages(list, page.messages));
    } catch {
      // The next tick retries; the queue keeps showing the last known state.
    }
  }, [conversationId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [sync]);

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
    loadOlder,
    sync,
    add,
  };
}
