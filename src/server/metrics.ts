import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { errorFields, log } from "@/server/log";
import type { Priority } from "@/domain/tickets";
import { DEMO_SEED_MODEL } from "@/server/db/demo";

export type PublicMetrics = {
  avgFirstResponseSeconds: number | null;
  /** Share of recent assistant conversations that never went to the human queue. */
  withoutHandoffPercent: number | null;
  /** null when presence could not be read: the panel omits it instead of showing 0. */
  analystsOnline: number | null;
};

const UNKNOWN: PublicMetrics = {
  avgFirstResponseSeconds: null,
  withoutHandoffPercent: null,
  analystsOnline: null,
};

const MIN_SAMPLE = 5;

/**
 * Real operational numbers for the login panel. A metric is only returned
 * when there is enough data behind it; otherwise the UI omits it instead of
 * showing an invented value.
 */
export async function publicMetrics(): Promise<PublicMetrics> {
  try {
    const result = await db().execute<{
      turns: number;
      avg_ms: number | null;
      conversations: number;
      without_handoff: number;
      online: number;
    }>(sql`
      with recent_turns as (
        select coalesce(first_token_ms, latency_ms) as ms
        from agent_turns
        where status = 'completed' and started_at > now() - interval '7 days'
          and model <> ${DEMO_SEED_MODEL}
          and coalesce(first_token_ms, latency_ms) is not null
      ),
      recent_conversations as (
        select c.id, exists (select 1 from handoffs h where h.conversation_id = c.id) as handed_off
        from conversations c
        where exists (
          select 1 from agent_turns t
          where t.conversation_id = c.id and t.status = 'completed' and t.started_at > now() - interval '30 days'
            and t.model <> ${DEMO_SEED_MODEL}
        )
      )
      select
        (select count(*)::int from recent_turns) as turns,
        (select avg(ms)::float from recent_turns) as avg_ms,
        (select count(*)::int from recent_conversations) as conversations,
        (select count(*)::int from recent_conversations where not handed_off) as without_handoff,
        (select count(*)::int from analyst_presence where available and last_heartbeat_at > now() - interval '2 minutes') as online
    `);
    const row = result.rows[0];
    if (!row) return UNKNOWN;
    const turns = Number(row.turns);
    const conversations = Number(row.conversations);
    return {
      avgFirstResponseSeconds:
        turns >= MIN_SAMPLE && row.avg_ms !== null
          ? Math.max(1, Math.round(Number(row.avg_ms) / 1000))
          : null,
      withoutHandoffPercent:
        conversations >= MIN_SAMPLE
          ? Math.round((Number(row.without_handoff) / conversations) * 100)
          : null,
      analystsOnline: Number(row.online),
    };
  } catch (error) {
    log("warn", "public metrics unavailable", errorFields(error));
    return UNKNOWN;
  }
}

/**
 * Tool → wording safe for a public page: the live labels can carry ticket
 * numbers ("consultou o INC-20311"), these never do.
 */
const PUBLIC_STEP: Record<string, string> = {
  consultar_meus_chamados: "consultou os chamados",
  consultar_chamado: "consultou um chamado",
  calcular_prazo: "calculou o prazo",
  buscar_central_de_ajuda: "buscou na central de ajuda",
  classificar_prioridade: "classificou a prioridade",
  consultar_sla: "consultou o SLA",
  verificar_duplicidade: "verificou chamados parecidos",
  montar_rascunho: "montou o rascunho",
  preparar_atualizacao: "preparou uma atualização",
  confirmar_rascunho: "registrou a confirmação",
  transferir_para_analista: "chamou um analista",
};

export type LiveShowcase = {
  /** When the data was read: relative times ("há 12 min") are computed from it. */
  generatedAt: string;
  lastTurn: { at: string; steps: string[] } | null;
  lastTicket: { category: string; priority: Priority; slaLabel: string; at: string } | null;
  today: { conversations: number; tickets: number; handoffs: number };
};

/**
 * What the login page shows about the service right now. The page is public,
 * so only anonymous facts: when the last real conversation happened and which
 * steps the assistant took, the category/priority/deadline of the last ticket
 * it opened, and today's totals. No names, message text, titles or numbers.
 * Demo history is excluded. Null when the data cannot be read.
 */
export async function liveShowcase(timeZone: string): Promise<LiveShowcase | null> {
  try {
    const result = await db().execute<{
      turn_at: Date | null;
      tools: string[] | null;
      ticket_category: string | null;
      ticket_priority: Priority | null;
      ticket_sla: string | null;
      ticket_at: Date | null;
      conversations: number;
      tickets: number;
      handoffs: number;
    }>(sql`
      with day as (
        select (date_trunc('day', now() at time zone ${timeZone}) at time zone ${timeZone}) as start
      ),
      demo as (
        select distinct conversation_id from agent_turns where model = ${DEMO_SEED_MODEL}
      ),
      last_turn as (
        select id, finished_at from agent_turns
        where status = 'completed' and model <> ${DEMO_SEED_MODEL} and finished_at is not null
        order by finished_at desc limit 1
      ),
      last_ticket as (
        select t.category::text as category, t.priority, t.sla_policy->>'label' as sla, d.updated_at as at
        from ticket_drafts d join tickets t on t.id = d.result_ticket_id
        where d.status = 'confirmed' and d.kind = 'create'
        order by d.updated_at desc limit 1
      )
      select
        (select finished_at from last_turn) as turn_at,
        (select array(
          select a.tool from agent_actions a
          where a.turn_id = (select id from last_turn) and a.visible
          order by a.id
        )) as tools,
        (select category from last_ticket) as ticket_category,
        (select priority from last_ticket) as ticket_priority,
        (select sla from last_ticket) as ticket_sla,
        (select at from last_ticket) as ticket_at,
        (select count(distinct conversation_id)::int from agent_turns
          where model <> ${DEMO_SEED_MODEL} and started_at >= (select start from day)) as conversations,
        (select count(*)::int from ticket_drafts
          where status = 'confirmed' and kind = 'create' and updated_at >= (select start from day)) as tickets,
        (select count(*)::int from handoffs h
          where h.created_at >= (select start from day)
            and h.conversation_id not in (select conversation_id from demo)) as handoffs
    `);
    const row = result.rows[0];
    if (!row) return null;
    const steps = [...new Set((row.tools ?? []).map((tool) => PUBLIC_STEP[tool]))].filter(
      (step): step is string => !!step,
    );
    return {
      generatedAt: new Date().toISOString(),
      lastTurn: row.turn_at ? { at: new Date(row.turn_at).toISOString(), steps } : null,
      lastTicket:
        row.ticket_category && row.ticket_priority && row.ticket_sla && row.ticket_at
          ? {
              category: row.ticket_category,
              priority: row.ticket_priority,
              slaLabel: row.ticket_sla,
              at: new Date(row.ticket_at).toISOString(),
            }
          : null,
      today: {
        conversations: Number(row.conversations),
        tickets: Number(row.tickets),
        handoffs: Number(row.handoffs),
      },
    };
  } catch (error) {
    log("warn", "live showcase unavailable", errorFields(error));
    return null;
  }
}
