// Edge Function: nota-caixa
//
// A CAIXA DE NOTAS — jogue os arquivos aqui e o Hub descobre de quem são.
//
// O pedido, em 27/08/2026: *"eu vou ter que abrir cada um desses links para
// pegar a nota. Até tudo bem, vai ter que ser manual mesmo. Mas depois, para
// achar cada lançamento desse e colocar a nota, vai dar maior trabalho. Cria um
// espaço onde eu posso jogar notas avulsas."*
//
// A parte cara já existia inteira: ler o arquivo (`nota-ler-arquivo`), casar com
// o lançamento (`notas_externas_casar` e as oito regras dele), anexar no Omie
// (`omie-anexar-comprovante`). Faltava a PORTA — um lugar onde vinte arquivos
// entram de uma vez e caem nessa esteira sem ninguém digitar nada.
//
// O QUE ESTA FUNÇÃO FAZ, e o que ela deliberadamente NÃO faz:
//   1. guarda cada arquivo no bucket privado;
//   2. cria a linha em `notas_externas` com `fonte = 'caixa'` e VALOR NULO;
//   3. chama a leitura, que preenche CNPJ, valor, data e número — por texto
//      quando o PDF tem texto, pela IA quando é foto ou digitalização;
//   4. chama o casador e acorda o envio ao Omie.
//
// Ela NÃO decide de quem é a nota. Isso é do `notas_externas_casar`, com as
// mesmas regras que valem para tudo que entra pelo e-mail, pela planilha e pelo
// Drive — e com a mesma régua de confiança: identidade (chave fiscal, CNPJ +
// valor) sobe sozinha; valor + data espera um clique. Decisão do usuário no
// mesmo dia. Uma segunda lógica de casamento aqui dentro divergiria da primeira
// no primeiro conserto, e aí a mesma nota teria dono diferente conforme a porta
// por onde entrou.
//
// Body: { action: 'subir', arquivos: [{ nome, base64, mime? }] }
// Resposta: { ok, aceitos: [{nome, id}], recusados: [{nome, erro}], lidos, casados }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { ehHtml } from "../_shared/drive.ts";
import { tipoQueVale } from "../_shared/mime.ts";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
const EXT_OK = /\.(pdf|xml|jpe?g|png|webp)$/i;
const MAX_BYTES = 10 * 1024 * 1024;
/** O ZIP inteiro. Acima disto o worker não aguenta descompactar em memória. */
const MAX_ZIP = 25 * 1024 * 1024;
/** Por chamada. A tela manda em levas; vinte arquivos são duas chamadas. */
const MAX_ARQUIVOS = 12;

type Entrada = { nome: string; bytes: Uint8Array; mime?: string | null };

/**
 * O ZIP É ABERTO AQUI, e não no navegador.
 *
 * Descompactar no cliente exigiria uma biblioteca nova no `package.json` para um
 * caso que acontece uma vez por semana. Aqui é uma linha de `fflate`, que já roda
 * em Deno, e o navegador continua burro — manda bytes, recebe resultado.
 *
 * Pasta dentro do ZIP vira nome achatado: `notas/junho/nf01.pdf` é `nf01.pdf`. O
 * caminho de origem não diz nada sobre a nota, e guardá-lo só faria nome de
 * arquivo comprido na tela.
 */
function abrirZip(bytes: Uint8Array): Entrada[] {
  const conteudo = unzipSync(bytes);
  const fora: Entrada[] = [];
  for (const [caminho, dados] of Object.entries(conteudo)) {
    // Diretório, lixo do macOS e arquivo oculto não são nota de ninguém.
    const nome = caminho.split("/").pop() || "";
    if (!nome || nome.startsWith(".") || caminho.startsWith("__MACOSX/")) continue;
    if (!(dados as Uint8Array).length) continue;
    fora.push({ nome, bytes: dados as Uint8Array });
  }
  return fora;
}

function deBase64(b64: string): Uint8Array {
  const limpo = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(limpo);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    /* ---------------- abrir: olhar o papel antes de decidir ----------------
     * A nota sem dono é justamente a que precisa ser aberta — e `omie-anexo-abrir`
     * não serve para ela, porque aquela função parte de um título e aqui título
     * é o que falta. Link assinado, com validade curta: o arquivo é documento
     * fiscal e não tem por que ficar acessível depois que a aba fechou. */
    if (String(body?.action ?? "") === "abrir") {
      const id = Number(body?.id ?? 0);
      if (!id) return json({ error: "Informe a nota (id)." }, 200);
      const { data: n } = await supabase
        .from("notas_externas").select("arquivo_bucket, link, o_que_e")
        .eq("id", id).maybeSingle();
      const caminho = String((n as any)?.arquivo_bucket || (n as any)?.link || "");
      if (!caminho) return json({ error: "Esta linha não tem arquivo." }, 200);
      if (/^https?:\/\//i.test(caminho)) {
        return json({ ok: true, url: caminho, externo: true, nome: (n as any)?.o_que_e ?? null });
      }
      const { data: assinado, error: sErr } = await supabase.storage
        .from(BUCKET).createSignedUrl(caminho, 600);
      if (sErr || !assinado?.signedUrl) {
        return json({ error: `Não deu para abrir: ${sErr?.message ?? "arquivo não encontrado"}` }, 200);
      }
      return json({ ok: true, url: assinado.signedUrl, externo: false, nome: (n as any)?.o_que_e ?? null });
    }

    const brutos = Array.isArray(body?.arquivos) ? body.arquivos : [];
    if (!brutos.length) return json({ error: "Nenhum arquivo recebido." }, 200);

    /* ---------------- 1) o que veio, já com os ZIP abertos ---------------- */
    const entradas: Entrada[] = [];
    const recusados: { nome: string; erro: string }[] = [];

    for (const a of brutos) {
      const nome = String(a?.nome ?? "arquivo").slice(0, 160);
      let bytes: Uint8Array;
      try {
        bytes = deBase64(String(a?.base64 ?? ""));
      } catch {
        recusados.push({ nome, erro: "arquivo inválido (base64)" });
        continue;
      }
      if (!bytes.length) { recusados.push({ nome, erro: "arquivo vazio" }); continue; }

      if (/\.zip$/i.test(nome)) {
        if (bytes.length > MAX_ZIP) { recusados.push({ nome, erro: "ZIP maior que 25 MB" }); continue; }
        try {
          const dentro = abrirZip(bytes);
          if (!dentro.length) recusados.push({ nome, erro: "o ZIP não tem arquivo nenhum dentro" });
          entradas.push(...dentro);
        } catch (e) {
          recusados.push({ nome, erro: `não deu para abrir o ZIP: ${String((e as Error)?.message ?? e).slice(0, 80)}` });
        }
        continue;
      }
      entradas.push({ nome, bytes, mime: a?.mime ? String(a.mime) : null });
    }

    /* ---------------- 2) guarda e registra, um a um ---------------- */
    const aceitos: { nome: string; id: number }[] = [];
    const agora = new Date();
    const mes = agora.toISOString().slice(0, 7);

    for (const e of entradas.slice(0, MAX_ARQUIVOS)) {
      if (!EXT_OK.test(e.nome)) {
        recusados.push({ nome: e.nome, erro: "formato não aceito — use PDF, XML, JPG, PNG ou WEBP" });
        continue;
      }
      if (e.bytes.length > MAX_BYTES) {
        recusados.push({ nome: e.nome, erro: "maior que 10 MB" });
        continue;
      }
      /* O ENGANO MAIS SILENCIOSO: salvar a PÁGINA do portal como "nota.pdf".
         Ela sobe, o Omie aceita, e o contador abre um HTML. */
      if (ehHtml(e.bytes)) {
        recusados.push({ nome: e.nome, erro: "isso é uma página HTML, não a nota — baixe o PDF ou o XML" });
        continue;
      }

      const carimbo = agora.getTime() + Math.floor(Math.random() * 1000);
      const seguro = e.nome.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `caixa/${mes}/${carimbo}_${seguro}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, e.bytes, {
        // Os bytes decidem o tipo: a extensão é palpite de quem nomeou.
        contentType: tipoQueVale(e.nome, e.mime ?? null, e.bytes) ?? undefined,
        upsert: false,
      });
      if (upErr) { recusados.push({ nome: e.nome, erro: `não deu para guardar: ${upErr.message}` }); continue; }

      const { data: nota, error: erroNota } = await supabase
        .from("notas_externas")
        .insert({
          chave: `caixa|${carimbo}|${seguro}`.slice(0, 200),
          fonte: "caixa",
          ordem: 1,
          /* A DATA DE HOJE É PROVISÓRIA, e quem manda é a que está no papel.
             O casador ancora as janelas em `coalesce(vencimento, enviado_em)`, e
             a `nota-ler-arquivo` preenche `vencimento` com a data impressa no
             documento — por texto ou pela IA. Enquanto ela não lê, "hoje" é o
             que existe. Nulo não serve: o CTE do casador exige `enviado_em is
             not null`, e a linha ficaria fora de todas as regras.
             O caso que sobra — nota antiga sem data legível — cai em "sem dono"
             na Caixa, que é onde se aponta o lançamento na mão. */
          enviado_em: agora.toISOString().slice(0, 10),
          o_que_e: e.nome,
          detalhe: `caixa de notas · ${caller.email}`,
          /* `nota` é palpite, e de propósito: quase tudo que alguém joga aqui é
             nota, e a leitura corrige o tipo quando não for. Nascer como `outro`
             deixaria a linha fora das regras do casador até alguém arrumar. */
          tipo_documento: "nota",
          tem_arquivo: true,
          /* OS DOIS CAMPOS, e não só o `link`: a fila da leitura ordena por
             `arquivo_bucket desc nulls last` — quem tem cópia no bucket é quem
             dá para ler agora. Com só o `link` preenchido, a nota recém-jogada
             ia para o fim da fila e a leitura desta mesma chamada gastaria o
             orçamento em outras linhas. */
          arquivo_bucket: path,
          link: path,
          visto_em: agora.toISOString(),
          atualizado_em: agora.toISOString(),
        })
        .select("id")
        .single();
      if (erroNota) { recusados.push({ nome: e.nome, erro: `não deu para registrar: ${erroNota.message}` }); continue; }
      aceitos.push({ nome: e.nome, id: (nota as any).id });
    }

    if (entradas.length > MAX_ARQUIVOS) {
      for (const e of entradas.slice(MAX_ARQUIVOS)) {
        recusados.push({ nome: e.nome, erro: "ficou para a próxima leva (limite de 12 por vez)" });
      }
    }

    /* ---------------- 3) lê, casa e acorda o envio ----------------
     * Chamadas em série e com teto de tempo. A leitura por imagem gasta ~25s por
     * arquivo; deixar a tela esperando por doze seria um minuto e meio de
     * ampulheta. Quem não couber aqui é pego pelo cron `:35`, que faz exatamente
     * a mesma coisa — a nota já está gravada, nada se perde. */
    let leitura: unknown = null;
    if (aceitos.length) {
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nota-ler-arquivo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ limite: aceitos.length }),
          signal: AbortSignal.timeout(80_000),
        });
        leitura = r.ok ? await r.json().catch(() => null) : null;
      } catch (_) {
        leitura = null; // o cron :35 lê
      }

      try { await supabase.rpc("notas_externas_casar"); } catch (_) { /* o cron :30 recasa */ }

      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/omie-anexar-comprovante`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ action: "varredura", limite: 6 }),
          signal: AbortSignal.timeout(25_000),
        });
      } catch (_) { /* a varredura de :05/:20/:35/:50 leva */ }
    }

    return json({ ok: true, aceitos, recusados, leitura });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("nota-caixa:", msg);
    return json({ error: msg }, 200);
  }
});
