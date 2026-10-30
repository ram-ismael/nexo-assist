import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { LoginForm, SupportLink } from "@/components/layout/login-form";
import { LoginShowcase } from "@/components/layout/login-showcase";
import { getCurrentUser, homeFor } from "@/server/auth/current-user";
import { publicMetrics } from "@/server/metrics";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));
  const [metrics, params] = await Promise.all([publicMetrics(), searchParams]);

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.25fr_1fr]">
      <section className="bg-navy relative flex flex-col px-6 py-8 text-white sm:px-12 lg:px-16 lg:py-[52px] xl:px-[88px]">
        <Logo tone="light" className="h-[30px] self-start" />
        <LoginShowcase metrics={metrics} />
      </section>

      <section className="bg-paper flex flex-col px-6 py-8 sm:px-12 lg:px-[80px] lg:py-[56px]">
        <p className="text-ink-3 text-right text-sm">
          Problema para entrar? <SupportLink />
        </p>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-ink text-[44px] leading-tight font-normal tracking-[-0.01em]">
            Entrar
          </h1>
          <p className="text-ink-3 mt-2 text-[15px]">
            Use seu e-mail corporativo e a senha da rede Nexo.
          </p>
          {params.expirada ? (
            <p
              role="status"
              className="bg-warning-soft text-warning-text mt-5 rounded-md px-3 py-2 text-sm"
            >
              Sua sessão expirou. Entre novamente para continuar.
            </p>
          ) : null}
          <LoginForm />
        </div>
        <footer className="text-ink-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span>© {new Date().getFullYear()} Nexo · Service desk de TI</span>
          <a href="/privacidade" className="hover:text-ink hover:underline">
            Privacidade e uso de dados
          </a>
        </footer>
      </section>
    </main>
  );
}
