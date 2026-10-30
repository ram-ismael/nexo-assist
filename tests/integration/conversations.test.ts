import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/server/db/client";
import { conversations, tickets } from "@/server/db/schema";
import {
  appendMessage,
  findConversation,
  getOrCreateLiveConversation,
  pageMessages,
} from "@/server/conversations/repository";
import { listQueue } from "@/server/conversations/queue";
import {
  claimConversation,
  closeConversation,
  confirmDraftAndAnnounce,
  employeeRequestsAnalyst,
  postAnalystMessage,
  returnToAgent,
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
