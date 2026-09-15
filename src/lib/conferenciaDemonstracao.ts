/* ---------------------------------------------------------------------------
 * Conferência: as categorias do Omie × o que a DRE/DFC mostra, rubrica a rubrica.
 *
 * O plano de contas soma as categorias pela regra do omie-sync, e cada categoria
 * cai numa rubrica pelo DE-PARA. Somando por rubrica, o número TEM de ser o da
 * demonstração — a menos que ela não venha do Omie naquele mês. O Hub tem duas
 * razões legítimas para isso, e a conferência diz qual é:
 *
 *   • VALOR DIGITADO (`demonstracoes_valor_manual`) — alguém substituiu ou somou
 *     à célula (Meios de Pagamento, impostos, receita ajustada…);
 *   • MÊS TRAVADO (`demonstracoes_mes_trancado`) — a coluna veio do tracker e o
 *     omie-sync não a reescreve mais.
 *
 * Divergência que não é nenhuma das duas é a que merece olho: DE-PARA mudado
 * depois do último recálculo, lançamento que o Omie alterou, sync que não rodou.
 * Medido em 15/09/2026: das rubricas de jul e ago/26, 29 batiam exatas e quase
 * todas as outras tinham valor digitado.
 *
 * A LEITURA DA DEMONSTRAÇÃO É A DA TELA: rubrica com filhos no esquema soma os
 * filhos (o blob guarda o pai velho), e a folha aceita os apelidos do esquema.
 * Ler o blob cru mostraria divergência onde a tela não tem nenhuma.
 * ------------------------------------------------------------------------- */

import {
  DFC_SCHEMA, DRE_SCHEMA, chaveRubrica, indexarCelulas, rotulosDoNo, type Node,
} from "./demonstracoes-schema";
import { chaveDoMes, type TipoDemonstracao } from "./linksPlanoContas";
import type { CategoriaPlano, CelulaMensal } from "./planoContas";

export type SituacaoConferencia = "bate" | "manual" | "travado" | "diverge";

export type CelulaConferencia = {
  /** "2026-08" */
  mes: string;
  /** "Aug-26" */
  chave: string;
  omie: number;
  demonstracao: number | null;
  /** demonstração − Omie */
  diferenca: number;
  situacao: SituacaoConferencia;
};

export type LinhaConferencia = {
  rubrica: string;
  categorias: { codigo: string; descricao: string }[];
  celulas: CelulaConferencia[];
  /** células que divergem SEM explicação */
  divergentes: number;
  /** soma, em módulo, das diferenças sem explicação */
  valorDivergente: number;
};

export type Conferencia = {
  linhas: LinhaConferencia[];
  resumo: Record<SituacaoConferencia, number> & { valorDivergente: number };
};

function achar(nodes: Node[], chave: string): Node | null {
  for (const n of nodes) {
    if (chaveRubrica(n.label) === chave || rotulosDoNo(n).some((r) => chaveRubrica(r) === chave)) return n;
    const f = n.children ? achar(n.children, chave) : null;
    if (f) return f;
  }
  return null;
}

/**
 * Um leitor da demonstração com a regra da tela. Devolve null quando a célula
 * está vazia — "—" e "R$ 0,00" são coisas diferentes para quem confere.
 */
export function leitorDaDemonstracao(
  rows: Record<string, unknown>[],
  columns: string[],
  tipo: TipoDemonstracao,
): (rubrica: string, chave: string) => number | null {
  const idx = indexarCelulas(rows, columns);
  const schema = tipo === "dre" ? DRE_SCHEMA : DFC_SCHEMA;
  const ler = (rotulo: string, col: string) => idx.get(rotulo.trim().toLowerCase())?.[col] ?? null;

  const valorDoNo = (n: Node, col: string): number | null => {
    if (n.children?.length) {
      let total: number | null = null;
      for (const c of n.children) {
        const v = valorDoNo(c, col);
        if (v != null) total = (total ?? 0) + v;
      }
      return total;
    }
    for (const r of rotulosDoNo(n)) {
      const v = ler(r, col);
      if (v != null) return v;
    }
    return null;
  };

  return (rubrica, chave) => {
    const no = achar(schema, chaveRubrica(rubrica));
    return no ? valorDoNo(no, chave) : ler(rubrica, chave);
  };
}

/** Diferença até R$ 1 é arredondamento do tracker, não divergência. */
const TOLERANCIA = 1;

export function montarConferencia(o: {
  tipo: TipoDemonstracao;
  categorias: CategoriaPlano[];
  mensal: CelulaMensal[];
  /** "YYYY-MM" */
  meses: string[];
  lerDemonstracao: (rubrica: string, chave: string) => number | null;
  /** chaves "Aug-26" */
  travados: Set<string>;
  /** `${rubrica}|${chave}` — a rubrica como gravada no valor manual */
  manuais: Set<string>;
}): Conferencia {
  const campo = o.tipo === "dre" ? "rubrica_dre" : "rubrica_dfc";
  const porRubrica = new Map<string, { rubrica: string; categorias: { codigo: string; descricao: string }[] }>();
  const rubricaDaCategoria = new Map<string, string>();
  for (const c of o.categorias) {
    const r = c[campo];
    if (!r || c.totalizadora) continue;
    const k = chaveRubrica(r);
    let g = porRubrica.get(k);
    if (!g) porRubrica.set(k, (g = { rubrica: r, categorias: [] }));
    g.categorias.push({ codigo: c.codigo, descricao: c.descricao });
    rubricaDaCategoria.set(c.codigo, k);
  }

  const meses = new Set(o.meses);
  const somas = new Map<string, number>();
  for (const [codigo, mes, v] of o.mensal) {
    if (!meses.has(mes)) continue;
    const k = rubricaDaCategoria.get(codigo);
    if (!k) continue;
    const chave = `${k}|${mes}`;
    somas.set(chave, (somas.get(chave) ?? 0) + Number(v));
  }

  const manuais = new Set([...o.manuais].map((m) => {
    const i = m.lastIndexOf("|");
    return `${chaveRubrica(m.slice(0, i))}|${m.slice(i + 1)}`;
  }));

  const resumo = { bate: 0, manual: 0, travado: 0, diverge: 0, valorDivergente: 0 };
  const linhas: LinhaConferencia[] = [];

  for (const [k, g] of porRubrica) {
    const celulas = o.meses.map((mes): CelulaConferencia => {
      const chave = chaveDoMes(mes);
      const omie = Math.round((somas.get(`${k}|${mes}`) ?? 0) * 100) / 100;
      const demonstracao = o.lerDemonstracao(g.rubrica, chave);
      const diferenca = Math.round(((demonstracao ?? 0) - omie) * 100) / 100 || 0;
      const situacao: SituacaoConferencia = Math.abs(diferenca) <= TOLERANCIA ? "bate"
        : manuais.has(`${k}|${chave}`) ? "manual"
          : o.travados.has(chave) ? "travado"
            : "diverge";
      return { mes, chave, omie, demonstracao, diferenca, situacao };
    });
    // Rubrica sem nada dos dois lados na janela não entra: seria uma linha de "—".
    if (celulas.every((c) => Math.abs(c.omie) < 0.005 && (c.demonstracao == null || Math.abs(c.demonstracao) < 0.005))) continue;

    for (const c of celulas) resumo[c.situacao]++;
    const divergentes = celulas.filter((c) => c.situacao === "diverge");
    const valorDivergente = divergentes.reduce((s, c) => s + Math.abs(c.diferenca), 0);
    resumo.valorDivergente += valorDivergente;
    linhas.push({
      rubrica: g.rubrica,
      categorias: g.categorias.sort((a, b) => a.codigo.localeCompare(b.codigo)),
      celulas,
      divergentes: divergentes.length,
      valorDivergente,
    });
  }

  linhas.sort((a, b) => b.valorDivergente - a.valorDivergente || a.rubrica.localeCompare(b.rubrica));
  return { linhas, resumo };
}

/* ───────────────────────── Saúde do DE-PARA ───────────────────────── */

/** Uma linha de `plano_contas_de_para_saude`. */
export type SaudeDePara = {
  id: string;
  codigo_categoria: string;
  rubrica: string;
  demonstrativo: "dre" | "dfc" | "ambos";
  /** código da categoria atual com este nome; null = o nome não existe mais no Omie */
  codigo: string | null;
  inativa: boolean | null;
  sugestao_codigo: string | null;
  sugestao_descricao: string | null;
  /** "pontuacao" = só pontuação diferente; "numero" = mesmo nome, numeração diferente */
  sugestao_motivo: "pontuacao" | "numero" | null;
  /** a categoria sugerida já tem linha própria neste demonstrativo */
  sugestao_ja_mapeada: boolean | null;
};

export type ResumoSaude = {
  orfas: SaudeDePara[];
  /** conserto quase certo: só a pontuação mudou e a atual ainda não tem linha */
  apontaveis: number;
  /** a atual já tem linha — a órfã é duplicata e pode sair */
  duplicadas: number;
  /** nome igual, número diferente: pede conferência */
  aConferir: number;
  semPar: number;
};

export function resumirSaude(linhas: SaudeDePara[], tipo?: TipoDemonstracao): ResumoSaude {
  const orfas = linhas.filter((l) => !l.codigo && (!tipo || l.demonstrativo === tipo || l.demonstrativo === "ambos"));
  return {
    orfas,
    apontaveis: orfas.filter((l) => l.sugestao_motivo === "pontuacao" && !l.sugestao_ja_mapeada).length,
    duplicadas: orfas.filter((l) => l.sugestao_codigo && l.sugestao_ja_mapeada).length,
    aConferir: orfas.filter((l) => l.sugestao_motivo === "numero" && !l.sugestao_ja_mapeada).length,
    semPar: orfas.filter((l) => !l.sugestao_codigo).length,
  };
}
