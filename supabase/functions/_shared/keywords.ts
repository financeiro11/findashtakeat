export const DEFAULT_KEYWORDS = [
  "inovação", "inovacao", "inteligência artificial", "inteligencia artificial",
  "ia ", " ia", "foodtech", "food service", "food-service", "saas",
  "transformação digital", "transformacao digital", "automação", "automacao",
  "analytics", "startup", "eficiência operacional", "eficiencia operacional",
  "tecnologia",
];

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function matchesKeywords(text: string, keywords: string[] = DEFAULT_KEYWORDS): boolean {
  if (!text) return false;
  const n = norm(text);
  return keywords.some((k) => n.includes(norm(k)));
}

export function keywordScore(text: string, keywords: string[] = DEFAULT_KEYWORDS): number {
  if (!text) return 0;
  const n = norm(text);
  const hits = keywords.filter((k) => n.includes(norm(k))).length;
  return Math.min(100, Math.round((hits / Math.max(1, keywords.length)) * 100 * 4));
}
