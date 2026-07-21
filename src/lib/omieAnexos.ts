import { supabase } from "@/integrations/supabase/client";

const WEBHOOK_URL = import.meta.env.VITE_OMIE_WEBHOOK_URL as string;

export type ItemEnvio = { idAuditoria: string; nId: number; driveLink: string; nomeArquivo?: string };
export type ResItem = { idAuditoria: string; nId: number; status: "ENVIADO" | "JA_ENVIADO" | "ERRO"; detalhe: string };
export type Resposta = { resumo: { total: number; enviados: number; jaEnviados: number; erros: number }; itens: ResItem[] };

// Lê das DUAS fontes: base do cartão (gestor) + achados (responsavel).
// pessoa opcional: filtra por titular no envio em massa.
export async function buscarProntos(pessoa?: string): Promise<ItemEnvio[]> {
  let base = supabase.from("auditoria_cartao_lancamentos")
    .select("id_unico, gestor, omie_cod_titulo, link_comprovante")
    .not("link_comprovante", "is", null)
    .not("omie_cod_titulo", "is", null)
    .is("omie_anexo_enviado_em", null);

  let ach = supabase.from("auditoria")
    .select("id_unico, responsavel, omie_cod_titulo, link_comprovante")
    .not("link_comprovante", "is", null)
    .not("omie_cod_titulo", "is", null)
    .is("omie_anexo_enviado_em", null);

  if (pessoa) { base = base.eq("gestor", pessoa); ach = ach.eq("responsavel", pessoa); }

  const [rb, ra] = await Promise.all([base, ach]);
  if (rb.error) throw rb.error;
  if (ra.error) throw ra.error;

  return [...(rb.data || []), ...(ra.data || [])].map((r: any) => ({
    idAuditoria: r.id_unico,
    nId: Number(r.omie_cod_titulo),
    driveLink: r.link_comprovante,
  }));
}

export async function enviarAoOmie(items: ItemEnvio[]): Promise<Resposta> {
  if (!items.length) return { resumo: { total: 0, enviados: 0, jaEnviados: 0, erros: 0 }, itens: [] };
  // Causa nº 1 de "o botão não chama o fluxo": a env não foi carregada (dev server não reiniciado
  // depois de editar o .env). Falha alto em vez de fazer um fetch para uma URL "undefined".
  if (!WEBHOOK_URL) {
    throw new Error("VITE_OMIE_WEBHOOK_URL não configurada — reinicie o dev server (npm run dev) após editar o .env.");
  }
  console.info("[omieAnexos] POST", WEBHOOK_URL, `(${items.length} item(s))`, items);
  let res: Response;
  try {
    res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  } catch (e: any) {
    // Erro de rede/CORS: o browser bloqueia antes de qualquer status HTTP.
    console.error("[omieAnexos] fetch falhou (rede/CORS):", e);
    throw new Error("Não foi possível chamar o webhook do n8n (rede ou CORS): " + (e?.message ?? String(e)));
  }
  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    console.error("[omieAnexos] webhook HTTP", res.status, corpo);
    throw new Error(`Webhook falhou: ${res.status}${corpo ? " · " + corpo.slice(0, 300) : ""}`);
  }
  const json = (await res.json()) as Resposta;
  console.info("[omieAnexos] resposta", json?.resumo);
  return json;
}

// Grava controle na tabela certa pelo prefixo do id (CART- = base, ACH- = auditoria).
export async function marcarEnviados(itens: ResItem[]): Promise<void> {
  const now = new Date().toISOString();
  const pick = (re: RegExp) =>
    itens.filter((i) => re.test(i.idAuditoria) && (i.status === "ENVIADO" || i.status === "JA_ENVIADO"))
         .map((i) => i.idAuditoria);

  const okBase = pick(/^CART-/);
  const okAch = pick(/^ACH-/);

  if (okBase.length) {
    const { error } = await supabase.from("auditoria_cartao_lancamentos")
      .update({ omie_anexo_enviado_em: now }).in("id_unico", okBase);
    if (error) console.error("writeback base falhou (verificar RLS):", error);
  }
  if (okAch.length) {
    const { error } = await supabase.from("auditoria")
      .update({ omie_anexo_enviado_em: now }).in("id_unico", okAch);
    if (error) console.error("writeback auditoria falhou (verificar RLS):", error);
  }
}

// Massa: por responsável (ou todos os pendentes se pessoa vazio).
export async function enviarProntos(pessoa?: string) {
  const items = await buscarProntos(pessoa);
  const r = await enviarAoOmie(items);
  await marcarEnviados(r.itens);
  return r.resumo;
}

// Unitário: a partir de uma linha já carregada na tela.
export async function enviarUnitario(row: { id_unico: string; omie_cod_titulo: string | number; link_comprovante: string }) {
  const r = await enviarAoOmie([{
    idAuditoria: row.id_unico,
    nId: Number(row.omie_cod_titulo),
    driveLink: row.link_comprovante,
  }]);
  await marcarEnviados(r.itens);
  return r.resumo;
}
