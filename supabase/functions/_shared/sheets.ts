/* ---------------------------------------------------------------------------
 * Google Sheets pelo gateway de conectores do Lovable — o caminho AUTENTICADO.
 *
 *   Authorization: Bearer <LOVABLE_API_KEY>        ← chave do projeto no Lovable
 *   X-Connection-Api-Key: <GOOGLE_SHEETS_API_KEY>  ← chave da CONEXÃO com o Google
 *
 * POR QUE ISTO EXISTE, e o caso que decidiu: até 29/08/2026 metade das syncs
 * lia planilha pelo `docs.google.com/.../export`, que é o caminho ANÔNIMO — só
 * funciona enquanto "qualquer pessoa com o link" estiver ligado. Nesse dia
 * alguém tirou o link da planilha de churn (com razão: ela tem nome e CNPJ de
 * cliente) e o `churn-sheet-sync` passou a devolver 401 todo dia, enquanto o
 * `estornos-sync` — que lê A MESMA planilha por aqui — seguiu verde.
 *
 * A diferença é essa: o link público depende de uma configuração que qualquer
 * pessoa desfaz sem saber o que quebra; o conector depende de a planilha estar
 * COMPARTILHADA COM A CONTA, que é como uma empresa já trata seus arquivos.
 *
 * ATENÇÃO: o conector de Sheets NÃO é o do Drive (`_shared/drive.ts`). São
 * conexões diferentes, com escopos e chaves diferentes — o de Sheets lê células
 * de planilha nativa e não entrega o binário de um arquivo; o do Drive faz o
 * contrário. Planilha nativa vem por aqui; `.xlsx` depositado no Drive, por lá.
 * ------------------------------------------------------------------------- */

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

/** Teto de linhas pedido em cada faixa. O Sheets não devolve linha vazia do fim,
 *  então pedir alto não custa banda — custa só não ter que mexer aqui quando a
 *  base crescer. */
export const LINHAS_PADRAO = 20_000;

export class ErroSheets extends Error {
  constructor(readonly status: number, readonly corpo: string, msg: string) {
    super(msg);
  }
}

export const sheetsConfigurado = (): boolean =>
  !!Deno.env.get("LOVABLE_API_KEY") && !!Deno.env.get("GOOGLE_SHEETS_API_KEY");

/**
 * O nome da aba como o Sheets o espera dentro de um intervalo A1.
 * "2026 CHURNS" tem espaço; "REATIVAÇÕES" tem acento — os dois precisam de aspa
 * simples, e a aspa de dentro do nome (rara, mas existe) dobra.
 */
export const refAba = (nome: string): string =>
  /^[A-Za-z0-9_]+$/.test(nome) ? nome : `'${String(nome).replace(/'/g, "''")}'`;

async function gw(caminho: string, tentativas = 3): Promise<any> {
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  const sheets = Deno.env.get("GOOGLE_SHEETS_API_KEY");
  if (!lovable || !sheets) {
    throw new Error(
      "LOVABLE_API_KEY / GOOGLE_SHEETS_API_KEY ausentes nos secrets — sem elas não há como " +
      "ler planilha pela conta conectada.",
    );
  }

  let ultimo: ErroSheets | null = null;
  for (let tentativa = 0; tentativa <= tentativas; tentativa++) {
    const res = await fetch(`${GATEWAY}${caminho}`, {
      headers: {
        Authorization: `Bearer ${lovable}`,
        "X-Connection-Api-Key": sheets,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(45_000),
    });

    const texto = await res.text();
    let dados: unknown = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    if (res.ok) return dados;

    const corpo = (typeof dados === "string" ? dados : JSON.stringify(dados) ?? "").slice(0, 300);
    ultimo = new ErroSheets(res.status, corpo, mensagemDeErro(res.status, corpo));

    if ((res.status === 429 || res.status >= 500) && tentativa < tentativas) {
      /* 429 AQUI É COTA POR MINUTO, e não excesso momentâneo: o projeto Google do
         conector é compartilhado e o limite de "Read requests per minute" se
         renova na virada do minuto. Esperar 600ms e tentar de novo só queima a
         tentativa seguinte — daí a espera em segundos para esse caso. */
      const espera = res.status === 429
        ? Math.min(45_000, 6_000 * 2 ** tentativa)
        : Math.min(8_000, 600 * 2 ** tentativa);
      await new Promise((r) => setTimeout(r, espera + Math.random() * 400));
      continue;
    }
    throw ultimo;
  }
  throw ultimo;
}

/** A frase que a pessoa lê. 403/404 aqui é acesso, não rota — e o conserto é
 *  compartilhar a planilha, não trocar chave. */
function mensagemDeErro(status: number, corpo: string): string {
  if (status === 403 || status === 404) {
    return `Sheets [${status}]: a conta Google conectada ao Hub não enxerga esta planilha. ` +
      "Compartilhe o arquivo com ela (a mesma conta que já lê as outras planilhas) " +
      `e recheque em Configurações › Integrações. ${corpo}`.trim();
  }
  if (status === 401) {
    return `Sheets [401]: a conexão do Google Sheets no Lovable expirou ou foi revogada. ${corpo}`.trim();
  }
  /* 429 não é defeito nosso: é a cota por minuto do projeto Google do conector,
     que é compartilhado. Passa sozinho — e a frase precisa dizer isso, senão
     alguém vai procurar o que consertar num problema que já se consertou. */
  if (status === 429) return "Sheets [429]: cota por minuto do Google estourada — é passageiro, tente de novo.";
  return `Sheets [${status}]: ${corpo || "sem corpo"}`;
}

/** Os títulos das abas, na ordem da planilha. Requisição barata: só metadado.
 *  `tentativas: 0` para quem tem pressa — a tela de Integrações prefere dizer
 *  "não deu para checar" a segurar a página esperando a cota virar o minuto. */
export async function titulosDasAbas(id: string, opts: { tentativas?: number } = {}): Promise<string[]> {
  const dados = await gw(`/spreadsheets/${id}?fields=sheets.properties.title`, opts.tentativas ?? 3);
  return ((dados?.sheets ?? []) as { properties?: { title?: string } }[])
    .map((s) => String(s?.properties?.title ?? ""))
    .filter(Boolean);
}

/** O intervalo vai no CAMINHO da URL, então espaço e acento precisam de escape —
 *  mas `:` e `!` são a sintaxe A1 e ficam literais (o `encodeURIComponent` troca
 *  os dois-pontos por %3A, e nem todo proxy desfaz isso). */
const naUrl = (a1: string) => encodeURIComponent(a1).replace(/%3A/gi, ":");

/**
 * As células de um intervalo A1 (`'2026 CHURNS'!A1:L20000`).
 *
 * `UNFORMATTED_VALUE` é o padrão de propósito: devolve NÚMERO onde a célula é
 * número, que é o mesmo que o `raw: true` do SheetJS entregava quando as syncs
 * liam .xlsx. Com o valor formatado viria "R$ 1.080.613,29" e cada consumidor
 * teria que desfazer a formatação em pt-BR.
 *
 * `formatado: true` para quem já vive do texto da célula — o `estornos-sync` lê
 * data como "26/02/2026", e sem formatação ela chegaria como o número de série
 * do Sheets (46079), que o parser dele não reconhece.
 *
 * As linhas vêm RAGGED: o Sheets corta as células vazias do fim, então uma linha
 * pode ter 3 posições e outra 12. Quem lê usa `r?.[col]` e trata ausência como
 * vazio (é o que `num`/`chave` já fazem).
 */
export async function lerIntervalo(
  id: string, a1: string, opts: { formatado?: boolean } = {},
): Promise<any[][]> {
  const render = opts.formatado ? "FORMATTED_VALUE" : "UNFORMATTED_VALUE";
  const dados = await gw(`/spreadsheets/${id}/values/${naUrl(a1)}?valueRenderOption=${render}`);
  return (dados?.values ?? []) as any[][];
}

/**
 * Vários intervalos numa REQUISIÇÃO SÓ (`values:batchGet`).
 *
 * POR QUE NÃO É `Promise.all` de leituras: a cota que importa não é a nossa, é a
 * do projeto Google do conector — "Read requests per minute", compartilhada.
 * Cinco leituras em paralelo derrubaram a primeira rodada com 429 (medido em
 * 30/08/2026); em batch, as mesmas cinco abas custam UMA requisição.
 *
 * Se o gateway não conhecer a rota (o `:batchGet` tem dois-pontos no caminho, e
 * nem todo proxy passa isso adiante), cai para leitura UMA A UMA — em série, de
 * propósito: o ponto é não fazer rajada.
 */
export async function lerIntervalos(
  id: string, a1s: string[], opts: { formatado?: boolean } = {},
): Promise<any[][][]> {
  if (a1s.length <= 1) return a1s.length ? [await lerIntervalo(id, a1s[0], opts)] : [];

  const render = opts.formatado ? "FORMATTED_VALUE" : "UNFORMATTED_VALUE";
  const query = [
    ...a1s.map((a1) => `ranges=${encodeURIComponent(a1)}`),
    `valueRenderOption=${render}`,
  ].join("&");

  try {
    const dados = await gw(`/spreadsheets/${id}/values:batchGet?${query}`);
    const faixas = dados?.valueRanges;
    /* Confere o TAMANHO: o batch devolve as faixas na ordem pedida, e quem chama
       desestrutura por posição. Vir menos faixas que intervalos silenciaria uma
       aba inteira como se estivesse vazia. */
    if (Array.isArray(faixas) && faixas.length === a1s.length) {
      return faixas.map((f: { values?: any[][] }) => (f?.values ?? []) as any[][]);
    }
  } catch (e) {
    // 400/404 = rota não entendida. Acesso e cota (401/403/429) sobem.
    if (!(e instanceof ErroSheets && (e.status === 400 || e.status === 404))) throw e;
  }

  const out: any[][][] = [];
  for (const a1 of a1s) out.push(await lerIntervalo(id, a1, opts));
  return out;
}

/** Aba inteira até a coluna/linha pedidas — o atalho de quem só quer "a aba". */
export const faixaDaAba = (nome: string, ultimaColuna = "AZ", linhas = LINHAS_PADRAO): string =>
  `${refAba(nome)}!A1:${ultimaColuna}${linhas}`;

/* -------------------------------------------------------------------------
 * CSV
 * ---------------------------------------------------------------------- */

/** Intervalo SEM nome de aba: o Sheets entende como a primeira aba — que é
 *  exatamente o que o `export?format=csv` devolvia. */
const PRIMEIRA_ABA_INTEIRA = `A1:CZ${50_000}`;

const campoCsv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/**
 * A planilha como CSV — para quem já tem parser de CSV testado.
 *
 * POR QUE DEVOLVER TEXTO em vez de linhas: os parsers das planilhas de
 * formulário (`_shared/planilhas-apelidos.ts`, `_shared/planilhas-notas.ts`)
 * recebem CSV, são puros e têm GÊMEO TESTADO no front (`src/lib/
 * planilhasApelidos.ts`). Trocar a assinatura deles para trocar de transporte
 * arrastaria os testes e o front junto, sem necessidade: o `parseCsv` de lá lê
 * aspas, vírgula e quebra de linha dentro do campo, então serializar aqui com
 * TODO campo entre aspas volta byte a byte o que o parser esperava.
 *
 * `FORMATTED_VALUE` de propósito: o CSV do Google entregava o valor COMO SE VÊ
 * ("R$ 1.234,56", "26/02/2026"), e os parsers vivem disso.
 */
export async function lerComoCsv(id: string, opts: { faixa?: string } = {}): Promise<string> {
  const linhas = await lerIntervalo(id, opts.faixa ?? PRIMEIRA_ABA_INTEIRA, { formatado: true });
  return linhas.map((l) => l.map(campoCsv).join(",")).join("\n");
}
