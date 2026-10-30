import { PRIORITY_LABEL, STATUS_LABEL, type Priority, type TicketStatus } from "@/domain/tickets";
import { cn } from "@/lib/cn";

const STATUS_TONE: Record<TicketStatus, { dot: string; text: string }> = {
  open: { dot: "bg-primary", text: "text-primary-text" },
  in_progress: { dot: "bg-primary", text: "text-primary-text" },
  waiting_analyst: { dot: "bg-warning", text: "text-warning-text" },
  approved: { dot: "bg-success", text: "text-success-text" },
  resolved: { dot: "bg-ink-4", text: "text-ink-3" },
  closed: { dot: "bg-ink-4", text: "text-ink-3" },
};

const PRIORITY_DOT: Record<Priority, string> = {
  critica: "bg-danger",
  alta: "bg-warning",
  media: "bg-ink-4",
  baixa: "bg-success",
};

export function Dot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-[7px] shrink-0 rounded-full", className)}
    />
  );
}

/** Text label always accompanies the color, so status never relies on color alone. */
export function TicketStatusBadge({
  status,
  className,
}: {
  status: TicketStatus;
  className?: string;
}) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[13px] font-medium",
        tone.text,
        className,
      )}
    >
      <Dot className={tone.dot} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityLabel({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Dot className={PRIORITY_DOT[priority]} />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function statusDotClass(status: TicketStatus): string {
  return STATUS_TONE[status].dot;
}
