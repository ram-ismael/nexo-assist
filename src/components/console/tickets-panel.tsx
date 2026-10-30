"use client";

import { ArrowLeftRight, ArrowUpRight, ChevronRight, Headset, X } from "lucide-react";
import { useState } from "react";
import { isOpenStatus, PRIORITY_LABEL, STATUS_LABEL } from "@/domain/tickets";
import type { ConversationDetailDTO, TicketListItemDTO } from "@/lib/api-types";
import { formatDay, formatTime } from "@/lib/format";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/spinner";
import { Dot, statusDotClass, TicketStatusBadge } from "@/components/ui/status";
import { TicketDialog } from "@/components/tickets/ticket-dialog";

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
        className="border-rule hover:bg-desk/60 flex w-full items-center gap-3 border-b px-1 py-3.5 text-left"
      >
        <Dot className={statusDotClass(ticket.status)} />
        <span className="min-w-0 flex-1">
          <span className="text-ink block truncate text-[15px]">{ticket.title}</span>
          <span className="text-ink-3 block text-[13px]">
            {ticket.number} ·{" "}
            {ticket.status === "resolved" || ticket.status === "closed"
              ? `${STATUS_LABEL[ticket.status]} em ${formatDay(ticket.resolvedAt ?? ticket.updatedAt, timeZone)}`
              : STATUS_LABEL[ticket.status]}
            {ticket.overdue ? <span className="text-warning-text"> · vencido</span> : null}
          </span>
        </span>
        <ChevronRight className="text-ink-4 size-4" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Right column: the employee's tickets straight from the ticket service. */
export function TicketsPanel({
  employeeName,
  tickets,
  loading,
  detail,
  timeZone,
  onClose,
  onTicketUpdated,
}: {
  employeeName: string;
  tickets: TicketListItemDTO[] | undefined;
  loading: boolean;
  detail: ConversationDetailDTO | undefined;
  timeZone: string;
  onClose?: () => void;
  onTicketUpdated: () => void;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const firstName = employeeName.split(" ")[0] ?? employeeName;
  const openCount = tickets?.filter((ticket) => isOpenStatus(ticket.status)).length ?? 0;
  const closedCount = (tickets?.length ?? 0) - openCount;
  const focus = tickets?.find((ticket) => ticket.number === detail?.focusTicketNumber);
  const others = (tickets ?? []).filter((ticket) => ticket.number !== focus?.number).slice(0, 6);
  const handoff = detail?.handoff;

  return (
    <aside
      aria-label={`Chamados de ${employeeName}`}
      className="bg-paper flex h-full min-h-0 flex-col"
    >
      <header className="border-rule flex items-start justify-between border-b px-6 py-4">
        <div>
          <h2 className="text-[19px] font-semibold">Chamados de {firstName}</h2>
          <p className="text-ink-3 text-[14px]">
            {tickets ? `${openCount} abertos · ${closedCount} encerrados` : "Carregando…"}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel de chamados"
            className="text-ink-2 hover:bg-desk rounded-md p-1"
          >
            <X className="size-5" />
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <h3 className="text-ink-2 text-[14px] font-medium">Desta conversa</h3>
        {loading && !tickets ? <Skeleton className="mt-3 h-28 w-full" /> : null}
        {focus || handoff ? (
          <div className="bg-desk mt-3 rounded-xl p-4">
            {focus ? (
              <button
                type="button"
                onClick={() => setOpened(focus.number)}
                className="block w-full text-left"
              >
                <span className="flex items-center justify-between gap-2 text-[14px]">
                  <span className="text-ink-2">{focus.number}</span>
                  <TicketStatusBadge status={focus.status} />
                </span>
                <span className="mt-1 block text-[17px] font-semibold">{focus.title}</span>
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
                <p className="text-ink-2 mt-1 text-[14px] leading-relaxed whitespace-pre-wrap">
                  {handoff.summary}
                </p>
              </div>
            ) : null}
          </div>
        ) : !loading ? (
          <p className="text-ink-3 mt-2 text-[14px]">Nenhum chamado em foco nesta conversa.</p>
        ) : null}

        <h3 className="text-ink-2 mt-7 text-[14px] font-medium">Outros chamados</h3>
        {tickets && others.length === 0 ? (
          <p className="text-ink-3 mt-2 text-[14px]">Nenhum outro chamado.</p>
        ) : null}
        <ul className="mt-1">
          {others.map((ticket) => (
            <TicketRow
              key={ticket.number}
              ticket={ticket}
              timeZone={timeZone}
              onOpen={() => setOpened(ticket.number)}
            />
          ))}
        </ul>
      </div>
      <div className="p-4">
        <button
          type="button"
          onClick={() => setShowAll(true)}
          disabled={!tickets}
          className="border-rule hover:bg-desk flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-[15px] disabled:opacity-50"
        >
          Ver todos os chamados de {firstName}
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </button>
      </div>
      {showAll && tickets ? (
        <Dialog
          open
          onOpenChange={setShowAll}
          title={`Chamados de ${employeeName}`}
          description={`${tickets.length} no histórico`}
        >
          <ul>
            {tickets.map((ticket) => (
              <TicketRow
                key={ticket.number}
                ticket={ticket}
                timeZone={timeZone}
                onOpen={() => {
                  setShowAll(false);
                  setOpened(ticket.number);
                }}
              />
            ))}
          </ul>
        </Dialog>
      ) : null}
      {opened ? (
        <TicketDialog
          number={opened}
          timeZone={timeZone}
          canEdit
          onClose={() => setOpened(null)}
          onUpdated={onTicketUpdated}
        />
      ) : null}
    </aside>
  );
}
