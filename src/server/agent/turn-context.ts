import type { RequestContext } from "@mastra/core/request-context";
import type { BusinessCalendar } from "@/domain/sla";
import type { SessionUser } from "@/server/auth/sessions";
import type { MessageBlock } from "@/server/messages/blocks";

export const INTENTS = [
  "duvida",
  "solucao_de_problema",
  "consulta_de_chamado",
  "selecao_de_chamado",
  "abertura_de_chamado",
  "atualizacao_de_chamado",
  "reabertura_de_chamado",
  "confirmacao_de_rascunho",
  "pedido_de_analista",
  "fora_de_escopo",
  "esclarecimento",
  "outro",
] as const;
export type Intent = (typeof INTENTS)[number];

export type DecisionInput = {
  intent: Intent;
  understanding: string;
  action: string;
  certainty: "alta" | "media" | "baixa";
  reason: string;
  rules: string[];
  missingInformation: string[];
  escalationReason: string | null;
  /** Help-center articles the answer is based on (ids such as "KB-001"). */
  articlesUsed: string[];
};

export type TurnEvent =
  | {
      type: "action";
      id: string;
      tool: string;
      label: string;
      status: "running" | "ok" | "error" | "denied";
    }
  | { type: "text"; delta: string };

/**
 * Per-turn state shared by the tools of one agent run. Identity comes from the
 * authenticated session; tools never accept a user id from the model.
 */
export type TurnContext = {
  user: SessionUser;
  conversationId: string;
  turnId: string;
  now: Date;
  calendar: BusinessCalendar;
  blocks: MessageBlock[];
  /** Every article the help-center search returned this turn, by id. */
  articlesFound: Map<string, string>;
  decision: DecisionInput | null;
  handedOff: boolean;
  focusTicketId: string | null;
  emit: (event: TurnEvent) => void;
};

export type TurnRequestContext = { turn: TurnContext };

export function turnFrom(requestContext: RequestContext<unknown> | undefined): TurnContext {
  const turn = (requestContext as RequestContext<TurnRequestContext> | undefined)?.get("turn");
  if (!turn) throw new Error("Ferramenta chamada fora de um turno do agent");
  return turn;
}
