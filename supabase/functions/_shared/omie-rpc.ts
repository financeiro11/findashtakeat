// A CONVERSA CRUA COM A API DO OMIE — só o que é leitura.
//
// Separado de `omie.ts` para que quem só LÊ o ERP não arraste o caminho de
// escrita junto: `omie.ts` importa pdf-lib e fflate por causa da conversão de
// imagem e do zip do anexo, e a varredura de anexos (que não escreve nada) não
// tem por que carregar isso no bundle nem no deploy.
//
// A API do Omie é JSON estilo RPC: todo request é um POST com
//   { call, app_key, app_secret, param: [ {...filtros...} ] }
// As credenciais (OMIE_APP_KEY / OMIE_APP_SECRET) vêm dos secrets do Supabase e
// nunca são expostas ao frontend.

const BASE = "https://app.omie.com.br/api/v1";

function creds() {
  const app_key = Deno.env.get("OMIE_APP_KEY");
  const app_secret = Deno.env.get("OMIE_APP_SECRET");
  if (!app_key || !app_secret) {
    throw new Error(
      "Credenciais do Omie ausentes. Configure OMIE_APP_KEY e OMIE_APP_SECRET nos secrets do Supabase (Edge Functions).",
    );
  }
  return { app_key, app_secret };
}

const TENTATIVAS = 5;

/**
 * Erros do Omie que valem uma nova tentativa — nenhum deles é culpa do request:
 *
 *  • "Consumo redundante" (5020), HTTP 425, "processando", "bloqueada",
 *    "Já existe uma requisição desse método sendo executada"
 *    → rate limit / concorrência: a mesma chamada já está rodando lá. O último é
 *      a trava POR MÉTODO — duas consultas de títulos DIFERENTES ao mesmo tempo
 *      esbarram nela do mesmo jeito (medido: 4 em voo, 3 recusadas). Esperar e
 *      repetir é o único caminho.
 *
 *  • "SOAP-ERROR: Broken response from Application Server (BG)"
 *    → o servidor DELES quebrou ao montar a resposta. Aparece sobretudo em respostas
 *      grandes (ListarMovimentos sem filtro, 500 registros por página). É intermitente:
 *      a mesma chamada costuma passar na tentativa seguinte, e com página menor passa
 *      quase sempre — por isso listarMovimentos reduz o lote quando esbarra nisso.
 */
const ehTransitorio = (msg: unknown): boolean =>
  /425|redundante|processando|5020|too many|bloqueada|soap-error|broken response|timeout|502|503|504|existe uma requisi|tentar novamente/i
    .test(String(msg));

/** Chamada quebrou porque a resposta era grande demais para o servidor do Omie montar? */
export const ehRespostaQuebrada = (e: unknown): boolean =>
  /soap-error|broken response/i.test(e instanceof Error ? e.message : String(e));

/**
 * Chamada genérica à API do Omie.
 * @param path  caminho do recurso, ex.: "geral/categorias" ou "financas/mf"
 * @param call  nome do método, ex.: "ListarCategorias"
 * @param param objeto de filtros (será embrulhado em `param: [ ... ]`)
 */
export async function omieCall<T = any>(
  path: string,
  call: string,
  param: Record<string, unknown> = {},
): Promise<T> {
  const { app_key, app_secret } = creds();
  const url = `${BASE}/${path}/`;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < TENTATIVAS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
    });
    const text = await res.text();
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    // Omie devolve erros de negócio com HTTP 500 + { faultstring, faultcode }
    const fault = data && typeof data === "object" ? data.faultstring : null;
    if (res.ok && !fault) return data as T;

    const msg = fault || (typeof data === "string" ? data : JSON.stringify(data));
    lastErr = new Error(`Omie ${call} [${res.status}]: ${msg}`);

    if (ehTransitorio(msg) && attempt < TENTATIVAS - 1) {
      // backoff exponencial: 1,2s · 2,4s · 4,8s · 9,6s
      await new Promise((r) => setTimeout(r, 1200 * 2 ** attempt));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ ler anexo */

export type AnexoDoOmie = {
  id: string | null;
  nome: string | null;
  tipo: string | null;
  tamanho: number | null;
};

export type LeituraDeAnexos = {
  /** true = o Omie respondeu. false = não deu para saber (ver `erro`). */
  ok: boolean;
  /** só vale quando `ok`. */
  anexos: AnexoDoOmie[];
  /** 'transitorio' (rate limit, servidor deles) | 'tabela' (não vale aqui) */
  falha?: "transitorio" | "tabela";
  erro?: string;
};

/** O nome do anexo, onde quer que o Omie o guarde nesta versão da API. */
const campoTexto = (a: any, ...chaves: string[]): string | null => {
  for (const k of chaves) {
    const v = a?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
};

/**
 * Os anexos de um título, com nome e tipo — não só a contagem.
 *
 * O NOME É O QUE SEPARA "tem arquivo" DE "tem a nota certa". Na varredura de
 * 25/08/2026 apareceu, num título real, um anexo chamado
 * `nf_undefined_correta.pdf`: contagem 1, cobertura "verde", e um arquivo que
 * ninguém sabe o que é. Contar sem ler o nome é medir o buraco errado.
 */
export async function listarAnexos(
  nId: number | string,
  cTabela = "conta-pagar",
): Promise<LeituraDeAnexos> {
  try {
    const r = await omieCall<any>("geral/anexo", "ListarAnexo", {
      nId: Number(nId), cTabela, nPagina: 1, nRegPorPagina: 50,
    });
    const arr = r?.listaAnexos ?? r?.anexos ?? r?.arquivos ?? [];
    const anexos: AnexoDoOmie[] = (Array.isArray(arr) ? arr : []).map((a: any) => ({
      id: campoTexto(a, "nIdAnexo", "nCodAnexo", "cCodIntAnexo", "id"),
      nome: campoTexto(a, "cNomeArquivo", "cNome", "nome", "cArquivo"),
      tipo: campoTexto(a, "cTipoArquivo", "cTipo", "tipo"),
      tamanho: Number(a?.nTamanho ?? a?.nTamanhoArquivo ?? 0) || null,
    }));
    return { ok: true, anexos };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return ehTransitorio(msg)
      ? { ok: false, anexos: [], falha: "transitorio", erro: msg }
      : { ok: false, anexos: [], falha: "tabela", erro: msg };
  }
}

/**
 * Conta quantos anexos um título tem numa dada tabela.
 *   >= 0  a contagem
 *    -1   a tabela não vale para este registro (resposta de negócio do Omie)
 *    -2   não deu para saber (rate limit / servidor deles) — NÃO é "tabela inválida"
 *
 * A distinção não é preciosismo: logo depois de um IncluirAnexo bem-sucedido, o Omie
 * recusa a leitura seguinte por "consumo redundante". Tratar isso como tabela inválida
 * fazia o anexo seguinte do MESMO título falhar com um diagnóstico mentiroso.
 */
export async function contarAnexos(nId: number | string, cTabela: string): Promise<number> {
  const r = await listarAnexos(nId, cTabela);
  if (r.ok) return r.anexos.length;
  return r.falha === "transitorio" ? -2 : -1;
}

