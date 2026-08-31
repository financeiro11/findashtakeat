// Edge Function: fatura-anexar-comprovante
//
// O líder anexa a nota em QUALQUER linha da fatura do cartão dele, pelo /l/<token> —
// inclusive nas linhas que nunca viraram achado, que é a maioria (em ago/26 nenhum
// lançamento virou achado, então a aba de pendências mostrava agosto vazio).
//
// Por que uma função e não upload direto do navegador: `comprovantes-auditoria` é um
// bucket privado e `anon` não tem política de escrita nele. Aqui roda a service role.
//
// Por que não dá para reaproveitar `auditoria-anexar-comprovante`: aquela começa com
// `requireUser`, e quem abre este link não tem conta no Hub. A autorização aqui é outra —
// token + os 4 dígitos do cartão — e ela é verificada NO BANCO, por
// `fatura_cartao_do_token`, que é justamente a função que não foi concedida a `anon`.
//
// A regra que segura tudo: o arquivo só entra se a linha pedida for do MESMO cartão que
// o token abre. Sem isso um líder gravaria na linha de outro só sabendo o id_unico.
//
// Não manda ao Omie de propósito — é o mesmo desenho de `registrar_comprovante_via_token`.
// O envio ao ERP continua sendo um botão do Hub, com gente olhando.
//
// Body:  { token, digitos, id_unico, nome, base64, mime? }
// Resp:  { ok, storage_path, arquivo } | { erro }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ehHtml } from "../_shared/drive.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
const MAX_BYTES = 10 * 1024 * 1024;
const EXT_OK = /\.(pdf|jpe?g|png|webp)$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const token = String(body?.token ?? "").trim();
    const digitos = String(body?.digitos ?? "").replace(/\D/g, "");
    const idUnico = String(body?.id_unico ?? "").trim();
    const nome = String(body?.nome ?? "comprovante").slice(0, 120);
    const base64 = String(body?.base64 ?? "");

    if (!token || !digitos) return json({ erro: "Acesso não confere." });
    if (!idUnico || !base64) return json({ erro: "Faltou o lançamento ou o arquivo." });
    if (!EXT_OK.test(nome)) return json({ erro: "Formato inválido. Use PDF, JPG ou PNG." });

    /* ---------------- 1) quem é você, e qual é o seu cartão ---------------- */
    const { data: cartao, error: authErr } = await supabase
      .rpc("fatura_cartao_do_token", { p_token: token, p_digitos: digitos });
    if (authErr) throw authErr;
    if (!cartao) return json({ erro: "Acesso não confere. Abra o link de novo." });

    /* ---------------- 2) a linha é mesmo do seu cartão? ---------------- */
    const { data: linha, error: selErr } = await supabase
      .from("auditoria_cartao_lancamentos")
      .select("id, id_unico, card_final")
      .eq("id_unico", idUnico)
      .eq("card_final", cartao)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!linha) return json({ erro: "Este lançamento não é do seu cartão." });

    /* ---------------- 3) o arquivo ---------------- */
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(base64.replace(/^data:[^;]+;base64,/, "")), (c) => c.charCodeAt(0));
    } catch {
      return json({ erro: "Arquivo inválido." });
    }
    if (!bytes.length) return json({ erro: "Arquivo vazio." });
    if (bytes.length > MAX_BYTES) return json({ erro: "Arquivo maior que 10 MB." });
    // Salvar a página de erro do Drive como "nota.pdf" é o engano mais comum de todos.
    if (ehHtml(bytes)) return json({ erro: "Isso é uma página da web, não um comprovante. Envie o PDF ou a foto." });

    const seguro = nome.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `fatura/${idUnico}/${Date.now()}_${seguro}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: body?.mime ? String(body.mime) : undefined,
      upsert: false,
    });
    if (upErr) return json({ erro: `Não conseguimos guardar o arquivo: ${upErr.message}` });

    /* ---------------- 4) marca nos dois lados ---------------- */
    const agora = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("auditoria_cartao_lancamentos")
      .update({ status_nf: "OK", link_comprovante: path, arquivo_comprovante: nome, updated_at: agora })
      .eq("id", (linha as { id: number }).id);
    if (updErr) return json({ erro: `Arquivo enviado, mas falhou ao gravar: ${updErr.message}` });

    // Quando a linha TAMBÉM foi cobrada como achado, o achado precisa saber — senão a
    // aba de pendências segue pedindo a nota que acabou de chegar.
    const { data: achado } = await supabase
      .from("auditoria").select("id, trilha").eq("id_transacao", idUnico).maybeSingle();
    if (achado) {
      const trilha = Array.isArray((achado as { trilha?: unknown[] }).trilha)
        ? (achado as { trilha: unknown[] }).trilha : [];
      await supabase.from("auditoria").update({
        link_comprovante: path,
        categoria: "COM NF",
        status: "Em análise",
        trilha: [...trilha, {
          evento: "comprovante_anexado",
          canal: "link_publico_fatura",
          token,
          storage_path: path,
          arquivo: nome,
          timestamp: agora,
        }],
        updated_at: agora,
      }).eq("id", (achado as { id: number }).id);
    }

    return json({ ok: true, storage_path: path, arquivo: nome });
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : String(e) });
  }
});
