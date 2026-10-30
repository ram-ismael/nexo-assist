import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/server/db/client";
import { listQueue } from "@/server/conversations/queue";
import { listEmployeeConversations } from "@/server/conversations/repository";
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

  it("tells every story in order: time only moves forward", async () => {
    await seedConversations(db(), calendar);
    const result = await db().execute<{ conversation_id: string; ok: boolean }>(sql`
      select conversation_id,
        bool_and(created_at >= coalesce(previous, created_at)) as ok
      from (
        select conversation_id, created_at,
          lag(created_at) over (partition by conversation_id order by seq) as previous
        from messages
      ) ordered
      group by conversation_id
    `);
    expect(result.rows.length).toBe(6);
    expect(result.rows.filter((row) => !row.ok)).toEqual([]);
  });

  it("names each past conversation by what the employee first asked", async () => {
    await seedConversations(db(), calendar);
    const fabio = await sessionUser("fabio.nunes@nexo.com.br");
    const [item] = await listEmployeeConversations(db(), fabio.id);
    expect(item?.topic).toBe("Preciso instalar o Power BI Desktop para um relatório.");
    expect(item?.lastMessagePreview).toContain("encerrado");
  });

  it("keeps demo turns out of the public metrics", async () => {
    await seedConversations(db(), calendar);
    const metrics = await publicMetrics();
    expect(metrics.avgFirstResponseSeconds).toBeNull();
    expect(metrics.withoutHandoffPercent).toBeNull();
  });
});
