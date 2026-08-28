// Edge Function: nota-baixar-link
//
// A nota que chegou como ENDEREÇO vira arquivo.
//
// Metade dos emissores de NFS-e não anexa nada: manda link. O Bling escreve
// "Visualizar DANFE"; a Davam, que fatura a BuzzLead, escreve "Segue o Link da
// Nota Fiscal". Até aqui essas linhas entravam no acervo com `tem_arquivo =
// false` e ficavam de fora da fila do ERP — a varredura tentaria baixar uma
// página do Gmail e voltaria HTML, que é o erro mais confuso possível.
//
// Conferido em 27/08/2026: o link da BuzzLead responde 200 com
// `application/pdf`, 40 KB, sem login. A nota estava a um GET de distância.
//
// AS TRÊS GUARDAS, e cada uma já custou caro em outra esteira deste repo:
//   • o link tem de VIR de `linksDeNota` (a `gmail-nf-sync` já filtrou rastreio,
//     descadastro e o próprio Gmail) — aqui não se navega o que o e-mail manda;
//   • o que volta tem de ser documento: HTML é a página de login ou de erro, e
//     gravá-la como nota é pior do que não ter nota (`ehHtml`);
//   • o tipo vem dos BYTES, não do `content-type` — o mesmo motivo pelo qual o
//     bucket recusou 196 XMLs em 26/08/2026.
//
// Body: { limite?: number, id?: number, retentar?: boolean }
// Cron: header `x-cron-token`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { ehHtml } from "../_shared/drive.ts";
import { tipoQueVale } from "../_shared/mime.ts";
import { textoDePdf } from "../_shared/pdf.ts";
import { lerCorpoDeEmail, lerXmlFiscal } from "../_shared/nota-fiscal.ts";

/** O CNPJ da casa: no texto da nota ele está do lado do dele, e não é ele. */
const CNPJ_TAKEAT = "37511891000150";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
const MAX_BYTES = 10 * 1024 * 1024;
/** O worker morre aos 150 s; parar antes devolve relatório em vez de nada. */
const ORCAMENTO_MS = 55_000;

/**
 * O nome do arquivo, quando a URL não traz um.
 *
 * ESTE NOME NÃO É DETALHE DE BUCKET: é o que a `omie-anexar-comprovante` manda
 * ao ERP (ela usa o último pedaço do caminho), e portanto é o que o contador lê
 * na lista de anexos do título. O último segmento do link do eNotas é a palavra
 * "pdf" — o arquivo virava `32461_pdf.pdf`, que não diz de quem é a nota nem
 * qual é. Quando a URL não nomeia, quem nomeia é o que já se sabe da nota.
 */
function nomeDoLink(url: string, tipo: string | null, nota: { nome?: string | null; documento?: string | null }): string {
  const ext = tipo?.includes("xml") ? "xml" : "pdf";
  const fim = (url.split("?")[0].split("/").pop() ?? "").replace(/[^\w.\- ]+/g, "_");
  if (/\.(pdf|xml)$/i.test(fim)) return fim;

  /* O segmento é só o formato ("…/pdf") — não nomeia nada. */
  const seguro = (s: string) => s.replace(/[^\w.\- ]+/g, " ").replace(/\s+/g, " ").trim();
  const partes = [
    nota.documento ? `NFSe ${seguro(String(nota.documento))}` : null,
    nota.nome ? seguro(String(nota.nome)).slice(0, 60) : null,
  ].filter(Boolean);
  if (partes.length) return `${partes.join(" - ").slice(0, 90)}.${ext}`;
  return `${(fim || "nota").slice(0, 60)}.${ext}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const cron = req.headers.get("x-cron-token");
    if (cron) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("token").eq("name", "nota-baixar-link").maybeSingle();
      if (!data?.token || data.token !== cron) return json({ error: "Token inválido." }, 401);
    } else {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limite = Math.min(Math.max(Number(body?.limite ?? 20), 1), 60);
    const soId = Number(body?.id ?? 0) || null;
    /* O que já falhou volta só quando alguém MANDA. Ver a guarda abaixo. */
    const retentar = body?.retentar === true;

    let q = supabase
      .from("notas_externas")
      .select("id, link_documento, nome, documento, o_que_e, enviado_em, cnpj, valor, chave_fiscal")
      .not("link_documento", "is", null)
      .eq("tem_arquivo", false)
      .is("ignorado_em", null)
      .limit(limite);
    /* O ERRO GRAVADO TAMBÉM TEM DE SER LIDO.
     *
     * Ele era escrito no fim de cada falha — e a consulta nunca o consultava.
     * Resultado medido em 28/08/2026: 23 links de portal de prefeitura (São
     * Paulo e Barueri, que exigem sessão e devolvem `Connection reset` ou a
     * página de login) voltavam em TODA rodada, gastavam os 55 s inteiros e
     * empurravam para fora da fila os links que teriam funcionado. Oito
     * rodadas seguidas com `baixadas: 0` e as mesmas 23 candidatas.
     *
     * Quem falhou espera alguém pedir de novo — `retentar: true`, ou o `id`
     * direto, que é como se conserta um link específico depois de arrumar a
     * causa. */
    if (!retentar && !soId) q = q.is("arquivo_erro", null);
    if (soId) q = q.eq("id", soId);
    const { data: pendentes, error } = await q;
    if (error) throw error;

    const inicio = Date.now();
    let baixadas = 0;
    const falhas: { id: number; erro: string }[] = [];

    for (const n of pendentes ?? []) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      const url = String((n as any).link_documento);
      try {
        const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!bytes.length) throw new Error("veio vazio");
        if (bytes.length > MAX_BYTES) throw new Error("maior que 10 MB");
        if (ehHtml(bytes)) throw new Error("o link devolveu uma página, não o documento");

        const tipo = tipoQueVale(url, r.headers.get("content-type"), bytes);
        if (tipo && !/pdf|xml/i.test(tipo)) throw new Error(`tipo inesperado (${tipo})`);

        const mes = String((n as any).enviado_em ?? "").slice(0, 7) || "sem-data";
        const caminho = `link/${mes}/${(n as any).id}_${nomeDoLink(url, tipo, n as any)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(caminho, bytes, { contentType: tipo ?? undefined, upsert: true });
        if (upErr) throw new Error(upErr.message);

        /* E AGORA SE LÊ O QUE CHEGOU.
           Baixar sem ler resolveria metade: as quatro notas da BuzzLead
           entraram com arquivo e seguiram `sem_alvo`, porque o corpo do e-mail
           da Davam não escreve CNPJ nem "R$" — está tudo DENTRO do PDF. Sem
           valor nem documento nenhuma regra do casador alcança, e o arquivo
           ficaria no acervo sem nunca achar o título que o espera.
           Só preenche buraco: leitura que já existe (do corpo do e-mail, que é
           mais confiável quando existe) não é sobrescrita. */
        let lido: { cnpj: string | null; valor: number | null; chave: string | null } | null = null;
        try {
          if (tipo?.includes("xml")) {
            lido = lerXmlFiscal(new TextDecoder().decode(bytes), CNPJ_TAKEAT);
          } else {
            /* `textoDePdf` devolve `{ texto, senha, erro }` e nunca lança — o
               PDF só de imagem volta com texto vazio, e aí não há o que ler
               (quem resolveria é o OCR, que não roda nesta função). */
            const { texto } = await textoDePdf(bytes);
            if (texto.trim()) lido = lerCorpoDeEmail(texto, CNPJ_TAKEAT);
          }
        } catch (_) {
          lido = null; // ler é bônus; o arquivo já está gravado.
        }

        const { error: updErr } = await supabase.from("notas_externas").update({
          tem_arquivo: true, link: caminho, arquivo_bytes: bytes.length,
          arquivo_em: new Date().toISOString(), arquivo_erro: null,
          cnpj: (n as any).cnpj ?? lido?.cnpj ?? null,
          valor: (n as any).valor ?? lido?.valor ?? null,
          chave_fiscal: (n as any).chave_fiscal ?? lido?.chave ?? null,
          atualizado_em: new Date().toISOString(),
        }).eq("id", (n as any).id);
        if (updErr) throw new Error(updErr.message);
        baixadas++;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 200);
        falhas.push({ id: (n as any).id, erro: msg });
        /* O erro FICA GRAVADO. Sem isso o link que nunca vai dar certo volta em
           toda rodada e come o orçamento — foi o que parou a drenagem da pasta
           "0. Gmail" pela metade em 26/08/2026. */
        await supabase.from("notas_externas")
          .update({ arquivo_erro: msg, atualizado_em: new Date().toISOString() })
          .eq("id", (n as any).id);
      }
    }

    if (baixadas > 0) {
      try { await supabase.rpc("notas_externas_casar"); } catch (_) { /* o cron :30 recasa */ }
    }

    return json({
      ok: true,
      candidatas: (pendentes ?? []).length,
      baixadas,
      falhas: falhas.slice(0, 10),
      gastou_ms: Date.now() - inicio,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("nota-baixar-link:", msg);
    return json({ error: msg }, 200);
  }
});
