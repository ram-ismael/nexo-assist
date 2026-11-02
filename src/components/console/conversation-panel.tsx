"use client";

import {
  ArrowLeft,
  Bot,
  CircleCheck,
  Hand,
  Headset,
  PanelRight,
  Search,
  WifiOff,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { STATE_LABEL } from "@/domain/conversations";
import type { ConversationDetailDTO, MessageDTO } from "@/lib/api-types";
import { api, ApiRequestError, errorMessage, newClientId } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { contactLabel, presenceLabel } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Composer } from "@/components/chat/composer";
import { MessageList, MessagesError, MessagesSkeleton } from "@/components/chat/message-list";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { useTypingSignal } from "@/components/chat/use-typing-signal";
import type { useFeed } from "./use-feed";

type Feed = ReturnType<typeof useFeed>;

export function ConversationPanel({
  feed,
  detail,
  analystId,
  timeZone,
  onChanged,
  onBack,
  onShowTickets,
  ticketsDocked,
}: {
  feed: Feed;
  detail: ConversationDetailDTO | undefined;
  analystId: string;
  timeZone: string;
  onChanged: (action?: "claim" | "return" | "close") => void;
  onBack: () => void;
  onShowTickets: () => void;
  /** The tickets panel is docked on wide screens, so the toggle is not needed there. */
  ticketsDocked: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"claim" | "return" | "close" | null>(null);
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState("");
  const [outgoing, setOutgoing] = useState<string | null>(null);
  // A reply whose fate is unknown (network dropped) is resent with the same
  // client id, so the server stores it once even if the first try got through.
  const unconfirmed = useRef<{ text: string; clientId: string } | null>(null);
  const conversation = feed.conversation ?? detail?.conversation ?? null;
  const state = conversation?.state;
  const mine = state === "analyst_active" && conversation?.assignedAnalyst?.id === analystId;
  const other = state === "analyst_active" && !mine;
  const typingSignal = useTypingSignal(conversation?.id, mine);

  const visibleMessages = useMemo<MessageDTO[]>(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return feed.messages;
    return feed.messages.filter((message) => message.content.toLowerCase().includes(needle));
  }, [feed.messages, term]);

  async function act(action: "claim" | "return" | "close") {
    if (!conversation) return;
    setBusy(action);
    try {
      await api(`/api/conversations/${conversation.id}/${action}`, { method: "POST" });
      toast(
        "success",
        action === "claim"
          ? "Você assumiu o atendimento. O agent está pausado."
          : action === "return"
            ? "Conversa devolvida ao Nexo Assist."
            : "Atendimento encerrado.",
      );
    } catch (error) {
      toast("error", errorMessage(error));
    } finally {
      setBusy(null);
      await feed.sync();
      onChanged(action);
    }
  }

  async function reply(text: string): Promise<boolean> {
    if (!conversation) return false;
    const clientId =
      unconfirmed.current?.text === text ? unconfirmed.current.clientId : newClientId();
    setOutgoing(text);
    try {
      const result = await api<{ message: MessageDTO }>(
        `/api/conversations/${conversation.id}/reply`,
        { method: "POST", json: { clientId, text } },
      );
      unconfirmed.current = null;
      feed.add(result.message);
      onChanged();
      return true;
    } catch (error) {
      unconfirmed.current =
        error instanceof ApiRequestError && error.status === 0 ? { text, clientId } : null;
      toast("error", errorMessage(error));
      await feed.sync();
      return false;
    } finally {
      setOutgoing(null);
    }
  }

  if (!conversation) {
    return (
      <div className="bg-chat flex h-full flex-col">
        {feed.loading ? (
          <MessagesSkeleton layout="console" />
        ) : feed.error ? (
          <MessagesError message={feed.error} onRetry={feed.reload} />
        ) : (
          <p className="text-ink-3 m-auto p-6 text-center text-[15px]">Selecione uma conversa</p>
        )}
      </div>
    );
  }

  const handoff = detail?.handoff;
  const firstName = conversation.employee.name.split(" ")[0];
  const statePill =
    state === "waiting_analyst"
      ? { text: "Aguardando atendente", tone: "bg-warning-soft text-warning-text", icon: Bot }
      : state === "analyst_active"
        ? {
            text: mine ? "Você está atendendo" : `${conversation.assignedAnalyst?.name} atendendo`,
            tone: "bg-primary-soft text-primary-text",
            icon: Headset,
          }
        : state === "agent_active"
          ? { text: "Agent atendendo", tone: "bg-success-soft text-success-text", icon: Bot }
          : { text: STATE_LABEL.closed, tone: "bg-desk text-ink-3", icon: CircleCheck };
  const PillIcon = statePill.icon;

  return (
    <section
      aria-label={`Conversa com ${conversation.employee.name}`}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="border-rule bg-paper flex h-[72px] shrink-0 items-center gap-3 border-b px-4 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar para a lista"
          className="text-ink-2 hover:bg-desk -ml-1 rounded-md p-1.5 xl:hidden"
        >
          <ArrowLeft className="size-5" />
        </button>
        <Avatar
          name={conversation.employee.name}
          online={conversation.employeeOnline || undefined}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-medium">{conversation.employee.name}</p>
          <p className="text-ink-3 truncate text-[14px]">
            <span className={cn(conversation.employeeOnline && "text-success-text")}>
              {presenceLabel(conversation.employeeOnline, conversation.employeeLastSeenAt)} ·{" "}
            </span>
            {conversation.employee.department}
            {detail?.focusTicketNumber ? ` · ${detail.focusTicketNumber}` : ""}
          </p>
        </div>
        {mine ? (
          <div className="hidden items-center gap-2 md:flex">
            <Button
              variant="secondary"
              onClick={() => act("return")}
              loading={busy === "return"}
              disabled={busy !== null}
            >
              <Bot className="size-4" aria-hidden="true" /> Devolver ao agent
            </Button>
            <Button
              variant="danger"
              onClick={() => act("close")}
              loading={busy === "close"}
              disabled={busy !== null}
            >
              <CircleCheck className="size-4" aria-hidden="true" /> Encerrar atendimento
            </Button>
          </div>
        ) : (
          <span
            className={cn(
              "hidden h-9 items-center gap-2 rounded-full px-3.5 text-[14px] font-medium sm:inline-flex",
              statePill.tone,
            )}
          >
            <PillIcon className="size-4" aria-hidden="true" />
            {statePill.text}
          </span>
        )}
        <button
          type="button"
          onClick={() => setSearching((value) => !value)}
          aria-label="Pesquisar nesta conversa"
          aria-pressed={searching}
          className="text-ink-2 hover:bg-desk rounded-full p-2"
        >
          <Search className="size-5" />
        </button>
        <button
          type="button"
          onClick={onShowTickets}
          aria-label="Chamados do funcionário"
          className={cn("text-ink-2 hover:bg-desk rounded-full p-2", ticketsDocked && "2xl:hidden")}
        >
          <PanelRight className="size-5" />
        </button>
      </header>
      {!feed.connected ? (
        <p
          role="status"
          className="bg-warning-soft text-warning-text flex items-center gap-2 px-4 py-2 text-[13px] sm:px-6"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          Sem conexão com o servidor. Tentando reconectar; novas mensagens aparecem assim que
          voltar.
        </p>
      ) : null}
      {searching ? (
        <div className="border-rule bg-paper flex items-center gap-2 border-b px-4 py-2 sm:px-6">
          <Search className="text-ink-3 size-4" aria-hidden="true" />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Buscar nas mensagens carregadas"
            aria-label="Buscar nas mensagens"
            className="h-9 flex-1 bg-transparent text-[15px] outline-none"
          />
          {term ? (
            <span className="text-ink-3 text-[13px]">{visibleMessages.length} resultado(s)</span>
          ) : null}
          <button
            type="button"
            aria-label="Fechar busca"
            onClick={() => (setSearching(false), setTerm(""))}
            className="text-ink-3 hover:text-ink rounded p-1"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {feed.loading ? (
        <MessagesSkeleton layout="console" />
      ) : feed.error ? (
        <MessagesError message={feed.error} onRetry={feed.reload} />
      ) : (
        <MessageList
          key={conversation.id}
          messages={visibleMessages}
          viewer="analyst"
          layout="console"
          timeZone={timeZone}
          hasMoreBefore={term ? false : feed.hasMoreBefore}
          loadingOlder={feed.loadingOlder}
          olderError={feed.olderError}
          onLoadOlder={feed.loadOlder}
          handlersFor={() => ({ onChanged: () => undefined })}
          outgoing={outgoing}
          readUpTo={conversation.employeeReadSeq}
          typing={
            term ? null : conversation.typing.employee ? (
              <TypingIndicator name={firstName ?? "Funcionário"} align="left" tone="paper" />
            ) : state === "agent_active" && conversation.agentBusy ? (
              <TypingIndicator name="Nexo Assist" align="right" tone="agent" />
            ) : null
          }
          empty={
            <p className="text-ink-3 py-10 text-center text-[14px]">
              {term ? "Nenhuma mensagem encontrada." : "Sem mensagens ainda."}
            </p>
          }
        />
      )}

      <footer className="border-rule bg-paper shrink-0 border-t px-4 py-3 sm:px-6">
        {mine ? (
          <>
            <div className="mb-2 flex gap-2 md:hidden">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => act("return")}
                loading={busy === "return"}
              >
                Devolver ao agent
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => act("close")}
                loading={busy === "close"}
              >
                Encerrar
              </Button>
            </div>
            <Composer
              draftKey={`nexo-console-${conversation.id}`}
              placeholder={`Responder para ${firstName}…`}
              maxLength={4000}
              busy={outgoing !== null}
              typing={typingSignal}
              autoFocus
              onSend={reply}
            />
          </>
        ) : (
          <>
            {state === "waiting_analyst" || state === "agent_active" ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="bg-warning-soft text-warning-text flex size-10 items-center justify-center rounded-full">
                  <Hand className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-medium">
                    {state === "waiting_analyst"
                      ? `${firstName} espera um atendente`
                      : "O Nexo Assist está atendendo"}
                  </p>
                  <p className="text-ink-3 text-[14px]">
                    {state === "waiting_analyst"
                      ? `Agent pausado${handoff?.respondBy ? ` · ${contactLabel(handoff.respondBy, timeZone)}` : ""}`
                      : "Assuma se precisar intervir; o agent é pausado na hora."}
                  </p>
                </div>
                {state === "waiting_analyst" ? (
                  <Button
                    variant="secondary"
                    onClick={() => act("return")}
                    loading={busy === "return"}
                    disabled={busy !== null}
                  >
                    <Bot className="size-4" aria-hidden="true" /> Devolver ao agent
                  </Button>
                ) : null}
                <Button
                  onClick={() => act("claim")}
                  loading={busy === "claim"}
                  disabled={busy !== null}
                >
                  <Headset className="size-4" aria-hidden="true" /> Assumir atendimento
                </Button>
              </div>
            ) : (
              <p className="text-ink-3 py-2 text-center text-[14px]">
                {other
                  ? `${conversation.assignedAnalyst?.name} está atendendo esta conversa.`
                  : "Atendimento encerrado. O histórico fica disponível para consulta."}
              </p>
            )}
            {state !== "closed" && !other ? (
              // The same field the analyst gets after assuming, only locked.
              <div className="mt-3">
                <Composer
                  draftKey={`nexo-console-${conversation.id}`}
                  placeholder="Assuma o atendimento para responder"
                  maxLength={4000}
                  disabled
                  onSend={async () => false}
                />
              </div>
            ) : null}
          </>
        )}
      </footer>
    </section>
  );
}
