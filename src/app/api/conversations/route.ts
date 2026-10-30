import { z } from "zod";
import { config } from "@/lib/config";
import { db } from "@/server/db/client";
import { conflict } from "@/server/errors";
import { json, route } from "@/server/http";
import {
  appendMessage,
  findLiveConversation,
  getOrCreateLiveConversation,
  listEmployeeConversations,
  lockConversation,
  transitionConversation,
} from "@/server/conversations/repository";
import { listQueue, QUEUE_FILTERS, queueCounts } from "@/server/conversations/queue";
import { serializeConversation } from "@/server/conversations/serialize";

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

/**
 * Starts a new conversation (employee). Allowed when the current one is closed
 * or when the agent session reached its message limit; never while a person is
 * handling the employee, so nobody loses an ongoing human conversation.
 */
export const POST = route("employee", async ({ user }) => {
  const env = config();
  const conversation = await db().transaction(async (tx) => {
    const live = await findLiveConversation(tx, user.id);
    if (live) {
      const locked = await lockConversation(tx, live.id);
      if (!locked) throw conflict("Tente novamente.");
      if (locked.state !== "agent_active") {
        throw conflict(
          "Você está sendo atendido por um analista nesta conversa. Continue por ela.",
        );
      }
      if (locked.agentTurnCount === 0) return locked;
      await transitionConversation(tx, locked, "closed");
      await appendMessage(tx, {
        conversationId: locked.id,
        kind: "system",
        senderId: null,
        content: "Sessão encerrada pelo funcionário para começar uma nova conversa",
      });
    }
    return getOrCreateLiveConversation(tx, user.id);
  });
  return json({
    conversation: await serializeConversation(db(), conversation, env.AGENT_SESSION_MESSAGE_LIMIT),
  });
});
