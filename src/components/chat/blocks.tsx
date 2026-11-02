"use client";

import { ArrowLeftRight, BookOpen, CircleAlert, Info } from "lucide-react";
import { useState } from "react";
import type { MessageBlock, MessageDTO } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { formatDay, untilLabel } from "@/lib/format";
import { Dialog } from "@/components/ui/dialog";
import { Dot, statusDotClass } from "@/components/ui/status";
import { STATUS_LABEL } from "@/domain/tickets";
import { api, errorMessage } from "@/lib/api-client";
import { TicketCard } from "@/components/tickets/ticket-card";
import { DraftCard } from "./draft-card";

export type BlockHandlers = {
  /** Present only for the employee on the latest message: blocks become interactive. */
  onReply?: (text: string) => void;
  onChanged: () => Promise<void> | void;
};

function QuickReplies({
  block,
  onReply,
}: {
  block: Extract<MessageBlock, { type: "quick_replies" }>;
  onReply?: (text: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <div className="mt-4">
      {block.question ? (
        <p className="text-ink mb-3 text-[15px] font-semibold">{block.question}</p>
      ) : null}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={block.question ?? "Respostas rápidas"}
      >
        {block.options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={!onReply || chosen !== null}
            onClick={() => {
              setChosen(option);
              onReply?.(option);
            }}
            className={cn(
              "h-10 rounded-lg border px-4 text-[15px] transition-colors disabled:cursor-default",
              chosen === option
                ? "border-primary bg-primary-soft text-primary-text"
                : "border-rule bg-paper text-ink enabled:hover:border-primary-line enabled:hover:bg-primary-soft disabled:opacity-60",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function TicketSelection({
  block,
  timeZone,
  onReply,
}: {
  block: Extract<MessageBlock, { type: "ticket_selection" }>;
  timeZone: string;
  onReply?: (text: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    // min-w-0: a fieldset defaults to min-content width and would overflow narrow columns.
    <fieldset className="border-rule bg-paper w-full min-w-0 overflow-hidden rounded-xl border shadow-[0_2px_8px_rgba(27,36,49,0.06)]">
      <legend className="sr-only">{block.prompt}</legend>
      {block.tickets.map((ticket, index) => {
        const selected = chosen === ticket.number;
        return (
          <label
            key={ticket.number}
            className={cn(
              "flex items-center gap-4 px-5 py-4 transition-colors",
              index > 0 && "border-rule border-t",
              selected
                ? "bg-primary-soft/60"
                : onReply && !chosen
                  ? "hover:bg-desk cursor-pointer"
                  : "",
            )}
          >
            <input
              type="radio"
              name={`selection-${block.tickets[0]?.number}`}
              className="accent-cta size-[18px]"
              checked={selected}
              disabled={!onReply || chosen !== null}
              onChange={() => {
                setChosen(ticket.number);
                onReply?.(`${ticket.number} · ${ticket.title}`);
              }}
            />
            <span className="text-ink-3 w-[88px] shrink-0 text-[14px]">{ticket.number}</span>
            <span className="text-ink min-w-0 flex-1 truncate text-[15px] font-medium">
              {ticket.title}
            </span>
            <span className="text-ink-2 hidden shrink-0 items-center gap-1.5 text-[14px] whitespace-nowrap sm:inline-flex">
              <Dot className={statusDotClass(ticket.status)} />
              {STATUS_LABEL[ticket.status]}
              {ticket.overdue ? <span className="text-warning-text">· vencido</span> : null}
            </span>
            <span className="text-ink-3 hidden w-14 text-right text-[14px] sm:block">
              {formatDay(ticket.updatedAt, timeZone)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function KnowledgeRefs({ block }: { block: Extract<MessageBlock, { type: "knowledge" }> }) {
  const [article, setArticle] = useState<{
    id: string;
    title: string;
    body: string;
    platforms: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function open(id: string) {
    setError(null);
    try {
      setArticle(await api(`/api/knowledge/${id}`));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  return (
    <div className="text-ink-3 mt-3 flex flex-wrap items-center gap-2 text-[13px]">
      <BookOpen className="size-3.5" aria-hidden="true" />
      <span>Fontes:</span>
      {block.articles.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => open(item.id)}
          className="border-rule text-ink-2 hover:border-primary-line hover:text-primary-text rounded border px-1.5 py-0.5"
        >
          {item.id} · {item.title}
        </button>
      ))}
      {error ? <span className="text-danger-text">{error}</span> : null}
      {article ? (
        <Dialog
          open
          onOpenChange={(value) => !value && setArticle(null)}
          title={article.title}
          description={`Central de ajuda · ${article.id}`}
        >
          <p className="text-ink-2 text-[15px] leading-relaxed">{article.body}</p>
          {article.platforms.length > 0 ? (
            <p className="text-ink-3 mt-3 text-sm">Vale para: {article.platforms.join(", ")}</p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

/** Blocks rendered inside the agent bubble (questions, sources, notices). */
export function InlineBlocks({
  message,
  handlers,
}: {
  message: MessageDTO;
  handlers: BlockHandlers;
}) {
  return (
    <>
      {message.blocks.map((block, index) => {
        if (block.type === "quick_replies")
          return <QuickReplies key={index} block={block} onReply={handlers.onReply} />;
        if (block.type === "knowledge") return <KnowledgeRefs key={index} block={block} />;
        if (block.type === "notice") {
          const Icon = block.tone === "error" ? CircleAlert : Info;
          return (
            <p
              key={index}
              className={cn(
                "mt-3 flex items-center gap-2 text-[14px]",
                block.tone === "error"
                  ? "text-danger-text"
                  : block.tone === "warning"
                    ? "text-warning-text"
                    : "text-ink-3",
              )}
            >
              <Icon className="size-4" aria-hidden="true" /> {block.text}
            </p>
          );
        }
        return null;
      })}
    </>
  );
}

/** Wide blocks rendered below the bubble (cards, lists). */
export function WideBlocks({
  message,
  handlers,
  timeZone,
}: {
  message: MessageDTO;
  handlers: BlockHandlers;
  timeZone: string;
}) {
  return (
    <>
      {message.blocks.map((block, index) => {
        if (block.type === "ticket_card")
          return <TicketCard key={index} ticket={block.ticket} timeZone={timeZone} />;
        if (block.type === "ticket_selection") {
          return (
            <TicketSelection
              key={index}
              block={block}
              timeZone={timeZone}
              onReply={handlers.onReply}
            />
          );
        }
        if (block.type === "draft") {
          const draft = message.drafts[block.draftId];
          if (!draft) return null;
          return (
            <DraftCard
              key={index}
              draft={draft}
              timeZone={timeZone}
              interactive={!!handlers.onReply}
              onChanged={handlers.onChanged}
            />
          );
        }
        return null;
      })}
    </>
  );
}

/**
 * The level is a recommendation for the analysts (any of them may assume the
 * conversation), so the employee is only told it went to the service desk.
 */
export function HandoffLine({
  block,
  timeZone,
  viewer,
}: {
  block: Extract<MessageBlock, { type: "handoff" }>;
  timeZone: string;
  viewer: "employee" | "analyst";
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <ArrowLeftRight className="size-4" aria-hidden="true" />
      {viewer === "employee"
        ? "Transferida para o service desk"
        : `Transferida · indicada ao ${block.level}`}
      {block.respondBy ? (
        <span className="text-ink-4">· resposta até {untilLabel(block.respondBy, timeZone)}</span>
      ) : null}
    </span>
  );
}
