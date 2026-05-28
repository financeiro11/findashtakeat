// Relevância e curadoria de editais — usado por todos os conectores e pelo reprocesso.

export interface FilterSettings {
  min_match_score: number;
  preferred_keywords: string[];
  excluded_keywords: string[];
  preferred_sources: string[];
  excluded_sources: string[];
  preferred_regions: string[];
  opportunity_types: string[];
  show_low_relevance: boolean;
  show_pncp_results: boolean;
  pncp_min_match_score: number;
  fapes_priority_boost: number;
  startup_priority_boost: number;
  innovation_priority_boost: number;
}

export const SETTINGS_DEFAULTS: FilterSettings = {
  min_match_score: 60,
  preferred_keywords: [],
  excluded_keywords: [],
  preferred_sources: [],
  excluded_sources: [],
  preferred_regions: [],
  opportunity_types: ["fomento","subvencao","chamada_publica","programa_startup","aceleracao","premio"],
  show_low_relevance: false,
  show_pncp_results: true,
  pncp_min_match_score: 80,
  fapes_priority_boost: 30,
  startup_priority_boost: 20,
  innovation_priority_boost: 20,
};

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function sourcePriority(slug: string): number {
  const s = (slug || "").toLowerCase();
  if (s.includes("fapes")) return 100;
  if (["finep","embrapii","sebrae","inovativa","bndes"].some(x => s.includes(x))) return 80;
  if (s.includes("govbr")) return 50;
  if (s.includes("pncp")) return 20;
  return 50;
}

const TYPE_KEYWORDS: Array<[string, RegExp]> = [
  ["programa_startup", /\b(startup|aceleradora|aceleração|aceleracao|incubadora|gênesis|genesis|centelha|inovativa)\b/],
  ["aceleracao", /\b(aceleração|aceleracao|programa de aceleração)\b/],
  ["subvencao", /\b(subvenção|subvencao|subvenção econômica)\b/],
  ["fomento", /\b(fomento|edital de fomento|apoio financeiro|auxílio financeiro|auxilio financeiro|subsídio|subsidio)\b/],
  ["chamada_publica", /\b(chamada pública|chamada publica|chamamento|seleção pública|selecao publica)\b/],
  ["premio", /\b(prêmio|premio|premiação|premiacao)\b/],
  ["licitacao", /\b(pregão|pregao|licitação|licitacao|tomada de preços|concorrência|concorrencia)\b/],
  ["compra_publica", /\b(contratação|contratacao|aquisição|aquisicao|compra direta|dispensa)\b/],
];

export function detectOpportunityType(text: string, fonteSlug: string, modalidade?: string | null): string {
  const t = norm(`${text} ${modalidade ?? ""}`);
  for (const [type, re] of TYPE_KEYWORDS) if (re.test(t)) return type;
  if (fonteSlug.toLowerCase().includes("pncp")) return "compra_publica";
  return "outro";
}

const TYPE_BOOST: Record<string, number> = {
  fomento: 18, subvencao: 18, programa_startup: 18, aceleracao: 15,
  chamada_publica: 12, premio: 10, outro: 0,
  compra_publica: -20, licitacao: -15,
};

export interface RelevanceInput {
  titulo?: string | null;
  objeto?: string | null;
  resumo_ia?: string | null;
  orgao?: string | null;
  modalidade?: string | null;
  regiao?: string | null;
  prazo_envio?: string | null;
  fonte?: string | null;
  fonte_slug: string;
}

export interface RelevanceResult {
  score: number;
  source_priority: number;
  opportunity_type: string;
  visibility_status: "visivel" | "oculto_por_baixa_relevancia" | "pendente_revisao";
  relevance_reason: string;
  exclusion_reason: string | null;
}

/**
 * Calcula score 0-100 + visibility_status + motivos.
 * Lógica:
 *   base 40
 *   + boost por fonte (FAPES + boost configurável)
 *   + boost por tipo de oportunidade
 *   + 5pts por keyword positiva (cap +30)
 *   - 8pts por keyword negativa (cap -40)
 *   + 8pts se região preferida bater
 *   + 5pts se prazo aberto
 */
export function calculateEditalRelevance(
  e: RelevanceInput,
  s: FilterSettings,
): RelevanceResult {
  const haystack = norm(`${e.titulo ?? ""} ${e.objeto ?? ""} ${e.resumo_ia ?? ""} ${e.orgao ?? ""} ${e.modalidade ?? ""}`);
  const fonteSlug = (e.fonte_slug || "").toLowerCase();
  const sourcePri = sourcePriority(fonteSlug);
  const oppType = detectOpportunityType(`${e.titulo ?? ""} ${e.objeto ?? ""}`, fonteSlug, e.modalidade);

  const reasons: string[] = [];
  let score = 40;

  // Fonte
  if (fonteSlug.includes("fapes")) {
    score += s.fapes_priority_boost;
    reasons.push(`FAPES (+${s.fapes_priority_boost})`);
  } else if (["finep","embrapii","sebrae","inovativa","bndes"].some(x => fonteSlug.includes(x))) {
    score += 10;
    reasons.push("Fonte de fomento (+10)");
  } else if (fonteSlug.includes("pncp")) {
    score -= 25;
    reasons.push("PNCP (penalidade -25)");
  }

  // Tipo
  const tboost = TYPE_BOOST[oppType] ?? 0;
  if (tboost !== 0) {
    score += tboost;
    reasons.push(`Tipo ${oppType} (${tboost > 0 ? "+" : ""}${tboost})`);
  }

  // Boosts adicionais por palavras estratégicas
  if (/\b(startup|aceleradora|incubadora)\b/.test(haystack)) {
    score += s.startup_priority_boost;
    reasons.push(`Startup (+${s.startup_priority_boost})`);
  }
  if (/\b(inovação|inovacao|p&d|pd&i|pdi|pesquisa e desenvolvimento|nova economia|extensão tecnológica|extensao tecnologica)\b/.test(haystack)) {
    score += s.innovation_priority_boost;
    reasons.push(`Inovação (+${s.innovation_priority_boost})`);
  }

  // Keywords positivas
  const pos = (s.preferred_keywords || []).map(norm).filter(Boolean);
  let posHits = 0;
  const posMatched: string[] = [];
  for (const kw of pos) {
    if (haystack.includes(kw)) { posHits++; if (posMatched.length < 5) posMatched.push(kw); }
  }
  const posBonus = Math.min(30, posHits * 5);
  if (posBonus) {
    score += posBonus;
    reasons.push(`${posHits} palavras-chave (${posMatched.join(", ")}${posHits > posMatched.length ? "..." : ""}) +${posBonus}`);
  }

  // Keywords negativas
  const neg = (s.excluded_keywords || []).map(norm).filter(Boolean);
  let negHits = 0;
  const negMatched: string[] = [];
  for (const kw of neg) {
    if (haystack.includes(kw)) { negHits++; if (negMatched.length < 5) negMatched.push(kw); }
  }
  const negPenalty = Math.min(40, negHits * 8);
  if (negPenalty) {
    score -= negPenalty;
    reasons.push(`${negHits} termos negativos (${negMatched.join(", ")}) -${negPenalty}`);
  }

  // Região
  const regioes = (s.preferred_regions || []).map(norm).filter(Boolean);
  if (regioes.length && e.regiao) {
    if (regioes.some(r => norm(e.regiao!).includes(r) || r.includes(norm(e.regiao!)))) {
      score += 8;
      reasons.push("Região preferida (+8)");
    }
  }

  // Prazo aberto
  if (e.prazo_envio) {
    const dias = Math.ceil((new Date(e.prazo_envio).getTime() - Date.now()) / 86400000);
    if (dias >= 0) { score += 5; reasons.push("Prazo aberto (+5)"); }
  } else if (/fluxo cont|inscrições prorrogadas|inscricoes prorrogadas|chamada perm/.test(haystack)) {
    score += 5;
    reasons.push("Fluxo contínuo (+5)");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Decisão de visibilidade
  let visibility: RelevanceResult["visibility_status"] = "visivel";
  let exclusion: string | null = null;

  // Fontes excluídas
  if ((s.excluded_sources || []).map(norm).some(x => x && fonteSlug.includes(x))) {
    visibility = "oculto_por_baixa_relevancia";
    exclusion = "Fonte está na lista de excluídas.";
  }
  // Tipo não está nos exibidos — só bloqueia tipos *negativos* explícitos (licitação, compra pública).
  // "outro" e tipos não detectados são permitidos se o score passar — evita esconder editais bons só por não bater regex.
  else if (
    s.opportunity_types?.length &&
    oppType !== "outro" &&
    !s.opportunity_types.includes(oppType) &&
    (oppType === "compra_publica" || oppType === "licitacao")
  ) {
    if (fonteSlug.includes("pncp") && score >= s.pncp_min_match_score) {
      // mantém visivel
    } else {
      visibility = "oculto_por_baixa_relevancia";
      exclusion = `Tipo "${oppType}" fora dos tipos exibidos no painel.`;
    }
  }
  // PNCP precisa de threshold próprio
  else if (fonteSlug.includes("pncp")) {
    if (!s.show_pncp_results) {
      visibility = "oculto_por_baixa_relevancia";
      exclusion = "Resultados do PNCP estão desativados nas Configurações.";
    } else if (score < s.pncp_min_match_score) {
      visibility = "oculto_por_baixa_relevancia";
      exclusion = `Score PNCP ${score} < mínimo ${s.pncp_min_match_score}.`;
    } else if (negHits >= 2) {
      visibility = "oculto_por_baixa_relevancia";
      exclusion = `${negHits} termos negativos detectados — provável irrelevante.`;
    }
  }
  // Score geral abaixo do mínimo
  else if (score < s.min_match_score) {
    visibility = "oculto_por_baixa_relevancia";
    exclusion = `Score ${score} < mínimo configurado ${s.min_match_score}.`;
  }

  return {
    score,
    source_priority: sourcePri,
    opportunity_type: oppType,
    visibility_status: visibility,
    relevance_reason: reasons.join(" · ") || "Sem critérios disparados.",
    exclusion_reason: exclusion,
  };
}

export async function loadFilterSettings(supa: any): Promise<FilterSettings> {
  const { data } = await supa.from("edital_filter_settings").select("*").limit(1).maybeSingle();
  if (!data) return SETTINGS_DEFAULTS;
  return {
    min_match_score: data.min_match_score ?? 60,
    preferred_keywords: data.preferred_keywords ?? [],
    excluded_keywords: data.excluded_keywords ?? [],
    preferred_sources: data.preferred_sources ?? [],
    excluded_sources: data.excluded_sources ?? [],
    preferred_regions: data.preferred_regions ?? [],
    opportunity_types: data.opportunity_types ?? SETTINGS_DEFAULTS.opportunity_types,
    show_low_relevance: !!data.show_low_relevance,
    show_pncp_results: data.show_pncp_results ?? true,
    pncp_min_match_score: data.pncp_min_match_score ?? 80,
    fapes_priority_boost: data.fapes_priority_boost ?? 30,
    startup_priority_boost: data.startup_priority_boost ?? 20,
    innovation_priority_boost: data.innovation_priority_boost ?? 20,
  };
}

// ============================================================================
// VALIDAÇÃO DE EDITAL — distingue editais reais de notícias / páginas institucionais
// ============================================================================

export interface EditalValidationInput {
  titulo?: string | null;
  objeto?: string | null;
  resumo_ia?: string | null;
  link?: string | null;
  numero?: string | null;
  prazo_envio?: string | null;
  modalidade?: string | null;
}

export interface EditalValidationResult {
  /** 0-100, quão provável é que seja um edital de verdade */
  confidence: number;
  /** true se acima do limite mínimo */
  is_edital: boolean;
  reasons: string[];
}

// Indicadores POSITIVOS de que a página é um edital/chamada real
const POSITIVE_INDICATORS: Array<[RegExp, number, string]> = [
  [/inscri[çc][õo]es?\s+abertas?/, 18, "inscrições abertas"],
  [/inscri[çc][õo]es?\s+at[ée]/, 14, "inscrições até"],
  [/submiss[ãa]o\s+de\s+propostas?/, 16, "submissão de propostas"],
  [/submiss[ãa]o/, 8, "submissão"],
  [/chamada\s+p[úu]blica/, 18, "chamada pública"],
  [/chamamento\s+p[úu]blico/, 16, "chamamento público"],
  [/sele[çc][ãa]o\s+p[úu]blica/, 14, "seleção pública"],
  [/\bedital\b/, 12, "edital"],
  [/regulamento/, 8, "regulamento"],
  [/cronograma/, 8, "cronograma"],
  [/\bproposta(s)?\b/, 6, "proposta"],
  [/prazo\s+(final|de\s+inscri|de\s+envio|de\s+submiss)/, 12, "prazo"],
  [/\banexo(s)?\b/, 4, "anexo"],
  [/n[ºo°]\s*\d+\/?\d*\s*\/?\s*20\d{2}/, 10, "número do edital"],
];

// Indicadores NEGATIVOS — provavelmente notícia / institucional / encerrado
const NEGATIVE_INDICATORS: Array<[RegExp, number, string]> = [
  [/\bnot[íi]cia(s)?\b/, 22, "notícia"],
  [/publica[çc][ãa]o\s+institucional/, 18, "publicação institucional"],
  [/\bcomunicado\b/, 14, "comunicado"],
  [/lista\s+de\s+aprovados/, 30, "lista de aprovados"],
  [/resultado\s+(final|preliminar|da\s+sele)/, 28, "resultado"],
  [/\bresultado\b/, 14, "resultado"],
  [/homologa[çc][ãa]o/, 26, "homologação"],
  [/\bencerrad[oa]\b/, 24, "encerrado"],
  [/\barquivad[oa]\b/, 22, "arquivado"],
  [/inscri[çc][õo]es?\s+encerradas?/, 30, "inscrições encerradas"],
  [/prazo\s+(expirad|encerrad|esgotad)/, 26, "prazo expirado"],
  [/\bevento(s)?\b/, 8, "evento"],
  [/\bblog\b/, 12, "blog"],
];

export function validateEdital(
  e: EditalValidationInput,
  minConfidence = 45,
): EditalValidationResult {
  const haystack = norm(`${e.titulo ?? ""} ${e.objeto ?? ""} ${e.resumo_ia ?? ""} ${e.modalidade ?? ""}`);
  const url = norm(e.link ?? "");
  const reasons: string[] = [];
  let confidence = 25; // base neutra

  // PDF anexado é forte indicador de edital
  if (/\.pdf(\?|#|$)/.test(url)) { confidence += 18; reasons.push("PDF anexado (+18)"); }
  // Número de edital explícito no campo numero
  if (e.numero && /\d/.test(String(e.numero))) { confidence += 8; reasons.push("possui número (+8)"); }
  // Possui prazo definido
  if (e.prazo_envio) { confidence += 10; reasons.push("prazo definido (+10)"); }

  let posHits = 0;
  for (const [re, w, label] of POSITIVE_INDICATORS) {
    if (re.test(haystack)) { confidence += w; posHits++; if (reasons.length < 12) reasons.push(`+${w} ${label}`); }
  }

  let negHits = 0;
  for (const [re, w, label] of NEGATIVE_INDICATORS) {
    if (re.test(haystack)) { confidence -= w; negHits++; if (reasons.length < 18) reasons.push(`-${w} ${label}`); }
  }

  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  // Regra dura: nenhum indicador positivo e algum negativo → quase certamente não é edital
  const isEdital = confidence >= minConfidence && (posHits > 0 || /\.pdf/.test(url));

  return { confidence, is_edital: isEdital, reasons };
}

// ============================================================================
// CICLO DE VIDA — aberto / encerrando / encerrado
// ============================================================================

export type LifecycleStatus = "aberto" | "encerrando" | "encerrado";

export interface LifecycleResult {
  lifecycle: LifecycleStatus;
  /** true se deve sair do radar principal */
  closed: boolean;
  reason: string | null;
}

const CLOSED_TEXT = /(resultado\s+final|homologa[çc][ãa]o|\bencerrad[oa]\b|\barquivad[oa]\b|inscri[çc][õo]es?\s+encerradas?|prazo\s+(expirad|encerrad|esgotad)|lista\s+de\s+aprovados)/;

export function detectLifecycle(
  e: EditalValidationInput,
  prazo?: string | null,
  soonDays = 7,
): LifecycleResult {
  const haystack = norm(`${e.titulo ?? ""} ${e.objeto ?? ""} ${e.resumo_ia ?? ""}`);

  // Texto explícito de encerramento tem prioridade
  if (CLOSED_TEXT.test(haystack)) {
    return { lifecycle: "encerrado", closed: true, reason: "Texto indica edital encerrado/resultado." };
  }

  if (prazo) {
    const t = new Date(prazo).getTime();
    if (isFinite(t)) {
      const dias = Math.ceil((t - Date.now()) / 86400000);
      if (dias < 0) return { lifecycle: "encerrado", closed: true, reason: `Prazo venceu há ${Math.abs(dias)} dia(s).` };
      if (dias <= soonDays) return { lifecycle: "encerrando", closed: false, reason: `Encerra em ${dias} dia(s).` };
      return { lifecycle: "aberto", closed: false, reason: null };
    }
  }

  return { lifecycle: "aberto", closed: false, reason: null };
}
