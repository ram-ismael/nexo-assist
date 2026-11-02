"use client";

import { Ban, Check, ChevronDown, CircleAlert } from "lucide-react";
import { useId, useState } from "react";
import type { ActionDTO } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/spinner";
import { DecisionPanel } from "./decision-panel";

function ActionIcon({ status }: { status: string }) {
  if (status === "running") return <Spinner className="size-3" />;
  if (status === "ok") return <Check className="size-3.5" aria-hidden="true" />;
  if (status === "denied") return <Ban className="text-warning-text size-3.5" aria-hidden="true" />;
  return <CircleAlert className="text-danger-text size-3.5" aria-hidden="true" />;
}

/** "Nexo Assist ✓ consultou seus chamados ✓ buscou na central de ajuda" + expandable decision. */
export function ActionTrail({
  actions,
  turnId,
  viewer,
  name = "Nexo Assist",
  badge,
  align = "left",
}: {
  actions: (ActionDTO & { id?: string })[];
  turnId: string | null;
  viewer: "employee" | "analyst";
  name?: string;
  /** Small tag after the name, e.g. "IA" in the analyst console. */
  badge?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={cn("flex flex-col", align === "right" ? "items-end" : "items-start")}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]",
          align === "right" && "justify-end",
        )}
      >
        <span className="text-ink font-semibold">{name}</span>
        {badge ? (
          <span className="bg-primary-soft text-primary-text -ml-1.5 rounded px-1.5 text-[11px] leading-4.5 font-semibold">
            {badge}
          </span>
        ) : null}
        {actions.map((action, index) => (
          <span
            key={action.id ?? `${action.tool}-${index}`}
            className={cn(
              "text-ink-3 inline-flex items-center gap-1",
              action.status === "error" && "text-danger-text",
            )}
          >
            <ActionIcon status={action.status} />
            {action.status === "error" ? `falhou: ${action.label}` : action.label}
          </span>
        ))}
        {turnId ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={panelId}
            className="text-primary-text hover:bg-primary-soft inline-flex items-center gap-0.5 rounded px-1 text-[13px] font-medium"
          >
            {open ? "Ocultar detalhes" : "Por quê?"}
            <ChevronDown
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>
      {open && turnId ? (
        <div
          id={panelId}
          className="animate-rise border-primary-line mt-2 w-full max-w-[720px] rounded-xl border bg-[#f7fbff] p-4"
        >
          <DecisionPanel turnId={turnId} viewer={viewer} />
        </div>
      ) : null}
    </div>
  );
}
