"use client";

import { Clock3, Headset, History, MoreHorizontal, Plus, RotateCcw, WifiOff } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantStatus } from "@/domain/assistant";
import type { ConversationDTO, MessageDTO, MessagePageDTO } from "@/lib/api-types";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/employee-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import type { ConversationState } from "@/domain/conversations";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { TypingIndicator } from "./typing-indicator";
import { useChat } from "./use-chat";
import { useTypingSignal } from "./use-typing-signal";

const SUGGESTIONS = [
  "Meu notebook não conecta na VPN",
  "Qual o status do meu chamado?",
  "Preciso de um segundo monitor",
  "Qual o horário do service desk?",
];

type HistoryItem = {
  id: string;
  state: ConversationState;
  lastMessagePreview: string | null;
  lastActivityAt: string;
  closedAt: string | null;
};

const ASSISTANT_PILL: Record<AssistantStatus, { text: string; tone: string; dot: string }> = {
  online: {
    text: "Assistente online",
    tone: "bg-success-soft text-success-text",
    dot: "bg-success",
  },
  degraded: {
    text: "Assistente instável",
    tone: "bg-warning-soft text-warning-text",
    dot: "bg-warning",
  },
  unavailable: {
    text: "Assistente indisponível",
    tone: "bg-danger-soft text-danger-text",
    dot: "bg-danger",
  },
};

function StatusPill({
  conversation,
  assistant,
}: {
  conversation: ConversationDTO | null;
  assistant: AssistantStatus;
}) {
  const state = conversation?.state ?? "agent_active";
  const pill =
    state === "waiting_analyst"
      ? {
          text: "Aguardando atendente",
          tone: "bg-warning-soft text-warning-text",
          dot: "bg-warning",
        }
      : state === "analyst_active"
        ? {
            text: `${conversation?.assignedAnalyst?.name ?? "Analista"} atendendo`,
            tone: "bg-success-soft text-success-text",
            dot: "bg-success",
          }
        : state === "closed"
          ? { text: "Conversa encerrada", tone: "bg-desk text-ink-3", dot: "bg-ink-4" }
          : ASSISTANT_PILL[assistant];
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[14px] font-medium transition-colors duration-300",
        pill.tone,
      )}
      role="status"
      title={pill.text}
    >
      <span
        className={cn("size-2 rounded-full transition-colors duration-300", pill.dot)}
        aria-hidden="true"
      />
      <span className="max-sm:sr-only">{pill.text}</span>
    </span>
  );
}

export function ChatView({
  initial,
  timeZone,
  userId,
  assistant,
}: {
  initial: MessagePageDTO | null;
  timeZone: string;
  userId: string;
  assistant: AssistantStatus;
}) {
  const toast = useToast();
  const chat = useChat(initial, assistant);
  const { conversation, messages, pending, failure } = chat;
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [newBusy, setNewBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [viewing, setViewing] = useState<MessagePageDTO | null>(null);

  const state = conversation?.state ?? "agent_active";
  const limitReached =
    !!conversation &&
    conversation.agentTurnCount >= conversation.agentTurnLimit &&
    state === "agent_active";
  const lastMessage = messages[messages.length - 1];
  // A turn still running on the server that this tab is not streaming (reload,
  // dropped connection): show it, and hold new messages the server would refuse.
  const processingElsewhere = !pending && !!conversation?.agentBusy && state === "agent_active";
  const withPerson = state === "waiting_analyst" || state === "analyst_active";

  // Replies that arrive while this tab is in the background show up in its
  // title, "(2) Atendimento", until the employee looks at it again.
  const [unseenReplies, setUnseenReplies] = useState(0);
  const seenSeq = useRef(lastMessage?.seq ?? 0);
  useEffect(() => {
    const fresh = messages.filter(
      (message) =>
        message.seq > seenSeq.current && (message.kind === "analyst" || message.kind === "agent"),
    ).length;
    seenSeq.current = lastMessage?.seq ?? seenSeq.current;
    if (fresh > 0 && document.visibilityState === "hidden") {
      setUnseenReplies((count) => count + fresh);
    }
  }, [messages, lastMessage?.seq]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setUnseenReplies(0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  useEffect(() => {
    const base = "Atendimento · Nexo Assist";
    document.title = unseenReplies > 0 ? `(${unseenReplies}) ${base}` : base;
  }, [unseenReplies]);
  const typingSignal = useTypingSignal(conversation?.id, withPerson && !viewing);
  const analystTyping =
    state === "analyst_active" && !!conversation?.typing.analyst && !viewing
      ? (conversation.assignedAnalyst?.name.split(" ")[0] ?? "Analista")
      : null;

  const requestAnalyst = async () => {
    if (!conversation) return;
    setHandoffBusy(true);
    try {
      await api(`/api/conversations/${conversation.id}/handoff`, { method: "POST" });
      await chat.sync();
      chat.setFailure(null);
    } catch (error) {
      toast("error", errorMessage(error));
    } finally {
      setHandoffBusy(false);
    }
  };

  const startNew = async () => {
    setNewBusy(true);
    try {
      const result = await api<{ conversation: ConversationDTO }>("/api/conversations", {
        method: "POST",
      });
      chat.replaceConversation(null, result.conversation);
      setViewing(null);
    } catch (error) {
      toast("error", errorMessage(error));
    } finally {
      setNewBusy(false);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    try {
      const result = await api<{ items: HistoryItem[] }>("/api/conversations");
      setHistory(result.items);
    } catch (error) {
      toast("error", errorMessage(error));
      setHistoryOpen(false);
    }
  };

  const openPast = async (id: string) => {
    setHistoryOpen(false);
    if (id === conversation?.id) {
      setViewing(null);
      return;
    }
    try {
      setViewing(await api<MessagePageDTO>(`/api/conversations/${id}/messages?limit=50`));
    } catch (error) {
      toast("error", errorMessage(error));
    }
  };

  const handlersFor = useCallback(
    (message: MessageDTO, isLast: boolean) => ({
      onReply:
        isLast && message.kind === "agent" && state === "agent_active" && !pending && !viewing
          ? (text: string) => void chat.send(text)
          : undefined,
      onChanged: async () => {
        await chat.sync();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, pending, viewing, chat.send, chat.sync],
  );

  const placeholder =
    state === "waiting_analyst" || state === "analyst_active"
      ? "Escreva para o analista…"
      : "Escreva para o Nexo…";

  return (
    <>
      <PageHeader
        title="Atendimento"
        right={
          <div className="flex items-center gap-2">
            <StatusPill conversation={conversation} assistant={chat.assistant} />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                aria-label="Mais opções"
                className="text-ink-2 hover:bg-desk flex size-9 items-center justify-center rounded-full"
              >
                <MoreHorizontal className="size-5" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="animate-rise border-rule bg-paper z-50 min-w-[230px] rounded-lg border p-1 shadow-lg"
                >
                  <DropdownMenu.Item
                    disabled={!conversation || state !== "agent_active" || handoffBusy}
                    onSelect={requestAnalyst}
                    className="data-[highlighted]:bg-desk flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[14px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                  >
                    <Headset className="size-4" aria-hidden="true" /> Falar com um analista
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={newBusy || state === "waiting_analyst" || state === "analyst_active"}
                    onSelect={startNew}
                    className="data-[highlighted]:bg-desk flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[14px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                  >
                    <Plus className="size-4" aria-hidden="true" /> Nova conversa
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={openHistory}
                    className="data-[highlighted]:bg-desk flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[14px] outline-none"
                  >
                    <History className="size-4" aria-hidden="true" /> Conversas anteriores
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        }
      />

      {viewing ? (
        <div className="border-rule bg-desk flex items-center justify-between gap-3 border-b px-4 py-2.5 text-[14px] sm:px-8">
          <span className="text-ink-2">
            Visualizando uma conversa anterior (
            {formatDateTime(viewing.conversation.lastActivityAt, timeZone)}).
          </span>
          <Button size="sm" variant="secondary" onClick={() => setViewing(null)}>
            Voltar para a conversa atual
          </Button>
        </div>
      ) : null}

      <MessageList
        key={viewing?.conversation.id ?? conversation?.id ?? "new"}
        messages={viewing ? viewing.messages : messages}
        viewer="employee"
        layout="employee"
        timeZone={timeZone}
        hasMoreBefore={viewing ? false : chat.hasMoreBefore}
        loadingOlder={chat.loadingOlder}
        olderError={chat.olderError}
        onLoadOlder={chat.loadOlder}
        handlersFor={handlersFor}
        pending={viewing ? null : pending}
        empty={
          <div className="mx-auto mt-[8vh] max-w-[560px] text-center">
            <h1 className="font-display text-ink text-[34px] leading-tight">Como posso ajudar?</h1>
            <p className="text-ink-3 mt-2 text-[15px]">
              Descreva o problema com suas palavras. Eu consulto seus chamados, busco na central de
              ajuda e chamo um analista quando precisar.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="chip"
                  disabled={!!pending}
                  onClick={() => void chat.send(suggestion)}
                  className="h-10 rounded-lg text-[14px]"
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        }
        inPlace={chat.streamedInPlace}
        typing={
          viewing ? null : processingElsewhere ? (
            <TypingIndicator name="Nexo Assist" align="left" tone="paper" />
          ) : analystTyping ? (
            <TypingIndicator name={analystTyping} align="left" tone="analyst" />
          ) : null
        }
        footer={
          !viewing &&
          !analystTyping &&
          (state === "waiting_analyst" || state === "analyst_active") &&
          lastMessage?.kind !== "analyst" ? (
            <div
              className="bg-warning-soft text-warning-text flex items-center gap-2 self-start rounded-lg px-3.5 py-2.5 text-[14px]"
              role="status"
            >
              {state === "waiting_analyst" ? (
                <Clock3 className="size-4" aria-hidden="true" />
              ) : (
                <Headset className="size-4" aria-hidden="true" />
              )}
              {state === "waiting_analyst"
                ? "Sua conversa está na fila do service desk. O assistente está pausado; o analista responde por aqui."
                : `${conversation?.assignedAnalyst?.name ?? "Um analista"} está atendendo você.`}
            </div>
          ) : null
        }
      />

      {!viewing ? (
        <div className="shrink-0 px-4 pb-4 sm:px-8 lg:pr-12 lg:pl-[17%]">
          <div className="mx-auto w-full max-w-[1120px] lg:max-w-none">
            {failure ? (
              <div
                role="alert"
                className="border-danger/25 bg-danger-soft text-danger-text mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3.5 py-2.5 text-[14px]"
              >
                <span className="flex-1">{failure.message}</span>
                {failure.retryable && failure.messageId ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void chat.send("", { retryOfMessageId: failure.messageId ?? undefined })
                    }
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" /> Tentar de novo
                  </Button>
                ) : null}
                {conversation && state === "agent_active" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={requestAnalyst}
                    loading={handoffBusy}
                  >
                    <Headset className="size-3.5" aria-hidden="true" /> Falar com um analista
                  </Button>
                ) : null}
              </div>
            ) : null}
            {chat.syncError ? (
              <p className="text-warning-text mb-2 flex items-center gap-2 text-[13px]">
                <WifiOff className="size-4" aria-hidden="true" /> Sem conexão. Tentando sincronizar…
              </p>
            ) : null}
            {state === "closed" || limitReached ? (
              <div className="border-rule bg-desk flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-[15px]">
                <span className="text-ink-2">
                  {state === "closed"
                    ? "Esta conversa foi encerrada. O histórico continua disponível."
                    : `Esta sessão chegou ao limite de ${conversation?.agentTurnLimit} mensagens com o assistente.`}
                </span>
                <div className="flex gap-2">
                  {limitReached ? (
                    <Button variant="secondary" onClick={requestAnalyst} loading={handoffBusy}>
                      Falar com um analista
                    </Button>
                  ) : null}
                  <Button onClick={startNew} loading={newBusy}>
                    <Plus className="size-4" aria-hidden="true" /> Nova conversa
                  </Button>
                </div>
              </div>
            ) : (
              <Composer
                draftKey={`nexo-draft-${userId}`}
                placeholder={placeholder}
                // Typing stays possible while an answer is on its way; only sending waits.
                busy={!!pending || processingElsewhere}
                typing={withPerson ? typingSignal : undefined}
                onSend={(text) => chat.send(text)}
              />
            )}
            <p className="text-ink-3 mt-2 text-right text-[13px]">
              {conversation && state === "agent_active"
                ? `${conversation.agentTurnCount}/${conversation.agentTurnLimit} mensagens nesta sessão`
                : state === "waiting_analyst" || state === "analyst_active"
                  ? "Mensagens para o analista não contam no limite da sessão"
                  : " "}
            </p>
          </div>
        </div>
      ) : null}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen} title="Conversas anteriores">
        {!history ? (
          <div className="flex justify-center py-6">
            <Spinner label="Carregando" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-ink-3 text-sm">Nenhuma conversa ainda.</p>
        ) : (
          <ul className="divide-rule divide-y">
            {history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void openPast(item.id)}
                  className="hover:bg-desk flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-3 text-left"
                >
                  <span className="text-ink-3 text-[13px]">
                    {formatDateTime(item.lastActivityAt, timeZone)} ·{" "}
                    {item.state === "closed" ? "Encerrada" : "Atual"}
                  </span>
                  <span className="text-ink line-clamp-1 text-[15px]">
                    {item.lastMessagePreview ?? "Sem mensagens"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}
