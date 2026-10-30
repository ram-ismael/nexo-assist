import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/employee-shell";
import { CredentialsCard } from "@/components/layout/credentials-card";
import { config } from "@/lib/config";
import { requirePageUser } from "@/server/auth/current-user";
import { Lock } from "lucide-react";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function ProfilePage() {
  const user = await requirePageUser("employee");
  const rows = [
    { label: "Nome", value: user.name },
    { label: "E-mail corporativo", value: user.email, managed: true },
    { label: "Área", value: user.department },
    { label: "Computador", value: user.deviceOs ?? "Não informado", managed: true },
  ];
  return (
    <>
      <PageHeader title="Meu perfil" />
      <main className="flex-1 overflow-y-auto px-4 py-10 sm:px-8 lg:py-16">
        <div className="mx-auto max-w-[620px]">
          <h1 className="text-[28px] font-semibold tracking-tight">Meu perfil</h1>
          <p className="text-ink-3 mt-1.5 text-[15px]">
            Seus dados de acesso ao service desk de TI.
          </p>
          <dl className="border-rule mt-8 overflow-hidden rounded-xl border shadow-[0_1px_3px_rgba(27,36,49,0.06)]">
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={`grid gap-1 px-6 py-5 sm:grid-cols-[180px_1fr_auto] sm:items-center ${index > 0 ? "border-rule border-t" : ""}`}
              >
                <dt className="text-ink-3 text-[15px]">{row.label}</dt>
                <dd className="text-ink text-[16px]">{row.value}</dd>
                {row.managed ? (
                  <dd className="text-ink-3 flex items-center gap-1.5 text-[13px]">
                    <Lock className="size-3.5" aria-hidden="true" /> Gerenciado pela TI
                  </dd>
                ) : (
                  <dd />
                )}
              </div>
            ))}
          </dl>
          <CredentialsCard email={user.email} demo={config().DEMO_AUTH_ENABLED} />
        </div>
      </main>
    </>
  );
}
