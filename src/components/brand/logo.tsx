import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Brand assets: the "N" symbol supplied by Nexo (blue on light, white on navy)
 * next to the original wordmark. Generated from the source PNG, never redrawn.
 */
export function Logo({
  tone = "dark",
  className,
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <Image
      src={tone === "light" ? "/brand/logo-white.png" : "/brand/logo-dark.png"}
      alt="Nexo Assist"
      width={tone === "light" ? 393 : 412}
      height={tone === "light" ? 72 : 60}
      priority
      className={cn("h-7 w-auto", className)}
    />
  );
}

export function LogoSymbol({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/symbol.png"
      alt="Nexo Assist"
      width={240}
      height={240}
      className={cn("size-8", className)}
    />
  );
}
