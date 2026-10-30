import { Check } from "lucide-react";
import { PRIORITY_LABEL, type Priority } from "@/domain/tickets";
import { durationLabel, formatTime } from "@/lib/format";
import type { LiveShowcase, PublicMetrics } from "@/server/metrics";

type Stat = { value: string | null; label: string; pending: string; online?: boolean };

const PRIORITY_DOT: Record<Priority, string> = {
  critica: "bg-danger",
  alta: "bg-warning",
  media: "bg-primary",
  baixa: "bg-ink-4",
};

function ago(at: string, generatedAt: string): string {
  const ms = Date.parse(generatedAt) - Date.parse(at);
  return ms < 60_000 ? "agora" : `há ${durationLabel(ms)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The service right now, from real (non-demo) data and anonymous by design:
 * this page is public, so no names, message text, ticket titles or numbers.
 */
function LiveCard({ live, timeZone }: { live: LiveShowcase | null; timeZone: string }) {
  if (!live) return null;
  const { lastTurn, lastTicket, today } = live;
  return (
    <section
      aria-label="Agora no service desk"
      // Reference T1: about 80% of the title's width, ending just inside its right edge.
      className="mt-12 hidden w-[80%] self-end rounded-2xl border border-white/10 bg-white/[0.04] p-5 [contain:inline-size] sm:mr-[3%] sm:block"
    >
      <p className="flex items-center justify-between gap-3 text-[13px]">
        <span className="inline-flex items-center gap-2 font-medium text-white/90">
          <span className="relative flex size-2">
            <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden" />
            <span className="bg-success relative inline-flex size-2 rounded-full" />
          </span>
          Agora no service desk
        </span>
        <span className="text-white/40">
          atualizado às {formatTime(live.generatedAt, timeZone)}
        </span>
      </p>

      {lastTurn ? (
        <div className="mt-3.5">
          <p className="text-[13px] text-white/55">
            <span className="font-medium text-white/90">Nexo Assist</span> · último atendimento{" "}
            {ago(lastTurn.at, live.generatedAt)}
          </p>
          {lastTurn.steps.length > 0 ? (
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-white/55">
              {lastTurn.steps.map((step) => (
                <span key={step} className="inline-flex items-center gap-1">
                  <Check className="size-3" aria-hidden="true" /> {step}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3.5 text-[14px] leading-relaxed text-white/70">
          Nenhum atendimento ainda. O Nexo Assist está pronto para a primeira conversa.
        </p>
      )}

      {lastTicket ? (
        <div className="mt-3.5">
          <p className="text-ink inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-[13px]">
            <span
              className={`size-2 rounded-full ${PRIORITY_DOT[lastTicket.priority]}`}
              aria-hidden="true"
            />
            <span className="font-semibold">{lastTicket.category}</span>
            <span className="text-ink-3">
              {PRIORITY_LABEL[lastTicket.priority]} · resposta em até {lastTicket.slaLabel}
            </span>
          </p>
          <p className="mt-1.5 text-[12px] text-white/40">
            último chamado aberto pelo assistente · {ago(lastTicket.at, live.generatedAt)}
          </p>
        </div>
      ) : null}

      <p className="mt-4 border-t border-white/10 pt-3 text-[13px] text-white/55">
        Hoje: {plural(today.conversations, "atendimento", "atendimentos")} ·{" "}
        {plural(today.tickets, "chamado aberto", "chamados abertos")} ·{" "}
        {plural(today.handoffs, "transferência", "transferências")}
      </p>
    </section>
  );
}

/**
 * Left panel of the login. The live card and the numbers at the bottom are computed from stored turns,
 * conversations and analyst heartbeats. Without enough data a metric shows "—"
 * and says why, never an invented value.
 */
export function LoginShowcase({
  metrics,
  live,
  timeZone,
}: {
  metrics: PublicMetrics;
  live: LiveShowcase | null;
  timeZone: string;
}) {
  const stats: Stat[] = [
    {
      value:
        metrics.avgFirstResponseSeconds !== null ? `${metrics.avgFirstResponseSeconds} s` : null,
      label: "primeira resposta, em média",
      pending: "Ainda sem respostas suficientes do assistente nos últimos 7 dias.",
    },
    {
      value: metrics.withoutHandoffPercent !== null ? `${metrics.withoutHandoffPercent}%` : null,
      label: "resolvidos sem fila",
      pending: "Ainda sem conversas suficientes nos últimos 30 dias.",
    },
    {
      value: metrics.analystsOnline !== null ? String(metrics.analystsOnline) : null,
      label: metrics.analystsOnline === 1 ? "analista online agora" : "analistas online agora",
      pending: "Presença dos analistas indisponível no momento.",
      online: (metrics.analystsOnline ?? 0) > 0,
    },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center py-12 lg:py-0">
        <p className="text-[15px] text-white/65">Service desk de TI da Nexo</p>
        {/* As wide as the title's longest line (the description and the card opt out of
            sizing it with contain: inline-size), so the card can end where the title ends. */}
        <div className="flex w-fit max-w-full flex-col">
          <h2 className="font-display mt-4 text-[42px] leading-[1.1] font-normal tracking-[-0.015em] text-white sm:text-[52px] 2xl:text-[64px]">
            Seu problema de TI, resolvido
            <br className="max-sm:hidden" /> em uma conversa.
          </h2>
          <p className="mt-6 max-w-[80%] text-[17px] leading-relaxed text-white/65 [contain:inline-size] max-sm:max-w-none">
            Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central
            de ajuda e chama um analista quando precisa.
          </p>

          <LiveCard live={live} timeZone={timeZone} />
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-6 border-t border-white/10 pt-8 sm:grid-cols-3 sm:gap-0">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={index > 0 ? "sm:border-l sm:border-white/10 sm:pl-8" : ""}
            title={stat.value === null ? stat.pending : undefined}
          >
            <dt className="sr-only">{stat.label}</dt>
            <dd className="font-display flex items-center gap-2 text-[40px] leading-none">
              {stat.value ?? (
                <>
                  <span aria-hidden="true" className="text-white/40">
                    —
                  </span>
                  <span className="sr-only">{stat.pending}</span>
                </>
              )}
              {stat.online !== undefined && stat.value !== null ? (
                <span
                  className={
                    stat.online
                      ? "bg-success size-2.5 rounded-full"
                      : "size-2.5 rounded-full bg-white/30"
                  }
                  aria-hidden="true"
                />
              ) : null}
            </dd>
            <dd className="mt-2 text-[14px] text-white/60">{stat.label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
