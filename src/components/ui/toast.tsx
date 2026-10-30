"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; text: string };

const ToastContext = createContext<((tone: Tone, text: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)),
    [],
  );
  const push = useCallback(
    (tone: Tone, text: string) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((list) => [...list.slice(-2), { id, tone, text }]);
      setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2"
      >
        {toasts.map((toast) => {
          const Icon =
            toast.tone === "success" ? CircleCheck : toast.tone === "error" ? CircleAlert : Info;
          return (
            <div
              key={toast.id}
              role={toast.tone === "error" ? "alert" : "status"}
              className={cn(
                "animate-rise bg-paper pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm shadow-[0_8px_24px_rgba(27,36,49,0.12)]",
                toast.tone === "error" ? "border-danger/30" : "border-rule",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  toast.tone === "success"
                    ? "text-success-text"
                    : toast.tone === "error"
                      ? "text-danger-text"
                      : "text-primary-text",
                )}
                aria-hidden="true"
              />
              <p className="text-ink flex-1">{toast.text}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="text-ink-4 hover:text-ink rounded p-0.5"
                aria-label="Fechar aviso"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast precisa de ToastProvider");
  return push;
}
