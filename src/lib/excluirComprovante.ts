import { supabase } from "@/integrations/supabase/client";

/**
 * Excluir um comprovante enviado errado, pela Edge Function
 * `auditoria-excluir-comprovante`.
 *
 * São duas chamadas de propósito: a prévia só lê (o arquivo do Hub e os anexos
 * do título no Omie), e a exclusão apaga o que a pessoa marcou. Apagar no Omie
 * não tem desfazer — por isso não existe "apague tudo do título".
 *
 * Diferente do anexar, aqui NÃO há caminho de reserva pelo navegador: sem a
 * função, o Hub tiraria o arquivo da linha e deixaria o errado dentro do ERP.
 */

export type OrigemExclusao = "achado" | "cartao" | "pix";

export type AnexoParaEscolher = {
  nome: string;
  /** o nome bate com o que o Hub mandou — vem pré-marcado */
  do_hub: boolean;
  repetido: boolean;
  sem_id: boolean;
};

export type PreviaExclusao = {
  hub: { arquivo: string | null; no_bucket: boolean } | null;
  omie: { cod_titulo: string; lido: boolean; erro: string | null; anexos: AnexoParaEscolher[] } | null;
};

export type ResultadoExclusao = {
  hub_removido: boolean;
  omie: {
    removidos: string[];
    falhas: string[];
    restantes: string[];
    /** a releitura do título, quando houve exclusão no Omie */
    depois: { qtd: number; parece_nota: boolean | null; lido_em: string } | null;
  };
  /** o lançamento ficou sem papel nenhum (Hub e Omie) */
  sem_papel: boolean;
  /** a aprovação automática foi desfeita — o status para onde voltou */
  status_novo: string | null;
  aviso: string | null;
};

const comoTexto = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  const o = v as { message?: string; details?: string; hint?: string };
  return [o.message, o.details, o.hint].filter(Boolean).join(" — ") || (() => {
    try { return JSON.stringify(v); } catch { return String(v); }
  })();
};

async function invocar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("auditoria-excluir-comprovante", { body });
  if (error) {
    // FunctionsHttpError esconde o erro real no corpo (error.context).
    let detalhe = comoTexto(error.message);
    const ctx = (error as { context?: { text?: () => Promise<string> } }).context;
    if (ctx && typeof ctx.text === "function") {
      try {
        const raw = await ctx.text();
        detalhe = comoTexto((JSON.parse(raw) as { error?: unknown } | null)?.error) || raw || detalhe;
      } catch { /* keep */ }
    }
    if (/not found|Failed to (send|fetch)|404/i.test(detalhe)) {
      throw new Error("A função auditoria-excluir-comprovante ainda não foi publicada no Supabase (deploy pendente).");
    }
    throw new Error(detalhe || "Erro no backend.");
  }
  const erro = (data as { error?: unknown } | null)?.error;
  if (erro) throw new Error(comoTexto(erro));
  return (data ?? {}) as T;
}

export const previaExclusao = (origem: OrigemExclusao, id_unico: string) =>
  invocar<PreviaExclusao>({ origem, id_unico });

export const excluirComprovante = (origem: OrigemExclusao, id_unico: string, omie_nomes: string[]) =>
  invocar<ResultadoExclusao>({ origem, id_unico, omie_nomes, aplicar: true });
