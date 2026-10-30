"use client";

import { KeyRound, Mail, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Password management is owned by corporate IT (directory/SSO): this app
 * stores no password and sends no e-mail, so the card says where the reset
 * really happens instead of pretending to send a link.
 */
export function CredentialsCard({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-rule mt-8 overflow-hidden rounded-xl border shadow-[0_1px_3px_rgba(27,36,49,0.06)]">
      <div className="flex flex-wrap items-center gap-4 px-6 py-5">
        <span className="bg-desk text-ink-2 flex size-12 items-center justify-center rounded-full">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-medium">Senha</h2>
          <p className="text-ink-3 text-[15px]">Gerenciada pela TI da Nexo</p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Redefinir senha
        </Button>
      </div>
      <p className="border-rule bg-desk text-ink-3 flex items-center gap-2 border-t px-6 py-3.5 text-[14px]">
        <Mail className="size-4 shrink-0" aria-hidden="true" />O link de redefinição é enviado pelo
        Portal do Colaborador para {email}.
      </p>
      <Dialog open={open} onOpenChange={setOpen} title="Redefinir senha">
        <div className="text-ink-2 space-y-3 text-sm leading-relaxed">
          <p>
            Na Nexo, a senha da rede é redefinida no autoatendimento do Portal do Colaborador: peça
            a redefinição por lá e o link chega em <strong className="text-ink">{email}</strong>.
          </p>
          <p>
            Sem acesso ao e-mail? Peça ajuda no chat de Atendimento ou ligue no ramal 4000 (seg. a
            sex., 8h às 18h).
          </p>
        </div>
      </Dialog>
    </section>
  );
}
