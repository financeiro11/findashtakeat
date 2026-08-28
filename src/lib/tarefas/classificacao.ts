/**
 * O vocabulário de classificação das tarefas — em UM lugar.
 *
 * As mesmas três listas são usadas pelo seletor do card, pelo filtro do quadro,
 * pela revisão em lote e pelo prompt que a IA recebe. Quando estavam espalhadas,
 * bastava alguém escrever "Automações" no plural num canto para a aba Análise
 * passar a mostrar duas fatias com o mesmo nome — ela agrupa por igualdade
 * exata da string.
 *
 * O carimbo automático que preenche esses campos mora no banco
 * (`fn_classifica_texto`, migration 20260827270000). Se mudar aqui, mude lá:
 * a tela é quem corrige, mas o gatilho é quem carimba as tarefas novas.
 */

/** Run / Grow / Build — quanto da semana foi manter, decidir e construir. */
export const NATUREZAS = ["Operacional", "Estratégico", "Automação"] as const;
export type Natureza = (typeof NATUREZAS)[number];

/**
 * As áreas espelham os módulos do Hub, de propósito.
 *
 * É isso que torna a leitura acionável: "a carga operacional da semana foi em
 * Notas Fiscais" aponta para a próxima automação da esteira. O vocabulário
 * anterior ("Processos", "Sistema/Hub", "Outros") não apontava para lugar nenhum
 * — e 46% das tarefas caíam em "Outros" porque contrato, rescisão e remessa não
 * tinham casa.
 */
export const AREAS = [
  "Tesouraria",
  "Recebíveis",
  "Notas Fiscais",
  "Fechamento",
  "Auditoria",
  "Planejamento",
  "Pessoas & Folha",
  "Societário & Jurídico",
  "Facilities & Compras",
  "Sistema & Dados",
  "Editais",
  "Recargas",
  "Outros",
] as const;
export type Area = (typeof AREAS)[number];

/** "Outros" não é uma área: é o que ainda não foi classificado. A revisão em
 *  lote existe para esvaziá-la, então ela nunca é oferecida como destino padrão. */
export const AREA_NAO_CLASSIFICADA = "Outros";

export const NATUREZA_COR: Record<string, string> = {
  "Operacional": "#3b82f6",
  "Estratégico": "#8b5cf6",
  "Automação": "#22c55e",
};

/* Uma cor por área, fixa pelo índice: se a paleta girasse conforme a ordem dos
   dados, a mesma área trocaria de cor entre uma semana e outra e a comparação
   de olho — que é como esse gráfico é lido — deixaria de valer. */
const PALETA = [
  "#3b82f6", "#14b8a6", "#8b5cf6", "#22c55e", "#f59e0b", "#f43f5e",
  "#0ea5e9", "#a855f7", "#84cc16", "#ec4899", "#f97316", "#06b6d4", "#64748b",
];

export function corDaArea(area: string): string {
  const i = (AREAS as readonly string[]).indexOf(area);
  return i >= 0 ? PALETA[i % PALETA.length] : "#64748b";
}

/** Texto curto para o chip do card e para o que a busca varre. */
export function rotuloClassificacao(t: {
  cat_natureza?: string | null;
  cat_area?: string | null;
  rotina?: boolean | null;
}): string {
  return [t.cat_natureza, t.cat_area, t.rotina ? "rotina" : ""].filter(Boolean).join(" ");
}
