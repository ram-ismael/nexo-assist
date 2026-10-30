import { json, route } from "@/server/http";

export const GET = route("user", async ({ user }) =>
  json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    supportLevel: user.supportLevel,
  }),
);
