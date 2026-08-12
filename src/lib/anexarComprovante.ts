import { supabase } from "@/integrations/supabase/client";

/**
 * Anexar comprovante/NF a um lançamento da Auditoria direto pelo Hub.
 *
 * O upload NÃO vai do browser para o bucket: `comprovantes-auditoria` é privado e
 * quem grava é a Edge Function `auditoria-anexar-comprovante` (service role). Ela
 * guarda o arquivo, escreve o CAMINHO em `link_comprovante` e — se o lançamento já
 * tem título casado no Omie — manda o anexo para o ERP na mesma chamada.
 */

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
  /** guardou o comprovante, mas o Omie não recebeu (sem título casado ou recusou). */
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

export async function anexarComprovante(payload: {
  origem: OrigemAnexo;
  id_unico: string;
  nome: string;
  base64: string;
  mime?: string;
  modo?: "acrescentar" | "substituir";
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
    if (/not found|Failed to (send|fetch)/i.test(detalhe)) {
      throw new Error("A função auditoria-anexar-comprovante ainda não foi publicada no Supabase (deploy pendente pelo Lovable).");
    }
    throw new Error(detalhe || "Erro no backend.");
  }
  if ((data as any)?.error) throw new Error(comoTexto((data as any).error));
  return (data ?? {}) as RespostaAnexo;
}
