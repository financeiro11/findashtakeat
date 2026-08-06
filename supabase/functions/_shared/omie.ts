// Cliente compartilhado da API do Omie.
// A API do Omie é JSON estilo RPC: todo request é um POST com
//   { call, app_key, app_secret, param: [ {...filtros...} ] }
// As credenciais (par app_key + app_secret) vêm dos secrets do Supabase
// (OMIE_APP_KEY / OMIE_APP_SECRET) e nunca são expostas ao frontend.

import { crypto as stdCrypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { zipSync } from "https://esm.sh/fflate@0.8.2";

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

/** Conta quantos anexos um título tem numa dada tabela (-1 se a tabela não for válida). */
async function contarAnexos(nId: number | string, cTabela: string): Promise<number> {
  try {
    const r = await omieCall<any>("geral/anexo", "ListarAnexo", { nId: Number(nId), cTabela, nPagina: 1, nRegPorPagina: 50 });
    const arr = r?.listaAnexos ?? r?.anexos ?? r?.arquivos ?? [];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return -1; // tabela inválida para este registro
  }
}

// Valores de cTabela válidos para IncluirAnexo (documentação oficial). Para um título vindo
// de financas/mf o nCodTitulo é uma conta a pagar (despesa do cartão) ou, raramente, a
// receber — por isso tentamos pagar primeiro e receber como fallback, sempre confirmando.
const TABELAS_ANEXO = ["conta-pagar", "conta-receber"];

/**
 * Anexa um arquivo a um título do Omie — e CONFIRMA que colou.
 *
 * As armadilhas deste endpoint, todas descobertas na marra e conferidas na doc oficial:
 *
 *  1. O ARQUIVO PRECISA SER ZIPADO. A doc diz: cArquivo = "conteúdo do arquivo compactado
 *     (zip) e convertido em base 64". Mandar o PDF/JPEG cru era aceito com HTTP 200 mas o
 *     anexo não colava. Zipamos o arquivo (o Omie descompacta e guarda o original).
 *
 *  2. `cCodIntAnexo` aceita NO MÁXIMO 20 caracteres (truncado aqui).
 *
 *  3. `cMd5` é o MD5 do arquivo enviado na tag cArquivo — ou seja, do ZIP. Como a doc é
 *     ambígua entre "bytes do zip" e "string base64 do zip", tentamos o dos bytes e, se o
 *     Omie reclamar do MD5, refazemos com o da base64.
 *
 *  4. Não confiar no 200: depois de incluir, contamos os anexos do título; se não aumentou,
 *     tentamos a próxima cTabela. Só retornamos quando o Omie CONFIRMA o anexo.
 *
 * `base64` é o conteúdo do arquivo ORIGINAL em base64 (nós zipamos aqui dentro).
 * Retorna a `cTabela` que funcionou.
 */
export async function incluirAnexo(opts: {
  nId: number | string;
  /** tabela preferida; se não colar, tentamos as demais candidatas */
  cTabela: string;
  nome: string;
  /** conteúdo do arquivo ORIGINAL em base64 (sem o prefixo data:) — zipado aqui dentro */
  base64: string;
  /** identificador interno; será truncado em 20 caracteres */
  codInt: string;
}): Promise<{ cTabela: string; variante: string; nIdAnexo: unknown }> {
  const baseCod = opts.codInt.slice(0, 14);   // deixa espaço p/ sufixo único por tentativa

  // O que aprendemos com os erros do próprio Omie:
  //  • cMd5 é o MD5 da STRING base64 (o "arquivo enviado na tag cArquivo"), NÃO dos bytes:
  //    os hashes dos bytes voltaram "MD5 inválido"; o da base64 passou na validação.
  //  • O sucesso é confirmado pela RESPOSTA (nIdAnexo), não por recontar via ListarAnexo —
  //    esse recontar sofria rate-limit e dava falso-negativo.
  // A doc pede zip; deixamos o arquivo cru como 2º recurso (contas antigas às vezes aceitam).
  const originalRaw = deBase64(opts.base64);
  const zip = zipSync({ [opts.nome]: originalRaw }, { level: 6 });
  const zipB64 = toBase64(zip);
  const rawB64 = toBase64(originalRaw);

  const variantes: { nome: string; cArquivo: string; cMd5: string }[] = [
    { nome: "zip", cArquivo: zipB64, cMd5: await md5Hex(zipB64) },
    { nome: "raw", cArquivo: rawB64, cMd5: await md5Hex(rawB64) },
  ];

  const tabelas = [opts.cTabela, ...TABELAS_ANEXO.filter((t) => t !== opts.cTabela)];
  const diagnostico: string[] = [];
  let sufixo = 0;

  for (const cTabela of tabelas) {
    const antes = await contarAnexos(opts.nId, cTabela);
    if (antes < 0) { diagnostico.push(`${cTabela}: tabela inválida para este título`); continue; }

    for (const v of variantes) {
      const cCodIntAnexo = `${baseCod}-${(sufixo++).toString(36)}`.slice(0, 20);
      let resp: any;
      try {
        resp = await omieCall<any>("geral/anexo", "IncluirAnexo", {
          cCodIntAnexo, cTabela, nId: Number(opts.nId),
          cNomeArquivo: opts.nome, cTipoArquivo: extDe(opts.nome),
          cArquivo: v.cArquivo, cMd5: v.cMd5,
        });
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e));
        // Erro de título/tabela (não de md5/arquivo) → essa tabela não serve; próxima tabela.
        if (!/md5|arquivo|conte|inv[aá]lid|tamanho|zip|base ?64/i.test(msg)) {
          diagnostico.push(`${cTabela}: ${msg.slice(0, 120)}`);
          break;
        }
        diagnostico.push(`${cTabela}/${v.nome}: ${msg.slice(0, 90)}`);
        continue;
      }

      // Caminho rápido: o Omie devolveu um id de anexo real (> 0).
      const nIdAnexo = Number(resp?.nIdAnexo ?? resp?.nCodAnexo ?? 0);
      if (nIdAnexo > 0) return { cTabela, variante: v.nome, nIdAnexo };

      // Alguns tenants respondem nIdAnexo:0 mesmo gravando. Confirma pela contagem, com uma
      // folga p/ propagar (e poucas chamadas, p/ não cair no rate-limit que já nos enganou).
      await new Promise((r) => setTimeout(r, 1500));
      const depois = await contarAnexos(opts.nId, cTabela);
      if (depois > antes) return { cTabela, variante: v.nome, nIdAnexo: nIdAnexo || true };

      diagnostico.push(`${cTabela}/${v.nome}: nIdAnexo=0 e sem gravar (${antes}->${depois}) resp=${JSON.stringify(resp).slice(0, 220)}`);
    }
  }

  throw new Error("Anexo não confirmado no Omie. " + diagnostico.join(" | "));
}

/* ============================================================
 *  Categoria de um título (contas a pagar / a receber)
 * ============================================================ */

// `cGrupo` do movimento diz em qual cadastro o título mora. Só estes dois são
// títulos financeiros de verdade; PREVISAO_ORDEM_SERVICO e PREVISAO_CONTRATO são
// projeções de OS/contrato (a categoria vem do documento de origem) e
// CONTA_CORRENTE_* é a perna bancária, que não tem classificação própria.
const CADASTRO: Record<string, { path: string; consultar: string; alterar: string; rotulo: string }> = {
  CONTA_A_PAGAR:   { path: "financas/contapagar",   consultar: "ConsultarContaPagar",   alterar: "AlterarContaPagar",   rotulo: "conta a pagar" },
  CONTA_A_RECEBER: { path: "financas/contareceber", consultar: "ConsultarContaReceber", alterar: "AlterarContaReceber", rotulo: "conta a receber" },
};

export const grupoAlteravel = (grupo: string): boolean => grupo in CADASTRO;

/** Cadastro completo do título, como o Omie o tem agora. */
export async function consultarTitulo(grupo: string, codTitulo: number | string): Promise<any> {
  const c = CADASTRO[grupo];
  if (!c) throw new Error(`Grupo ${grupo} não é um título financeiro alterável.`);
  return await omieCall<any>(c.path, c.consultar, { codigo_lancamento_omie: Number(codTitulo) });
}

/** Rateio por categoria do título (vazio quando é categoria única). */
const rateioDe = (cadastro: any): any[] => {
  const arr = cadastro?.categorias ?? cadastro?.lista_categorias ?? [];
  return Array.isArray(arr) ? arr.filter((c) => c && (c.codigo_categoria ?? c.cCodCateg)) : [];
};

const categoriaDe = (cadastro: any): string =>
  String(cadastro?.codigo_categoria ?? cadastro?.cCodCateg ?? "");

/** "Omie AlterarContaPagar [500]: ERROR: <o que interessa>" → só o que interessa. */
const mensagemDoOmie = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e))
    .replace(/^Omie \w+ \[\d+\]:\s*/i, "")
    .replace(/^ERROR:\s*/i, "")
    .trim();

/**
 * Troca a categoria de um título no Omie.
 *
 * O QUE FOI APRENDIDO CONTRA A API DE VERDADE (04/08/2026, títulos reais):
 *
 *  1. RATEIO. O Omie SEMPRE devolve `categorias` — em título simples vem com um
 *     item de 100%. Um item é o caso normal e é reescrito junto com a chave;
 *     mais de um é rateio de verdade, e mexer só em `codigo_categoria` deixaria
 *     a soma na classificação antiga. Aí a função recusa e manda ajustar no
 *     Omie, onde dá para redistribuir os valores.
 *
 *  2. PAYLOAD COMPLETO, SEMPRE. Mandar só a chave + `codigo_categoria` é
 *     recusado com "O preenchimento da tag [valor_documento] é obrigatório para
 *     alterar a categoria!". Então os campos obrigatórios do cadastro vão junto,
 *     copiados da consulta — mesmos valores, só a categoria muda. (Tentar o
 *     mínimo antes só gastava uma chamada e um erro garantido.)
 *
 *  3. NÃO RELER LOGO DEPOIS. O Omie protege contra "consumo redundante" (a mesma
 *     chamada com os mesmos parâmetros dentro de ~21s é recusada) e serve a
 *     leitura de um instantâneo velho por perto de um minuto depois da escrita.
 *     Medido: uma troca gravada às 17:55 ainda era lida como a categoria antiga
 *     na consulta seguinte; a alteração estava lá. Conferir relendo, portanto,
 *     REPROVA alteração que deu certo. Quem confirma é a resposta da própria
 *     alteração: recusa de verdade (período contábil fechado, tag faltando,
 *     categoria inválida) vem como erro, não como silêncio.
 *
 *  4. PERÍODO CONTÁBIL FECHADO. Mês fechado no Omie recusa a alteração com uma
 *     mensagem explicando quem fechou e quando. Ela sobe limpa para a tela: é o
 *     ERP dizendo que a correção tem que passar por quem controla o fechamento.
 */
export async function trocarCategoriaTitulo(opts: {
  grupo: string;
  codTitulo: number | string;
  codigoCategoria: string;
}): Promise<{ de: string; para: string; jaEstava: boolean; confirmacao: string }> {
  const c = CADASTRO[opts.grupo];
  if (!c) throw new Error(`Grupo ${opts.grupo} não é um título financeiro alterável.`);

  const atual = await consultarTitulo(opts.grupo, opts.codTitulo);
  const de = categoriaDe(atual);
  const rateio = rateioDe(atual);

  if (rateio.length > 1) {
    throw new Error(
      `Este título está rateado entre ${rateio.length} categorias no Omie. ` +
      "Trocar por aqui deixaria o rateio incoerente — ajuste direto no Omie.",
    );
  }
  if (de && de === opts.codigoCategoria) {
    return { de, para: opts.codigoCategoria, jaEstava: true, confirmacao: "já estava nesta categoria" };
  }

  const param: Record<string, unknown> = {
    codigo_lancamento_omie: Number(opts.codTitulo),
    codigo_categoria: opts.codigoCategoria,
    // Obrigatórios do cadastro, repetidos com o mesmo valor (ver nota 2).
    codigo_cliente_fornecedor: atual?.codigo_cliente_fornecedor,
    data_vencimento: atual?.data_vencimento,
    data_previsao: atual?.data_previsao,
    valor_documento: atual?.valor_documento,
  };
  if (rateio.length === 1) param.categorias = [{ ...rateio[0], codigo_categoria: opts.codigoCategoria }];

  let resposta: any;
  try {
    resposta = await omieCall<any>(c.path, c.alterar, param);
  } catch (e) {
    throw new Error(`O Omie recusou a alteração: ${mensagemDoOmie(e)}`);
  }

  const aceite = String(resposta?.descricao ?? resposta?.cDescricao ?? "");
  const confirmou = Number(resposta?.codigo_lancamento_omie ?? 0) > 0 || /alterad|sucesso/i.test(aceite);
  if (!confirmou) {
    throw new Error(
      "O Omie respondeu sem confirmar a alteração: " + JSON.stringify(resposta ?? null).slice(0, 240),
    );
  }

  return {
    de,
    para: opts.codigoCategoria,
    jaEstava: false,
    confirmacao: aceite || `lançamento ${resposta?.codigo_lancamento_omie}`,
  };
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
