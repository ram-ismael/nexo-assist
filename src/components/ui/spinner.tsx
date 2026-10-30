import { cn } from "@/lib/cn";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center">
      <svg
        className={cn("size-4 animate-spin", className)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** Three dots in a soft wave: the one "someone is writing" signal, for people and the AI. */
export function TypingDots({ label = "Nexo Assist está escrevendo" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex h-5 items-center gap-[5px]">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden="true"
          className="animate-typing bg-ink-3 size-[7px] rounded-full"
          style={{ animationDelay: `${index * 150}ms` }}
        />
      ))}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("bg-rule/70 animate-pulse rounded-md", className)} aria-hidden="true" />
  );
}
