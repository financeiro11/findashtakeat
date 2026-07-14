import { supabase } from "@/integrations/supabase/client";

/**
 * Resolução de comprovantes da auditoria.
 *
 * A coluna `link_comprovante` guarda coisas DIFERENTES conforme a origem:
 *   • auditoria.link_comprovante (achado do n8n) → CAMINHO no storage privado
 *     ex.: "f69588ff.../ACH-202606-NF-.../1783626823462_nota-....pdf"
 *   • auditoria_cartao_lancamentos.link_comprovante → URL http de verdade (Drive)
 *   • auditoria_cartao_lancamentos.arquivo_comprovante → só o NOME do arquivo
 *     ex.: "ComprovanteLinkRede (Pixpel 1a parcela).pdf" — não dá para abrir nada
 *
 * Jogar qualquer um deles direto num <a href> só funciona no 2º caso: os outros viram
 * caminho relativo e o SPA engole o clique. Daí este módulo.
 */

const BUCKET = "comprovantes-auditoria"; // privado → precisa de signed URL
const TTL_SEGUNDOS = 60 * 10;

export const ehUrl = (v?: string | null): boolean => !!v && /^https?:\/\//i.test(v.trim());

/** Caminho de storage tem pasta/arquivo. Um nome solto ("nota.pdf") não é resolvível. */
export const ehCaminhoStorage = (v?: string | null): boolean =>
  !!v && !ehUrl(v) && v.trim().includes("/");

/** Só vale mostrar o link se der para chegar em algum lugar. */
export const podeAbrirComprovante = (v?: string | null): boolean => ehUrl(v) || ehCaminhoStorage(v);

/** URL http → ela mesma. Caminho de storage → signed URL temporária. */
export async function resolverComprovante(valor: string): Promise<string> {
  const v = valor.trim();
  if (ehUrl(v)) return v;

  const path = v.replace(/^\/+/, "");
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, TTL_SEGUNDOS);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Não consegui gerar o link do comprovante.");
  }
  return data.signedUrl;
}
