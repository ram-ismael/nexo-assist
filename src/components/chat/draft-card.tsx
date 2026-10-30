"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  AFFECTED_SCOPES,
  SCOPE_LABEL,
  TICKET_CATEGORIES,
  TYPE_LABEL,
  type AffectedScope,
  type TicketCategory,
  type TicketType,
} from "@/domain/tickets";
import type { DraftDTO } from "@/lib/api-types";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { untilLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Dot, PriorityLabel } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";

const STATUS: Record<DraftDTO["status"], { label: string; tone: string; dot: string }> = {
  pending: { label: "Aguardando confirmação", tone: "text-warning-text", dot: "bg-warning" },
  confirmed: { label: "Confirmado", tone: "text-success-text", dot: "bg-success" },
  cancelled: { label: "Cancelado", tone: "text-ink-3", dot: "bg-ink-4" },
  expired: { label: "Expirado", tone: "text-ink-3", dot: "bg-ink-4" },
};

const KIND_TITLE: Record<DraftDTO["kind"], string> = {
  create: "Novo chamado",
  update: "Atualização de chamado",
  reopen: "Reabertura de chamado",
};

/**
 * The confirmation step required by the PRD. Confirm/Edit/Cancel call the API
 * directly (no model involved); the server re-validates and is idempotent.
 */
export function DraftCard({
  draft,
  timeZone,
  interactive,
  onChanged,
}: {
  draft: DraftDTO;
  timeZone: string;
  interactive: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [editing, setEditing] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const expired = draft.status === "pending" && new Date(draft.expiresAt).getTime() < openedAt;
  const status = STATUS[expired ? "expired" : draft.status];
  const actionable = interactive && draft.status === "pending" && !expired;

  async function confirm() {
    setBusy("confirm");
    try {
      const result = await api<{ ticket: { number: string }; handedOff: boolean }>(
        `/api/drafts/${draft.id}/confirm`,
        {
          method: "POST",
          json: { expectedVersion: draft.version },
        },
      );
      toast(
        "success",
        result.handedOff
          ? `Chamado ${result.ticket.number} criado e enviado a um analista (caso crítico).`
          : draft.kind === "create"
            ? `Chamado ${result.ticket.number} criado.`
            : `Chamado ${result.ticket.number} atualizado.`,
      );
      await onChanged();
    } catch (error) {
      toast("error", errorMessage(error));
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy("cancel");
    try {
      await api(`/api/drafts/${draft.id}/cancel`, { method: "POST" });
      await onChanged();
    } catch (error) {
      toast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  // Ctrl/⌘+Enter confirms the pending draft, as hinted on the button.
  useEffect(() => {
    if (!actionable) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !busy && !editing) {
        event.preventDefault();
        void confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <article
      aria-label={`${KIND_TITLE[draft.kind]}, rascunho ${draft.code}`}
      className="animate-rise border-rule bg-paper w-full overflow-hidden rounded-xl border shadow-[0_4px_16px_rgba(27,36,49,0.08)]"
    >
      <div className="px-5 pt-4 pb-5 sm:px-6">
        <header className="text-ink-3 flex flex-wrap items-center justify-between gap-2 text-[14px]">
          <p>
            {KIND_TITLE[draft.kind]} <span aria-hidden="true">·</span> Rascunho {draft.code}
            {draft.targetTicketNumber ? ` · ${draft.targetTicketNumber}` : ""}
          </p>
          <span className={cn("inline-flex items-center gap-1.5 font-medium", status.tone)}>
            <Dot className={status.dot} />
            {draft.status === "confirmed" && draft.resultTicketNumber
              ? `Confirmado · ${draft.resultTicketNumber}`
              : status.label}
          </span>
        </header>
        <h3 className="text-ink mt-2 text-[19px] font-semibold">{draft.title}</h3>
        {draft.kind === "create" ? (
          <p className="text-ink-2 mt-1.5 text-[15px] leading-relaxed">{draft.description}</p>
        ) : (
          <p className="text-ink-2 mt-1.5 text-[15px] leading-relaxed">
            <span className="text-ink-3">Informação a adicionar: </span>
            {draft.note}
          </p>
        )}
        {draft.kind === "create" ? (
          <dl className="border-rule mt-4 grid grid-cols-1 gap-4 border-t pt-4 text-[14px] sm:grid-cols-3">
            <div>
              <dt className="text-ink-3">Categoria</dt>
              <dd className="text-ink mt-0.5 text-[16px]">
                {draft.category}{" "}
                {draft.type ? (
                  <span className="text-ink-3 text-[13px]">· {TYPE_LABEL[draft.type]}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Prioridade</dt>
              <dd className="text-ink mt-0.5 text-[16px]">
                {draft.priority ? <PriorityLabel priority={draft.priority} /> : "—"}
                {draft.slaDueAt ? (
                  <span className="text-ink-3 text-[14px]">
                    {" "}
                    · resposta até {untilLabel(draft.slaDueAt, timeZone)}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Afetados</dt>
              <dd className="text-ink mt-0.5 text-[16px]">
                {draft.scope ? SCOPE_LABEL[draft.scope] : "—"}
              </dd>
            </div>
          </dl>
        ) : null}
        {draft.kind === "create" && draft.priorityExplanation ? (
          <p className="text-ink-3 mt-3 text-[13px]">{draft.priorityExplanation}</p>
        ) : null}
      </div>
      {actionable ? (
        <footer className="border-rule bg-desk flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
          <Button onClick={confirm} loading={busy === "confirm"} disabled={busy !== null}>
            Confirmar
            <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 font-sans text-[11px] sm:inline">
              Ctrl ↵
            </kbd>
          </Button>
          <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy !== null}>
            Editar
          </Button>
          <Button
            variant="ghost"
            onClick={cancel}
            loading={busy === "cancel"}
            disabled={busy !== null}
          >
            Cancelar
          </Button>
        </footer>
      ) : null}
      {editing ? (
        <EditDraftDialog
          draft={draft}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
        />
      ) : null}
    </article>
  );
}

function EditDraftDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: DraftDTO;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(draft.title ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [note, setNote] = useState(draft.note ?? "");
  const [category, setCategory] = useState<TicketCategory>(draft.category ?? "Outros");
  const [type, setType] = useState<TicketType>(draft.type ?? "INC");
  const [scope, setScope] = useState<AffectedScope>(draft.scope ?? "self");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/api/drafts/${draft.id}`, {
        method: "PATCH",
        json:
          draft.kind === "create"
            ? { expectedVersion: draft.version, title, description, category, type, scope }
            : { expectedVersion: draft.version, note },
      });
      toast("info", "Rascunho atualizado. Confira e confirme.");
      await onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  const field =
    "mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Editar rascunho ${draft.code}`}
      description={
        draft.kind === "create"
          ? "A prioridade é recalculada pelas regras do service desk."
          : undefined
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {draft.kind === "create" ? (
          <>
            <label className="block text-sm font-medium">
              Título
              <input
                className={field}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                minLength={5}
                maxLength={120}
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Descrição
              <textarea
                className={cn(field, "min-h-28")}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                minLength={10}
                maxLength={2000}
                required
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm font-medium">
                Tipo
                <select
                  className={field}
                  value={type}
                  onChange={(event) => setType(event.target.value as TicketType)}
                >
                  <option value="INC">Incidente</option>
                  <option value="REQ">Requisição</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Categoria
                <select
                  className={field}
                  value={category}
                  onChange={(event) => setCategory(event.target.value as TicketCategory)}
                >
                  {TICKET_CATEGORIES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Afetados
                <select
                  className={field}
                  value={scope}
                  onChange={(event) => setScope(event.target.value as AffectedScope)}
                >
                  {AFFECTED_SCOPES.map((item) => (
                    <option key={item} value={item}>
                      {SCOPE_LABEL[item]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        ) : (
          <label className="block text-sm font-medium">
            Informação a adicionar
            <textarea
              className={cn(field, "min-h-28")}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              minLength={3}
              maxLength={2000}
              required
            />
          </label>
        )}
        {error ? (
          <p role="alert" className="bg-danger-soft text-danger-text rounded-md px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Descartar
          </Button>
          <Button type="submit" loading={saving}>
            Salvar alterações
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
