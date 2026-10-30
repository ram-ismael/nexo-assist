import { config } from "@/lib/config";
import { db, type Executor } from "@/server/db/client";
import { AppError, ServiceUnavailableError } from "@/server/errors";
import { log } from "@/server/log";
import { TicketService } from "./service";

/** Raised for failures worth retrying (timeouts, connection drops, injected blips). */
export class TransientServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientServiceError";
  }
}

const RETRY_DELAYS_MS = [150, 400];
const CALL_TIMEOUT_MS = 6_000;
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 15_000;

// Per-instance breaker: enough to stop hammering a dead dependency from one
// function instance; it is not meant to coordinate across instances.
const breaker = { failures: 0, openUntil: 0 };

const TRANSIENT_PG_CODES = new Set(["57P01", "57P03", "08000", "08003", "08006", "40001", "40P01"]);

function isTransient(error: unknown): boolean {
  if (error instanceof TransientServiceError) return true;
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      (TRANSIENT_PG_CODES.has(code) || code === "ECONNRESET" || code === "ETIMEDOUT")
    ) {
      return true;
    }
  }
  return false;
}

function injectFault(operation: string): void {
  const rate = config().TICKET_FAULT_RATE;
  if (rate > 0 && Math.random() < rate) {
    throw new TransientServiceError(`Falha simulada do sistema legado em ${operation}`);
  }
}

async function withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TransientServiceError(`Tempo esgotado em ${operation}`)),
      CALL_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type TicketCallInfo = { attempts: number };

/**
 * Every call to the ticket service goes through here. Each attempt runs in its
 * own transaction, so a failed attempt leaves nothing behind and retrying is
 * safe; creation is additionally idempotent at the draft level.
 */
export async function callTicketService<T>(
  operation: string,
  fn: (service: TicketService, tx: Executor) => Promise<T>,
  info?: TicketCallInfo,
): Promise<T> {
  const now = Date.now();
  if (breaker.openUntil > now) throw new ServiceUnavailableError();

  const calendar = config().calendar;
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (info) info.attempts = attempt + 1;
    try {
      const result = await withTimeout(
        db().transaction(async (tx) => {
          injectFault(operation);
          return fn(new TicketService(tx, calendar), tx);
        }),
        operation,
      );
      breaker.failures = 0;
      return result;
    } catch (error) {
      if (error instanceof AppError || !isTransient(error)) throw error;
      lastError = error;
      log("warn", "ticket service transient failure", { operation, attempt: attempt + 1 });
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  breaker.failures += 1;
  if (breaker.failures >= BREAKER_THRESHOLD) breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
  log("error", "ticket service unavailable", {
    operation,
    reason: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new ServiceUnavailableError();
}

export function resetBreakerForTests(): void {
  breaker.failures = 0;
  breaker.openUntil = 0;
}
