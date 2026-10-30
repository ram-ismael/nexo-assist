import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/server/db/client";
import { listQueue } from "@/server/conversations/queue";
import { seedConversations } from "@/server/db/seed-conversations";
import { publicMetrics } from "@/server/metrics";
import { calendar, RAFAEL, resetDatabase, sessionUser } from "../support/db";

describe("demo conversation history", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("writes realistic histories once and never touches existing conversations", async () => {
    expect(await seedConversations(db(), calendar)).toBe(6);
    expect(await seedConversations(db(), calendar)).toBe(0);

    const rafael = await sessionUser(RAFAEL);
    const all = await listQueue(db(), rafael.id, { filter: "all", query: "" });
    const byName = new Map(all.map((item) => [item.employee.name, item]));

    expect(byName.get("Ana Souza")).toMatchObject({
      state: "waiting_analyst",
      handoff: { ticketNumber: "INC-20311" },
    });
    expect(byName.get("Ana Souza")?.unread).toBeGreaterThan(0);
    expect(byName.get("Carla Mendes")).toMatchObject({
      state: "waiting_analyst",
      handoff: { ticketNumber: "REQ-10451" },
    });
    expect(byName.get("Bruno Tavares")).toMatchObject({
      state: "agent_active",
      lowCertainty: true,
    });
    expect(byName.get("Diego Ramos")).toMatchObject({ state: "agent_active", unread: 0 });
    expect(byName.get("Elisa Prado")).toMatchObject({ state: "closed", hadHandoff: false });
    expect(byName.get("Fábio Nunes")).toMatchObject({
      state: "closed",
      assignedAnalyst: { name: "Rafael Lima" },
    });
  });

  it("keeps demo turns out of the public metrics", async () => {
    await seedConversations(db(), calendar);
    const metrics = await publicMetrics();
    expect(metrics.avgFirstResponseSeconds).toBeNull();
    expect(metrics.withoutHandoffPercent).toBeNull();
  });
});
