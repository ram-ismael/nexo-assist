import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Official brand asset supplied with the challenge; never redrawn. The light
 * version is the same file whitened with a CSS filter, which keeps the exact
 * shapes (the supplied white PNG carries padding that distorts at small sizes).
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
      src="/brand/logo-dark.png"
      alt="Nexo Assist"
      width={408}
      height={60}
      priority
      className={cn("h-7 w-auto", tone === "light" && "brightness-0 invert", className)}
    />
  );
}

export function LogoSymbol({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/symbol.png"
      alt="Nexo Assist"
      width={120}
      height={120}
      className={cn("size-8", className)}
    />
  );
}
