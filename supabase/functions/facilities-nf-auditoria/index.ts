// Edge Function: facilities-nf-auditoria
//
// A NF que o pessoal de Facilities anexa no Hub deles passa a valer como evidência
// da Auditoria — para ninguém ter de mandar a mesma nota duas vezes.
//
// Por que uma função e não upload direto do browser: o bucket `comprovantes-auditoria`
// é privado e só tem policy de SELECT (conferido em pg_policies). Escrita exige service
// role. Antes disso a NF ia para `facilities-contratos`, que é PÚBLICO e com leitura
// liberada para `anon` — nota fiscal por link sem login. Aqui ela passa a viver no
// mesmo bucket privado que o resto da auditoria já lê.
//
// O caminho completo de uma nota:
//   anexar → bucket privado → IA transcreve (CNPJ, nº, data, total)
//          → casa com o lançamento auditado → aplica ou propõe
//          → daí em diante é o encanamento que já existe: a conferência da auditoria
//            lê o comprovante e o cron do `omie-anexar-comprovante` sobe ao ERP.
//
// Quem casa com quem, e o que aplica sozinho:
//   valor exato é filtro duro (a compra ou o total lido na nota, ±1 centavo);
//   'exata' = CNPJ da própria nota bate com o do lançamento  → aplica sozinho
//   'alta'  = nome do fornecedor reconhecível + data perto   → aplica sozinho
//   'media'/'baixa'                                          → vira proposta
//   empate no topo                                           → não aplica, propõe
// Falso positivo aqui é pior que casamento nenhum: marcaria um lançamento como
// resolvido com a nota errada. Nos dados reais isso não é hipótese — havia uma compra
// de R$ 30 do "Mercado Livre" empatando em valor com um "WISPRV WISPRFLOW.AI".
//
// Body:
//   { action: "anexar",  compra_id, nome, base64, mime? }
//   { action: "ler",     compra_id }                        // relê a NF
//   { action: "casar",   compra_id }                        // recalcula candidatos
//   { action: "varredura", limite? }                        // cron: notas ainda sem vínculo
//   { action: "aplicar", compra_id, alvo_tipo, alvo_id_unico }
//   { action: "recusar", vinculo_id }
//   { action: "desfazer", vinculo_id }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, GeminiError, DEFAULT_MODEL } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
const MAX_BYTES = 10 * 1024 * 1024;
const EXT_OK = /\.(pdf|jpe?g|png|webp)$/i;
const ORCAMENTO_MS = 55_000;

// A janela é assimétrica de propósito: a compra é registrada no dia em que acontece,
// mas a fatura do cartão e o PIX/boleto caem depois. Mesmos números que a
// `comprovantes-drive-sync` já usa para casar comprovante do Drive.
const DIAS_ANTES = 7;
const DIAS_DEPOIS = 45;

type Candidato = {
  alvo_tipo: string;
  alvo_id_unico: string;
  grupo: string;
  alvo_data: string;
  alvo_valor: number;
  alvo_descricao: string;
  alvo_status: string;
  dias: number;
  nome_score: number;
  documento_bate: boolean;
  score: number;
  confianca: "exata" | "alta" | "media" | "baixa";
  criterio: Record<string, unknown>;
};

/* ------------------------------------------------------------------ leitura da NF */

// Mesmos nomes de campo da leitura da auditoria (_shared/conferencia-comprovante.ts),
// para a transcrição daqui poder ser lida pelo mesmo código lá adiante.
const SCHEMA = {
  type: "object",
  properties: {
    legivel: { type: "boolean" },
    tipo_documento: { type: "string" },
    emitente_nome: { type: "string" },
    emitente_cnpj: { type: "string" },
    valor_total: { type: "number" },
    data_documento: { type: "string" },
    numero_documento: { type: "string" },
    descricao: { type: "string" },
  },
  required: ["legivel", "tipo_documento", "emitente_nome", "valor_total", "descricao"],
};

const SISTEMA =
  `Você transcreve notas fiscais e comprovantes de compra da Takeat. Não julgue nada: ` +
  `apenas copie o que está escrito no documento.\n` +
  `- emitente_cnpj: só dígitos, do EMITENTE (quem vendeu), nunca da Takeat ` +
  `(CNPJ 34.379.049/0001-04 — se aparecer, é o comprador).\n` +
  `- valor_total: o total efetivamente cobrado, com ponto decimal.\n` +
  `- data_documento: AAAA-MM-DD.\n` +
  `- numero_documento: o número da nota/cupom.\n` +
  `- descricao: em uma linha, o que foi comprado.\n` +
  `- legivel: false se não der para ler ou se não for um documento de compra.`;

const MIMES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp",
};

/** Os bytes primeiro; a extensão do nome é palpite. */
function mimeDosBytes(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
const ehHtml = (b: Uint8Array) =>
  /^\s*<(!doctype html|html)/i.test(new TextDecoder().decode(b.slice(0, 200)));

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function lerNota(bytes: Uint8Array, nome: string, mimeDito?: string) {
  const mime = mimeDosBytes(bytes) ?? mimeDito ?? MIMES[(nome.split(".").pop() ?? "").toLowerCase()];
  if (!mime) throw new Error(`não sei ler "${nome}" — use PDF, JPG, PNG ou WEBP`);

  const chamar = () => generateJSON<any>({
    model: DEFAULT_MODEL,
    temperature: 0,
    responseSchema: SCHEMA,
    messages: [
      { role: "system", content: SISTEMA },
      {
        role: "user",
        content: "Transcreva a nota fiscal anexa.",
        imagens: [{ mimeType: mime, data: toBase64(bytes) }],
      },
    ],
  });

  try {
    return await chamar();
  } catch (e) {
    // 503 ("high demand") passa em segundos; cota (429) não se repete.
    if (!(e instanceof GeminiError) || e.status === 429) throw e;
    await new Promise((r) => setTimeout(r, 2500));
    return await chamar();
  }
}

/* ------------------------------------------------------------------ casamento */

/**
 * Casa a NF de uma compra com o que a auditoria ainda cobra.
 * Aplica sozinho só o que é seguro; o resto fica registrado como proposta.
 */
async function casar(supabase: any, compraId: string, por: string) {
  const { data, error } = await supabase.rpc("facilities_nf_candidatos", {
    p_compra_id: compraId,
    p_dias_antes: DIAS_ANTES,
    p_dias_depois: DIAS_DEPOIS,
  });
  if (error) throw new Error(`falha ao buscar candidatos: ${error.message}`);

  const cands = (data ?? []) as Candidato[];
  if (!cands.length) return { aplicado: null, propostas: 0, candidatos: 0 };

  // O MESMO gasto chega em até três linhas: o lançamento do cartão e os achados que
  // nasceram dele (o de "SEM NF" e o de "ESCOPO" convivem). Contá-las como candidatos
  // distintos faria um casamento único parecer ambíguo. `grupo` é a transação.
  //
  // Dentro do grupo escolhemos o lançamento do CARTÃO quando existe: gravar nele
  // propaga para todos os achados daquela transação (facilities_nf_aplicar), enquanto
  // gravar num achado deixaria o achado irmão ainda cobrando a nota.
  const ordem = (t: string) => (t === "cartao" ? 0 : t === "achado" ? 1 : 2);
  const grupos = new Map<string, Candidato>();
  for (const c of cands) {
    const atual = grupos.get(c.grupo);
    if (!atual || ordem(c.alvo_tipo) < ordem(atual.alvo_tipo)) grupos.set(c.grupo, c);
  }
  const unicos = [...grupos.values()].sort((a, b) => b.score - a.score);

  const forte = unicos.filter((c) => c.confianca === "exata" || c.confianca === "alta");

  // Ambíguo não casa: duas transações igualmente fortes viram proposta, como na
  // varredura do Drive. Melhor perguntar do que grudar a nota no lançamento errado.
  if (forte.length === 1) {
    const c = forte[0];
    const { data: v, error: e } = await supabase.rpc("facilities_nf_aplicar", {
      p_compra_id: compraId,
      p_alvo_tipo: c.alvo_tipo,
      p_alvo_id_unico: c.alvo_id_unico,
      p_confianca: c.confianca,
      p_criterio: c.criterio,
      p_score: c.score,
      p_por: por,
    });
    if (e) throw new Error(`falha ao aplicar: ${e.message}`);
    return { aplicado: { ...c, vinculo: v }, propostas: 0, candidatos: unicos.length };
  }

  // Guarda os candidatos como propostas para alguém confirmar na tela da auditoria.
  const propostas = unicos.slice(0, 5).map((c) => ({
    compra_id: compraId,
    alvo_tipo: c.alvo_tipo,
    alvo_id_unico: c.alvo_id_unico,
    confianca: c.confianca,
    criterio: c.criterio,
    score: c.score,
    status: "proposto",
  }));
  const { error: eIns } = await supabase
    .from("facilities_nf_auditoria")
    .upsert(propostas, { onConflict: "compra_id,alvo_tipo,alvo_id_unico", ignoreDuplicates: true });
  if (eIns) throw new Error(`falha ao gravar propostas: ${eIns.message}`);

  return { aplicado: null, propostas: propostas.length, candidatos: unicos.length };
}

/* ------------------------------------------------------------------ handler */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "anexar");

    // A varredura roda por cron; o resto exige gente logada. "parcerias" é o único
    // cargo barrado — o cargo `facilities` PRECISA passar, é ele quem manda a nota.
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "facilities-nf-auditoria").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    let quem = "cron";
    if (!ehCron) {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.email ?? "hub";
    }

    /* ---------------------------------------------------------- anexar */
    if (action === "anexar") {
      const compraId = String(body?.compra_id ?? "").trim();
      const nome = String(body?.nome ?? "nota").slice(0, 120);
      const base64 = String(body?.base64 ?? "");
      if (!compraId || !base64) return json({ error: "Parâmetros faltando (compra_id, base64)." });
      if (!EXT_OK.test(nome)) return json({ error: "Formato inválido. Use PDF, JPG, PNG ou WEBP." });

      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(base64.replace(/^data:[^;]+;base64,/, "")), (c) => c.charCodeAt(0));
      } catch {
        return json({ error: "Arquivo inválido (base64)." });
      }
      if (!bytes.length) return json({ error: "Arquivo vazio." });
      if (bytes.length > MAX_BYTES) return json({ error: "Arquivo maior que 10 MB." });
      if (ehHtml(bytes)) return json({ error: "Isso é uma página HTML, não uma nota. Envie o PDF ou a imagem." });

      const { data: compra, error: eSel } = await supabase
        .from("facilities_compras").select("id, item, valor, data").eq("id", compraId).maybeSingle();
      if (eSel) throw eSel;
      if (!compra) return json({ error: "Compra não encontrada." });

      const seguro = nome.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `facilities/${compraId}/${Date.now()}_${seguro}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: body?.mime ? String(body.mime) : undefined,
        upsert: false,
      });
      if (upErr) return json({ error: `Falha ao guardar o arquivo: ${upErr.message}` });

      const agora = new Date().toISOString();
      const patch: Record<string, unknown> = {
        nf_bucket: BUCKET, nf_arquivo: path, nf_nome: nome,
        nf_enviada_em: agora, nf_enviada_por: quem, nf_status: "ok",
      };

      // Transcrição: é ela que dá o CNPJ, e o CNPJ é o que deixa o casamento aplicar
      // sozinho. Se a IA falhar, a nota NÃO se perde — fica guardada e o casamento
      // acontece por valor + data + nome, só que com confiança menor.
      let leitura: any = null;
      let avisoIa: string | null = null;
      try {
        leitura = await lerNota(bytes, nome, body?.mime ? String(body.mime) : undefined);
        const cnpj = String(leitura?.emitente_cnpj ?? "").replace(/\D/g, "");
        patch.nf_ia = leitura;
        patch.nf_ia_em = agora;
        if (cnpj.length === 14 || cnpj.length === 11) patch.nf_cnpj = cnpj;
        if (leitura?.numero_documento) patch.nf_numero = String(leitura.numero_documento).slice(0, 60);
        if (Number.isFinite(Number(leitura?.valor_total)) && Number(leitura.valor_total) > 0) {
          patch.nf_valor = Number(leitura.valor_total);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(leitura?.data_documento ?? ""))) {
          patch.nf_emissao = leitura.data_documento;
        }
      } catch (e) {
        avisoIa = "Nota guardada, mas não consegui ler o conteúdo: " +
          (e instanceof Error ? e.message : String(e));
      }

      const { error: updErr } = await supabase.from("facilities_compras").update(patch).eq("id", compraId);
      if (updErr) return json({ error: `Arquivo enviado, mas falhou ao gravar: ${updErr.message}` });

      let casamento: any = null;
      let avisoCasa: string | null = null;
      try {
        casamento = await casar(supabase, compraId, quem);
      } catch (e) {
        avisoCasa = e instanceof Error ? e.message : String(e);
      }

      return json({
        ok: true, storage_path: path, leitura, casamento,
        aviso: avisoIa ?? avisoCasa,
      });
    }

    /* ---------------------------------------------------------- ler / casar */
    if (action === "ler" || action === "casar") {
      const compraId = String(body?.compra_id ?? "").trim();
      if (!compraId) return json({ error: "Informe compra_id." });

      if (action === "casar") {
        return json({ ok: true, ...(await casar(supabase, compraId, quem)) });
      }

      const { data: compra } = await supabase
        .from("facilities_compras").select("id, nf_arquivo, nf_nome").eq("id", compraId).maybeSingle();
      if (!compra?.nf_arquivo) return json({ error: "Esta compra não tem NF anexada." });

      const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(compra.nf_arquivo);
      if (dlErr || !blob) return json({ error: `Não consegui abrir o arquivo: ${dlErr?.message ?? "vazio"}` });
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const leitura = await lerNota(bytes, compra.nf_nome ?? "nota.pdf");
      const cnpj = String(leitura?.emitente_cnpj ?? "").replace(/\D/g, "");
      await supabase.from("facilities_compras").update({
        nf_ia: leitura,
        nf_ia_em: new Date().toISOString(),
        nf_cnpj: (cnpj.length === 14 || cnpj.length === 11) ? cnpj : null,
        nf_numero: leitura?.numero_documento ? String(leitura.numero_documento).slice(0, 60) : null,
        nf_valor: Number(leitura?.valor_total) > 0 ? Number(leitura.valor_total) : null,
        nf_emissao: /^\d{4}-\d{2}-\d{2}$/.test(String(leitura?.data_documento ?? "")) ? leitura.data_documento : null,
      }).eq("id", compraId);

      return json({ ok: true, leitura });
    }

    /* ---------------------------------------------------------- varredura (cron) */
    if (action === "varredura") {
      const limite = Math.min(Number(body?.limite ?? 10) || 10, 40);
      // Notas já anexadas que ainda não têm vínculo aplicado com a auditoria.
      const { data: comAplicado } = await supabase
        .from("facilities_nf_auditoria").select("compra_id").eq("status", "aplicado");
      const jaResolvidas = new Set((comAplicado ?? []).map((r: any) => r.compra_id));

      const { data: compras } = await supabase
        .from("facilities_compras")
        .select("id")
        .not("nf_arquivo", "is", null)
        .order("data", { ascending: false })
        .limit(200);

      const fila = (compras ?? []).filter((c: any) => !jaResolvidas.has(c.id)).slice(0, limite);
      const inicio = Date.now();
      let aplicados = 0, propostas = 0, erros = 0, restam = 0;

      for (let i = 0; i < fila.length; i++) {
        if (Date.now() - inicio > ORCAMENTO_MS) { restam = fila.length - i; break; }
        try {
          const r = await casar(supabase, fila[i].id, "cron");
          if (r.aplicado) aplicados++;
          propostas += r.propostas;
        } catch (_) { erros++; }
      }
      return json({ ok: true, fila: fila.length, aplicados, propostas, erros, restam });
    }

    /* ---------------------------------------------------------- aplicar proposta */
    if (action === "aplicar") {
      const compraId = String(body?.compra_id ?? "").trim();
      const alvoTipo = String(body?.alvo_tipo ?? "").trim();
      const alvoId = String(body?.alvo_id_unico ?? "").trim();
      if (!compraId || !alvoTipo || !alvoId) {
        return json({ error: "Parâmetros faltando (compra_id, alvo_tipo, alvo_id_unico)." });
      }
      const { data, error } = await supabase.rpc("facilities_nf_aplicar", {
        p_compra_id: compraId,
        p_alvo_tipo: alvoTipo,
        p_alvo_id_unico: alvoId,
        p_confianca: String(body?.confianca ?? "media"),
        p_criterio: body?.criterio ?? {},
        p_score: body?.score ?? null,
        p_por: quem,
      });
      if (error) return json({ error: error.message });
      return json({ ok: true, vinculo: data });
    }

    /* ---------------------------------------------------------- recusar / desfazer */
    if (action === "recusar") {
      const id = Number(body?.vinculo_id);
      if (!id) return json({ error: "Informe vinculo_id." });
      const { error } = await supabase.from("facilities_nf_auditoria")
        .update({ status: "recusado", decidido_em: new Date().toISOString(), decidido_por: quem })
        .eq("id", id);
      if (error) return json({ error: error.message });
      return json({ ok: true });
    }

    if (action === "desfazer") {
      const id = Number(body?.vinculo_id);
      if (!id) return json({ error: "Informe vinculo_id." });
      const { data, error } = await supabase.rpc("facilities_nf_desfazer", {
        p_vinculo_id: id, p_por: quem,
      });
      if (error) return json({ error: error.message });
      return json({ ok: true, vinculo: data });
    }

    return json({ error: `Ação desconhecida: ${action}` });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
});
