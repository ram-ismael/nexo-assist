export type ErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "limit_reached"
  | "unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  limit_reached: 429,
  unavailable: 503,
  internal: 500,
};

/** Errors that are safe to show to the user: the message is already in Portuguese. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

const FEMININE = new Set(["Conversa"]);
export const notFound = (what = "Registro") =>
  new AppError("not_found", `${what} não ${FEMININE.has(what) ? "encontrada" : "encontrado"}.`);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError("conflict", message, details);

/** Raised by the ticket service gateway when the legacy system stays unavailable. */
export class ServiceUnavailableError extends AppError {
  constructor(
    message = "O sistema de chamados está indisponível no momento. Tente novamente em instantes.",
  ) {
    super("unavailable", message);
    this.name = "ServiceUnavailableError";
  }
}

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown>; requestId: string };
};
