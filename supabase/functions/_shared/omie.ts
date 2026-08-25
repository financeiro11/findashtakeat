// Cliente compartilhado da API do Omie.
// A API do Omie é JSON estilo RPC: todo request é um POST com
//   { call, app_key, app_secret, param: [ {...filtros...} ] }
// As credenciais (par app_key + app_secret) vêm dos secrets do Supabase
// (OMIE_APP_KEY / OMIE_APP_SECRET) e nunca são expostas ao frontend.

import { crypto as stdCrypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { zipSync } from "https://esm.sh/fflate@0.8.2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { extDe, nomeSeguroParaOmie, planoDeAnexo, tipoRealDoArquivo } from "./anexo-tipo.ts";

export { nomeSeguroParaOmie, pareceNotaFiscal, tipoRealDoArquivo } from "./anexo-tipo.ts";

import { contarAnexos, ehRespostaQuebrada, omieCall } from "./omie-rpc.ts";

// Reexportado para não quebrar quem já importa daqui — a conversa crua mudou de
// arquivo, não de endereço.
export { contarAnexos, ehRespostaQuebrada, listarAnexos, omieCall } from "./omie-rpc.ts";
export type { AnexoDoOmie, LeituraDeAnexos } from "./omie-rpc.ts";

/* ============================================================
 *  Anexos (geral/anexo/IncluirAnexo) — o lado que ESCREVE
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

/* ============================================================
 *  Imagem vira PDF antes de subir
 * ============================================================
 * A REGRA de que arquivo é aceito, e o que fazer com cada um, mora em
 * `_shared/anexo-tipo.ts` — puro, sem dependência, coberto por teste. Aqui fica
 * só a EXECUÇÃO, que precisa do pdf-lib e por isso não dá para testar sem rede.
 *
 * Por que converter em vez de mandar a foto: o Omie aceita jpg e png, mas quem
 * abre a pasta depois é o contador, e ele espera PDF. Para JPEG a conversão é
 * LOSSLESS — o PDF suporta o fluxo JPEG nativo (DCTDecode), então `embedJpg`
 * copia os bytes originais e só embrulha; não há recompressão nem perda.
 */

/**
 * Uma imagem vira uma página PDF do tamanho dela.
 *
 * A página segue a proporção da foto em vez de forçar A4: comprovante de posto
 * fotografado em retrato virava uma faixa perdida no meio de uma folha A4, e
 * quem abre para conferir o valor tem de dar zoom. Teto de 2000pt por lado para
 * o arquivo não ficar absurdo com foto de 12 megapixels.
 */
async function imagemParaPdf(bytes: Uint8Array, tipo: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const img = tipo === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

  const MAX = 2000;
  const escala = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * escala));
  const h = Math.max(1, Math.round(img.height * escala));

  const pagina = pdf.addPage([w, h]);
  pagina.drawImage(img, { x: 0, y: 0, width: w, height: h });
  pdf.setProducer("Central do Financeiro - Takeat");
  pdf.setSubject("Comprovante fotografado, convertido para PDF para anexo no Omie");
  return await pdf.save();
}

export type ArquivoNormalizado = {
  bytes: Uint8Array;
  /** nome final, com a extensão que corresponde ao CONTEÚDO */
  nome: string;
  tipo: string;
  /** o que foi feito, para o rastro */
  conversao: "nada" | "extensao" | "imagem_para_pdf";
};

/**
 * Deixa o arquivo do jeito que o Omie aceita — e do jeito que abre depois.
 *
 * @param converterImagem  imagem vira PDF (padrão). Desligar só faz sentido em
 *                         diagnóstico.
 */
export async function normalizarAnexo(
  bytes: Uint8Array,
  nome: string,
  opts: { converterImagem?: boolean } = {},
): Promise<ArquivoNormalizado> {
  const plano = planoDeAnexo(tipoRealDoArquivo(bytes), nome, opts);
  const semExt = String(nome ?? "comprovante").replace(/\.[^.]+$/, "") || "comprovante";

  if (plano.acao === "recusar") throw new Error(plano.motivo);

  if (plano.acao === "converter_para_pdf") {
    try {
      return {
        bytes: await imagemParaPdf(bytes, plano.tipoOrigem),
        nome: `${semExt}.pdf`,
        tipo: "pdf",
        conversao: "imagem_para_pdf",
      };
    } catch (e) {
      /* A conversão falhou (imagem corrompida, JPEG em CMYK que o pdf-lib recusa).
       *
       * A versão anterior caía de volta para "manda a imagem mesmo". Isso PARECIA
       * generoso e era inútil: esta conta do Omie recusa jpg com "Tipo de Anexo
       * não cadastrado para o Código [jpg]" (medido em 25/08/2026, nas duas notas
       * de agosto que estavam paradas). O fallback trocava um erro claro por um
       * erro obscuro três passos adiante. */
      throw new Error(
        `A imagem não pôde ser convertida para PDF (${e instanceof Error ? e.message : e}) e o Omie ` +
        "não aceita imagem como anexo. Reenvie o comprovante em PDF.",
      );
    }
  }

  return {
    bytes,
    nome: `${semExt}.${plano.tipoFinal}`,
    tipo: plano.tipoFinal,
    conversao: plano.corrigiuExtensao ? "extensao" : "nada",
  };
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
  /** imagem vira PDF antes de subir (padrão true). Ver `normalizarAnexo`. */
  converterImagem?: boolean;
}): Promise<{ cTabela: string; variante: string; nIdAnexo: unknown; nome: string; conversao: string }> {
  const baseCod = opts.codInt.slice(0, 14);   // deixa espaço p/ sufixo único por tentativa

  // O que aprendemos com os erros do próprio Omie:
  //  • cMd5 é o MD5 da STRING base64 (o "arquivo enviado na tag cArquivo"), NÃO dos bytes:
  //    os hashes dos bytes voltaram "MD5 inválido"; o da base64 passou na validação.
  //  • O sucesso é confirmado pela RESPOSTA (nIdAnexo), não por recontar via ListarAnexo —
  //    esse recontar sofria rate-limit e dava falso-negativo.
  // A doc pede zip; deixamos o arquivo cru como 2º recurso (contas antigas às vezes aceitam).
  //
  // A NORMALIZAÇÃO VEM ANTES DE TUDO: é ela que garante que o que sobe abre do
  // outro lado. Ver `normalizarAnexo` — foto vira PDF, extensão mentirosa é
  // corrigida pelos bytes, e formato que o Omie não aceita é recusado AQUI, com
  // instrução, em vez de virar um .pdf que não é PDF lá dentro.
  const norm = await normalizarAnexo(deBase64(opts.base64), opts.nome, {
    converterImagem: opts.converterImagem,
  });
  const nome = nomeSeguroParaOmie(norm.nome);
  const originalRaw = norm.bytes;
  const zip = zipSync({ [nome]: originalRaw }, { level: 6 });
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
    const contagem = await contarAnexos(opts.nId, cTabela);
    if (contagem === -1) { diagnostico.push(`${cTabela}: tabela inválida para este título`); continue; }
    // -2 = o Omie não deixou ler agora. Seguimos assim mesmo: quem confirma o envio é o
    // nIdAnexo da resposta; a contagem é só o plano B.
    const antes = contagem === -2 ? -2 : contagem;

    for (const v of variantes) {
      const cCodIntAnexo = `${baseCod}-${(sufixo++).toString(36)}`.slice(0, 20);
      let resp: any;
      try {
        resp = await omieCall<any>("geral/anexo", "IncluirAnexo", {
          cCodIntAnexo, cTabela, nId: Number(opts.nId),
          cNomeArquivo: nome, cTipoArquivo: extDe(nome),
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
      if (nIdAnexo > 0) return { cTabela, variante: v.nome, nIdAnexo, nome, conversao: norm.conversao };

      // Alguns tenants respondem nIdAnexo:0 mesmo gravando. Confirma pela contagem, com uma
      // folga p/ propagar (e poucas chamadas, p/ não cair no rate-limit que já nos enganou).
      // Sem a contagem de antes (-2), não há o que comparar: não inventamos confirmação.
      if (antes < 0) { diagnostico.push(`${cTabela}/${v.nome}: nIdAnexo=0 e sem leitura para confirmar`); continue; }
      await new Promise((r) => setTimeout(r, 1500));
      const depois = await contarAnexos(opts.nId, cTabela);
      if (depois > antes) return { cTabela, variante: v.nome, nIdAnexo: nIdAnexo || true, nome, conversao: norm.conversao };

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

/* ============================================================
 *  Criar e excluir conta a pagar
 * ============================================================
 * A ÚNICA porta de escrita de título no Omie deste repo. Está aqui, e não solta
 * numa Edge Function, porque `src/lib/cartao/envio.test.ts` vigia quem pode
 * chamar `IncluirContaPagar`: concentrar num lugar é o que torna a vigilância
 * possível.
 *
 * `codigo_lancamento_integracao` é obrigatório e é a trava contra duplicidade —
 * o Omie recusa uma integração repetida. Essa recusa NÃO é erro: significa "já
 * está lá", e é assim que `incluirContaPagar` a devolve.
 */

export type InclusaoContaPagar = {
  codTitulo: string;
  integracao: string;
  /** true quando o Omie recusou por já existir esta integração. */
  jaExistia: boolean;
};

/** A recusa por integração repetida, que é resposta e não falha. */
const ehIntegracaoRepetida = (msg: string): boolean =>
  /integra(ç|c)(ã|a)o.*(j(á|a) (existe|cadastrad)|duplicad)|c(ó|o)digo de integra|j(á|a) (existe|foi) (um |uma )?(lan(ç|c)amento|t(í|i)tulo)/i
    .test(msg);

/**
 * Cria uma conta a pagar. `param` sai pronto de `montarTitulo`
 * (`_shared/cartao-envio.ts`) — esta função não decide nada de contabilidade,
 * só fala com a API.
 */
export async function incluirContaPagar(
  param: Record<string, unknown>,
): Promise<InclusaoContaPagar> {
  const integracao = String(param.codigo_lancamento_integracao ?? "");
  try {
    const r = await omieCall<any>("financas/contapagar", "IncluirContaPagar", param);
    const cod = String(r?.codigo_lancamento_omie ?? "");
    if (!cod || cod === "0") {
      throw new Error(
        "O Omie respondeu sem devolver o código do título: " + JSON.stringify(r ?? null).slice(0, 240),
      );
    }
    return { codTitulo: cod, integracao, jaExistia: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!ehIntegracaoRepetida(msg)) throw e;

    // Já existe: recupera o código do título que está lá, para o Hub registrar o
    // vínculo em vez de deixar um envio "perdido" que ninguém consegue limpar.
    let cod = "";
    try {
      const atual = await omieCall<any>("financas/contapagar", "ConsultarContaPagar", {
        codigo_lancamento_integracao: integracao,
      });
      cod = String(atual?.codigo_lancamento_omie ?? "");
    } catch { /* nada: a confirmação abaixo trata */ }

    /*
     * O CÓDIGO DEVOLVIDO PODE SER UM FANTASMA — medido em 24/08/2026.
     *
     * Depois de um `ExcluirContaPagar`, o Omie continua recusando aquela
     * integração como repetida por perto de um minuto E devolve, na consulta
     * por integração, o código do título que ele acabou de apagar. Consultar
     * esse código responde "Lançamento não cadastrado". É a mesma janela de
     * leitura velha documentada em `trocarCategoriaTitulo` (nota 3).
     *
     * Sem esta conferência, o Hub gravaria a linha como "enviado" apontando
     * para um título que não existe: o pior desfecho possível, porque some da
     * fila de reenvio E não aparece no ERP. Melhor devolver erro — a linha vai
     * para `status='erro'`, que é justamente o que a próxima rodada retenta.
     */
    if (cod) {
      try {
        await omieCall<any>("financas/contapagar", "ConsultarContaPagar", {
          codigo_lancamento_omie: Number(cod),
        });
        return { codTitulo: cod, integracao, jaExistia: true };
      } catch { /* cai no erro abaixo */ }
    }
    throw new Error(
      `O Omie recusou a integração ${integracao} como repetida, mas não confirmou o título ` +
      "correspondente. Costuma ser o índice dele ainda não refletindo uma exclusão recente — " +
      "tente de novo daqui a um minuto.",
    );
  }
}

/** Apaga uma conta a pagar. Usado só pela limpeza da fatura de teste. */
export async function excluirContaPagar(codTitulo: number | string): Promise<string> {
  const r = await omieCall<any>("financas/contapagar", "ExcluirContaPagar", {
    codigo_lancamento_omie: Number(codTitulo),
  });
  return String(r?.descricao ?? r?.cDescricao ?? "excluído");
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
