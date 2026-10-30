import type { ApiError } from "./api-types";

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const OFFLINE_MESSAGE = "Sem conexão com o servidor. Verifique sua internet e tente de novo.";

export async function parseError(response: Response): Promise<ApiRequestError> {
  try {
    const body = (await response.json()) as ApiError;
    return new ApiRequestError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.details,
    );
  } catch {
    return new ApiRequestError(response.status, "internal", "Algo deu errado. Tente novamente.");
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      credentials: "same-origin",
      headers: {
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiRequestError(0, "offline", OFFLINE_MESSAGE);
  }
  if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    // Full reload on purpose: drops every client cache tied to the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/entrar?expirada=1");
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return "Algo deu errado. Tente novamente.";
}
