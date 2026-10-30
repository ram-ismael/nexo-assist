import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Nexo Assist", template: "%s · Nexo Assist" },
  description: "Service desk de TI da Nexo: seu problema de TI, resolvido em uma conversa.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e2633",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Per-request rendering everywhere, so every page carries the CSP nonce set
  // by the proxy (a prerendered page would ship scripts the policy blocks).
  await connection();
  return (
    <html lang="pt-BR" className="h-full">
      <body className="bg-paper text-ink min-h-full antialiased">{children}</body>
    </html>
  );
}
