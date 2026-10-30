"use client";

import { ArrowLeft, ArrowLeftRight, ArrowUpRight, ChevronRight, Headset, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { isOpenStatus, PRIORITY_LABEL, STATUS_LABEL } from "@/domain/tickets";
import type { ConversationDetailDTO, TicketListItemDTO } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { formatDay, formatTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/spinner";
import { Dot, statusDotClass, TicketStatusBadge } from "@/components/ui/status";
import { TicketDetail } from "@/components/tickets/ticket-detail";

type View =
  | { name: "overview" }
  | { name: "all" }
  | { name: "ticket"; number: string; from: "overview" | "all" };

type Filter = "all" | "open" | "closed";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function TicketRow({
  ticket,
  timeZone,
  onOpen,
}: {
  ticket: TicketListItemDTO;
  timeZone: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="border-rule hover:bg-desk/70 group flex w-full items-center gap-3 border-b px-2 py-3.5 text-left transition-colors"
      >
        <Dot className={statusDotClass(ticket.status)} />
        <span className="min-w-0 flex-1">
          <span className="text-ink block truncate text-[15px]">{ticket.title}</span>
          <span className="text-ink-3 block truncate text-[13px]">
            {ticket.number} ·{" "}
            {ticket.status === "resolved" || ticket.status === "closed"
              ? `${STATUS_LABEL[ticket.status]} em ${formatDay(ticket.resolvedAt ?? ticket.updatedAt, timeZone)}`
              : STATUS_LABEL[ticket.status]}
            {ticket.overdue ? <span className="text-warning-text"> · vencido</span> : null}
          </span>
        </span>
        <ChevronRight
          className="text-ink-4 group-hover:text-ink-2 size-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

function RowsSkeleton({ count }: { count: number }) {
  return (
    <div className="mt-1" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-2 py-3.5">
          <Skeleton className="size-2 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Header({
  title,
  subtitle,
  onBack,
  onClose,
  backRef,
}: {
  title: string;
  subtitle: ReactNode;
  onBack?: () => void;
  onClose?: () => void;
  backRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <header className="border-rule flex min-h-[72px] items-center gap-1.5 border-b px-4 py-3 sm:px-5">
      {onBack ? (
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          aria-label="Voltar"
          className="text-ink-2 hover:bg-desk -ml-1.5 rounded-md p-1.5 transition-colors"
        >
          <ArrowLeft className="size-5" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[18px] font-semibold">{title}</h2>
        <p className="text-ink-3 truncate text-[13px]">{subtitle}</p>
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar painel de chamados"
          className="text-ink-2 hover:bg-desk rounded-md p-1.5 transition-colors"
        >
          <X className="size-5" />
        </button>
      ) : null}
    </header>
  );
}

/**
 * Right column: the employee's tickets. One drawer, three screens (overview,
 * full history, ticket detail): no dialog on top of the conversation, a back
 * button and Esc to go back, focus moved to the new screen, a directional slide.
 */
export function TicketsPanel({
  employeeName,
  tickets,
  loading,
  detail,
  timeZone,
  onClose,
  onTicketUpdated,
  onSubviewChange,
}: {
  employeeName: string;
  tickets: TicketListItemDTO[] | undefined;
  loading: boolean;
  detail: ConversationDetailDTO | undefined;
  timeZone: string;
  onClose?: () => void;
  onTicketUpdated: () => void;
  /** Lets a surrounding dialog keep Esc for "back" while a sub-screen is open. */
  onSubviewChange?: (open: boolean) => void;
}) {
  const [view, setView] = useState<View>({ name: "overview" });
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [filter, setFilter] = useState<Filter>("all");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [loadedStatus, setLoadedStatus] = useState<string | null>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const firstName = employeeName.split(" ")[0] ?? employeeName;
  const openCount = tickets?.filter((ticket) => isOpenStatus(ticket.status)).length ?? 0;
  const closedCount = (tickets?.length ?? 0) - openCount;
  const focus = tickets?.find((ticket) => ticket.number === detail?.focusTicketNumber);
  const others = (tickets ?? []).filter((ticket) => ticket.number !== focus?.number).slice(0, 6);
  const handoff = detail?.handoff;

  const go = (next: View) => {
    setDirection("forward");
    setLoadedStatus(null);
    setView(next);
  };
  const back = () => {
    setDirection("back");
    setView(view.name === "ticket" && view.from === "all" ? { name: "all" } : { name: "overview" });
  };

  // Keyboard and screen-reader users land on the new screen, not on a button
  // that no longer exists.
  useEffect(() => {
    if (view.name !== "overview") backButton.current?.focus();
    onSubviewChange?.(view.name !== "overview");
  }, [view, onSubviewChange]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && view.name !== "overview") {
      // Back one screen instead of closing the whole drawer.
      event.stopPropagation();
      event.preventDefault();
      back();
    }
  };

  const counts = tickets
    ? `${plural(openCount, "aberto", "abertos")} · ${plural(closedCount, "encerrado", "encerrados")}`
    : "Carregando…";
  const filtered = (tickets ?? []).filter((ticket) =>
    filter === "all"
      ? true
      : filter === "open"
        ? isOpenStatus(ticket.status)
        : !isOpenStatus(ticket.status),
  );
  const groups = [
    { title: "Abertos", list: filtered.filter((ticket) => isOpenStatus(ticket.status)) },
    { title: "Encerrados", list: filtered.filter((ticket) => !isOpenStatus(ticket.status)) },
  ];

  return (
    <aside
      aria-label={`Chamados de ${employeeName}`}
      onKeyDown={onKeyDown}
      className="bg-paper flex h-full min-h-0 flex-col overflow-hidden"
    >
      {view.name === "overview" ? (
        <Header title={`Chamados de ${firstName}`} subtitle={counts} onClose={onClose} />
      ) : view.name === "all" ? (
        <Header
          title="Todos os chamados"
          subtitle={`${employeeName} · ${counts}`}
          onBack={back}
          onClose={onClose}
          backRef={backButton}
        />
      ) : (
        <Header
          title={view.number}
          subtitle={loadedStatus ?? "Carregando…"}
          onBack={back}
          onClose={onClose}
          backRef={backButton}
        />
      )}

      <div
        key={view.name === "ticket" ? `ticket-${view.number}` : view.name}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5",
          direction === "forward" ? "animate-slide-in" : "animate-slide-back",
        )}
      >
        {view.name === "overview" ? (
          <>
            <h3 className="text-ink-2 text-[14px] font-medium">Desta conversa</h3>
            {loading && !tickets ? <Skeleton className="mt-3 h-36 w-full rounded-xl" /> : null}
            {focus || handoff ? (
              <div className="bg-desk mt-3 rounded-xl p-4">
                {focus ? (
                  <button
                    type="button"
                    onClick={() => go({ name: "ticket", number: focus.number, from: "overview" })}
                    className="group block w-full text-left"
                  >
                    <span className="flex items-center justify-between gap-2 text-[14px]">
                      <span className="text-ink-2">{focus.number}</span>
                      <TicketStatusBadge status={focus.status} />
                    </span>
                    <span className="group-hover:text-primary-text mt-1 block text-[17px] font-semibold transition-colors">
                      {focus.title}
                    </span>
                    <span className="text-ink-3 mt-0.5 block text-[14px]">
                      {focus.category} · prioridade {PRIORITY_LABEL[focus.priority].toLowerCase()}
                      {focus.overdue ? (
                        <span className="text-warning-text"> · prazo vencido</span>
                      ) : null}
                    </span>
                  </button>
                ) : null}
                {handoff ? (
                  <div className={focus ? "border-rule mt-3 border-t pt-3" : ""}>
                    <p className="text-ink-2 flex items-center justify-between gap-2 text-[14px]">
                      <span className="inline-flex items-center gap-2">
                        {handoff.claimedBy ? (
                          <Headset className="size-4" aria-hidden="true" />
                        ) : (
                          <ArrowLeftRight className="size-4" aria-hidden="true" />
                        )}
                        {handoff.claimedBy
                          ? `Assumido por ${handoff.claimedBy}`
                          : `Transferido para ${handoff.targetLevel}`}
                      </span>
                      <span className="text-ink-3">
                        {formatTime(handoff.claimedAt ?? handoff.createdAt, timeZone)}
                      </span>
                    </p>
                    <p className="text-ink-3 mt-2 text-[13px]">Motivo: {handoff.reason}</p>
                    <p
                      className={cn(
                        "text-ink-2 mt-1 text-[14px] leading-relaxed whitespace-pre-wrap",
                        !summaryOpen && "line-clamp-4",
                      )}
                    >
                      {handoff.summary}
                    </p>
                    {handoff.summary.length > 220 ? (
                      <button
                        type="button"
                        onClick={() => setSummaryOpen((value) => !value)}
                        aria-expanded={summaryOpen}
                        className="text-primary-text mt-1 text-[13px] font-medium hover:underline"
                      >
                        {summaryOpen ? "Mostrar menos" : "Ver resumo completo"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : !loading ? (
              <p className="text-ink-3 mt-2 text-[14px]">Nenhum chamado em foco nesta conversa.</p>
            ) : null}

            <h3 className="text-ink-2 mt-7 text-[14px] font-medium">Outros chamados</h3>
            {loading && !tickets ? <RowsSkeleton count={3} /> : null}
            {tickets && others.length === 0 ? (
              <p className="text-ink-3 mt-2 text-[14px]">Nenhum outro chamado.</p>
            ) : null}
            <ul className="mt-1">
              {others.map((ticket) => (
                <TicketRow
                  key={ticket.number}
                  ticket={ticket}
                  timeZone={timeZone}
                  onOpen={() => go({ name: "ticket", number: ticket.number, from: "overview" })}
                />
              ))}
            </ul>
          </>
        ) : view.name === "all" ? (
          <>
            <div role="group" aria-label="Filtrar chamados" className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", "Todos", tickets?.length],
                  ["open", "Abertos", openCount],
                  ["closed", "Encerrados", closedCount],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                  className={cn(
                    "h-8 rounded-full px-3 text-[13px] transition-colors",
                    filter === id
                      ? "bg-primary-soft text-primary-text font-medium"
                      : "bg-desk text-ink-2 hover:bg-rule",
                  )}
                >
                  {label}
                  {tickets ? <span className="ml-1.5 tabular-nums">{count}</span> : null}
                </button>
              ))}
            </div>
            {!tickets ? <RowsSkeleton count={6} /> : null}
            {tickets && filtered.length === 0 ? (
              <p className="text-ink-3 py-10 text-center text-[14px]">
                {filter === "open" ? "Nenhum chamado aberto." : "Nenhum chamado encerrado."}
              </p>
            ) : null}
            {groups.map((group) =>
              group.list.length > 0 ? (
                <section key={group.title} className="mt-5">
                  <h3 className="text-ink-3 px-2 text-[12px] font-semibold tracking-wide uppercase">
                    {group.title} · {group.list.length}
                  </h3>
                  <ul className="mt-1">
                    {group.list.map((ticket) => (
                      <TicketRow
                        key={ticket.number}
                        ticket={ticket}
                        timeZone={timeZone}
                        onOpen={() => go({ name: "ticket", number: ticket.number, from: "all" })}
                      />
                    ))}
                  </ul>
                </section>
              ) : null,
            )}
          </>
        ) : (
          <TicketDetail
            number={view.number}
            timeZone={timeZone}
            canEdit
            onLoaded={(ticket) =>
              setLoadedStatus(`${STATUS_LABEL[ticket.status]} · ${ticket.category}`)
            }
            onUpdated={onTicketUpdated}
          />
        )}
      </div>

      {view.name === "overview" ? (
        <div className="border-rule border-t p-4">
          <button
            type="button"
            onClick={() => go({ name: "all" })}
            disabled={!tickets}
            className="border-rule hover:bg-desk group flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-[15px] transition-colors disabled:opacity-50"
          >
            Ver todos os chamados de {firstName}
            <ArrowUpRight
              className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
          </button>
        </div>
      ) : null}
    </aside>
  );
}
