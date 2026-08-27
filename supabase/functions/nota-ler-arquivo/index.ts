// Edge Function: nota-ler-arquivo
//
// Abre o arquivo que o acervo já guardou e lê o que está DENTRO dele.
//
// Medido em 27/08/2026: **483 notas com arquivo e sem valor**. Elas chegaram
// por caminhos que só olham o lado de fora — o nome do arquivo, o corpo do
// e-mail, a linha da planilha — e quando esses três se calam a nota entra muda.
// Sem valor nenhuma regra do casador alcança, então ela fica `sem_alvo` para
// sempre com o documento ali do lado.
//
// A CAUSA MAIS COMUM É A MOEDA. HubSpot, Datadog e Campbells faturam em dólar e
// não escrevem "R$" em lugar nenhum; `lerCorpoDeEmail` só procurava reais.
// `valorComMoeda` agora lê US$/USD/EUR e a conversão acontece aqui, pela PTAX
// do dia da nota (`cambio_dia`, alimentada da API pública do BCB).
//
// O QUE ELA NÃO FAZ: OCR. PDF que é só imagem sai com texto vazio e fica
// carimbado como lido — quem resolve imagem é a `anexo-triagem`, que já chama o
// Gemini e tem orçamento próprio para isso. Misturar as duas faria esta
// varredura herdar o custo e o teto de CPU daquela.
//
// O CARIMBO É O QUE IMPEDE O LAÇO. `lido_do_arquivo_em` é gravado mesmo quando
// nada foi extraído: sem ele, as mesmas 483 notas voltariam em toda rodada e a
// fila nunca andaria — a mesma lição dos 5 arquivos venenosos que pararam a
// drenagem da pasta "0. Gmail" em 26/08/2026.
//
// Body: { limite?: number, id?: number, releitura?: boolean }
// Cron: header `x-cron-token`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { textoDePdf } from "../_shared/pdf.ts";
import { lerCorpoDeEmail, lerXmlFiscal, valorComMoeda } from "../_shared/nota-fiscal.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
const CNPJ_TAKEAT = "37511891000150";
const ORCAMENTO_MS = 55_000;
/** Acima disto o PDF não vale o worker: `unpdf` carrega o documento inteiro. */
const MAX_BYTES = 8 * 1024 * 1024;

/** A PTAX de venda do BCB, com cache em `cambio_dia`. */
async function cotacao(supabase: any, data: string, moeda: string): Promise<number | null> {
  const { data: emCache } = await supabase.rpc("cambio_do_dia", { p_data: data, p_moeda: moeda });
  if (emCache) return Number(emCache);
  if (moeda !== "USD") return null;   // só o dólar tem série diária simples na API

  /* Pede uma JANELA e não um dia: fim de semana e feriado não têm cotação, e
     pedir "sábado" devolve lista vazia sem dizer por quê. */
  const fim = new Date(`${data}T12:00:00Z`);
  const ini = new Date(fim.getTime() - 8 * 86_400_000);
  const br = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
  const url = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo("
    + "dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)"
    + `?@dataInicial='${br(ini)}'&@dataFinalCotacao='${br(fim)}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const j = await r.json();
    const linhas: { cotacaoVenda: number; dataHoraCotacao: string }[] = j?.value ?? [];
    if (!linhas.length) return null;
    await supabase.from("cambio_dia").upsert(
      linhas.map((l) => ({ data: l.dataHoraCotacao.slice(0, 10), moeda: "USD", venda: l.cotacaoVenda })),
      { onConflict: "data,moeda" },
    );
    const { data: agora } = await supabase.rpc("cambio_do_dia", { p_data: data, p_moeda: moeda });
    return agora ? Number(agora) : null;
  } catch (_) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const cron = req.headers.get("x-cron-token");
    if (cron) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("token").eq("name", "nota-ler-arquivo").maybeSingle();
      if (!data?.token || data.token !== cron) return json({ error: "Token inválido." }, 401);
    } else {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limite = Math.min(Math.max(Number(body?.limite ?? 25), 1), 80);
    const soId = Number(body?.id ?? 0) || null;

    let q = supabase
      .from("notas_externas")
      .select("id, link, arquivo_bucket, enviado_em, vencimento, cnpj, valor, chave_fiscal, nome")
      .eq("tem_arquivo", true)
      .is("ignorado_em", null)
      .limit(limite);
    if (soId) q = q.eq("id", soId);
    else {
      q = q.is("valor", null);
      if (body?.releitura !== true) q = q.is("lido_do_arquivo_em", null);
      /* Quem tem cópia no bucket primeiro: são as que dá para ler agora, e
         gastar a rodada recusando link externo é gastar por nada. */
      q = q.order("arquivo_bucket", { ascending: false, nullsFirst: false });
    }
    const { data: pendentes, error } = await q;
    if (error) throw error;

    const inicio = Date.now();
    let lidos = 0, comValor = 0, emMoeda = 0, semTexto = 0;
    const falhas: { id: number; erro: string }[] = [];

    for (const n of pendentes ?? []) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      /* `arquivo_bucket` ANTES de `link`. Quem veio do Drive tem `link` de
         URL e a CÓPIA no bucket noutra coluna — a `notas-arquivar` copiou 2.654
         arquivos para cá justamente para não depender do OAuth na leitura.
         Olhar só o `link` fazia a varredura recusar todas elas. */
      const caminho = String((n as any).arquivo_bucket || (n as any).link || "");
      const agora = new Date().toISOString();
      const marca: Record<string, unknown> = { lido_do_arquivo_em: agora, atualizado_em: agora };
      try {
        /* Só o que está no BUCKET. Link do Drive precisa do OAuth da caixa e
           tem varredura própria (`notas-arquivar`, que copia para cá); tentar
           daqui duplicaria o consentimento e o modo de falhar. */
        if (/^https?:\/\//i.test(caminho) || !caminho) {
          throw new Error("o arquivo não está no bucket (só link externo)");
        }
        const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(caminho);
        if (dlErr) throw new Error(dlErr.message);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!bytes.length) throw new Error("arquivo vazio");
        if (bytes.length > MAX_BYTES) throw new Error("arquivo grande demais para ler aqui");

        let texto = "";
        if (/\.xml$/i.test(caminho)) {
          texto = new TextDecoder().decode(bytes);
          const x = lerXmlFiscal(texto, CNPJ_TAKEAT);
          if (x) {
            marca.cnpj = (n as any).cnpj ?? x.cnpj ?? null;
            marca.valor = (n as any).valor ?? x.valor ?? null;
            marca.chave_fiscal = (n as any).chave_fiscal ?? x.chave ?? null;
            if (x.valor) { marca.moeda = "BRL"; comValor++; }
          }
        } else {
          const r = await textoDePdf(bytes);
          texto = r.texto ?? "";
          if (!texto.trim()) { semTexto++; marca.leitura_erro = "PDF sem texto (é imagem — a triagem do Gemini resolve)"; }
        }

        /* O MODO DE OLHAR O TEXTO. Sem ele, um valor lido errado só se descobre
           pelo casamento errado lá na frente — e aí já não dá para saber se a
           culpa foi do extrator, do regex ou do documento. */
        if (body?.debug === true) {
          return json({
            ok: true, debug: true, id: (n as any).id, caminho,
            bytes: bytes.length,
            trecho: texto.slice(0, 2500),
            lido: valorComMoeda(texto),
          });
        }

        if (!marca.valor && texto.trim()) {
          const corpo = lerCorpoDeEmail(texto, CNPJ_TAKEAT);
          marca.cnpj = (n as any).cnpj ?? corpo.cnpj ?? null;
          marca.chave_fiscal = (n as any).chave_fiscal ?? corpo.chave ?? null;

          const vm = valorComMoeda(texto);
          if (vm) {
            marca.moeda = vm.moeda;
            marca.valor_moeda = vm.valor;
            if (vm.moeda === "BRL") {
              marca.valor = vm.valor;
              comValor++;
            } else {
              /* A data da NOTA é a âncora do câmbio — não a de hoje. Converter
                 uma invoice de março pela cotação de agosto erraria em 8%,
                 que é justamente a banda inteira de tolerância. */
              const dia = String((n as any).vencimento ?? (n as any).enviado_em ?? "").slice(0, 10);
              const c = dia ? await cotacao(supabase, dia, vm.moeda) : null;
              if (c) {
                marca.valor = Math.round(vm.valor * c * 100) / 100;
                comValor++; emMoeda++;
              } else {
                marca.leitura_erro = `sem cotação de ${vm.moeda} para ${dia || "data desconhecida"}`;
              }
            }
          }
        }

        const { error: upErr } = await supabase.from("notas_externas").update(marca).eq("id", (n as any).id);
        if (upErr) throw new Error(upErr.message);
        lidos++;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 200);
        falhas.push({ id: (n as any).id, erro: msg });
        // Carimba mesmo falhando: é o que impede a nota de voltar toda rodada.
        await supabase.from("notas_externas")
          .update({ lido_do_arquivo_em: agora, leitura_erro: msg, atualizado_em: agora })
          .eq("id", (n as any).id);
      }
    }

    if (comValor > 0) {
      try { await supabase.rpc("notas_externas_casar"); } catch (_) { /* o cron :00/:30 recasa */ }
    }

    return json({
      ok: true,
      candidatas: (pendentes ?? []).length,
      lidos, com_valor: comValor, em_moeda_estrangeira: emMoeda, pdf_sem_texto: semTexto,
      falhas: falhas.slice(0, 8),
      gastou_ms: Date.now() - inicio,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("nota-ler-arquivo:", msg);
    return json({ error: msg }, 200);
  }
});
