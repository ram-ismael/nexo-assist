import { Check } from "lucide-react";
import type { PublicMetrics } from "@/server/metrics";

/**
 * Left panel of the login. The conversation is an illustration of the product
 * (clearly not data); the numbers at the bottom are real or omitted.
 */
export function LoginShowcase({ metrics }: { metrics: PublicMetrics }) {
  const stats = [
    metrics.avgFirstResponseSeconds !== null
      ? {
          value: `${metrics.avgFirstResponseSeconds} s`,
          label: "primeira resposta, em média (7 dias)",
        }
      : null,
    metrics.resolvedWithoutQueuePercent !== null
      ? { value: `${metrics.resolvedWithoutQueuePercent}%`, label: "resolvidos sem fila (30 dias)" }
      : null,
    {
      value: String(metrics.analystsOnline),
      label: "analistas online agora",
      online: metrics.analystsOnline > 0,
    },
  ].filter((item): item is { value: string; label: string; online?: boolean } => item !== null);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center py-12 lg:py-0">
        <p className="text-[15px] text-white/65">Service desk de TI da Nexo</p>
        <h2 className="font-display mt-4 max-w-[720px] text-[42px] leading-[1.1] font-normal tracking-[-0.015em] text-white sm:text-[52px] 2xl:text-[64px]">
          Seu problema de TI, resolvido em uma conversa.
        </h2>
        <p className="mt-6 max-w-[520px] text-[17px] leading-relaxed text-white/65">
          Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central de
          ajuda e chama um analista quando precisa.
        </p>

        <figure
          aria-label="Exemplo ilustrativo de conversa"
          className="mt-12 hidden max-w-[470px] self-center rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:block lg:ml-24 lg:self-start"
        >
          <p className="text-ink ml-auto w-fit rounded-xl bg-white px-3.5 py-2 text-[14px]">
            Meu notebook não conecta na VPN. Erro 809.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[13px] text-white/55">
            <span className="font-medium text-white/90">Nexo Assist</span>
            <span className="inline-flex items-center gap-1">
              <Check className="size-3" aria-hidden="true" /> consultou seus chamados
            </span>
            <span className="inline-flex items-center gap-1">
              <Check className="size-3" aria-hidden="true" /> criou um chamado
            </span>
          </p>
          <p className="mt-2 max-w-[340px] rounded-xl bg-white/10 px-3.5 py-2.5 text-[14px] leading-relaxed text-white/90">
            Pronto: abri o chamado com prioridade alta. Um analista fala com você em até 4 h úteis.
          </p>
          <figcaption className="mt-3 text-[11px] tracking-wide text-white/40 uppercase">
            Exemplo ilustrativo
          </figcaption>
        </figure>
      </div>

      <dl className="grid grid-cols-1 gap-6 border-t border-white/10 pt-8 sm:grid-cols-3 sm:gap-0">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={index > 0 ? "sm:border-l sm:border-white/10 sm:pl-8" : ""}
          >
            <dt className="sr-only">{stat.label}</dt>
            <dd className="font-display flex items-center gap-2 text-[40px] leading-none">
              {stat.value}
              {stat.online !== undefined ? (
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
