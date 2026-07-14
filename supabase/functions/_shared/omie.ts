// Cliente compartilhado da API do Omie.
// A API do Omie é JSON estilo RPC: todo request é um POST com
//   { call, app_key, app_secret, param: [ {...filtros...} ] }
// As credenciais (par app_key + app_secret) vêm dos secrets do Supabase
// (OMIE_APP_KEY / OMIE_APP_SECRET) e nunca são expostas ao frontend.

import { crypto as stdCrypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

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

/* ============================================================
 *  Anexos (geral/anexo/IncluirAnexo)
 * ============================================================ */

/** Uint8Array → base64, em blocos (String.fromCharCode(...bytes) estoura a pilha em PDFs grandes). */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 → bytes. */
export function deBase64(b64: string): Uint8Array {
  const limpo = b64.replace(/^data:[^;]+;base64,/, "");
  return Uint8Array.from(atob(limpo), (c) => c.charCodeAt(0));
}

/**
 * MD5 em hexadecimal.
 *
 * Usa o `crypto` do std do Deno, e não o global: o Web Crypto NÃO implementa MD5
 * (é considerado quebrado para uso criptográfico), e `crypto.subtle.digest("MD5", …)`
 * lançaria "Unrecognized algorithm name". Aqui o MD5 não é segurança — é o checksum
 * que o Omie exige para conferir a integridade do anexo.
 */
async function md5Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = await stdCrypto.subtle.digest("MD5", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const extDe = (nome: string) =>
  (nome.includes(".") ? nome.split(".").pop()! : "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";

/**
 * Anexa um arquivo a um título do Omie.
 *
 * Duas armadilhas deste endpoint, ambas descobertas na marra:
 *
 *  1. `cCodIntAnexo` aceita NO MÁXIMO 20 caracteres. Um id + Date.now() estoura fácil
 *     (o timestamp sozinho já são 13 dígitos) e o Omie recusa o anexo inteiro.
 *
 *  2. `cMd5` é OBRIGATÓRIO, e a documentação é ambígua sobre o que ele deve hashear:
 *     "MD5 do arquivo enviado na tag 'cArquivo'" pode ser a string base64 OU os bytes do
 *     arquivo. Em vez de apostar, tentamos a leitura literal (base64) e, se o Omie
 *     reclamar especificamente do MD5, refazemos com o hash dos bytes.
 */
export async function incluirAnexo(opts: {
  nId: number | string;
  cTabela: string;
  nome: string;
  /** conteúdo do arquivo em base64 (sem o prefixo data:) */
  base64: string;
  /** identificador interno; será truncado em 20 caracteres */
  codInt: string;
}): Promise<unknown> {
  const cCodIntAnexo = opts.codInt.slice(0, 20);

  const tentar = (cMd5: string) =>
    omieCall("geral/anexo", "IncluirAnexo", {
      cCodIntAnexo,
      cTabela: opts.cTabela,
      nId: Number(opts.nId),
      cNomeArquivo: opts.nome,
      cTipoArquivo: extDe(opts.nome),
      cArquivo: opts.base64,
      cMd5,
    });

  try {
    return await tentar(await md5Hex(opts.base64));      // leitura literal: MD5 do que vai na tag
  } catch (e) {
    if (!/md5/i.test(e instanceof Error ? e.message : String(e))) throw e;
    console.warn("Omie recusou o MD5 da base64; refazendo com o MD5 dos bytes do arquivo.");
    return await tentar(await md5Hex(deBase64(opts.base64)));
  }
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
