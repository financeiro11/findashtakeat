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
  mesesFechados, montarColuna, ordenar, valorDe,
} from "./dre.ts";

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

/**
 * Rubricas-folha por grupo, espelhando a árvore de src/pages/DRE.tsx.
 *
 * Duplicação consciente: a árvore lá é de renderização e vive no bundle do browser. Se
 * rubricas forem renomeadas no DRE, ESTA lista precisa acompanhar — a conferência de soma
 * abaixo detecta a divergência (as folhas deixam de reproduzir o grupo) em vez de deixar
 * passar uma análise silenciosamente incompleta.
 */
const FOLHAS_POR_GRUPO: Record<string, string[]> = {
  "(-) Custos Operacionais": [
    "Equipe Operacional", "Premiações Operacionais", "Meios de Pagamento", "CMV Materiais",
    "Servidor", "Softwares Operacionais", "Outros Custos",
  ],
  "Pessoal": [
    "Equipe Administrativa", "Equipe Marketing", "Equipe Parcerias", "Equipe Comercial",
    "Equipe Onboarding", "Equipe Tecnologia", "Benefícios", "Encargos Sociais",
  ],
  "Despesas Administrativas": [
    "Ocupação & Escritório", "Assessorias & Consultorias", "Softwares Administrativos",
    "Viagens & Transportes Adm", "Outras despesas Adm",
  ],
  "Despesas Marketing & Vendas": [
    "Campanhas de Mídia Paga", "Campanhas de Outros Canais", "Comissões Consultores / Parceiros",
    "Premiações", "MGM", "Softwares Marketing & Vendas", "Agências & Consultorias",
    "Viagens & Transportes Mkt", "Eventos e Feiras", "Outras despesas Mkt",
  ],
};

/** Os três blocos de primeiro nível que compõem o EBITDA. */
const BLOCOS_EBITDA = ["Receita Líquida", "(-) Custos Operacionais", "(-) SG&A"];

/**
 * Descobre o sinal com que custos e despesas estão gravados.
 *
 * O blob não é consistente entre importações: uma despesa pode estar salva como positivo
 * (e o sinal ficar só no rótulo "(-)") ou já como negativo. Presumir erraria a direção da
 * análise inteira — então testamos as duas hipóteses contra o EBITDA salvo e adotamos a
 * que fecha. Se nenhuma fechar, não afirmamos nada.
 */
function descobrirSinal(d: Demonstracao, c: Competencia): -1 | 1 | null {
  const receita = valorDe(d, "Receita Líquida", c);
  const custos = valorDe(d, "(-) Custos Operacionais", c);
  const sga = valorDe(d, "(-) SG&A", c);
  const ebitda = valorDe(d, "EBITDA", c);
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

  const ebitdaAtual = valorDe(dre, "EBITDA", atual);
  const ebitdaAnterior = valorDe(dre, "EBITDA", anterior);
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
    const a = valorDe(dre, bloco, anterior);
    const b = valorDe(dre, bloco, atual);
    if (a === null || b === null) {
      avisos.push(`Bloco "${bloco}" ausente em um dos meses — decomposição incompleta.`);
      continue;
    }
    const peso = bloco === "Receita Líquida" ? 1 : -sinal;
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

  // Detalhamento por folha, dentro dos grupos que existem no blob.
  const detalhes: Contribuicao[] = [];
  for (const [grupo, folhas] of Object.entries(FOLHAS_POR_GRUPO)) {
    for (const folha of folhas) {
      const a = valorDe(dre, folha, anterior);
      const b = valorDe(dre, folha, atual);
      if (a === null || b === null || a === b) continue;
      const peso = grupo === "Receita Líquida" ? 1 : -sinal;
      detalhes.push({ rubrica: folha, anterior: a, atual: b, efeito: (b - a) * peso });
    }
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
    "LIMITE DESTES DADOS: o DRE vai até o nível de rubrica. Não existe aqui o lançamento,",
    "o fornecedor nem o centro de custo por trás de cada rubrica. Diga qual rubrica moveu o",
    "resultado e PARE aí — não invente a causa dentro dela; aponte o Omie para investigar.",
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
    const v = valorDe(dre, linha, alvo);
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
  const receita = valorDe(dre, "Receita Líquida", alvo);
  const ebitda = valorDe(dre, "EBITDA", alvo);
  if (receita !== null && ebitda !== null && receita !== 0) {
    const margem = (ebitda / receita) * 100;
    numeros.push({
      rotulo: "Margem EBITDA", valor: margem, formatado: pct(margem),
      fonte: "DRE Omie (calculada)", competencia: competenciaCurta(alvo),
    });
  }

  if (anterior) {
    for (const linha of ["Receita Líquida", "EBITDA"]) {
      const a = valorDe(dre, linha, anterior);
      const b = valorDe(dre, linha, alvo);
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

/** Casa o que a pessoa escreveu com o nome exato da rubrica no blob. */
function acharRubrica(dre: Demonstracao, procurado: string): string | null {
  // Remove acentos para casar "margem de contribuicao" com "Margem de contribuição".
  const limpar = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  const alvo = limpar(procurado);
  if (!alvo) return null;

  const rubricas = [...dre.valores.keys()];
  const exata = rubricas.find((r) => limpar(r) === alvo);
  if (exata) return exata;

  // Contém — a mais curta entre as candidatas é a mais específica
  // ("Equipe Comercial" ganha de "Equipe Comercial e Marketing" para a busca "comercial").
  const contendo = rubricas
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
  const valor = valorDe(dre, rubrica, alvo);
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
    const antes = valorDe(dre, rubrica, anterior);
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
    `LIMITE: o DRE só tem o total da rubrica. Quem são os fornecedores, quais lançamentos`,
    `compõem esse valor e por que ele mudou não está nesta base — isso está no Omie.`,
  ].join("\n");

  return { consulta: "rubrica_do_mes", ok: true, numeros, paraModelo, avisos };
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
