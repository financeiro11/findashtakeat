import { apelidoDe, type MapaApelidos } from "@/lib/apelidos";

/* ---------------------------------------------------------------------------
 * O nome que a linha da Auditoria mostra.
 *
 * A esteira da Auditoria grava o MEMO da fatura como o Sicoob mandou — lojista,
 * código de reserva e cidade numa string só ("LATAM AIR*0000V SAO PAULO"), e no
 * caso do achado ainda com o valor colado no fim. Ninguém reconhece esse texto
 * numa reunião, e é o mesmo gasto que na DRE aparece como "Latam".
 *
 * A tradução tem DOIS degraus, nesta ordem:
 *
 *   1. o MEMO cru vira o nome limpo do módulo do Cartão, pela RPC
 *      `auditoria_lojistas` (casamento por data + valor) — "LATAM";
 *   2. esse nome limpo procura apelido na Parametrização — "Latam".
 *
 * O primeiro degrau existe porque a fila da Parametrização é montada em cima de
 * `cartao_lancamentos.estabelecimento`: quem cadastrou o apelido cadastrou para
 * "LATAM", nunca para "LATAM AIR*0000V SAO PAULO". Sem ele, procurar apelido com
 * o MEMO cru acha 179 dos 862 lançamentos; com ele, 351 — e os outros pelo menos
 * passam a mostrar um nome legível em vez do MEMO.
 *
 * Módulo puro de propósito: é o que dá para testar sem React nem Supabase.
 * ------------------------------------------------------------------------- */

/** `"2026-07-15|61399"` -> `"LATAM"`. É o retorno cru da RPC. */
export type MapaLojistas = Record<string, string>;

/** `"2026-07-15|61399"` -> `"Cadeira e 2 monitores"`. Retorno da RPC
 *  `auditoria_compras` — a mesma chave data+valor, outra pergunta. */
export type MapaCompras = Record<string, string>;

/**
 * A chave do casamento: data da compra + valor em centavos.
 *
 * Centavos como inteiro porque comparar float de dinheiro erra em 0,01 e some —
 * mesmo cuidado do de-para do cartão. Data e valor incompletos devolvem `null`,
 * que é diferente de uma chave que não achou ninguém.
 */
export function chaveLojista(
  data: string | null | undefined,
  valor: number | null | undefined,
): string | null {
  const d = String(data ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  // `Number(null)` é 0, e 0 é finito: sem esta linha, um valor ausente viraria a
  // chave "…|0" e casaria com o primeiro lançamento de valor zero da base.
  if (valor === null || valor === undefined) return null;
  const v = Number(valor);
  if (!Number.isFinite(v)) return null;
  return `${d}|${Math.round(Math.abs(v) * 100)}`;
}

/**
 * Tira o valor que a esteira cola no fim do título do achado.
 *
 * `auditoria.titulo` é "estabelecimento + R$ valor" numa string só — o valor já
 * tem coluna própria na tela, e repetido no meio do nome ele só atrapalha a
 * busca e o casamento por apelido.
 */
export function semValorNoFim(texto: string | null | undefined): string {
  return String(texto ?? "").replace(/\s+R\$\s*[\d.]+,\d{2}\s*$/, "").trim();
}

export type NomeContraparte = {
  /** O que a linha escreve em cima: apelido > lojista limpo > nome cru. */
  exibido: string;
  /** O texto da fatura, sem o valor. É ele que se procura no extrato e no Omie. */
  cru: string;
  /** A frase da Parametrização, quando há — vai para o `title` do elemento. */
  oQueE: string | null;
  /** true quando `exibido` veio da Parametrização (apelido), não de fallback. */
  temApelido: boolean;
  /** O que a NOTA diz que foi comprado, quando alguém anexou comprovante e a IA
   *  o leu. Ver `fraseDaNota` — é por lançamento, nunca por contraparte. */
  oQueComprou: string | null;
};

/* ---------------------------------------------------------------------------
 * O que foi comprado
 *
 * O apelido responde QUEM recebeu o dinheiro; esta frase responde O QUE veio na
 * caixa. São perguntas diferentes e vivem em lugares diferentes de propósito: o
 * mesmo Mercado Livre aparece seis vezes numa fatura, com seis compras distintas.
 * Se o produto virasse o nome exibido, um fornecedor recorrente viraria seis
 * fornecedores estreantes — e é o nome exibido que agrupa o drill-down da DRE,
 * alimenta o Pareto da Revisão e decide o chip de "novo / voltou".
 *
 * Por isso a frase é a TERCEIRA linha, embaixo do apelido e do nome cru, e nunca
 * substitui nenhum dos dois.
 * ------------------------------------------------------------------------- */

/** O pedaço de `auditoria.ia_leitura` que a tela aproveita. */
export type LeituraDaNota = {
  descricao?: string | null;
  valores?: { rotulo: string; valor: number }[] | null;
} | null | undefined;

/**
 * A frase curta que a IA escreveu sobre o documento, pronta para a linha.
 *
 * Devolve `null` — e não string vazia — quando não há leitura: é `null` que faz
 * a linha de apoio sumir em vez de abrir um espaço em branco.
 *
 * NÃO confere de qual arquivo veio a leitura. Essa guarda é de quem chama, e ela
 * existe: uma transcrição feita antes de a pessoa trocar o comprovante descreve
 * outro documento. Na Auditoria quem barra é `leituraDoArquivo`; no módulo do
 * Cartão, a própria RPC `auditoria_compras` já sai filtrada.
 */
export function fraseDaNota(leitura: LeituraDaNota): string | null {
  const s = String(leitura?.descricao ?? "").trim();
  return s || null;
}

/**
 * O que foi comprado numa linha do módulo do Cartão, pelo mapa da RPC.
 *
 * Mesma chave data+valor da `auditoria_lojistas`: não há id em comum entre a
 * esteira da Auditoria e a do Cartão. Devolve `null` quando não há nota lida
 * para aquela compra — que é a maioria das linhas, e é assim mesmo.
 */
export function compraDe(
  compras: MapaCompras | null | undefined,
  data: string | null | undefined,
  valor: number | null | undefined,
): string | null {
  const chave = chaveLojista(data, valor);
  const s = String((chave && compras?.[chave]) ?? "").trim();
  return s || null;
}

/**
 * Os itens do documento, para o detalhe.
 *
 * A frase resume; a lista prova. Fora ficam as linhas que existem para o fisco e
 * não para o cartão (ICMS, base de cálculo, desconto) — `rotuloNaoPagavel` é a
 * mesma regra que o servidor usa para não aprovar uma cobrança contra o imposto
 * destacado. O total também sai: ele já tem lugar próprio na ficha.
 */
export function itensDaNota(
  leitura: LeituraDaNota,
  ehNaoPagavel: (rotulo: string) => boolean,
  totalDocumento?: number | null,
): { rotulo: string; valor: number }[] {
  const total = Number(totalDocumento);
  return (leitura?.valores ?? [])
    .filter((v) => v && String(v.rotulo ?? "").trim() && Number.isFinite(Number(v.valor)))
    .filter((v) => !ehNaoPagavel(v.rotulo))
    .filter((v) => !(Number.isFinite(total) && Math.abs(Number(v.valor) - total) < 0.005));
}

/**
 * O nome de uma linha da Auditoria — achado ou lançamento da base do cartão.
 *
 * O apelido é procurado PELOS DOIS nomes: primeiro pelo lojista limpo (é o que a
 * fila da Parametrização cadastra) e depois pelo cru, porque a esteira de junho
 * já gravava alguns nomes limpos ("UBER") e esses casam direto.
 */
export function nomeContraparte(
  apelidos: MapaApelidos | null | undefined,
  lojistas: MapaLojistas | null | undefined,
  linha: {
    nome: string | null | undefined;
    data: string | null | undefined;
    valor: number | null | undefined;
    documento?: string | null;
    /** O que a nota diz que foi comprado — já conferido contra o arquivo
     *  anexado por quem chama. Ver `fraseDaNota`. */
    compra?: string | null;
  },
): NomeContraparte {
  const cru = semValorNoFim(linha?.nome);
  const chave = chaveLojista(linha?.data, linha?.valor);
  const lojista = (chave && lojistas?.[chave]) || null;

  const ap =
    (lojista ? apelidoDe(apelidos, lojista, linha?.documento) : null) ??
    apelidoDe(apelidos, cru, linha?.documento);

  return {
    exibido: ap?.apelido || lojista || cru,
    cru,
    oQueE: ap?.oQueE ?? null,
    temApelido: !!ap,
    oQueComprou: String(linha?.compra ?? "").trim() || null,
  };
}

/** Tudo o que a busca da tela deve varrer numa linha — inclusive o apelido e o
 *  que foi comprado. Procurar por "monitor" tem de achar a linha que diz
 *  "monitor", senão o filtro esconde justamente o que a leitura veio revelar. */
export function textoDaBusca(n: NomeContraparte): string {
  return `${n.exibido} ${n.cru} ${n.oQueE ?? ""} ${n.oQueComprou ?? ""}`.toLowerCase();
}
