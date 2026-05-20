export type Edital = {
  id: string;
  titulo: string;
  orgao: string | null;
  modalidade: string | null;
  numero: string | null;
  objeto: string | null;
  valor_estimado: number;
  data_publicacao: string | null;
  data_abertura: string | null;
  prazo_envio: string | null;
  status: string;
  responsavel: string | null;
  link: string | null;
  pdf_path: string | null;
  observacao: string | null;
  categoria: string | null;
  fonte: string | null;
  resumo_ia: string | null;
  regiao: string | null;
  match_score: number | null;
  documentos: string[] | null;
  riscos: string | null;
  proximos_passos: string | null;
  pipeline_stage: string;
  prioridade: string;
  data_captura: string;
  criterios_elegibilidade: string | null;
  visibility_status?: string | null;
  relevance_reason?: string | null;
  exclusion_reason?: string | null;
  source_priority?: number | null;
  opportunity_type?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const OPPORTUNITY_TYPES = [
  { value: "fomento", label: "Fomento" },
  { value: "subvencao", label: "Subvenção" },
  { value: "chamada_publica", label: "Chamada pública" },
  { value: "programa_startup", label: "Programa startup" },
  { value: "aceleracao", label: "Aceleração" },
  { value: "premio", label: "Prêmio" },
  { value: "compra_publica", label: "Compra pública" },
  { value: "licitacao", label: "Licitação" },
  { value: "outro", label: "Outro" },
];

export const VISIBILITY_STATUSES = [
  { value: "visivel", label: "Visível", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  { value: "oculto_por_baixa_relevancia", label: "Oculto", color: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  { value: "pendente_revisao", label: "Pendente revisão", color: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
  { value: "descartado", label: "Descartado", color: "bg-rose-500/10 text-rose-600 border-rose-500/30" },
  { value: "duplicado", label: "Duplicado", color: "bg-muted text-muted-foreground border-border" },
];

export const visibilityBadge = (s: string | null | undefined) =>
  VISIBILITY_STATUSES.find(v => v.value === s)?.color ?? "bg-muted text-muted-foreground border-border";

export const opportunityLabel = (t: string | null | undefined) =>
  OPPORTUNITY_TYPES.find(o => o.value === t)?.label ?? (t ?? "—");

export const STATUS_LIST = [
  "Em análise",
  "Em elaboração",
  "Enviado",
  "Vencido",
  "Ganhamos",
  "Perdemos",
  "Descartado",
];

export const PIPELINE_STAGES = [
  "Encontrado",
  "Em análise",
  "Viável",
  "Documentação",
  "Em elaboração",
  "Enviado",
  "Resultado",
];

export const PRIORIDADES = ["Alta", "Média", "Baixa"];

export const CATEGORIAS = [
  "Tecnologia",
  "Saúde",
  "Educação",
  "Infraestrutura",
  "Inovação",
  "Sustentabilidade",
  "Outros",
];

export const REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul", "Nacional"];

export const fmtBRL = (v: number | null | undefined) => {
  const n = Number(v ?? 0);
  if (!isFinite(n) || n === 0) return "R$ 0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (val: number) =>
    val.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: val < 10 ? 1 : 0 });
  if (abs >= 1e9) return `${sign}R$ ${fmt(abs / 1e9)} bi`;
  if (abs >= 1e6) return `${sign}R$ ${fmt(abs / 1e6)} mi`;
  if (abs >= 1e3) return `${sign}R$ ${fmt(abs / 1e3)} mil`;
  return `${sign}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

export const statusBadge = (s: string) => {
  switch (s) {
    case "Ganhamos": return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
    case "Enviado": return "bg-blue-500/10 text-blue-600 border-blue-500/30";
    case "Em elaboração": return "bg-amber-500/10 text-amber-600 border-amber-500/30";
    case "Em análise": return "bg-sky-500/10 text-sky-600 border-sky-500/30";
    case "Vencido": return "bg-rose-500/10 text-rose-600 border-rose-500/30";
    case "Perdemos": return "bg-rose-500/10 text-rose-600 border-rose-500/30";
    case "Descartado": return "bg-muted text-muted-foreground border-border";
    default: return "bg-muted text-muted-foreground border-border";
  }
};

export const prioridadeBadge = (p: string) => {
  switch (p) {
    case "Alta": return "bg-rose-500/10 text-rose-600 border-rose-500/30";
    case "Média": return "bg-amber-500/10 text-amber-600 border-amber-500/30";
    case "Baixa": return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
};

export const matchColor = (score: number) => {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  if (score >= 40) return "text-orange-600";
  return "text-rose-600";
};

export const daysUntil = (dateStr: string | null) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
};
