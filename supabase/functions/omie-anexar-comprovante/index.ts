// Edge Function: omie-anexar-comprovante
//
// Pega os comprovantes que os gestores anexaram pelo link público (bucket privado
// `comprovantes-auditoria`) e os anexa no TÍTULO correspondente do Omie.
//
// Elegível = "aprovado com anexo", que na tela vem de DUAS origens:
//   • achado da tabela `auditoria` com status = "Aprovado" e link_comprovante; e
//   • lançamento do cartão com status_nf = "OK" e comprovante — a tela o exibe como
//     "Aprovado", mas ele NÃO existe em `auditoria` (é linha sintética do front).
//
// O comprovante pode estar em dois lugares:
//   • no bucket `comprovantes-auditoria` (o gestor subiu pelo link público) → sempre legível;
//   • num link do Google Drive (veio do n8n) → só legível se o conector do Drive estiver
//     configurado (LOVABLE_API_KEY + GOOGLE_DRIVE_API_KEY). Sem ele, o item fica bloqueado
//     e a saída é a ação "anexar_arquivo".
//
// O título do Omie NÃO está gravado em lugar nenhum (o omie-match-cartao só guardava a
// categoria), então ele é reencontrado aqui com a MESMA lógica de casamento
// (_shared/match-cartao.ts) — valor exato + data próxima + semelhança de texto.
//
// Confiança do casamento (decisão do cliente):
//   • "alta"  → pode enviar direto
//   • média / baixa / sem match → NÃO envia sozinho; o front lista e a pessoa confirma
//     uma a uma, vendo o título que foi encontrado.
// Se o título já tiver anexo no Omie, ACRESCENTA (nunca substitui).
//
// Ações (body.action):
//   "preview"        → lista os elegíveis com o título encontrado. NÃO envia nada.
//   "testar_drive"   → baixa um comprovante do Drive para validar o conector. NÃO toca no Omie.
//   "enviar"         → envia. Params: { ids?: number[] }.
//   "anexar_arquivo" → a pessoa sobe o arquivo e ele vai direto ao título. { id, nome, base64 }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { incluirAnexo, listarCategorias, listarMovimentos, toBase64 } from "../_shared/omie.ts";
import { casarComOmie, indexarMovimentos, MatchResult } from "../_shared/match-cartao.ts";
import { baixarDoDrive, baseDoDrive, driveConfigurado, ehHtml, extrairIdDrive, podeLerNoDrive, sondarDrive, statusDrive } from "../_shared/drive.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";

const nomeDoPath = (p: string) => {
  const base = p.split("/").pop() || "comprovante";
  // o upload prefixa com timestamp ("1783626823462_nota.pdf") — tira para o Omie
  return base.replace(/^\d{10,}_/, "");
};

/**
 * Código interno do anexo no Omie. O campo cCodIntAnexo aceita NO MÁXIMO 20 caracteres —
 * "hub-ach-{id}-{Date.now()}" dava 26 e o Omie recusava o anexo inteiro. O timestamp vai
 * em base36 (8 caracteres em vez de 13) e o resultado é truncado por garantia.
 */
const codIntAnexo = (id: number): string =>
  `h${id}-${Date.now().toString(36)}`.slice(0, 20);

/**
 * O comprovante pode estar em dois lugares, e só UM deles o servidor consegue ler:
 *
 *   • caminho no bucket `comprovantes-auditoria` (o gestor subiu pelo link público)
 *     → dá para baixar com a service role e mandar ao Omie.
 *
 *   • URL do Google Drive (veio do n8n / preenchimento manual)
 *     → NÃO dá. Baixar sem credencial do Google devolve HTTP 200 com uma PÁGINA DE
 *       LOGIN em HTML (~900 KB). Se anexássemos isso no Omie, viraria um "comprovante"
 *       que só se revela falso quando alguém abre. Por isso é bloqueado explicitamente.
 */
const ehUrl = (v: string) => /^https?:\/\//i.test(v.trim());
const ehCaminhoStorage = (v: string) => !ehUrl(v) && v.includes("/");

type Motivo = null | "drive" | "sem_titulo" | "ja_enviado" | "comprovante_invalido";

type Item = {
  /** id na tabela `auditoria`; negativo = linha sintética vinda do cartão (não é achado) */
  achado_id: number;
  origem: "achado" | "cartao";
  titulo: string;
  valor: number;
  data: string | null;
  comprovante: string;
  cartao_id: number | null;
  cartao_id_unico: string | null;
  estabelecimento: string | null;
  ja_enviado_em: string | null;
  match: MatchResult | null;
  /** null = pode enviar; senão, por que não */
  bloqueio: Motivo;
  /** mensagem específica do bloqueio (ex.: qual conta do Drive não tem acesso) */
  detalhe?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "preview";
    const cTabela = String(body?.anexoTabela ?? "conta-pagar");

    /* -------- 1) Achados (tabela `auditoria`) Aprovados + com comprovante -------- */
    const { data: achados, error: achErr } = await supabase
      .from("auditoria")
      .select("id, id_unico, titulo, valor, data_lancamento, status, link_comprovante, id_transacao")
      .eq("status", "Aprovado")
      .not("link_comprovante", "is", null)
      .neq("link_comprovante", "");
    if (achErr) throw achErr;

    /* -------- 2) Lançamentos do cartão "aprovados direto" + com comprovante -------
     * A tela mostra como "Aprovado" também os lançamentos com status_nf = "OK", que NÃO
     * existem na tabela `auditoria` (são linhas sintéticas montadas pelo front). Eles
     * também contam como "aprovado com anexo" — ignorá-los era o motivo de o botão
     * dizer "nenhum item" com duas linhas Aprovadas na tela.
     */
    const { data: cartoesOk, error: cOkErr } = await supabase
      .from("auditoria_cartao_lancamentos")
      .select("id, id_unico, data, valor, estabelecimento, descricao_original, status_nf, link_comprovante, arquivo_comprovante, omie_anexo_enviado_em")
      .eq("status_nf", "OK")
      .not("link_comprovante", "is", null)
      .neq("link_comprovante", "");
    if (cOkErr) throw cOkErr;

    // Lançamentos de origem dos achados (para casar pelos dados do gasto real).
    const idsTransacao = [...new Set((achados ?? []).map((a: any) => a.id_transacao).filter(Boolean))] as string[];
    const { data: cartoes, error: cartErr } = await supabase
      .from("auditoria_cartao_lancamentos")
      .select("id, id_unico, data, valor, estabelecimento, descricao_original, omie_anexo_enviado_em")
      .in("id_unico", idsTransacao.length ? idsTransacao : ["__nenhum__"]);
    if (cartErr) throw cartErr;
    const cartaoPorId = new Map((cartoes ?? []).map((c: any) => [c.id_unico, c]));

    if (!achados?.length && !cartoesOk?.length) {
      return json({ ok: true, elegiveis: [], total: 0, aviso: "Nenhum lançamento Aprovado com comprovante anexado." });
    }

    /* -------- 3) Reencontra o título no Omie (mesma lógica do match-cartao) -------- */
    const [categorias, movimentos] = await Promise.all([listarCategorias(), listarMovimentos({})]);
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), c.descricao ?? "");
    const byValue = indexarMovimentos(movimentos);

    // Com o conector do Drive configurado, o servidor passa a conseguir baixar o arquivo
    // — e os links do Drive deixam de ser um bloqueio. Sem ele, continuam bloqueados e a
    // saída é a ação "anexar_arquivo" (a pessoa baixa do Drive e sobe pelo Hub).
    const comDrive = driveConfigurado();

    /** Decide por que um item não pode ser enviado (null = pode). */
    const motivo = (comprovante: string, match: MatchResult | null, jaEnviado: string | null): Motivo => {
      if (jaEnviado) return "ja_enviado";
      if (ehUrl(comprovante)) {
        const id = extrairIdDrive(comprovante);
        // URL que não é do Drive (ou sem id reconhecível) não tem como ser baixada.
        if (!id) return "comprovante_invalido";
        if (!comDrive) return "drive";
        // Com credencial, só falta o destino.
        return match?.codTitulo ? null : "sem_titulo";
      }
      if (!ehCaminhoStorage(comprovante)) return "comprovante_invalido"; // só o nome do arquivo
      if (!match?.codTitulo) return "sem_titulo";
      return null;
    };

    const daAuditoria: Item[] = (achados ?? []).map((a: any) => {
      const c = a.id_transacao ? cartaoPorId.get(a.id_transacao) : null;
      // Casa pelos dados do CARTÃO (é o gasto real). Sem lançamento de origem, cai para
      // os dados do próprio achado — pior, mas melhor que nada.
      const base = c ?? { valor: a.valor, data: a.data_lancamento, estabelecimento: a.titulo, descricao_original: null };
      const match = casarComOmie(base as any, byValue, codToDesc);
      const comprovante = String(a.link_comprovante ?? "");
      const jaEnviado = c?.omie_anexo_enviado_em ?? null;
      return {
        achado_id: a.id,
        origem: "achado" as const,
        titulo: a.titulo,
        valor: Number(a.valor ?? 0),
        data: a.data_lancamento ?? null,
        comprovante,
        cartao_id: c?.id ?? null,
        cartao_id_unico: c?.id_unico ?? null,
        estabelecimento: c?.estabelecimento ?? null,
        ja_enviado_em: jaEnviado,
        match: match?.codTitulo ? match : null,
        bloqueio: motivo(comprovante, match, jaEnviado),
      };
    });

    // Evita listar duas vezes o mesmo gasto (achado + lançamento de origem).
    const jaCobertos = new Set(daAuditoria.map((i) => i.cartao_id_unico).filter(Boolean));

    const doCartao: Item[] = (cartoesOk ?? [])
      .filter((c: any) => !jaCobertos.has(c.id_unico))
      .map((c: any) => {
        const match = casarComOmie(c as any, byValue, codToDesc);
        const comprovante = String(c.link_comprovante ?? "");
        return {
          // id sintético negativo: não existe achado correspondente em `auditoria`
          achado_id: -c.id,
          origem: "cartao" as const,
          titulo: c.estabelecimento || c.descricao_original || "Lançamento com nota",
          valor: Number(c.valor ?? 0),
          data: c.data ?? null,
          comprovante,
          cartao_id: c.id,
          cartao_id_unico: c.id_unico,
          estabelecimento: c.estabelecimento ?? null,
          ja_enviado_em: c.omie_anexo_enviado_em ?? null,
          match: match?.codTitulo ? match : null,
          bloqueio: motivo(comprovante, match, c.omie_anexo_enviado_em ?? null),
        };
      });

    const elegiveis: Item[] = [...daAuditoria, ...doCartao];

    // Conector configurado NÃO significa arquivo legível. Antes de dizer que um item do
    // Drive está pronto, conferimos que a conta conectada abre AQUELE arquivo — senão a
    // tela mostra tudo verde e o erro só aparece no envio (foi exatamente o que houve).
    // Só metadados, sem baixar conteúdo.
    if (comDrive) {
      const doDrive = elegiveis.filter((e) => !e.bloqueio && ehUrl(e.comprovante));
      for (let i = 0; i < doDrive.length; i += 5) {
        await Promise.all(doDrive.slice(i, i + 5).map(async (e) => {
          const r = await podeLerNoDrive(e.comprovante);
          if (!r.ok) {
            e.bloqueio = "drive";
            e.detalhe = r.erro;
          }
        }));
      }
    }

    /* -------- PREVIEW -------- */
    if (action === "preview") {
      return json({
        ok: true,
        total: elegiveis.length,
        drive_configurado: comDrive,
        // O front usa isso para separar "envia direto", "confirmar" e "não dá".
        elegiveis: elegiveis.map((e) => ({
          ...e,
          pode_enviar_direto: !e.bloqueio && e.match?.conf === "alta",
        })),
      });
    }

    /* -------- TESTAR DRIVE --------
     * Tenta baixar o primeiro comprovante do Drive e diz o que aconteceu, SEM tocar no
     * Omie. Serve para validar o conector do Lovable sem arriscar um anexo errado.
     */
    if (action === "testar_drive") {
      if (!comDrive) {
        const s = statusDrive();
        const faltando = [
          !s.lovable ? "LOVABLE_API_KEY" : null,
          !s.drive ? "GOOGLE_DRIVE_API_KEY" : null,
        ].filter(Boolean);
        return json({
          ok: false,
          drive_configurado: false,
          secrets: s,
          erro:
            `Falta o secret ${faltando.join(" e ")} no Supabase (Edge Functions → Secrets).` +
            (!s.drive && s.lovable
              ? " A LOVABLE_API_KEY já está lá — só falta conectar o Google Drive no Lovable e guardar a chave dessa conexão. A chave do Sheets não serve: é outro conector."
              : ""),
        });
      }
      // Passo 1: o conector responde? Isso separa "rota errada / Drive não vinculado ao
      // projeto" de "conta conectada não vê o arquivo" — o Drive usa 404 para os dois.
      let conta: { email: string; nome: string };
      try {
        conta = await sondarDrive();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("testar_drive: conector não respondeu ·", msg);
        return json({
          ok: false,
          drive_configurado: true,
          conector_ok: false,
          // O corpo cru de cada tentativa vai junto: é o que diz se o slug do gateway está
          // errado ou se a conexão não está vinculada a este projeto.
          erro: msg,
        });
      }

      const alvo = elegiveis.find((e) => ehUrl(e.comprovante) && extrairIdDrive(e.comprovante));
      if (!alvo) {
        return json({ ok: true, drive_configurado: true, conector_ok: true, conta: conta.email, base: baseDoDrive(), aviso: "Conector OK. Nenhum comprovante do Drive para testar." });
      }

      // Passo 2: a conta conectada consegue LER este arquivo?
      try {
        const arq = await baixarDoDrive(alvo.comprovante);
        return json({
          ok: true,
          drive_configurado: true,
          conector_ok: true,
          conta: conta.email,
          base: baseDoDrive(),
          baixou: true,
          lancamento: alvo.estabelecimento ?? alvo.titulo,
          arquivo: arq.nome,
          mime: arq.mime,
          bytes: arq.bytes.length,
        });
      } catch (err) {
        return json({
          ok: false,
          drive_configurado: true,
          conector_ok: true,
          conta: conta.email,
          baixou: false,
          lancamento: alvo.estabelecimento ?? alvo.titulo,
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }

    /* -------- ANEXAR ARQUIVO (upload manual) --------
     * Saída para o caso "drive": o servidor não consegue baixar do Google, mas a PESSOA
     * consegue (está logada). Ela baixa a nota do Drive e sobe aqui; o arquivo vai para o
     * título do Omie e fica guardado no nosso bucket. Params: { id, nome, base64 }.
     */
    if (action === "anexar_arquivo") {
      const id = Number(body?.id);
      const nomeArq = String(body?.nome ?? "comprovante").slice(0, 120);
      const base64 = String(body?.base64 ?? "");
      if (!id || !base64) return json({ error: "Parâmetros faltando (id, base64)." }, 200);

      const item = elegiveis.find((e) => e.achado_id === id);
      if (!item) return json({ error: "Lançamento não está mais na lista de elegíveis." }, 200);
      if (!item.match?.codTitulo) {
        return json({ error: "Não achei o título correspondente no Omie — não há onde anexar." }, 200);
      }

      // base64 → bytes
      let bytes: Uint8Array;
      try {
        const limpo = base64.replace(/^data:[^;]+;base64,/, "");
        bytes = Uint8Array.from(atob(limpo), (c) => c.charCodeAt(0));
      } catch {
        return json({ error: "Arquivo inválido (base64)." }, 200);
      }
      if (!bytes.length) return json({ error: "Arquivo vazio." }, 200);
      if (bytes.length > 10 * 1024 * 1024) return json({ error: "Arquivo maior que 10 MB." }, 200);

      // Mesma trava do envio: se alguém subir por engano o HTML que o Drive devolve,
      // recusamos — um "comprovante" que é uma tela de login é pior que nenhum.
      if (ehHtml(bytes)) {
        return json({ error: "Isso é uma página HTML, não um comprovante. Baixe o arquivo do Drive e envie o PDF/imagem." }, 200);
      }

      // Guarda no bucket (nosso rastro do que foi mandado ao Omie).
      const seguro = nomeArq.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `hub/${item.cartao_id_unico ?? item.achado_id}/${Date.now()}_${seguro}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: body?.mime ? String(body.mime) : undefined,
        upsert: false,
      });
      if (upErr) return json({ error: `Falha ao guardar o arquivo: ${upErr.message}` }, 200);

      // Anexa no título do Omie (acrescenta, nunca substitui).
      await incluirAnexo({
        nId: item.match.codTitulo,
        cTabela,
        nome: nomeArq,
        base64: toBase64(bytes),
        codInt: codIntAnexo(item.achado_id),
      });

      const agora = new Date().toISOString();
      if (item.cartao_id) {
        await supabase.from("auditoria_cartao_lancamentos").update({
          omie_cod_titulo: item.match.codTitulo,
          omie_anexo_enviado_em: agora,
          omie_anexo_nome: nomeArq,
          updated_at: agora,
        }).eq("id", item.cartao_id);
      }
      if (item.origem === "achado") {
        const { data: atual } = await supabase.from("auditoria").select("trilha").eq("id", item.achado_id).maybeSingle();
        const trilha = Array.isArray((atual as any)?.trilha) ? (atual as any).trilha : [];
        await supabase.from("auditoria").update({
          trilha: [...trilha, {
            evento: "comprovante_enviado_omie",
            canal: "hub_upload",
            omie_cod_titulo: item.match.codTitulo,
            confianca: item.match.conf,
            arquivo: nomeArq,
            timestamp: agora,
          }],
          updated_at: agora,
        }).eq("id", item.achado_id);
      }

      return json({ ok: true, anexado: true, omie_cod_titulo: item.match.codTitulo, arquivo: nomeArq, storage_path: path });
    }

    /* -------- ENVIAR -------- */
    if (action !== "enviar") return json({ error: `Ação desconhecida: ${action}` }, 200);

    const idsPedidos: number[] | null = Array.isArray(body?.ids) ? body.ids.map(Number) : null;
    const alvos = elegiveis.filter((e) => {
      // `bloqueio` já cobre: já enviado, comprovante no Drive, sem título, nome solto.
      // Nenhum deles é contornável pela confirmação do usuário — não é questão de
      // confiança, é que o arquivo ou o destino não existem para o servidor.
      if (e.bloqueio) return false;
      // Sem lista explícita → só os de confiança alta. Com lista → a pessoa já confirmou.
      return idsPedidos ? idsPedidos.includes(e.achado_id) : e.match!.conf === "alta";
    });

    const enviados: any[] = [];
    const falhas: any[] = [];

    for (const e of alvos) {
      try {
        // 3a) Busca o arquivo — do Drive ou do nosso bucket, conforme a origem.
        let bytes: Uint8Array;
        let nome: string;

        if (ehUrl(e.comprovante)) {
          const arq = await baixarDoDrive(e.comprovante);   // já recusa HTML e arquivo vazio
          bytes = arq.bytes;
          nome = arq.nome;
        } else {
          const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(e.comprovante);
          if (dlErr || !blob) throw new Error(`Falha ao baixar do storage: ${dlErr?.message ?? "arquivo não encontrado"}`);
          bytes = new Uint8Array(await blob.arrayBuffer());
          nome = nomeDoPath(e.comprovante);
        }

        // Cinto de segurança: nunca anexar uma página HTML no Omie. Um download que
        // "deu certo" mas veio da tela de login viraria um anexo falso, com cara de nota.
        if (ehHtml(bytes)) throw new Error("O arquivo baixado é uma página HTML, não um comprovante.");
        if (bytes.length === 0) throw new Error("Arquivo vazio.");

        // 3b) Anexa no título do Omie. "Sempre acrescentar": não listamos nem excluímos
        // os anexos que já existem lá — o IncluirAnexo entra ao lado deles.
        await incluirAnexo({
          nId: e.match!.codTitulo,
          cTabela,
          nome,
          base64: toBase64(bytes),
          codInt: codIntAnexo(e.achado_id),
        });

        const agora = new Date().toISOString();

        // 3c) Registra no lançamento do cartão (idempotência + rastreio).
        if (e.cartao_id) {
          await supabase.from("auditoria_cartao_lancamentos").update({
            omie_cod_titulo: e.match!.codTitulo,
            omie_anexo_enviado_em: agora,
            omie_anexo_nome: nome,
            updated_at: agora,
          }).eq("id", e.cartao_id);
        }

        // 3d) Deixa rastro na trilha do achado — só existe quando a origem é a tabela
        // `auditoria`. As linhas vindas do cartão têm id sintético (negativo) e não têm
        // achado correspondente; para elas o rastro é o omie_anexo_enviado_em acima.
        if (e.origem === "achado") {
          const { data: atual } = await supabase.from("auditoria").select("trilha").eq("id", e.achado_id).maybeSingle();
          const trilha = Array.isArray((atual as any)?.trilha) ? (atual as any).trilha : [];
          await supabase.from("auditoria").update({
            trilha: [...trilha, {
              evento: "comprovante_enviado_omie",
              canal: "hub",
              omie_cod_titulo: e.match!.codTitulo,
              confianca: e.match!.conf,
              arquivo: nome,
              timestamp: agora,
            }],
            updated_at: agora,
          }).eq("id", e.achado_id);
        }

        enviados.push({
          achado_id: e.achado_id, titulo: e.titulo,
          omie_cod_titulo: e.match!.codTitulo, confianca: e.match!.conf, arquivo: nome,
        });
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        // Vai para o log da função: a resposta sai com HTTP 200 (erro no corpo), então
        // sem isto a falha não aparece em lugar nenhum que dê para investigar depois.
        console.error(`envio falhou · ${e.titulo} · título ${e.match?.codTitulo} · ${erro}`);
        falhas.push({ achado_id: e.achado_id, titulo: e.titulo, erro });
      }
    }

    return json({
      ok: true,
      enviados: enviados.length,
      falhas: falhas.length,
      detalhe_enviados: enviados,
      detalhe_falhas: falhas,
      ignorados: elegiveis.length - alvos.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message
      : (e && typeof e === "object")
        ? ([(e as any).message, (e as any).details, (e as any).hint].filter(Boolean).join(" — ") || JSON.stringify(e))
        : String(e);
    console.error("omie-anexar-comprovante error:", msg);
    return json({ error: msg }, 200);
  }
});
