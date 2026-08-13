// Edge Function: comprovantes-drive-sync
//
// Lê as duas pastas de comprovantes do Drive e cola cada uma no lançamento que
// ela explica — para a linha "MERCADO LIVRE R$ 45,60" da DRE passar a dizer
// "pingadeira e tampa do purificador, da Pure Water".
//
// DUAS PASTAS, DOIS CAMINHOS:
//   • Mercado Livre — NF-e em PDF de TEXTO. `unpdf` extrai e `lerDanfes` lê.
//     Sem modelo: os rótulos do DANFE são fixos por lei, e valor e data são a
//     chave do casamento, onde um palpite cola o comprovante na linha errada.
//   • WhatsApp — foto e scan. Não há texto para ancorar, então aqui o OCR do
//     Gemini é inevitável. Mesmo caminho do `parse-balancete-pdf`.
//
// TRÊS TENTATIVAS DE CASAMENTO, cada uma nascida de um caso real:
//   1. valor da nota + data
//   2. SOMA das notas do arquivo — pedido com dois vendedores = dois DANFEs no
//      mesmo PDF e UMA cobrança (R$ 161,50 = 135,50 + 26,00)
//   3. valor / parcelas — o memo traz "01/06"; a nota tem o total, a fatura tem
//      a parcela
//
// AMBÍGUO NÃO CASA. Dois lançamentos com o mesmo valor na janela viram
// `candidatos` e ninguém é escolhido.
//
// Body: { action?: 'sync' | 'previa', pasta?: 'mercado_livre' | 'whatsapp',
//         releitura?: boolean }
// Cron: header `x-cron-token`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { requireUser } from "../_shared/auth.ts";
import { lerDanfes, descricaoDaNota, type Danfe } from "../_shared/nota-fiscal.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PASTAS: { pasta: "mercado_livre" | "whatsapp"; raiz: string }[] = [
  { pasta: "mercado_livre", raiz: "1hx5HAbBx9YFZ6lUGBUOcy60s0O62D7l3" },
  { pasta: "whatsapp", raiz: "12JpImM1UDV_ELNNUGrF_Ri2MG6ilvi8a" },
];

/* Janela do casamento. A compra do fim do mês cai na fatura seguinte, e a
   primeira parcela pode demorar ainda mais — os mesmos números do sync das
   planilhas, pela mesma razão. */
const DIAS_ANTES = 7;
const DIAS_DEPOIS = 45;
const TOLERANCIA = 0.02;
/** Teto por rodada: cada foto é uma chamada de OCR, e o edge morre aos 150s. */
const TETO_OCR = 40;

type Arquivo = { id: string; name: string; mimeType: string; modifiedTime?: string };
type LinhaCartao = {
  data: string; valor: number; estabelecimento: string; descricao: string | null; parcela: string | null;
};

/* -------------------------------------------------------------------------
 * Drive
 * ---------------------------------------------------------------------- */

async function listar(pastaId: string, key: string): Promise<Arquivo[]> {
  const out: Arquivo[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL("https://www.googleapis.com/drive/v3/files");
    u.searchParams.set("q", `'${pastaId}' in parents and trashed = false`);
    u.searchParams.set("key", key);
    u.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime)");
    u.searchParams.set("pageSize", "200");
    if (pageToken) u.searchParams.set("pageToken", pageToken);

    const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`Drive list ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    out.push(...((j.files ?? []) as Arquivo[]));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

async function baixar(id: string, key: string): Promise<Uint8Array> {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${key}`,
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!r.ok) throw new Error(`Drive download ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/* -------------------------------------------------------------------------
 * Leitura do documento
 * ---------------------------------------------------------------------- */

type Lido = {
  lido_como: "danfe" | "ocr" | "nome_arquivo";
  emitente: string | null;
  cnpj_norm: string | null;
  data: string | null;
  /** o valor de cada nota do arquivo — mais de um quando o pedido teve 2 vendedores */
  valores: number[];
  descricao: string | null;
  itens: string[];
  notas: number;
};

const ESQUEMA_OCR = {
  type: "object",
  properties: {
    emitente: { type: "string", description: "Nome do estabelecimento que emitiu. Vazio se ilegível." },
    data: { type: "string", description: "Data do documento em AAAA-MM-DD. Vazio se ilegível." },
    valor: { type: "number", description: "VALOR TOTAL pago. 0 se ilegível." },
    descricao: { type: "string", description: "O que foi comprado, em até 90 caracteres." },
    legivel: { type: "boolean", description: "false quando o documento não dá para ler." },
  },
  required: ["emitente", "data", "valor", "descricao", "legivel"],
};

/**
 * OCR pelo Gemini — só onde não há texto para ancorar.
 *
 * `flash-lite` porque lê imagem muito mais rápido, e são ~107 fotos. O prompt
 * manda dizer "não deu" em vez de inventar: um valor chutado aqui cola o
 * comprovante no lançamento errado, que é pior do que comprovante nenhum.
 */
async function ocr(bytes: Uint8Array, mime: string, dica: string, aiKey: string): Promise<Lido | null> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${aiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: `Você lê comprovantes de compra brasileiros (nota fiscal, cupom, recibo, print de PIX).
Devolve o que ESTÁ ESCRITO. Se um campo não der para ler, devolva vazio ou 0 e marque legivel=false —
NUNCA estime. O valor e a data são usados para casar com o extrato: um número inventado gruda o
comprovante no lançamento errado, e isso é pior do que não ter comprovante.
Na descrição, diga o que foi comprado em poucas palavras, sem repetir o valor.`,
          }],
        },
        contents: [{
          role: "user",
          parts: [
            { text: `Leia este comprovante. Contexto do nome do arquivo: "${dica}".` },
            { inlineData: { mimeType: mime, data: base64(bytes) } },
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: ESQUEMA_OCR,
          temperature: 0,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!r.ok) return null;
  const j = await r.json();
  const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) return null;

  let d: Record<string, unknown>;
  try { d = JSON.parse(txt); } catch { return null; }
  const valor = Number(d.valor) || 0;
  const data = String(d.data ?? "").match(/^\d{4}-\d{2}-\d{2}$/) ? String(d.data) : null;

  return {
    lido_como: "ocr",
    emitente: String(d.emitente ?? "").trim() || null,
    cnpj_norm: null,
    data,
    valores: valor > 0 ? [Math.round(valor * 100) / 100] : [],
    descricao: String(d.descricao ?? "").trim() || null,
    itens: [],
    notas: 0,
  };
}

/**
 * O nome do arquivo costuma ser a melhor descrição que existe.
 *
 * "Valor da comida HH copa, 18 pessoas" e "Kelven Silva - Reparo de Notebooks"
 * foram escritos por quem estava lá; nenhum OCR chega perto. O que o nome NÃO
 * dá é valor e data, que é onde o OCR entra.
 */
function descricaoDoNome(nome: string): string | null {
  const s = nome.replace(/\.(pdf|jpe?g|png|heic)$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/^sem[\s_]?nome$/i.test(s)) return null;
  if (/^whatsapp (scan|image|ptt)/i.test(s)) return null;
  if (/^(img|image|photo|foto|doc|documento|scan)\s*\d*$/i.test(s)) return null;
  if (/^NF[\s_]?(compra[\s_]?)?\d{6,}$/i.test(s)) return null;   // "NF_2000017390774930"
  return s;
}

async function lerArquivo(
  a: Arquivo, bytes: Uint8Array, aiKey: string, podeOcr: boolean,
): Promise<{ lido: Lido | null; erro: string | null }> {
  const doNome = descricaoDoNome(a.name);

  if (a.mimeType === "application/pdf") {
    let texto = "";
    try {
      const pdf = await getDocumentProxy(bytes);
      texto = (await extractText(pdf, { mergePages: true })).text ?? "";
    } catch { /* PDF quebrado ou só imagem — cai no OCR */ }

    const danfes: Danfe[] = lerDanfes(texto);
    if (danfes.length) {
      const valores = danfes.map((d) => d.valor).filter((v): v is number => !!v);
      return {
        lido: {
          lido_como: "danfe",
          emitente: danfes.map((d) => d.emitente).join(" + "),
          cnpj_norm: danfes[0].cnpjEmitente,
          data: danfes.find((d) => d.data)?.data ?? null,
          valores,
          // A nota descreve melhor que o nome do arquivo aqui: "NF_2000017..."
          // não diz nada, e a DANFE lista o produto.
          descricao: danfes.map((d) => descricaoDaNota(d, 60)).join(" · ").slice(0, 180),
          itens: danfes.flatMap((d) => d.itens),
          notas: danfes.length,
        },
        erro: null,
      };
    }
    if (!podeOcr) return { lido: null, erro: "fila de OCR cheia nesta rodada" };
    const l = await ocr(bytes, "application/pdf", doNome ?? a.name, aiKey);
    return l ? { lido: { ...l, descricao: doNome ?? l.descricao }, erro: null }
             : { lido: null, erro: "OCR não leu o PDF" };
  }

  if (a.mimeType.startsWith("image/")) {
    if (!podeOcr) return { lido: null, erro: "fila de OCR cheia nesta rodada" };
    const l = await ocr(bytes, a.mimeType, doNome ?? a.name, aiKey);
    // O nome do arquivo ganha do OCR na descrição — foi uma pessoa que escreveu.
    return l ? { lido: { ...l, descricao: doNome ?? l.descricao }, erro: null }
             : { lido: null, erro: "OCR não leu a imagem" };
  }

  return { lido: null, erro: `tipo não tratado: ${a.mimeType}` };
}

/* -------------------------------------------------------------------------
 * Casamento
 * ---------------------------------------------------------------------- */

type Casamento = {
  casamento: "valor_data" | "soma_pedido" | "parcela";
  confianca: "alta" | "media";
  linha: LinhaCartao;
} | { candidatos: LinhaCartao[] };

const dias = (a: string, b: string) =>
  (new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000;

/** Quantas parcelas o memo declara: "MERCADOLIVRE*MERCADO  01/06  OSASCO" -> 6. */
function parcelasDoMemo(memo: string | null): number {
  const m = String(memo ?? "").match(/\b(\d{2})\/(\d{2})\b/);
  const n = m ? Number(m[2]) : 0;
  return n >= 2 && n <= 24 ? n : 1;
}

/**
 * Comprovante do Mercado Livre só casa com cobrança do Mercado Livre.
 *
 * Sem isto o casamento por valor+data virou um falso positivo feio: um PDF com
 * 16 notas de bebidas (Xarope Monin, Gin) grudou num lançamento do "99", o app
 * de corrida, porque o valor batia na janela. Coincidência de valor acontece o
 * tempo todo em 3.768 linhas de fatura.
 *
 * Cobre as grafias que o adquirente usa: "MERCADO LIVRE", "MERCADOLIVRE*…",
 * "MERCADO PAGO*MERCV", "MERC" e o prefixo "MP*" do Mercado Pago (que aparece
 * em "MP*ELETROHALENV" — vendedor diferente, mesma maquininha).
 */
const DO_MERCADO_LIVRE = /MERCAD|\bMERC\b|MP\*/i;

function casar(lido: Lido, cartao: LinhaCartao[], pasta: string): Casamento | null {
  if (!lido.data || !lido.valores.length) return null;
  const naJanela = cartao.filter((l) => {
    const d = dias(l.data, lido.data!);
    if (d < -DIAS_ANTES || d > DIAS_DEPOIS) return false;
    if (pasta === "mercado_livre") {
      return DO_MERCADO_LIVRE.test(`${l.estabelecimento ?? ""} ${l.descricao ?? ""}`);
    }
    return true;
  });
  if (!naJanela.length) return null;

  const bate = (alvo: number) =>
    naJanela.filter((l) => Math.abs(Math.abs(Number(l.valor)) - alvo) < TOLERANCIA);

  // 1. o valor de uma das notas, direto
  for (const v of lido.valores) {
    const achados = bate(v);
    if (achados.length === 1) return { casamento: "valor_data", confianca: "alta", linha: achados[0] };
    if (achados.length > 1) return { candidatos: achados };
  }

  // 2. a soma das notas do arquivo — um pedido, vários vendedores, uma cobrança
  if (lido.valores.length > 1) {
    const soma = Math.round(lido.valores.reduce((s, v) => s + v, 0) * 100) / 100;
    const achados = bate(soma);
    if (achados.length === 1) return { casamento: "soma_pedido", confianca: "alta", linha: achados[0] };
    if (achados.length > 1) return { candidatos: achados };
  }

  // 3. a parcela: a nota tem o total, a fatura tem o pedaço. Só onde o memo
  //    DECLARA parcelamento — dividir por um número inventado casa qualquer
  //    coisa com qualquer coisa.
  const total = Math.round(lido.valores.reduce((s, v) => s + v, 0) * 100) / 100;
  const porParcela = naJanela.filter((l) => {
    const n = parcelasDoMemo(l.descricao);
    if (n < 2) return false;
    return Math.abs(Math.abs(Number(l.valor)) - Math.round((total / n) * 100) / 100) < TOLERANCIA;
  });
  if (porParcela.length === 1) return { casamento: "parcela", confianca: "media", linha: porParcela[0] };
  if (porParcela.length > 1) return { candidatos: porParcela };

  return null;
}

/* -------------------------------------------------------------------------
 * Handler
 * ---------------------------------------------------------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "comprovantes-drive-sync").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const previa = body?.action === "previa";
    const soPasta = body?.pasta as string | undefined;
    const releitura = body?.releitura === true;

    /* A chave da Drive API pode vir de dois lugares, e a que vale é a que
       FUNCIONA — não a que tem precedência no papel.
       Aprendido na marra: a primeira versão preferia a env var e levou "API key
       not valid" enquanto a mesma chave respondia 200 do terminal. Existia uma
       env var antiga com valor morto, e o código nunca chegava na tabela.
       Agora as duas são testadas contra uma chamada de verdade, e a resposta diz
       qual entrou — para isso nunca mais virar adivinhação. */
    const candidatasChave: { fonte: string; valor: string }[] = [];
    const doEnv = Deno.env.get("GOOGLE_DRIVE_API_KEY") ?? "";
    if (doEnv) candidatasChave.push({ fonte: "env", valor: doEnv });
    const { data: segredo } = await supabase.from("internal_secrets")
      .select("valor").eq("nome", "GOOGLE_DRIVE_API_KEY").maybeSingle();
    if (segredo?.valor && segredo.valor !== doEnv) {
      candidatasChave.push({ fonte: "internal_secrets", valor: segredo.valor });
    }
    if (!candidatasChave.length) throw new Error("GOOGLE_DRIVE_API_KEY ausente (env e internal_secrets)");

    let driveKey = "";
    let chaveFonte = "";
    const recusas: string[] = [];
    for (const c of candidatasChave) {
      try {
        await listar(PASTAS[0].raiz, c.valor);
        driveKey = c.valor;
        chaveFonte = c.fonte;
        break;
      } catch (e) {
        recusas.push(`${c.fonte}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      }
    }
    if (!driveKey) throw new Error(`nenhuma chave da Drive API funcionou — ${recusas.join(" | ")}`);

    const aiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

    /* ---------- 1. o que já foi lido ---------- */
    const { data: jaLidos } = await supabase.from("comprovantes_drive")
      .select("drive_id,drive_modificado_em,lido_como");
    const conhecidos = new Map<string, { mod: string | null; lido: string | null }>();
    for (const c of jaLidos ?? []) {
      conhecidos.set(c.drive_id as string, {
        mod: (c.drive_modificado_em as string) ?? null, lido: (c.lido_como as string) ?? null,
      });
    }

    /* ---------- 2. varrer o Drive ---------- */
    type Pendente = { arq: Arquivo; pasta: string; mes: string };
    const pendentes: Pendente[] = [];
    const porPasta: Record<string, { arquivos: number; novos: number }> = {};

    for (const p of PASTAS) {
      if (soPasta && soPasta !== p.pasta) continue;
      porPasta[p.pasta] = { arquivos: 0, novos: 0 };
      const meses = await listar(p.raiz, driveKey);
      for (const m of meses.filter((x) => x.mimeType === "application/vnd.google-apps.folder")) {
        for (const a of await listar(m.id, driveKey)) {
          if (a.mimeType === "application/vnd.google-apps.folder") continue;
          porPasta[p.pasta].arquivos++;
          const visto = conhecidos.get(a.id);
          /* Relê só o que mudou (ou o que falhou antes): cada foto é uma
             chamada de OCR, e são 107.
             Compara como DATA e não como texto: o Drive manda
             "2026-08-10T16:36:46Z" e o Postgres devolve
             "2026-08-10T16:36:46+00:00" — em string o "Z" é maior que o "+" e
             TUDO parecia modificado, o que fazia a rodada semanal reprocessar
             a pasta inteira. */
          const mudou = !visto || visto.lido === null
            || (!!a.modifiedTime && !!visto.mod
                && new Date(a.modifiedTime).getTime() > new Date(visto.mod).getTime());
          if (!releitura && !mudou) continue;
          porPasta[p.pasta].novos++;
          pendentes.push({ arq: a, pasta: p.pasta, mes: m.name });
        }
      }
    }

    if (previa) {
      return json({ ok: true, previa: true, chave_fonte: chaveFonte, chave_recusadas: recusas,
        por_pasta: porPasta, a_processar: pendentes.length,
        amostra: pendentes.slice(0, 10).map((p) => ({ pasta: p.pasta, mes: p.mes, nome: p.arq.name })) });
    }

    /* ---------- 3. a fatura, para casar ---------- */
    const cartao: LinhaCartao[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase.from("cartao_lancamentos")
        .select("data,valor,estabelecimento,descricao,parcela").range(de, de + 999);
      if (error) throw new Error(`cartao_lancamentos: ${error.message}`);
      const bloco = (data ?? []) as LinhaCartao[];
      cartao.push(...bloco);
      if (bloco.length < 1000) break;
    }

    /* ---------- 4. ler e casar ---------- */
    let ocrsFeitos = 0;
    const linhas: Record<string, unknown>[] = [];
    const memosCasados: string[] = [];
    const agora = new Date().toISOString();
    let lidos = 0, casados = 0, ambiguos = 0, falhas = 0;

    for (const p of pendentes) {
      const base = {
        drive_id: p.arq.id, pasta: p.pasta, mes: p.mes, nome_arquivo: p.arq.name,
        mime: p.arq.mimeType, drive_modificado_em: p.arq.modifiedTime ?? null,
        atualizado_em: agora,
      };
      try {
        const bytes = await baixar(p.arq.id, driveKey);
        const precisaOcr = p.arq.mimeType.startsWith("image/");
        const { lido, erro } = await lerArquivo(
          p.arq, bytes, aiKey, ocrsFeitos < TETO_OCR,
        );
        if (precisaOcr || lido?.lido_como === "ocr") ocrsFeitos++;

        if (!lido) { linhas.push({ ...base, erro: erro ?? "não deu para ler" }); falhas++; continue; }
        lidos++;

        const c = casar(lido, cartao, p.pasta);
        const comum = {
          ...base, erro: null,
          lido_como: lido.lido_como, emitente: lido.emitente, cnpj_norm: lido.cnpj_norm,
          data: lido.data, valor: lido.valores[0] ?? null, descricao: lido.descricao,
          itens: lido.itens, notas: lido.notas, lido_em: agora,
        };

        if (c && "linha" in c) {
          casados++;
          if (c.linha.descricao) memosCasados.push(c.linha.descricao);
          linhas.push({
            ...comum, casamento: c.casamento, confianca: c.confianca,
            cartao_data: c.linha.data, cartao_valor: Math.abs(Number(c.linha.valor)),
            cartao_estabelecimento: c.linha.estabelecimento, cartao_descricao: c.linha.descricao,
            candidatos: null, casado_em: agora,
          });
        } else if (c) {
          ambiguos++;
          linhas.push({ ...comum, candidatos: c.candidatos, casamento: null, confianca: null });
        } else {
          linhas.push(comum);
        }
      } catch (e) {
        falhas++;
        linhas.push({ ...base, erro: String((e as Error)?.message ?? e).slice(0, 300) });
      }
    }

    /* ---------- 5. gravar ---------- */
    for (let i = 0; i < linhas.length; i += 100) {
      const { error } = await supabase.from("comprovantes_drive")
        .upsert(linhas.slice(i, i + 100), { onConflict: "drive_id" });
      if (error) throw new Error(`gravar: ${error.message}`);
    }

    /* ---------- 6. do memo para o título do Omie ----------
       É o `cod_titulo` que o drill-down da DRE tem na mão. */
    let comTitulo = 0;
    if (memosCasados.length) {
      const { data: pares } = await supabase.rpc("titulos_por_memo", { p_memos: [...new Set(memosCasados)] });
      for (const par of (pares ?? []) as { memo: string; cod_titulo: string }[]) {
        const { error } = await supabase.from("comprovantes_drive")
          .update({ cod_titulo: par.cod_titulo, atualizado_em: agora })
          .eq("cartao_descricao", par.memo).is("cod_titulo", null);
        if (!error) comTitulo++;
      }
    }

    return json({
      ok: true, por_pasta: porPasta,
      processados: pendentes.length, lidos, casados, ambiguos, falhas,
      ocr_usados: ocrsFeitos, ocr_teto: TETO_OCR,
      memos_resolvidos_em_titulo: comTitulo,
      restante: Math.max(0, pendentes.length - lidos - falhas),
    });
  } catch (e) {
    console.error("comprovantes-drive-sync", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
