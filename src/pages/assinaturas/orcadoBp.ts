/**
 * Orçado da aba "Operação" do BP (`bp_anual.abas["Operação"]`), para confrontar com o
 * realizado nas duas abas de /assinaturas.
 *
 * A aba tem os rótulos na coluna A e os doze meses nas colunas D..O (índices 3..14). O
 * bloco do topo é o consolidado ($ MRR, clientes BoP/EoP, perdidos, churn) e mais abaixo
 * há um bloco por porte ("Receita Recorrente Clientes P/M/G/GG") com os mesmos rótulos
 * repetidos — por isso o consolidado é lido só ATÉ o primeiro bloco de porte.
 *
 * ⚠️ O BP foi reancorado no realizado de junho/2026 (na revisão do 2º semestre): a coluna
 * de junho tem BoP = EoP e os clientes por porte são exatamente os do snapshot Jun 26. Os
 * meses anteriores são a projeção original, e a comparação com eles vale menos — daí o
 * `pre_revisao`. A âncora é detectada, não fixada, para sobreviver a uma nova revisão.
 *
 * Alinhamento de mês (sem defasagem nas duas abas):
 *   Recorrência competência M ↔ EoP do mês M do BP
 *   Churn mês M               ↔ clientes perdidos / churn do mês M do BP
 *
 * Base de comparação do MRR: `mrr_recorrente` = soma dos quatro portes, que é o
 * equivalente do `mrr_core` realizado (nenhum dos dois tem Banestes nem aluguéis). A linha
 * "$ MRR" do BP fica em `mrr_bp` porque inclui a Receita Banestes.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type NivelBP = "P" | "M" | "G" | "GG";

export type PorteBP = {
  nivel: NivelBP;
  mrr: number;
  clientes_bop: number;
  clientes_eop: number;
  novos: number;
  /** Positivo (na planilha vem negativo). */
  perdidos: number;
  ticket: number;
  /** Em pontos percentuais (3,68 = 3,68%). */
  churn_pct: number;
};

export type MesBP = {
  mes: number;
  mes_nome: string;
  competencia: string;
  /** Mês anterior à reancoragem — projeção original, comparação menos significativa. */
  pre_revisao: boolean;
  /** Mês em que o BP foi reancorado no realizado (fecha em zero por construção). */
  ancora: boolean;
  /** Soma dos quatro portes — comparável ao `mrr_core` realizado. */
  mrr_recorrente: number;
  /** Linha "$ MRR" da planilha (recorrente + Banestes). */
  mrr_bp: number;
  banestes: number;
  receita_bruta: number;
  spot: number;
  clientes_bop: number;
  clientes_eop: number;
  novos: number;
  perdidos: number;
  novo_mrr: number;
  /** MRR recorrente / clientes EoP. */
  ticket: number;
  churn_valor: number | null;
  /** Em pontos percentuais. */
  churn_pct: number | null;
  portes: PorteBP[];
};

const NIVEIS: NivelBP[] = ["P", "M", "G", "GG"];
const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (v: unknown) => semAcento(String(v ?? "").trim().toLowerCase()).replace(/\s+/g, " ");

function num(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[R$\s%]/g, "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
const vazio = () => Array<number>(12).fill(0);

/** Os doze meses de uma linha (colunas D..O). */
const meses = (linha: unknown[] | undefined) =>
  linha ? Array.from({ length: 12 }, (_, i) => num(linha[i + 3])) : vazio();

/** Como `meses`, mas devolve null onde a célula está vazia (ex.: % Churn de janeiro). */
const mesesOuNulo = (linha: unknown[] | undefined) =>
  linha
    ? Array.from({ length: 12 }, (_, i) => {
        const c = linha[i + 3];
        return c == null || c === "" ? null : num(c);
      })
    : Array<number | null>(12).fill(null);

/** Primeira linha com esse rótulo dentro de uma faixa. */
function achar(linhas: unknown[][], rotulo: string, de = 0, ate = Infinity): unknown[] | undefined {
  const alvo = chave(rotulo);
  for (let i = de; i < Math.min(linhas.length, ate); i++) {
    if (chave(linhas[i]?.[0]) === alvo) return linhas[i];
  }
  return undefined;
}

export function parsearOperacao(aba: unknown, ano: number): Map<string, MesBP> {
  const mapa = new Map<string, MesBP>();
  const linhas = Array.isArray(aba) ? (aba as unknown[][]) : [];
  if (!linhas.length) return mapa;

  const ehCabecalhoDePorte = (l: unknown[]) => chave(l?.[0]).startsWith("receita recorrente clientes ");
  const primeiroPorte = linhas.findIndex(ehCabecalhoDePorte);
  const fimConsolidado = primeiroPorte === -1 ? linhas.length : primeiroPorte;

  const receita_bruta = meses(achar(linhas, "$ Receita Bruta", 0, fimConsolidado));
  const mrr_bp = meses(achar(linhas, "$ MRR", 0, fimConsolidado));
  const spot = meses(achar(linhas, "$ Receita Spot", 0, fimConsolidado));
  const clientes_bop = meses(achar(linhas, "# Número de Clientes BoP", 0, fimConsolidado));
  const clientes_eop = meses(achar(linhas, "# Número de Clientes EoP", 0, fimConsolidado));
  const novos = meses(achar(linhas, "# Número de novos Clientes", 0, fimConsolidado));
  const perdidos = meses(achar(linhas, "# Número de Clientes perdidos", 0, fimConsolidado));
  const novo_mrr = meses(achar(linhas, "# Novo MRR", 0, fimConsolidado));
  const banestes = meses(achar(linhas, "Receita Banestes"));

  // "% Churn Mensal" é vazio em janeiro (não há mês anterior dentro do plano) e a linha
  // "# Churn Mensal" carrega lixo nessa coluna — então janeiro fica sem churn orçado.
  const churnPct = mesesOuNulo(achar(linhas, "% Churn Mensal", 0, fimConsolidado));
  const churnValorCru = meses(achar(linhas, "# Churn Mensal", 0, fimConsolidado));

  // Blocos por porte: do cabeçalho até o próximo cabeçalho de porte (ou o fim do trecho).
  const cabecalhos = linhas
    .map((l, i) => (ehCabecalhoDePorte(l) ? i : -1))
    .filter((i) => i >= 0);
  type BlocoPorte = {
    nivel: NivelBP;
    mrr: number[]; bop: number[]; eop: number[];
    novos: number[]; perdidos: number[]; ticket: number[]; churn: number[];
  };
  const portes: BlocoPorte[] = [];
  for (const nivel of NIVEIS) {
    const de = linhas.findIndex((l) => chave(l?.[0]) === chave(`Receita Recorrente Clientes ${nivel}`));
    if (de === -1) continue;
    const ate = cabecalhos.find((i) => i > de) ?? de + 16;
    portes.push({
      nivel,
      mrr: meses(linhas[de]),
      bop: meses(achar(linhas, "# Número de Clientes BoP", de, ate)),
      eop: meses(achar(linhas, "# Número de Clientes EoP", de, ate)),
      novos: meses(achar(linhas, "# Número de novos Clientes", de, ate)),
      perdidos: meses(achar(linhas, "# Número de Clientes perdidos", de, ate)),
      ticket: meses(achar(linhas, "$ Ticket médio por cliente", de, ate)),
      churn: meses(achar(linhas, "% Churn", de, ate)),
    });
  }

  // Mês âncora: o único em que BoP = EoP, porque o plano foi reescrito a partir do
  // realizado daquele mês. Antes dele, a comparação é contra a projeção antiga.
  const ancoraIdx = clientes_bop.findIndex((b, i) => b > 0 && Math.round(b) === Math.round(clientes_eop[i]));

  for (let i = 0; i < 12; i++) {
    if (!clientes_eop[i] && !mrr_bp[i]) continue;
    const linhasPorte: PorteBP[] = portes.map((p) => ({
      nivel: p.nivel,
      mrr: p.mrr[i],
      clientes_bop: Math.round(p.bop[i]),
      clientes_eop: Math.round(p.eop[i]),
      novos: Math.round(p.novos[i]),
      perdidos: Math.abs(Math.round(p.perdidos[i])),
      ticket: p.ticket[i],
      churn_pct: p.churn[i] * 100,
    }));
    const mrr_recorrente = linhasPorte.reduce((a, p) => a + p.mrr, 0);
    const eop = Math.round(clientes_eop[i]);

    mapa.set(`${ano}-${String(i + 1).padStart(2, "0")}-01`, {
      mes: i + 1,
      mes_nome: MESES_PT[i],
      competencia: `${ano}-${String(i + 1).padStart(2, "0")}-01`,
      pre_revisao: ancoraIdx > 0 && i < ancoraIdx,
      ancora: i === ancoraIdx,
      mrr_recorrente,
      mrr_bp: mrr_bp[i],
      banestes: banestes[i],
      receita_bruta: receita_bruta[i],
      spot: spot[i],
      clientes_bop: Math.round(clientes_bop[i]),
      clientes_eop: eop,
      novos: Math.round(novos[i]),
      perdidos: Math.abs(Math.round(perdidos[i])),
      novo_mrr: novo_mrr[i],
      ticket: eop ? mrr_recorrente / eop : 0,
      churn_valor: churnPct[i] == null ? null : churnValorCru[i],
      churn_pct: churnPct[i] == null ? null : (churnPct[i] as number) * 100,
      portes: linhasPorte,
    });
  }

  return mapa;
}

export type OrcadoBP = {
  carregando: boolean;
  existe: boolean;
  meses: Map<string, MesBP>;
  /** Rótulo do mês em que o plano foi reancorado ("Jun"), ou null. */
  ancora: MesBP | null;
};

export function useOrcadoBp(ano: number): OrcadoBP {
  const [meses, setMeses] = useState<Map<string, MesBP>>(new Map());
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await supabase
        .from("bp_anual" as any)
        .select("abas")
        .eq("ano", ano)
        .maybeSingle();
      const abas = (data as { abas?: Record<string, unknown> } | null)?.abas;
      setMeses(parsearOperacao(abas?.["Operação"], ano));
    } catch {
      setMeses(new Map());
    } finally {
      setCarregando(false);
    }
  }, [ano]);

  useEffect(() => { void carregar(); }, [carregar]);

  return {
    carregando,
    existe: meses.size > 0,
    meses,
    ancora: Array.from(meses.values()).find((m) => m.ancora) ?? null,
  };
}

/* ------------------------------ comparação ------------------------------ */
export type Desvio = { abs: number; pct: number | null; acima: boolean };

/** Desvio do realizado contra o orçado. `pct` é null quando não há orçado. */
export function desvio(real: number, orcado: number | null | undefined): Desvio | null {
  if (orcado == null || !isFinite(orcado)) return null;
  const abs = real - orcado;
  return { abs, pct: orcado === 0 ? null : (abs / orcado) * 100, acima: abs >= 0 };
}
