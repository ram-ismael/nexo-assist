import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  AFFECTED_SCOPES,
  PRIORITIES,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  TICKET_TYPES,
} from "@/domain/tickets";
import { CONVERSATION_STATES, MESSAGE_KINDS } from "@/domain/conversations";
import type { MessageBlock } from "@/server/messages/blocks";
import type { SlaPolicy } from "@/domain/sla";
import type { PriorityFacts } from "@/domain/priority";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const userRole = pgEnum("user_role", ["employee", "analyst"]);
export const ticketType = pgEnum("ticket_type", TICKET_TYPES);
export const ticketCategory = pgEnum("ticket_category", TICKET_CATEGORIES);
export const ticketPriority = pgEnum("ticket_priority", PRIORITIES);
export const ticketStatus = pgEnum("ticket_status", TICKET_STATUSES);
export const affectedScope = pgEnum("affected_scope", AFFECTED_SCOPES);
export const conversationState = pgEnum("conversation_state", CONVERSATION_STATES);
export const messageKind = pgEnum("message_kind", MESSAGE_KINDS);
export const draftStatus = pgEnum("draft_status", ["pending", "confirmed", "cancelled", "expired"]);
export const draftKind = pgEnum("draft_kind", ["create", "update", "reopen"]);
export const turnStatus = pgEnum("turn_status", ["running", "completed", "failed", "discarded"]);
export const certainty = pgEnum("certainty", ["alta", "media", "baixa"]);

export const incNumberSeq = pgSequence("inc_number_seq", { startWith: 20520 });
export const reqNumberSeq = pgSequence("req_number_seq", { startWith: 10460 });
export const draftCodeSeq = pgSequence("draft_code_seq", { startWith: 300 });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull(),
    department: text("department").notNull(),
    /** Analysts only: "Suporte N1" or "Suporte N2". */
    supportLevel: text("support_level"),
    /** Employee workstation, used by the agent to check article applicability. */
    deviceOs: text("device_os"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_key").on(sql`lower(${table.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the cookie token; the raw token is never stored. */
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    rememberMe: boolean("remember_me").notNull().default(false),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    type: ticketType("type").notNull(),
    category: ticketCategory("category").notNull(),
    subcategory: text("subcategory"),
    priority: ticketPriority("priority").notNull(),
    scope: affectedScope("scope").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: ticketStatus("status").notNull().default("open"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    /** When the current SLA window started: creation or the latest support update. */
    slaStartedAt: timestamp("sla_started_at", { withTimezone: true }).notNull(),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }).notNull(),
    slaPolicy: jsonb("sla_policy").$type<SlaPolicy & { timeZone: string }>().notNull(),
    priorityRule: text("priority_rule"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    sourceConversationId: uuid("source_conversation_id"),
    /** Optimistic concurrency: every mutation bumps it and checks the previous value. */
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tickets_number_key").on(table.number),
    index("tickets_requester_status_idx").on(table.requesterId, table.status),
    index("tickets_requester_updated_idx").on(table.requesterId, table.updatedAt),
  ],
);

export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    actorKind: text("actor_kind").$type<"employee" | "analyst" | "agent" | "system">().notNull(),
    action: text("action").notNull(),
    fromStatus: ticketStatus("from_status"),
    toStatus: ticketStatus("to_status"),
    note: text("note"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ticket_events_ticket_idx").on(table.ticketId, table.id)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => users.id),
    state: conversationState("state").notNull().default("agent_active"),
    assignedAnalystId: uuid("assigned_analyst_id").references(() => users.id),
    /** Employee messages answered by the agent in this session (PRD: max 30). */
    agentTurnCount: integer("agent_turn_count").notNull().default(0),
    /** Ticket the conversation is mainly about, when known. */
    focusTicketId: uuid("focus_ticket_id").references(() => tickets.id),
    lastMessagePreview: text("last_message_preview"),
    lastMessageKind: messageKind("last_message_kind"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last message the employee/analyst has seen, for unread counters. */
    analystReadSeq: integer("analyst_read_seq").notNull().default(0),
    /** Last keystroke signal from each side, for "está escrevendo…" (short TTL). */
    employeeTypingAt: timestamp("employee_typing_at", { withTimezone: true }),
    analystTypingAt: timestamp("analyst_typing_at", { withTimezone: true }),
    /** Last poll from the employee's open, visible chat: drives "online" in the console. */
    employeeSeenAt: timestamp("employee_seen_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("conversations_employee_idx").on(table.employeeId, table.lastActivityAt),
    index("conversations_state_idx").on(table.state, table.lastActivityAt),
    // "Recently closed" in the analyst queue without scanning all closed history.
    index("conversations_recently_closed_idx")
      .on(table.closedAt)
      .where(sql`${table.state} = 'closed'`),
    // At most one live conversation per employee; closed ones are history.
    uniqueIndex("conversations_one_live_per_employee")
      .on(table.employeeId)
      .where(sql`${table.state} <> 'closed'`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    /** Monotonic cursor for pagination and incremental sync. */
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    id: uuid("id").notNull().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    kind: messageKind("kind").notNull(),
    senderId: uuid("sender_id").references(() => users.id),
    content: text("content").notNull(),
    blocks: jsonb("blocks").$type<MessageBlock[]>().notNull().default([]),
    turnId: uuid("turn_id"),
    /** Client-generated id that makes message submission idempotent. */
    clientId: text("client_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_id_key").on(table.id),
    index("messages_conversation_seq_idx").on(table.conversationId, table.seq),
    uniqueIndex("messages_client_id_key")
      .on(table.conversationId, table.clientId)
      .where(sql`${table.clientId} is not null`),
  ],
);

export const agentTurns = pgTable(
  "agent_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userMessageSeq: integer("user_message_seq").notNull(),
    status: turnStatus("status").notNull().default("running"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    firstTokenMs: integer("first_token_ms"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_turns_conversation_idx").on(table.conversationId, table.startedAt),
    // Service-wide reads by recency: assistant health and the login metrics.
    index("agent_turns_started_idx").on(table.startedAt),
    // One agent turn at a time per conversation.
    uniqueIndex("agent_turns_one_running")
      .on(table.conversationId)
      .where(sql`${table.status} = 'running'`),
  ],
);

export const agentActions = pgTable(
  "agent_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => agentTurns.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    label: text("label").notNull(),
    status: text("status").$type<"ok" | "error" | "denied">().notNull(),
    /** Bookkeeping steps (decision record, quick replies) stay out of the trail above the answer. */
    visible: boolean("visible").notNull().default(true),
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    summary: text("summary").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_actions_turn_idx").on(table.turnId, table.id)],
);

export const agentDecisions = pgTable(
  "agent_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => agentTurns.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    intent: text("intent").notNull(),
    understanding: text("understanding").notNull(),
    action: text("action").notNull(),
    certainty: certainty("certainty").notNull(),
    reason: text("reason").notNull(),
    rules: jsonb("rules").$type<string[]>().notNull().default([]),
    missingInformation: jsonb("missing_information").$type<string[]>().notNull().default([]),
    escalationReason: text("escalation_reason"),
    /** "agent" when reported through the decision tool, "system" when reconstructed. */
    source: text("source").$type<"agent" | "system">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_decisions_turn_key").on(table.turnId),
    index("agent_decisions_conversation_idx").on(table.conversationId, table.createdAt),
  ],
);

export const ticketDrafts = pgTable(
  "ticket_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    kind: draftKind("kind").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => users.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Target ticket for update/reopen drafts. */
    ticketId: uuid("ticket_id").references(() => tickets.id),
    type: ticketType("type"),
    category: ticketCategory("category"),
    priority: ticketPriority("priority"),
    scope: affectedScope("scope"),
    title: text("title"),
    description: text("description"),
    /** Text appended to an existing ticket (update/reopen). */
    note: text("note"),
    /** Impact/urgency facts the priority was derived from (recomputed on edit). */
    priorityFacts: jsonb("priority_facts").$type<PriorityFacts>(),
    priorityRule: text("priority_rule"),
    priorityExplanation: text("priority_explanation"),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    status: draftStatus("status").notNull().default("pending"),
    resultTicketId: uuid("result_ticket_id").references(() => tickets.id),
    turnId: uuid("turn_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("ticket_drafts_code_key").on(table.code),
    index("ticket_drafts_conversation_idx").on(table.conversationId, table.status),
  ],
);

export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    origin: text("origin").$type<"agent" | "employee" | "system">().notNull(),
    reason: text("reason")
      .$type<
        "employee_request" | "critical" | "overdue" | "low_confidence" | "out_of_tools" | "failure"
      >()
      .notNull(),
    summary: text("summary").notNull(),
    targetLevel: text("target_level").notNull(),
    ticketIds: jsonb("ticket_ids").$type<string[]>().notNull().default([]),
    respondBy: timestamp("respond_by", { withTimezone: true }),
    claimedById: uuid("claimed_by_id").references(() => users.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("handoffs_conversation_idx").on(table.conversationId, table.createdAt)],
);

export const knowledgeArticles = pgTable(
  "knowledge_articles",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: ticketCategory("category").notNull(),
    /** Platforms the guidance applies to, e.g. ["Windows 10"]; empty = any. */
    platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
    keywords: text("keywords").notNull().default(""),
    /** Accent-free lowercase text used by the full-text index. */
    searchText: text("search_text").notNull(),
    status: text("status").$type<"published" | "archived">().notNull().default("published"),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("knowledge_articles_search_idx").using(
      "gin",
      sql`to_tsvector('portuguese', ${table.searchText})`,
    ),
  ],
);

export const analystPresence = pgTable("analyst_presence", {
  analystId: uuid("analyst_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  available: boolean("available").notNull().default(true),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    outcome: text("outcome").$type<"success" | "denied" | "failed">().notNull(),
    requestId: text("request_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_entity_idx").on(table.entity, table.entityId)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.windowStart] }),
    check("rate_limits_count_positive", sql`${table.count} >= 0`),
  ],
);
