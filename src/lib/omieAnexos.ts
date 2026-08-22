import { supabase } from "@/integrations/supabase/client";

// A URL do webhook não é secreta (o browser a chama direto). O Lovable NÃO injeta
// variáveis VITE_* no build publicado — por isso o client do Supabase gerado também
// hardcoda seus valores. Então: usa a env se existir (dev/staging local) e cai no
// valor de produção quando ela não vier (build do Lovable).
const WEBHOOK_URL =
  (import.meta.env.VITE_OMIE_WEBHOOK_URL as string | undefined) ||
  "https://n8n.codless.cloud/webhook/enviar-anexo-omie";

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
  // Lê como texto primeiro: o n8n às vezes responde 200 com corpo VAZIO (nó "Respond to
  // Webhook" ausente ou em "Respond Immediately") — aí res.json() estoura "Unexpected end
  // of JSON input". Damos um erro claro em vez do críptico.
  const raw = await res.text();
  console.info("[omieAnexos] resposta bruta", res.status, raw);
  if (!raw.trim()) {
    throw new Error(
      `O n8n respondeu vazio (HTTP ${res.status}). No fluxo do n8n, termine num nó "Respond to Webhook" ` +
      `devolvendo o JSON { resumo, itens }.`,
    );
  }
  let json: Resposta;
  try {
    json = JSON.parse(raw) as Resposta;
  } catch {
    throw new Error("O n8n respondeu algo que não é JSON: " + raw.slice(0, 200));
  }
  console.info("[omieAnexos] resposta", json?.resumo);
  return json;
}

// Grava controle na tabela certa pelo prefixo do id (CART- = base, ACH- = auditoria).
export async function marcarEnviados(itens: ResItem[]): Promise<void> {
  if (!Array.isArray(itens) || itens.length === 0) return;
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

/* ---------------------------------------------------------------------------
 * O envio de verdade: a Edge Function `omie-anexar-comprovante`, ação "varredura".
 *
 * POR QUE SAIU DO n8n: o webhook recebe um LINK e vai buscar o arquivo. Isso funciona
 * para o comprovante que veio do Drive, e só. Metade dos comprovantes de hoje foi subida
 * pelo próprio Hub e mora no bucket PRIVADO (`link_comprovante` guarda o caminho, não uma
 * URL) — o n8n recebia "hub/ACH-123/1787…_nota.pdf" e não tinha o que baixar. A função
 * enxerga os dois casos, zipa como o Omie exige e CONFIRMA que o anexo colou antes de
 * carimbar `omie_anexo_enviado_em`. O webhook fica aqui para o histórico e para diagnóstico.
 * ------------------------------------------------------------------------- */

type ResumoVarredura = {
  ok?: boolean;
  fila?: number;
  enviados?: number;
  falhas?: number;
  /** quantos ficaram para a próxima rodada porque o worker tem tempo contado */
  parou_por_tempo?: number;
  detalhe_falhas?: { titulo: string; erro: string }[];
  error?: string;
};

async function varrer(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("omie-anexar-comprovante", {
    body: { action: "varredura", ...body },
  });
  if (error) {
    // FunctionsHttpError esconde a mensagem real no corpo — sem isto vira "non-2xx status".
    const corpo = await (error as any)?.context?.text?.().catch(() => "");
    throw new Error(corpo?.slice(0, 400) || error.message);
  }
  const r = data as ResumoVarredura;
  if (r?.error) throw new Error(r.error);
  if (r?.detalhe_falhas?.length) {
    console.warn("[omieAnexos] falhas na varredura", r.detalhe_falhas);
  }
  return {
    total: r?.fila ?? 0,
    enviados: r?.enviados ?? 0,
    restam: r?.parou_por_tempo ?? 0,
    erros: r?.falhas ?? 0,
  };
}

// Massa: por responsável (ou todos os pendentes se pessoa vazio).
export async function enviarProntos(pessoa?: string) {
  return await varrer({ responsavel: pessoa ?? null, limite: 120 });
}

// Unitário: a partir de uma linha já carregada na tela.
export async function enviarUnitario(row: { id_unico: string; omie_cod_titulo: string | number; link_comprovante: string }) {
  return await varrer({ id_unico: row.id_unico, limite: 1 });
}
