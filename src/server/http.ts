import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { getCurrentUser } from "@/server/auth/current-user";
import { SESSION_COOKIE, type SessionUser } from "@/server/auth/sessions";
import { AppError, type ApiErrorBody } from "@/server/errors";
import { errorFields, log } from "@/server/log";

const MAX_BODY_BYTES = 32 * 1024;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Access = "public" | "user" | "employee" | "analyst";

type HandlerContext<P> = {
  req: NextRequest;
  params: P;
  requestId: string;
};

type Authed<A extends Access> = A extends "public"
  ? { user: SessionUser | null }
  : { user: SessionUser };

/**
 * Same-origin check for state-changing requests. Together with SameSite=Lax
 * session cookies this blocks cross-site form posts and fetches.
 */
function assertSameOrigin(req: NextRequest): void {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new AppError("forbidden", "Origem da requisição não permitida.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("forbidden", "Origem da requisição não permitida.");
  }
  if (originHost !== host) throw new AppError("forbidden", "Origem da requisição não permitida.");
}

function errorResponse(error: unknown, requestId: string): NextResponse<ApiErrorBody> {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details, requestId } },
      { status: error.status, headers: { "x-request-id": requestId } },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation",
          message: "Dados inválidos.",
          details: { fields: error.issues.map((issue) => issue.path.join(".")) },
          requestId,
        },
      },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
  log("error", "unhandled route error", { requestId, ...errorFields(error) });
  return NextResponse.json(
    {
      error: {
        code: "internal",
        message: "Algo deu errado do nosso lado. Tente novamente.",
        requestId,
      },
    },
    { status: 500, headers: { "x-request-id": requestId } },
  );
}

export function route<A extends Access, P = Record<string, never>>(
  access: A,
  handler: (ctx: HandlerContext<P> & Authed<A>) => Promise<Response>,
) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const started = Date.now();
    try {
      assertSameOrigin(req);
      const contentLength = Number(req.headers.get("content-length") ?? 0);
      if (contentLength > MAX_BODY_BYTES)
        throw new AppError("validation", "Requisição grande demais.");
      const user = await getCurrentUser();
      if (access !== "public") {
        if (!user) throw new AppError("unauthenticated", "Sua sessão expirou. Entre novamente.");
        if (access !== "user" && user.role !== access) {
          throw new AppError("forbidden", "Você não tem permissão para esta ação.");
        }
      }
      const params = await context.params;
      const response = await handler({ req, params, requestId, user } as HandlerContext<P> &
        Authed<A>);
      response.headers.set("x-request-id", requestId);
      if (!response.headers.has("cache-control")) response.headers.set("cache-control", "no-store");
      log("info", "request", {
        requestId,
        method: req.method,
        path: req.nextUrl.pathname,
        status: response.status,
        ms: Date.now() - started,
      });
      return response;
    } catch (error) {
      const response = errorResponse(error, requestId);
      // A dead session cookie is useless: clear it so the browser stops sending it.
      if (
        access !== "public" &&
        error instanceof AppError &&
        error.code === "unauthenticated" &&
        req.cookies.has(SESSION_COOKIE)
      ) {
        response.cookies.delete(SESSION_COOKIE);
      }
      log(response.status >= 500 ? "error" : "info", "request failed", {
        requestId,
        method: req.method,
        path: req.nextUrl.pathname,
        status: response.status,
        ms: Date.now() - started,
      });
      return response;
    }
  };
}

export async function readJson<T extends z.ZodType>(
  req: NextRequest,
  schema: T,
): Promise<z.infer<T>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("validation", "Requisição grande demais.");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("validation", "JSON inválido.");
  }
  return schema.parse(raw);
}

export function json<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, init);
}
