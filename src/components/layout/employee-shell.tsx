"use client";

import { ChevronRight, LogOut, Menu, MessageSquare, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { ToastProvider } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type ShellUser = { name: string; email: string };

const MobileMenuContext = createContext<(() => void) | null>(null);

const NAV = [
  { href: "/atendimento", label: "Atendimento", icon: MessageSquare },
  { href: "/perfil", label: "Meu perfil", icon: User },
];

export function useLogout() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return {
    pending,
    logout: async () => {
      setPending(true);
      try {
        await api("/api/auth/logout", { method: "POST" });
      } finally {
        router.replace("/entrar");
        router.refresh();
      }
    },
  };
}

function subscribeConnection(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser's real connection state: green dot online, grey when it drops. */
function useConnected(): boolean {
  return useSyncExternalStore(
    subscribeConnection,
    () => navigator.onLine,
    () => true,
  );
}

function SidebarContent({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { logout, pending } = useLogout();
  const connected = useConnected();
  return (
    <div className="flex h-full flex-col px-4 py-5">
      <Link href="/atendimento" onClick={onNavigate} className="self-start px-3">
        <Logo className="h-5" />
      </Link>
      <nav aria-label="Principal" className="mt-8 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors",
                active
                  ? "bg-primary-soft text-primary-text font-medium"
                  : "text-ink-2 hover:bg-desk",
              )}
            >
              <Icon className="size-[19px]" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-rule mt-auto border-t pt-4">
        <div className="flex items-center gap-3 px-1">
          <Avatar name={user.name} online={connected} />
          <div className="min-w-0">
            <p className="text-ink truncate text-[15px] font-medium">{user.name}</p>
            <p className="text-ink-3 truncate text-[13px]">
              {connected ? user.email : "Sem conexão"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          disabled={pending}
          className="text-ink-2 hover:bg-danger-soft hover:text-danger-text focus-visible:bg-danger-soft mt-3 flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[15px] transition-colors disabled:opacity-60"
        >
          <LogOut className="size-[18px]" aria-hidden="true" />
          {pending ? "Saindo…" : "Sair"}
        </button>
      </div>
    </div>
  );
}

export function EmployeeShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <ToastProvider>
      <div className="bg-paper flex h-dvh overflow-hidden">
        <aside className="border-rule hidden w-[280px] shrink-0 border-r lg:block">
          <SidebarContent user={user} />
        </aside>
        {open ? (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <button
              type="button"
              aria-label="Fechar menu"
              className="animate-fade bg-navy/40 absolute inset-0"
              onClick={() => setOpen(false)}
            />
            <aside className="animate-rise bg-paper relative h-full w-[min(280px,85vw)] shadow-xl">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="text-ink-3 hover:bg-desk absolute top-4 right-3 rounded-md p-1.5"
              >
                <X className="size-5" />
              </button>
              <SidebarContent user={user} onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileMenuContext value={() => setOpen(true)}>{children}</MobileMenuContext>
        </div>
      </div>
    </ToastProvider>
  );
}

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  const openMenu = useContext(MobileMenuContext);
  return (
    <header className="border-rule flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-8 lg:px-11">
      <div className="flex min-w-0 items-center gap-2">
        {openMenu ? (
          <button
            type="button"
            onClick={openMenu}
            aria-label="Abrir menu"
            className="text-ink-2 hover:bg-desk -ml-1 rounded-md p-1.5 lg:hidden"
          >
            <Menu className="size-5" />
          </button>
        ) : null}
        <nav aria-label="Trilha" className="flex min-w-0 items-center gap-2 text-[15px]">
          <span className="text-ink-3 hidden sm:inline">Service desk de TI</span>
          <ChevronRight className="text-ink-4 hidden size-4 sm:inline" aria-hidden="true" />
          <span className="text-ink truncate font-medium">{title}</span>
        </nav>
      </div>
      {right}
    </header>
  );
}
