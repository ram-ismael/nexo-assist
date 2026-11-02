"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { MessagePageDTO } from "@/lib/api-types";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EMPLOYEE_COLUMN, MessageList, MessagesError, MessagesSkeleton } from "./message-list";
import type { PastItem } from "./past-conversations";

const NO_HANDLERS = () => ({ onChanged: () => undefined });

/**
 * A previous conversation shown in the chat area itself, read-only, with a
 * way back to the current one (button or Esc). Keyed by conversation id by
 * the caller, so switching conversations starts from a clean state.
 */
export function PastConversationView({
  item,
  timeZone,
  onBack,
}: {
  item: PastItem;
  timeZone: string;
  onBack: () => void;
}) {
  const [page, setPage] = useState<MessagePageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<MessagePageDTO>(`/api/conversations/${item.id}/messages?limit=50`)
      .then((result) => active && setPage(result))
      .catch((reason: unknown) => active && setError(errorMessage(reason)));
    return () => {
      active = false;
    };
  }, [item.id, attempt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const loadOlder = useCallback(async () => {
    const first = page?.messages[0];
    if (!page || !first || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const older = await api<MessagePageDTO>(
        `/api/conversations/${item.id}/messages?before=${first.seq}&limit=30`,
      );
      setPage((current) =>
        current
          ? {
              ...current,
              messages: [...older.messages, ...current.messages],
              hasMoreBefore: older.hasMoreBefore,
            }
          : current,
      );
    } catch (reason) {
      setOlderError(errorMessage(reason));
    } finally {
      setLoadingOlder(false);
    }
  }, [item.id, page, loadingOlder]);

  return (
    <>
      {error ? (
        <MessagesError
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        />
      ) : !page ? (
        <MessagesSkeleton layout="employee" />
      ) : (
        <MessageList
          messages={page.messages}
          viewer="employee"
          layout="employee"
          timeZone={timeZone}
          hasMoreBefore={page.hasMoreBefore}
          loadingOlder={loadingOlder}
          olderError={olderError}
          onLoadOlder={() => void loadOlder()}
          handlersFor={NO_HANDLERS}
          empty={<p className="text-ink-3 py-10 text-center text-[14px]">Sem mensagens.</p>}
        />
      )}

      {/* Same column and place as the composer of the current conversation. */}
      <div className="shrink-0 [scrollbar-gutter:stable_both-edges] overflow-hidden pb-4">
        <div className={EMPLOYEE_COLUMN}>
          <div className="border-rule bg-desk flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-[15px]">
            <span className="text-ink-2">
              Conversa encerrada · {formatDateTime(item.closedAt ?? item.lastActivityAt, timeZone)}
            </span>
            <Button onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden="true" /> Voltar para a conversa atual
            </Button>
          </div>
          <p className="text-ink-3 mt-2 text-right text-[13px]">Somente leitura</p>
        </div>
      </div>
    </>
  );
}
