import type { AffectedScope, Priority, TicketType } from "./tickets";

/**
 * Facts the agent extracts from the conversation. The priority itself is never
 * chosen by the model: it is derived here, so the same facts always give the
 * same answer and the rule that fired can be shown to the employee.
 */
export type PriorityFacts = {
  type: TicketType;
  scope: AffectedScope;
  /** The affected people cannot do their work at all. */
  workBlocked: boolean;
  /** A commitment (meeting, delivery, close) is at risk today. */
  deadlineToday: boolean;
  /** A workaround exists (other machine, webmail, phone...). */
  hasWorkaround: boolean;
};

export type PriorityRuleId =
  | "critical-collective-outage"
  | "high-person-blocked"
  | "high-same-day-commitment"
  | "low-non-urgent-request"
  | "medium-impaired-with-workaround";

export type PriorityDecision = {
  priority: Priority;
  rule: PriorityRuleId;
  explanation: string;
};

export function classifyPriority(facts: PriorityFacts): PriorityDecision {
  const collective = facts.scope === "team" || facts.scope === "company";

  if (collective && facts.workBlocked) {
    return {
      priority: "critica",
      rule: "critical-collective-outage",
      explanation:
        facts.scope === "company"
          ? "Algo está parado para a empresa: prioridade crítica, atendimento em até 1 hora."
          : "Algo está parado para uma equipe: prioridade crítica, atendimento em até 1 hora.",
    };
  }

  if (facts.deadlineToday) {
    return {
      priority: "alta",
      rule: "high-same-day-commitment",
      explanation:
        "Há um compromisso hoje em risco: prioridade alta, resposta em até 4 horas úteis.",
    };
  }

  if (facts.workBlocked && !facts.hasWorkaround) {
    return {
      priority: "alta",
      rule: "high-person-blocked",
      explanation:
        "O problema impede o trabalho e não há alternativa: prioridade alta, resposta em até 4 horas úteis.",
    };
  }

  if (facts.type === "REQ") {
    return {
      priority: "baixa",
      rule: "low-non-urgent-request",
      explanation: "Pedido sem urgência: prioridade baixa, resposta em até 5 dias úteis.",
    };
  }

  return {
    priority: "media",
    rule: "medium-impaired-with-workaround",
    explanation: "Atrapalha, mas há alternativa: prioridade média, resposta em até 3 dias úteis.",
  };
}
