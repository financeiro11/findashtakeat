// Consultas do Hub além do DRE — DFC, orçamento, KPIs de SaaS, caixa futuro e as
// justificativas de variação já escritas.
//
// Separado de consultas.ts por assunto, não por importância: aquele arquivo cuida do
// resultado (DRE, EBITDA, rubricas, lançamentos) e este cuida do resto do Hub. As duas
// famílias obedecem ao mesmo contrato `Resultado`, então o orquestrador não distingue.

import { brl, fecha, Numero, pct, Resultado } from "./base.ts";
import {
  Competencia, competenciaCurta, competenciaExtenso, estruturar, mesesFechados,
  montarColuna, ordenar, valorDe,
} from "./dre.ts";
import { analisarTendencia, fraseTendencia, julgarSerie, frasePadrao, serieAnterior } from "./julgamento.ts";

// ---------------------------------------------------------------------------
// DFC — o fluxo de caixa contábil
// ---------------------------------------------------------------------------

/**
 * Panorama do DFC.
 *
 * O DFC responde uma pergunta que nem o extrato bancário nem o DRE respondem: quanto
 * caixa a operação gerou ou consumiu, separado de investimento e de financiamento. Lucro
 * não é caixa e saldo bancário não é geração de caixa — três medidas, três perguntas.
 *
 * Mesmas regras do DRE: só mês travado é comparável, e linha com filhos seria soma dos
 * filhos. Aqui lemos as linhas de topo diretamente porque o esquema do DFC não está
 * espelhado em árvore — por isso o resultado avisa quando uma linha não é encontrada,
 * em vez de assumir zero.
 */
const LINHAS_DFC = [
  "Fluxo de Caixa Operacional",
  "Fluxo de Caixa de Investimento",
  "Fluxo de Caixa de Financiamento",
  "Fluxo Livre",
  "Saldo Inicial",
  "Saldo Final",
];

export async function panoramaDFC(
  supabase: { from: (t: string) => any },
  pedida: Competencia | null,
): Promise<Resultado> {
  const [demRes, travasRes] = await Promise.all([
    supabase.from("demonstracoes_contabeis").select("dados, updated_at")
      .eq("tipo", "dfc").eq("periodo", "completo").maybeSingle(),
    supabase.from("demonstracoes_mes_trancado").select("col_key"),
  ]);

  if (demRes.error || !demRes.data) {
    return {
      consulta: "dfc_do_mes", ok: false, numeros: [], paraModelo: "",
      avisos: ["Não encontrei o DFC consolidado. Ele é importado junto com o DRE."],
    };
  }

  const dfc = estruturar(demRes.data.dados, demRes.data.updated_at ?? null);
  const travas = ((travasRes.data ?? []) as { col_key: string }[]).map((t) => t.col_key);
  const fechados = mesesFechados(dfc, travas);
  const avisos: string[] = [];

  if (dfc.competencias.length === 0) {
    return { consulta: "dfc_do_mes", ok: false, numeros: [], paraModelo: "", avisos: ["O DFC está vazio."] };
  }

  const alvo = pedida ?? fechados[fechados.length - 1] ?? dfc.competencias[dfc.competencias.length - 1];
  if (!fechados.some((f) => f.ano === alvo.ano && f.mes === alvo.mes)) {
    avisos.push(`${competenciaCurta(alvo)} não está fechado — os valores são parciais.`);
  }

  const numeros: Numero[] = [];
  const julgamentos: string[] = [];

  for (const linha of LINHAS_DFC) {
    const v = valorDe(dfc, linha, alvo);
    if (v === null) continue;
    numeros.push({
      rotulo: linha, valor: v, formatado: brl(v),
      fonte: "DFC Omie", competencia: competenciaCurta(alvo),
    });

    if (linha === "Fluxo de Caixa Operacional" || linha === "Fluxo Livre") {
      const historico = serieAnterior(dfc, linha, fechados, alvo);
      julgamentos.push(
        `  ${linha}: ${frasePadrao(julgarSerie(historico, v), brl)}; ` +
        `${fraseTendencia(analisarTendencia([...historico, v]))}.`,
      );
    }
  }

  if (numeros.length === 0) {
    return {
      consulta: "dfc_do_mes", ok: false, numeros: [], paraModelo: "",
      avisos: [`Não achei as linhas de fluxo no DFC de ${competenciaCurta(alvo)}.`],
    };
  }

  // Conferência: quando as três atividades e o Fluxo Livre existem, eles têm que fechar.
  const op = valorDe(dfc, "Fluxo de Caixa Operacional", alvo);
  const inv = valorDe(dfc, "Fluxo de Caixa de Investimento", alvo);
  const fin = valorDe(dfc, "Fluxo de Caixa de Financiamento", alvo);
  const livre = valorDe(dfc, "Fluxo Livre", alvo);
  if (op !== null && inv !== null && fin !== null && livre !== null && !fecha([op, inv, fin], livre)) {
    avisos.push(
      "As três atividades não somam o Fluxo Livre gravado — trate a decomposição com " +
      "reserva e confira o fechamento do mês.",
    );
  }

  const paraModelo = [
    `DFC — ${competenciaExtenso(alvo)}`,
    ...numeros.map((n) => `${n.rotulo}: ${n.formatado}`),
    ...(julgamentos.length ? ["", "JULGAMENTO (calculado — comunique, não recalcule):", ...julgamentos] : []),
    "",
    "O QUE O DFC É E O QUE NÃO É: ele mede geração de caixa por atividade, em regime de",
    "caixa. NÃO é o saldo do banco (isso é extrato) nem o lucro (isso é DRE). Empresa pode",
    "ter lucro e queimar caixa, e vice-versa. Não misture as três medidas na mesma frase",
    "sem dizer qual é qual.",
  ].join("\n");

  return { consulta: "dfc_do_mes", ok: true, numeros, paraModelo, avisos };
}

// ---------------------------------------------------------------------------
// Justificativas de variação — a explicação que alguém já escreveu
// ---------------------------------------------------------------------------

type LinhaJustificativa = {
  rubrica: string; mes: string; mes_anterior: string | null;
  valor: number | null; valor_anterior: number | null; delta: number | null;
  delta_pct: number | null; texto: string | null; texto_editado: string | null;
  status: string | null; confianca: string | null;
};

/**
 * Busca a justificativa já escrita para uma rubrica num mês.
 *
 * Esta é a informação mais valiosa e mais barata do Hub para explicar variação: alguém
 * (ou a IA, revisada por alguém) já escreveu POR QUE aquela rubrica mudou. Atribuir a
 * variação estatisticamente e ignorar a explicação existente seria refazer, pior, um
 * trabalho que já está pronto.
 *
 * `texto_editado` tem precedência sobre `texto`: o que a pessoa escreveu vale mais que o
 * rascunho do modelo.
 */
export async function justificativaDe(
  supabase: { from: (t: string) => any },
  tipo: "dre" | "dfc",
  rubrica: string,
  c: Competencia,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("demonstracoes_justificativas")
      .select("rubrica, mes, mes_anterior, valor, valor_anterior, delta, delta_pct, texto, texto_editado, status, confianca")
      .eq("tipo", tipo)
      .eq("rubrica", rubrica)
      .eq("mes", montarColuna(c))
      .maybeSingle();

    const j = data as LinhaJustificativa | null;
    if (!j) return null;
    // Descartada é comentário que alguém rejeitou — ressuscitá-lo seria desfazer a decisão.
    if (j.status === "descartada") return null;

    const texto = (j.texto_editado ?? j.texto ?? "").trim();
    if (!texto) return null;

    const origem = j.texto_editado ? "escrita pelo time" : "rascunho da IA, não editado";
    return `"${texto}" (${origem})`;
  } catch {
    return null; // justificativa é enriquecimento; ausência não pode derrubar a resposta
  }
}

/** Todas as justificativas de um mês — para o radar e o panorama. */
export async function justificativasDoMes(
  supabase: { from: (t: string) => any },
  tipo: "dre" | "dfc",
  c: Competencia,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const { data } = await supabase
      .from("demonstracoes_justificativas")
      .select("rubrica, texto, texto_editado, status")
      .eq("tipo", tipo)
      .eq("mes", montarColuna(c));

    for (const j of (data ?? []) as LinhaJustificativa[]) {
      if (j.status === "descartada") continue;
      const texto = (j.texto_editado ?? j.texto ?? "").trim();
      if (texto) mapa.set(j.rubrica, texto);
    }
  } catch { /* silencioso por design */ }
  return mapa;
}

// ---------------------------------------------------------------------------
// Orçamento por área
// ---------------------------------------------------------------------------

type LinhaOrcamento = {
  ano: number; mes: number; area: string;
  orcado: number | null; realizado: number | null; saldo: number | null;
  consumido_pct: number | null; status: string | null;
};

/**
 * Orçamento por área: orçado, realizado, saldo e consumo.
 *
 * A view `vw_orcamento_area` já entrega tudo calculado, inclusive o percentual consumido —
 * então aqui não se recalcula nada, só se ordena pelo que está mais estourado. Recalcular
 * daria a chance de divergir da tela, que é o pior resultado possível.
 */
export async function orcamentoPorArea(
  supabase: { from: (t: string) => any },
  c: Competencia | null,
): Promise<Resultado> {
  let q = supabase.from("vw_orcamento_area").select("ano, mes, area, orcado, realizado, saldo, consumido_pct, status");
  if (c) q = q.eq("ano", c.ano).eq("mes", c.mes);

  const { data, error } = await q;
  if (error) {
    return {
      consulta: "orcamento_por_area", ok: false, numeros: [], paraModelo: "",
      avisos: [`Não consegui ler o orçamento: ${error.message}`],
    };
  }

  const linhas = (data ?? []) as LinhaOrcamento[];
  if (linhas.length === 0) {
    return {
      consulta: "orcamento_por_area", ok: false, numeros: [], paraModelo: "",
      avisos: [c ? `Sem orçamento lançado para ${competenciaCurta(c)}.` : "Sem orçamento lançado."],
    };
  }

  // Mais estourado primeiro: é o que decide ação.
  const ordenadas = [...linhas].sort((a, b) => (b.consumido_pct ?? 0) - (a.consumido_pct ?? 0));
  const periodo = c ? competenciaCurta(c) : "todos os períodos";

  const numeros: Numero[] = [];
  for (const l of ordenadas.slice(0, 10)) {
    numeros.push({
      rotulo: `${l.area} · realizado`, valor: l.realizado ?? 0, formatado: brl(l.realizado ?? 0),
      fonte: "Orçamento", competencia: `${String(l.mes).padStart(2, "0")}/${l.ano}`,
    });
    numeros.push({
      rotulo: `${l.area} · orçado`, valor: l.orcado ?? 0, formatado: brl(l.orcado ?? 0),
      fonte: "Orçamento", competencia: `${String(l.mes).padStart(2, "0")}/${l.ano}`,
    });
  }

  const estouradas = ordenadas.filter((l) => (l.consumido_pct ?? 0) > 100);
  const avisos: string[] = [];
  if (ordenadas.length > 10) {
    avisos.push(`Mostrei as 10 áreas de maior consumo, de ${ordenadas.length}.`);
  }

  const paraModelo = [
    `ORÇAMENTO POR ÁREA — ${periodo}`,
    ...ordenadas.slice(0, 12).map((l) =>
      `  ${l.area}: realizado ${brl(l.realizado ?? 0)} de ${brl(l.orcado ?? 0)} orçado · ` +
      `consumido ${l.consumido_pct != null ? pct(l.consumido_pct) : "—"} · saldo ${brl(l.saldo ?? 0)}` +
      (l.status ? ` · ${l.status}` : "")),
    "",
    estouradas.length
      ? `${estouradas.length} área(s) passaram de 100% do orçado: ${estouradas.map((l) => l.area).join(", ")}.`
      : "Nenhuma área passou do orçado.",
    "",
    "Os percentuais vêm calculados da view do Hub — são os MESMOS que a tela de Orçamento",
    "mostra. Não recalcule.",
  ].join("\n");

  return { consulta: "orcamento_por_area", ok: true, numeros, paraModelo, avisos };
}

// ---------------------------------------------------------------------------
// Snapshots de KPI (assinaturas, churn, investimentos)
// ---------------------------------------------------------------------------

/**
 * Achata um objeto aninhado em pares "caminho → número".
 *
 * Os snapshots guardam KPIs num `jsonb` de formato livre. Entregar o JSON cru ao modelo
 * funcionaria, mas os números não apareceriam na tabela da tela — e a regra é que todo
 * número exibido tenha procedência visível. Achatar resolve os dois: o modelo lê e a
 * pessoa confere.
 */
function achatarNumeros(obj: unknown, prefixo = "", saida: [string, number][] = [], profundidade = 0): [string, number][] {
  if (profundidade > 3 || saida.length > 60) return saida; // KPI não mora fundo; corta ruído

  if (Array.isArray(obj)) {
    // Arrays costumam ser séries ou listas de itens — só o tamanho interessa como KPI.
    if (prefixo) saida.push([`${prefixo} (itens)`, obj.length]);
    return saida;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const caminho = prefixo ? `${prefixo} · ${k}` : k;
      if (typeof v === "number" && Number.isFinite(v)) saida.push([caminho, v]);
      else achatarNumeros(v, caminho, saida, profundidade + 1);
    }
  }
  return saida;
}

/** Rótulos que são dinheiro; o resto (contagens, percentuais) não leva R$. */
const EH_DINHEIRO = /mrr|arr|receita|valor|ticket|faturamento|saldo|custo|investido|aporte/i;

export async function snapshotKpis(
  supabase: { from: (t: string) => any },
  tabela: "assinaturas_snapshot" | "churn_snapshot" | "investimentos_snapshot",
  rotuloArea: string,
): Promise<Resultado> {
  // investimentos_snapshot é por entidade, não por competência.
  const porCompetencia = tabela !== "investimentos_snapshot";
  const colunas = porCompetencia ? "competencia, mes_label, dados, gerado_em" : "entity, dados, atualizado_em";

  const { data, error } = await supabase
    .from(tabela)
    .select(colunas)
    .order(porCompetencia ? "competencia" : "entity", { ascending: false })
    .limit(porCompetencia ? 1 : 5);

  if (error || !data?.length) {
    return {
      consulta: tabela, ok: false, numeros: [], paraModelo: "",
      avisos: [`Sem dados de ${rotuloArea}${error ? `: ${error.message}` : "."}`],
    };
  }

  const numeros: Numero[] = [];
  const linhasTexto: string[] = [];

  for (const linha of data as Record<string, unknown>[]) {
    const rotulo = porCompetencia
      ? String(linha.mes_label ?? linha.competencia ?? "—")
      : String(linha.entity ?? "—");
    const pares = achatarNumeros(linha.dados);

    linhasTexto.push(`${rotulo}:`);
    for (const [chave, valor] of pares.slice(0, 25)) {
      const formatado = EH_DINHEIRO.test(chave)
        ? brl(valor)
        : valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      numeros.push({ rotulo: `${rotulo} · ${chave}`, valor, formatado, fonte: rotuloArea, competencia: rotulo });
      linhasTexto.push(`  ${chave}: ${formatado}`);
    }
  }

  if (numeros.length === 0) {
    return {
      consulta: tabela, ok: false, numeros: [], paraModelo: "",
      avisos: [`O snapshot de ${rotuloArea} existe, mas não tem número reconhecível dentro.`],
    };
  }

  const paraModelo = [
    `${rotuloArea.toUpperCase()} — última posição disponível`,
    ...linhasTexto,
    "",
    "Estes KPIs vieram de um snapshot gravado por sincronização, não de cálculo feito",
    "agora. Diga a competência junto com o número. Se a pergunta for sobre um mês que não",
    "está aqui, diga que não tem — não interpole.",
  ].join("\n");

  return { consulta: tabela, ok: true, nivel: "consultado", numeros, paraModelo, avisos: [] };
}

// ---------------------------------------------------------------------------
// Pagamentos previstos (caixa futuro)
// ---------------------------------------------------------------------------

type LinhaPagamento = {
  vencimento: string | null; fornecedor: string | null; categoria: string | null;
  valor: number | null; status: string | null;
};

/**
 * Contas a pagar em torno de uma data.
 *
 * Fecha a lacuna do caixa olhar só para trás: extrato e DFC contam o que já aconteceu;
 * isto conta o que vem. A RPC roda como SECURITY DEFINER sobre o cache do Omie e devolve
 * só a janela pedida — o dump bruto não é exposto.
 */
export async function pagamentosPrevistos(
  supabase: { rpc: (f: string, p: Record<string, unknown>) => any },
  dia: string,
  janelaDias = 15,
): Promise<Resultado> {
  const { data, error } = await supabase.rpc("pagamentos_previstos", {
    p_dia: dia, p_janela_dias: janelaDias,
  });

  if (error) {
    return {
      consulta: "pagamentos_previstos", ok: false, numeros: [], paraModelo: "",
      avisos: [`Não consegui consultar os pagamentos previstos: ${error.message}`],
    };
  }

  const linhas = (data ?? []) as LinhaPagamento[];
  if (linhas.length === 0) {
    return {
      consulta: "pagamentos_previstos", ok: false, numeros: [], paraModelo: "",
      avisos: [`Nenhum título a pagar em ${janelaDias} dias em torno de ${dia}.`],
    };
  }

  const total = linhas.reduce((a, l) => a + (l.valor ?? 0), 0);
  const porFornecedor = new Map<string, number>();
  for (const l of linhas) {
    const nome = (l.fornecedor ?? "").trim() || "sem fornecedor identificado";
    porFornecedor.set(nome, (porFornecedor.get(nome) ?? 0) + (l.valor ?? 0));
  }
  const maiores = [...porFornecedor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const numeros: Numero[] = [
    {
      rotulo: `Total a pagar (${linhas.length} títulos)`, valor: total, formatado: brl(total),
      fonte: "Omie · contas a pagar", competencia: `±${janelaDias} dias de ${dia}`,
    },
    ...maiores.map(([nome, v]) => ({
      rotulo: nome, valor: v, formatado: brl(v),
      fonte: "Omie · contas a pagar", competencia: `±${janelaDias} dias de ${dia}`,
    })),
  ];

  const paraModelo = [
    `PAGAMENTOS PREVISTOS — janela de ${janelaDias} dias em torno de ${dia}`,
    `${linhas.length} título(s), somando ${brl(total)}.`,
    "",
    "Maiores fornecedores:",
    ...maiores.map(([nome, v]) => `  ${nome}: ${brl(v)}`),
    "",
    "ATENÇÃO: a lista inclui títulos JÁ PAGOS que vencem na janela — provisionado não é o",
    "mesmo que em aberto. Se a pergunta for sobre o que ainda falta pagar, diga que este",
    "número é o provisionado total.",
  ].join("\n");

  return { consulta: "pagamentos_previstos", ok: true, numeros, paraModelo, avisos: [] };
}
