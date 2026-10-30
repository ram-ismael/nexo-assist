"use client";

import { Dialog as RadixDialog } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  side = "center",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  side?: "center" | "right";
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="animate-fade bg-navy/40 fixed inset-0 z-40" />
        <RadixDialog.Content
          className={cn(
            "bg-paper fixed z-50 flex flex-col shadow-[0_20px_60px_rgba(27,36,49,0.25)] focus:outline-none",
            side === "center"
              ? "animate-rise top-1/2 left-1/2 max-h-[90dvh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl"
              : "animate-fade top-0 right-0 h-dvh w-full max-w-md",
            className,
          )}
        >
          <div className="border-rule flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <RadixDialog.Title className="text-ink text-base font-semibold">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="text-ink-3 mt-0.5 text-sm">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              className="text-ink-3 hover:bg-desk hover:text-ink -mr-1 rounded-md p-1 transition-colors"
              aria-label="Fechar"
            >
              <X className="size-5" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
