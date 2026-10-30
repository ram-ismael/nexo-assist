// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mergeMessages } from "@/components/chat/use-chat";
import { TicketCard } from "@/components/tickets/ticket-card";
import type { MessageDTO, TicketSnapshot } from "@/lib/api-types";
import { formatListTime, untilLabel } from "@/lib/format";

afterEach(cleanup);

const message = (seq: number, content = `m${seq}`): MessageDTO => ({
  id: `id-${seq}`,
  seq,
  kind: "employee",
  content,
  blocks: [],
  drafts: {},
  createdAt: new Date(2026, 9, 30, 10, seq).toISOString(),
  sender: null,
  turnId: null,
  actions: [],
});

describe("mergeMessages", () => {
  it("orders by seq and drops duplicates from overlapping polls and pages", () => {
    const merged = mergeMessages(
      [message(3), message(5)],
      [message(5, "m5-updated"), message(4), message(1)],
    );
    expect(merged.map((item) => item.seq)).toEqual([1, 3, 4, 5]);
    expect(merged.at(-1)?.content).toBe("m5-updated");
  });
});

describe("TicketCard", () => {
  const ticket: TicketSnapshot = {
    number: "INC-20311",
    type: "INC",
    title: "Notebook lento após atualização do Windows",
    description: "Lentidão geral.",
    category: "Hardware",
    subcategory: "Notebook",
    priority: "media",
    scope: "self",
    status: "waiting_analyst",
    createdAt: "2026-10-16T17:20:00.000Z",
    updatedAt: "2026-10-24T12:00:00.000Z",
    slaDueAt: "2026-10-29T12:00:00.000Z",
    slaLabel: "3 dias úteis",
    overdue: true,
    resolvedAt: null,
  };

  it("shows status in text and flags an overdue deadline", () => {
    render(<TicketCard ticket={ticket} timeZone="America/Sao_Paulo" />);
    expect(screen.getByRole("article", { name: "Chamado INC-20311" })).toBeInTheDocument();
    expect(screen.getByText("Aguardando analista")).toBeInTheDocument();
    expect(screen.getByText(/prazo vencido/)).toBeInTheDocument();
    expect(screen.getByText("Hardware › Notebook")).toBeInTheDocument();
    expect(screen.getByText("16 out, 14:20")).toBeInTheDocument();
  });
});

describe("date formatting in the service-desk time zone", () => {
  it("does not depend on the browser time zone", () => {
    const now = new Date("2026-10-30T13:00:00.000Z");
    expect(untilLabel("2026-10-30T15:43:00.000Z", "America/Sao_Paulo", now)).toBe("12:43");
    expect(formatListTime("2026-10-29T13:00:00.000Z", "America/Sao_Paulo", now)).toBe("ontem");
  });
});
