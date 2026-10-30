"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantStatus } from "@/domain/assistant";
import type { ConversationDTO, MessageDTO, MessagePageDTO } from "@/lib/api-types";
import { api, ApiRequestError, newClientId, parseError } from "@/lib/api-client";

export type LiveAction = {
  id: string;
  tool: string;
  label: string;
  status: "running" | "ok" | "error" | "denied";
};

export type PendingTurn = {
  clientId: string;
  text: string;
  /** Only an agent-owned conversation gets an assistant answer to wait for. */
  toAgent: boolean;
  accepted: boolean;
  actions: LiveAction[];
  reply: string;
};

export type TurnFailure = { message: string; retryable: boolean; messageId: string | null };

type StreamEvent =
  | { type: "accepted"; turnId: string; userMessage: MessageDTO; conversation: ConversationDTO }
  | { type: "action"; id: string; tool: string; label: string; status: LiveAction["status"] }
  | { type: "text"; delta: string }
  | { type: "done"; message: MessageDTO | null; conversation: ConversationDTO; discarded?: boolean }
  | {
      type: "error";
      code: string;
      message: string;
      retryable: boolean;
      notice: MessageDTO | null;
      conversation: ConversationDTO | null;
    };

const POLL_MS = 3500;

/** Merge by seq and drop duplicates: polling, streaming and paging can overlap. */
export function mergeMessages(current: MessageDTO[], incoming: MessageDTO[]): MessageDTO[] {
  if (incoming.length === 0) return current;
  const bySeq = new Map(current.map((message) => [message.seq, message]));
  for (const message of incoming) bySeq.set(message.seq, message);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export function useChat(initial: MessagePageDTO | null, initialAssistant: AssistantStatus) {
  const [conversation, setConversation] = useState<ConversationDTO | null>(
    initial?.conversation ?? null,
  );
  const [messages, setMessages] = useState<MessageDTO[]>(initial?.messages ?? []);
  const [hasMoreBefore, setHasMoreBefore] = useState(initial?.hasMoreBefore ?? false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [failure, setFailure] = useState<TurnFailure | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [assistant, setAssistant] = useState<AssistantStatus>(initialAssistant);
  const streaming = useRef(false);
  // A message whose fate is unknown (network dropped before any answer) is
  // resent with the same client id, so the server stores and answers it once.
  const unconfirmed = useRef<{ text: string; clientId: string } | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  const lastSeq = () => messagesRef.current[messagesRef.current.length - 1]?.seq ?? 0;

  const sync = useCallback(async () => {
    const current = conversationRef.current;
    if (!current || streaming.current) return;
    try {
      const page = await api<MessagePageDTO>(
        `/api/conversations/${current.id}/messages?after=${lastSeq()}&limit=100`,
      );
      setConversation(page.conversation);
      setMessages((list) => mergeMessages(list, page.messages));
      setAssistant(page.assistant);
      setSyncError(false);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "offline") setSyncError(true);
    }
  }, []);

  // Polling keeps the employee in sync with analyst replies and state changes.
  // It pauses while the tab is hidden and during a streamed agent answer.
  useEffect(() => {
    if (!conversation?.id) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await sync();
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
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
  }, [conversation?.id, sync]);

  const loadOlder = useCallback(async () => {
    const current = conversationRef.current;
    const first = messagesRef.current[0];
    if (!current || !first || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await api<MessagePageDTO>(
        `/api/conversations/${current.id}/messages?before=${first.seq}&limit=30`,
      );
      setMessages((list) => mergeMessages(list, page.messages));
      setHasMoreBefore(page.hasMoreBefore);
    } catch (error) {
      setOlderError(
        error instanceof ApiRequestError
          ? error.message
          : "Não foi possível carregar mensagens antigas.",
      );
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder]);

  const handleEvent = useCallback((event: StreamEvent, clientId: string) => {
    switch (event.type) {
      case "accepted":
        setConversation(event.conversation);
        setMessages((list) => mergeMessages(list, [event.userMessage]));
        setPending((value) =>
          value && value.clientId === clientId ? { ...value, accepted: true } : value,
        );
        break;
      case "action":
        setPending((value) => {
          if (!value) return value;
          const others = value.actions.filter((action) => action.id !== event.id);
          return {
            ...value,
            actions: [
              ...others,
              { id: event.id, tool: event.tool, label: event.label, status: event.status },
            ],
          };
        });
        break;
      case "text":
        setPending((value) => (value ? { ...value, reply: value.reply + event.delta } : value));
        break;
      case "done":
        setConversation(event.conversation);
        if (event.message)
          setMessages((list) => mergeMessages(list, [event.message as MessageDTO]));
        setPending(null);
        break;
      case "error":
        if (event.conversation) setConversation(event.conversation);
        if (event.notice) setMessages((list) => mergeMessages(list, [event.notice as MessageDTO]));
        setPending(null);
        setFailure({
          message: event.message,
          retryable: event.retryable,
          messageId:
            messagesRef.current.filter((message) => message.kind === "employee").at(-1)?.id ?? null,
        });
        break;
    }
  }, []);

  /** Returns false when the message was not accepted, so the composer keeps the text. */
  const send = useCallback(
    async (text: string, options: { retryOfMessageId?: string } = {}): Promise<boolean> => {
      if (streaming.current) return false;
      const clientId =
        !options.retryOfMessageId && unconfirmed.current?.text === text
          ? unconfirmed.current.clientId
          : newClientId();
      unconfirmed.current = null;
      streaming.current = true;
      setFailure(null);
      setPending({
        clientId,
        text: options.retryOfMessageId ? "" : text,
        toAgent: (conversationRef.current?.state ?? "agent_active") === "agent_active",
        accepted: false,
        actions: [],
        reply: "",
      });
      try {
        let response: Response;
        try {
          response = await fetch("/api/chat", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              conversationId: conversationRef.current?.id ?? null,
              clientId,
              text: text || "(nova tentativa)",
              retryOfMessageId: options.retryOfMessageId,
            }),
          });
        } catch {
          throw new ApiRequestError(
            0,
            "offline",
            "Sem conexão. Sua mensagem não foi enviada; tente de novo.",
          );
        }
        // Full reload on purpose: drops every client cache tied to the expired session.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        if (response.status === 401) window.location.assign("/entrar?expirada=1");
        if (!response.ok) throw await parseError(response);
        const type = response.headers.get("content-type") ?? "";
        if (type.includes("application/json")) {
          const body = (await response.json()) as {
            message: MessageDTO;
            conversation: ConversationDTO;
          };
          setConversation(body.conversation);
          setMessages((list) => mergeMessages(list, [body.message]));
          setPending(null);
          return true;
        }
        const reader = response.body?.getReader();
        if (!reader) throw new ApiRequestError(0, "stream", "Resposta vazia do servidor.");
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) {
              const event = JSON.parse(line) as StreamEvent;
              if (event.type === "done" || event.type === "error") finished = true;
              handleEvent(event, clientId);
            }
            newline = buffer.indexOf("\n");
          }
        }
        // Tools may have appended events during the turn (e.g. the transfer
        // line); pull them now instead of waiting for the next poll.
        streaming.current = false;
        await sync();
        if (!finished) {
          // Stream cut (network/timeout). The turn is persisted server-side:
          // resynchronize instead of guessing what happened.
          setPending(null);
          setFailure({
            message: "A conexão caiu durante a resposta. A conversa foi atualizada.",
            retryable: false,
            messageId: null,
          });
        }
        return true;
      } catch (error) {
        setPending(null);
        if (error instanceof ApiRequestError && error.code === "offline" && text) {
          unconfirmed.current = { text, clientId };
        }
        const message =
          error instanceof ApiRequestError
            ? error.message
            : "Não foi possível enviar. Tente de novo.";
        setFailure({ message, retryable: false, messageId: null });
        return false;
      } finally {
        streaming.current = false;
      }
    },
    [handleEvent, sync],
  );

  const replaceConversation = useCallback((page: MessagePageDTO | null, next?: ConversationDTO) => {
    setConversation(page?.conversation ?? next ?? null);
    setMessages(page?.messages ?? []);
    setHasMoreBefore(page?.hasMoreBefore ?? false);
    if (page) setAssistant(page.assistant);
    setFailure(null);
  }, []);

  return {
    conversation,
    setConversation,
    messages,
    hasMoreBefore,
    loadingOlder,
    olderError,
    loadOlder,
    pending,
    failure,
    setFailure,
    syncError,
    assistant,
    send,
    sync,
    replaceConversation,
  };
}
