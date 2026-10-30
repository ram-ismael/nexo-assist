import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

/**
 * TEST-ONLY deterministic model, enabled by NEXO_SCRIPTED_MODEL=true and refused
 * on Vercel (see lib/config). It drives the real Mastra agent, real tools and
 * real database through fixed tool-call scripts so CI and Playwright can verify
 * the full pipeline without paid LLM calls. It never runs in a deployment.
 */

type Step =
  | { kind: "tools"; calls: { name: string; input: Record<string, unknown> }[] }
  | { kind: "text"; text: (results: Record<string, unknown>[]) => string };

type PromptMessage = LanguageModelV4CallOptions["prompt"][number];

function lastUserText(prompt: PromptMessage[]): { text: string; index: number } {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index];
    if (message?.role !== "user") continue;
    const text = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .trim();
    return { text, index };
  }
  return { text: "", index: -1 };
}

function toolResults(prompt: PromptMessage[], from: number): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  for (const message of prompt.slice(from)) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const output = part.output;
      if (output.type === "json") results.push(output.value as Record<string, unknown>);
    }
  }
  return results;
}

const decision = (intencao: string, acao: string, seguranca = "alta") => ({
  name: "registrar_decisao",
  input: {
    intencao,
    entendimento: "Pedido do funcionário identificado pelo roteiro de teste.",
    acao,
    seguranca,
    motivo: "Roteiro determinístico de teste baseado nos resultados das ferramentas.",
    regras: [],
    informacoes_faltando: [],
  },
});

function planFor(text: string): Step[] {
  const normalized = text.toLowerCase();
  const ticketNumber = /\b(INC|REQ)-\d{3,9}\b/i.exec(text)?.[0];

  if (normalized.includes("analista")) {
    return [
      {
        kind: "tools",
        calls: [
          {
            name: "transferir_para_analista",
            input: {
              motivo: "employee_request",
              resumo: `O funcionário pediu para falar com um analista. Última mensagem: ${text.slice(0, 200)}`,
            },
          },
        ],
      },
      {
        kind: "tools",
        calls: [decision("pedido_de_analista", "Transferi a conversa para um analista.")],
      },
      {
        kind: "text",
        text: () => "Encaminhei para a equipe de suporte. Um analista vai falar com você em breve.",
      },
    ];
  }
  if (normalized.startsWith("adicionar:") && ticketNumber) {
    return [
      {
        kind: "tools",
        calls: [
          {
            name: "preparar_atualizacao",
            input: { numero: ticketNumber, informacao: text.slice(10).trim() },
          },
        ],
      },
      {
        kind: "tools",
        calls: [decision("atualizacao_de_chamado", "Preparei a atualização para confirmação.")],
      },
      { kind: "text", text: () => "Preparei a atualização. Confira antes de eu enviar:" },
    ];
  }
  if (ticketNumber) {
    return [
      { kind: "tools", calls: [{ name: "consultar_chamado", input: { numero: ticketNumber } }] },
      {
        kind: "tools",
        calls: [
          {
            name: "oferecer_opcoes",
            input: { opcoes: ["Falar com um analista", "Adicionar informação", "Não, obrigado"] },
          },
          decision("consulta_de_chamado", "Mostrei o chamado e o prazo."),
        ],
      },
      {
        kind: "text",
        text: (results) => {
          const ticket = results[0]?.chamado as { vencido?: boolean; prazo?: string } | undefined;
          return ticket?.vencido
            ? `Está com o prazo de ${ticket.prazo} vencido. Quer que eu chame um analista?`
            : "Aqui está o seu chamado. Ele está dentro do prazo.";
        },
      },
    ];
  }
  if (normalized.includes("status") || normalized.includes("meus chamados")) {
    return [
      {
        kind: "tools",
        calls: [{ name: "consultar_meus_chamados", input: { apresentar_selecao: true } }],
      },
      {
        kind: "tools",
        calls: [decision("consulta_de_chamado", "Listei os chamados para o funcionário escolher.")],
      },
      {
        kind: "text",
        text: (results) =>
          `Você tem ${String(results[0]?.total ?? 0)} chamados abertos. Sobre qual deles quer saber?`,
      },
    ];
  }
  if (normalized.startsWith("só eu") || normalized.startsWith("so eu")) {
    return [
      {
        kind: "tools",
        calls: [
          {
            name: "montar_rascunho",
            input: {
              tipo: "INC",
              categoria: "Rede e VPN",
              titulo: "VPN não conecta no notebook — erro 809",
              descricao: `Notebook (Windows 11) não conecta na VPN e mostra o erro 809. ${text}`,
              quem_e_afetado: "self",
              impede_o_trabalho: true,
              compromisso_hoje: normalized.includes("reunião") || normalized.includes("reuniao"),
              ha_alternativa: false,
              nao_e_duplicado_de: [],
            },
          },
        ],
      },
      {
        kind: "tools",
        calls: [decision("abertura_de_chamado", "Montei o rascunho para confirmação.")],
      },
      {
        kind: "text",
        text: () =>
          "Montei o rascunho com a prioridade calculada pelas regras. Confira antes de eu criar:",
      },
    ];
  }
  if (normalized.includes("vpn")) {
    return [
      {
        kind: "tools",
        calls: [
          { name: "buscar_central_de_ajuda", input: { consulta: "VPN erro 809" } },
          {
            name: "verificar_duplicidade",
            input: { titulo: "VPN não conecta", descricao: text, categoria: "Rede e VPN" },
          },
        ],
      },
      {
        kind: "tools",
        calls: [
          {
            name: "oferecer_opcoes",
            input: {
              pergunta: "Quem está sendo afetado?",
              opcoes: ["Só eu", "Minha equipe", "Toda a empresa", "Não sei"],
            },
          },
          decision("abertura_de_chamado", "Pedi o impacto antes de montar o rascunho.", "media"),
        ],
      },
      {
        kind: "text",
        text: () =>
          "O artigo do erro 809 vale só para Windows 10 e o seu é Windows 11. Vou abrir um chamado.",
      },
    ];
  }
  return [
    { kind: "tools", calls: [decision("esclarecimento", "Pedi mais detalhes.", "media")] },
    { kind: "text", text: () => "Pode me contar um pouco mais sobre o que está acontecendo?" },
  ];
}

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

export function createScriptedModel(): LanguageModelV4 {
  let counter = 0;
  const build = (options: LanguageModelV4CallOptions): LanguageModelV4StreamPart[] => {
    const { text, index } = lastUserText(options.prompt);
    const plan = planFor(text);
    const stepIndex = options.prompt
      .slice(index + 1)
      .filter((message) => message.role === "assistant").length;
    const step = plan[Math.min(stepIndex, plan.length - 1)];
    const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
    if (!step || step.kind === "text") {
      const content = step ? step.text(toolResults(options.prompt, index + 1)) : "";
      const id = `text-${(counter += 1)}`;
      parts.push(
        { type: "text-start", id },
        { type: "text-delta", id, delta: content },
        { type: "text-end", id },
      );
      parts.push({ type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } });
      return parts;
    }
    for (const call of step.calls) {
      parts.push({
        type: "tool-call",
        toolCallId: `call-${(counter += 1)}`,
        toolName: call.name,
        input: JSON.stringify(call.input),
      });
    }
    parts.push({ type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_use" } });
    return parts;
  };

  return {
    specificationVersion: "v4",
    provider: "nexo-test",
    modelId: "scripted-test-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("scripted model only supports streaming");
    },
    async doStream(options) {
      return { stream: streamOf(build(options)) };
    },
  } as LanguageModelV4;
}
