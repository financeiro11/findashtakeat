// Edge Function: nota-anexar-titulo
//
// A pessoa abre "Notas no ERP", vê o título que está devendo nota, e ANEXA ALI.
// Um gesto, e a nota aparece em todo lugar que a cobrava.
//
// Era o buraco no meio da esteira. O Hub sabia dizer quem devia nota por quatro
// caminhos automáticos — planilha, Drive, e-mail, cartão — e nenhum deles servia
// para o caso mais comum de todos: a nota chegou por fora (WhatsApp do
// engenheiro, portal do fornecedor, link no corpo do e-mail, PDF que alguém
// baixou) e a pessoa a tem na mão, olhando para a linha que a cobra.
//
// O QUE ACONTECE NUMA CHAMADA:
//   1. o arquivo vai para o bucket privado `comprovantes-auditoria`;
//   2. vira linha em `notas_externas` com `alvo_manual` — o acervo passa a
//      conhecê-la, e o casador não a reencaixa em outro título depois;
//   3. `nota_propagar` espalha para as outras listas que cobram o mesmo gasto
//      (achado da auditoria, base do cartão, Facilities, comprovantes do Drive);
//   4. entra na fila do ERP e a varredura é acordada na hora.
//
// POR QUE NÃO ANEXA NO OMIE AQUI DENTRO: quem anexa é a
// `omie-anexar-comprovante`, e ela sabe coisas que esta não sabe — zipar (o Omie
// exige), transformar foto em PDF (o Omie recusa jpg), confirmar que o anexo
// colou, carimbar as quatro tabelas e escrever o motivo quando falha. Duplicar
// isso aqui seria manter dois caminhos que divergem no primeiro conserto. Esta
// função põe na fila e bate na porta; se a chamada não voltar a tempo, o cron
// de 15 em 15 minutos leva. O arquivo nunca se perde: ele já está gravado.
//
// Body: { cod_titulo: number|string, nome: string, base64: string, mime?: string,
//         tipo_documento?: 'nota'|'boleto'|'recibo'|'outro', observacao?: string }
// Resposta: { ok, nota_id, storage_path, propagou, enviando } | { error }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { ehHtml } from "../_shared/drive.ts";
import { tipoQueVale } from "../_shared/mime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
const MAX_BYTES = 10 * 1024 * 1024;
/* XML entra: é a melhor fonte que existe e o Omie aceita. A allowlist do bucket
   já foi ampliada para ele em 26/08/2026 — ver `notas-externas-planilhas-pix`. */
const EXT_OK = /\.(pdf|xml|jpe?g|png|webp)$/i;
const TIPOS = new Set(["nota", "boleto", "recibo", "extrato", "outro"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const cod = String(body?.cod_titulo ?? "").replace(/\D/g, "");
    const nomeArq = String(body?.nome ?? "nota").slice(0, 120);
    const base64 = String(body?.base64 ?? "");
    const tipoDoc = TIPOS.has(String(body?.tipo_documento)) ? String(body.tipo_documento) : "nota";
    const observacao = String(body?.observacao ?? "").slice(0, 300) || null;

    if (!cod) return json({ error: "Informe o título (cod_titulo)." }, 200);
    if (!base64) return json({ error: "Nenhum arquivo recebido." }, 200);
    if (!EXT_OK.test(nomeArq)) return json({ error: "Formato inválido. Use PDF, XML, JPG, PNG ou WEBP." }, 200);

    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(base64.replace(/^data:[^;]+;base64,/, "")), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: "Arquivo inválido (base64)." }, 200);
    }
    if (!bytes.length) return json({ error: "Arquivo vazio." }, 200);
    if (bytes.length > MAX_BYTES) return json({ error: "Arquivo maior que 10 MB." }, 200);
    /* O engano mais comum, e o mais silencioso: salvar a PÁGINA do Drive ou do
       portal do fornecedor como "nota.pdf". Ela sobe, o Omie aceita, e o
       contador abre um HTML. */
    if (ehHtml(bytes)) {
      return json({ error: "Isso é uma página HTML, não a nota. Baixe o arquivo e envie o PDF ou o XML." }, 200);
    }

    /* ---------------- 1) o título tem de existir ---------------- */
    const { data: titulo, error: erroTitulo } = await supabase
      .from("cap_titulos")
      .select("cod_titulo, valor, doc, favorecido, favorecido_cru, emissao, vencimento, pagamento, situacao")
      .eq("cod_titulo", Number(cod))
      .maybeSingle();
    if (erroTitulo) throw erroTitulo;
    if (!titulo) return json({ error: `Título ${cod} não existe no contas a pagar.` }, 200);

    /* O alvo é 'pix' quando o lançamento também vive na auditoria de PIX, e
       'erp' quando não — a mesma partição que `notas_externas_casar` usa. Sem
       isso a nota apontaria para um alvo que a varredura não sabe traduzir. */
    const { data: pix } = await supabase
      .from("auditoria_pix_lancamentos")
      .select("id_unico").eq("id_unico", cod).maybeSingle();
    const alvoTipo = pix ? "pix" : "erp";

    /* ---------------- 2) guarda o arquivo ---------------- */
    const agora = new Date();
    const carimbo = agora.getTime();
    const mes = agora.toISOString().slice(0, 7);
    const seguro = nomeArq.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `hub-titulo/${mes}/${cod}_${carimbo}_${seguro}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      // O rótulo de quem enviou é o último a ser ouvido: os bytes decidem.
      contentType: tipoQueVale(nomeArq, body?.mime ? String(body.mime) : null, bytes) ?? undefined,
      upsert: false,
    });
    if (upErr) return json({ error: `Falha ao guardar o arquivo: ${upErr.message}` }, 200);

    /* ---------------- 3) o acervo passa a conhecer a nota ---------------- */
    const dataTitulo = (titulo as any).pagamento ?? (titulo as any).vencimento ?? (titulo as any).emissao;
    const { data: nota, error: erroNota } = await supabase
      .from("notas_externas")
      .insert({
        chave: `hub|${cod}|${carimbo}`,
        fonte: "hub",
        ordem: 1,
        /* A data é a DO TÍTULO, não a de hoje: `enviado_em` é a âncora das
           janelas do casador, e "hoje" jogaria a nota de março para agosto em
           qualquer conferência que olhe período. */
        enviado_em: dataTitulo,
        nome: (titulo as any).favorecido_cru ?? (titulo as any).favorecido ?? null,
        cnpj: (titulo as any).doc ?? null,
        valor: (titulo as any).valor ?? null,
        o_que_e: "Anexada no Hub",
        detalhe: [observacao, `título ${cod}`, caller.email].filter(Boolean).join(" · "),
        tipo_documento: tipoDoc,
        tem_arquivo: true,
        link: path,
        /* `alvo_manual` é o que impede o casador de reencaixar esta nota em
           outro título na próxima rodada. Quem apontou foi gente, olhando. */
        alvo_tipo: alvoTipo,
        alvo_id_unico: cod,
        alvo_manual: true,
        casamento: "anexada_no_hub",
        confianca: "exata",
        conferencia: "falta_anexar",
        fila_erp: true,
        visto_em: agora.toISOString(),
        atualizado_em: agora.toISOString(),
      })
      .select("id")
      .single();
    if (erroNota) return json({ error: `Falha ao registrar a nota: ${erroNota.message}` }, 200);

    /* ---------------- 4) espalha para quem mais cobrava o mesmo gasto ------- */
    let propagou: unknown = null;
    try {
      const { data, error } = await supabase.rpc("nota_propagar", { p_cod: cod });
      if (error) throw new Error(error.message);
      propagou = data ?? null;
    } catch (e) {
      // Acessório por construção: a nota já está gravada e já está na fila.
      console.error("nota_propagar:", String((e as Error)?.message ?? e));
    }

    /* ---------------- 5) acorda a varredura, sem depender dela ------------- */
    let enviando = false;
    try {
      const r = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/omie-anexar-comprovante`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ action: "varredura", limite: 3 }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      enviando = r.ok;
    } catch (_) {
      // O cron de :05/:20/:35/:50 leva. Nada se perde — o arquivo já está gravado.
      enviando = false;
    }

    return json({
      ok: true,
      nota_id: (nota as any).id,
      storage_path: path,
      alvo_tipo: alvoTipo,
      propagou,
      enviando,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("nota-anexar-titulo:", msg);
    return json({ error: msg }, 200);
  }
});
