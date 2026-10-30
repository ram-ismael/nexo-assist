import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsoleApp } from "@/components/console/console-app";
import { config } from "@/lib/config";
import { requirePageUser } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Console do analista" };

export default async function ConsolePage() {
  const analyst = await requirePageUser("analyst");
  return (
    <Suspense>
      <ConsoleApp
        analyst={{ id: analyst.id, name: analyst.name, supportLevel: analyst.supportLevel }}
        timeZone={config().calendar.timeZone}
      />
    </Suspense>
  );
}
