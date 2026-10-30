"use client";

import { ArrowDown, CheckCheck, Headset } from "lucide-react";
import { Fragment, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MessageDTO } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { dayLabel, formatTime, isSameDay } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Spinner, TypingDots } from "@/components/ui/spinner";
import { ActionTrail } from "./action-trail";
import { HandoffLine, InlineBlocks, WideBlocks, type BlockHandlers } from "./blocks";
import type { PendingTurn } from "./use-chat";

type Viewer = "employee" | "analyst";

const NEAR_TOP_PX = 120;
const NEAR_BOTTOM_PX = 160;

function SystemLine({ message, timeZone }: { message: MessageDTO; timeZone: string }) {
  const handoff = message.blocks.find((block) => block.type === "handoff");
  const notice = message.blocks.find((block) => block.type === "notice");
  if (notice && !handoff) {
    return (
      <div
        role="note"
        className="border-danger/25 bg-danger-soft text-danger-text mx-auto max-w-[640px] rounded-lg border px-4 py-2.5 text-center text-[14px]"
      >
        {message.content}. {notice.type === "notice" ? notice.text : null}
      </div>
    );
  }
  return (
    <div className="text-ink-3 flex items-center gap-3 text-[13px]" role="note">
      <span className="bg-rule h-px flex-1" />
      <span className="inline-flex items-center gap-2 text-center">
        {handoff && handoff.type === "handoff" ? (
          <HandoffLine block={handoff} timeZone={timeZone} />
        ) : (
          <>
            {message.content.includes("assumiu") ? (
              <Headset className="size-4" aria-hidden="true" />
            ) : null}
            {message.content}
          </>
        )}
        <span className="text-ink-4">· {formatTime(message.createdAt, timeZone)}</span>
      </span>
      <span className="bg-rule h-px flex-1" />
    </div>
  );
}

function EmployeeViewMessage({
  message,
  viewer,
  timeZone,
  handlers,
}: {
  message: MessageDTO;
  viewer: Viewer;
  timeZone: string;
  handlers: BlockHandlers;
}) {
  if (message.kind === "employee") {
    return (
      <div className="flex justify-end">
        <p className="bg-navy max-w-[min(560px,85%)] rounded-[14px] rounded-br-md px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-white sm:text-[16px]">
          {message.content}
        </p>
      </div>
    );
  }
  if (message.kind === "system") return <SystemLine message={message} timeZone={timeZone} />;
  const isAnalyst = message.kind === "analyst";
  const hasWide = message.blocks.some((block) =>
    ["ticket_card", "ticket_selection", "draft"].includes(block.type),
  );
  const hasInline = message.blocks.some((block) =>
    ["quick_replies", "knowledge", "notice"].includes(block.type),
  );
  return (
    <div className="flex flex-col items-start gap-2.5">
      {isAnalyst ? (
        <p className="flex items-center gap-2 text-[14px]">
          <span className="text-ink font-semibold">{message.sender?.name ?? "Analista"}</span>
          <span className="bg-success-soft text-success-text rounded px-1.5 text-[12px] font-medium">
            {message.sender?.supportLevel ?? "Service desk"}
          </span>
          <span className="text-ink-4">{formatTime(message.createdAt, timeZone)}</span>
        </p>
      ) : (
        <ActionTrail actions={message.actions} turnId={message.turnId} viewer={viewer} />
      )}
      {message.content || hasInline ? (
        <div
          className={cn(
            "max-w-[min(780px,100%)] rounded-[14px] border px-5 py-4 text-[15px] leading-relaxed sm:text-[16px]",
            isAnalyst ? "border-success/25 bg-analyst-bubble" : "border-rule bg-paper",
          )}
        >
          {message.content ? (
            <p className="text-ink whitespace-pre-wrap">{message.content}</p>
          ) : null}
          <InlineBlocks message={message} handlers={handlers} />
        </div>
      ) : null}
      {hasWide ? (
        <div className="flex w-full flex-col gap-3">
          <WideBlocks message={message} handlers={handlers} timeZone={timeZone} />
        </div>
      ) : null}
    </div>
  );
}

function ConsoleViewMessage({ message, timeZone }: { message: MessageDTO; timeZone: string }) {
  const noop: BlockHandlers = { onChanged: () => undefined };
  if (message.kind === "system") return <SystemLine message={message} timeZone={timeZone} />;
  if (message.kind === "employee") {
    return (
      <div className="flex justify-start">
        <p className="bg-paper text-ink max-w-[min(520px,85%)] rounded-xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-[0_1px_2px_rgba(27,36,49,0.06)]">
          {message.content}
          <span className="text-ink-4 ml-3 align-bottom text-[12px]">
            {formatTime(message.createdAt, timeZone)}
          </span>
        </p>
      </div>
    );
  }
  const isAnalyst = message.kind === "analyst";
  return (
    <div className="flex flex-col items-end gap-1.5">
      {isAnalyst ? (
        <p className="flex items-center gap-2 text-[14px]">
          <span className="text-ink-2 font-medium">{message.sender?.name ?? "Analista"}</span>
          <span className="bg-success-soft text-success-text rounded px-1.5 text-[12px] font-semibold">
            {message.sender?.supportLevel ?? "Service desk"}
          </span>
        </p>
      ) : (
        <ActionTrail
          actions={message.actions}
          turnId={message.turnId}
          viewer="analyst"
          name="Nexo Assist"
          align="right"
        />
      )}
      {message.content ? (
        <div
          className={cn(
            "max-w-[min(600px,90%)] rounded-xl px-4 py-3 text-[15px] leading-relaxed shadow-[0_1px_2px_rgba(27,36,49,0.06)]",
            isAnalyst ? "bg-analyst-bubble" : "bg-agent-bubble",
          )}
        >
          <p className="text-ink whitespace-pre-wrap">{message.content}</p>
          <InlineBlocks message={message} handlers={noop} />
          <p className="text-ink-4 mt-1 flex items-center justify-end gap-1 text-[12px]">
            {formatTime(message.createdAt, timeZone)}
            <CheckCheck className="text-primary size-3.5" aria-label="entregue" />
          </p>
        </div>
      ) : null}
      {message.blocks.some((block) =>
        ["ticket_card", "ticket_selection", "draft"].includes(block.type),
      ) ? (
        <div className="flex w-full max-w-[640px] flex-col gap-2 opacity-95">
          <WideBlocks message={message} handlers={noop} timeZone={timeZone} />
        </div>
      ) : null}
    </div>
  );
}

function PendingReply({ pending }: { pending: PendingTurn }) {
  return (
    <>
      {pending.text && !pending.accepted ? (
        <div className="animate-rise flex flex-col items-end gap-1">
          <p className="bg-navy/75 max-w-[min(560px,85%)] rounded-[14px] rounded-br-md px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-white sm:text-[16px]">
            {pending.text}
          </p>
          <span className="text-ink-4 text-[12px]" role="status">
            Enviando…
          </span>
        </div>
      ) : null}
      {pending.toAgent ? (
        <div className="flex flex-col items-start gap-2.5" aria-live="polite">
          <ActionTrail actions={pending.actions} turnId={null} viewer="employee" />
          <div className="animate-rise border-rule bg-paper max-w-[min(780px,100%)] rounded-[14px] border px-5 py-4 text-[15px] leading-relaxed sm:text-[16px]">
            {pending.reply ? (
              <p className="text-ink whitespace-pre-wrap">{pending.reply}</p>
            ) : (
              <TypingDots
                label={
                  pending.accepted
                    ? "Nexo Assist está analisando sua mensagem"
                    : "Enviando sua mensagem"
                }
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Reversed infinite history: opens at the latest page, fetches older pages as
 * the reader scrolls up and keeps the visible message anchored while prepending.
 */
export function MessageList({
  messages,
  viewer,
  layout,
  timeZone,
  hasMoreBefore,
  loadingOlder,
  olderError,
  onLoadOlder,
  handlersFor,
  pending,
  outgoing,
  empty,
  footer,
}: {
  messages: MessageDTO[];
  viewer: Viewer;
  layout: "employee" | "console";
  timeZone: string;
  hasMoreBefore: boolean;
  loadingOlder: boolean;
  olderError: string | null;
  onLoadOlder: () => void;
  handlersFor: (message: MessageDTO, isLast: boolean) => BlockHandlers;
  pending?: PendingTurn | null;
  /** Console: the analyst's reply between send and server confirmation. */
  outgoing?: string | null;
  empty?: ReactNode;
  footer?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const firstSeq = messages[0]?.seq;
  const lastSeq = messages[messages.length - 1]?.seq;
  const previous = useRef<{ first?: number; last?: number; count: number }>({ count: 0 });
  const [unseen, setUnseen] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  // Only messages that arrive while the list is open animate in; the history
  // present at mount and older pages loaded on scroll appear in place.
  const [animateAfter] = useState(() => lastSeq ?? 0);
  const ownKind = viewer === "employee" ? "employee" : "analyst";

  const scrollToBottom = useCallback((smooth = false) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setUnseen(0);
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const before = previous.current;
    if (
      anchor.current &&
      firstSeq !== undefined &&
      before.first !== undefined &&
      firstSeq < before.first
    ) {
      // Older page prepended: keep the reader exactly where they were.
      element.scrollTop = element.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    } else if (before.count === 0 && messages.length > 0) {
      element.scrollTop = element.scrollHeight;
    } else if (lastSeq !== undefined && lastSeq !== before.last) {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      const mine =
        messages[messages.length - 1]?.kind === (viewer === "employee" ? "employee" : "analyst");
      if (distance < NEAR_BOTTOM_PX + 400 || mine) element.scrollTop = element.scrollHeight;
      else setUnseen((count) => count + 1);
    }
    previous.current = { first: firstSeq, last: lastSeq, count: messages.length };
  }, [firstSeq, lastSeq, messages, viewer]);

  // Keep following the streamed answer while the reader is at the bottom.
  useLayoutEffect(() => {
    if (pending && atBottom) scrollToBottom();
  }, [pending, atBottom, scrollToBottom]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    setAtBottom(distance < NEAR_BOTTOM_PX);
    if (distance < NEAR_BOTTOM_PX && unseen > 0) setUnseen(0);
    if (element.scrollTop < NEAR_TOP_PX && hasMoreBefore && !loadingOlder && !olderError) {
      anchor.current = { height: element.scrollHeight, top: element.scrollTop };
      onLoadOlder();
    }
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className={cn(
          "h-full overflow-y-auto overscroll-contain",
          layout === "console" ? "bg-chat" : "bg-paper",
        )}
        role="log"
        aria-label="Mensagens da conversa"
        aria-busy={loadingOlder}
      >
        <div
          className={cn(
            "mx-auto flex w-full flex-col",
            layout === "employee"
              ? "max-w-[1120px] gap-6 px-4 pt-8 pb-6 sm:px-8 lg:pr-12 lg:pl-[17%]"
              : "gap-4 px-4 py-6 sm:px-10",
          )}
        >
          {hasMoreBefore || loadingOlder || olderError ? (
            <div className="text-ink-3 flex justify-center py-1 text-[13px]">
              {loadingOlder ? (
                <Spinner label="Carregando mensagens anteriores" />
              ) : olderError ? (
                <span className="text-danger-text flex items-center gap-2">
                  {olderError}
                  <Button size="sm" variant="secondary" onClick={onLoadOlder}>
                    Tentar de novo
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={onLoadOlder}>
                  Carregar mensagens anteriores
                </Button>
              )}
            </div>
          ) : messages.length > 0 ? (
            <p className="text-ink-4 text-center text-[12px]">Início da conversa</p>
          ) : null}
          {messages.length === 0 && !pending ? empty : null}
          {messages.map((message, index) => {
            const previousMessage = messages[index - 1];
            const newDay =
              !previousMessage ||
              !isSameDay(previousMessage.createdAt, message.createdAt, timeZone);
            const isLast = index === messages.length - 1;
            return (
              <Fragment key={message.id}>
                {newDay && layout === "console" ? (
                  <p className="bg-paper text-ink-3 mx-auto rounded-full px-3 py-1 text-[13px] shadow-[0_1px_2px_rgba(27,36,49,0.06)]">
                    {dayLabel(message.createdAt, timeZone)}
                  </p>
                ) : newDay && index > 0 ? (
                  <p className="text-ink-4 text-center text-[12px]">
                    {dayLabel(message.createdAt, timeZone)}
                  </p>
                ) : null}
                {/* Own messages were already on screen as "Enviando…": no second entrance. */}
                <div
                  className={
                    message.seq > animateAfter && message.kind !== ownKind
                      ? "animate-rise"
                      : undefined
                  }
                >
                  {layout === "employee" ? (
                    <EmployeeViewMessage
                      message={message}
                      viewer={viewer}
                      timeZone={timeZone}
                      handlers={handlersFor(message, isLast)}
                    />
                  ) : (
                    <ConsoleViewMessage message={message} timeZone={timeZone} />
                  )}
                </div>
              </Fragment>
            );
          })}
          {pending ? <PendingReply pending={pending} /> : null}
          {outgoing ? (
            <div className="animate-rise flex flex-col items-end gap-1">
              <p className="bg-analyst-bubble/70 text-ink max-w-[min(600px,90%)] rounded-xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                {outgoing}
              </p>
              <span className="text-ink-4 text-[12px]" role="status">
                Enviando…
              </span>
            </div>
          ) : null}
          {footer}
        </div>
      </div>
      {unseen > 0 && !atBottom ? (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="animate-rise bg-navy absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium text-white shadow-lg"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
          {unseen === 1 ? "Nova mensagem" : `${unseen} novas mensagens`}
        </button>
      ) : null}
    </div>
  );
}
