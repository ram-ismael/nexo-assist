// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mergeMessages } from "@/components/chat/use-chat";
import { TicketCard } from "@/components/tickets/ticket-card";
import type { MessageDTO, TicketSnapshot } from "@/lib/api-types";
import {
  contactLabel,
  durationLabel,
  formatListTime,
  lastSeenLabel,
  untilLabel,
} from "@/lib/format";

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

describe("contactLabel", () => {
  const now = new Date("2026-10-30T13:00:00.000Z"); // 10:00 in São Paulo
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  const tz = "America/Sao_Paulo";

  it("counts down to the first-contact deadline", () => {
    expect(contactLabel(at(0.2), tz, now)).toBe("contato agora");
    expect(contactLabel(at(25), tz, now)).toBe("contato em 25 min");
    expect(contactLabel(at(170), tz, now)).toBe("contato em 3 h");
    expect(contactLabel(at(26 * 60), tz, now)).toBe("contato até amanhã, 12:00");
  });

  it("says how late the contact is once the deadline passed", () => {
    expect(contactLabel(at(-10), tz, now)).toBe("contato atrasado há 10 min");
    expect(contactLabel(at(-130), tz, now)).toBe("contato atrasado há 2 h");
    expect(contactLabel(at(-3 * 24 * 60), tz, now)).toBe("contato atrasado há 3 dias");
  });
});

describe("durationLabel", () => {
  it("rounds to the unit a person would say", () => {
    expect(durationLabel(25 * 60_000)).toBe("25 min");
    expect(durationLabel(4 * 3_600_000)).toBe("4 h");
    expect(durationLabel(26 * 3_600_000)).toBe("1 dia");
    expect(durationLabel(6 * 86_400_000)).toBe("6 dias");
  });
});

describe("lastSeenLabel", () => {
  const now = new Date("2026-10-30T13:00:00.000Z"); // 10:00 in São Paulo
  const tz = "America/Sao_Paulo";
  it("reads like a messaging app", () => {
    expect(lastSeenLabel("2026-10-30T12:42:00.000Z", tz, now)).toBe(
      "visto por último hoje às 09:42",
    );
    expect(lastSeenLabel("2026-10-29T21:20:00.000Z", tz, now)).toBe(
      "visto por último ontem às 18:20",
    );
  });
});
