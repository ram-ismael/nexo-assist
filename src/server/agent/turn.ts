import { RequestContext } from "@mastra/core/request-context";
import { and, desc, eq, sql } from "drizzle-orm";
import { config } from "@/lib/config";
import type { ConversationDTO, MessageDTO } from "@/lib/api-types";
import type { SessionUser } from "@/server/auth/sessions";
import { db, type Executor } from "@/server/db/client";
import {
  agentDecisions,
  agentTurns,
  agentActions,
  conversations,
  messages,
} from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/errors";
import { errorFields, log } from "@/server/log";
import { consume } from "@/server/rate-limit";
import {
  appendMessage,
  findConversation,
  countEmployeeMessages,
  findMessageByClientId,
  getOrCreateLiveConversation,
  loadSenders,
  lockConversation,
  reapAbandonedTurns,
  type ConversationRow,
  type MessageRow,
} from "@/server/conversations/repository";
import { serializeConversation, serializeMessages } from "@/server/conversations/serialize";
import { nexoAgent } from "./agent";
import { recentMessages, toModelMessages, turnFacts } from "./context-builder";
import { AGENT_INSTRUCTIONS } from "./instructions";
import { resolveModel } from "./model";
import type { TurnContext, TurnEvent, TurnRequestContext } from "./turn-context";

export type StreamEvent =
  | { type: "accepted"; turnId: string; userMessage: MessageDTO; conversation: ConversationDTO }
  | TurnEvent
  | { type: "done"; message: MessageDTO | null; conversation: ConversationDTO; discarded?: boolean }
  | {
      type: "error";
      code: string;
      message: string;
      retryable: boolean;
      notice: MessageDTO | null;
      conversation: ConversationDTO | null;
    };

export type SubmitResult =
  | { mode: "human" | "duplicate"; message: MessageDTO; conversation: ConversationDTO }
  | {
      mode: "agent";
      turnId: string;
      userMessage: MessageRow;
      conversation: ConversationRow;
    };

async function enforceLimits(executor: Executor, user: SessionUser): Promise<void> {
  const env = config();
  await consume(executor, {
    key: `turns:minute:${user.id}`,
    limit: env.RATE_LIMIT_TURNS_PER_MINUTE,
    windowSeconds: 60,
    message:
      "Você enviou muitas mensagens em pouco tempo. Aguarde alguns segundos e tente de novo.",
  });
  await consume(executor, {
    key: `turns:day:${user.id}`,
    limit: env.RATE_LIMIT_TURNS_PER_DAY,
    windowSeconds: 86_400,
    message:
      "Você atingiu o limite diário de mensagens para o assistente. Fale com um analista ou ligue no ramal 4000.",
  });
  await consume(executor, {
    key: "turns:day:global",
    limit: env.LLM_GLOBAL_DAILY_TURNS,
    windowSeconds: 86_400,
    message:
      "O assistente atingiu o limite de uso de hoje. Fale com um analista ou ligue no ramal 4000.",
  });
}

/**
 * Accepts an employee message. Everything that decides whether the agent may
 * answer happens here, inside one transaction with the conversation row locked:
 * ownership, state (agent vs. human), the 30-message session limit, the single
 * running turn and rate limits.
 */
export async function submitEmployeeMessage(
  user: SessionUser,
  input: {
    conversationId: string | null;
    clientId: string;
    text: string;
    retryOfMessageId?: string;
  },
): Promise<SubmitResult> {
  const env = config();
  const result = await db().transaction(async (tx) => {
    let conversation: ConversationRow | null = input.conversationId
      ? await lockConversation(tx, input.conversationId)
      : await lockConversation(tx, (await getOrCreateLiveConversation(tx, user.id)).id);
    if (!conversation || conversation.employeeId !== user.id) throw notFound("Conversa");
    if (conversation.state === "closed") {
      throw conflict("Esta conversa foi encerrada. Comece uma nova conversa para continuar.", {
        state: "closed",
      });
    }

    let userMessage: MessageRow | null = null;
    if (input.retryOfMessageId) {
      const last = await tx
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(desc(messages.seq))
        .limit(3);
      userMessage =
        last.find((row) => row.id === input.retryOfMessageId && row.kind === "employee") ?? null;
      if (!userMessage)
        throw conflict("Só é possível tentar de novo a última mensagem sem resposta.");
    } else {
      const existing = await findMessageByClientId(tx, conversation.id, input.clientId);
      if (existing) return { mode: "duplicate" as const, message: existing, conversation };
      // PRD: 30 messages per session, whoever answers (assistant or analyst).
      // A retry reuses the stored message, so it never counts twice.
      if ((await countEmployeeMessages(tx, conversation.id)) >= env.AGENT_SESSION_MESSAGE_LIMIT) {
        throw new AppError(
          "limit_reached",
          `Esta sessão chegou ao limite de ${env.AGENT_SESSION_MESSAGE_LIMIT} mensagens. Comece uma nova conversa para continuar.`,
        );
      }
    }

    if (conversation.state !== "agent_active") {
      if (!userMessage) {
        userMessage = await appendMessage(tx, {
          conversationId: conversation.id,
          kind: "employee",
          senderId: user.id,
          content: input.text,
          clientId: input.clientId,
        });
      }
      return { mode: "human" as const, message: userMessage, conversation };
    }

    // A turn whose function was killed would otherwise block this conversation forever.
    if (await reapAbandonedTurns(tx, conversation.id)) {
      conversation = (await lockConversation(tx, conversation.id)) ?? conversation;
    }
    const running = await tx
      .select({ id: agentTurns.id })
      .from(agentTurns)
      .where(and(eq(agentTurns.conversationId, conversation.id), eq(agentTurns.status, "running")))
      .limit(1);
    if (running.length > 0) throw conflict("Aguarde a resposta anterior do assistente.");

    await enforceLimits(tx, user);
    const resolvedModelId = env.NEXO_SCRIPTED_MODEL ? "scripted-test-model" : env.LLM_MODEL;
    if (!userMessage) {
      userMessage = await appendMessage(tx, {
        conversationId: conversation.id,
        kind: "employee",
        senderId: user.id,
        content: input.text,
        clientId: input.clientId,
      });
    }
    const turnRows = await tx
      .insert(agentTurns)
      .values({
        conversationId: conversation.id,
        userMessageSeq: userMessage.seq,
        model: resolvedModelId,
      })
      .returning({ id: agentTurns.id });
    const updated = await tx
      .update(conversations)
      .set({ agentTurnCount: sql`${conversations.agentTurnCount} + 1` })
      .where(eq(conversations.id, conversation.id))
      .returning();
    conversation = updated[0] ?? conversation;
    const turnId = turnRows[0]?.id;
    if (!turnId) throw new Error("Falha ao iniciar o turno");
    return { mode: "agent" as const, turnId, userMessage, conversation };
  });

  if (result.mode === "agent") return result;
  const [message] = await serializeMessages(db(), [result.message]);
  if (!message) throw new Error("Falha ao serializar a mensagem");
  return {
    mode: result.mode,
    message,
    conversation: await serializeConversation(
      db(),
      result.conversation,
      env.AGENT_SESSION_MESSAGE_LIMIT,
    ),
  };
}

function classifyFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof AppError)
    return { code: error.code, message: error.message, retryable: error.code === "unavailable" };
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/abort|timeout/i.test(text)) {
    return {
      code: "llm_timeout",
      message: "O assistente demorou demais para responder.",
      retryable: true,
    };
  }
  if (/rate|overloaded|529|429/i.test(text)) {
    return {
      code: "llm_overloaded",
      message: "O provedor de IA está sobrecarregado no momento.",
      retryable: true,
    };
  }
  if (/401|403|api key|authentication/i.test(text)) {
    return {
      code: "llm_auth",
      message: "O provedor de IA recusou as credenciais configuradas.",
      retryable: false,
    };
  }
  return { code: "llm_error", message: "O provedor de IA falhou ao responder.", retryable: true };
}

/**
 * Runs one agent turn and persists everything it produced. The model only
 * proposes tool calls; tools enforce identity, state and business rules.
 */
export async function runAgentTurn(
  user: SessionUser,
  accepted: Extract<SubmitResult, { mode: "agent" }>,
  emit: (event: StreamEvent) => void,
): Promise<void> {
  const env = config();
  const limit = env.AGENT_SESSION_MESSAGE_LIMIT;
  const started = Date.now();
  let firstTokenMs: number | null = null;
  const now = new Date();
  const turn: TurnContext = {
    user,
    conversationId: accepted.conversation.id,
    turnId: accepted.turnId,
    now,
    calendar: env.calendar,
    blocks: [],
    decision: null,
    handedOff: false,
    focusTicketId: accepted.conversation.focusTicketId,
    emit: (event) => emit(event),
  };

  const [userMessageDTO] = await serializeMessages(db(), [accepted.userMessage]);
  emit({
    type: "accepted",
    turnId: accepted.turnId,
    userMessage: userMessageDTO as MessageDTO,
    conversation: await serializeConversation(db(), accepted.conversation, limit),
  });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("timeout")), env.LLM_TIMEOUT_MS);
  let text = "";
  try {
    const resolved = await resolveModel();
    const history = await recentMessages(db(), accepted.conversation.id, accepted.userMessage.seq);
    const senders = await loadSenders(db(), [
      ...new Set(history.map((row) => row.senderId).filter((id): id is string => !!id)),
    ]);
    const names = new Map([...senders].map(([id, sender]) => [id, sender.name]));
    const facts = await turnFacts(db(), {
      user,
      conversation: accepted.conversation,
      calendar: env.calendar,
      now,
    });
    const requestContext = new RequestContext<TurnRequestContext>();
    requestContext.set("turn", turn);

    const output = await nexoAgent(resolved).stream(toModelMessages(history, names), {
      instructions: `${AGENT_INSTRUCTIONS}\n\n${facts}`,
      requestContext,
      maxSteps: 8,
      abortSignal: abort.signal,
      modelSettings: { maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS, temperature: 0.2 },
    });
    for await (const chunk of output.fullStream) {
      if (chunk.type === "text-delta") {
        firstTokenMs ??= Date.now() - started;
        text += chunk.payload.text;
        emit({ type: "text", delta: chunk.payload.text });
      } else if (chunk.type === "error") {
        throw chunk.payload.error instanceof Error
          ? chunk.payload.error
          : new Error(String(chunk.payload.error));
      }
    }
    const usage = await output.usage;
    await finishTurn(user, accepted, turn, text, emit, {
      latencyMs: Date.now() - started,
      firstTokenMs,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      model: resolved.id,
    });
  } catch (error) {
    const failure = classifyFailure(error);
    log("error", "agent turn failed", {
      turnId: accepted.turnId,
      code: failure.code,
      ...errorFields(error),
    });
    const notice = await failTurn(accepted, failure, Date.now() - started);
    emit({
      type: "error",
      ...failure,
      notice,
      conversation: await currentConversationDTO(accepted.conversation.id),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function currentConversationDTO(conversationId: string): Promise<ConversationDTO | null> {
  const conversation = await findConversation(db(), conversationId);
  return conversation
    ? serializeConversation(db(), conversation, config().AGENT_SESSION_MESSAGE_LIMIT)
    : null;
}

async function finishTurn(
  user: SessionUser,
  accepted: Extract<SubmitResult, { mode: "agent" }>,
  turn: TurnContext,
  text: string,
  emit: (event: StreamEvent) => void,
  metrics: {
    latencyMs: number;
    firstTokenMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    model: string;
  },
): Promise<void> {
  const limit = config().AGENT_SESSION_MESSAGE_LIMIT;
  const outcome = await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, accepted.conversation.id);
    if (!conversation) throw notFound("Conversa");
    const [turnRow] = await tx
      .select({ status: agentTurns.status })
      .from(agentTurns)
      .where(eq(agentTurns.id, accepted.turnId));
    // A person took over while the model was working, or the turn was already
    // closed as abandoned: the answer is not delivered.
    const discarded =
      conversation.state === "analyst_active" ||
      conversation.state === "closed" ||
      turnRow?.status !== "running";
    const actions = await tx
      .select({ tool: agentActions.tool, label: agentActions.label, status: agentActions.status })
      .from(agentActions)
      .where(eq(agentActions.turnId, accepted.turnId));
    const decision = turn.decision ?? {
      intent: "nao_registrada",
      understanding: "O agent não registrou o próprio entendimento nesta resposta.",
      action:
        actions.length > 0
          ? actions.map((action) => action.label).join(", ")
          : "Respondeu sem usar ferramentas.",
      certainty: "baixa" as const,
      reason: "Decisão reconstruída pelo sistema a partir das ações executadas.",
      rules: [],
      missingInformation: [],
      escalationReason: null,
    };
    await tx.insert(agentDecisions).values({
      turnId: accepted.turnId,
      conversationId: conversation.id,
      intent: decision.intent,
      understanding: decision.understanding,
      action: decision.action,
      certainty: decision.certainty,
      reason: decision.reason,
      rules: decision.rules,
      missingInformation: decision.missingInformation,
      escalationReason: decision.escalationReason,
      source: turn.decision ? "agent" : "system",
    });
    let message: MessageRow | null = null;
    const content = text.trim();
    if (!discarded && (content || turn.blocks.length > 0)) {
      message = await appendMessage(tx, {
        conversationId: conversation.id,
        kind: "agent",
        senderId: null,
        content,
        blocks: turn.blocks,
        turnId: accepted.turnId,
      });
    }
    if (turn.focusTicketId && turn.focusTicketId !== conversation.focusTicketId) {
      await tx
        .update(conversations)
        .set({ focusTicketId: turn.focusTicketId })
        .where(eq(conversations.id, conversation.id));
    }
    await tx
      .update(agentTurns)
      .set({
        status:
          turnRow?.status !== "running" ? turnRow?.status : discarded ? "discarded" : "completed",
        model: metrics.model,
        latencyMs: metrics.latencyMs,
        firstTokenMs: metrics.firstTokenMs,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        finishedAt: new Date(),
      })
      .where(eq(agentTurns.id, accepted.turnId));
    // A handoff appended its system message before this answer; keep the
    // agent's announcement ordered after it by reading the fresh row.
    const fresh = await findConversation(tx, conversation.id);
    return { message, discarded, conversation: fresh ?? conversation };
  });
  log("info", "agent turn completed", {
    turnId: accepted.turnId,
    userId: user.id,
    latencyMs: metrics.latencyMs,
    firstTokenMs: metrics.firstTokenMs,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    discarded: outcome.discarded,
    handedOff: turn.handedOff,
  });
  const [messageDTO] = outcome.message ? await serializeMessages(db(), [outcome.message]) : [];
  emit({
    type: "done",
    message: messageDTO ?? null,
    conversation: await serializeConversation(db(), outcome.conversation, limit),
    discarded: outcome.discarded,
  });
}

async function failTurn(
  accepted: Extract<SubmitResult, { mode: "agent" }>,
  failure: { code: string; message: string; retryable: boolean },
  latencyMs: number,
): Promise<MessageDTO | null> {
  try {
    const notice = await db().transaction(async (tx) => {
      await tx
        .update(agentTurns)
        .set({ status: "failed", errorCode: failure.code, latencyMs, finishedAt: new Date() })
        .where(eq(agentTurns.id, accepted.turnId));
      // A failed turn does not consume the employee's session quota.
      await tx
        .update(conversations)
        .set({ agentTurnCount: sql`greatest(${conversations.agentTurnCount} - 1, 0)` })
        .where(eq(conversations.id, accepted.conversation.id));
      return appendMessage(tx, {
        conversationId: accepted.conversation.id,
        kind: "system",
        senderId: null,
        content: `O Nexo Assist não conseguiu responder: ${failure.message}`,
        blocks: [
          {
            type: "notice",
            tone: "error",
            text: failure.retryable
              ? "Sua mensagem foi registrada. Tente de novo ou fale com um analista."
              : "Sua mensagem foi registrada. Fale com um analista para continuar.",
          },
        ],
        turnId: accepted.turnId,
      });
    });
    const [dto] = await serializeMessages(db(), [notice]);
    return dto ?? null;
  } catch (error) {
    log("error", "failed to record turn failure", {
      turnId: accepted.turnId,
      ...errorFields(error),
    });
    return null;
  }
}
