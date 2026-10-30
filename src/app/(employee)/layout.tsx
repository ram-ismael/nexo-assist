import type { ReactNode } from "react";
import { EmployeeShell } from "@/components/layout/employee-shell";
import { requirePageUser } from "@/server/auth/current-user";

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser("employee");
  return <EmployeeShell user={{ name: user.name, email: user.email }}>{children}</EmployeeShell>;
}
