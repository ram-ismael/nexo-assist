"use client";

import { ArrowLeft, Bot, CircleCheck, Hand, Headset, PanelRight, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { STATE_LABEL } from "@/domain/conversations";
import type { ConversationDetailDTO, MessageDTO } from "@/lib/api-types";
import { api, errorMessage, newClientId } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { untilLabel } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
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
}: {
  feed: Feed;
  detail: ConversationDetailDTO | undefined;
  analystId: string;
  timeZone: string;
  onChanged: (action?: "claim" | "return" | "close") => void;
  onBack: () => void;
  onShowTickets: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"claim" | "return" | "close" | null>(null);
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState("");
  const conversation = feed.conversation ?? detail?.conversation ?? null;
  const state = conversation?.state;
  const mine = state === "analyst_active" && conversation?.assignedAnalyst?.id === analystId;
  const other = state === "analyst_active" && !mine;

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
    try {
      const result = await api<{ message: MessageDTO }>(
        `/api/conversations/${conversation.id}/reply`,
        {
          method: "POST",
          json: { clientId: newClientId(), text },
        },
      );
      feed.add(result.message);
      onChanged();
      return true;
    } catch (error) {
      toast("error", errorMessage(error));
      await feed.sync();
      return false;
    }
  }

  if (feed.loading && !conversation) {
    return (
      <div className="bg-chat flex h-full items-center justify-center">
        <Spinner label="Carregando conversa" className="text-ink-3 size-6" />
      </div>
    );
  }
  if (feed.error || !conversation) {
    return (
      <div className="bg-chat text-ink-3 flex h-full items-center justify-center p-6 text-center text-[15px]">
        {feed.error ?? "Selecione uma conversa"}
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
        <Avatar name={conversation.employee.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-medium">{conversation.employee.name}</p>
          <p className="text-ink-3 truncate text-[14px]">
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
          className="text-ink-2 hover:bg-desk rounded-full p-2 2xl:hidden"
        >
          <PanelRight className="size-5" />
        </button>
      </header>
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
        empty={
          <p className="text-ink-3 py-10 text-center text-[14px]">
            {term ? "Nenhuma mensagem encontrada." : "Sem mensagens ainda."}
          </p>
        }
      />

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
              variant="console"
              maxLength={4000}
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
                      ? `Agent pausado${handoff?.respondBy ? ` · até ${untilLabel(handoff.respondBy, timeZone)}` : ""}`
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
              <p
                className="bg-desk text-ink-3 mt-3 rounded-2xl px-5 py-3 text-[15px]"
                aria-disabled="true"
              >
                Assuma o atendimento para responder
              </p>
            ) : null}
          </>
        )}
      </footer>
    </section>
  );
}
