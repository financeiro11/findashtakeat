// Stub for future AI enrichment (Claude/OpenAI). Same signature will hold.
import { keywordScore, DEFAULT_KEYWORDS } from "./keywords.ts";

export interface NormalizedEdital {
  titulo: string;
  objeto?: string | null;
  orgao?: string | null;
  categoria?: string | null;
}

export function enrichEdital(e: NormalizedEdital, keywords: string[] = DEFAULT_KEYWORDS) {
  const text = `${e.titulo} ${e.objeto ?? ""}`;
  const score = keywordScore(text, keywords);
  const resumo = (e.objeto ?? e.titulo ?? "").slice(0, 280);
  let categoria = e.categoria ?? "Outros";
  const t = text.toLowerCase();
  if (t.includes("saúde") || t.includes("saude")) categoria = "Saúde";
  else if (t.includes("educa")) categoria = "Educação";
  else if (t.includes("infra")) categoria = "Infraestrutura";
  else if (t.includes("sustent")) categoria = "Sustentabilidade";
  else if (t.includes("inova") || t.includes("ia ") || t.includes("startup") || t.includes("saas")) categoria = "Inovação";
  else if (t.includes("tecnolog")) categoria = "Tecnologia";
  return { match_score: score, resumo_ia: resumo, categoria };
}
