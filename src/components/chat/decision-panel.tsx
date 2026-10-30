"use client";

import { Check, CircleAlert, Info, Ban } from "lucide-react";
import { useEffect, useState } from "react";
import type { DecisionDTO } from "@/lib/api-types";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/spinner";

const CERTAINTY: Record<"alta" | "media" | "baixa", { label: string; tone: string; help: string }> =
  {
    alta: {
      label: "Alta",
      tone: "bg-success-soft text-success-text",
      help: "Os fatos consultados sustentam a decisão.",
    },
    media: {
      label: "Média",
      tone: "bg-warning-soft text-warning-text",
      help: "Faltava alguma informação; o agent perguntou ou seguiu com cautela.",
    },
    baixa: {
      label: "Baixa",
      tone: "bg-danger-soft text-danger-text",
      help: "O agent não teve segurança: deveria perguntar ou chamar um analista.",
    },
  };

const INTENT_LABEL: Record<string, string> = {
  duvida: "Tirar uma dúvida",
  solucao_de_problema: "Resolver um problema",
  consulta_de_chamado: "Consultar chamado",
  selecao_de_chamado: "Escolher um chamado",
  abertura_de_chamado: "Abrir chamado",
  atualizacao_de_chamado: "Complementar chamado",
  reabertura_de_chamado: "Reabrir chamado",
  confirmacao_de_rascunho: "Confirmar rascunho",
  pedido_de_analista: "Falar com um analista",
  fora_de_escopo: "Assunto fora da TI",
  esclarecimento: "Esclarecer o pedido",
  outro: "Outro",
  nao_registrada: "Não registrada",
};

/**
 * "Por que o agent fez isso?" Shows the persisted decision record and every
 * tool execution of the turn. Nothing here is generated for display: it is
 * read back from agent_decisions / agent_actions.
 */
export function DecisionPanel({
  turnId,
  viewer,
}: {
  turnId: string;
  viewer: "employee" | "analyst";
}) {
  const [data, setData] = useState<DecisionDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<DecisionDTO>(`/api/turns/${turnId}`)
      .then((result) => active && setData(result))
      .catch((reason: unknown) => active && setError(errorMessage(reason)));
    return () => {
      active = false;
    };
  }, [turnId]);

  if (error) return <p className="text-danger-text text-sm">{error}</p>;
  if (!data) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  const decision = data.decision;
  const certainty = decision ? CERTAINTY[decision.certainty] : null;

  return (
    <div className="text-ink-2 space-y-4 text-[14px] leading-relaxed">
      {decision ? (
        <dl className="grid gap-3 sm:grid-cols-[150px_1fr]">
          <dt className="text-ink-3 font-medium">O que entendeu</dt>
          <dd>
            <span className="bg-desk text-ink-2 mr-1.5 rounded px-1.5 py-0.5 text-[12px] font-medium">
              {INTENT_LABEL[decision.intent] ?? decision.intent}
            </span>
            {decision.understanding}
          </dd>
          <dt className="text-ink-3 font-medium">O que decidiu</dt>
          <dd>{decision.action}</dd>
          <dt className="text-ink-3 font-medium">Segurança</dt>
          <dd>
            {certainty ? (
              <span
                className={cn(
                  "mr-2 rounded px-1.5 py-0.5 text-[12px] font-semibold",
                  certainty.tone,
                )}
              >
                {certainty.label}
              </span>
            ) : null}
            <span className="text-ink-3">{certainty?.help}</span>
          </dd>
          <dt className="text-ink-3 font-medium">Por quê</dt>
          <dd>{decision.reason}</dd>
          {decision.rules.length > 0 ? (
            <>
              <dt className="text-ink-3 font-medium">Regras aplicadas</dt>
              <dd>
                <ul className="list-disc space-y-0.5 pl-4">
                  {decision.rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {decision.missingInformation.length > 0 ? (
            <>
              <dt className="text-ink-3 font-medium">Faltava saber</dt>
              <dd>{decision.missingInformation.join("; ")}</dd>
            </>
          ) : null}
          {decision.escalationReason ? (
            <>
              <dt className="text-ink-3 font-medium">Motivo da transferência</dt>
              <dd>{decision.escalationReason}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="text-ink-3 flex items-center gap-2">
          <Info className="size-4" aria-hidden="true" />
          {data.status === "failed"
            ? "O turno falhou antes de registrar uma decisão."
            : "Nenhuma decisão registrada."}
        </p>
      )}
      {decision?.source === "system" ? (
        <p className="bg-warning-soft text-warning-text rounded-md px-3 py-2 text-[13px]">
          O agent não registrou a própria decisão nesta resposta; o resumo acima foi montado pelo
          sistema a partir das ações executadas.
        </p>
      ) : null}

      <div>
        <h4 className="text-ink-3 mb-2 font-medium">Ações executadas ({data.actions.length})</h4>
        {data.actions.length === 0 ? (
          <p className="text-ink-3">Respondeu sem consultar nenhum sistema.</p>
        ) : (
          <ol className="space-y-2">
            {data.actions.map((action, index) => (
              <li
                key={`${action.tool}-${index}`}
                className="border-rule bg-paper rounded-lg border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  {action.status === "ok" ? (
                    <Check className="text-success-text size-4" aria-label="concluída" />
                  ) : action.status === "denied" ? (
                    <Ban className="text-warning-text size-4" aria-label="bloqueada" />
                  ) : (
                    <CircleAlert className="text-danger-text size-4" aria-label="falhou" />
                  )}
                  <span className="text-ink font-medium">{action.label}</span>
                  <span className="text-ink-4 ml-auto font-mono text-[11px]">{action.tool}</span>
                </div>
                <p className="text-ink-3 mt-1 pl-6 text-[13px]">{action.summary}</p>
                {viewer === "analyst" && (action.input || action.output) ? (
                  <details className="mt-1 pl-6">
                    <summary className="text-primary-text cursor-pointer text-[12px]">
                      Entrada e saída
                    </summary>
                    <pre className="bg-desk text-ink-2 mt-1 max-h-56 overflow-auto rounded p-2 text-[11px] leading-snug whitespace-pre-wrap">
                      {JSON.stringify({ entrada: action.input, saida: action.output }, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="text-ink-4 text-[12px]">
        Modelo {data.model}
        {data.latencyMs !== null ? ` · ${(data.latencyMs / 1000).toFixed(1)} s` : ""}
        {viewer === "analyst" && data.inputTokens !== null
          ? ` · ${data.inputTokens} tokens de entrada, ${data.outputTokens ?? 0} de saída`
          : ""}
        {` · registro ${data.turnId.slice(0, 8)}`}
      </p>
    </div>
  );
}
