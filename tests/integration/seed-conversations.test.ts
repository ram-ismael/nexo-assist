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
    expect(await seedConversations(db(), calendar)).toBe(11);
    expect(await seedConversations(db(), calendar)).toBe(0);

    const rafael = await sessionUser(RAFAEL);
    const all = await listQueue(db(), rafael.id, { filter: "all", query: "" });
    // The queue lists live conversations before closed ones: keep each person's first.
    const byName = new Map<string, (typeof all)[number]>();
    for (const item of all)
      if (!byName.has(item.employee.name)) byName.set(item.employee.name, item);

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
    expect(result.rows.length).toBe(11);
    expect(result.rows.filter((row) => !row.ok)).toEqual([]);
  });

  it("names each past conversation by what the employee first asked", async () => {
    await seedConversations(db(), calendar);
    const fabio = await sessionUser("fabio.nunes@nexo.com.br");
    const [item] = await listEmployeeConversations(db(), fabio.id);
    expect(item?.topic).toBe("Preciso instalar o Power BI Desktop para um relatório.");
    expect(item?.lastMessagePreview).toContain("encerrado");
  });

  it("gives employees earlier conversations and opens requests only through confirmed drafts", async () => {
    await seedConversations(db(), calendar);
    const ana = await sessionUser("ana.souza@nexo.com.br");
    const history = await listEmployeeConversations(db(), ana.id);
    expect(history.map((item) => item.topic)).toEqual([
      "Qual o status do meu chamado?",
      "O Outlook do meu celular parou de sincronizar de novo.",
    ]);

    const requests = await db().execute<{ requester: string; title: string; status: string }>(sql`
      select u.email as requester, t.title, d.status
      from ticket_drafts d
      join tickets t on t.id = d.result_ticket_id
      join users u on u.id = t.requester_id
      order by t.created_at
    `);
    expect(requests.rows).toEqual([
      {
        requester: "carla.mendes@nexo.com.br",
        title: "Headset com microfone para reuniões com clientes",
        status: "confirmed",
      },
      {
        requester: "gabriela.rocha@nexo.com.br",
        title: "Licença do Adobe Acrobat Pro para edição de contratos",
        status: "confirmed",
      },
    ]);
  });

  it("keeps demo turns out of the public metrics", async () => {
    await seedConversations(db(), calendar);
    const metrics = await publicMetrics();
    expect(metrics.avgFirstResponseSeconds).toBeNull();
    expect(metrics.withoutHandoffPercent).toBeNull();
  });
});
