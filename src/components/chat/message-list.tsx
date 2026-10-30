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

// One shape language for every bubble: soft 18px corners, a 6px "tail" corner
// on the sender's side, a hairline shadow. Live states reuse the same classes
// so nothing changes shape when the real message replaces them.
export const BUBBLE = {
  base: "rounded-[18px] text-[15px] leading-[1.6] sm:text-[16px]",
  mine: "rounded-br-[6px] bg-navy px-4 py-2.5 text-white shadow-[0_1px_2px_rgba(27,36,49,0.18)]",
  agent:
    "rounded-tl-[6px] border border-rule bg-paper px-[18px] py-3 shadow-[0_1px_2px_rgba(27,36,49,0.05)]",
  analyst:
    "rounded-tl-[6px] border border-success/20 bg-analyst-bubble px-[18px] py-3 shadow-[0_1px_2px_rgba(27,36,49,0.05)]",
};

/**
 * The employee chat is one centered column shared by the messages, the
 * composer and the session counter, so every edge lines up (reference T2).
 */
export const EMPLOYEE_COLUMN = "mx-auto w-full max-w-[960px] px-4 sm:px-8";

const CONSOLE_BUBBLE = {
  base: "rounded-[16px] text-[15px] leading-[1.55] shadow-[0_1px_2px_rgba(27,36,49,0.07)]",
  employee: "rounded-tl-[6px] bg-paper px-4 py-2.5 text-ink",
  agent: "rounded-tr-[6px] bg-agent-bubble px-4 py-3",
  analyst: "rounded-tr-[6px] bg-analyst-bubble px-4 py-3",
};

/** Same person, a few minutes apart: shown as one block, without repeating the name. */
function continues(previous: MessageDTO | undefined, message: MessageDTO): boolean {
  if (!previous || previous.kind !== message.kind) return false;
  if (message.kind !== "employee" && message.kind !== "analyst") return false;
  if (previous.sender?.name !== message.sender?.name) return false;
  return Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000;
}

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
  grouped,
  followed,
}: {
  message: MessageDTO;
  viewer: Viewer;
  timeZone: string;
  handlers: BlockHandlers;
  /** Continues the previous message of the same person (no name, no top tail). */
  grouped: boolean;
  /** The same person's next message continues this one (no bottom tail). */
  followed: boolean;
}) {
  if (message.kind === "employee") {
    return (
      <div className="flex justify-end">
        <p
          title={formatTime(message.createdAt, timeZone)}
          className={cn(
            BUBBLE.base,
            BUBBLE.mine,
            // In a run of messages only the last one keeps the tail.
            followed && "rounded-br-[18px]",
            "max-w-[min(620px,80%)] [overflow-wrap:anywhere] whitespace-pre-wrap",
          )}
        >
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
    <div className="flex flex-col items-start gap-2">
      {isAnalyst ? (
        grouped ? null : (
          <p className="flex items-center gap-2 text-[14px]">
            <span className="text-ink font-semibold">{message.sender?.name ?? "Analista"}</span>
            <span className="bg-success-soft text-success-text rounded px-1.5 text-[12px] font-medium">
              {message.sender?.supportLevel ?? "Service desk"}
            </span>
            <span className="text-ink-4">{formatTime(message.createdAt, timeZone)}</span>
          </p>
        )
      ) : (
        <ActionTrail actions={message.actions} turnId={message.turnId} viewer={viewer} />
      )}
      {message.content || hasInline ? (
        <div
          title={formatTime(message.createdAt, timeZone)}
          className={cn(
            BUBBLE.base,
            isAnalyst ? BUBBLE.analyst : BUBBLE.agent,
            // In a run of messages only the first one (under the name) keeps the tail.
            grouped && "rounded-tl-[18px]",
            "max-w-[min(680px,88%)]",
          )}
        >
          {message.content ? (
            <p className="text-ink [overflow-wrap:anywhere] whitespace-pre-wrap">
              {message.content}
            </p>
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

function ConsoleViewMessage({
  message,
  timeZone,
  grouped,
}: {
  message: MessageDTO;
  timeZone: string;
  grouped: boolean;
}) {
  const noop: BlockHandlers = { onChanged: () => undefined };
  if (message.kind === "system") return <SystemLine message={message} timeZone={timeZone} />;
  if (message.kind === "employee") {
    return (
      <div className="flex justify-start">
        <p
          className={cn(
            CONSOLE_BUBBLE.base,
            CONSOLE_BUBBLE.employee,
            grouped && "rounded-tl-[16px]",
            "max-w-[min(520px,85%)] [overflow-wrap:anywhere] whitespace-pre-wrap",
          )}
        >
          {message.content}
          <span className="text-ink-4 float-right mt-1.5 ml-3 text-[12px] leading-none">
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
        grouped ? null : (
          <p className="flex items-center gap-2 text-[14px]">
            <span className="text-ink-2 font-medium">{message.sender?.name ?? "Analista"}</span>
            <span className="bg-success-soft text-success-text rounded px-1.5 text-[12px] font-semibold">
              {message.sender?.supportLevel ?? "Service desk"}
            </span>
          </p>
        )
      ) : (
        <ActionTrail
          actions={message.actions}
          turnId={message.turnId}
          viewer="analyst"
          name="Nexo Assist"
          badge="IA"
          align="right"
        />
      )}
      {message.content ? (
        <div
          className={cn(
            CONSOLE_BUBBLE.base,
            isAnalyst ? CONSOLE_BUBBLE.analyst : CONSOLE_BUBBLE.agent,
            grouped && "rounded-tr-[16px]",
            "max-w-[min(600px,90%)]",
          )}
        >
          <p className="text-ink [overflow-wrap:anywhere] whitespace-pre-wrap">{message.content}</p>
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
          <p
            className={cn(
              BUBBLE.base,
              BUBBLE.mine,
              "max-w-[min(620px,80%)] [overflow-wrap:anywhere] whitespace-pre-wrap opacity-70",
            )}
          >
            {pending.text}
          </p>
          <span className="text-ink-4 text-[12px]" role="status">
            Enviando…
          </span>
        </div>
      ) : null}
      {pending.toAgent ? (
        // aria-busy: screen readers get the finished answer once, not every token.
        <div className="flex flex-col items-start gap-2" aria-busy="true">
          <ActionTrail actions={pending.actions} turnId={null} viewer="employee" />
          <div
            className={cn(
              "animate-rise max-w-[min(680px,88%)]",
              BUBBLE.base,
              BUBBLE.agent,
              !pending.reply && "flex h-12 items-center",
            )}
          >
            {pending.reply ? (
              <p className="text-ink [overflow-wrap:anywhere] whitespace-pre-wrap">
                {pending.reply}
                <span
                  aria-hidden="true"
                  className="animate-caret bg-primary ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] rounded-full"
                />
              </p>
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
  inPlace,
  typing,
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
  /** Messages that replace a bubble already on screen (a streamed answer). */
  inPlace?: (message: MessageDTO) => boolean;
  /** "Está escrevendo…" bubble, shown after the last message. */
  typing?: ReactNode;
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

  // Keep following the streamed answer (and a typing bubble that appears)
  // while the reader is at the bottom; never pull someone reading history.
  const showsTyping = !!typing;
  useLayoutEffect(() => {
    if ((pending || showsTyping) && atBottom) scrollToBottom();
  }, [pending, showsTyping, atBottom, scrollToBottom]);

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
          // Same gutter on both sides: the column stays centred like the composer below.
          "h-full [scrollbar-gutter:stable_both-edges] overflow-y-auto overscroll-contain",
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
              ? `${EMPLOYEE_COLUMN} gap-6 pt-8 pb-6`
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
            const grouped = continues(previousMessage, message) && !newDay;
            const nextMessage = messages[index + 1];
            const followed =
              !!nextMessage &&
              continues(message, nextMessage) &&
              isSameDay(message.createdAt, nextMessage.createdAt, timeZone);
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
                  className={cn(
                    message.seq > animateAfter &&
                      message.kind !== ownKind &&
                      !inPlace?.(message) &&
                      "animate-rise",
                    // A follow-up from the same person sits close to the previous one.
                    grouped && (layout === "employee" ? "-mt-4" : "-mt-2.5"),
                  )}
                >
                  {layout === "employee" ? (
                    <EmployeeViewMessage
                      message={message}
                      viewer={viewer}
                      timeZone={timeZone}
                      handlers={handlersFor(message, isLast)}
                      grouped={grouped}
                      followed={followed}
                    />
                  ) : (
                    <ConsoleViewMessage message={message} timeZone={timeZone} grouped={grouped} />
                  )}
                </div>
              </Fragment>
            );
          })}
          {pending ? <PendingReply pending={pending} /> : null}
          {typing}
          {outgoing ? (
            <div className="animate-rise flex flex-col items-end gap-1">
              <p
                className={cn(
                  CONSOLE_BUBBLE.base,
                  CONSOLE_BUBBLE.analyst,
                  "text-ink max-w-[min(600px,90%)] whitespace-pre-wrap opacity-70",
                )}
              >
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
