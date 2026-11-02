import { normalizeText } from "@/domain/similarity";
import type { MessageBlock } from "@/server/messages/blocks";
import type { TurnContext } from "./turn-context";

/**
 * The "Fontes" of an answer: articles the search returned this turn that the
 * agent declared it used, or that the text cites by title or id. Articles the
 * search merely matched are never shown as sources.
 */
export function knowledgeSources(turn: TurnContext, text: string): MessageBlock | null {
  const cited = normalizeText(text);
  const declared = new Set(turn.decision?.articlesUsed ?? []);
  const articles = [...turn.articlesFound]
    .filter(
      ([id, title]) =>
        declared.has(id) ||
        cited.includes(normalizeText(id)) ||
        cited.includes(normalizeText(title)),
    )
    .map(([id, title]) => ({ id, title }));
  return articles.length > 0 ? { type: "knowledge", articles } : null;
}

/**
 * The model sometimes ends a turn right after a tool, with cards but no words.
 * The employee still gets one plain sentence about what is on screen; nothing
 * is invented beyond what the blocks themselves show.
 */
export function fallbackText(blocks: MessageBlock[]): string {
  for (const block of blocks) {
    if (block.type === "draft") {
      return "Preparei o rascunho abaixo. Confira os dados e confirme para eu registrar; nada é criado ou alterado antes disso.";
    }
    if (block.type === "ticket_selection") return block.prompt;
    if (block.type === "quick_replies" && block.question) return block.question;
  }
  if (blocks.some((block) => block.type === "ticket_card")) {
    return "Aqui está o chamado. Posso ajudar com mais alguma coisa sobre ele?";
  }
  return "";
}
