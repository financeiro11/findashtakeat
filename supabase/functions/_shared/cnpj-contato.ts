// O CONTATO DO CNPJ — o e-mail e o telefone que a BrasilAPI não traz.
//
// O PROBLEMA, MEDIDO EM 11/09/2026. Dos 616 cadastros do Omie que não emitem
// NFS-e, **354 (57%) estão travados só pelo e-mail** — endereço completo, número
// no lugar, CEP válido, e o Omie recusando o faturamento com "falta preencher o
// E-mail". Não é um problema de endereço: é o campo mais fácil de achar na
// internet parando mais da metade da fila, e chegando a uma pessoa como
// pendência para resolver na mão, um a um.
//
// E O HUB JÁ CONSULTAVA A RECEITA. `omie-clientes-criar` chama a BrasilAPI
// `/cnpj` para todo cliente PJ e monta o endereço a partir dela. O que se
// descobriu ao medir é que **o `email` dessa resposta vem `null`** — 14 de 14 na
// amostra dos travados. O telefone vem (13 de 14) e era jogado fora junto. Ou
// seja: a pergunta certa estava sendo feita à fonte errada.
//
// AS DUAS FONTES DAQUI TÊM O DADO, e é o MESMO cadastro federal, só que exposto
// por quem publica o campo `correio_eletronico` da base da Receita:
//
//   1. open.cnpja.com — JSON estruturado (`emails[]`, `phones[]`), 5 consultas
//      por minuto no plano aberto. Amostra: 3 de 3 com e-mail.
//   2. receitaws.com.br — o mesmo dado, 3 por minuto. Amostra: 6 de 6. É o plano
//      B porque é mais lento, não porque é pior.
//
// (cnpj.biz, que é o que uma pessoa abriria, também tem — mas publica o e-mail
// CIFRADO no HTML (`data-email-ct`), decifrado por JavaScript no navegador. Uma
// raspagem teria de renderizar a página e ainda custaria crédito de Firecrawl,
// para chegar ao mesmo campo que estas duas entregam de graça em JSON.)
//
// O LIMITE DE TAXA É O PROJETO DESTE MÓDULO, não um detalhe. 5 por minuto num
// worker que vive 150s significa ~8 consultas por invocação, e é isso que dita o
// resto: cache antes de tudo, espaçamento no nível do módulo (o isolate é o
// mesmo para a leva inteira), prazo passado por quem chama, e **cache do
// negativo também** — CNPJ cuja consulta respondeu "não tem e-mail" não pode ser
// perguntado de novo amanhã, ou a fila nunca sai dos primeiros.
//
// SÓ CNPJ. Pessoa física não passa por aqui: o dado de contato de alguém não é
// cadastro público de empresa, e a única razão de buscar isto é emitir a nota
// PARA aquela empresa.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface Contato {
  email: string;
  /** DDD + número, só dígitos. "" quando a fonte não trouxe. */
  telefone: string;
  fonte: string;
}

export interface BuscaContato {
  contato: Contato | null;
  /** Em português: o que se achou, ou por que não se foi atrás. */
  motivo: string;
  doCache: boolean;
  /**
   * NÃO SE CONSULTOU — faltou relógio, não faltou resposta.
   *
   * Existe porque quem chama precisa distinguir as duas derrotas, e elas não se
   * parecem em nada: "o cadastro federal não publica contato deste CNPJ" é uma
   * resposta, e encerra o assunto com uma pessoa; "a leva acabou antes da vez
   * dele" é uma pausa, e o certo é ele voltar na passada seguinte. Medido na
   * primeira rodada real (11/09/2026): 3 dos 10 clientes foram marcados como
   * caso humano por isto, e ficariam parados para sempre esperando alguém.
   */
  adiado: boolean;
}

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const limpo = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ");
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A mesma régua frouxa do resto do repo: pega erro de digitação sem brigar com
 *  endereço exótico. A Receita guarda coisas como "CONTABIL @ UOL.COM.BR". */
const EMAIL_OK = /^[^\s@;,]+@[^\s@;,.]+(\.[^\s@;,.]+)+$/;

/** Domínios que não são contato de ninguém — aparecem no cadastro federal como
 *  placeholder do contador e mandariam a nota para o vazio. */
const LIXO = /^(nao(tem|possui)?|sem|nada|xxx+|teste|email|naotenho)@|@(nao|sem|teste|xxx)/i;

function bomEmail(v: unknown): string {
  const e = limpo(v).toLowerCase();
  if (!e || e.length > 100) return "";
  if (!EMAIL_OK.test(e) || LIXO.test(e)) return "";
  return e;
}

/** "(61) 3326-8433 / (61) 3326-8434" → "6133268433". Vem assim da ReceitaWS, que
 *  concatena os telefones do cadastro num campo só. */
function primeiroTelefone(v: unknown): string {
  const bruto = String(v ?? "").split("/")[0];
  const d = soDigitos(bruto);
  return d.length === 10 || d.length === 11 ? d : "";
}

/* ------------------------------ o espaçamento ------------------------------ */
/**
 * Quando a próxima chamada externa pode sair.
 *
 * MÓDULO-NÍVEL DE PROPÓSITO: o limite é por IP, e todos os clientes de uma leva
 * rodam no MESMO isolate. Um espaçamento guardado por chamada protegeria cada
 * cliente de si mesmo e nenhum do vizinho — que é exatamente o erro que fez a
 * BrasilAPI recusar 10 de 22 num bloco (ver `cnpj-publico.ts`).
 */
let liberadoEm = 0;
/** 13s ≈ 4,6 por minuto — abaixo dos 5 do plano aberto, com folga para o relógio
 *  do outro lado não coincidir com o nosso. */
const INTERVALO_MS = 13_000;
/** O custo de UMA consulta: a espera da vez já foi contada à parte, então o que
 *  sobra é a requisição. A segunda fonte tem o próprio teste de prazo mais
 *  abaixo — reservar aqui o pior caso das duas fazia a leva parar de consultar
 *  com meio minuto ainda no relógio, e cada consulta a menos é um cliente a
 *  menos destravado por hora. */
const CUSTO_MAXIMO_MS = 18_000;

async function aguardarVez(): Promise<void> {
  const espera = liberadoEm - Date.now();
  if (espera > 0) await dorme(espera);
  liberadoEm = Date.now() + INTERVALO_MS;
}

async function buscaJSON(url: string, ms = 15_000): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* -------------------------------- as fontes -------------------------------- */

async function doCnpja(cnpj: string): Promise<Contato | null> {
  const d = await buscaJSON(`https://open.cnpja.com/office/${cnpj}`);
  if (!d) return null;
  const email = (Array.isArray(d.emails) ? d.emails : [])
    .map((e: any) => bomEmail(e?.address)).find(Boolean) ?? "";
  const tel = (Array.isArray(d.phones) ? d.phones : [])
    .map((p: any) => primeiroTelefone(`${p?.area ?? ""}${p?.number ?? ""}`)).find(Boolean) ?? "";
  if (!email && !tel) return null;
  return { email, telefone: tel, fonte: "cnpja" };
}

async function doReceitaWs(cnpj: string): Promise<Contato | null> {
  const d = await buscaJSON(`https://receitaws.com.br/v1/cnpj/${cnpj}`);
  // Ela responde 200 com `{status:"ERROR"}` para documento inválido ou limite
  // estourado — o `ok` do fetch não distingue isso.
  if (!d || String(d.status ?? "").toUpperCase() !== "OK") return null;
  const email = bomEmail(d.email);
  const tel = primeiroTelefone(d.telefone);
  if (!email && !tel) return null;
  return { email, telefone: tel, fonte: "receitaws" };
}

/* --------------------------------- cache ---------------------------------- */

/** Contato de empresa muda de ano em ano, não de semana em semana. */
const VALIDADE_DIAS = 120;
/** O "não achei" vale menos: a fonte pode ter engasgado, e o cadastro pode
 *  ganhar um e-mail. Mas tem de valer alguma coisa, senão a fila trava nos
 *  primeiros CNPJs para sempre — é para isso que o negativo é guardado. */
const VALIDADE_VAZIO_DIAS = 30;

/**
 * O contato de um CNPJ. Nunca estoura: devolve `null` com motivo em português.
 *
 * `ate` é o instante em que a leva de quem chama precisa estar de volta (o
 * worker morre aos 150s). Sem prazo para uma consulta inteira, devolve
 * imediatamente e o cliente fica para a próxima passada — perder um cliente é o
 * custo conhecido, perder a leva é o desconhecido.
 */
export async function contatoDoCnpj(
  supa: SupabaseClient,
  doc: string,
  opts: { ate?: number } = {},
): Promise<BuscaContato> {
  const cnpj = soDigitos(doc);
  if (cnpj.length !== 14) {
    return { contato: null, motivo: "não é um CNPJ — contato de pessoa física não se busca aqui", doCache: false, adiado: false };
  }

  const { data: guardado } = await supa
    .from("cnpj_contato_cache").select("email, telefone, fonte, lido_em").eq("doc", cnpj).maybeSingle();
  if (guardado?.lido_em) {
    const idade = (Date.now() - new Date(guardado.lido_em).getTime()) / 86_400_000;
    const validade = guardado.email ? VALIDADE_DIAS : VALIDADE_VAZIO_DIAS;
    if (idade < validade) {
      return guardado.email || guardado.telefone
        ? {
            contato: { email: String(guardado.email ?? ""), telefone: String(guardado.telefone ?? ""), fonte: String(guardado.fonte ?? "cache") },
            motivo: `do cache (${Math.round(idade)} dias)`, doCache: true, adiado: false,
          }
        : { contato: null, motivo: `o cadastro federal não publica contato deste CNPJ (consultado há ${Math.round(idade)} dias)`, doCache: true, adiado: false };
    }
  }

  const ate = opts.ate ?? Number.POSITIVE_INFINITY;
  const comecaEm = Math.max(0, liberadoEm - Date.now());
  if (Date.now() + comecaEm + CUSTO_MAXIMO_MS > ate) {
    return { contato: null, motivo: "sem prazo nesta leva para consultar; volta na próxima", doCache: false, adiado: true };
  }

  await aguardarVez();
  let achado = await doCnpja(cnpj);
  if (!achado?.email) {
    /* A segunda fonte só entra por causa do E-MAIL, que é o que trava a nota. Um
     * telefone sozinho não vale mais 21 segundos do relógio da leva. */
    if (Date.now() + INTERVALO_MS + 16_000 <= ate) {
      await aguardarVez();
      const alt = await doReceitaWs(cnpj);
      if (alt?.email) achado = { ...alt, telefone: alt.telefone || achado?.telefone || "" };
    }
  }

  /* GRAVA ATÉ O VAZIO. Sem isto, os CNPJs sem contato publicado voltam a ser
     consultados em toda passada e consomem o pouco que o limite de taxa deixa —
     a fila andaria para sempre nos mesmos primeiros. */
  await supa.from("cnpj_contato_cache").upsert({
    doc: cnpj,
    email: achado?.email || null,
    telefone: achado?.telefone || null,
    fonte: achado?.fonte ?? null,
    lido_em: new Date().toISOString(),
  }, { onConflict: "doc" }).then(() => {}, () => { /* cache que não grava só custa uma consulta a mais */ });

  if (!achado) return { contato: null, motivo: "nenhuma das duas fontes trouxe contato", doCache: false, adiado: false };
  return { contato: achado, motivo: `contato lido em ${achado.fonte}`, doCache: false, adiado: false };
}
