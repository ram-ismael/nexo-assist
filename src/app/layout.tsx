import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="bg-paper text-ink min-h-full antialiased">{children}</body>
    </html>
  );
}
