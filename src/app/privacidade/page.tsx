import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Logo } from "@/components/brand/logo";
import { config } from "@/lib/config";
import { listActiveAccounts } from "@/server/auth/sessions";
import { db } from "@/server/db/client";

export const metadata: Metadata = { title: "Privacidade e uso de dados" };

type Account = Awaited<ReturnType<typeof listActiveAccounts>>[number];

function AccountTable({ title, accounts }: { title: string; accounts: Account[] }) {
  return (
    <section className="mt-6">
      <h3 className="text-ink text-[15px] font-semibold">{title}</h3>
      <div className="border-rule mt-2 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[520px] table-fixed text-left text-[14px]">
          <thead className="bg-desk text-ink-3 text-[13px]">
            <tr>
              <th className="w-[30%] px-4 py-2 font-medium">Nome</th>
              <th className="w-[28%] px-4 py-2 font-medium">Área</th>
              <th className="px-4 py-2 font-medium">E-mail de login</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.email} className="border-rule border-t">
                <td className="text-ink px-4 py-2.5 whitespace-nowrap">{account.name}</td>
                <td className="text-ink-2 px-4 py-2.5 whitespace-nowrap">
                  {account.supportLevel ?? account.department}
                </td>
                <td className="text-ink px-4 py-2.5 select-all">{account.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function PrivacyPage() {
  // The account list comes from the database at request time, never from the build.
  await connection();
  const demo = config().DEMO_AUTH_ENABLED;
  const accounts = demo ? await listActiveAccounts(db()) : [];
  const employees = accounts.filter((account) => account.role === "employee");
  const analysts = accounts.filter((account) => account.role === "analyst");

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Logo />
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Privacidade e uso de dados</h1>
      <div className="text-ink-2 mt-6 space-y-4 text-[15px] leading-relaxed">
        <p>
          O Nexo Assist guarda as conversas, os chamados e o registro das ações do assistente para
          atender você e para que a equipe de TI possa auditar cada decisão.
        </p>
        <p>
          As informações de um chamado só são mostradas a quem o abriu e aos analistas do service
          desk. O assistente consulta apenas os seus chamados e nunca recebe dados de outros
          funcionários.
        </p>
        <p>
          As mensagens enviadas ao assistente são processadas por um provedor de IA contratado pela
          Nexo, apenas para gerar a resposta. Não envie senhas, dados bancários ou documentos
          pessoais pelo chat.
        </p>
        <p>Este ambiente é uma demonstração com pessoas e dados fictícios. Dúvidas: ramal 4000.</p>
      </div>

      {demo && accounts.length > 0 ? (
        <section className="mt-10" aria-labelledby="contas-demo">
          <h2 id="contas-demo" className="text-ink text-xl font-semibold tracking-tight">
            Contas de demonstração
          </h2>
          <p className="text-ink-2 mt-2 text-[15px] leading-relaxed">
            Entre com qualquer um destes e-mails. <strong>Qualquer senha é aceita</strong> (basta
            não deixar o campo vazio), porque este ambiente usa um login de demonstração.
            Funcionários abrem o atendimento; analistas abrem o console do service desk.
          </p>
          {employees.length > 0 ? <AccountTable title="Funcionários" accounts={employees} /> : null}
          {analysts.length > 0 ? (
            <AccountTable title="Analistas do service desk" accounts={analysts} />
          ) : null}
        </section>
      ) : null}

      <Link
        href="/entrar"
        className="text-primary-text mt-10 inline-block text-sm font-medium hover:underline"
      >
        Voltar para o login
      </Link>
    </main>
  );
}
