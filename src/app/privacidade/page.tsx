import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Privacidade e uso de dados" };

export default function PrivacyPage() {
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
      <Link
        href="/entrar"
        className="text-primary-text mt-10 inline-block text-sm font-medium hover:underline"
      >
        Voltar para o login
      </Link>
    </main>
  );
}
