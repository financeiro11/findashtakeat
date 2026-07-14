// Cliente compartilhado da API do Omie.
// A API do Omie é JSON estilo RPC: todo request é um POST com
//   { call, app_key, app_secret, param: [ {...filtros...} ] }
// As credenciais (par app_key + app_secret) vêm dos secrets do Supabase
// (OMIE_APP_KEY / OMIE_APP_SECRET) e nunca são expostas ao frontend.

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
 *  • "Consumo redundante" (5020), HTTP 425, "processando", "bloqueada"
 *    → rate limit / concorrência: a mesma chamada já está rodando lá.
 *
 *  • "SOAP-ERROR: Broken response from Application Server (BG)"
 *    → o servidor DELES quebrou ao montar a resposta. Aparece sobretudo em respostas
 *      grandes (ListarMovimentos sem filtro, 500 registros por página). É intermitente:
 *      a mesma chamada costuma passar na tentativa seguinte, e com página menor passa
 *      quase sempre — por isso listarMovimentos reduz o lote quando esbarra nisso.
 */
const ehTransitorio = (msg: unknown): boolean =>
  /425|redundante|processando|5020|too many|bloqueada|soap-error|broken response|timeout|502|503|504/i
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

export interface OmieCategoria {
  codigo: string;
  descricao: string;
  codigo_dre?: string;
  descricao_dre?: string;
  natureza?: string;        // "R" (receita) | "D" (despesa)
  conta_inativa?: string;   // "S" | "N"
  totalizadora?: string;    // "S" | "N"
  nao_exibir?: string;
}

/** Lista TODAS as categorias (plano de contas) do Omie, paginando. */
export async function listarCategorias(): Promise<OmieCategoria[]> {
  const out: OmieCategoria[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const r = await omieCall<any>("geral/categorias", "ListarCategorias", {
      pagina,
      registros_por_pagina: 500,
    });
    for (const c of (r?.categoria_cadastro ?? [])) out.push(c);
    totalPaginas = Number(r?.total_de_paginas ?? 1);
    pagina++;
  } while (pagina <= totalPaginas);
  return out;
}

/**
 * Lista os movimentos financeiros (financas/mf/ListarMovimentos), paginando.
 * `filtros` é repassado direto ao Omie (ex.: intervalo de datas).
 * `limitePaginas` protege contra volumes gigantes durante testes.
 */
export async function listarMovimentos(
  filtros: Record<string, unknown> = {},
  limitePaginas = 200,
): Promise<any[]> {
  // Uma passada completa com um tamanho de página fixo.
  // Nota: `cExibirDadosCategoria` NÃO faz parte do request de financas/mf/ListarMovimentos
  // (Omie retorna erro "Tag [CEXIBIRDADOSCATEGORIA] não faz parte da estrutura ..."). Os
  // rateios por categoria já vêm no objeto `categorias` de cada movimento.
  const passada = async (nRegPorPagina: number): Promise<any[]> => {
    const out: any[] = [];
    let nPagina = 1;
    let totalPaginas = 1;
    do {
      const r = await omieCall<any>("financas/mf", "ListarMovimentos", {
        nPagina,
        nRegPorPagina,
        ...filtros,
      });
      for (const m of (r?.movimentos ?? [])) out.push(m);
      totalPaginas = Number(r?.nTotPaginas ?? 1);
      nPagina++;
    } while (nPagina <= totalPaginas && nPagina <= limitePaginas);
    return out;
  };

  // O "SOAP-ERROR: Broken response" do Omie é o servidor DELES engasgando ao montar a
  // resposta, e acontece sobretudo em páginas grandes. Se acontecer, recomeçamos a
  // listagem inteira com página menor — como é só leitura, repetir é seguro, e recomeçar
  // do zero evita a aritmética de "de qual registro eu parei", que erraria calado e
  // duplicaria ou perderia movimentos (corrompendo o casamento com o cartão).
  const tamanhos = [500, 100, 50];
  let ultimoErro: unknown = null;

  for (const n of tamanhos) {
    try {
      return await passada(n);
    } catch (e) {
      if (!ehRespostaQuebrada(e)) throw e;   // erro de verdade: não adianta insistir
      ultimoErro = e;
      console.warn(`Omie ListarMovimentos: resposta quebrada com ${n} registros/página. Refazendo com página menor.`);
    }
  }
  throw ultimoErro;
}
