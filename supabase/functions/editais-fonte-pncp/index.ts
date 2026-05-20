import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient, upsertEditais, type RawEdital } from "../_shared/normalize.ts";
import { loadFilterSettings } from "../_shared/relevance.ts";

// PNCP — fonte SECUNDÁRIA. Filtra hard por palavras positivas tech antes de upsert.
const FONTE = "PNCP";
const SLUG = "pncp";
const BASE = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";

// Palavras positivas tech-food usadas para pré-filtro (não polui o radar com obras/limpeza)
const POSITIVE = [
  "software","sistema","plataforma","saas","inteligencia artificial","ia ","ia,",
  "automacao","automação","analytics","dado","business intelligence"," bi "," bi,","erp",
  "aplicativo"," app ","tecnologia","transformacao digital","transformação digital",
  "atendimento digital","cardapio digital","cardápio digital","delivery","restaurante",
  "food service","foodtech","autoatendimento","gestao","gestão",
];
const NEGATIVE = [
  "obra","engenharia","construcao","construção","reforma","pavimentacao","pavimentação",
  "limpeza","vigilancia","vigilância","merenda","alimentacao escolar","alimentação escolar",
  "combustivel","combustível","medicamento","veiculo","veículo","manutencao predial",
  "manutenção predial","material de expediente","material de limpeza","locacao de maquinas",
  "transporte escolar","uniforme","pneus","peças automotivas","pecas automotivas",
];

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function todayYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function fetchPage(dataFinal: string, pagina: number, codigoModalidade: number) {
  const url = `${BASE}?dataFinal=${dataFinal}&codigoModalidadeContratacao=${codigoModalidade}&pagina=${pagina}&tamanhoPagina=50`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`PNCP HTTP ${r.status}`);
    return { url, json: await r.json() };
  } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  const errors: unknown[] = [];
  const urlsConsultadas: string[] = [];
  let capturados = 0;
  let descartados = 0;

  try {
    const supa = getServiceClient();
    const settings = await loadFilterSettings(supa);
    const dataFinal = todayYmd(new Date(Date.now() + 60 * 86400000));
    const raws: RawEdital[] = [];

    // Modalidades 6 (pregão eletrônico) e 8 (dispensa eletrônica) — mais frequentes para tech
    for (const mod of [6, 8]) {
      try {
        const { url, json } = await fetchPage(dataFinal, 1, mod);
        urlsConsultadas.push(url);
        const items: any[] = json?.data ?? [];
        capturados += items.length;
        for (const it of items) {
          const titulo = it.objetoCompra ?? it.objeto ?? "";
          const text = norm(`${titulo} ${it.informacaoComplementar ?? ""}`);

          // Hard filter: descarta se tiver muita palavra negativa OU nenhuma positiva
          const negHits = NEGATIVE.filter(k => text.includes(norm(k))).length;
          const posHits = POSITIVE.filter(k => text.includes(norm(k))).length;
          if (negHits >= 2 && posHits === 0) { descartados++; continue; }
          if (posHits === 0) { descartados++; continue; }

          raws.push({
            external_id: String(it.numeroControlePNCP ?? `${it.orgaoEntidade?.cnpj ?? ""}-${it.numeroCompra ?? ""}`),
            titulo: String(titulo).slice(0, 500),
            orgao: it.orgaoEntidade?.razaoSocial ?? null,
            modalidade: it.modalidadeNome ?? null,
            numero: it.numeroCompra ?? null,
            objeto: it.informacaoComplementar ?? titulo,
            valor_estimado: Number(it.valorTotalEstimado ?? 0),
            data_publicacao: (it.dataPublicacaoPncp ?? "").slice(0, 10) || null,
            data_abertura: (it.dataAberturaProposta ?? "").slice(0, 10) || null,
            prazo_envio: (it.dataEncerramentoProposta ?? "").slice(0, 10) || null,
            link: it.numeroControlePNCP ? `https://pncp.gov.br/app/editais/${it.numeroControlePNCP}` : null,
            regiao: it.unidadeOrgao?.ufSigla ? mapUfRegiao(it.unidadeOrgao.ufSigla) : null,
            fonte: FONTE,
            fonte_slug: SLUG,
          });
        }
      } catch (e) {
        errors.push({ modalidade: mod, error: String(e) });
      }
    }

    const { novos, duplicados, ocultados } = await upsertEditais(supa, raws, [], SLUG, settings);

    return new Response(JSON.stringify({
      ok: true, fonte: SLUG, capturados, novos, duplicados,
      descartados_filtro: descartados, ocultados,
      urls_consultadas: urlsConsultadas,
      mensagem: `Pré-filtrados: ${descartados}/${capturados}. ${novos} novos visíveis, ${ocultados} ocultos por baixa relevância.`,
      duracao_ms: Date.now() - started, erros: errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, fonte: SLUG, error: String(e), erros: errors, urls_consultadas: urlsConsultadas, duracao_ms: Date.now() - started }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function mapUfRegiao(uf: string): string {
  const r: Record<string, string> = {
    AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
    AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste", PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
    DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
    ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
    PR: "Sul", RS: "Sul", SC: "Sul",
  };
  return r[uf] ?? "Nacional";
}
