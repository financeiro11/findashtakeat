import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enrichEdital } from "./ai-stub.ts";
import { makeHash } from "./dedupe.ts";
import { calculateEditalRelevance, FilterSettings, loadFilterSettings } from "./relevance.ts";

export interface RawEdital {
  external_id?: string | null;
  titulo: string;
  orgao?: string | null;
  modalidade?: string | null;
  numero?: string | null;
  objeto?: string | null;
  valor_estimado?: number | null;
  data_publicacao?: string | null;
  data_abertura?: string | null;
  prazo_envio?: string | null;
  link?: string | null;
  regiao?: string | null;
  fonte: string;
  /** slug da fonte usada para boosts (ex: "pncp", "fapes") */
  fonte_slug?: string;
}

export interface UpsertResult {
  novos: number;
  duplicados: number;
  ocultados: number;
}

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function upsertEditais(
  supa: SupabaseClient,
  raws: RawEdital[],
  _keywords: string[],
  fonteSlug?: string,
  settingsOverride?: FilterSettings,
): Promise<UpsertResult> {
  let novos = 0, duplicados = 0, ocultados = 0;
  const settings = settingsOverride ?? await loadFilterSettings(supa);

  for (const r of raws) {
    const slug = (r.fonte_slug ?? fonteSlug ?? r.fonte ?? "").toLowerCase();
    const enrich = enrichEdital({ titulo: r.titulo, objeto: r.objeto, orgao: r.orgao });
    const hash = await makeHash(r.titulo, r.orgao, r.data_publicacao);

    const rel = calculateEditalRelevance({
      titulo: r.titulo,
      objeto: r.objeto,
      resumo_ia: enrich.resumo_ia,
      orgao: r.orgao,
      modalidade: r.modalidade,
      regiao: r.regiao,
      prazo_envio: r.prazo_envio,
      fonte: r.fonte,
      fonte_slug: slug,
    }, settings);

    if (rel.visibility_status !== "visivel") ocultados++;

    const row = {
      titulo: r.titulo,
      orgao: r.orgao ?? null,
      modalidade: r.modalidade ?? null,
      numero: r.numero ?? null,
      objeto: r.objeto ?? null,
      valor_estimado: r.valor_estimado ?? 0,
      data_publicacao: r.data_publicacao ?? null,
      data_abertura: r.data_abertura ?? null,
      prazo_envio: r.prazo_envio ?? null,
      link: r.link ?? null,
      regiao: r.regiao ?? null,
      fonte: r.fonte,
      external_id: r.external_id ?? null,
      hash_dedupe: hash,
      categoria: enrich.categoria,
      resumo_ia: enrich.resumo_ia,
      match_score: rel.score,
      data_captura: new Date().toISOString(),
      status: "Em análise",
      pipeline_stage: "Encontrado",
      prioridade: rel.score >= 75 ? "Alta" : rel.score >= 50 ? "Média" : "Baixa",
      visibility_status: rel.visibility_status,
      relevance_reason: rel.relevance_reason,
      exclusion_reason: rel.exclusion_reason,
      source_priority: rel.source_priority,
      opportunity_type: rel.opportunity_type,
    };

    // Dedupe: sempre cheque hash (mesmo título+órgão = mesmo edital, ainda que URLs diferentes)
    const { data: byHash } = await supa.from("editais").select("id, link, external_id").eq("hash_dedupe", hash).maybeSingle();
    if (byHash) {
      // Preserva o melhor link (mais específico, não a página de listagem)
      const keepLink = (row.link && !/\/noticias\/?$/i.test(row.link)) ? row.link : (byHash.link ?? row.link);
      await supa.from("editais").update({ ...row, link: keepLink }).eq("id", byHash.id);
      duplicados++;
      continue;
    }
    if (r.external_id) {
      const { data: existing } = await supa.from("editais").select("id").eq("fonte", r.fonte).eq("external_id", r.external_id).maybeSingle();
      if (existing) {
        await supa.from("editais").update(row).eq("id", existing.id);
        duplicados++;
        continue;
      }
    }

    const { error } = await supa.from("editais").insert(row);
    if (!error) novos++;
  }

  return { novos, duplicados, ocultados };
}
