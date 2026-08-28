// Edge Function: anexo-triagem
//
// A PRIMEIRA PASSADA NO "ANEXO A CONFERIR".
//
// A fila reúne os anexos que o ERP tem e cujo NOME não identifica nada
// (`nf_undefined_correta.pdf`, UUID, `.tmp`, foto sem renomear). A pergunta é
// curta — "isto é a nota deste título?" — e só se responde abrindo o arquivo.
//
// Aqui o Gemini abre e TRANSCREVE; quem decide é `_shared/anexo-triagem.ts`, em
// TypeScript, sobre o que ele disse ter lido. É a mesma divisão da conferência
// de comprovantes da auditoria, e ela existe por um motivo medido: naquela
// tela o modelo afirmou que a tarifa de um bilhete batia com a cobrança e
// nenhuma linha do documento valia aquele número.
//
// SÓ DECIDE O QUE NÃO TEM VOLTA INTERESSANTE. Documento fiscal do valor certo
// vira `nota`; boleto, contrato, print e foto de coisa nenhuma viram
// `nao_e_nota`. Nota de valor diferente, arquivo ilegível e tipo incerto ficam
// na fila COM A LEITURA À MOSTRA — que é o que transforma uma decisão
// impossível numa decisão de dois segundos.
//
// O ARQUIVO VEM DO CACHE quando dá. `omie_anexo_link` guarda o link assinado do
// `ObterAnexo` por 6 horas, e o cron de aquecimento mantém a fila quente — então
// a rodada quase nunca precisa gastar uma vez na fila do Omie, que é disputada
// com a varredura de envio e a de leitura.
//
// Ações (body.action):
//   "triar"    → { limite? } roda a fila (padrão 6, máx 12)
//   "previa"   → { limite? } lê e devolve o que FARIA, sem gravar
//   "desfazer" → { desde? }  volta atrás no que a IA decidiu

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { omieCall } from "../_shared/omie-rpc.ts";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, GeminiError, DEFAULT_MODEL } from "../_shared/gemini.ts";
import { mimeDosBytes, mimeDoNome } from "../_shared/mime.ts";
import { lerXmlFiscal } from "../_shared/nota-fiscal.ts";
import {
  triar, perguntaDaTriagem, SISTEMA_TRIAGEM, SCHEMA_TRIAGEM,
  type LeituraAnexo, type ContextoTitulo,
} from "../_shared/anexo-triagem.ts";

/** O nosso, para o XML saber qual dos CNPJs do arquivo é o do fornecedor. */
const CNPJ_TAKEAT = "37511891000150";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* OS TETOS, MEDIDOS CONTRA O WORKER EM 26/08/2026.
 *
 * O relógio não é o que mata. Quase todo o tempo desta função é ESPERA DE REDE
 * (baixar do CDN do Omie, aguardar o Gemini), e o worker fica ocioso nela — foi
 * por isso que ler DE DOIS EM DOIS mais que dobrou a rodada, de 2 para 5.
 *
 * O que mata é o BASE64. Um PDF de 8 MB vira uma string de ~11 MB montada em
 * pedaços, e duas dessas vivas ao mesmo tempo encostam no limite de memória do
 * worker. Medido: `limite: 20` morreu com WORKER_RESOURCE_LIMIT depois de 5
 * documentos; a chamada seguinte, com `limite: 6`, morreu depois de 4 — porque
 * **o worker é REUTILIZADO entre invocações e rodadas seguidas dividem o mesmo
 * orçamento**. É a mesma lição já escrita na `omie-anexar-comprovante`.
 *
 * Morrer assim não perde trabalho (cada item grava assim que sai), mas perde a
 * RESPOSTA: quem chamou não fica sabendo o que aconteceu, e o cron seguinte
 * pega o worker já gasto. Por isso a rodada agora para sozinha ANTES da parede,
 * e o freio é medido no que de fato custa — bytes processados, não itens.
 *
 * Throughput não vem de lote grande: vem de rodada pequena e frequente. O cron
 * roda 4× por hora (ver `20260826213000_anexo_triagem_cron_mais_vezes.sql`). */
/* AS DUAS MEDIÇÕES QUE DEFINIRAM ESTES NÚMEROS (26/08/2026):
 *
 *   ms_por_documento: 45.978   ← 46 SEGUNDOS cada
 *   megabytes: 1,8             ← quatro documentos inteiros
 *
 * Ou seja: o arquivo é pequeno (~450 KB) e o base64 não custa quase nada. Os 46
 * segundos são ESPERA DO GEMINI lendo o documento. Durante eles o worker não
 * faz nada — e foi por isso que a primeira suposição (que o gargalo era memória
 * do base64, com freio em bytes) estava errada. O freio de bytes ficou como
 * rede de segurança para o dia do PDF gordo, mas não é ele que morde.
 *
 * Com o custo sendo espera, quem sobe a vazão é o PARALELISMO. Quatro leituras
 * ao mesmo tempo somam ~2,5 MB vivos — longe do que derruba o worker — e uma
 * onda leva os mesmos ~50 s que uma leitura sozinha.
 *
 * O orçamento é de 55 s porque a checagem só acontece ENTRE ondas: com uma onda
 * de ~50 s, 55 s deixa começar a segunda e terminar por volta de 110 s, dentro
 * do tempo de parede da plataforma. Foi passar disso que produziu os dois
 * WORKER_RESOURCE_LIMIT medidos com lote 20 e lote 6. */
const MAX_BYTES = 5 * 1024 * 1024;
const ORCAMENTO_BYTES = 18 * 1024 * 1024;
const ORCAMENTO_MS = 55_000;
const LIMITE_PADRAO = 8;
const LIMITE_MAX = 20;
const EM_PARALELO = 4;

const SUPORTADOS = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

class ErroCota extends Error {}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  // Em pedaços: `apply` com um array de 8 MB estoura a pilha do V8.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Página de erro do Drive/gateway salva com nome de PDF é o engano mais comum. */
function ehHtml(b: Uint8Array): boolean {
  const inicio = new TextDecoder().decode(b.subarray(0, 200)).trim().toLowerCase();
  return inicio.startsWith("<!doctype html") || inicio.startsWith("<html");
}

/* ============================================================================
 *  Os bytes do anexo
 * ==========================================================================
 * Primeiro o link guardado; depois, se não houver, o `ObterAnexo`. O Omie pode
 * devolver o conteúdo em vez do endereço — os dois caminhos terminam em bytes. */

async function bytesDoAnexo(
  supabase: any, cod: number, idAnexo: string, cTabela: string, nome: string,
): Promise<{ bytes: Uint8Array; nome: string }> {
  const { data: cache } = await supabase
    .from("omie_anexo_link").select("url, nome")
    .eq("cod_titulo", cod).eq("id_anexo", idAnexo)
    .gt("expira_em", new Date().toISOString()).maybeSingle();

  if (cache?.url) {
    const r = await fetch(cache.url);
    if (r.ok) {
      return { bytes: new Uint8Array(await r.arrayBuffer()), nome: cache.nome ?? nome };
    }
    // Link morto antes da hora: cai para o ERP em vez de falhar o item.
  }

  const resp = await omieCall<any>("geral/anexo", "ObterAnexo", {
    nId: cod, cTabela,
    ...(idAnexo ? { nIdAnexo: Number(idAnexo) } : { cNomeArquivo: nome }),
  });

  const achar = (o: unknown, prof = 0): { url?: string; base64?: string } => {
    if (prof > 6 || o == null) return {};
    if (typeof o === "string") {
      const s = o.trim();
      if (/^https?:\/\//i.test(s)) return { url: s };
      if (s.length > 512 && /^[A-Za-z0-9+/=\r\n]+$/.test(s)) return { base64: s.replace(/\s/g, "") };
      return {};
    }
    if (Array.isArray(o)) {
      for (const it of o) { const r = achar(it, prof + 1); if (r.url || r.base64) return r; }
      return {};
    }
    if (typeof o === "object") {
      let b: string | undefined;
      for (const v of Object.values(o as Record<string, unknown>)) {
        const r = achar(v, prof + 1);
        if (r.url) return r;
        if (r.base64 && !b) b = r.base64;
      }
      return b ? { base64: b } : {};
    }
    return {};
  };

  const { url, base64 } = achar(resp);
  if (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`o link do anexo respondeu ${r.status}`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), nome };
  }
  if (base64) {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { bytes: out, nome };
  }
  throw new Error("o Omie respondeu sem link nem conteúdo do arquivo");
}

/* ============================================================================
 *  A leitura
 * ========================================================================== */

async function lerDocumento(
  supabase: any, item: any, contarBytes?: (n: number) => void,
): Promise<{ leitura: LeituraAnexo; arquivo: string }> {
  const nomeArquivo = String(item.nome ?? "anexo");
  const { bytes, nome } = await bytesDoAnexo(
    supabase, Number(item.cod_titulo), String(item.id_anexo ?? ""),
    String(item.c_tabela ?? "conta-pagar"), nomeArquivo,
  );

  if (!bytes.length) throw new Error("o arquivo está vazio");
  if (bytes.length > MAX_BYTES) {
    throw new Error(`o arquivo tem ${(bytes.length / 1048576).toFixed(1)} MB — acima do que cabe na leitura`);
  }
  contarBytes?.(bytes.length);
  if (ehHtml(bytes)) throw new Error("o arquivo é uma página HTML, não um documento");

  /* Os bytes primeiro, o nome depois: a extensão é palpite e o Omie guarda
     arquivo com nome que não diz nada — é por isso que a linha está na fila. */
  const mime = mimeDosBytes(bytes) ?? mimeDoNome(nome);

  /* ---------------- O XML SE LÊ SOZINHO, ANTES DE CHAMAR A IA ----------------
   *
   * Aqui a IA não é só desnecessária: ela é pior. No XML o tipo, o emitente, o
   * CNPJ, o valor, a data e o número estão em campo próprio — pedir ao Gemini
   * que "olhe" um arquivo de tags é pagar para introduzir uma chance de erro
   * onde não havia nenhuma. E de qualquer forma ele não olharia: `SUPORTADOS`
   * é PDF e imagem, então até 28/08/2026 todo XML morria em `não sei ler` e a
   * linha ficava `indefinido` para sempre — contando como coberta pelo
   * desempate do "não sei". Eram 8 títulos, um deles de R$ 79.450.
   *
   * `lerXmlFiscal` devolve `null` para o que não tem tag de NF-e/NFS-e, e aí a
   * recusa é honesta: um `.xml` que não é nota fiscal existe (retorno de banco,
   * planilha exportada) e precisa aparecer como problema, não como nota. */
  if (mime === "text/xml" || mime === "application/xml" || /\.xml$/i.test(nome)) {
    const x = lerXmlFiscal(new TextDecoder().decode(bytes), CNPJ_TAKEAT);
    if (!x) {
      throw new Error(
        `"${nome}" é XML, mas não tem nenhuma tag conhecida de NF-e/NFS-e — não é nota fiscal`,
      );
    }
    return {
      leitura: {
        tipo: "nota_fiscal",
        emitente: x.emitente,
        cnpj_emitente: x.cnpj,
        numero: x.numero,
        valor_total: x.valor,
        data: x.data,
        /* Sempre legível: ou as tags estavam lá, ou nem chegamos aqui. Não há
           o meio-termo do escaneado torto que justifica este campo na IA. */
        legivel: true,
        resumo: [
          "XML fiscal",
          x.numero ? `nº ${x.numero}` : null,
          x.emitente,
          x.chave ? `chave ${x.chave}` : null,
        ].filter(Boolean).join(" · "),
      },
      arquivo: nome,
    };
  }

  if (!mime || !SUPORTADOS.has(mime)) {
    throw new Error(`não sei ler "${nome}"${mime ? ` (${mime})` : ""} — use PDF, JPG, PNG, WEBP ou XML`);
  }

  const ctx: ContextoTitulo = {
    favorecido: String(item.favorecido ?? ""),
    valor: Number(item.valor ?? 0),
    competencia: item.competencia ? String(item.competencia) : null,
    categoria: item.categoria ? String(item.categoria) : null,
  };

  const chamar = () => generateJSON<LeituraAnexo>({
    model: DEFAULT_MODEL,
    temperature: 0,
    responseSchema: SCHEMA_TRIAGEM,
    messages: [
      { role: "system", content: SISTEMA_TRIAGEM },
      {
        role: "user",
        content: perguntaDaTriagem(ctx, nome),
        imagens: [{ mimeType: mime, data: toBase64(bytes) }],
      },
    ],
  });

  try {
    try {
      return { leitura: await chamar(), arquivo: nome };
    } catch (e) {
      // 503 ("high demand") passa em segundos e cabe no orçamento. 429 é cota:
      // insistir só gastaria a requisição seguinte no mesmo erro.
      if (!(e instanceof GeminiError) || e.status === 429) throw e;
      await new Promise((r) => setTimeout(r, 2500));
      return { leitura: await chamar(), arquivo: nome };
    }
  } catch (e) {
    if (e instanceof GeminiError && e.status === 429) {
      throw new ErroCota(e.detail || "cota do Gemini esgotada");
    }
    throw e;
  }
}

/* ============================================================================
 *  A rodada
 * ========================================================================== */

async function rodar(supabase: any, limite: number, gravar: boolean) {
  const { data: fila, error } = await supabase.rpc("anexo_triagem_fila", { p_limite: limite });
  if (error) throw new Error(`não deu para ler a fila: ${error.message}`);

  const comecou = Date.now();
  const saida: any[] = [];
  let cota = false, tempo = false, pesado = false;
  let bytes = 0;

  /* Um item, do começo ao fim. Separado do laço para poder rodar em par: o
     `Promise.all` abaixo aproveita a espera de rede de um durante a do outro. */
  const fazer = async (item: any) => {
    const cod = Number(item.cod_titulo);
    const t0 = Date.now();
    try {
      const { leitura, arquivo } = await lerDocumento(supabase, item, (n) => { bytes += n; });
      const v = triar(leitura, {
        favorecido: String(item.favorecido ?? ""),
        valor: Number(item.valor ?? 0),
        competencia: item.competencia ? String(item.competencia) : null,
        categoria: item.categoria ? String(item.categoria) : null,
      });
      if (gravar) {
        /* O ERRO DA GRAVAÇÃO NÃO PODE SER ENGOLIDO. Na primeira versão desta
           função o `rpc` era chamado sem olhar o `error`, e um cast quebrado
           dentro da RPC (`revisado_por` é uuid, e escreviam 'ia' nela) fez uma
           rodada inteira devolver "6 lidos, 3 nota, 1 não é" com ZERO linhas
           gravadas — 6 chamadas do Gemini gastas, a fila intacta e sucesso
           relatado. Ler é a parte cara; não confirmar que ficou guardado é
           pagar de novo amanhã sem saber por quê. */
        const { error: erroGravar } = await supabase.rpc("anexo_triagem_gravar", {
          p_cod_titulo: cod, p_arquivo: arquivo,
          p_leitura: leitura, p_veredito: v.veredito, p_motivo: v.motivo,
        });
        if (erroGravar) throw new Error(`li o documento, mas não deu para gravar: ${erroGravar.message}`);
      }
      saida.push({ cod_titulo: cod, arquivo, veredito: v.veredito, motivo: v.motivo, leitura, ms: Date.now() - t0 });
    } catch (e) {
      // Dentro de `fazer` não há laço de onde sair: a cota vira sinal, e quem
      // interrompe é o laço de fora, depois que o par corrente termina.
      if (e instanceof ErroCota) { cota = true; return; }
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 240);
      /* Documento que não dá para ler SAI DA FILA como "revisar", com o motivo
         escrito. Sem isso ele fica na frente para sempre — a fila é ordenada
         por valor, e o mesmo arquivo ruim tropeçaria em toda rodada. */
      if (gravar) {
        const { error: erroGravar } = await supabase.rpc("anexo_triagem_gravar", {
          p_cod_titulo: cod, p_arquivo: String(item.nome ?? ""),
          p_leitura: null, p_veredito: "revisar", p_motivo: `não deu para ler: ${msg}`,
        });
        // Aqui o erro só é registrado: o item já falhou, e derrubar a rodada
        // inteira por causa do carimbo tiraria da fila quem ainda daria certo.
        if (erroGravar) console.error(`triagem ${cod}: não gravou o motivo — ${erroGravar.message}`);
      }
      saida.push({ cod_titulo: cod, veredito: "revisar", motivo: `não deu para ler: ${msg}`, ms: Date.now() - t0 });
    }
  };

  /* POOL, E NÃO ONDAS. Medido: os tempos por documento foram 15 s, 21 s, 35 s e
     106 s na mesma rodada — o Gemini varia muito com o documento. Lendo em
     ondas de quatro com `Promise.all`, a onda inteira espera o pior: três
     leituras prontas em 35 s ficavam paradas 70 s à toa, e a rodada terminava
     com 4 documentos em 107 s.

     Aqui cada trabalhador puxa o próximo assim que termina o seu. O documento
     lerdo atrasa só a si mesmo.

     A checagem de orçamento fica ANTES de puxar trabalho novo: um documento
     começado é sempre terminado e gravado. Cortar no meio jogaria fora a
     chamada do Gemini, que é a parte cara. */
  const lista = (fila ?? []) as any[];
  let proximo = 0;

  const trabalhador = async () => {
    while (true) {
      if (cota) return;
      if (Date.now() - comecou > ORCAMENTO_MS) { tempo = true; return; }
      /* Rede de segurança para o dia do PDF gordo. Hoje não morde: quatro
         documentos somaram 1,8 MB. */
      if (bytes > ORCAMENTO_BYTES) { pesado = true; return; }
      const i = proximo++;
      if (i >= lista.length) return;
      await fazer(lista[i]);
    }
  };

  await Promise.all(Array.from({ length: EM_PARALELO }, trabalhador));

  const { data: restam } = await supabase.rpc("anexo_triagem_fila_total");
  const conta = (v: string) => saida.filter((s) => s.veredito === v).length;

  return {
    lidos: saida.length,
    nota: conta("nota"),
    nao_e_nota: conta("nao_e_nota"),
    revisar: conta("revisar"),
    restantes: Number(restam ?? 0),
    parou_por_cota: cota,
    parou_por_tempo: tempo,
    parou_por_peso: pesado,
    // O relógio e a balança à mostra: é com eles que se calibra o teto na
    // próxima vez, em vez de escolher um número e esperar o worker reclamar.
    gastou_ms: Date.now() - comecou,
    megabytes: Math.round((bytes / 1048576) * 10) / 10,
    ms_por_documento: saida.length
      ? Math.round(saida.reduce((s, x) => s + (x.ms ?? 0), 0) / saida.length)
      : null,
    itens: saida,
  };
}

/* ========================================================================== */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "triar");

    const token = req.headers.get("x-cron-token");
    if (token) {
      const { data: ok } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "anexo-triagem").eq("token", token).maybeSingle();
      if (!ok) return json({ erro: "token inválido" }, 401);
    } else {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    if (action === "desfazer") {
      const { data, error } = await supabase.rpc("anexo_triagem_desfazer", {
        p_desde: body?.desde ?? null,
      });
      if (error) throw error;
      return json({ ok: true, desfeitos: Number(data ?? 0) });
    }

    const limite = Math.min(Math.max(1, Number(body?.limite) || LIMITE_PADRAO), LIMITE_MAX);
    if (action === "previa") return json({ ok: true, ...(await rodar(supabase, limite, false)) });
    if (action === "triar")  return json({ ok: true, ...(await rodar(supabase, limite, true)) });

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    console.error("anexo-triagem:", msg);
    return json({ erro: msg }, 500);
  }
});
