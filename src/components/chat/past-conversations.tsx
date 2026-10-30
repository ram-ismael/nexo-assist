"use client";

import { ChevronRight, MessageSquareText, RotateCcw, X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { useCallback, useEffect, useState } from "react";
import type { ConversationState } from "@/domain/conversations";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatListTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/spinner";

export type PastItem = {
  id: string;
  state: ConversationState;
  lastMessagePreview: string | null;
  topic: string | null;
  lastActivityAt: string;
  closedAt: string | null;
};

function ListSkeleton() {
  return (
    <div className="space-y-1 px-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="space-y-2 px-3 py-3.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

/**
 * "Conversas anteriores": a right-hand drawer to pick one. Picking closes the
 * drawer and the conversation opens in the chat itself. Render it only while
 * open, so every opening starts from a fresh list.
 */
export function PastConversations({
  currentId,
  viewingId,
  timeZone,
  onClose,
  onPick,
}: {
  currentId: string | null;
  viewingId: string | null;
  timeZone: string;
  onClose: () => void;
  onPick: (item: PastItem) => void;
}) {
  const [items, setItems] = useState<PastItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    api<{ items: PastItem[] }>("/api/conversations")
      .then((result) => setItems(result.items))
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, []);

  useEffect(() => {
    let active = true;
    api<{ items: PastItem[] }>("/api/conversations")
      .then((result) => active && setItems(result.items))
      .catch((reason: unknown) => active && setError(errorMessage(reason)));
    return () => {
      active = false;
    };
  }, []);

  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="bg-navy/30 animate-fade fixed inset-0 z-40" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="animate-slide-in bg-paper fixed top-0 right-0 z-50 flex h-dvh w-full max-w-[440px] flex-col shadow-[0_20px_60px_rgba(27,36,49,0.25)] focus:outline-none"
        >
          <header className="border-rule flex min-h-[72px] items-center gap-2 border-b px-5 py-3">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="truncate text-[18px] font-semibold">
                Conversas anteriores
              </RadixDialog.Title>
              <p className="text-ink-3 truncate text-[13px]">
                {items
                  ? `${items.length} ${items.length === 1 ? "conversa" : "conversas"}`
                  : "Carregando…"}
              </p>
            </div>
            <RadixDialog.Close
              aria-label="Fechar"
              className="text-ink-2 hover:bg-desk rounded-md p-1.5 transition-colors"
            >
              <X className="size-5" />
            </RadixDialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            {error ? (
              <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <p className="text-danger-text text-[14px]">{error}</p>
                <Button size="sm" variant="secondary" onClick={load}>
                  <RotateCcw className="size-3.5" aria-hidden="true" /> Tentar de novo
                </Button>
              </div>
            ) : !items ? (
              <ListSkeleton />
            ) : items.length === 0 ? (
              <div className="text-ink-3 flex flex-col items-center gap-2 px-6 py-16 text-center">
                <MessageSquareText className="size-7" aria-hidden="true" />
                <p className="text-[15px]">Nenhuma conversa ainda.</p>
              </div>
            ) : (
              <ul className="px-2">
                {items.map((item) => {
                  const current = item.id === currentId;
                  const shown = item.id === (viewingId ?? currentId);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onPick(item)}
                        aria-current={shown ? "true" : undefined}
                        className={cn(
                          "border-rule group flex w-full items-center gap-3 rounded-lg border-b px-3 py-3.5 text-left transition-colors",
                          shown ? "bg-primary-soft/50" : "hover:bg-desk/70",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-[13px]">
                            <span className="text-ink-3">
                              {formatListTime(item.lastActivityAt, timeZone)}
                            </span>
                            <span
                              className={cn(
                                "rounded-full px-2 py-px text-[12px] font-medium",
                                current
                                  ? "bg-primary-soft text-primary-text"
                                  : "bg-desk text-ink-3",
                              )}
                            >
                              {current ? "Atual" : "Encerrada"}
                            </span>
                          </span>
                          <span className="text-ink mt-1 line-clamp-1 block text-[15px] font-medium">
                            {item.topic ?? "Conversa sem mensagens"}
                          </span>
                          {item.lastMessagePreview && item.lastMessagePreview !== item.topic ? (
                            <span className="text-ink-3 mt-0.5 line-clamp-1 block text-[14px]">
                              {item.lastMessagePreview}
                            </span>
                          ) : null}
                        </span>
                        <ChevronRight
                          className="text-ink-4 group-hover:text-ink-2 size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
