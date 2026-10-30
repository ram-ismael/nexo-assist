import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

const PALETTE = [
  "bg-primary-soft text-primary-text",
  "bg-[#fdeee4] text-[#b4531a]",
  "bg-[#efeafd] text-[#5b3fc4]",
  "bg-[#e5f6ea] text-[#1f7a43]",
  "bg-[#fde8ef] text-[#b42357]",
  "bg-[#eceef1] text-[#4a5361]",
  "bg-[#fdf3dc] text-[#8a6200]",
];

function tone(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]!;
}

export function Avatar({
  name,
  size = "md",
  online,
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  /** true: green dot; false: grey dot (e.g. "ausente"); undefined: no dot (no presence data). */
  online?: boolean;
  className?: string;
}) {
  const dimension =
    size === "sm" ? "size-8 text-xs" : size === "lg" ? "size-12 text-base" : "size-10 text-sm";
  return (
    // h-fit: in a stretching flex row the presence dot stays on the avatar.
    <span className={cn("relative inline-flex h-fit shrink-0", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex items-center justify-center rounded-full font-semibold",
          dimension,
          tone(name),
        )}
      >
        {initials(name)}
      </span>
      {online !== undefined ? (
        <span
          className={cn(
            "border-paper absolute right-0 bottom-0 rounded-full border-2",
            size === "lg" ? "size-3.5" : "size-3",
            online ? "bg-success" : "bg-ink-4",
          )}
          aria-label={online ? "online" : "offline"}
        />
      ) : null}
    </span>
  );
}
