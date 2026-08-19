// Edge Function: auditoria-conferir-comprovante
//
// Lê o comprovante que a pessoa mandou e diz se ele explica o gasto — para o
// financeiro parar de abrir PDF por PDF só para ver se o número da nota é o
// número da fatura.
//
// DUAS AÇÕES, DE PROPÓSITO SEPARADAS:
//   • "conferir" — baixa o arquivo, manda para o Gemini, aplica a regra e GRAVA
//     a leitura + o veredito. Não mexe em status de ninguém.
//   • "aplicar"  — aprova os que já foram conferidos com veredito "aprovar".
//     Não chama IA nenhuma: relê o que está gravado, confere que o arquivo é o
//     mesmo que foi lido e muda o status. Aprovar não custa cota.
//
// A separação é o que permite a tela mostrar a lista antes de aprovar, e o que
// impede uma releitura acidental de gastar as requisições do dia.
//
// QUEM APROVA É A REGRA, NÃO A IA. O veredito do modelo vale como ponteiro
// ("o que foi cobrado é o total" / "é a linha Taxa de Embarque") e a conta é
// refeita em _shared/conferencia-comprovante.ts em cima do que ele mesmo
// transcreveu. Sem um número transcrito igual à cobrança, não há aprovação.
//
// COTA: com faturamento ligado no projeto do Gemini não há mais teto diário, mas
// o limite por minuto continua existindo — um 429 encerra a rodada com
// `quota_esgotada: true` em vez de estourar, e o que já foi lido fica gravado.
//
// Body:
//   { action?: "conferir" | "aplicar",
//     competencia?: "AAAA-MM-DD",   // a fatura da tela
//     ids?: number[],               // achados específicos (drawer / seleção)
//     limite?: number,              // teto da rodada (padrão 6, máx 10)
//     reler?: boolean }             // relê mesmo o que já tem leitura
//
// Resposta:
//   { ok, acao, lidos, aprovaveis, para_revisar, aprovados, restantes,
//     quota_esgotada, itens: [...], erros: [...] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, GeminiError, DEFAULT_MODEL } from "../_shared/gemini.ts";
import { ehHtml } from "../_shared/drive.ts";
import {
  chaveDocumento, conferir, type Leitura, type Veredito,
} from "../_shared/conferencia-comprovante.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";

/** Status em que ainda faz sentido conferir. Aprovado/Reprovado já foi decidido. */
const STATUS_ABERTOS = ["Pendente", "Em análise", "Ajuste solicitado"];

/* Cada leitura leva de 10 a 15 segundos e o worker é derrubado com
   WORKER_RESOURCE_LIMIT bem antes do que a conta ingênua sugere: uma rodada de
   dez documentos morreu aos ~100s, no sétimo. Por isso são DOIS freios, e o
   relógio é o que manda — documento pesado gasta mais que documento leve, e
   contar cabeças não protege de nada.

   Nada se perde quando a rodada acaba no meio: cada leitura é gravada assim que
   sai, e o que sobrou continua na fila para o próximo "Ler mais". */
const LIMITE_PADRAO = 6;
const LIMITE_MAX = 10;
const ORCAMENTO_MS = 75_000;
const MAX_BYTES = 8 * 1024 * 1024; // acima disto o base64 não cabe na chamada

const MIMES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp",
};

const ehUrl = (v?: string | null) => !!v && /^https?:\/\//i.test(v.trim());
const nomeDoPath = (p: string) => p.split("/").pop() || "comprovante";

function mimeDe(nome: string): string | null {
  const ext = (nome.split("?")[0].split(".").pop() || "").toLowerCase();
  return MIMES[ext] ?? null;
}

function toBase64(bytes: Uint8Array): string {
  // Em pedaços: `String.fromCharCode(...bytes)` de um PDF de 2 MB estoura a pilha.
  let bin = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    bin += String.fromCharCode(...bytes.subarray(i, i + passo));
  }
  return btoa(bin);
}

/* -------------------------------------------------------------------------
 * O que se pede ao modelo
 * ---------------------------------------------------------------------- */

/* A ordem das propriedades importa: o modelo preenche o schema de cima para
   baixo, então tudo o que é TRANSCRIÇÃO vem antes de qualquer julgamento. Ele
   escreve o que está no papel primeiro e só depois olha para o lançamento. */
const SCHEMA = {
  type: "object",
  properties: {
    legivel: { type: "boolean" },
    tipo_documento: { type: "string" },
    emitente_nome: { type: "string" },
    emitente_cnpj: { type: "string" },
    valor_total: { type: "number" },
    valores: {
      type: "array",
      items: {
        type: "object",
        properties: { rotulo: { type: "string" }, valor: { type: "number" } },
        required: ["rotulo", "valor"],
      },
    },
    data_documento: { type: "string" },
    numero_documento: { type: "string" },
    descricao: { type: "string" },
    observacao: { type: "string" },
    fornecedor_confere: { type: "string", enum: ["sim", "nao", "incerto"] },
    fornecedor_motivo: { type: "string" },
    cobranca_explicada: { type: "string", enum: ["total", "item", "nao"] },
    item_rotulo: { type: "string" },
  },
  required: [
    "legivel", "tipo_documento", "emitente_nome", "valor_total", "valores",
    "descricao", "fornecedor_confere", "cobranca_explicada",
  ],
};

const SISTEMA = `Você confere comprovantes de despesa de uma empresa brasileira (Takeat) contra a
cobrança que apareceu na fatura do cartão corporativo.

PRIMEIRO TRANSCREVA, DEPOIS JULGUE. Preencha os campos de transcrição olhando só para o
documento. Nunca invente um valor que não está escrito nele — se o número da cobrança não
aparece no papel, o certo é dizer que não aparece.

TRANSCRIÇÃO
- emitente_nome: quem VENDEU / PRESTOU o serviço / emitiu o documento. Nunca o comprador:
  Takeat, Takeat Tecnologia, o CNPJ 34.379.049/0001-04 e a pessoa física nomeada como
  passageiro, destinatário ou portador do cartão são o COMPRADOR. Em bilhete aéreo o
  emitente é a companhia; em fatura de plataforma, a plataforma ou o vendedor indicado nela.
- valor_total: o valor final a pagar do documento. Sem total explícito, 0.
- valores: TODO valor monetário do documento com o rótulo que o acompanha ("Tarifa",
  "Taxa de embarque", "Total", "Gorjeta", "Valor do ICMS", "Parcela 1/3"...). É por esta
  lista que se acha a parcela ou a taxa que virou uma cobrança separada na fatura.
- data_documento: emissão em AAAA-MM-DD; vazio se não houver.
- numero_documento: número da nota / do recibo / da fatura; vazio se não houver.
- descricao: uma frase curta em português dizendo o que foi comprado.
- legivel: false se estiver ilegível, cortado, ou se não for um comprovante de despesa
  (print de painel, foto de tela, conversa de WhatsApp, cardápio).

JULGAMENTO
- fornecedor_confere: "sim" quando o emitente do documento é o mesmo estabelecimento da
  cobrança. O texto da fatura vem abreviado e sujo, com maquininha e cidade no meio
  ("ZIG*Fazenda Churrasc Sao Paulo", "DM *hostingercom Lanarca", "LATAM AIR*0000V"), e a
  nota traz a razão social ("FC COMERCIO DE ALIMENTOS E BEBIDAS LTDA", "Hostinger
  International Ltd.", "TAM Linhas Aéreas S.A."). Marca, razão social e nome de fantasia
  do mesmo negócio contam como o mesmo fornecedor. Na dúvida, "incerto" — nunca "sim".
- fornecedor_motivo: uma frase curta explicando, quando não for "sim".
- cobranca_explicada: "total" se a cobrança é o valor total do documento; "item" se é uma
  das linhas dele (a fatura cobra a taxa de embarque em separado da tarifa, ou uma parcela
  em separado do total); "nao" se o valor cobrado não aparece no documento.
- item_rotulo: com "item", o rótulo EXATO da linha, copiado de valores.

Responda apenas o JSON.`;

/* -------------------------------------------------------------------------
 * Leitura de um documento
 * ---------------------------------------------------------------------- */

/** 429 do Gemini. `porDia` separa a cota diária (acabou, volta amanhã) da cota
 *  por minuto (é só esperar um pouco e clicar de novo) — a tela diz coisas
 *  diferentes para cada uma. */
class ErroCota extends Error {
  porDia: boolean;
  constructor(detalhe: string) {
    super(detalhe);
    this.porDia = /PerDay/i.test(detalhe) || !/PerMinute/i.test(detalhe);
  }
}

/** Tropeço do serviço de IA (5xx, rede, modelo fora do ar), não do documento.
 *  A diferença decide o destino do achado: documento ruim é carimbado "revisar"
 *  e sai da fila; serviço fora do ar continua na fila para a próxima rodada —
 *  carimbar aqui seria condenar uma nota boa por causa de um soluço da Google. */
class ErroServico extends Error {}

async function baixar(
  supabase: ReturnType<typeof createClient>,
  comprovante: string,
): Promise<{ bytes: Uint8Array; nome: string }> {
  if (ehUrl(comprovante)) {
    const r = await fetch(comprovante);
    if (!r.ok) throw new Error(`o link do comprovante respondeu ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { bytes, nome: nomeDoPath(new URL(comprovante).pathname) };
  }
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(comprovante.replace(/^\/+/, ""));
  if (error || !blob) throw new Error(`não consegui baixar o arquivo (${error?.message ?? "não encontrado"})`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), nome: nomeDoPath(comprovante) };
}

async function lerComprovante(
  supabase: ReturnType<typeof createClient>,
  comprovante: string,
  lanc: { titulo: string; valor: number; data: string },
): Promise<Leitura> {
  const { bytes, nome } = await baixar(supabase, comprovante);
  if (!bytes.length) throw new Error("o arquivo está vazio");
  if (bytes.length > MAX_BYTES) throw new Error(`o arquivo tem ${(bytes.length / 1048576).toFixed(1)} MB — acima do que cabe na leitura`);
  // Página de erro do Drive salva como "comprovante.pdf" é o engano mais comum.
  if (ehHtml(bytes)) throw new Error("o arquivo é uma página HTML, não um comprovante");

  const mime = mimeDe(nome) ?? mimeDe(comprovante);
  if (!mime) throw new Error(`não sei ler "${nome}" (use PDF, JPG, PNG ou WEBP)`);

  const pergunta =
    `Cobrança a conferir:\n` +
    `- texto na fatura do cartão: ${lanc.titulo}\n` +
    `- valor cobrado: R$ ${lanc.valor.toFixed(2).replace(".", ",")}\n` +
    `- data do gasto: ${String(lanc.data).slice(0, 10)}\n\n` +
    `Transcreva o documento anexo e depois julgue.`;

  const chamar = () => generateJSON<Leitura>({
    model: DEFAULT_MODEL,
    temperature: 0,
    responseSchema: SCHEMA,
    messages: [
      { role: "system", content: SISTEMA },
      { role: "user", content: pergunta, imagens: [{ mimeType: mime, data: toBase64(bytes) }] },
    ],
  });

  try {
    try {
      return await chamar();
    } catch (e) {
      // "This model is currently experiencing high demand" (503) passa em
      // segundos. Uma segunda tentativa cabe folgada no orçamento da rodada e
      // salva o documento de voltar para a fila por nada. Cota (429) não se
      // repete — só gastaria a requisição seguinte no mesmo erro.
      if (!(e instanceof GeminiError) || e.status === 429) throw e;
      await new Promise((r) => setTimeout(r, 2500));
      return await chamar();
    }
  } catch (e) {
    // 429 é cota (por minuto ou por dia). Não adianta insistir na mesma rodada:
    // encerra e devolve o que já foi lido, com o aviso na resposta.
    if (e instanceof GeminiError && e.status === 429) throw new ErroCota(e.detail || "cota do Gemini esgotada");
    // Qualquer outro erro do Gemini (5xx, rede, modelo fora do ar) é do serviço,
    // não do documento — a mensagem "Falha ao consultar a IA" sozinha não diz nada.
    if (e instanceof GeminiError) throw new ErroServico(`${e.message}${e.detail ? ` (${e.detail.slice(0, 160)})` : ""}`);
    throw e;
  }
}

/* -------------------------------------------------------------------------
 * Função
 * ---------------------------------------------------------------------- */

type Achado = {
  id: number; id_unico: string; titulo: string; valor: number; data_lancamento: string;
  competencia: string; responsavel: string | null; status: string;
  link_comprovante: string | null; trilha: unknown;
  ia_veredito: string | null; ia_arquivo: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    const quem = caller.email ?? (caller.isService ? "sistema" : "hub");
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const acao = String(body?.action ?? "conferir");
    const competencia = body?.competencia ? String(body.competencia) : null;
    const ids: number[] | null = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isFinite) : null;

    if (acao !== "conferir" && acao !== "aplicar") return json({ error: `Ação desconhecida: ${acao}` }, 200);

    /* ==================== APLICAR ==================== */
    // Aprova o que já foi conferido. Sem IA, sem cota, sem reler arquivo.
    if (acao === "aplicar") {
      let q = supabase.from("auditoria")
        .select("id, id_unico, titulo, valor, status, trilha, link_comprovante, ia_veredito, ia_arquivo, ia_motivo")
        .eq("ia_veredito", "aprovar")
        .in("status", STATUS_ABERTOS);
      if (ids?.length) q = q.in("id", ids);
      if (competencia) q = q.eq("competencia", competencia);
      const { data, error } = await q;
      if (error) throw error;

      const aprovados: unknown[] = [];
      const pulados: unknown[] = [];
      for (const r of (data ?? []) as any[]) {
        // O comprovante trocou depois da leitura: o veredito é sobre outro arquivo.
        if ((r.ia_arquivo ?? null) !== (r.link_comprovante ?? null)) {
          pulados.push({ id: r.id, titulo: r.titulo, motivo: "o comprovante mudou depois da conferência — confira de novo" });
          continue;
        }
        const agora = new Date().toISOString();
        const trilha = Array.isArray(r.trilha) ? r.trilha : [];
        const { error: uErr } = await supabase.from("auditoria").update({
          status: "Aprovado",
          ia_aprovado_em: agora,
          updated_at: agora,
          trilha: [...trilha, {
            em: agora,
            por: quem,
            de: r.status,
            para: "Aprovado",
            tipo: "aprovacao_automatica",
            texto: `Aprovado pela conferência do comprovante: ${r.ia_motivo ?? "valor e fornecedor batem com o documento"}`,
          }],
        }).eq("id", r.id);
        if (uErr) pulados.push({ id: r.id, titulo: r.titulo, motivo: uErr.message });
        else aprovados.push({ id: r.id, id_unico: r.id_unico, titulo: r.titulo, valor: Number(r.valor) });
      }
      return json({ ok: true, acao, aprovados: aprovados.length, itens: aprovados, pulados });
    }

    /* ==================== CONFERIR ==================== */
    if (!Deno.env.get("GEMINI_API_KEY")) {
      return json({ error: "GEMINI_API_KEY não configurada nas variáveis da função." }, 200);
    }

    const limite = Math.min(Math.max(1, Number(body?.limite) || LIMITE_PADRAO), LIMITE_MAX);
    const reler = body?.reler === true;

    let q = supabase.from("auditoria")
      .select("id, id_unico, titulo, valor, data_lancamento, competencia, responsavel, status, link_comprovante, trilha, ia_veredito, ia_arquivo")
      .not("link_comprovante", "is", null)
      .in("status", STATUS_ABERTOS)
      .order("data_lancamento", { ascending: false });
    if (competencia) q = q.eq("competencia", competencia);
    if (ids?.length) q = q.in("id", ids);
    const { data, error } = await q;
    if (error) throw error;

    // Um nome solto ("nota.pdf") não é caminho nem URL: não dá para buscar nada.
    const abrivel = (v: string | null) => !!v && (ehUrl(v) || v.includes("/"));
    const todos = ((data ?? []) as unknown as Achado[]).filter((r) => abrivel(r.link_comprovante));
    // Sem `reler`, pula o que já tem leitura DO MESMO arquivo. Trocou o
    // comprovante, a leitura velha não vale e ele volta para a fila.
    const fila = reler ? todos : todos.filter((r) => !r.ia_veredito || r.ia_arquivo !== r.link_comprovante);
    const rodada = fila.slice(0, limite);

    /* Notas já usadas por um gasto aprovado. A mesma nota explicando dois
       lançamentos é achado, não aprovação — e é justamente o que a auditoria
       existe para pegar. Quatro recibos de R$ 53,96 da GOL são quatro
       passageiros e têm números diferentes; a chave é emitente + número + total. */
    const { data: jaUsadas } = await supabase.from("auditoria")
      .select("id, titulo, ia_leitura")
      .not("ia_leitura", "is", null)
      .eq("status", "Aprovado");
    const usadas = new Map<string, { id: number; titulo: string }>();
    for (const r of (jaUsadas ?? []) as any[]) {
      const k = r.ia_leitura ? chaveDocumento(r.ia_leitura as Leitura) : null;
      if (k && !usadas.has(k)) usadas.set(k, { id: r.id, titulo: r.titulo });
    }

    const itens: unknown[] = [];
    const erros: unknown[] = [];
    let quotaEsgotada = false;
    let quotaPorDia = false;
    let lidos = 0;
    let tempoEsgotado = false;
    const comecou = Date.now();

    for (const r of rodada) {
      // Não começa o que não dá tempo de terminar: o worker morto no meio de uma
      // leitura devolve erro de infra, e a tela fica sem o resumo do que já saiu.
      if (Date.now() - comecou > ORCAMENTO_MS) { tempoEsgotado = true; break; }
      const lanc = { titulo: String(r.titulo ?? ""), valor: Number(r.valor ?? 0), data: String(r.data_lancamento ?? "") };
      let leitura: Leitura;
      try {
        leitura = await lerComprovante(supabase, r.link_comprovante!, lanc);
        lidos++;
      } catch (e) {
        if (e instanceof ErroCota) { quotaEsgotada = true; quotaPorDia = e.porDia; break; }
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`conferência falhou · ${r.id_unico} · ${msg}`);
        erros.push({ id: r.id, id_unico: r.id_unico, titulo: r.titulo, erro: msg, transitorio: e instanceof ErroServico });
        /* Documento ruim (não baixa, não é PDF/imagem, é página de erro do
           Drive) é carimbado "revisar" e SAI da fila. Sem isto ele continua na
           frente — a fila é ordenada por data — e todo "Ler mais" tropeça no
           mesmo arquivo quebrado, sem nunca alcançar os de baixo. Trocado o
           anexo, `ia_arquivo` muda e ele volta sozinho.

           Tropeço do serviço de IA não carimba nada: fica na fila e tenta de
           novo na próxima rodada. */
        if (e instanceof ErroServico) continue;
        const agoraErr = new Date().toISOString();
        await supabase.from("auditoria").update({
          ia_leitura: null,
          ia_veredito: "revisar",
          ia_motivo: `Não consegui ler o comprovante: ${msg}.`,
          ia_conferido_em: agoraErr,
          ia_arquivo: r.link_comprovante,
          updated_at: agoraErr,
        }).eq("id", r.id);
        continue;
      }

      let v: Veredito = conferir(lanc, leitura);

      // Nota já usada em outro gasto aprovado derruba a aprovação automática.
      if (v.veredito === "aprovar") {
        const k = chaveDocumento(leitura);
        const dono = k ? usadas.get(k) : undefined;
        if (dono && dono.id !== r.id) {
          v = { ...v, veredito: "revisar", motivo: `Este mesmo documento já foi aceito no lançamento "${dono.titulo}".` };
        } else if (k) {
          usadas.set(k, { id: r.id, titulo: r.titulo }); // trava a nota dentro da própria rodada
        }
      }

      const agora = new Date().toISOString();
      const { error: uErr } = await supabase.from("auditoria").update({
        ia_leitura: leitura as unknown as Record<string, unknown>,
        ia_veredito: v.veredito,
        ia_motivo: v.motivo,
        ia_conferido_em: agora,
        ia_arquivo: r.link_comprovante,
        updated_at: agora,
      }).eq("id", r.id);
      if (uErr) erros.push({ id: r.id, id_unico: r.id_unico, titulo: r.titulo, erro: uErr.message });

      itens.push({
        id: r.id, id_unico: r.id_unico, titulo: r.titulo, valor: Number(r.valor ?? 0),
        data: r.data_lancamento, responsavel: r.responsavel, status: r.status,
        veredito: v.veredito, motivo: v.motivo, como: v.como,
        valor_casado: v.valor_casado, item_rotulo: v.item_rotulo,
        emitente: leitura.emitente_nome, emitente_cnpj: leitura.emitente_cnpj ?? null,
        tipo_documento: leitura.tipo_documento, valor_documento: leitura.valor_total,
        data_documento: leitura.data_documento ?? null,
        numero_documento: leitura.numero_documento ?? null,
        descricao: leitura.descricao,
      });
    }

    const aprovaveis = itens.filter((i: any) => i.veredito === "aprovar").length;
    return json({
      ok: true,
      acao,
      modelo: DEFAULT_MODEL,
      lidos,
      aprovaveis,
      para_revisar: itens.length - aprovaveis,
      // Quanto ainda falta ler depois desta rodada. Documento ruim já saiu da
      // fila (foi carimbado "revisar"); tropeço do serviço continua nela.
      restantes: Math.max(0, fila.length - lidos - erros.filter((e: any) => !e.transitorio).length),
      quota_esgotada: quotaEsgotada,
      quota_por_dia: quotaPorDia,
      tempo_esgotado: tempoEsgotado,
      itens,
      erros,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
