import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/server/db/client";
import { agentTurns, conversations, handoffs, tickets } from "@/server/db/schema";
import {
  appendMessage,
  findConversation,
  lockConversation,
  getOrCreateLiveConversation,
  pageMessages,
} from "@/server/conversations/repository";
import { listQueue, markRead, queueCounts } from "@/server/conversations/queue";
import { serializeConversation } from "@/server/conversations/serialize";
import {
  claimConversation,
  closeConversation,
  confirmDraftAndAnnounce,
  employeeRequestsAnalyst,
  postAnalystMessage,
  returnToAgent,
  signalTyping,
  startNewConversation,
  touchEmployeePresence,
} from "@/server/conversations/use-cases";
import { createTicketDraft, editDraft, findDraftForEmployee } from "@/server/tickets/drafts";
import { ANA, calendar, CARLA, MARINA, RAFAEL, resetDatabase, sessionUser } from "../support/db";

async function waitingConversation() {
  const ana = await sessionUser(ANA);
  const conversation = await getOrCreateLiveConversation(db(), ana.id);
  await employeeRequestsAnalyst(ana, conversation.id);
  return { ana, conversation };
}

describe("conversation lifecycle", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("keeps a single live conversation per employee", async () => {
    const ana = await sessionUser(ANA);
    const [first, second] = await Promise.all([
      getOrCreateLiveConversation(db(), ana.id),
      getOrCreateLiveConversation(db(), ana.id),
    ]);
    expect(first.id).toBe(second.id);
  });

  it("lets exactly one of two analysts assume a conversation", async () => {
    const { conversation } = await waitingConversation();
    const rafael = await sessionUser(RAFAEL);
    const marina = await sessionUser(MARINA);
    const results = await Promise.allSettled([
      claimConversation(rafael, conversation.id),
      claimConversation(marina, conversation.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected && rejected.status === "rejected" ? rejected.reason : null).toMatchObject({
      code: "conflict",
    });
    const stored = await findConversation(db(), conversation.id);
    expect(stored?.state).toBe("analyst_active");
  });

  it("only the assigned analyst can reply, return or close", async () => {
    const { conversation } = await waitingConversation();
    const rafael = await sessionUser(RAFAEL);
    const marina = await sessionUser(MARINA);
    await expect(
      postAnalystMessage(rafael, conversation.id, { clientId: "c-000001", text: "oi" }),
    ).rejects.toMatchObject({
      code: "conflict",
    });
    await claimConversation(rafael, conversation.id);
    await postAnalystMessage(rafael, conversation.id, { clientId: "c-000002", text: "Oi, Ana!" });
    await expect(
      postAnalystMessage(marina, conversation.id, { clientId: "c-000003", text: "x" }),
    ).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(returnToAgent(marina, conversation.id)).rejects.toMatchObject({
      code: "conflict",
    });
    const returned = await returnToAgent(rafael, conversation.id);
    expect(returned).toMatchObject({ state: "agent_active", assignedAnalystId: null });
  });

  it("closing the conversation does not change ticket status", async () => {
    const { ana, conversation } = await waitingConversation();
    const rafael = await sessionUser(RAFAEL);
    await db()
      .update(conversations)
      .set({ focusTicketId: null })
      .where(eq(conversations.id, conversation.id));
    await claimConversation(rafael, conversation.id);
    const before = await db().select().from(tickets).where(eq(tickets.requesterId, ana.id));
    await closeConversation(rafael, conversation.id);
    const after = await db().select().from(tickets).where(eq(tickets.requesterId, ana.id));
    expect(after.map((ticket) => ticket.status).sort()).toEqual(
      before.map((ticket) => ticket.status).sort(),
    );
    await expect(closeConversation(rafael, conversation.id)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("paginates long histories by cursor without gaps or duplicates", async () => {
    const ana = await sessionUser(ANA);
    const conversation = await getOrCreateLiveConversation(db(), ana.id);
    for (let index = 0; index < 120; index += 1) {
      await appendMessage(db(), {
        conversationId: conversation.id,
        kind: "employee",
        senderId: ana.id,
        content: `m${index}`,
      });
    }
    const seen: string[] = [];
    let page = await pageMessages(db(), conversation.id, { limit: 30 });
    expect(page.messages.at(-1)?.content).toBe("m119");
    seen.unshift(...page.messages.map((message) => message.content));
    while (page.hasMoreBefore) {
      page = await pageMessages(db(), conversation.id, {
        before: page.messages[0]!.seq,
        limit: 30,
      });
      seen.unshift(...page.messages.map((message) => message.content));
    }
    expect(seen).toEqual(Array.from({ length: 120 }, (_, index) => `m${index}`));
    const tail = await pageMessages(db(), conversation.id, { after: 115, limit: 100 });
    expect(tail.messages.map((message) => message.seq)).toEqual([116, 117, 118, 119, 120]);
  });

  it("assigns message seq in commit order, so the polling cursor never skips one", async () => {
    const ana = await sessionUser(ANA);
    const conversation = await getOrCreateLiveConversation(db(), ana.id);
    let late: Promise<{ seq: number }> | undefined;
    const early = await db().transaction(async (tx) => {
      // Another writer holds the conversation (claim, handoff, finishing turn)...
      await lockConversation(tx, conversation.id);
      // ...while a second writer starts appending to the same conversation.
      late = db().transaction((other) =>
        appendMessage(other, {
          conversationId: conversation.id,
          kind: "system",
          senderId: null,
          content: "segunda",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      return appendMessage(tx, {
        conversationId: conversation.id,
        kind: "system",
        senderId: null,
        content: "primeira",
      });
    });
    const second = await late;
    // The first commit must carry the lower seq; otherwise a client that polled
    // between the two commits would move its cursor past the late message.
    expect(early.seq).toBeLessThan(second?.seq ?? 0);
  });

  it("counts live and recently closed conversations, not old history", async () => {
    const { conversation } = await waitingConversation();
    const rafael = await sessionUser(RAFAEL);
    const carla = await sessionUser(CARLA);
    const old = await getOrCreateLiveConversation(db(), carla.id);
    await db()
      .update(conversations)
      .set({ state: "closed", closedAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(conversations.id, old.id));
    const recent = await getOrCreateLiveConversation(db(), carla.id);
    await db()
      .update(conversations)
      .set({ state: "closed", closedAt: new Date(Date.now() - 86_400_000) })
      .where(eq(conversations.id, recent.id));

    expect(await queueCounts(db(), rafael.id)).toEqual({
      for_you: 1,
      with_agent: 0,
      mine: 0,
      all: 2,
      attention: 1,
    });
    const all = await listQueue(db(), rafael.id, { filter: "all", query: "" });
    expect(all.map((item) => item.id).sort()).toEqual([conversation.id, recent.id].sort());
  });

  it("accepts typing signals only from the people in the conversation", async () => {
    const ana = await sessionUser(ANA);
    const carla = await sessionUser(CARLA);
    const rafael = await sessionUser(RAFAEL);
    const marina = await sessionUser(MARINA);
    const live = await getOrCreateLiveConversation(db(), ana.id);
    // With the agent there is nobody to tell.
    expect(await signalTyping(ana, live.id, true)).toBe(false);

    await employeeRequestsAnalyst(ana, live.id);
    expect(await signalTyping(carla, live.id, true)).toBe(false);
    expect(await signalTyping(rafael, live.id, true)).toBe(false);
    expect(await signalTyping(ana, live.id, true)).toBe(true);
    let stored = await findConversation(db(), live.id);
    if (!stored) throw new Error("conversation missing");
    expect((await serializeConversation(db(), stored, 30)).typing).toEqual({
      employee: true,
      analyst: false,
    });

    await claimConversation(rafael, live.id);
    expect(await signalTyping(marina, live.id, true)).toBe(false);
    expect(await signalTyping(rafael, live.id, true)).toBe(true);
    stored = await findConversation(db(), live.id);
    if (!stored) throw new Error("conversation missing");
    expect((await serializeConversation(db(), stored, 30)).typing.analyst).toBe(true);

    // The message itself ends the indicator, in the same commit.
    await postAnalystMessage(rafael, live.id, { clientId: "typing-clears-1", text: "Oi, Ana!" });
    stored = await findConversation(db(), live.id);
    if (!stored) throw new Error("conversation missing");
    expect((await serializeConversation(db(), stored, 30)).typing.analyst).toBe(false);
    expect(stored.analystTypingAt).toBeNull();
  });

  it("lets a typing signal expire on its own", async () => {
    const { ana, conversation } = await waitingConversation();
    await signalTyping(ana, conversation.id, true);
    await db()
      .update(conversations)
      .set({ employeeTypingAt: new Date(Date.now() - 10_000) })
      .where(eq(conversations.id, conversation.id));
    const stored = await findConversation(db(), conversation.id);
    if (!stored) throw new Error("conversation missing");
    expect((await serializeConversation(db(), stored, 30)).typing.employee).toBe(false);
  });

  it("counts what needs the analyst: waiting plus own conversations with unread messages", async () => {
    const { ana, conversation } = await waitingConversation();
    const rafael = await sessionUser(RAFAEL);
    expect((await queueCounts(db(), rafael.id)).attention).toBe(1);
    await claimConversation(rafael, conversation.id);
    await markRead(db(), conversation.id);
    expect((await queueCounts(db(), rafael.id)).attention).toBe(0);
    await appendMessage(db(), {
      conversationId: conversation.id,
      kind: "employee",
      senderId: ana.id,
      content: "Ainda está lento.",
    });
    expect((await queueCounts(db(), rafael.id)).attention).toBe(1);
    const [item] = await listQueue(db(), rafael.id, { filter: "mine", query: "" });
    expect(item?.unread).toBe(1);
  });

  it("shows the employee online only while their chat is open", async () => {
    const { ana, conversation } = await waitingConversation();
    const rafael = await sessionUser(RAFAEL);
    let [item] = await listQueue(db(), rafael.id, { filter: "for_you", query: "" });
    expect(item?.employeeOnline).toBe(false);
    await touchEmployeePresence(ana.id, conversation.id);
    [item] = await listQueue(db(), rafael.id, { filter: "for_you", query: "" });
    expect(item?.employeeOnline).toBe(true);
    // Another employee's poll never marks this conversation.
    const carla = await sessionUser(CARLA);
    await db()
      .update(conversations)
      .set({ employeeSeenAt: new Date(Date.now() - 60_000) })
      .where(eq(conversations.id, conversation.id));
    await touchEmployeePresence(carla.id, conversation.id);
    [item] = await listQueue(db(), rafael.id, { filter: "for_you", query: "" });
    expect(item?.employeeOnline).toBe(false);
  });

  it("orders waiting conversations by the nearest contact deadline and flags real states", async () => {
    const ana = await sessionUser(ANA);
    const carla = await sessionUser(CARLA);
    const rafael = await sessionUser(RAFAEL);
    const anaLive = await getOrCreateLiveConversation(db(), ana.id);
    await employeeRequestsAnalyst(ana, anaLive.id);
    const carlaLive = await getOrCreateLiveConversation(db(), carla.id);
    await employeeRequestsAnalyst(carla, carlaLive.id);
    // Carla's deadline is the most urgent even though Ana wrote last.
    await db()
      .update(handoffs)
      .set({ respondBy: new Date(Date.now() - 10 * 60_000), reason: "critical" })
      .where(eq(handoffs.conversationId, carlaLive.id));
    const waiting = await listQueue(db(), rafael.id, { filter: "for_you", query: "" });
    expect(waiting.map((item) => item.id)).toEqual([carlaLive.id, anaLive.id]);
    expect(waiting[0]?.critical).toBe(true);
    expect(waiting[1]?.critical).toBe(false);

    await returnToAgent(rafael, anaLive.id);
    await db()
      .insert(agentTurns)
      .values({ conversationId: anaLive.id, userMessageSeq: 1, model: "x" });
    const [withAgent] = await listQueue(db(), rafael.id, { filter: "with_agent", query: "" });
    expect(withAgent).toMatchObject({ id: anaLive.id, agentBusy: true, hadHandoff: true });
  });

  it("starts a new conversation only when the current one may end", async () => {
    const { ana, conversation } = await waitingConversation();
    // With a person on the other side and messages left, the session goes on.
    await expect(startNewConversation(ana.id, 30)).rejects.toMatchObject({ code: "conflict" });

    // At the limit, a new conversation closes the old one for the analyst too.
    for (let index = 0; index < 3; index += 1) {
      await appendMessage(db(), {
        conversationId: conversation.id,
        kind: "employee",
        senderId: ana.id,
        content: `mensagem ${index}`,
      });
    }
    const next = await startNewConversation(ana.id, 3);
    expect(next.id).not.toBe(conversation.id);
    const old = await findConversation(db(), conversation.id);
    expect(old?.state).toBe("closed");
    const page = await pageMessages(db(), conversation.id, { limit: 5 });
    expect(page.messages.at(-1)?.content).toContain("limite de 3 mensagens");

    // An empty conversation is reused instead of piling up new ones.
    expect((await startNewConversation(ana.id, 3)).id).toBe(next.id);
  });

  it("shows waiting conversations in the analyst queue with the transfer reason", async () => {
    const { conversation } = await waitingConversation();
    const rafael = await sessionUser(RAFAEL);
    const queue = await listQueue(db(), rafael.id, { filter: "for_you", query: "" });
    expect(queue.map((item) => item.id)).toEqual([conversation.id]);
    expect(queue[0]?.handoff?.reason).toBe("Pedido do funcionário");
    const search = await listQueue(db(), rafael.id, { filter: "all", query: "Ana" });
    expect(search).toHaveLength(1);
  });
});

describe("ticket drafts", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  async function newDraft(email = ANA) {
    const user = await sessionUser(email);
    const conversation = await getOrCreateLiveConversation(db(), user.id);
    const draft = await createTicketDraft(db(), calendar, {
      employeeId: user.id,
      conversationId: conversation.id,
      turnId: null,
      type: "INC",
      category: "Rede e VPN",
      title: "VPN não conecta — erro 809",
      description: "Notebook com Windows 11 não conecta na VPN, erro 809.",
      facts: { scope: "self", workBlocked: true, deadlineToday: true, hasWorkaround: false },
    });
    return { user, conversation, draft };
  }

  it("derives the priority from the facts", async () => {
    const { draft } = await newDraft();
    expect(draft).toMatchObject({
      priority: "alta",
      priorityRule: "high-same-day-commitment",
      status: "pending",
    });
  });

  it("creates exactly one ticket when confirmation is sent twice at once", async () => {
    const { user, draft } = await newDraft();
    const results = await Promise.all([
      confirmDraftAndAnnounce(user.id, draft.id, draft.version, { announce: true }),
      confirmDraftAndAnnounce(user.id, draft.id, draft.version, { announce: true }),
    ]);
    expect(results[0].ticket.number).toBe(results[1].ticket.number);
    expect(results.filter((result) => result.alreadyConfirmed)).toHaveLength(1);
    const created = await db()
      .select()
      .from(tickets)
      .where(eq(tickets.title, "VPN não conecta — erro 809"));
    expect(created).toHaveLength(1);
  });

  it("does not let another employee confirm the draft", async () => {
    const { draft } = await newDraft();
    const carla = await sessionUser(CARLA);
    await expect(
      confirmDraftAndAnnounce(carla.id, draft.id, undefined, { announce: true }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("recomputes priority when the employee edits the scope", async () => {
    const { user, draft } = await newDraft();
    const locked = await findDraftForEmployee(db(), user.id, draft.id);
    const edited = await editDraft(db(), calendar, locked, {
      expectedVersion: draft.version,
      scope: "company",
    });
    expect(edited.priority).toBe("critica");
  });

  it("sends a confirmed critical ticket straight to a human", async () => {
    const { user, draft, conversation } = await newDraft();
    const locked = await findDraftForEmployee(db(), user.id, draft.id);
    const edited = await editDraft(db(), calendar, locked, {
      expectedVersion: draft.version,
      scope: "team",
    });
    const result = await confirmDraftAndAnnounce(user.id, draft.id, edited.version, {
      announce: true,
    });
    expect(result.handedOff).toBe(true);
    expect((await findConversation(db(), conversation.id))?.state).toBe("waiting_analyst");
    expect(result.ticket.priority).toBe("critica");
  });
});
