"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  canAnalystMoveTo,
  SCOPE_LABEL,
  STATUS_LABEL,
  TICKET_STATUSES,
  TYPE_LABEL,
  type TicketStatus,
} from "@/domain/tickets";
import type { TicketDetailDTO } from "@/lib/api-types";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime, untilLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/spinner";
import { PriorityLabel, TicketStatusBadge } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";

const EVENT_LABEL: Record<string, string> = {
  created: "Chamado aberto",
  status_changed: "Status alterado",
  employee_note: "Funcionário adicionou informação",
  analyst_note: "Analista registrou uma atualização",
  reopened: "Chamado reaberto",
  transferred: "Transferido para um analista",
};

/** Ticket detail with full history; analysts can update status and add notes. */
export function TicketDialog({
  number,
  timeZone,
  canEdit,
  onClose,
  onUpdated,
}: {
  number: string;
  timeZone: string;
  canEdit: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const toast = useToast();
  const [ticket, setTicket] = useState<TicketDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ ticket: TicketDetailDTO }>(`/api/tickets/${number}`)
      .then((result) => active && setTicket(result.ticket))
      .catch((reason: unknown) => active && setError(errorMessage(reason)));
    return () => {
      active = false;
    };
  }, [number]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ticket || (!status && !note.trim())) return;
    setSaving(true);
    try {
      const result = await api<{ ticket: TicketDetailDTO }>(`/api/tickets/${ticket.number}`, {
        method: "PATCH",
        json: {
          expectedVersion: ticket.version,
          ...(status ? { status } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setTicket(result.ticket);
      setStatus("");
      setNote("");
      toast("success", `Chamado ${result.ticket.number} atualizado. O prazo foi renovado.`);
      onUpdated?.();
    } catch (reason) {
      toast("error", errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Chamado ${number}`}
      side="right"
    >
      {error ? <p className="text-danger-text text-sm">{error}</p> : null}
      {!ticket && !error ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : null}
      {ticket ? (
        <div className="space-y-5 text-[14px]">
          <div>
            <TicketStatusBadge status={ticket.status} />
            <h3 className="mt-1.5 text-lg font-semibold">{ticket.title}</h3>
            <p className="text-ink-2 mt-1 leading-relaxed whitespace-pre-wrap">
              {ticket.description}
            </p>
          </div>
          <dl className="border-rule grid grid-cols-2 gap-3 rounded-lg border p-3">
            <div>
              <dt className="text-ink-3">Tipo</dt>
              <dd>{TYPE_LABEL[ticket.type]}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Categoria</dt>
              <dd>
                {ticket.category}
                {ticket.subcategory ? ` › ${ticket.subcategory}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Prioridade</dt>
              <dd>
                <PriorityLabel priority={ticket.priority} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Afetados</dt>
              <dd>{SCOPE_LABEL[ticket.scope]}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Solicitante</dt>
              <dd>{ticket.requester.name}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Prazo ({ticket.slaLabel})</dt>
              <dd className={ticket.overdue ? "text-warning-text font-medium" : ""}>
                {ticket.overdue ? "Vencido · " : ""}
                {untilLabel(ticket.slaDueAt, timeZone)}
              </dd>
            </div>
          </dl>
          {ticket.resolution ? (
            <p className="bg-success-soft text-success-text rounded-md px-3 py-2">
              Resolução: {ticket.resolution}
            </p>
          ) : null}

          {canEdit ? (
            <form onSubmit={submit} className="border-rule space-y-3 rounded-lg border p-3">
              <p className="font-medium">Atualizar chamado</p>
              <label className="block">
                <span className="text-ink-3">Novo status</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as TicketStatus | "")}
                  className="border-rule bg-paper mt-1 h-9 w-full rounded-md border px-2"
                >
                  <option value="">Manter “{STATUS_LABEL[ticket.status]}”</option>
                  {TICKET_STATUSES.filter((option) => canAnalystMoveTo(ticket.status, option)).map(
                    (option) => (
                      <option key={option} value={option}>
                        {STATUS_LABEL[option]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="block">
                <span className="text-ink-3">Nota para o histórico</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={2000}
                  className="border-rule bg-paper mt-1 min-h-20 w-full rounded-md border px-2 py-1.5"
                  placeholder="O que foi feito ou combinado"
                />
              </label>
              <Button type="submit" size="sm" loading={saving} disabled={!status && !note.trim()}>
                Salvar atualização
              </Button>
            </form>
          ) : null}

          <div>
            <p className="mb-2 font-medium">Histórico</p>
            <ol className="border-rule space-y-3 border-l pl-4">
              {ticket.events.map((event) => (
                <li key={event.id} className="relative">
                  <span
                    className="bg-ink-4 absolute top-1.5 -left-[21px] size-2 rounded-full"
                    aria-hidden="true"
                  />
                  <p className="text-ink">
                    {EVENT_LABEL[event.action] ?? event.action}
                    {event.toStatus && event.fromStatus !== event.toStatus
                      ? ` → ${STATUS_LABEL[event.toStatus]}`
                      : ""}
                  </p>
                  <p className="text-ink-3 text-[13px]">
                    {formatDateTime(event.createdAt, timeZone)} ·{" "}
                    {event.actorName ?? (event.actorKind === "agent" ? "Nexo Assist" : "Sistema")}
                  </p>
                  {event.note ? <p className="text-ink-2 mt-0.5">{event.note}</p> : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
