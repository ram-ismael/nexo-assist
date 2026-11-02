import { and, eq, sql } from "drizzle-orm";
import { normalizeText } from "@/domain/similarity";
import type { Executor } from "@/server/db/client";
import { knowledgeArticles } from "@/server/db/schema";

type ArticleHit = {
  id: string;
  title: string;
  body: string;
  category: string;
  platforms: string[];
  revision: number;
  updatedAt: string;
  score: number;
  /** null when the article has no platform restriction or the device is unknown. */
  appliesToDevice: boolean | null;
};

const IGNORED = new Set([
  "como",
  "para",
  "que",
  "com",
  "nao",
  "meu",
  "minha",
  "esta",
  "uma",
  "por",
  "dos",
  "das",
]);

function toTsQuery(query: string): string | null {
  const terms = normalizeText(query)
    .replace(/-/g, " ")
    .split(" ")
    .filter((term) => (term.length > 2 || /^\d+$/.test(term)) && !IGNORED.has(term))
    .slice(0, 12);
  if (terms.length === 0) return null;
  return [...new Set(terms)].map((term) => `${term}:*`).join(" | ");
}

function platformApplies(platforms: string[], deviceOs: string | null): boolean | null {
  if (platforms.length === 0 || !deviceOs) return null;
  const device = normalizeText(deviceOs);
  return platforms.some((platform) => normalizeText(platform) === device);
}

/** Full-text search over published articles (Portuguese stemming, accent-insensitive). */
export async function searchKnowledge(
  executor: Executor,
  query: string,
  options: { deviceOs: string | null; limit?: number },
): Promise<ArticleHit[]> {
  const tsQuery = toTsQuery(query);
  if (!tsQuery) return [];
  const vector = sql`to_tsvector('portuguese', ${knowledgeArticles.searchText})`;
  const tsq = sql`to_tsquery('portuguese', ${tsQuery})`;
  const rank = sql<number>`ts_rank_cd(${vector}, ${tsq})`;
  const rows = await executor
    .select({
      id: knowledgeArticles.id,
      title: knowledgeArticles.title,
      body: knowledgeArticles.body,
      category: knowledgeArticles.category,
      platforms: knowledgeArticles.platforms,
      revision: knowledgeArticles.revision,
      updatedAt: knowledgeArticles.updatedAt,
      score: rank,
    })
    .from(knowledgeArticles)
    .where(and(eq(knowledgeArticles.status, "published"), sql`${vector} @@ ${tsq}`))
    .orderBy(sql`${rank} desc`)
    .limit(options.limit ?? 3);
  // Drop weak matches (e.g. an article that only shares the word "erro"):
  // keep results scoring at least 35% of the best one.
  const best = Number(rows[0]?.score ?? 0);
  return rows
    .filter((row) => Number(row.score) >= best * 0.35)
    .map((row) => ({
      ...row,
      score: Number(row.score),
      updatedAt: row.updatedAt.toISOString(),
      appliesToDevice: platformApplies(row.platforms, options.deviceOs),
    }));
}
