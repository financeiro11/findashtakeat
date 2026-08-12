import { supabase } from "@/integrations/supabase/client";

/**
 * Anexar comprovante/NF a um lançamento da Auditoria direto pelo Hub.
 *
 * São DOIS caminhos, nesta ordem:
 *
 *   1) Edge Function `auditoria-anexar-comprovante` — guarda o arquivo E, se o
 *      lançamento já tem título casado, anexa no Omie na mesma chamada.
 *   2) Upload direto do browser para o bucket — usado quando a função ainda não foi
 *      publicada. Guarda o arquivo e grava o caminho na tabela; o envio ao Omie fica
 *      para o botão "Enviar ao Omie", que já existe na tela.
 *
 * O caminho 2 existe porque o deploy da função depende do Lovable/Supabase e não pode
 * segurar a funcionalidade: com ele, anexar passa a funcionar assim que o front sobe.
 *
 * Em ambos, `link_comprovante` guarda o CAMINHO no bucket (não uma URL) — é a mesma
 * convenção que o n8n usa nos achados, e o front resolve com signed URL
 * (src/lib/comprovante.ts).
 */

const BUCKET = "comprovantes-auditoria";

export type OrigemAnexo = "achado" | "cartao";

export type RespostaAnexo = {
  ok?: boolean;
  /** o título do Omie já tem anexo: o Hub pergunta e reenvia com `modo`. */
  ja_tem_anexo?: boolean;
  nomes?: string[];
  storage_path?: string;
  anexado_omie?: boolean;
  omie_cod_titulo?: string | null;
  arquivo?: string;
  /** guardou o comprovante, mas o Omie não recebeu (sem título casado, recusou, ou
   *  o anexo foi pelo caminho direto). */
  aviso?: string | null;
};

export const ANEXO_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
const MAX_MB = 10;

/** Devolve a mensagem de erro, ou null quando o arquivo serve. */
export function validarArquivo(file: File): string | null {
  if (!/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) return "Formato inválido. Use PDF, JPG, PNG ou WEBP.";
  if (file.size > MAX_MB * 1024 * 1024) return `Arquivo acima de ${MAX_MB} MB.`;
  if (file.size === 0) return "Arquivo vazio.";
  return null;
}

export function lerBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ""); res(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => rej(r.error ?? new Error("Falha ao ler o arquivo"));
    r.readAsDataURL(file);
  });
}

const comoTexto = (v: any): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return [v.message, v.details, v.hint].filter(Boolean).join(" — ") || (() => {
    try { return JSON.stringify(v); } catch { return String(v); }
  })();
};

const tabelaDe = (origem: OrigemAnexo) => (origem === "achado" ? "auditoria" : "auditoria_cartao_lancamentos");

/** "função não publicada" / rede — só nestes casos vale cair para o upload direto. */
const funcaoIndisponivel = (msg: string) =>
  /not found|não foi publicada|Failed to (send|fetch)|NetworkError|404/i.test(msg);

/* ------------------------------------------------------------------ *
 *  Caminho 1: Edge Function (guarda + anexa no Omie)
 * ------------------------------------------------------------------ */
async function viaFuncao(payload: {
  origem: OrigemAnexo; id_unico: string; nome: string; base64: string;
  mime?: string; modo?: "acrescentar" | "substituir";
}): Promise<RespostaAnexo> {
  const { data, error } = await supabase.functions.invoke("auditoria-anexar-comprovante", { body: payload });
  if (error) {
    // FunctionsHttpError esconde o erro real no corpo (error.context) — sem isto o
    // toast mostra só "Edge Function returned a non-2xx status code".
    let detalhe = comoTexto(error.message);
    const ctx: any = (error as any).context;
    if (ctx && typeof ctx.text === "function") {
      try { const raw = await ctx.text(); detalhe = comoTexto(JSON.parse(raw)?.error) || raw || detalhe; } catch { /* keep */ }
    }
    throw new Error(detalhe || "Erro no backend.");
  }
  if ((data as any)?.error) throw new Error(comoTexto((data as any).error));
  return (data ?? {}) as RespostaAnexo;
}

/* ------------------------------------------------------------------ *
 *  Caminho 2: upload direto do browser (sem Edge Function)
 * ------------------------------------------------------------------ */
async function viaUploadDireto(origem: OrigemAnexo, idUnico: string, file: File): Promise<RespostaAnexo> {
  const seguro = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `hub/${idUnico}/${Date.now()}_${seguro}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (upErr) throw new Error(`Não consegui guardar o arquivo no bucket: ${comoTexto(upErr)}`);

  const tabela = tabelaDe(origem);
  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = { link_comprovante: path, updated_at: agora };

  // Chegou a nota: o lançamento deixa de ser "SEM NF". Na base do cartão isso é
  // status_nf = "OK"; no achado é a categoria "COM NF" (que a tela usa nos chips e KPIs).
  let idTransacao: string | null = null;
  if (origem === "cartao") {
    patch.arquivo_comprovante = file.name;
    patch.status_nf = "OK";
  } else {
    // Trilha do achado: lê a atual e acrescenta o evento (a coluna é um array JSON).
    const { data: atual } = await supabase.from("auditoria").select("trilha, id_transacao").eq("id_unico", idUnico).maybeSingle();
    const trilha = Array.isArray((atual as any)?.trilha) ? (atual as any).trilha : [];
    idTransacao = ((atual as any)?.id_transacao as string) ?? null;
    const { data: sessao } = await supabase.auth.getUser();
    patch.categoria = "COM NF";
    patch.trilha = [...trilha, {
      em: agora,
      por: sessao?.user?.email ?? "hub",
      texto: `Comprovante anexado pelo Hub: ${file.name} · categoria → COM NF`,
      tipo: "comprovante_anexado",
      arquivo: file.name,
    }];
  }

  // `.select()` é o que revela a falha silenciosa: sob RLS, um UPDATE que não casa com
  // a policy volta SEM erro e com zero linhas. Sem isto o Hub diz "anexado" e o chip
  // continua SEM NF — exatamente o sintoma que não dá para diagnosticar depois.
  const { data: alteradas, error: updErr } = await supabase
    .from(tabela as any).update(patch as any).eq("id_unico", idUnico).select("id_unico");
  if (updErr || !alteradas?.length) {
    // Não deixa arquivo órfão no bucket quando a linha não aceitou a gravação.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(
      updErr
        ? `Arquivo enviado, mas falhou ao gravar no lançamento: ${comoTexto(updErr)}`
        : `Arquivo enviado, mas nenhuma linha de ${tabela} foi alterada (id_unico ${idUnico}). ` +
          "O banco recusou a gravação em silêncio — quase sempre é a policy de UPDATE (RLS).",
    );
  }

  // Os dois lados da mesma nota: o achado e o lançamento do cartão que o originou.
  // Atualizar só um deixa a outra tela cobrando uma NF que já chegou. Melhor-esforço —
  // o anexo já está gravado e não deve cair por causa disto.
  if (origem === "achado" && idTransacao) {
    const { error } = await supabase.from("auditoria_cartao_lancamentos")
      .update({ status_nf: "OK", link_comprovante: path, arquivo_comprovante: file.name, updated_at: agora })
      .eq("id_unico", idTransacao);
    if (error) console.warn("[anexarComprovante] origem no cartão não atualizada:", error);
  }
  if (origem === "cartao") {
    // Caminho inverso: anexei na Base do Cartão, mas o achado gerado a partir dele
    // continuaria SEM NF na aba Achados.
    const { error } = await supabase.from("auditoria")
      .update({ categoria: "COM NF", link_comprovante: path, updated_at: agora })
      .eq("id_transacao", idUnico);
    if (error) console.warn("[anexarComprovante] achado vinculado não atualizado:", error);
  }

  return {
    ok: true,
    storage_path: path,
    anexado_omie: false,
    arquivo: file.name,
    aviso: "Comprovante guardado. Para mandar ao Omie, use o botão \"Enviar ao Omie\" (precisa de título casado).",
  };
}

/**
 * Anexa o comprovante. Tenta a Edge Function e, se ela ainda não estiver publicada,
 * cai para o upload direto — sem que a pessoa precise saber de nada disso.
 */
export async function anexarComprovante(payload: {
  origem: OrigemAnexo;
  id_unico: string;
  file: File;
  modo?: "acrescentar" | "substituir";
}): Promise<RespostaAnexo> {
  const { origem, id_unico, file, modo } = payload;
  try {
    const base64 = await lerBase64(file);
    return await viaFuncao({ origem, id_unico, nome: file.name, base64, mime: file.type, modo });
  } catch (e: any) {
    const msg = comoTexto(e?.message ?? e);
    if (!funcaoIndisponivel(msg)) throw e instanceof Error ? e : new Error(msg);
    console.info("[anexarComprovante] função indisponível, subindo direto para o bucket:", msg);
    return await viaUploadDireto(origem, id_unico, file);
  }
}
