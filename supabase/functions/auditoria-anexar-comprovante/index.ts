// Edge Function: auditoria-anexar-comprovante
//
// Anexa um comprovante/NF a um lançamento da Auditoria a partir do próprio Hub —
// sem depender do link público do WhatsApp nem do Drive.
//
// Por que uma função e não upload direto do browser: o bucket `comprovantes-auditoria`
// é privado e as políticas de escrita não estão abertas para o usuário logado. Aqui
// rodamos com a service role (após `requireUser`, que barra anon key e o cargo
// "parcerias"), gravamos o arquivo e atualizamos a linha na tabela certa.
//
// Onde o arquivo fica: mesma convenção do resto da auditoria — `link_comprovante`
// guarda o CAMINHO no bucket (não uma URL). O front resolve com signed URL
// (src/lib/comprovante.ts) e a `omie-anexar-comprovante` também entende caminho.
//
// Bônus: se o lançamento já tem título casado no Omie (`omie_cod_titulo`), o anexo vai
// direto para o ERP na mesma chamada. Se o Omie recusar, o comprovante NÃO se perde —
// ele fica gravado e a resposta traz `aviso`.
//
// Body:
//   { origem: "achado" | "cartao",   // "achado" = tabela auditoria; "cartao" = base do cartão
//     id_unico: string,              // ACH-… / CART-…
//     nome: string, base64: string, mime?: string,
//     modo?: "acrescentar" | "substituir",   // só quando o título do Omie já tem anexo
//     anexoTabela?: string }
//
// Resposta:
//   { ok, storage_path, anexado_omie, omie_cod_titulo?, aviso? }
//   { ok, ja_tem_anexo: true, nomes: string[] }   → o Hub pergunta e reenvia com `modo`
//   { error }                                      → mensagem pronta para o toast

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { incluirAnexo, omieCall } from "../_shared/omie.ts";
import { ehHtml } from "../_shared/drive.ts";
import { requireUser } from "../_shared/auth.ts";

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

/** Anexos já existentes no título (melhor-esforço: erro do Omie vira lista vazia). */
async function listarAnexos(nId: number | string, cTabela: string): Promise<{ nIdAnexo: unknown; nome: string }[]> {
  try {
    const r = await omieCall<any>("geral/anexo", "ListarAnexo", { nId, cTabela, nPagina: 1, nRegPorPagina: 50 });
    const arr = r?.listaAnexos ?? r?.anexos ?? r?.arquivos ?? [];
    return (Array.isArray(arr) ? arr : []).map((a: any) => ({
      nIdAnexo: a.nIdAnexo ?? a.nCodAnexo ?? a.nId ?? a.cCodIntAnexo,
      nome: String(a.cNomeArquivo ?? a.nome ?? a.cArquivo ?? "anexo"),
    }));
  } catch (_) { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const origem = String(body?.origem ?? "achado");
    const idUnico = String(body?.id_unico ?? "").trim();
    const nome = String(body?.nome ?? "comprovante").slice(0, 120);
    const base64 = String(body?.base64 ?? "");
    const modo = String(body?.modo ?? "");
    const cTabela = String(body?.anexoTabela ?? "conta-pagar");

    if (origem !== "achado" && origem !== "cartao") return json({ error: "Origem inválida." }, 200);
    if (!idUnico || !base64) return json({ error: "Parâmetros faltando (id_unico, base64)." }, 200);
    if (!EXT_OK.test(nome)) return json({ error: "Formato inválido. Use PDF, JPG, PNG ou WEBP." }, 200);

    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(base64.replace(/^data:[^;]+;base64,/, "")), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: "Arquivo inválido (base64)." }, 200);
    }
    if (!bytes.length) return json({ error: "Arquivo vazio." }, 200);
    if (bytes.length > MAX_BYTES) return json({ error: "Arquivo maior que 10 MB." }, 200);
    // Página de erro do Drive salva como "comprovante.pdf" é o engano mais comum.
    if (ehHtml(bytes)) return json({ error: "Isso é uma página HTML, não um comprovante. Envie o PDF ou a imagem." }, 200);

    const tabela = origem === "achado" ? "auditoria" : "auditoria_cartao_lancamentos";
    const colunas = origem === "achado"
      ? "id, id_unico, omie_cod_titulo, omie_anexo_enviado_em, link_comprovante, id_transacao"
      : "id, id_unico, omie_cod_titulo, omie_anexo_enviado_em, link_comprovante";
    const { data: linha, error: selErr } = await supabase
      .from(tabela)
      .select(colunas)
      .eq("id_unico", idUnico)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!linha) return json({ error: `Lançamento ${idUnico} não encontrado em ${tabela}.` }, 200);

    const codTitulo = (linha as any).omie_cod_titulo ? String((linha as any).omie_cod_titulo) : null;

    // Se o título do Omie já tem anexo e o usuário ainda não decidiu, devolve a pergunta
    // ANTES de gravar qualquer coisa — assim um "cancelar" não deixa arquivo órfão.
    if (codTitulo && !modo) {
      const existentes = await listarAnexos(codTitulo, cTabela);
      if (existentes.length > 0) {
        return json({ ok: true, ja_tem_anexo: true, qtd: existentes.length, nomes: existentes.map((a) => a.nome) });
      }
    }

    /* ---------------- 1) guarda o arquivo no bucket privado ---------------- */
    const seguro = nome.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `hub/${idUnico}/${Date.now()}_${seguro}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: body?.mime ? String(body.mime) : undefined,
      upsert: false,
    });
    if (upErr) return json({ error: `Falha ao guardar o arquivo: ${upErr.message}` }, 200);

    /* ---------------- 2) anexa no Omie, quando há título casado ---------------- */
    let anexadoOmie = false;
    let aviso: string | null = null;
    if (codTitulo) {
      try {
        if (modo === "substituir") {
          for (const a of await listarAnexos(codTitulo, cTabela)) {
            if (a.nIdAnexo == null) continue;
            try {
              await omieCall("geral/anexo", "ExcluirAnexo", { nId: Number(codTitulo), cTabela, nIdAnexo: a.nIdAnexo });
            } catch (_) { /* melhor-esforço: se não apagar, o novo entra do lado */ }
          }
        }
        await incluirAnexo({
          nId: codTitulo,
          cTabela,
          nome,
          base64: base64.replace(/^data:[^;]+;base64,/, ""),
          codInt: `h${(linha as any).id}-${Date.now().toString(36)}`.slice(0, 20),
        });
        anexadoOmie = true;
      } catch (err) {
        // O comprovante já está guardado; o envio ao Omie pode ser refeito pelo botão da tela.
        aviso = "Comprovante guardado, mas o Omie recusou o anexo: " +
          (err instanceof Error ? err.message : String(err));
      }
    } else {
      aviso = "Comprovante guardado. Este lançamento ainda não tem título casado no Omie — rode \"Cruzar com Omie\" para poder anexar lá.";
    }

    /* ---------------- 3) atualiza a linha ---------------- */
    const agora = new Date().toISOString();
    const patch: Record<string, unknown> = { link_comprovante: path, updated_at: agora };
    if (anexadoOmie) { patch.omie_anexo_enviado_em = agora; patch.omie_anexo_nome = nome; }

    // Chegou a nota: o lançamento deixa de ser "SEM NF". Na base do cartão isso é
    // status_nf = "OK"; no achado é a categoria "COM NF" (chips e KPIs da tela).
    if (origem === "achado") {
      const { data: atual } = await supabase.from("auditoria").select("trilha").eq("id", (linha as any).id).maybeSingle();
      const trilha = Array.isArray((atual as any)?.trilha) ? (atual as any).trilha : [];
      patch.categoria = "COM NF";
      patch.trilha = [...trilha, {
        em: agora,
        por: caller.email ?? "hub",
        texto: `Comprovante anexado pelo Hub: ${nome} · categoria → COM NF${anexadoOmie ? " · anexado ao Omie" : ""}`,
        tipo: "comprovante_anexado",
        arquivo: nome,
      }];
    } else {
      patch.arquivo_comprovante = nome;
      patch.status_nf = "OK";
    }

    const { error: updErr } = await supabase.from(tabela).update(patch).eq("id", (linha as any).id);
    if (updErr) return json({ error: `Arquivo enviado, mas falhou ao gravar na tabela: ${updErr.message}` }, 200);

    // Os dois lados da mesma nota: o achado e o lançamento do cartão que o originou.
    // Atualizar só um deixa a outra tela cobrando uma NF que já chegou.
    const idTransacao = origem === "achado" ? ((linha as any).id_transacao ?? null) : null;
    if (idTransacao) {
      const { error } = await supabase.from("auditoria_cartao_lancamentos")
        .update({ status_nf: "OK", link_comprovante: path, arquivo_comprovante: nome, updated_at: agora })
        .eq("id_unico", idTransacao);
      if (error) console.warn("origem no cartão não atualizada:", error.message);
    }
    if (origem === "cartao") {
      const { error } = await supabase.from("auditoria")
        .update({ categoria: "COM NF", link_comprovante: path, updated_at: agora })
        .eq("id_transacao", idUnico);
      if (error) console.warn("achado vinculado não atualizado:", error.message);
    }

    return json({
      ok: true,
      storage_path: path,
      anexado_omie: anexadoOmie,
      omie_cod_titulo: codTitulo,
      arquivo: nome,
      aviso,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
