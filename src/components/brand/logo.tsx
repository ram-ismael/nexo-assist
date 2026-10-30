import Image from "next/image";
import { cn } from "@/lib/cn";

/** Official brand assets supplied with the challenge; never redrawn. */
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
      width={tone === "light" ? 390 : 408}
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
      width={120}
      height={120}
      className={cn("size-8", className)}
    />
  );
}
