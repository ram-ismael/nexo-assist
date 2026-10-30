import { z } from "zod";
import { config } from "@/lib/config";
import { db } from "@/server/db/client";
import { json, route } from "@/server/http";
import { listEmployeeConversations } from "@/server/conversations/repository";
import { listQueue, QUEUE_FILTERS, queueCounts } from "@/server/conversations/queue";
import { serializeConversation } from "@/server/conversations/serialize";
import { startNewConversation } from "@/server/conversations/use-cases";

const queueQuery = z.object({
  filter: z.enum(QUEUE_FILTERS).default("all"),
  q: z.string().max(80).default(""),
});

/** Employees get their own conversation history; analysts get the service queue. */
export const GET = route("user", async ({ req, user }) => {
  if (user.role === "employee") {
    const items = await listEmployeeConversations(db(), user.id);
    return json({
      items: items.map((item) => ({
        ...item,
        lastActivityAt: item.lastActivityAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
        closedAt: item.closedAt?.toISOString() ?? null,
      })),
    });
  }
  const params = queueQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const [items, counts] = await Promise.all([
    listQueue(db(), user.id, { filter: params.filter, query: params.q }),
    queueCounts(db(), user.id),
  ]);
  const { attention, ...filterCounts } = counts;
  return json({ items, counts: filterCounts, attention });
});

/** "Nova conversa": rules in startNewConversation. */
export const POST = route("employee", async ({ user }) => {
  const env = config();
  const conversation = await startNewConversation(user.id, env.AGENT_SESSION_MESSAGE_LIMIT);
  return json({
    conversation: await serializeConversation(db(), conversation, env.AGENT_SESSION_MESSAGE_LIMIT),
  });
});
