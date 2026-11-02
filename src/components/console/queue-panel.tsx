"use client";

import { Check, CheckCheck, Search, WifiOff } from "lucide-react";
import type { QueueItemDTO, QueueResponseDTO } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { useEffect, useState, type ReactNode } from "react";
import { contactLabel, formatListTime } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/spinner";
import { Dot } from "@/components/ui/status";

export type QueueFilter = "all" | "for_you" | "with_agent" | "mine";

const FILTERS: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "for_you", label: "Para você" },
  { id: "with_agent", label: "Com o agent" },
  { id: "mine", label: "Minhas" },
];

/** One line that says what this conversation needs, from stored state only. */
function StatusLine({
  item,
  analystId,
  timeZone,
  now,
}: {
  item: QueueItemDTO;
  analystId: string;
  timeZone: string;
  now: Date;
}) {
  const firstName = item.employee.name.split(" ")[0];

  if (item.state === "waiting_analyst") {
    const handoff = item.handoff;
    const overdue = !!handoff?.respondBy && new Date(handoff.respondBy) < now;
    return (
      <Line
        dot={cn("bg-danger", overdue && "animate-pulse")}
        tone="text-danger-text"
        title={
          handoff
            ? [handoff.reason, `indicada ao ${handoff.targetLevel}`, handoff.ticketNumber]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
      >
        {item.critical ? <strong className="font-semibold">Crítico</strong> : "Transferida"}
        {handoff ? ` · ${handoff.targetLevel.replace("Suporte ", "")}` : null}
        {handoff?.respondBy ? (
          <>
            {" · "}
            <span className={overdue ? "font-semibold" : undefined}>
              {contactLabel(handoff.respondBy, timeZone, now)}
            </span>
          </>
        ) : null}
      </Line>
    );
  }

  if (item.state === "analyst_active") {
    const mine = item.assignedAnalyst?.id === analystId;
    if (!mine) {
      return (
        <Line dot="bg-primary" tone="text-ink-3">
          {item.assignedAnalyst?.name ?? "Analista"} atendendo
        </Line>
      );
    }
    // Whose turn it is: the last message tells it.
    const waitingForMe = item.lastMessageKind === "employee";
    return (
      <Line dot="bg-primary" tone="text-primary-text">
        Você está atendendo
        {waitingForMe ? (
          <span className="font-semibold"> · aguarda sua resposta</span>
        ) : item.lastMessageKind === "analyst" ? (
          <span className="text-ink-3"> · aguardando {firstName}</span>
        ) : null}
      </Line>
    );
  }

  if (item.state === "agent_active") {
    if (item.agentBusy) {
      return (
        <Line dot="bg-success animate-pulse" tone="text-success-text">
          Agent respondendo…
        </Line>
      );
    }
    return item.lowCertainty ? (
      <Line dot="bg-warning" tone="text-warning-text">
        Agent com segurança baixa
      </Line>
    ) : (
      <Line dot="bg-success" tone="text-ink-3">
        Agent atendendo
      </Line>
    );
  }

  return (
    <Line dot="bg-ink-4" tone="text-ink-3">
      {item.assignedAnalyst
        ? `Encerrada por ${item.assignedAnalyst.name.split(" ")[0]}`
        : item.hadHandoff
          ? "Encerrada"
          : "Atendida só pelo agent"}
    </Line>
  );
}

function Line({
  dot,
  tone,
  title,
  children,
}: {
  dot: string;
  tone: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", tone)} title={title}>
      <Dot className={cn("shrink-0", dot)} />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function QueuePanel({
  data,
  loading,
  error,
  onRetry,
  filter,
  onFilter,
  query,
  onQuery,
  selectedId,
  onSelect,
  analystId,
  timeZone,
  available,
  onToggleAvailable,
}: {
  data: QueueResponseDTO | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  filter: QueueFilter;
  onFilter: (filter: QueueFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  analystId: string;
  timeZone: string;
  available: boolean;
  onToggleAvailable: () => void;
}) {
  // Countdowns ("contato em 25 min") advance even when the queue data does not change.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section aria-label="Conversas" className="bg-paper flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between px-5 pt-5">
        <h1 className="text-[24px] font-semibold tracking-tight">Conversas</h1>
        <button
          type="button"
          onClick={onToggleAvailable}
          aria-pressed={available}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium transition-colors",
            available ? "bg-success-soft text-success-text" : "bg-desk text-ink-3",
          )}
        >
          <Dot className={available ? "bg-success" : "bg-ink-4"} />
          {available ? "Disponível" : "Ausente"}
        </button>
      </header>
      <div className="px-5 pt-4">
        <label className="bg-desk focus-within:ring-primary/20 flex h-11 items-center gap-2.5 rounded-xl px-3.5 focus-within:ring-2">
          <Search className="text-ink-3 size-[18px]" aria-hidden="true" />
          <span className="sr-only">Pesquisar conversa ou chamado</span>
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Pesquisar conversa ou chamado"
            className="placeholder:text-ink-3 h-full flex-1 bg-transparent text-[15px] outline-none"
          />
        </label>
        <div
          role="group"
          aria-label="Filtrar conversas"
          className="mt-3 flex w-full justify-between gap-1.5"
        >
          {FILTERS.map((item) => {
            const active = filter === item.id;
            const count = data?.counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => onFilter(item.id)}
                className={cn(
                  // Chips grow with their content to span the row (aligned with the
                  // search field above) and re-flow with the panel width.
                  "h-8 flex-auto rounded-full px-2 text-[13px] whitespace-nowrap transition-colors",
                  active
                    ? "bg-primary-soft text-primary-text font-medium"
                    : "bg-desk text-ink-2 hover:bg-rule",
                )}
              >
                {item.label}
                {item.id !== "all" && count !== undefined ? (
                  <span className="ml-1.5 font-semibold tabular-nums">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading && !data ? (
          <div className="space-y-3 px-3 py-2">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex gap-3">
                <Skeleton className="size-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {error && data ? (
          // Keep working with the last known queue; say it may be outdated.
          <p
            role="status"
            className="bg-warning-soft text-warning-text mx-2 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]"
          >
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            Sem atualização no momento. Mostrando o último estado da fila; tentando de novo.
          </p>
        ) : error ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-danger-text text-[14px]">{error}</p>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Tentar de novo
            </Button>
          </div>
        ) : null}
        {data && data.items.length === 0 ? (
          <p className="text-ink-3 px-4 py-10 text-center text-[14px]">
            {query
              ? "Nenhuma conversa encontrada para essa busca."
              : filter === "for_you"
                ? "Nenhuma conversa aguardando atendente."
                : "Nenhuma conversa aqui ainda."}
          </p>
        ) : null}
        <ul className="space-y-0.5">
          {data?.items.map((item) => {
            const selected = item.id === selectedId;
            const unread = item.unread > 0 && !selected;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3.5 rounded-xl px-3 py-3.5 text-left transition-colors duration-150",
                    selected ? "bg-desk" : "hover:bg-desk/70",
                  )}
                >
                  <Avatar
                    name={item.employee.name}
                    size="lg"
                    online={item.employeeOnline || undefined}
                  />
                  <span className="border-rule min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-ink truncate text-[16px] font-medium">
                        {item.employee.name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[13px]",
                          unread ? "text-primary-text font-semibold" : "text-ink-3",
                        )}
                      >
                        {formatListTime(item.lastActivityAt, timeZone)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="text-ink-2 flex min-w-0 flex-1 items-center gap-1 truncate text-[14px]">
                        {item.employeeTyping ? (
                          <span className="text-success-text truncate italic">digitando…</span>
                        ) : item.lastMessageKind === "agent" ||
                          item.lastMessageKind === "analyst" ? (
                          <>
                            {item.lastMessageRead ? (
                              <CheckCheck
                                className="text-primary size-3.5 shrink-0"
                                aria-label="lida"
                              />
                            ) : (
                              <Check
                                className="text-ink-4 size-3.5 shrink-0"
                                aria-label="enviada"
                              />
                            )}
                            <span className="truncate">
                              {item.lastMessageKind === "agent"
                                ? "Nexo: "
                                : item.assignedAnalyst?.id === analystId
                                  ? "Você: "
                                  : `${item.assignedAnalyst?.name.split(" ")[0] ?? "Analista"}: `}
                              {item.lastMessagePreview}
                            </span>
                          </>
                        ) : (
                          <span className="truncate">
                            {item.lastMessagePreview ?? "Sem mensagens"}
                          </span>
                        )}
                      </span>
                      {unread ? (
                        // Keyed by count: the badge pops in again when a new message lands.
                        <span
                          key={item.unread}
                          className="bg-cta animate-pop flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white tabular-nums"
                        >
                          <span className="sr-only">mensagens não lidas: </span>
                          {item.unread > 99 ? "99+" : item.unread}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[13px]">
                      <StatusLine item={item} analystId={analystId} timeZone={timeZone} now={now} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
