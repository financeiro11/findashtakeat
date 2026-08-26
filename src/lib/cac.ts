/* ---------------------------------------------------------------------------
 * Painel CAC — a lógica que não depende da tela.
 *
 * Mora aqui, e não dentro do componente, pelo motivo de sempre neste repo: a
 * suíte de testes não monta React (falta @testing-library/dom), então o que
 * precisa de teste tem de ser um módulo .ts puro.
 * ------------------------------------------------------------------------- */

export const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"] as const;

/** A ordem em que os grupos aparecem, que não é alfabética nem vem do banco. */
export const GRUPOS = ["Equipes", "Investimentos", "Comissões"] as const;
export type Grupo = (typeof GRUPOS)[number];

export type CelulaOrigem = "omie" | "manual";

export type PainelRow = {
  linha_id: string;
  grupo: string;
  rotulo: string;
  ordem: number;
  regra_nota: string | null;
  mes: number;
  valor: number;
  origem: CelulaOrigem;
};

export type Linha = {
  id: string;
  grupo: string;
  rotulo: string;
  ordem: number;
  departamentos: string[];
  categorias: string[];
  regra_nota: string | null;
  ativo: boolean;
};

export type Pessoa = {
  id: string;
  cnpj: string;
  nome: string;
  departamento: string;
  categoria_omie: string | null;
  remuneracao: number | null;
  planilha_comissao: string | null;
  observacao: string | null;
  ativo: boolean;
};

export type Lancamento = {
  tipo: "lancamento" | "sem_pagamento";
  cod_titulo: number | null;
  data_pagamento: string | null;
  cnpj: string;
  pessoa: string | null;
  favorecido: string | null;
  departamento: string | null;
  categoria: string | null;
  categoria_descricao: string | null;
  natureza: "folha" | "comissão" | null;
  valor: number;
};

/* --------------------------------------------------------------------------
 * A matriz.
 * ------------------------------------------------------------------------ */

export type LinhaMatriz = {
  linha_id: string;
  grupo: string;
  rotulo: string;
  ordem: number;
  regra_nota: string | null;
  /** 12 posições, índice 0 = janeiro. */
  meses: number[];
  origens: CelulaOrigem[];
  total: number;
};

/**
 * Vira a resposta longa da RPC (uma linha por célula) na matriz que a tela
 * desenha. O total do ano soma os 12 meses — inclusive os manuais, que é o
 * ponto de existirem.
 */
export function montarMatriz(rows: PainelRow[]): LinhaMatriz[] {
  const porLinha = new Map<string, LinhaMatriz>();

  for (const r of rows) {
    let m = porLinha.get(r.linha_id);
    if (!m) {
      m = {
        linha_id: r.linha_id,
        grupo: r.grupo,
        rotulo: r.rotulo,
        ordem: r.ordem,
        regra_nota: r.regra_nota,
        meses: Array(12).fill(0),
        origens: Array(12).fill("omie") as CelulaOrigem[],
        total: 0,
      };
      porLinha.set(r.linha_id, m);
    }
    const i = r.mes - 1;
    if (i < 0 || i > 11) continue;
    m.meses[i] = Number(r.valor) || 0;
    m.origens[i] = r.origem;
  }

  for (const m of porLinha.values()) {
    m.total = m.meses.reduce((a, b) => a + b, 0);
  }

  return [...porLinha.values()].sort((a, b) => a.ordem - b.ordem);
}

export type GrupoMatriz = {
  grupo: string;
  linhas: LinhaMatriz[];
  /** Soma das linhas do grupo, mês a mês — a linha de subtotal. */
  meses: number[];
  total: number;
};

/**
 * Agrupa e soma. A ordem dos grupos segue GRUPOS; um grupo que apareça no banco
 * e não esteja na lista vai para o fim em vez de sumir — é assim que uma linha
 * nova criada na tela continua visível mesmo antes de alguém pensar na ordem.
 */
export function agruparMatriz(linhas: LinhaMatriz[]): GrupoMatriz[] {
  const porGrupo = new Map<string, LinhaMatriz[]>();
  for (const l of linhas) {
    const lista = porGrupo.get(l.grupo);
    if (lista) lista.push(l);
    else porGrupo.set(l.grupo, [l]);
  }

  const peso = (g: string) => {
    const i = (GRUPOS as readonly string[]).indexOf(g);
    return i === -1 ? GRUPOS.length : i;
  };

  return [...porGrupo.entries()]
    .sort((a, b) => peso(a[0]) - peso(b[0]) || a[0].localeCompare(b[0], "pt-BR"))
    .map(([grupo, ls]) => {
      const meses = Array(12).fill(0) as number[];
      for (const l of ls) for (let i = 0; i < 12; i++) meses[i] += l.meses[i];
      return { grupo, linhas: ls, meses, total: meses.reduce((a, b) => a + b, 0) };
    });
}

/** A última linha da tabela: soma de todos os grupos. */
export function totalGeral(grupos: GrupoMatriz[]): { meses: number[]; total: number } {
  const meses = Array(12).fill(0) as number[];
  for (const g of grupos) for (let i = 0; i < 12; i++) meses[i] += g.meses[i];
  return { meses, total: meses.reduce((a, b) => a + b, 0) };
}

/* --------------------------------------------------------------------------
 * Drill-down.
 * ------------------------------------------------------------------------ */

export type PessoaAgrupada = {
  chave: string;
  pessoa: string;
  cnpj: string;
  folha: number;
  comissao: number;
  total: number;
  lancamentos: Lancamento[];
};

/**
 * Junta os lançamentos por pessoa. A chave é o CNPJ, não o nome: o mesmo CNPJ
 * aparece no Omie ora como "LUCAS SEGATTO SOARES 18591953770", ora como
 * "48.938.085 ISRAEL CARRE LEITAO", ora com o nome limpo — agrupar por nome
 * quebraria a mesma pessoa em três linhas.
 */
export function agruparPorPessoa(lancs: Lancamento[]): PessoaAgrupada[] {
  const porCnpj = new Map<string, PessoaAgrupada>();

  for (const l of lancs) {
    if (l.tipo !== "lancamento") continue;
    const chave = l.cnpj || l.favorecido || "?";
    let p = porCnpj.get(chave);
    if (!p) {
      p = {
        chave,
        pessoa: l.pessoa || l.favorecido || "(sem cadastro)",
        cnpj: l.cnpj,
        folha: 0,
        comissao: 0,
        total: 0,
        lancamentos: [],
      };
      porCnpj.set(chave, p);
    }
    const v = Number(l.valor) || 0;
    if (l.natureza === "comissão") p.comissao += v;
    else p.folha += v;
    p.total += v;
    p.lancamentos.push(l);
  }

  return [...porCnpj.values()].sort((a, b) => b.total - a.total);
}

export type ResumoCelula = {
  folha: number;
  comissao: number;
  total: number;
  /** Quem não recebeu no mês — a explicação mais comum de um valor baixo. */
  semPagamento: Lancamento[];
  /** Quanto essas pessoas deveriam ter recebido, pela remuneração cadastrada. */
  semPagamentoEsperado: number;
};

export function resumirCelula(lancs: Lancamento[]): ResumoCelula {
  let folha = 0;
  let comissao = 0;
  const semPagamento: Lancamento[] = [];

  for (const l of lancs) {
    if (l.tipo === "sem_pagamento") {
      semPagamento.push(l);
      continue;
    }
    const v = Number(l.valor) || 0;
    if (l.natureza === "comissão") comissao += v;
    else folha += v;
  }

  return {
    folha,
    comissao,
    total: folha + comissao,
    semPagamento,
    semPagamentoEsperado: semPagamento.reduce((a, l) => a + (Number(l.valor) || 0), 0),
  };
}

/* --------------------------------------------------------------------------
 * Exportação.
 * ------------------------------------------------------------------------ */

/**
 * A matriz no formato de planilha: cabeçalho, linhas de grupo, linhas de
 * detalhe e o total geral — o mesmo desenho da tela.
 *
 * Números saem como NÚMERO, não como "R$ 1.234,56". O destino é o import de
 * outro sistema; texto formatado chegaria lá como texto e não somaria.
 */
export function matrizParaAOA(grupos: GrupoMatriz[], ano: number): (string | number)[][] {
  const linhas: (string | number)[][] = [];
  linhas.push([`Painel CAC ${ano}`]);
  linhas.push([]);
  linhas.push(["Categoria", ...MESES, "Total Ano"]);

  for (const g of grupos) {
    linhas.push([g.grupo, ...g.meses, g.total]);
    for (const l of g.linhas) {
      linhas.push([l.rotulo, ...l.meses, l.total]);
    }
  }

  const tg = totalGeral(grupos);
  linhas.push(["Total Geral", ...tg.meses, tg.total]);
  return linhas;
}

/**
 * O formato analítico: uma linha por lançamento.
 *
 * Serve para conferência e para o import que quer agregar do lado de lá. Sem
 * ele, o único caminho de auditoria é clicar célula por célula na tela.
 */
export function lancamentosParaAOA(
  itens: (Lancamento & { grupo: string; rotulo: string; mes: number })[],
): (string | number)[][] {
  const linhas: (string | number)[][] = [
    ["Grupo", "Linha", "Mês", "Data", "Cód. Título", "CNPJ", "Pessoa", "Favorecido no Omie", "Departamento", "Categoria", "Descrição da categoria", "Natureza", "Valor"],
  ];
  for (const i of itens) {
    linhas.push([
      i.grupo,
      i.rotulo,
      MESES[i.mes - 1] ?? "",
      i.data_pagamento ?? "",
      i.cod_titulo ?? "",
      i.cnpj ?? "",
      i.pessoa ?? "",
      i.favorecido ?? "",
      i.departamento ?? "",
      i.categoria ?? "",
      i.categoria_descricao ?? "",
      i.natureza ?? "",
      Number(i.valor) || 0,
    ]);
  }
  return linhas;
}

/* --------------------------------------------------------------------------
 * Importação do painel antigo.
 * ------------------------------------------------------------------------ */

/**
 * Lê "R$ 286.355,44", "1.234,56", "-", "" e devolve número.
 *
 * O ponto é separador de milhar e a vírgula é decimal — trocar a ordem faria
 * R$ 286.355,44 virar 286,35544, e o erro passaria despercebido porque o
 * resultado continua sendo um número plausível.
 */
export function parseValorBR(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s || s === "-" || s === "—") return 0;

  const limpo = s.replace(/[R$\s ]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return isFinite(n) ? n : 0;
}

export type LinhaImportada = {
  grupo: string;
  rotulo: string;
  meses: number[];
};

/**
 * Lê a matriz exportada do painel antigo.
 *
 * ACOMPANHA O GRUPO CORRENTE enquanto desce as linhas, e é isso que salva a
 * importação: "Eventos" é uma linha em Equipes (o time) E outra em
 * Investimentos (a verba de feira). Casar só pelo rótulo jogaria as duas no
 * mesmo lugar e uma sobrescreveria a outra sem erro nenhum.
 *
 * Uma linha é cabeçalho de grupo quando o rótulo bate com um nome de grupo
 * conhecido; qualquer outra é detalhe do último grupo visto.
 */
export function parsePainelAOA(aoa: unknown[][]): LinhaImportada[] {
  const out: LinhaImportada[] = [];
  const grupos = new Set<string>(GRUPOS as readonly string[]);
  let grupoAtual = "";

  for (const linha of aoa ?? []) {
    if (!Array.isArray(linha) || !linha.length) continue;

    const rotulo = String(linha[0] ?? "").trim();
    if (!rotulo) continue;

    if (grupos.has(rotulo)) { grupoAtual = rotulo; continue; }

    // Cabeçalho, título e a linha de fechamento não são dados.
    if (/^(categoria|total geral|painel cac)/i.test(rotulo)) continue;
    if (!grupoAtual) continue;

    // Colunas 1..12 são Jan..Dez; o que vier depois é Total Ano e se ignora,
    // porque ele é derivado e importá-lo criaria uma segunda verdade.
    const meses = Array(12).fill(0) as number[];
    let algum = false;
    for (let i = 0; i < 12; i++) {
      const v = parseValorBR(linha[i + 1]);
      meses[i] = v;
      if (v !== 0) algum = true;
    }
    if (!algum) continue;

    out.push({ grupo: grupoAtual, rotulo, meses });
  }

  return out;
}

/**
 * Casa o que foi lido com as linhas do painel e devolve as células a gravar.
 *
 * `meses` limita quais colunas entram — para Jan–Mar importar o histórico sem
 * congelar o que o Omie já calcula de abril em diante.
 */
export function planoDeImportacao(
  importadas: LinhaImportada[],
  linhas: Linha[],
  meses: number[],
): { casadas: { linha_id: string; rotulo: string; mes: number; valor: number }[]; semCasar: string[] } {
  const porChave = new Map(linhas.map((l) => [`${l.grupo}|${l.rotulo}`, l]));
  const casadas: { linha_id: string; rotulo: string; mes: number; valor: number }[] = [];
  const semCasar: string[] = [];

  for (const imp of importadas) {
    const linha = porChave.get(`${imp.grupo}|${imp.rotulo}`);
    if (!linha) { semCasar.push(`${imp.grupo} › ${imp.rotulo}`); continue; }
    for (const m of meses) {
      const v = imp.meses[m - 1];
      if (v == null) continue;
      casadas.push({ linha_id: linha.id, rotulo: imp.rotulo, mes: m, valor: v });
    }
  }

  return { casadas, semCasar };
}

/* --------------------------------------------------------------------------
 * Conferência contra o painel antigo.
 * ------------------------------------------------------------------------ */

export type Divergencia = {
  rotulo: string;
  grupo: string;
  mes: number;
  calculado: number;
  digitado: number;
  delta: number;
  /** Fração da diferença sobre o digitado. 1 = errou por inteiro. */
  desvio: number;
};

/**
 * Compara o que o Hub calcula com o que foi digitado no painel antigo.
 *
 * É o que responde se uma regra está certa: enquanto o `Consultores` fecha em
 * julho e erra em abril, a regra não está pronta. `tolerancia` existe porque
 * centavos de arredondamento não são divergência.
 */
export function conferir(
  grupos: GrupoMatriz[],
  digitados: Map<string, number[]>,
  tolerancia = 1,
): Divergencia[] {
  const out: Divergencia[] = [];

  for (const g of grupos) {
    for (const l of g.linhas) {
      const esperado = digitados.get(`${l.grupo}|${l.rotulo}`);
      if (!esperado) continue;
      for (let i = 0; i < 12; i++) {
        const digitado = Number(esperado[i]) || 0;
        const calculado = l.meses[i];
        if (digitado === 0 && calculado === 0) continue;
        const delta = calculado - digitado;
        if (Math.abs(delta) <= tolerancia) continue;
        out.push({
          rotulo: l.rotulo,
          grupo: l.grupo,
          mes: i + 1,
          calculado,
          digitado,
          delta,
          desvio: digitado === 0 ? 1 : Math.abs(delta) / Math.abs(digitado),
        });
      }
    }
  }

  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/* --------------------------------------------------------------------------
 * Período, desvio e selo.
 *
 * A matriz deixou de ser "os 12 meses e o total do ano": ela recorta o período,
 * compara cada célula com a média dos 3 meses anteriores e diz, linha a linha,
 * se a regra que produziu aquele número já foi conferida. Nada disso depende de
 * React, então mora aqui — e por isso tem teste.
 * ------------------------------------------------------------------------ */

export type Periodo = "12m" | "tri" | "mes";

/**
 * O índice (0 = janeiro) do último mês FECHADO do ano pedido.
 *
 * O mês corrente não está fechado: em 26/08 o Omie ainda vai receber pagamento
 * de agosto, e comparar um agosto pela metade com a média dos meses inteiros
 * acusaria uma queda que não existe. Ano passado fecha em dezembro; ano que vem
 * não tem mês fechado nenhum, e devolve -1.
 */
export function ultimoMesFechado(ano: number, hoje = new Date()): number {
  const anoAtual = hoje.getFullYear();
  if (ano < anoAtual) return 11;
  if (ano > anoAtual) return -1;
  return hoje.getMonth() - 1;
}

/** Quais colunas de mês o período mostra. Sem mês fechado, cai no ano cheio. */
export function mesesDoPeriodo(periodo: Periodo, fechado: number): number[] {
  const ano = Array.from({ length: 12 }, (_, i) => i);
  if (periodo === "12m" || fechado < 0) return ano;
  if (periodo === "mes") return [fechado];
  return ano.slice(Math.max(0, fechado - 2), fechado + 1);
}

export type Desvio = {
  /** Média dos meses anteriores que tiveram valor. */
  media: number;
  /** Fração: 0,12 = 12% acima da média. */
  desvio: number;
};

/**
 * Compara o mês `i` com a média dos `janela` meses anteriores.
 *
 * Só entram na média os meses com valor: uma linha que começou em abril tem
 * jan–mar zerados, e incluí-los faria a média cair pela metade e todo mês
 * seguinte parecer uma explosão de custo. Abaixo de dois meses de base não há
 * comparação — devolve null, e a tela mostra "—" em vez de um número inventado.
 */
export function desvioVsMedia(meses: number[], i: number, janela = 3): Desvio | null {
  const anteriores: number[] = [];
  for (let k = i - janela; k < i; k++) if (k >= 0 && meses[k] > 0) anteriores.push(meses[k]);
  if (anteriores.length < 2) return null;
  if (!meses[i]) return null;

  const media = anteriores.reduce((a, b) => a + b, 0) / anteriores.length;
  if (!media) return null;
  return { media, desvio: (meses[i] - media) / media };
}

export type Selo = "ok" | "conferir" | "semregra" | "zero";

/**
 * Quanto se pode confiar no número daquela linha.
 *
 * A ordem importa: uma linha SEM regra vale zero por construção, e chamá-la de
 * "zero" esconderia que o problema é a regra em branco, não a ausência de
 * pagamento. Por isso "sem regra" vem antes de "zero", e o "CONFERIR" da nota
 * — que é como a migration marca uma regra apontada por semelhança de nome e
 * ainda não batida contra o painel antigo — vem antes dos dois.
 */
export function seloDaLinha(
  regra_nota: string | null | undefined,
  temRegra: boolean,
  total: number,
): Selo {
  if (!temRegra) return "semregra";
  if ((regra_nota ?? "").startsWith("CONFERIR")) return "conferir";
  if (!total) return "zero";
  return "ok";
}
