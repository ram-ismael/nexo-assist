import { CATEGORY_SUB_SEPARATOR } from "./constants";
import type { TicketSnapshot } from "@/lib/api-types";
import { formatDateTime, relativeAge } from "@/lib/format";
import { PriorityLabel, TicketStatusBadge } from "@/components/ui/status";

/** Ticket as returned by the ticket service when the agent showed it. */
export function TicketCard({ ticket, timeZone }: { ticket: TicketSnapshot; timeZone: string }) {
  const category = ticket.subcategory
    ? `${ticket.category}${CATEGORY_SUB_SEPARATOR}${ticket.subcategory}`
    : ticket.category;
  return (
    <article
      aria-label={`Chamado ${ticket.number}`}
      className="animate-rise border-rule bg-paper w-full rounded-xl border px-5 pt-4 pb-5 shadow-[0_2px_8px_rgba(27,36,49,0.06)] sm:px-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
        <p className="text-ink-3">
          Chamado <span aria-hidden="true">·</span>{" "}
          <span className="text-ink-2">{ticket.number}</span>
        </p>
        <TicketStatusBadge status={ticket.status} />
      </header>
      <h3 className="text-ink mt-2 text-[19px] font-semibold tracking-[-0.005em]">
        {ticket.title}
      </h3>
      <p className="text-ink-2 mt-1.5 text-[15px] leading-relaxed">{ticket.description}</p>
      <dl className="border-rule mt-4 grid grid-cols-2 gap-4 border-t pt-4 text-[14px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-3">Categoria</dt>
          <dd className="text-ink mt-0.5 text-[15px]">{category}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Prioridade</dt>
          <dd className="text-ink mt-0.5 text-[15px]">
            <PriorityLabel priority={ticket.priority} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Aberto em</dt>
          <dd className="text-ink mt-0.5 text-[15px]">
            {formatDateTime(ticket.createdAt, timeZone)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Última atualização</dt>
          <dd className="mt-0.5 text-[15px]">
            <span className={ticket.overdue ? "text-warning-text font-medium" : "text-ink"}>
              {relativeAge(ticket.updatedAt)}
            </span>
            {ticket.overdue ? (
              <span className="text-ink-3"> · prazo vencido</span>
            ) : ticket.status !== "resolved" && ticket.status !== "closed" ? (
              <span className="text-ink-3 block text-[13px]">prazo {ticket.slaLabel}</span>
            ) : null}
          </dd>
        </div>
      </dl>
    </article>
  );
}
