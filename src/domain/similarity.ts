import type { TicketCategory } from "./tickets";

const STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de do da dos das no na nos nas em por para pra com sem que e ou " +
    "meu minha meus minhas seu sua seus suas nao sim ja esta estou estao foi ser ter tem tenho " +
    "ao aos se mais muito pouco desde quando como porque pois isso isto esse essa este esta " +
    "ele ela eles elas eu voce voces nos me te lhe hoje ontem agora aqui ali la depois antes " +
    "problema problemas erro aparece apareceu consigo consegue conseguir preciso precisa favor"
  ).split(" "),
);

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Light stemming: enough to match "conecta"/"conectar"/"conexão" style variants. */
function stem(token: string): string {
  if (/^\d+$/.test(token)) return token;
  return token.length > 5 ? token.slice(0, 5) : token;
}

function keywords(value: string): Set<string> {
  const tokens = normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 || /^\d+$/.test(token))
    .filter((token) => !STOPWORDS.has(token))
    .map(stem);
  return new Set(tokens);
}

type DuplicateCandidate = {
  id: string;
  title: string;
  description: string;
  category: TicketCategory;
};

type DuplicateMatch<T extends DuplicateCandidate> = {
  ticket: T;
  score: number;
  sharedTerms: string[];
};

/**
 * Overlap coefficient between the new report and each existing ticket, with a
 * bonus when the category matches. Deterministic and explainable: the shared
 * terms are returned so the decision can be shown to the employee.
 */
export function rankDuplicates<T extends DuplicateCandidate>(
  report: { title: string; description: string; category?: TicketCategory },
  candidates: readonly T[],
  threshold = 0.34,
): DuplicateMatch<T>[] {
  const reportTerms = keywords(`${report.title} ${report.description}`);
  if (reportTerms.size === 0) return [];

  return candidates
    .map((ticket) => {
      const ticketTerms = keywords(`${ticket.title} ${ticket.description}`);
      const shared = [...reportTerms].filter((term) => ticketTerms.has(term));
      const base = shared.length / Math.max(1, Math.min(reportTerms.size, ticketTerms.size));
      const categoryBonus = report.category && report.category === ticket.category ? 0.15 : 0;
      return { ticket, score: Math.min(1, base + categoryBonus), sharedTerms: shared };
    })
    .filter((match) => match.sharedTerms.length >= 1 && match.score >= threshold)
    .sort((left, right) => right.score - left.score);
}
