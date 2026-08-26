// Edge Function: notas-arquivar
//
// Copia para o bucket do projeto a nota cujo arquivo só existe no Drive de
// alguém.
//
// POR QUE EXISTE. Medido em 26/08/2026: das 2.490 notas com arquivo no Drive,
// **2.335 vieram das planilhas de formulário** — o arquivo está no Drive de
// QUEM PREENCHEU. Quando essa pessoa sai da empresa, move a pasta ou apaga "o
// arquivo velho", o Hub continua exibindo a linha e o link continua com cara de
// bom. Quem descobre é o contador, no fechamento, meses depois.
//
// O `link` NÃO MUDA. Ele segue apontando para a origem, que é onde quem subiu
// vai procurar e o que dá rastreabilidade. `arquivo_bucket` é um SEGUNDO
// endereço, e é dele que a `omie-anexar-comprovante` já sabe baixar.
//
// O TETO É DE BYTES, NÃO DE ARQUIVOS. Um lote de 20 notas pode ser 20 recibos de
// 80 KB ou 20 DANFEs de 3 MB, e o worker morre com WORKER_RESOURCE_LIMIT no
// segundo caso — foi o que derrubou a varredura da pasta "0. Gmail" quando o
// teto era só a contagem. Aqui a rodada para quando o orçamento de bytes acaba,
// e devolve `restante` para quem está drenando.
//
// Body: { action?: 'resumo' | 'copiar', limite?: number }
// Cron: header `x-cron-token`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { tipoQueVale } from "../_shared/mime.ts";
import { segredosDoGmail, tokenDeAcesso } from "../_shared/gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
/** Teto do bucket. Acima disto o upload é recusado e não adianta baixar. */
const MAX_ARQUIVO = 10 * 1024 * 1024;
/** Orçamento de memória por rodada — ver o cabeçalho. */
const ORCAMENTO_BYTES = 40 * 1024 * 1024;
/** O worker morre aos 150s sem devolver relatório. Melhor parar antes. */
const ORCAMENTO_MS = 55_000;

/** O id do arquivo dentro do link do Drive, nas formas que aparecem no acervo. */
function idDoDrive(link: string): string | null {
  // https://drive.google.com/file/d/<ID>/view   — o formato das cinco planilhas
  const f = link.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (f) return f[1];
  // ...?id=<ID>  e  /uc?export=download&id=<ID>
  const q = link.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (q) return q[1];
  // https://drive.google.com/open?id=<ID> já cai no anterior; /d/<ID> solto:
  const d = link.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return d ? d[1] : null;
}

/** Nome de arquivo seguro para caminho de bucket, sem perder o que descreve. */
const limpo = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "documento";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      /* A coluna é `name`, não `nome` — o resto da tabela é em português e esta
         não. Pedir `nome` devolve erro do PostgREST, `data` vem null e o cron é
         recusado EM SILÊNCIO, com cara de token errado.
         E o `name` também entra no filtro: token é credencial, e uma credencial
         que abre qualquer porta não é credencial. É o que as outras funções da
         esteira já fazem. */
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "notas-arquivar").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "copiar";

    if (action === "resumo") {
      const { data, error } = await supabase.rpc("notas_externas_arquivo_resumo");
      if (error) throw new Error(error.message);
      return json({ ok: true, ...(data as Record<string, unknown>) });
    }

    /* CHAVE DE API NÃO SERVE AQUI, e descobrir isso custou dois lotes.
       Ela só abre arquivo PÚBLICO. As notas das planilhas ficam no Drive de quem
       preencheu e são apenas COMPARTILHADAS com o `financeiro@` — para a chave
       elas simplesmente não existem, e o Drive responde `404 File not found`
       (ele não distingue "não existe" de "você não pode ver", de propósito).
       Confirmado num arquivo real da fila: `owner joaoesteves.takeat@gmail.com`,
       `sharedWithMeTime` de 19/11/2024.
       Quem alcança o que foi compartilhado com a caixa é o consentimento DELA —
       o mesmo refresh token do Gmail, agora também com `drive.readonly`. */
    const seg = await segredosDoGmail(supabase);
    if (!seg.refreshToken) {
      throw new Error("GMAIL_REFRESH_TOKEN ausente — autorize em gmail-oauth (agora com escopo do Drive)");
    }
    const token = await tokenDeAcesso(seg);

    const teto = Math.max(1, Math.min(Number(body?.limite) || 20, 100));
    const { data: fila, error: erroFila } = await supabase
      .rpc("notas_externas_para_arquivar", { p_limite: teto });
    if (erroFila) throw new Error(`fila: ${erroFila.message}`);

    const inicio = Date.now();
    let copiadas = 0, falhas = 0, bytesTotais = 0, pararamPorOrcamento = 0;

    for (const n of (fila ?? []) as { id: number; link: string; nome: string | null; enviado_em: string | null; fonte: string }[]) {
      if (Date.now() - inicio > ORCAMENTO_MS || bytesTotais > ORCAMENTO_BYTES) { pararamPorOrcamento++; continue; }

      const marcarErro = async (erro: string) => {
        falhas++;
        await supabase.from("notas_externas")
          .update({ arquivo_erro: erro.slice(0, 200), atualizado_em: new Date().toISOString() })
          .eq("id", n.id);
      };

      const fileId = idDoDrive(n.link ?? "");
      if (!fileId) { await marcarErro(`link sem id do Drive: ${(n.link ?? "").slice(0, 80)}`); continue; }

      try {
        /* `alt=media` baixa o conteúdo. Só funciona em arquivo BINÁRIO — um
           Google Doc responde 403 e precisa de `export`, mas nota fiscal nunca
           é Doc, então o 403 aqui é "sem permissão", que é informação boa. */
        const r = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
        );
        if (!r.ok) {
          /* O ERRO PRECISA DIZER O QUE FAZER, e o do Drive não diz.
             Doze linhas falharam com `403 Only files with binary content can be
             downloaded`, que soa como problema técnico. Olhando os metadados, o
             que havia era outra coisa: o link da planilha aponta para uma
             PASTA — "Recibos - Brindes", `application/vnd.google-apps.folder`.
             Alguém colou o endereço da pasta em vez do arquivo. Isso não se
             conserta em código: se conserta na planilha, e só se alguém souber.
             Por isso o segundo pedido, só no caminho de erro: uma chamada a mais
             quando já deu errado é barata, e transforma "403" em instrução. */
          const bruto = (await r.text()).slice(0, 120);
          let extra = "";
          try {
            const m = await fetch(
              `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name,size&supportsAllDrives=true`,
              { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
            );
            if (m.ok) {
              const meta = await m.json();
              if (meta?.mimeType === "application/vnd.google-apps.folder") {
                extra = ` — o link é de uma PASTA ("${meta.name}"), não de um arquivo: corrija o link na planilha`;
              } else if (String(meta?.mimeType ?? "").startsWith("application/vnd.google-apps")) {
                extra = ` — é um documento nativo do Google (${meta.mimeType}), que não tem arquivo para baixar`;
              }
            }
          } catch { /* o diagnóstico é bônus; sem ele fica o erro cru */ }
          await marcarErro(`Drive ${r.status}: ${bruto}${extra}`);
          continue;
        }
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!bytes.length) { await marcarErro("Drive devolveu arquivo vazio"); continue; }
        if (bytes.length > MAX_ARQUIVO) {
          await marcarErro(`arquivo de ${Math.round(bytes.length / 1024 / 1024)} MB — acima do teto do bucket`);
          continue;
        }

        /* O TIPO VEM DOS BYTES. O Drive responde `application/octet-stream` em
           download, e o bucket tem allowlist de mime: sem farejar, um PDF
           perfeito é recusado. Mesma lição do `_shared/mime.ts`. */
        const mime = tipoQueVale(n.nome ?? "", r.headers.get("content-type"), bytes) ?? "application/pdf";

        const mes = (n.enviado_em ?? new Date().toISOString()).slice(0, 7);
        const caminho = `acervo/${mes}/${n.id}_${limpo(n.nome ?? n.fonte)}`;

        const { error: erroUp } = await supabase.storage.from(BUCKET)
          .upload(caminho, bytes, { contentType: mime, upsert: true });
        if (erroUp) { await marcarErro(`storage: ${erroUp.message}`); continue; }

        const { error: erroDb } = await supabase.from("notas_externas").update({
          arquivo_bucket: caminho,
          arquivo_em: new Date().toISOString(),
          arquivo_bytes: bytes.length,
          arquivo_erro: null,
          atualizado_em: new Date().toISOString(),
        }).eq("id", n.id);
        if (erroDb) throw new Error(`gravar: ${erroDb.message}`);

        copiadas++;
        bytesTotais += bytes.length;
      } catch (e) {
        await marcarErro(String((e as Error)?.message ?? e));
      }
    }

    /* NOMES QUE NÃO SE ATROPELAM.
       O resumo também tem `copiadas` — cumulativo —, e o spread vinha DEPOIS,
       então o número da rodada era silenciosamente substituído pelo total. Quem
       lia o log via "copiadas=30, 50, 70" e achava que cada rodada estava
       crescendo. O da rodada agora se chama pelo que é. */
    const { data: resumo } = await supabase.rpc("notas_externas_arquivo_resumo");
    return json({
      ok: true,
      copiadas_nesta_rodada: copiadas,
      falhas_nesta_rodada: falhas,
      mb_nesta_rodada: Math.round((bytesTotais / 1024 / 1024) * 10) / 10,
      pararam_por_orcamento: pararamPorOrcamento,
      ...(resumo as Record<string, unknown>),
    });
  } catch (e) {
    console.error("notas-arquivar", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
