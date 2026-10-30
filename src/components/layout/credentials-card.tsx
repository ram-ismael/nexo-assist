"use client";

import { KeyRound, Mail, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Password management is owned by corporate IT (directory/SSO). In demo mode
 * no password is stored at all, so this card explains that instead of
 * pretending to send a reset e-mail.
 */
export function CredentialsCard({ email, demo }: { email: string; demo: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-rule mt-8 overflow-hidden rounded-xl border shadow-[0_1px_3px_rgba(27,36,49,0.06)]">
      <div className="flex flex-wrap items-center gap-4 px-6 py-5">
        <span className="bg-desk text-ink-2 flex size-12 items-center justify-center rounded-full">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-medium">Senha</h2>
          <p className="text-ink-3 text-[15px]">
            {demo ? "Não verificada no modo de demonstração" : "Gerenciada pelo login corporativo"}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Redefinir senha
        </Button>
      </div>
      <p className="border-rule bg-desk text-ink-3 flex items-center gap-2 border-t px-6 py-3.5 text-[14px]">
        <Mail className="size-4 shrink-0" aria-hidden="true" />A redefinição é feita pelo Portal do
        Colaborador, com validação no celular cadastrado para {email}.
      </p>
      <Dialog open={open} onOpenChange={setOpen} title="Redefinir senha">
        <div className="text-ink-2 space-y-3 text-sm leading-relaxed">
          {demo ? (
            <p>
              Neste ambiente de demonstração nenhuma senha é guardada nem verificada, então não há o
              que redefinir e nenhum e-mail será enviado.
            </p>
          ) : null}
          <p>
            Na Nexo, a senha da rede é redefinida no autoatendimento do Portal do Colaborador. Se
            não tiver um celular cadastrado, peça ajuda no chat de Atendimento ou ligue no ramal
            4000.
          </p>
        </div>
      </Dialog>
    </section>
  );
}
