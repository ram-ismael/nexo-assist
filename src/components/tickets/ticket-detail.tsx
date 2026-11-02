"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  canAnalystMoveTo,
  SCOPE_LABEL_DESK,
  STATUS_LABEL,
  TICKET_STATUSES,
  TYPE_LABEL,
  type TicketStatus,
} from "@/domain/tickets";
import type { TicketDetailDTO } from "@/lib/api-types";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { contactLabel, durationLabel, formatDateTime, untilLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
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

const EVENT_DOT: Record<string, string> = {
  created: "bg-primary",
  reopened: "bg-warning",
  transferred: "bg-warning",
  analyst_note: "bg-success",
  status_changed: "bg-success",
};

/** Shaped like the loaded detail, so nothing jumps when it arrives. */
function TicketDetailSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-2.5">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-transparent p-4">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      <div className="space-y-4">
        <Skeleton className="h-4 w-20" />
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="mt-1 size-2.5 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-3 text-[13px]">{label}</dt>
      <dd className="text-ink mt-0.5 truncate text-[14px]">{children}</dd>
    </div>
  );
}

/**
 * Full ticket: fields, deadline, history (newest first) and, for analysts, the
 * update form. Content only: the caller decides where it lives (the drawer).
 */
export function TicketDetail({
  number,
  timeZone,
  canEdit,
  onUpdated,
  onLoaded,
}: {
  number: string;
  timeZone: string;
  canEdit: boolean;
  onUpdated?: () => void;
  onLoaded?: (ticket: TicketDetailDTO) => void;
}) {
  const toast = useToast();
  const [ticket, setTicket] = useState<TicketDetailDTO | null>(null);
  // When the data was read, so "vencido há…" is computed outside render.
  const [readAt, setReadAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ ticket: TicketDetailDTO }>(`/api/tickets/${number}`)
      .then((result) => {
        if (!active) return;
        setTicket(result.ticket);
        setReadAt(Date.now());
        setError(null);
        onLoaded?.(result.ticket);
      })
      .catch((reason: unknown) => active && setError(errorMessage(reason)));
    return () => {
      active = false;
    };
    // onLoaded is a notification; refetching when its identity changes is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

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
      setReadAt(Date.now());
      onLoaded?.(result.ticket);
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

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-danger-text text-[14px]">{error}</p>
        <Button size="sm" variant="secondary" onClick={retry}>
          <RotateCcw className="size-3.5" aria-hidden="true" /> Tentar de novo
        </Button>
      </div>
    );
  }
  if (!ticket) {
    return (
      <div role="status" aria-label={`Carregando o chamado ${number}`}>
        <TicketDetailSkeleton />
      </div>
    );
  }

  const open = !ticket.resolvedAt && ticket.status !== "closed" && ticket.status !== "resolved";
  const events = [...ticket.events].reverse();

  return (
    <div className="space-y-6 text-[14px]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <TicketStatusBadge status={ticket.status} />
          {ticket.overdue ? (
            <span className="bg-warning-soft text-warning-text rounded-full px-2 py-0.5 text-[12px] font-semibold">
              Prazo vencido
            </span>
          ) : null}
        </div>
        <h3 className="text-ink mt-2 text-[18px] leading-snug font-semibold">{ticket.title}</h3>
        <p className="text-ink-2 mt-1.5 leading-relaxed whitespace-pre-wrap">
          {ticket.description}
        </p>
      </div>

      <dl className="bg-desk grid grid-cols-2 gap-x-4 gap-y-3.5 rounded-xl p-4">
        <Field label="Tipo">{TYPE_LABEL[ticket.type]}</Field>
        <Field label="Categoria">
          {ticket.category}
          {ticket.subcategory ? ` › ${ticket.subcategory}` : ""}
        </Field>
        <Field label="Prioridade">
          <PriorityLabel priority={ticket.priority} />
        </Field>
        <Field label="Afetados">{SCOPE_LABEL_DESK[ticket.scope]}</Field>
        <Field label="Aberto em">{formatDateTime(ticket.createdAt, timeZone)}</Field>
        <Field label={`Prazo (${ticket.slaLabel})`}>
          {open ? (
            <span
              className={cn(ticket.overdue && "text-warning-text font-medium")}
              title={untilLabel(ticket.slaDueAt, timeZone)}
            >
              {ticket.overdue
                ? `vencido há ${durationLabel(readAt - Date.parse(ticket.slaDueAt))}`
                : contactLabel(ticket.slaDueAt, timeZone).replace(/^contato /, "")}
            </span>
          ) : (
            <span className="text-ink-3">Encerrado</span>
          )}
        </Field>
      </dl>

      {ticket.resolution ? (
        <p className="bg-success-soft text-success-text rounded-xl px-4 py-3 leading-relaxed">
          <span className="font-semibold">Resolução:</span> {ticket.resolution}
        </p>
      ) : null}

      {canEdit && ticket.status !== "closed" ? (
        <form onSubmit={submit} className="border-rule space-y-3 rounded-xl border p-4">
          <p className="text-ink font-medium">Atualizar chamado</p>
          <label className="block">
            <span className="text-ink-3 text-[13px]">Novo status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as TicketStatus | "")}
              className="border-rule bg-paper focus:border-primary focus:ring-primary/15 mt-1 h-10 w-full rounded-lg border px-2.5 transition-colors outline-none focus:ring-2"
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
            <span className="text-ink-3 text-[13px]">Nota para o histórico</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              className="border-rule bg-paper focus:border-primary focus:ring-primary/15 mt-1 min-h-20 w-full rounded-lg border px-2.5 py-2 transition-colors outline-none focus:ring-2"
              placeholder="O que foi feito ou combinado"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <p className="text-ink-3 text-[12px]">Salvar renova o prazo do chamado.</p>
            <Button type="submit" size="sm" loading={saving} disabled={!status && !note.trim()}>
              Salvar atualização
            </Button>
          </div>
        </form>
      ) : null}

      <section aria-label="Histórico do chamado">
        <h4 className="text-ink-2 mb-3 font-medium">Histórico</h4>
        <ol className="relative space-y-4">
          <span
            aria-hidden="true"
            className="bg-rule absolute top-1.5 bottom-1.5 left-[4.5px] w-px"
          />
          {events.map((event) => (
            <li key={event.id} className="relative pl-6">
              <span
                aria-hidden="true"
                className={cn(
                  "ring-paper absolute top-1.5 left-0 size-2.5 rounded-full ring-4",
                  EVENT_DOT[event.action] ?? "bg-ink-4",
                )}
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
              {event.note ? (
                <p className="text-ink-2 bg-desk mt-1.5 rounded-lg px-3 py-2 leading-relaxed">
                  {event.note}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
