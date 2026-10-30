import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { callTicketService, resetBreakerForTests } from "@/server/tickets/gateway";
import { TicketService } from "@/server/tickets/service";
import { ANA, calendar, CARLA, resetDatabase, sessionUser } from "../support/db";

describe("ticket service", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("lists only the requester's tickets", async () => {
    const ana = await sessionUser(ANA);
    const tickets = await new TicketService(db(), calendar).listForRequester(ana.id);
    expect(tickets.map((ticket) => ticket.number).sort()).toEqual([
      "INC-19877",
      "INC-20150",
      "INC-20298",
      "INC-20311",
      "REQ-10442",
    ]);
  });

  it("does not find another employee's ticket by number", async () => {
    const carla = await sessionUser(CARLA);
    const service = new TicketService(db(), calendar);
    expect(await service.findForRequester(carla.id, "INC-20311")).toBeNull();
  });

  it("generates unique numbers under concurrent creation", async () => {
    const ana = await sessionUser(ANA);
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        callTicketService("create", (service) =>
          service.create(
            {
              requesterId: ana.id,
              type: index % 2 === 0 ? "INC" : "REQ",
              category: "Software",
              priority: "media",
              scope: "self",
              title: `Teste ${index}`,
              description: "Descrição do teste de concorrência",
            },
            { id: ana.id, kind: "employee" },
          ),
        ),
      ),
    );
    const numbers = created.map((ticket) => ticket.number);
    expect(new Set(numbers).size).toBe(12);
    expect(
      numbers
        .filter((number) => number.startsWith("INC-"))
        .every((number) => Number(number.slice(4)) >= 20520),
    ).toBe(true);
  });

  it("reopens only tickets resolved in the last seven days", async () => {
    const ana = await sessionUser(ANA);
    const service = new TicketService(db(), calendar);
    const recent = await service.findByNumber("INC-20150");
    const old = await service.findByNumber("INC-19877");
    const reopened = await service.reopen(recent!, "Voltou a bloquear", {
      id: ana.id,
      kind: "employee",
    });
    expect(reopened.status).toBe("open");
    expect(reopened.slaDueAt.getTime()).toBeGreaterThan(Date.now());
    await expect(
      service.reopen(old!, "x", { id: ana.id, kind: "employee" }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects stale analyst updates (optimistic concurrency)", async () => {
    const service = new TicketService(db(), calendar);
    const ticket = (await service.findByNumber("INC-20298"))!;
    await service.analystUpdate(
      ticket,
      { status: "resolved", note: "ok", expectedVersion: ticket.version },
      { id: null, kind: "analyst" },
    );
    await expect(
      service.analystUpdate(
        ticket,
        { status: "in_progress", expectedVersion: ticket.version },
        { id: null, kind: "analyst" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("does not let an employee note restart the SLA", async () => {
    const ana = await sessionUser(ANA);
    const service = new TicketService(db(), calendar);
    const ticket = (await service.findByNumber("INC-20311"))!;
    const updated = await service.addEmployeeNote(ticket, "Continua lento", {
      id: ana.id,
      kind: "employee",
    });
    expect(updated.slaDueAt.toISOString()).toBe(ticket.slaDueAt.toISOString());
    const events = await service.events(ticket.id);
    expect(events.at(-1)).toMatchObject({ action: "employee_note", note: "Continua lento" });
  });

  it("retries transient failures of the legacy service", async () => {
    resetBreakerForTests();
    process.env.TICKET_FAULT_RATE = "0.5";
    const { resetConfigForTests } = await import("@/lib/config");
    resetConfigForTests();
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
    try {
      const ana = await sessionUser(ANA);
      const info = { attempts: 0 };
      const tickets = await callTicketService(
        "list",
        (service) => service.listForRequester(ana.id),
        info,
      );
      expect(tickets.length).toBeGreaterThan(0);
      expect(info.attempts).toBe(2);
    } finally {
      random.mockRestore();
      process.env.TICKET_FAULT_RATE = "0";
      resetConfigForTests();
    }
  });

  it("reports unavailability after the retries are exhausted", async () => {
    resetBreakerForTests();
    process.env.TICKET_FAULT_RATE = "1";
    const { resetConfigForTests } = await import("@/lib/config");
    resetConfigForTests();
    try {
      const ana = await sessionUser(ANA);
      await expect(
        callTicketService("list", (service) => service.listForRequester(ana.id)),
      ).rejects.toMatchObject({
        code: "unavailable",
      });
    } finally {
      process.env.TICKET_FAULT_RATE = "0";
      resetConfigForTests();
      resetBreakerForTests();
    }
  });
});
