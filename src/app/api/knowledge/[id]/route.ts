import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { knowledgeArticles } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { json, route } from "@/server/http";

export const GET = route<"user", { id: string }>("user", async ({ params }) => {
  const rows = await db()
    .select({
      id: knowledgeArticles.id,
      title: knowledgeArticles.title,
      body: knowledgeArticles.body,
      platforms: knowledgeArticles.platforms,
      revision: knowledgeArticles.revision,
    })
    .from(knowledgeArticles)
    .where(and(eq(knowledgeArticles.id, params.id), eq(knowledgeArticles.status, "published")))
    .limit(1);
  const article = rows[0];
  if (!article) throw notFound("Artigo");
  return json(article);
});
