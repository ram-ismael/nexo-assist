import { and, desc, eq, gt, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { QueueItemDTO } from "@/lib/api-types";
import type { Executor } from "@/server/db/client";
import {
  agentDecisions,
  conversations,
  handoffs,
  messages,
  tickets,
  users,
} from "@/server/db/schema";
import { HANDOFF_REASON_LABEL } from "./handoff";

export const QUEUE_FILTERS = ["all", "for_you", "with_agent", "mine"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

const RECENTLY_CLOSED_DAYS = 7;
const OPEN_STATES = ["agent_active", "waiting_analyst", "analyst_active"] as const;

// Written as two indexable branches (open states, recent closed_at) instead of
// `state <> 'closed'`, which no index serves and grows with the whole history.
function liveOrRecentlyClosed(): SQL | undefined {
  return or(
    inArray(conversations.state, [...OPEN_STATES]),
    and(
      eq(conversations.state, "closed"),
      gt(conversations.closedAt, sql`now() - make_interval(days => ${RECENTLY_CLOSED_DAYS})`),
    ),
  );
}

function filterCondition(filter: QueueFilter, analystId: string): SQL | undefined {
  switch (filter) {
    case "for_you":
      return eq(conversations.state, "waiting_analyst");
    case "with_agent":
      return eq(conversations.state, "agent_active");
    case "mine":
      return and(
        eq(conversations.state, "analyst_active"),
        eq(conversations.assignedAnalystId, analystId),
      );
    case "all":
      return liveOrRecentlyClosed();
  }
}

function searchCondition(query: string): SQL | undefined {
  const term = query.trim().slice(0, 80);
  if (!term) return undefined;
  const like = `%${term.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  return or(
    ilike(users.name, like),
    sql`exists (select 1 from ${tickets} t where t.requester_id = ${conversations.employeeId} and t.number ilike ${like})`,
    sql`exists (select 1 from ${messages} m where m.conversation_id = ${conversations.id} and m.content ilike ${like})`,
  );
}

export async function listQueue(
  executor: Executor,
  analystId: string,
  options: { filter: QueueFilter; query: string; limit?: number },
): Promise<QueueItemDTO[]> {
  const conditions = [
    filterCondition(options.filter, analystId),
    searchCondition(options.query),
  ].filter((condition): condition is SQL => !!condition);
  const rows = await executor
    .select({
      conversation: conversations,
      employee: { id: users.id, name: users.name, department: users.department },
    })
    .from(conversations)
    .innerJoin(users, eq(users.id, conversations.employeeId))
    .where(and(...conditions))
    .orderBy(
      sql`case ${conversations.state} when 'waiting_analyst' then 0 when 'analyst_active' then 1 when 'agent_active' then 2 else 3 end`,
      desc(conversations.lastActivityAt),
    )
    .limit(options.limit ?? 50);
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.conversation.id);
  const analystIds = [
    ...new Set(
      rows.map((row) => row.conversation.assignedAnalystId).filter((id): id is string => !!id),
    ),
  ];
  const [unreadRows, handoffRows, analystRows, lowRows] = await Promise.all([
    executor
      .select({ conversationId: messages.conversationId, count: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          inArray(messages.conversationId, ids),
          eq(messages.kind, "employee"),
          gt(messages.seq, conversations.analystReadSeq),
        ),
      )
      .groupBy(messages.conversationId),
    executor
      .selectDistinctOn([handoffs.conversationId], {
        conversationId: handoffs.conversationId,
        reason: handoffs.reason,
        respondBy: handoffs.respondBy,
        createdAt: handoffs.createdAt,
        ticketIds: handoffs.ticketIds,
      })
      .from(handoffs)
      .where(inArray(handoffs.conversationId, ids))
      .orderBy(handoffs.conversationId, desc(handoffs.createdAt)),
    analystIds.length > 0
      ? executor
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, analystIds))
      : Promise.resolve([]),
    executor
      .selectDistinctOn([agentDecisions.conversationId], {
        conversationId: agentDecisions.conversationId,
        certainty: agentDecisions.certainty,
      })
      .from(agentDecisions)
      .where(inArray(agentDecisions.conversationId, ids))
      .orderBy(agentDecisions.conversationId, desc(agentDecisions.createdAt)),
  ]);
  const ticketIds = [...new Set(handoffRows.flatMap((row) => row.ticketIds))];
  const ticketRows =
    ticketIds.length > 0
      ? await executor
          .select({ id: tickets.id, number: tickets.number })
          .from(tickets)
          .where(inArray(tickets.id, ticketIds))
      : [];
  const ticketNumbers = new Map(ticketRows.map((row) => [row.id, row.number]));
  const unread = new Map(unreadRows.map((row) => [row.conversationId, Number(row.count)]));
  const latestHandoff = new Map(handoffRows.map((row) => [row.conversationId, row]));
  const analystNames = new Map(analystRows.map((row) => [row.id, row.name]));
  const certainty = new Map(lowRows.map((row) => [row.conversationId, row.certainty]));

  return rows.map(({ conversation, employee }) => {
    const handoff = latestHandoff.get(conversation.id);
    const showHandoff =
      conversation.state === "waiting_analyst" || conversation.state === "analyst_active";
    return {
      id: conversation.id,
      state: conversation.state,
      employee,
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageKind: conversation.lastMessageKind,
      lastActivityAt: conversation.lastActivityAt.toISOString(),
      unread: unread.get(conversation.id) ?? 0,
      assignedAnalyst: conversation.assignedAnalystId
        ? {
            id: conversation.assignedAnalystId,
            name: analystNames.get(conversation.assignedAnalystId) ?? "Analista",
          }
        : null,
      handoff:
        handoff && showHandoff
          ? {
              reason: HANDOFF_REASON_LABEL[handoff.reason],
              respondBy: handoff.respondBy?.toISOString() ?? null,
              ticketNumber: handoff.ticketIds[0]
                ? (ticketNumbers.get(handoff.ticketIds[0]) ?? null)
                : null,
              createdAt: handoff.createdAt.toISOString(),
            }
          : null,
      lowCertainty:
        conversation.state === "agent_active" && certainty.get(conversation.id) === "baixa",
    };
  });
}

export async function queueCounts(
  executor: Executor,
  analystId: string,
): Promise<Record<QueueFilter, number>> {
  const result = await executor.execute<{
    for_you: number;
    with_agent: number;
    mine: number;
    open: number;
    recently_closed: number;
  }>(sql`
    select
      count(*) filter (where state = 'waiting_analyst')::int as for_you,
      count(*) filter (where state = 'agent_active')::int as with_agent,
      count(*) filter (where state = 'analyst_active' and assigned_analyst_id = ${analystId})::int as mine,
      count(*)::int as open,
      (select count(*)::int from conversations
        where state = 'closed' and closed_at > now() - make_interval(days => ${RECENTLY_CLOSED_DAYS})) as recently_closed
    from conversations
    where state in ('agent_active', 'waiting_analyst', 'analyst_active')
  `);
  const row = result.rows[0];
  return {
    for_you: Number(row?.for_you ?? 0),
    with_agent: Number(row?.with_agent ?? 0),
    mine: Number(row?.mine ?? 0),
    all: Number(row?.open ?? 0) + Number(row?.recently_closed ?? 0),
  };
}

export async function markRead(executor: Executor, conversationId: string): Promise<void> {
  await executor.execute(sql`
    update conversations set analyst_read_seq = coalesce(
      (select max(seq) from messages where conversation_id = ${conversationId}), 0)
    where id = ${conversationId}
  `);
}
