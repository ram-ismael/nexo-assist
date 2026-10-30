"use client";

import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!EMAIL_PATTERN.test(email.trim())) next.email = "Informe um e-mail corporativo válido.";
    if (!password) next.password = "Informe a senha.";
    setErrors(next);
    if (next.email || next.password) return;
    setLoading(true);
    try {
      const result = await api<{ redirectTo: string }>("/api/auth/login", {
        method: "POST",
        json: { email: email.trim(), password, rememberMe },
      });
      router.replace(result.redirectTo);
      router.refresh();
    } catch (error) {
      setErrors({ form: errorMessage(error) });
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} noValidate className="mt-9 flex flex-col">
        <label htmlFor="email" className="text-ink text-sm font-medium">
          E-mail corporativo
        </label>
        <div
          className={cn(
            "bg-paper focus-within:border-primary focus-within:ring-primary/15 mt-2 flex h-12 items-center gap-3 rounded-lg border px-3.5 transition-colors focus-within:ring-2",
            errors.email ? "border-danger" : "border-rule",
          )}
        >
          <Mail className="text-ink-3 size-[18px]" aria-hidden="true" />
          <input
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="nome.sobrenome@nexo.com.br"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            className="text-ink placeholder:text-ink-4 h-full flex-1 bg-transparent text-[15px] outline-none"
          />
        </div>
        {errors.email ? (
          <p id="email-error" className="text-danger-text mt-1.5 text-[13px]">
            {errors.email}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-between">
          <label htmlFor="password" className="text-ink text-sm font-medium">
            Senha
          </label>
          <button
            type="button"
            onClick={() => setRecoveryOpen(true)}
            className="text-primary-text text-sm font-medium hover:underline"
          >
            Esqueci minha senha
          </button>
        </div>
        <div
          className={cn(
            "bg-paper focus-within:border-primary focus-within:ring-primary/15 mt-2 flex h-12 items-center gap-3 rounded-lg border px-3.5 transition-colors focus-within:ring-2",
            errors.password ? "border-danger" : "border-rule",
          )}
        >
          <Lock className="text-ink-3 size-[18px]" aria-hidden="true" />
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            className="text-ink h-full flex-1 bg-transparent text-[15px] tracking-wide outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={showPassword}
            className="text-ink-3 hover:text-ink rounded p-1"
          >
            {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </div>
        {errors.password ? (
          <p id="password-error" className="text-danger-text mt-1.5 text-[13px]">
            {errors.password}
          </p>
        ) : null}

        <label className="text-ink-2 mt-5 flex w-fit cursor-pointer items-center gap-2.5 text-[15px]">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className="accent-cta size-[18px] rounded"
          />
          Manter conectado neste computador
        </label>

        {errors.form ? (
          <p
            role="alert"
            className="bg-danger-soft text-danger-text mt-5 rounded-md px-3 py-2 text-sm"
          >
            {errors.form}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          loading={loading}
          className="mt-7 h-[52px] w-full rounded-lg text-base"
        >
          {loading ? "Entrando…" : "Entrar"}
          {!loading ? <ArrowRight className="size-[18px]" aria-hidden="true" /> : null}
        </Button>
        <hr className="border-rule mt-9" />
        {demo ? (
          <p className="text-ink-3 mt-4 text-[13px] leading-relaxed">
            Ambiente de demonstração com dados fictícios: e-mails cadastrados (ex.:
            ana.souza@nexo.com.br ou rafael.lima@nexo.com.br) entram com qualquer senha.
          </p>
        ) : null}
      </form>

      <Dialog
        open={recoveryOpen}
        onOpenChange={setRecoveryOpen}
        title="Esqueci minha senha"
        description="Como recuperar o acesso"
      >
        <div className="text-ink-2 space-y-3 text-sm leading-relaxed">
          {demo ? (
            <p>
              Este é um ambiente de demonstração: a senha não é verificada e nenhuma senha real é
              guardada aqui, por isso não existe redefinição. Entre com um e-mail cadastrado e
              qualquer senha.
            </p>
          ) : null}
          <p>
            Na Nexo, a senha da rede é gerenciada pela TI. Para redefini-la, use o autoatendimento
            de senhas do Portal do Colaborador a partir de outro dispositivo ou ligue no ramal 4000
            (seg. a sex., 8h às 18h).
          </p>
        </div>
      </Dialog>
    </>
  );
}

export function SupportLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-primary-text font-medium hover:underline"
      >
        Ligue no ramal 4000
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Suporte para entrar"
        description="Service desk de TI da Nexo"
      >
        <div className="text-ink-2 space-y-3 text-sm leading-relaxed">
          <p>
            Ligue no <strong>ramal 4000</strong>, de segunda a sexta, das 8h às 18h. Casos críticos
            (algo parado para uma equipe ou para a empresa) têm plantão 24 horas.
          </p>
          <p>
            Tenha em mãos seu e-mail corporativo e, se possível, uma descrição da mensagem de erro.
          </p>
        </div>
      </Dialog>
    </>
  );
}
