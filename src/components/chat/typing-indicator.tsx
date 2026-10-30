import { cn } from "@/lib/cn";
import { TypingDots } from "@/components/ui/spinner";

/**
 * The animated dots where the next message will appear (same side, shape and
 * padding as that message), with no visible caption; screen readers get
 * "Fulano está escrevendo". Only rendered from real signals: a running agent
 * turn or a fresh typing signal.
 */
export function TypingIndicator({
  name,
  align,
  tone,
}: {
  name: string;
  align: "left" | "right";
  tone: "paper" | "agent" | "analyst";
}) {
  return (
    <div className={cn("animate-rise flex", align === "right" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex h-12 items-center rounded-[18px] px-5 shadow-[0_1px_2px_rgba(27,36,49,0.05)]",
          align === "right" ? "rounded-tr-[6px]" : "rounded-tl-[6px]",
          tone === "paper" && "border-rule bg-paper border",
          tone === "agent" && "bg-agent-bubble",
          tone === "analyst" && "border-success/20 bg-analyst-bubble border",
        )}
      >
        <TypingDots label={`${name} está escrevendo`} />
      </div>
    </div>
  );
}
