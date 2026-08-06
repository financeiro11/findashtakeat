// Consultas nomeadas do Assistente — a ÚNICA porta por onde número entra na resposta.
//
// Princípio (a "Regra 2" do projeto): nenhum número sai da cabeça do modelo. O modelo não
// recebe dado financeiro no prompt; para falar de caixa ou de EBITDA ele precisa que uma
// destas funções tenha rodado. Cada uma:
//   1. lê o Supabase respeitando a RLS do usuário que perguntou;
//   2. CONFERE que a soma das partes bate com o total antes de devolver;
//   3. devolve os números já formatados, com fonte e competência ao lado.
//
// O que não fecha na conferência não vira resposta — vira aviso. É melhor dizer "não tenho
// esse dado" do que mandar um número torto para o CEO.

import {
  Competencia, Demonstracao, competenciaCurta, competenciaExtenso, estruturar,
  mesesFechados, montarColuna, ordenar, valorDe, valorDoNo,
} from "./dre.ts";
import { acharNo, folhasDe, rotulosDeDespesa, todosRotulos } from "./schema-dre.ts";
import { acharFonte } from "./catalogo.ts";

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

/** Um número exibido na tela, sempre acompanhado de onde veio. */
export type Numero = {
  rotulo: string;
  valor: number;
  formatado: string;
  fonte: string;
  competencia: string;
};

export type Resultado = {
  consulta: string;
  ok: boolean;
  /**
   * Quão forte é a garantia por trás dos números.
   *
   * "conferido"  — consulta nomeada: o código conhece a semântica e CONFERIU que a soma
   *                das partes bate com o total. É o que pode ir para diretoria.
   * "consultado" — explorador genérico: os dados vieram do banco agora, mas ninguém
   *                validou se a agregação responde de fato à pergunta. Confiável quanto
   *                à origem, não quanto à interpretação.
   *
   * Ausente equivale a "conferido" (as consultas nomeadas vieram antes deste campo).
   */
  nivel?: "conferido" | "consultado";
  /** Vão para a tabela na tela, ao lado do texto. */
  numeros: Numero[];
  /** Bloco fechado entregue ao modelo. É a única coisa que ele sabe sobre os dados. */
  paraModelo: string;
  /** Lacunas e ressalvas — sempre mostradas, nunca escondidas. */
  avisos: string[];
};

export const brl = (n: number): string =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export const pct = (n: number): string =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * Confere que as partes somam o total.
 *
 * Tolerância relativa de 0,5% absorve arredondamento de centavos acumulado em dezenas de
 * rubricas, sem deixar passar erro estrutural (rubrica faltando, sinal invertido).
 */
export function fecha(partes: number[], total: number, tolerancia = 0.005): boolean {
  const soma = partes.reduce((a, b) => a + b, 0);
  const escala = Math.max(Math.abs(total), 1);
  return Math.abs(soma - total) / escala <= tolerancia;
}

// ---------------------------------------------------------------------------
// Caixa do mês
// ---------------------------------------------------------------------------

type LinhaExtrato = { data_movimento: string | null; tipo: string | null; valor: number | null };

/**
 * "Qual foi o caixa em julho?" — pergunta ambígua, então a resposta não escolhe por você.
 *
 * Devolve as duas leituras que os dados sustentam, separadas e rotuladas:
 *   • movimentação do mês (entradas − saídas nos extratos Sicoob + Asaas);
 *   • saldo bancário mais recente de cada conta.
 * O caixa contábil do DFC é uma TERCEIRA coisa e não se mistura aqui.
 */
export async function caixaDoMes(
  supabase: { from: (t: string) => any },
  c: Competencia,
): Promise<Resultado> {
  const inicio = `${c.ano}-${String(c.mes).padStart(2, "0")}-01`;
  const fimDate = new Date(Date.UTC(c.ano, c.mes, 0)); // dia 0 do mês seguinte = último dia deste
  const fim = fimDate.toISOString().slice(0, 10);

  const avisos: string[] = [];
  const numeros: Numero[] = [];
  const rotulo = competenciaCurta(c);

  const bancos: { nome: string; extrato: string; saldo: string }[] = [
    { nome: "Sicoob", extrato: "sicoob_extrato", saldo: "sicoob_saldo" },
    { nome: "Asaas", extrato: "asaas_extrato", saldo: "asaas_saldo" },
  ];

  let entradasTotal = 0;
  let saidasTotal = 0;
  let algumExtrato = false;

  for (const banco of bancos) {
    const { data, error } = await supabase
      .from(banco.extrato)
      .select("data_movimento, tipo, valor")
      .gte("data_movimento", inicio)
      .lte("data_movimento", fim);

    if (error) {
      avisos.push(`Não consegui ler o extrato ${banco.nome}: ${error.message}`);
      continue;
    }

    const linhas = (data ?? []) as LinhaExtrato[];
    if (linhas.length === 0) {
      avisos.push(`Extrato ${banco.nome} não tem lançamento em ${rotulo}.`);
      continue;
    }
    algumExtrato = true;

    // `valor` é sempre positivo nestas tabelas; o sinal vem da coluna `tipo`.
    const entradas = linhas
      .filter((l) => l.tipo === "credito")
      .reduce((a, l) => a + (l.valor ?? 0), 0);
    const saidas = linhas
      .filter((l) => l.tipo === "debito")
      .reduce((a, l) => a + (l.valor ?? 0), 0);

    const semTipo = linhas.filter((l) => l.tipo !== "credito" && l.tipo !== "debito").length;
    if (semTipo > 0) {
      avisos.push(
        `${semTipo} lançamento(s) do ${banco.nome} sem tipo definido ficaram de fora da conta.`,
      );
    }

    entradasTotal += entradas;
    saidasTotal += saidas;

    numeros.push(
      { rotulo: `Entradas ${banco.nome}`, valor: entradas, formatado: brl(entradas), fonte: `Extrato ${banco.nome}`, competencia: rotulo },
      { rotulo: `Saídas ${banco.nome}`, valor: saidas, formatado: brl(saidas), fonte: `Extrato ${banco.nome}`, competencia: rotulo },
    );
  }

  if (algumExtrato) {
    const liquido = entradasTotal - saidasTotal;
    numeros.push({
      rotulo: "Movimentação líquida do mês",
      valor: liquido,
      formatado: brl(liquido),
      fonte: "Extratos Sicoob + Asaas",
      competencia: rotulo,
    });

    // Conferência: as parcelas por banco têm que reproduzir o líquido consolidado.
    const parcelas = numeros
      .filter((n) => n.rotulo.startsWith("Entradas"))
      .map((n) => n.valor)
      .concat(numeros.filter((n) => n.rotulo.startsWith("Saídas")).map((n) => -n.valor));
    if (!fecha(parcelas, liquido)) {
      avisos.push("A soma por banco não reproduziu a movimentação líquida — número suprimido.");
      return { consulta: "caixa_do_mes", ok: false, numeros: [], paraModelo: "", avisos };
    }
  }

  // Saldo atual por conta: as tabelas de saldo são append-only, o vigente é o mais recente.
  for (const banco of bancos) {
    const { data, error } = await supabase
      .from(banco.saldo)
      .select("saldo, atualizado_em")
      .order("atualizado_em", { ascending: false })
      .limit(1);

    if (error || !data?.[0]) {
      avisos.push(`Sem snapshot de saldo do ${banco.nome}.`);
      continue;
    }
    const linha = data[0] as { saldo: number | null; atualizado_em: string | null };
    const quando = linha.atualizado_em
      ? new Date(linha.atualizado_em).toLocaleDateString("pt-BR")
      : "data desconhecida";
    numeros.push({
      rotulo: `Saldo ${banco.nome}`,
      valor: linha.saldo ?? 0,
      formatado: brl(linha.saldo ?? 0),
      fonte: `Saldo ${banco.nome}`,
      competencia: `posição de ${quando}`,
    });
  }

  if (numeros.length === 0) {
    avisos.push(`Não há dado de caixa para ${rotulo}.`);
    return { consulta: "caixa_do_mes", ok: false, numeros: [], paraModelo: "", avisos };
  }

  const paraModelo = [
    `CAIXA — competência ${competenciaExtenso(c)}`,
    ...numeros.map((n) => `${n.rotulo}: ${n.formatado} (${n.fonte}, ${n.competencia})`),
    "",
    'ATENÇÃO: "movimentação do mês" e "saldo bancário" são coisas diferentes. Não as some',
    "nem trate uma como a outra. O caixa contábil do DFC é uma terceira medida e não está aqui.",
  ].join("\n");

  return { consulta: "caixa_do_mes", ok: true, numeros, paraModelo, avisos };
}

// ---------------------------------------------------------------------------
// Variação do EBITDA
// ---------------------------------------------------------------------------

/** Os três blocos de primeiro nível que compõem o EBITDA. */
const BLOCOS_EBITDA = ["Receita Líquida", "(-) Custos Operacionais", "(-) SG&A"];

/** Rubricas que descem de um bloco "(-)" — sobem, o resultado cai. */
const DESPESAS = rotulosDeDespesa();

/**
 * Valor de uma rubrica pelo nome, respeitando a regra de somar filhos.
 *
 * Se a rubrica está na árvore e tem filhos, soma as folhas; senão lê a linha. Isso é o
 * que faz o Assistente devolver o MESMO número que a tela de DRE mostra.
 */
function valorRubrica(d: Demonstracao, rubrica: string, c: Competencia): number | null {
  const no = acharNo(rubrica);
  return no ? valorDoNo(d, no, c) : valorDe(d, rubrica, c);
}

/**
 * Descobre o sinal com que custos e despesas estão gravados.
 *
 * O blob não é consistente entre importações: uma despesa pode estar salva como positivo
 * (e o sinal ficar só no rótulo "(-)") ou já como negativo. Presumir erraria a direção da
 * análise inteira — então testamos as duas hipóteses contra o EBITDA salvo e adotamos a
 * que fecha. Se nenhuma fechar, não afirmamos nada.
 */
function descobrirSinal(d: Demonstracao, c: Competencia): -1 | 1 | null {
  const receita = valorRubrica(d, "Receita Líquida", c);
  const custos = valorRubrica(d, "(-) Custos Operacionais", c);
  const sga = valorRubrica(d, "(-) SG&A", c);
  const ebitda = valorRubrica(d, "EBITDA", c);
  if (receita === null || custos === null || sga === null || ebitda === null) return null;

  if (fecha([receita, -custos, -sga], ebitda)) return 1;  // gravados positivos
  if (fecha([receita, custos, sga], ebitda)) return -1;   // gravados já negativos
  return null;
}

export type Contribuicao = { rubrica: string; anterior: number; atual: number; efeito: number };

/**
 * "Por que o EBITDA caiu?" — atribuição de variância entre os dois últimos meses FECHADOS.
 *
 * Responde até onde o DRE sustenta: qual rubrica moveu o resultado e em quanto. Não
 * responde a causa DENTRO da rubrica — não há lançamento por trás dela nesta base — e diz
 * isso explicitamente, em vez de deixar o modelo preencher a lacuna.
 */
export async function variacaoEbitda(
  supabase: { from: (t: string) => any },
): Promise<Resultado> {
  const avisos: string[] = [];

  const [demRes, travasRes] = await Promise.all([
    supabase
      .from("demonstracoes_contabeis")
      .select("dados, updated_at")
      .eq("tipo", "dre")
      .eq("periodo", "completo")
      .maybeSingle(),
    supabase.from("demonstracoes_mes_trancado").select("col_key"),
  ]);

  if (demRes.error || !demRes.data) {
    return {
      consulta: "variacao_ebitda", ok: false, numeros: [], paraModelo: "",
      avisos: ["Não encontrei o DRE consolidado em demonstracoes_contabeis."],
    };
  }

  const dre = estruturar(demRes.data.dados, demRes.data.updated_at ?? null);
  const travas = ((travasRes.data ?? []) as { col_key: string }[]).map((t) => t.col_key);
  const fechados = mesesFechados(dre, travas);

  if (fechados.length < 2) {
    return {
      consulta: "variacao_ebitda", ok: false, numeros: [], paraModelo: "",
      avisos: [
        `Só ${fechados.length} mês fechado disponível. A comparação exige dois meses travados —` +
        " o mês corrente sincroniza com o Omie aos poucos e compará-lo produziria variação falsa.",
      ],
    };
  }

  const atual = fechados[fechados.length - 1];
  const anterior = fechados[fechados.length - 2];

  const ebitdaAtual = valorRubrica(dre, "EBITDA", atual);
  const ebitdaAnterior = valorRubrica(dre, "EBITDA", anterior);
  if (ebitdaAtual === null || ebitdaAnterior === null) {
    return {
      consulta: "variacao_ebitda", ok: false, numeros: [], paraModelo: "",
      avisos: ["A rubrica EBITDA não está preenchida em um dos dois meses fechados."],
    };
  }

  const sinal = descobrirSinal(dre, atual) ?? descobrirSinal(dre, anterior);
  if (sinal === null) {
    return {
      consulta: "variacao_ebitda", ok: false, numeros: [], paraModelo: "",
      avisos: [
        "Receita Líquida, Custos e SG&A não reproduzem o EBITDA salvo em nenhuma convenção" +
        " de sinal. Isso indica rubrica faltando ou renomeada no DRE — não decomponho a" +
        " variação sem essa conferência fechar.",
      ],
    };
  }

  const variacao = ebitdaAtual - ebitdaAnterior;

  // Efeito de cada bloco sobre o EBITDA: receita entra somando, custo e despesa subtraindo.
  const contribuicoes: Contribuicao[] = [];
  for (const bloco of BLOCOS_EBITDA) {
    const a = valorRubrica(dre, bloco, anterior);
    const b = valorRubrica(dre, bloco, atual);
    if (a === null || b === null) {
      avisos.push(`Bloco "${bloco}" ausente em um dos meses — decomposição incompleta.`);
      continue;
    }
    const peso = DESPESAS.has(bloco) ? -sinal : 1;
    contribuicoes.push({ rubrica: bloco, anterior: a, atual: b, efeito: (b - a) * peso });
  }

  // Conferência dura: os efeitos dos blocos têm que reproduzir a variação do EBITDA.
  if (!fecha(contribuicoes.map((c) => c.efeito), variacao)) {
    return {
      consulta: "variacao_ebitda", ok: false, numeros: [], paraModelo: "",
      avisos: [
        "A soma dos blocos não reproduziu a variação do EBITDA. Prefiro não decompor a" +
        " arriscar uma atribuição errada. Vale conferir o fechamento do mês no DRE.",
      ],
    };
  }

  // Detalhamento por FOLHA da árvore — só folha vem de lançamento; nó com filhos é soma.
  const detalhes: Contribuicao[] = [];
  const folhasEbitda = BLOCOS_EBITDA.flatMap((b) => {
    const no = acharNo(b);
    return no ? folhasDe(no) : [];
  });
  for (const folha of folhasEbitda) {
    const a = valorDe(dre, folha.src ?? folha.label, anterior);
    const b = valorDe(dre, folha.src ?? folha.label, atual);
    if (a === null || b === null || a === b) continue;
    const peso = DESPESAS.has(folha.label) ? -sinal : 1;
    detalhes.push({ rubrica: folha.label, anterior: a, atual: b, efeito: (b - a) * peso });
  }
  detalhes.sort((x, y) => Math.abs(y.efeito) - Math.abs(x.efeito));
  const principais = detalhes.slice(0, 6);

  const rotAtual = competenciaCurta(atual);
  const rotAnterior = competenciaCurta(anterior);
  const variacaoPct = ebitdaAnterior !== 0 ? (variacao / Math.abs(ebitdaAnterior)) * 100 : null;

  const numeros: Numero[] = [
    { rotulo: `EBITDA ${rotAnterior}`, valor: ebitdaAnterior, formatado: brl(ebitdaAnterior), fonte: "DRE Omie", competencia: rotAnterior },
    { rotulo: `EBITDA ${rotAtual}`, valor: ebitdaAtual, formatado: brl(ebitdaAtual), fonte: "DRE Omie", competencia: rotAtual },
    { rotulo: "Variação", valor: variacao, formatado: brl(variacao), fonte: "DRE Omie", competencia: `${rotAnterior} → ${rotAtual}` },
    ...principais.map((d) => ({
      rotulo: `Efeito · ${d.rubrica}`,
      valor: d.efeito,
      formatado: brl(d.efeito),
      fonte: "DRE Omie",
      competencia: `${rotAnterior} → ${rotAtual}`,
    })),
  ];
  if (variacaoPct !== null) {
    numeros.splice(3, 0, {
      rotulo: "Variação %", valor: variacaoPct, formatado: pct(variacaoPct),
      fonte: "DRE Omie", competencia: `${rotAnterior} → ${rotAtual}`,
    });
  }

  const cobertura = principais.reduce((a, d) => a + Math.abs(d.efeito), 0);
  const totalDetalhe = detalhes.reduce((a, d) => a + Math.abs(d.efeito), 0);
  if (totalDetalhe > 0 && cobertura / totalDetalhe < 0.9) {
    avisos.push(
      `As ${principais.length} rubricas listadas cobrem ` +
      `${((cobertura / totalDetalhe) * 100).toFixed(0)}% do movimento; o restante está pulverizado.`,
    );
  }

  const paraModelo = [
    `VARIAÇÃO DO EBITDA — ${competenciaExtenso(anterior)} → ${competenciaExtenso(atual)}`,
    `(ambos são meses FECHADOS; meses abertos foram excluídos de propósito)`,
    "",
    `EBITDA ${rotAnterior}: ${brl(ebitdaAnterior)}`,
    `EBITDA ${rotAtual}: ${brl(ebitdaAtual)}`,
    `Variação: ${brl(variacao)}${variacaoPct !== null ? ` (${pct(variacaoPct)})` : ""}`,
    "",
    "Efeito por bloco (já com o sinal correto sobre o EBITDA):",
    ...contribuicoes.map((c) => `  ${c.rubrica}: ${brl(c.efeito)}`),
    "",
    "Principais rubricas:",
    ...principais.map((d) => `  ${d.rubrica}: ${brl(d.anterior)} → ${brl(d.atual)} · efeito ${brl(d.efeito)}`),
    "",
    "LIMITE DESTES DADOS: aqui você tem a atribuição por rubrica, não o lançamento.",
    "Diga qual rubrica moveu o resultado e PARE aí. Não invente a causa dentro dela —",
    "mas OFEREÇA: os lançamentos daquela rubrica podem ser consultados, basta a pessoa pedir",
    "(ex.: \"me mostra os lançamentos de Equipe Comercial\").",
  ].join("\n");

  return { consulta: "variacao_ebitda", ok: true, numeros, paraModelo, avisos };
}

// ---------------------------------------------------------------------------
// Panorama e rubrica avulsa
// ---------------------------------------------------------------------------

/** Linhas de topo do DRE — o "como foi o mês" sem precisar pedir rubrica por rubrica. */
const LINHAS_PANORAMA = [
  "Receita Bruta", "Receita Líquida", "Margem de contribuição", "EBITDA", "Lucro Líquido",
];

/**
 * "Como foi julho?" — os totais do mês, com o mês fechado anterior ao lado.
 *
 * Percentuais são RECALCULADOS a partir dos valores, nunca lidos do blob: as linhas de "%"
 * salvas podem estar defasadas em relação às rubricas que as originam.
 */
export async function panoramaDoMes(
  supabase: { from: (t: string) => any },
  pedida: Competencia | null,
): Promise<Resultado> {
  const [demRes, travasRes] = await Promise.all([
    supabase.from("demonstracoes_contabeis").select("dados, updated_at")
      .eq("tipo", "dre").eq("periodo", "completo").maybeSingle(),
    supabase.from("demonstracoes_mes_trancado").select("col_key"),
  ]);

  if (demRes.error || !demRes.data) {
    return { consulta: "panorama_do_mes", ok: false, numeros: [], paraModelo: "", avisos: ["DRE consolidado não encontrado."] };
  }

  const dre = estruturar(demRes.data.dados, demRes.data.updated_at ?? null);
  const travas = ((travasRes.data ?? []) as { col_key: string }[]).map((t) => t.col_key);
  const fechados = mesesFechados(dre, travas);
  const avisos: string[] = [];

  if (fechados.length === 0) {
    return { consulta: "panorama_do_mes", ok: false, numeros: [], paraModelo: "", avisos: ["Nenhum mês fechado no DRE."] };
  }

  const alvo = pedida ?? fechados[fechados.length - 1];
  const fechado = fechados.some((f) => f.ano === alvo.ano && f.mes === alvo.mes);
  if (!fechado) {
    avisos.push(
      `${competenciaCurta(alvo)} ainda não está fechado — os valores estão incompletos` +
      " porque o mês sincroniza com o Omie aos poucos. Trate como parcial.",
    );
  }

  const anterior = fechados.filter((f) => ordenar(f, alvo) < 0).pop() ?? null;
  const numeros: Numero[] = [];

  for (const linha of LINHAS_PANORAMA) {
    const v = valorRubrica(dre, linha, alvo);
    if (v === null) continue;
    numeros.push({
      rotulo: linha, valor: v, formatado: brl(v),
      fonte: "DRE Omie", competencia: competenciaCurta(alvo),
    });
  }

  if (numeros.length === 0) {
    return {
      consulta: "panorama_do_mes", ok: false, numeros: [], paraModelo: "",
      avisos: [`Não há valores de DRE para ${competenciaCurta(alvo)}.`],
    };
  }

  // Margem EBITDA recalculada sobre a receita líquida do próprio mês.
  const receita = valorRubrica(dre, "Receita Líquida", alvo);
  const ebitda = valorRubrica(dre, "EBITDA", alvo);
  if (receita !== null && ebitda !== null && receita !== 0) {
    const margem = (ebitda / receita) * 100;
    numeros.push({
      rotulo: "Margem EBITDA", valor: margem, formatado: pct(margem),
      fonte: "DRE Omie (calculada)", competencia: competenciaCurta(alvo),
    });
  }

  if (anterior) {
    for (const linha of ["Receita Líquida", "EBITDA"]) {
      const a = valorRubrica(dre, linha, anterior);
      const b = valorRubrica(dre, linha, alvo);
      if (a === null || b === null) continue;
      const delta = b - a;
      numeros.push({
        rotulo: `${linha} · variação`, valor: delta, formatado: brl(delta),
        fonte: "DRE Omie", competencia: `${competenciaCurta(anterior)} → ${competenciaCurta(alvo)}`,
      });
    }
  } else {
    avisos.push("Não há mês fechado anterior para comparar.");
  }

  const paraModelo = [
    `PANORAMA — ${competenciaExtenso(alvo)}${fechado ? " (mês fechado)" : " (MÊS AINDA ABERTO — dado parcial)"}`,
    ...numeros.map((n) => `${n.rotulo}: ${n.formatado} (${n.fonte}, ${n.competencia})`),
    "",
    "LIMITE: estes são totais de rubrica. Não há lançamento nem fornecedor por trás deles.",
  ].join("\n");

  return { consulta: "panorama_do_mes", ok: true, numeros, paraModelo, avisos };
}

/**
 * Casa o que a pessoa escreveu com o nome exato da rubrica.
 *
 * Procura primeiro na ÁRVORE e só depois no blob: assim "SG&A" ou "Pessoal" — que são nós
 * com filhos — são reconhecidos e passam pela soma dos filhos, em vez de caírem na leitura
 * crua da linha, que estaria desatualizada em mês destravado.
 */
function acharRubrica(dre: Demonstracao, procurado: string): string | null {
  // Remove acentos para casar "margem de contribuicao" com "Margem de contribuição".
  const limpar = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  const alvo = limpar(procurado);
  if (!alvo) return null;

  const daArvore = todosRotulos();
  const doBlob = [...dre.rotulos.values()];
  // Ordem importa: a árvore tem prioridade, o blob cobre rubrica fora do esquema.
  const candidatas = [...daArvore, ...doBlob.filter((r) => !daArvore.includes(r))];

  const exata = candidatas.find((r) => limpar(r) === alvo);
  if (exata) return exata;

  // Contém — a mais curta entre as candidatas é a mais específica
  // ("Equipe Comercial" ganha de "Equipe Comercial e Marketing" para a busca "comercial").
  const contendo = candidatas
    .filter((r) => limpar(r).includes(alvo) || alvo.includes(limpar(r)))
    .sort((a, b) => a.length - b.length);
  return contendo[0] ?? null;
}

/**
 * "Quanto gastamos com Equipe Comercial em julho?" — uma rubrica, um mês, com o mês
 * fechado anterior ao lado para dar contexto.
 */
export async function rubricaDoMes(
  supabase: { from: (t: string) => any },
  procurada: string,
  pedida: Competencia | null,
): Promise<Resultado> {
  const [demRes, travasRes] = await Promise.all([
    supabase.from("demonstracoes_contabeis").select("dados, updated_at")
      .eq("tipo", "dre").eq("periodo", "completo").maybeSingle(),
    supabase.from("demonstracoes_mes_trancado").select("col_key"),
  ]);

  if (demRes.error || !demRes.data) {
    return { consulta: "rubrica_do_mes", ok: false, numeros: [], paraModelo: "", avisos: ["DRE consolidado não encontrado."] };
  }

  const dre = estruturar(demRes.data.dados, demRes.data.updated_at ?? null);
  const travas = ((travasRes.data ?? []) as { col_key: string }[]).map((t) => t.col_key);
  const fechados = mesesFechados(dre, travas);

  const rubrica = acharRubrica(dre, procurada);
  if (!rubrica) {
    return {
      consulta: "rubrica_do_mes", ok: false, numeros: [], paraModelo: "",
      avisos: [`Não encontrei a rubrica "${procurada}" no DRE.`],
    };
  }
  if (fechados.length === 0) {
    return { consulta: "rubrica_do_mes", ok: false, numeros: [], paraModelo: "", avisos: ["Nenhum mês fechado no DRE."] };
  }

  const alvo = pedida ?? fechados[fechados.length - 1];
  const valor = valorRubrica(dre, rubrica, alvo);
  if (valor === null) {
    return {
      consulta: "rubrica_do_mes", ok: false, numeros: [], paraModelo: "",
      avisos: [`"${rubrica}" não tem valor em ${competenciaCurta(alvo)}.`],
    };
  }

  const avisos: string[] = [];
  if (!fechados.some((f) => f.ano === alvo.ano && f.mes === alvo.mes)) {
    avisos.push(`${competenciaCurta(alvo)} ainda não está fechado — valor parcial.`);
  }

  const numeros: Numero[] = [{
    rotulo: rubrica, valor, formatado: brl(valor),
    fonte: "DRE Omie", competencia: competenciaCurta(alvo),
  }];

  const anterior = fechados.filter((f) => ordenar(f, alvo) < 0).pop() ?? null;
  if (anterior) {
    const antes = valorRubrica(dre, rubrica, anterior);
    if (antes !== null) {
      numeros.push({
        rotulo: `${rubrica} · ${competenciaCurta(anterior)}`, valor: antes, formatado: brl(antes),
        fonte: "DRE Omie", competencia: competenciaCurta(anterior),
      });
      const delta = valor - antes;
      numeros.push({
        rotulo: "Variação", valor: delta, formatado: brl(delta),
        fonte: "DRE Omie", competencia: `${competenciaCurta(anterior)} → ${competenciaCurta(alvo)}`,
      });
    }
  }

  const paraModelo = [
    `RUBRICA "${rubrica}" — ${competenciaExtenso(alvo)}`,
    ...numeros.map((n) => `${n.rotulo}: ${n.formatado} (${n.competencia})`),
    "",
    "LIMITE: este é o total da rubrica. Se a pessoa quiser saber QUEM compõe esse valor,",
    "os lançamentos do Omie podem ser listados — ofereça, mas não invente nomes aqui.",
  ].join("\n");

  return { consulta: "rubrica_do_mes", ok: true, numeros, paraModelo, avisos };
}

// ---------------------------------------------------------------------------
// Lançamentos — a causa raiz
// ---------------------------------------------------------------------------

type LinhaLancamento = {
  data: string | null;
  contraparte: string | null;
  categoria_descricao: string | null;
  valor: number | null;
  status: string | null;
};

/**
 * "Por que a Equipe Comercial subiu?" — os lançamentos do Omie que compõem a célula.
 *
 * Só funciona em rubrica FOLHA: nó com filhos é soma e não tem lançamento próprio; total
 * e percentual são calculados. A RPC `demonstracoes_lancamentos` reproduz a atribuição
 * lançamento → rubrica do omie-sync, e roda como SECURITY DEFINER porque o dump bruto do
 * Omie não é exposto ao cliente.
 *
 * A conferência aqui é a que a própria migration recomenda: somar os lançamentos e
 * comparar com a célula. Divergência não é escondida — vira aviso, porque significa que a
 * regra de atribuição do sync mudou e o drill-down passou a mentir.
 */
export async function lancamentosDaRubrica(
  supabase: { from: (t: string) => any; rpc: (f: string, p: Record<string, unknown>) => any },
  procurada: string,
  pedida: Competencia | null,
): Promise<Resultado> {
  const [demRes, travasRes] = await Promise.all([
    supabase.from("demonstracoes_contabeis").select("dados, updated_at")
      .eq("tipo", "dre").eq("periodo", "completo").maybeSingle(),
    supabase.from("demonstracoes_mes_trancado").select("col_key"),
  ]);

  if (demRes.error || !demRes.data) {
    return { consulta: "lancamentos_da_rubrica", ok: false, numeros: [], paraModelo: "", avisos: ["DRE consolidado não encontrado."] };
  }

  const dre = estruturar(demRes.data.dados, demRes.data.updated_at ?? null);
  const travas = ((travasRes.data ?? []) as { col_key: string }[]).map((t) => t.col_key);
  const fechados = mesesFechados(dre, travas);

  const rubrica = acharRubrica(dre, procurada);
  if (!rubrica) {
    return {
      consulta: "lancamentos_da_rubrica", ok: false, numeros: [], paraModelo: "",
      avisos: [`Não encontrei a rubrica "${procurada}" no DRE.`],
    };
  }

  // Nó com filhos não tem lançamento próprio — o detalhe está nas folhas dele.
  const no = acharNo(rubrica);
  if (no?.children?.length) {
    const filhos = no.children.map((f) => f.label).join(", ");
    return {
      consulta: "lancamentos_da_rubrica", ok: false, numeros: [], paraModelo: "",
      avisos: [
        `"${rubrica}" é a soma de outras rubricas, não tem lançamento próprio. ` +
        `Escolha uma destas: ${filhos}.`,
      ],
    };
  }

  if (fechados.length === 0) {
    return { consulta: "lancamentos_da_rubrica", ok: false, numeros: [], paraModelo: "", avisos: ["Nenhum mês fechado no DRE."] };
  }
  const alvo = pedida ?? fechados[fechados.length - 1];
  const mesChave = montarColuna(alvo);

  const { data, error } = await supabase.rpc("demonstracoes_lancamentos", {
    p_tipo: "dre", p_rubrica: rubrica, p_mes: mesChave,
  });

  if (error) {
    return {
      consulta: "lancamentos_da_rubrica", ok: false, numeros: [], paraModelo: "",
      avisos: [`Não consegui listar os lançamentos: ${error.message}`],
    };
  }

  const linhas = (data ?? []) as LinhaLancamento[];
  if (linhas.length === 0) {
    return {
      consulta: "lancamentos_da_rubrica", ok: false, numeros: [], paraModelo: "",
      avisos: [`Nenhum lançamento do Omie para "${rubrica}" em ${competenciaCurta(alvo)}.`],
    };
  }

  const avisos: string[] = [];
  const somaLancamentos = linhas.reduce((a, l) => a + (l.valor ?? 0), 0);
  const celula = valorRubrica(dre, rubrica, alvo);

  // A divergência que a migration manda vigiar.
  if (celula !== null && !fecha([somaLancamentos], celula, 0.01)) {
    avisos.push(
      `Os lançamentos somam ${brl(somaLancamentos)}, mas a célula do DRE mostra ` +
      `${brl(celula)}. A diferença pode ser valor manual, mês travado com dado de tracker, ` +
      "ou mudança na regra de atribuição do sync. Trate a lista como indício, não como fechamento.",
    );
  }

  // Agrupa por contraparte: "quem" costuma explicar mais que "quando".
  const porContraparte = new Map<string, number>();
  for (const l of linhas) {
    const nome = (l.contraparte ?? "").trim() || "sem contraparte";
    porContraparte.set(nome, (porContraparte.get(nome) ?? 0) + (l.valor ?? 0));
  }
  const maiores = [...porContraparte.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 8);

  const rotuloMes = competenciaCurta(alvo);
  const numeros: Numero[] = [
    {
      rotulo: `${rubrica} · total`, valor: somaLancamentos, formatado: brl(somaLancamentos),
      fonte: `Omie · ${linhas.length} lançamento(s)`, competencia: rotuloMes,
    },
    ...maiores.map(([nome, v]) => ({
      rotulo: nome, valor: v, formatado: brl(v), fonte: "Omie", competencia: rotuloMes,
    })),
  ];

  const cobertura = maiores.reduce((a, [, v]) => a + Math.abs(v), 0);
  const total = [...porContraparte.values()].reduce((a, v) => a + Math.abs(v), 0);
  if (total > 0 && cobertura / total < 0.9) {
    avisos.push(
      `As ${maiores.length} contrapartes listadas cobrem ${((cobertura / total) * 100).toFixed(0)}% ` +
      `do total; há ${porContraparte.size - maiores.length} outra(s) menor(es).`,
    );
  }

  const paraModelo = [
    `LANÇAMENTOS DE "${rubrica}" — ${competenciaExtenso(alvo)}`,
    `${linhas.length} lançamento(s), somando ${brl(somaLancamentos)}.`,
    "",
    "Maiores contrapartes:",
    ...maiores.map(([nome, v]) => `  ${nome}: ${brl(v)}`),
    "",
    "Este é o nível mais fundo que existe: lançamento a lançamento, vindo do Omie.",
    "Pode apontar QUEM e QUANTO. Não invente o motivo comercial por trás de um pagamento —",
    "isso não está no dado.",
  ].join("\n");

  return { consulta: "lancamentos_da_rubrica", ok: true, numeros, paraModelo, avisos };
}

// ---------------------------------------------------------------------------
// Explorador genérico — o resto do Hub
// ---------------------------------------------------------------------------

/** Teto de linhas lidas. Alto o bastante para agregar um ano, baixo para não travar. */
const TETO_LINHAS = 3000;

export type PlanoExploracao = {
  fonte: string;
  /** Agrupa e soma por esta dimensão. Sem ela, lista as linhas mais recentes. */
  agrupar_por?: string | null;
  /** Filtro de igualdade simples: { coluna: valor }. */
  filtros?: Record<string, string> | null;
  /** Recorta pelo período usando a coluna de data da fonte. */
  de?: string | null;
  ate?: string | null;
};

/**
 * Consulta qualquer fonte do catálogo, sem SQL escrito por modelo.
 *
 * O modelo escolhe a fonte e os parâmetros; o código monta a consulta contra uma lista
 * fechada de tabelas e colunas. Coluna fora do catálogo é recusada — o modelo não alcança
 * nada que não esteja declarado, e não consegue montar join nem subconsulta.
 *
 * A agregação acontece em memória porque o PostgREST não faz GROUP BY: lemos as linhas
 * (respeitando a RLS do usuário) e somamos aqui. Quando o teto de linhas é atingido, o
 * resultado avisa — número parcial apresentado como total é pior que número nenhum.
 */
export async function explorar(
  supabase: { from: (t: string) => any },
  plano: PlanoExploracao,
): Promise<Resultado> {
  const fonte = acharFonte(plano.fonte);
  if (!fonte) {
    return {
      consulta: "explorar", ok: false, nivel: "consultado", numeros: [], paraModelo: "",
      avisos: [`"${plano.fonte}" não está no catálogo de fontes do Assistente.`],
    };
  }

  const avisos: string[] = [];
  const colunasValidas = new Set([...fonte.dimensoes, ...fonte.listar, fonte.data, fonte.valor].filter(Boolean) as string[]);

  const selecionar = [...new Set([...fonte.listar, ...fonte.dimensoes, fonte.data, fonte.valor].filter(Boolean))].join(",");
  let q = supabase.from(fonte.id).select(selecionar).limit(TETO_LINHAS);

  // Filtros: só colunas declaradas no catálogo.
  for (const [coluna, valor] of Object.entries(plano.filtros ?? {})) {
    if (!colunasValidas.has(coluna)) {
      avisos.push(`Ignorei o filtro "${coluna}": não é uma coluna conhecida desta fonte.`);
      continue;
    }
    q = q.eq(coluna, valor);
  }

  if (fonte.data && (plano.de || plano.ate)) {
    if (plano.de) q = q.gte(fonte.data, plano.de);
    if (plano.ate) q = q.lte(fonte.data, plano.ate);
  } else if (plano.de || plano.ate) {
    avisos.push(`A fonte "${fonte.id}" não tem coluna de data — o período foi ignorado.`);
  }

  if (fonte.data) q = q.order(fonte.data, { ascending: false });

  const { data, error } = await q;
  if (error) {
    return {
      consulta: "explorar", ok: false, nivel: "consultado", numeros: [], paraModelo: "",
      avisos: [`Não consegui ler ${fonte.id}: ${error.message}`],
    };
  }

  const linhas = (data ?? []) as Record<string, unknown>[];
  if (linhas.length === 0) {
    return {
      consulta: "explorar", ok: false, nivel: "consultado", numeros: [], paraModelo: "",
      avisos: [`Nenhum registro em ${fonte.id} com esses critérios.`],
    };
  }
  if (linhas.length >= TETO_LINHAS) {
    avisos.push(
      `Li ${TETO_LINHAS} registros, que é o teto — pode haver mais. Os totais abaixo são ` +
      "parciais; estreite o período para fechar a conta.",
    );
  }

  const periodo = plano.de || plano.ate
    ? `${plano.de ?? "início"} a ${plano.ate ?? "hoje"}`
    : "todo o período";

  const numeros: Numero[] = [];
  const agrupar = plano.agrupar_por && fonte.dimensoes.includes(plano.agrupar_por)
    ? plano.agrupar_por
    : null;

  if (plano.agrupar_por && !agrupar) {
    avisos.push(`Não dá para agrupar por "${plano.agrupar_por}" nesta fonte.`);
  }

  if (agrupar && fonte.valor) {
    // Soma por dimensão.
    const somas = new Map<string, { total: number; qtd: number }>();
    for (const l of linhas) {
      const chave = String(l[agrupar] ?? "(sem valor)");
      const atual = somas.get(chave) ?? { total: 0, qtd: 0 };
      atual.total += Number(l[fonte.valor]) || 0;
      atual.qtd += 1;
      somas.set(chave, atual);
    }
    const ordenadas = [...somas.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
    for (const [chave, { total, qtd }] of ordenadas.slice(0, 12)) {
      numeros.push({
        rotulo: `${chave} (${qtd})`, valor: total, formatado: brl(total),
        fonte: fonte.id, competencia: periodo,
      });
    }
    const totalGeral = [...somas.values()].reduce((a, v) => a + v.total, 0);
    numeros.push({
      rotulo: "Total", valor: totalGeral, formatado: brl(totalGeral),
      fonte: fonte.id, competencia: periodo,
    });
    if (ordenadas.length > 12) {
      avisos.push(`Mostrei os 12 maiores de ${ordenadas.length} grupos; o Total inclui todos.`);
    }
  } else if (agrupar) {
    // Sem coluna de valor: conta ocorrências.
    const contagem = new Map<string, number>();
    for (const l of linhas) {
      const chave = String(l[agrupar] ?? "(sem valor)");
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    for (const [chave, qtd] of [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      numeros.push({
        rotulo: chave, valor: qtd, formatado: `${qtd}`,
        fonte: fonte.id, competencia: periodo,
      });
    }
  } else if (fonte.valor) {
    const total = linhas.reduce((a, l) => a + (Number(l[fonte.valor!]) || 0), 0);
    numeros.push({
      rotulo: `Total (${linhas.length} registros)`, valor: total, formatado: brl(total),
      fonte: fonte.id, competencia: periodo,
    });
  } else {
    numeros.push({
      rotulo: "Registros encontrados", valor: linhas.length, formatado: `${linhas.length}`,
      fonte: fonte.id, competencia: periodo,
    });
  }

  // Amostra de linhas para o modelo ter o "quem" e não só o "quanto".
  const amostra = linhas.slice(0, 15).map((l) =>
    "  " + fonte.listar.map((c) => `${c}: ${l[c] ?? "—"}`).join(" · "));

  const paraModelo = [
    `FONTE: ${fonte.id} (${fonte.area}) — ${fonte.descricao}`,
    `Período: ${periodo} · ${linhas.length} registro(s) lidos`,
    agrupar ? `Agrupado por: ${agrupar}` : "",
    "",
    ...numeros.map((n) => `${n.rotulo}: ${n.formatado}`),
    "",
    `Amostra (até 15 de ${linhas.length}):`,
    ...amostra,
    "",
    "LIMITE: estes números vieram do banco agora, mas NÃO passaram por conferência de",
    "soma como as consultas de DRE e caixa. Diga de qual tabela vieram e trate-os como",
    "levantamento, não como fechamento contábil.",
  ].filter(Boolean).join("\n");

  return { consulta: `explorar:${fonte.id}`, ok: true, nivel: "consultado", numeros, paraModelo, avisos };
}

/** Última competência fechada — usada quando a pergunta não diz o mês. */
export async function ultimoMesFechado(
  supabase: { from: (t: string) => any },
): Promise<Competencia | null> {
  const [demRes, travasRes] = await Promise.all([
    supabase.from("demonstracoes_contabeis").select("dados").eq("tipo", "dre").eq("periodo", "completo").maybeSingle(),
    supabase.from("demonstracoes_mes_trancado").select("col_key"),
  ]);
  if (!demRes.data) return null;

  const dre = estruturar(demRes.data.dados);
  const travas = ((travasRes.data ?? []) as { col_key: string }[]).map((t) => t.col_key);
  const fechados = mesesFechados(dre, travas);
  return fechados.length > 0 ? fechados[fechados.length - 1] : null;
}

export { montarColuna };
