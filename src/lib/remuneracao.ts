/**
 * A leitura da remuneração — degraus, resumo e recorte.
 *
 * Tudo aqui é função pura sobre o bloco que `remuneracao_painel()` devolve. Não
 * há Supabase, React nem formatação de moeda: é o que a tela pergunta ao dado,
 * escrito num lugar que dá para testar.
 */

export type MesRemuneracao = {
  /** Primeiro dia do mês trabalhado, ISO: "2026-03-01". */
  competencia: string;
  fixo: number;
  premiacao: number;
  escala: number;
  outro: number;
  total: number;
  /** Quais fontes formaram o mês ("omie", "omie+conta_azul"…). */
  fontes: string | null;
};

export type PessoaRemuneracao = {
  id: string;
  nome: string;
  codigo_rh: string | null;
  doc: string | null;
  eh_pessoa: boolean;
  cargo: string | null;
  setor: string | null;
  modalidade: string | null;
  /** Texto cru do espelho do RH — pode não ser data válida. */
  inicio: string | null;
  datadesl: string | null;
  valor_contrato: number | null;
  meses: MesRemuneracao[];
};

export type PainelRemuneracao = {
  meses: string[];
  pessoas: PessoaRemuneracao[];
  gerado_em: string;
};

/** Um reajuste: o fixo mudou de um mês pago para o seguinte. */
export type Degrau = {
  competencia: string;
  de: number;
  para: number;
  /** Variação relativa (0.125 = +12,5%). */
  variacao: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

/** "2026-03-01" → "mar/26". Fora do padrão, devolve o que veio. */
export function rotuloMes(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  // `||` e não `??`: competência vazia é string vazia, não nulo, e "" renderiza
  // uma célula em branco onde deveria estar o travessão.
  if (!m) return iso || "—";
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const mes = nomes[Number(m[2]) - 1];
  return mes ? `${mes}/${m[1].slice(2)}` : iso;
}

/** Quantos meses inteiros separam duas competências ISO. */
export function distanciaEmMeses(de: string, ate: string): number | null {
  const a = /^(\d{4})-(\d{2})/.exec(de ?? "");
  const b = /^(\d{4})-(\d{2})/.exec(ate ?? "");
  if (!a || !b) return null;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
}

/**
 * Os degraus do fixo ao longo dos meses pagos.
 *
 * Compara meses PAGOS consecutivos, não meses de calendário: quem ficou sem
 * receber em maio e voltou em junho tem um degrau maio→junho, não dois.
 *
 * O primeiro e o último mês da série são ignorados como origem de degrau
 * quando o valor é MENOR que o vizinho: mês de entrada e mês de saída são
 * proporcionais aos dias trabalhados, e contá-los produziria um "aumento de
 * 180%" no segundo mês de casa que não é aumento nenhum. Um degrau de queda no
 * meio da série continua aparecendo — esse é real e alguém deve olhar.
 */
export function degrausDoFixo(meses: MesRemuneracao[]): Degrau[] {
  const pagos = meses.filter((m) => num(m.fixo) > 0);
  if (pagos.length < 2) return [];

  const out: Degrau[] = [];
  for (let i = 1; i < pagos.length; i++) {
    const de = num(pagos[i - 1].fixo);
    const para = num(pagos[i].fixo);
    if (de === para) continue;

    // Primeiro mês menor que o seguinte: entrada proporcional, não é degrau.
    if (i === 1 && de < para * 0.95) continue;
    // Último mês menor que o anterior: saída proporcional, não é degrau.
    if (i === pagos.length - 1 && para < de * 0.95) continue;

    out.push({ competencia: pagos[i].competencia, de, para, variacao: (para - de) / de });
  }
  return out;
}

export type ResumoPessoa = {
  /** O fixo do último mês em que a pessoa recebeu fixo. */
  fixoAtual: number | null;
  ultimoMes: string | null;
  /** Média da premiação nos meses em que houve premiação (0 se nunca houve). */
  premiacaoMedia: number;
  mesesComPremiacao: number;
  /** Soma de tudo, todos os meses conhecidos. */
  totalPeriodo: number;
  degraus: Degrau[];
  ultimoReajuste: Degrau | null;
  /** Meses entre o último reajuste e o último mês pago. Null se nunca houve. */
  mesesSemReajuste: number | null;
  /**
   * Quanto o Portal RH está atrasado em relação ao que o Omie pagou.
   *
   * O OMIE É A VOZ DA VERDADE para salário: o que a pessoa ganha é o que saiu
   * do ERP, não o que está escrito na ficha do RH. `fixoAtual` já vem do Omie —
   * este campo existe só para acusar a ficha desatualizada, que é quase sempre
   * aditivo que ninguém lançou lá. Foi o caso do próprio diretor de receita:
   * contrato de R$ 20.000 no Portal RH, pagamento de R$ 22.500 desde julho/2026.
   *
   * Positivo = o RH está atrás do pagamento. Null quando não há ficha a comparar
   * — e a ausência de ficha nunca invalida o número do Omie.
   */
  divergenciaContrato: number | null;
  ativo: boolean;
};

export function resumoDaPessoa(p: PessoaRemuneracao): ResumoPessoa {
  const meses = [...(p.meses ?? [])].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const comFixo = meses.filter((m) => num(m.fixo) > 0);
  const ultimo = comFixo[comFixo.length - 1] ?? null;
  const comPremiacao = meses.filter((m) => num(m.premiacao) > 0);

  const degraus = degrausDoFixo(meses);
  const ultimoReajuste = degraus[degraus.length - 1] ?? null;

  const fixoAtual = ultimo ? num(ultimo.fixo) : null;
  const contrato = p.valor_contrato == null ? null : num(p.valor_contrato);

  return {
    fixoAtual,
    ultimoMes: ultimo?.competencia ?? null,
    premiacaoMedia: comPremiacao.length
      ? comPremiacao.reduce((s, m) => s + num(m.premiacao), 0) / comPremiacao.length
      : 0,
    mesesComPremiacao: comPremiacao.length,
    totalPeriodo: meses.reduce((s, m) => s + num(m.total), 0),
    degraus,
    ultimoReajuste,
    mesesSemReajuste:
      ultimoReajuste && ultimo
        ? distanciaEmMeses(ultimoReajuste.competencia, ultimo.competencia)
        : null,
    divergenciaContrato:
      contrato != null && contrato > 0 && fixoAtual != null ? fixoAtual - contrato : null,
    ativo: !p.datadesl,
  };
}

export type Filtros = {
  busca: string;
  /** Inclui quem já saiu (tem data de desligamento ou parou de receber). */
  incluirSaidas: boolean;
  /** Inclui favorecidos que não são pessoas (empresa que caiu na categoria). */
  incluirNaoPessoas: boolean;
  /** Só quem tem ficha no Portal RH. */
  soComFichaRh: boolean;
  setor: string | null;
};

/** Texto que a busca varre por pessoa — nome, cargo, setor e código do RH. */
const alvoDaBusca = (p: PessoaRemuneracao) =>
  [p.nome, p.cargo, p.setor, p.codigo_rh].filter(Boolean).join(" ").toLowerCase();

export function filtrarPessoas(
  pessoas: PessoaRemuneracao[],
  f: Filtros,
  ultimaCompetencia: string | null,
): PessoaRemuneracao[] {
  const termo = f.busca.trim().toLowerCase();
  return pessoas.filter((p) => {
    if (!f.incluirNaoPessoas && !p.eh_pessoa) return false;
    if (f.soComFichaRh && !p.codigo_rh) return false;
    if (f.setor && p.setor !== f.setor) return false;

    if (!f.incluirSaidas) {
      if (p.datadesl) return false;
      // Sem data de desligamento mas sem receber no último mês conhecido: saiu
      // e o Portal RH não registrou, ou nunca teve ficha lá. São 50 pessoas
      // hoje — a maioria de quem foi removida do RH ao sair.
      const ultimo = p.meses?.[p.meses.length - 1]?.competencia ?? null;
      if (ultimaCompetencia && ultimo && ultimo < ultimaCompetencia) return false;
    }

    if (termo && !alvoDaBusca(p).includes(termo)) return false;
    return true;
  });
}

/** Soma de um mês entre as pessoas dadas. */
export function totaisDoMes(pessoas: PessoaRemuneracao[], competencia: string) {
  let fixo = 0, premiacao = 0, escala = 0, outro = 0, gente = 0;
  for (const p of pessoas) {
    const m = p.meses?.find((x) => x.competencia === competencia);
    if (!m) continue;
    gente++;
    fixo += num(m.fixo);
    premiacao += num(m.premiacao);
    escala += num(m.escala);
    outro += num(m.outro);
  }
  return { fixo, premiacao, escala, outro, total: fixo + premiacao + escala + outro, gente };
}

export type CelulaPlanilha = string | number | null;

/**
 * A planilha: uma linha por pessoa, uma coluna por mês.
 *
 * Formato largo de propósito — é o que se manipula numa planilha. Cada mês vira
 * três colunas (fixo, premiação, total) porque separar isso depois, no Excel, é
 * o trabalho que este painel existe para poupar.
 *
 * Número sai como NÚMERO, não como texto formatado: quem recebe o arquivo vai
 * somar, ordenar e fazer gráfico em cima dele. "R$ 1.234,56" não vira número em
 * lugar nenhum, e uma coluna de texto alinhada à esquerda é o sintoma que
 * aparece só depois que alguém já montou a tabela dinâmica.
 *
 * Célula vazia é `null` e não zero: a pessoa que não recebeu naquele mês não
 * ganhou zero — ela não estava lá. A diferença some numa média.
 */
export function matrizParaPlanilha(
  pessoas: PessoaRemuneracao[],
  meses: string[],
): CelulaPlanilha[][] {
  const cabecalho = [
    "Nome", "Código RH", "Cargo", "Setor", "Modalidade", "Início", "Desligamento",
    "Valor de contrato", "Fixo atual", "Último reajuste", "Variação %", "Meses sem reajuste",
    ...meses.flatMap((m) => [
      `${rotuloMes(m)} fixo`, `${rotuloMes(m)} premiação`, `${rotuloMes(m)} total`,
    ]),
  ];

  const linhas = pessoas.map((p): CelulaPlanilha[] => {
    const r = resumoDaPessoa(p);
    const porMes = new Map((p.meses ?? []).map((m) => [m.competencia, m]));
    return [
      p.nome,
      p.codigo_rh ?? null,
      p.cargo ?? null,
      p.setor ?? null,
      p.modalidade ?? null,
      p.inicio ?? null,
      p.datadesl ?? null,
      p.valor_contrato == null ? null : num(p.valor_contrato),
      r.fixoAtual,
      r.ultimoReajuste ? rotuloMes(r.ultimoReajuste.competencia) : null,
      r.ultimoReajuste ? Number((r.ultimoReajuste.variacao * 100).toFixed(1)) : null,
      r.mesesSemReajuste,
      ...meses.flatMap((m): CelulaPlanilha[] => {
        const x = porMes.get(m);
        if (!x) return [null, null, null];
        return [num(x.fixo) || null, num(x.premiacao) || null, num(x.total) || null];
      }),
    ];
  });

  return [cabecalho, ...linhas];
}

/**
 * A mesma matriz em CSV, para quem prefere texto ao .xlsx.
 *
 * Ponto decimal, não vírgula: o Excel em pt-BR entende a vírgula, mas qualquer
 * outra coisa que leia o arquivo não.
 */
export function paraCsv(pessoas: PessoaRemuneracao[], meses: string[]): string {
  const sep = ";";
  const cel = (v: CelulaPlanilha) => {
    if (v == null) return "";
    if (typeof v === "number") return v.toFixed(2);
    return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  // BOM na frente: sem ele o Excel abre o CSV em ANSI e "Remuneração" vira
  // "RemuneraÃ§Ã£o" na primeira coluna que alguém for ler.
  return "﻿" + matrizParaPlanilha(pessoas, meses).map((l) => l.map(cel).join(sep)).join("\n");
}
