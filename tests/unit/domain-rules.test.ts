import { analystOnline } from "@/domain/presence";
import { describe, expect, it } from "vitest";
import { agentMayRespond, nextState } from "@/domain/conversations";
import { classifyPriority, type PriorityFacts } from "@/domain/priority";
import { rankDuplicates } from "@/domain/similarity";
import { canAnalystMoveTo, canReopen, parseTicketNumber } from "@/domain/tickets";

const base: PriorityFacts = {
  type: "INC",
  scope: "self",
  workBlocked: false,
  deadlineToday: false,
  hasWorkaround: true,
};

describe("classifyPriority", () => {
  it("is critical when a team cannot work", () => {
    expect(classifyPriority({ ...base, scope: "team", workBlocked: true }).priority).toBe(
      "critica",
    );
  });

  it("is critical for a company-wide outage", () => {
    expect(
      classifyPriority({ ...base, scope: "company", workBlocked: true, hasWorkaround: false }),
    ).toMatchObject({
      priority: "critica",
      rule: "critical-collective-outage",
    });
  });

  it("is high for a same-day commitment, as in the VPN example", () => {
    expect(
      classifyPriority({ ...base, workBlocked: true, deadlineToday: true, hasWorkaround: false }),
    ).toMatchObject({
      priority: "alta",
      rule: "high-same-day-commitment",
    });
  });

  it("is high when one person is blocked with no alternative", () => {
    expect(classifyPriority({ ...base, workBlocked: true, hasWorkaround: false }).priority).toBe(
      "alta",
    );
  });

  it("is medium when it hurts but there is an alternative", () => {
    expect(classifyPriority(base).priority).toBe("media");
  });

  it("is low for a non-urgent request", () => {
    expect(classifyPriority({ ...base, type: "REQ" }).priority).toBe("baixa");
  });

  it("is high for a request needed today", () => {
    expect(classifyPriority({ ...base, type: "REQ", deadlineToday: true }).priority).toBe("alta");
  });

  it("keeps a team problem with a workaround at medium", () => {
    expect(classifyPriority({ ...base, scope: "team" }).priority).toBe("media");
  });
});

describe("canReopen", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it("allows tickets resolved up to seven days ago", () => {
    expect(canReopen({ status: "resolved", resolvedAt: daysAgo(4) }, now)).toBe(true);
    expect(canReopen({ status: "resolved", resolvedAt: daysAgo(7) }, now)).toBe(true);
  });

  it("refuses older, closed or open tickets", () => {
    expect(canReopen({ status: "resolved", resolvedAt: daysAgo(7.01) }, now)).toBe(false);
    expect(canReopen({ status: "closed", resolvedAt: daysAgo(1) }, now)).toBe(false);
    expect(canReopen({ status: "open", resolvedAt: null }, now)).toBe(false);
  });
});

describe("analyst ticket transitions", () => {
  it("allows the normal flow and blocks reopening a closed ticket", () => {
    expect(canAnalystMoveTo("open", "in_progress")).toBe(true);
    expect(canAnalystMoveTo("in_progress", "resolved")).toBe(true);
    expect(canAnalystMoveTo("resolved", "closed")).toBe(true);
    expect(canAnalystMoveTo("closed", "open")).toBe(false);
  });
});

describe("parseTicketNumber", () => {
  it("normalizes case and rejects garbage", () => {
    expect(parseTicketNumber(" inc-20311 ")).toEqual({ type: "INC", sequence: 20311 });
    expect(parseTicketNumber("ABC-1")).toBeNull();
  });
});

describe("conversation state machine", () => {
  it("follows the handoff lifecycle", () => {
    expect(nextState("agent_active", "handoff_requested")).toBe("waiting_analyst");
    expect(nextState("waiting_analyst", "analyst_claimed")).toBe("analyst_active");
    expect(nextState("analyst_active", "returned_to_agent")).toBe("agent_active");
    expect(nextState("analyst_active", "closed")).toBe("closed");
  });

  it("rejects illegal moves", () => {
    expect(nextState("analyst_active", "analyst_claimed")).toBeNull();
    expect(nextState("closed", "returned_to_agent")).toBeNull();
    expect(nextState("waiting_analyst", "handoff_requested")).toBeNull();
  });

  it("only lets the agent answer while it owns the conversation", () => {
    expect(agentMayRespond("agent_active")).toBe(true);
    expect(agentMayRespond("waiting_analyst")).toBe(false);
    expect(agentMayRespond("analyst_active")).toBe(false);
    expect(agentMayRespond("closed")).toBe(false);
  });
});

describe("rankDuplicates", () => {
  const tickets = [
    {
      id: "1",
      title: "Notebook lento após atualização do Windows",
      description: "Lentidão geral",
      category: "Hardware" as const,
    },
    {
      id: "2",
      title: "Segundo monitor para home office",
      description: "Pedido de monitor",
      category: "Hardware" as const,
    },
    {
      id: "3",
      title: "VPN não conecta",
      description: "Erro 809 ao conectar na VPN",
      category: "Rede e VPN" as const,
    },
  ];

  it("finds the same problem described with other words", () => {
    const matches = rankDuplicates(
      {
        title: "Meu notebook está muito lento",
        description: "Ficou lento depois da atualização",
        category: "Hardware",
      },
      tickets,
    );
    expect(matches[0]?.ticket.id).toBe("1");
  });

  it("matches on error codes", () => {
    const matches = rankDuplicates(
      { title: "Erro 809", description: "não consigo entrar na vpn" },
      tickets,
    );
    expect(matches[0]?.ticket.id).toBe("3");
  });

  it("returns nothing for unrelated problems", () => {
    expect(
      rankDuplicates({ title: "Impressora sem toner", description: "acabou o toner" }, tickets),
    ).toEqual([]);
  });
});

describe("analystOnline", () => {
  const now = new Date("2026-11-02T12:00:00.000Z").getTime();
  const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000);
  it("is online only with a fresh heartbeat after the last sign-out", () => {
    expect(analystOnline({ lastHeartbeatAt: at(10), leftAt: null }, now)).toBe(true);
    expect(analystOnline({ lastHeartbeatAt: at(60), leftAt: null }, now)).toBe(false);
    // Signed out: the same instant is recorded for both.
    expect(analystOnline({ lastHeartbeatAt: at(5), leftAt: at(5) }, now)).toBe(false);
    // Back on the console after leaving.
    expect(analystOnline({ lastHeartbeatAt: at(2), leftAt: at(300) }, now)).toBe(true);
  });
});
