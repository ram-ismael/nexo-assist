import { cookies, headers } from "next/headers";
import { z } from "zod";
import { config } from "@/lib/config";
import { homeFor } from "@/server/auth/current-user";
import { createSession, findActiveUserByEmail, SESSION_COOKIE } from "@/server/auth/sessions";
import { audit } from "@/server/conversations/use-cases";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { json, readJson, route } from "@/server/http";
import { consume } from "@/server/rate-limit";

const schema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean().default(false),
});

function clientIp(forwarded: string | null, real: string | null): string {
  return (forwarded?.split(",")[0]?.trim() || real || "unknown").slice(0, 64);
}

export const POST = route("public", async ({ req }) => {
  const env = config();
  const body = await readJson(req, schema);
  const headerList = await headers();
  const ip = clientIp(headerList.get("x-forwarded-for"), headerList.get("x-real-ip"));
  await consume(db(), {
    key: `login:ip:${ip}`,
    limit: env.RATE_LIMIT_LOGINS_PER_10MIN,
    windowSeconds: 600,
    message: "Muitas tentativas de entrada. Aguarde alguns minutos e tente de novo.",
  });

  if (!env.DEMO_AUTH_ENABLED) {
    // The only supported identity provider in this build is the demo one; a real
    // deployment plugs SSO/OIDC in here instead of accepting any password.
    throw new AppError("unavailable", "O login de demonstração está desativado neste ambiente.");
  }
  const user = await findActiveUserByEmail(db(), body.email);
  if (!user) {
    await audit(null, "session", null, "login", "denied", { reason: "unknown_email" });
    throw new AppError(
      "unauthenticated",
      "E-mail não encontrado. Use um e-mail corporativo cadastrado.",
    );
  }
  const session = await createSession(db(), {
    userId: user.id,
    rememberMe: body.rememberMe,
    userAgent: headerList.get("user-agent"),
  });
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Without "manter conectado" the cookie dies with the browser session; the
    // server-side expiry still applies either way.
    ...(body.rememberMe ? { expires: session.expiresAt } : {}),
  });
  await audit(user.id, "session", null, "login", "success", { rememberMe: body.rememberMe });
  return json({ user: { name: user.name, role: user.role }, redirectTo: homeFor(user) });
});
