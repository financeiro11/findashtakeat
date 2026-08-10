// Consulta nomeada do cartão de crédito — a mesma leitura que a tela /governanca/cartao faz.
//
// POR QUE UMA CONSULTA PRÓPRIA, e não `explorar` sobre cartao_lancamentos:
// "por que a fatura saltou de julho para agosto?" não é uma soma, é uma ATRIBUIÇÃO. O
// explorador genérico devolve os maiores gastos do período — que é uma lista de quem é
// grande, não de quem MUDOU. A META ADS lidera as duas faturas e não explica nada; a
// DATADOG aparece do nada em quarto lugar e explica metade do salto. Sem comparar mês a
// mês por estabelecimento, a resposta sai correta e inútil.
//
// A regra de leitura é a mesma da tela (src/pages/cartao/analise.ts): só `tipo = 'gasto'`
// entra na conta — pagamento de fatura e estorno não são despesa, e somá-los dobraria o
// mês. É por isso que os números daqui batem com o que a pessoa está vendo.
//
// FATURA NÃO É COMPETÊNCIA CONTÁBIL: a fatura de agosto fecha no fim de julho e o gasto
// cai no DRE pela rubrica de cada lançamento. Perguntar "a fatura subiu" e responder com
// o DRE (ou o contrário) troca as duas medidas — o bloco avisa isso ao modelo.

import { brl, fecha, Numero, pct, Resultado } from "./base.ts";
import { Competencia, competenciaExtenso, ordenar } from "./dre.ts";

type Fatura = { competencia: string; mes_label: string | null };
type LinhaCartao = {
  competencia: string;
  estabelecimento: string | null;
  categoria: string | null;
  valor: number | string | null;
  tipo: string | null;
};

/** Teto de segurança: uma fatura tem ~600 linhas; duas nunca chegam perto disso. */
const TETO_LINHAS = 8000;
const PAGINA = 1000;

const CONSULTA = "cartao_fatura";

function competenciaDeISO(iso: string): Competencia {
  const [ano, mes] = iso.split("-");
  return { ano: Number(ano), mes: Number(mes) };
}

function falha(avisos: string[]): Resultado {
  return { consulta: CONSULTA, ok: false, numeros: [], paraModelo: "", avisos };
}

/**
 * Lê os lançamentos das competências pedidas.
 *
 * Paginado porque o PostgREST corta a resposta num teto próprio SEM AVISAR, e aqui
 * truncar não deixa o número incompleto: deixa ERRADO. A tela faz o mesmo, pelo mesmo
 * motivo.
 */
async function lerLancamentos(
  supabase: { from: (t: string) => any },
  competencias: string[],
): Promise<{ linhas: LinhaCartao[]; erro: string | null }> {
  const linhas: LinhaCartao[] = [];
  for (let de = 0; de < TETO_LINHAS; de += PAGINA) {
    const { data, error } = await supabase
      .from("cartao_lancamentos")
      .select("competencia, estabelecimento, categoria, valor, tipo")
      .in("competencia", competencias)
      .order("competencia")
      .order("valor", { ascending: false })
      .range(de, de + PAGINA - 1);
    if (error) return { linhas, erro: error.message };
    const pagina = (data ?? []) as LinhaCartao[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return { linhas, erro: null };
}

type PorChave = Map<string, { atual: number; anterior: number }>;

function acumular(mapa: PorChave, chave: string, valor: number, ehAtual: boolean) {
  const item = mapa.get(chave) ?? { atual: 0, anterior: 0 };
  if (ehAtual) item.atual += valor;
  else item.anterior += valor;
  mapa.set(chave, item);
}

/** Ordena por quem mais mexeu em reais — para cima ou para baixo. */
function movimentos(mapa: PorChave) {
  return [...mapa.entries()]
    .map(([chave, v]) => ({ chave, ...v, delta: v.atual - v.anterior }))
    .filter((m) => Math.abs(m.delta) >= 0.005)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function rotuloMovimento(m: { atual: number; anterior: number; delta: number }): string {
  if (m.anterior === 0) return "novo — não vinha na fatura anterior";
  if (m.atual === 0) return "sumiu — não veio nesta fatura";
  return `${brl(m.anterior)} → ${brl(m.atual)} (${pct((m.delta / m.anterior) * 100)})`;
}

/**
 * A fatura do cartão de um mês contra a anterior, com a variação atribuída por
 * estabelecimento e por categoria.
 *
 * `pedida` é o mês MAIS RECENTE da comparação ("de julho para agosto" → agosto). Sem mês
 * pedido, usa as duas últimas faturas importadas.
 */
export async function cartaoFatura(
  supabase: { from: (t: string) => any },
  pedida: Competencia | null,
): Promise<Resultado> {
  const { data: faturasData, error: erroFaturas } = await supabase
    .from("cartao_faturas")
    .select("competencia, mes_label")
    .order("competencia");

  if (erroFaturas) return falha([`Não consegui ler as faturas do cartão: ${erroFaturas.message}`]);

  const faturas = ((faturasData ?? []) as Fatura[])
    .map((f) => ({ ...f, c: competenciaDeISO(f.competencia) }))
    .sort((a, b) => ordenar(a.c, b.c));

  if (faturas.length === 0) {
    return falha(["Nenhuma fatura de cartão importada ainda."]);
  }

  const avisos: string[] = [];

  let iAtual = faturas.length - 1;
  if (pedida) {
    const achado = faturas.findIndex((f) => f.c.ano === pedida.ano && f.c.mes === pedida.mes);
    if (achado === -1) {
      // Mês sem fatura importada é o caso comum de pergunta com ano errado ("julho para
      // agosto" lido como 2024). Dizer QUAIS faturas existem evita a segunda pergunta.
      avisos.push(
        `Não tenho fatura de ${competenciaExtenso(pedida)}. As faturas importadas vão de ` +
        `${competenciaExtenso(faturas[0].c)} a ${competenciaExtenso(faturas[faturas.length - 1].c)}; ` +
        `usei a última.`,
      );
    } else {
      iAtual = achado;
    }
  }

  const atual = faturas[iAtual];
  const anterior = iAtual > 0 ? faturas[iAtual - 1] : null;

  if (!anterior) {
    avisos.push(
      `${competenciaExtenso(atual.c)} é a primeira fatura importada — não há mês anterior ` +
      "para comparar.",
    );
  }

  const competencias = [atual.competencia, ...(anterior ? [anterior.competencia] : [])];
  const { linhas, erro } = await lerLancamentos(supabase, competencias);
  if (erro) return falha([`Não consegui ler os lançamentos do cartão: ${erro}`]);
  if (linhas.length === 0) {
    return falha([`A fatura de ${competenciaExtenso(atual.c)} está sem lançamentos importados.`]);
  }

  const porEstab: PorChave = new Map();
  const porCategoria: PorChave = new Map();
  let totalAtual = 0;
  let totalAnterior = 0;
  let qtdAtual = 0;
  let qtdAnterior = 0;
  let pagamentos = 0;
  let estornos = 0;

  for (const l of linhas) {
    const valor = Number(l.valor) || 0;
    const ehAtual = l.competencia === atual.competencia;
    if (l.tipo === "pagamento") { if (ehAtual) pagamentos += valor; continue; }
    if (l.tipo === "estorno") { if (ehAtual) estornos += valor; continue; }

    if (ehAtual) { totalAtual += valor; qtdAtual += 1; } else { totalAnterior += valor; qtdAnterior += 1; }
    acumular(porEstab, (l.estabelecimento ?? "").trim() || "(sem estabelecimento)", valor, ehAtual);
    acumular(porCategoria, (l.categoria ?? "").trim() || "(sem categoria)", valor, ehAtual);
  }

  const delta = totalAtual - totalAnterior;
  const pctDelta = totalAnterior > 0 ? (delta / totalAnterior) * 100 : null;

  // Conferência: os estabelecimentos têm que somar a fatura. Se não somarem, algum
  // lançamento ficou fora da leitura e a atribuição da variação não vale.
  const somaEstab = [...porEstab.values()].reduce((a, v) => a + v.atual, 0);
  if (!fecha([somaEstab], totalAtual)) {
    avisos.push(
      "A soma por estabelecimento não bate com o total da fatura — trate a decomposição " +
      "abaixo com reserva.",
    );
  }

  const movEstab = movimentos(porEstab);
  const altas = movEstab.filter((m) => m.delta > 0).slice(0, 8);
  const quedas = movEstab.filter((m) => m.delta < 0).slice(0, 5);
  const movCat = movimentos(porCategoria).slice(0, 6);

  const rotuloAtual = atual.mes_label || competenciaExtenso(atual.c);
  const rotuloAnterior = anterior ? (anterior.mes_label || competenciaExtenso(anterior.c)) : null;

  const numeros: Numero[] = [
    {
      rotulo: `Fatura de ${competenciaExtenso(atual.c)} (gastos)`,
      valor: totalAtual, formatado: brl(totalAtual),
      fonte: "Cartão Sicoob · OFX", competencia: rotuloAtual,
    },
  ];
  if (anterior) {
    numeros.push(
      {
        rotulo: `Fatura de ${competenciaExtenso(anterior.c)} (gastos)`,
        valor: totalAnterior, formatado: brl(totalAnterior),
        fonte: "Cartão Sicoob · OFX", competencia: rotuloAnterior!,
      },
      {
        rotulo: "Variação da fatura", valor: delta, formatado: brl(delta),
        fonte: "Cartão Sicoob · OFX", competencia: `${rotuloAnterior} → ${rotuloAtual}`,
      },
    );
    for (const m of [...altas.slice(0, 5), ...quedas.slice(0, 3)]) {
      numeros.push({
        rotulo: `${m.chave} (variação)`, valor: m.delta, formatado: brl(m.delta),
        fonte: "Cartão Sicoob · OFX", competencia: `${rotuloAnterior} → ${rotuloAtual}`,
      });
    }
  }

  const linhaMov = (m: { chave: string; atual: number; anterior: number; delta: number }) =>
    `  ${m.chave}: ${m.delta > 0 ? "+" : ""}${brl(m.delta)} — ${rotuloMovimento(m)}` +
    (Math.abs(delta) > 0 ? ` · ${pct((Math.abs(m.delta) / Math.abs(delta)) * 100)} da variação da fatura` : "");

  const paraModelo = [
    `FATURA DO CARTÃO — ${competenciaExtenso(atual.c)}`,
    `Gastos: ${brl(totalAtual)} em ${qtdAtual} lançamentos.`,
    ...(anterior
      ? [
          `Fatura anterior (${competenciaExtenso(anterior.c)}): ${brl(totalAnterior)} em ${qtdAnterior} lançamentos.`,
          `VARIAÇÃO: ${delta >= 0 ? "+" : ""}${brl(delta)}${pctDelta === null ? "" : ` (${pct(pctDelta)})`}.`,
        ]
      : []),
    ...(pagamentos > 0 || estornos > 0
      ? [`Pagamentos de fatura no mês: ${brl(pagamentos)}. Estornos: ${brl(estornos)}. ` +
         "Nenhum dos dois entra nos gastos acima."]
      : []),
    ...(anterior && altas.length
      ? ["", "QUEM SUBIU (ordenado pelo tamanho da variação em reais):", ...altas.map(linhaMov)]
      : []),
    ...(anterior && quedas.length
      ? ["", "QUEM CAIU:", ...quedas.map(linhaMov)]
      : []),
    ...(anterior && movCat.length
      ? ["", "POR CATEGORIA (variação):", ...movCat.map(linhaMov)]
      : []),
    "",
    "COMO LER ISTO:",
    "- A variação já está ATRIBUÍDA acima. Responda dizendo QUEM explica o salto e quanto",
    "  cada um pesa, não repita o total em prosa.",
    "- Só lançamentos do tipo 'gasto' entram. Pagamento da fatura e estorno ficam fora, e",
    "  por isso este total é o mesmo que a tela do Cartão mostra.",
    "- Fatura NÃO é competência contábil: a fatura de um mês fecha no mês anterior e cada",
    "  lançamento cai no DRE pela sua rubrica. Não misture este número com DRE, DFC ou",
    "  saldo de caixa — se a pergunta era sobre a fatura, responda só sobre a fatura.",
    "- Estabelecimento marcado como 'novo' não tinha nenhum lançamento na fatura anterior;",
    "  vale confirmar se é contratação nova ou troca de forma de pagamento.",
  ].join("\n");

  return {
    consulta: CONSULTA,
    ok: true,
    nivel: "conferido",
    numeros,
    paraModelo,
    avisos,
  };
}
