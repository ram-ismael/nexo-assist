CREATE TYPE "public"."affected_scope" AS ENUM('self', 'team', 'company');--> statement-breakpoint
CREATE TYPE "public"."certainty" AS ENUM('alta', 'media', 'baixa');--> statement-breakpoint
CREATE TYPE "public"."conversation_state" AS ENUM('agent_active', 'waiting_analyst', 'analyst_active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."draft_kind" AS ENUM('create', 'update', 'reopen');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('pending', 'confirmed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('employee', 'agent', 'analyst', 'system');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('Acesso', 'Rede e VPN', 'Hardware', 'Software', 'E-mail', 'Outros');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('critica', 'alta', 'media', 'baixa');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'waiting_analyst', 'approved', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ticket_type" AS ENUM('INC', 'REQ');--> statement-breakpoint
CREATE TYPE "public"."turn_status" AS ENUM('running', 'completed', 'failed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('employee', 'analyst');--> statement-breakpoint
CREATE SEQUENCE "public"."draft_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 300 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."inc_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 20520 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."req_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10460 CACHE 1;--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"turn_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"label" text NOT NULL,
	"status" text NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"summary" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"understanding" text NOT NULL,
	"action" text NOT NULL,
	"certainty" "certainty" NOT NULL,
	"reason" text NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalation_reason" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_message_seq" integer NOT NULL,
	"status" "turn_status" DEFAULT 'running' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"first_token_ms" integer,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analyst_presence" (
	"analyst_id" uuid PRIMARY KEY NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"entity" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"request_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"state" "conversation_state" DEFAULT 'agent_active' NOT NULL,
	"assigned_analyst_id" uuid,
	"agent_turn_count" integer DEFAULT 0 NOT NULL,
	"focus_ticket_id" uuid,
	"last_message_preview" text,
	"last_message_kind" "message_kind",
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyst_read_seq" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"reason" text NOT NULL,
	"summary" text NOT NULL,
	"target_level" text NOT NULL,
	"ticket_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"respond_by" timestamp with time zone,
	"claimed_by_id" uuid,
	"claimed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" "ticket_category" NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" text DEFAULT '' NOT NULL,
	"search_text" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" "message_kind" NOT NULL,
	"sender_id" uuid,
	"content" text NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turn_id" uuid,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start"),
	CONSTRAINT "rate_limits_count_positive" CHECK ("rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"remember_me" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"employee_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"ticket_id" uuid,
	"type" "ticket_type",
	"category" "ticket_category",
	"priority" "ticket_priority",
	"scope" "affected_scope",
	"title" text,
	"description" text,
	"note" text,
	"priority_facts" jsonb,
	"priority_rule" text,
	"priority_explanation" text,
	"sla_due_at" timestamp with time zone,
	"status" "draft_status" DEFAULT 'pending' NOT NULL,
	"result_ticket_id" uuid,
	"turn_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"from_status" "ticket_status",
	"to_status" "ticket_status",
	"note" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"type" "ticket_type" NOT NULL,
	"category" "ticket_category" NOT NULL,
	"subcategory" text,
	"priority" "ticket_priority" NOT NULL,
	"scope" "affected_scope" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"sla_started_at" timestamp with time zone NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"sla_policy" jsonb NOT NULL,
	"priority_rule" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"source_conversation_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"department" text NOT NULL,
	"support_level" text,
	"device_os" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_turn_id_agent_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_turn_id_agent_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyst_presence" ADD CONSTRAINT "analyst_presence_analyst_id_users_id_fk" FOREIGN KEY ("analyst_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_analyst_id_users_id_fk" FOREIGN KEY ("assigned_analyst_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_focus_ticket_id_tickets_id_fk" FOREIGN KEY ("focus_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_claimed_by_id_users_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_drafts" ADD CONSTRAINT "ticket_drafts_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_drafts" ADD CONSTRAINT "ticket_drafts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_drafts" ADD CONSTRAINT "ticket_drafts_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_drafts" ADD CONSTRAINT "ticket_drafts_result_ticket_id_tickets_id_fk" FOREIGN KEY ("result_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_actions_turn_idx" ON "agent_actions" USING btree ("turn_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_decisions_turn_key" ON "agent_decisions" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "agent_decisions_conversation_idx" ON "agent_decisions" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_turns_conversation_idx" ON "agent_turns" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_turns_one_running" ON "agent_turns" USING btree ("conversation_id") WHERE "agent_turns"."status" = 'running';--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "conversations_employee_idx" ON "conversations" USING btree ("employee_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "conversations_state_idx" ON "conversations" USING btree ("state","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_one_live_per_employee" ON "conversations" USING btree ("employee_id") WHERE "conversations"."state" <> 'closed';--> statement-breakpoint
CREATE INDEX "handoffs_conversation_idx" ON "handoffs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_articles_search_idx" ON "knowledge_articles" USING gin (to_tsvector('portuguese', "search_text"));--> statement-breakpoint
CREATE UNIQUE INDEX "messages_id_key" ON "messages" USING btree ("id");--> statement-breakpoint
CREATE INDEX "messages_conversation_seq_idx" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_id_key" ON "messages" USING btree ("conversation_id","client_id") WHERE "messages"."client_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_drafts_code_key" ON "ticket_drafts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ticket_drafts_conversation_idx" ON "ticket_drafts" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_idx" ON "ticket_events" USING btree ("ticket_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets" USING btree ("number");--> statement-breakpoint
CREATE INDEX "tickets_requester_status_idx" ON "tickets" USING btree ("requester_id","status");--> statement-breakpoint
CREATE INDEX "tickets_requester_updated_idx" ON "tickets" USING btree ("requester_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));