// Edge Function: omie-anexar-comprovante
//
// Anexa no TÍTULO correspondente do Omie os comprovantes dos lançamentos aprovados.
//
// Elegível = "aprovado com anexo", que na tela vem de DUAS origens:
//   • achado da tabela `auditoria` com status = "Aprovado" e link_comprovante; e
//   • lançamento do cartão com status_nf = "OK" e comprovante — a tela o exibe como
//     "Aprovado", mas ele NÃO existe em `auditoria` (é linha sintética do front).
//
// O comprovante pode estar no bucket `comprovantes-auditoria` (sempre legível) ou num
// link do Google Drive (legível com o conector ligado E a conta com acesso ao arquivo).
//
// O título do Omie é reencontrado por casamento (_shared/match-cartao.ts): valor exato +
// data próxima + semelhança de texto. O anexo em si passa por _shared/omie.ts:incluirAnexo,
// que ZIPA o arquivo (exigência do Omie) e CONFIRMA que o anexo colou.
//
// Ações (body.action):
//   "preview"        → lista os elegíveis (respeitando `escopo`); confere leitura no Drive.
//   "testar_drive"   → sonda o conector do Drive. NÃO toca no Omie.
//   "enviar"         → envia. Params: { ids?: number[], escopo?: string[], todos?: bool }.
//   "anexar_arquivo" → a pessoa sobe o arquivo e ele vai direto ao título. { id, nome, base64 }.
//
// `escopo` = id_transacao dos lançamentos visíveis com os filtros da tela (fatura +
// responsável + busca…). Amarra o envio ao que está na tela; um único id = envio individual.

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
  return base.replace(/^\d{10,}_/, "");   // o upload prefixa com timestamp
};

// cCodIntAnexo aceita 20 caracteres; timestamp em base36 (o helper ainda trunca por garantia).
const codIntAnexo = (id: number): string => `h${id}-${Date.now().toString(36)}`.slice(0, 20);

const ehUrl = (v: string) => /^https?:\/\//i.test(v.trim());
const ehCaminhoStorage = (v: string) => !ehUrl(v) && v.includes("/");

type Motivo = null | "drive" | "sem_titulo" | "ja_enviado" | "comprovante_invalido";

type Item = {
  achado_id: number;   // negativo = linha sintética vinda do cartão (não é achado)
  origem: "achado" | "cartao";
  titulo: string;
  valor: number;
  data: string | null;
  comprovante: string;
  cartao_id: number | null;
  cartao_id_unico: string | null;
  id_transacao: string | null;   // chave de casamento com o que a tela mostra
  estabelecimento: string | null;
  ja_enviado_em: string | null;
  match: MatchResult | null;
  bloqueio: Motivo;     // null = pode enviar
  detalhe?: string;     // mensagem específica do bloqueio
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

    /* -------- 2) Lançamentos do cartão "aprovados direto" (status_nf=OK) + com comprovante -------- */
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

    const comDrive = driveConfigurado();

    const motivo = (comprovante: string, match: MatchResult | null, jaEnviado: string | null): Motivo => {
      if (jaEnviado) return "ja_enviado";
      if (ehUrl(comprovante)) {
        const id = extrairIdDrive(comprovante);
        if (!id) return "comprovante_invalido";   // URL que não é do Drive
        if (!comDrive) return "drive";
        return match?.codTitulo ? null : "sem_titulo";
      }
      if (!ehCaminhoStorage(comprovante)) return "comprovante_invalido"; // só o nome do arquivo
      if (!match?.codTitulo) return "sem_titulo";
      return null;
    };

    const daAuditoria: Item[] = (achados ?? []).map((a: any) => {
      const c = a.id_transacao ? cartaoPorId.get(a.id_transacao) : null;
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
        id_transacao: a.id_transacao ?? c?.id_unico ?? null,
        estabelecimento: c?.estabelecimento ?? null,
        ja_enviado_em: jaEnviado,
        match: match?.codTitulo ? match : null,
        bloqueio: motivo(comprovante, match, jaEnviado),
      };
    });

    const jaCobertos = new Set(daAuditoria.map((i) => i.cartao_id_unico).filter(Boolean));

    const doCartao: Item[] = (cartoesOk ?? [])
      .filter((c: any) => !jaCobertos.has(c.id_unico))
      .map((c: any) => {
        const match = casarComOmie(c as any, byValue, codToDesc);
        const comprovante = String(c.link_comprovante ?? "");
        return {
          achado_id: -c.id,
          origem: "cartao" as const,
          titulo: c.estabelecimento || c.descricao_original || "Lançamento com nota",
          valor: Number(c.valor ?? 0),
          data: c.data ?? null,
          comprovante,
          cartao_id: c.id,
          cartao_id_unico: c.id_unico,
          id_transacao: c.id_unico,
          estabelecimento: c.estabelecimento ?? null,
          ja_enviado_em: c.omie_anexo_enviado_em ?? null,
          match: match?.codTitulo ? match : null,
          bloqueio: motivo(comprovante, match, c.omie_anexo_enviado_em ?? null),
        };
      });

    let elegiveis: Item[] = [...daAuditoria, ...doCartao];

    // ESCOPO: a tela manda o recorte visível (filtros de fatura + responsável + busca…) como
    // DUAS chaves, porque nem todo lançamento tem id_transacao: os achados importados direto
    // em `auditoria` (ex.: fatura de Julho) não têm vínculo com o cartão, e para esses a chave
    // é o próprio achado_id. Sem isto o botão ignorava os filtros e/ou pulava esses achados.
    const escIdsUnicos: string[] | null = Array.isArray(body?.escopo?.idsUnicos) ? body.escopo.idsUnicos.map(String) : null;
    const escAchados: number[] | null = Array.isArray(body?.escopo?.achadoIds) ? body.escopo.achadoIds.map(Number) : null;
    if (escIdsUnicos || escAchados) {
      const su = new Set(escIdsUnicos ?? []);
      const sa = new Set(escAchados ?? []);
      elegiveis = elegiveis.filter((e) => (e.id_transacao && su.has(e.id_transacao)) || sa.has(e.achado_id));
    }

    // Conector configurado NÃO significa arquivo legível. Antes de dizer que um item do Drive
    // está pronto, conferimos que a conta conectada abre AQUELE arquivo. Só metadados.
    if (comDrive) {
      const doDrive = elegiveis.filter((e) => !e.bloqueio && ehUrl(e.comprovante));
      for (let i = 0; i < doDrive.length; i += 5) {
        await Promise.all(doDrive.slice(i, i + 5).map(async (e) => {
          const r = await podeLerNoDrive(e.comprovante);
          if (!r.ok) { e.bloqueio = "drive"; e.detalhe = r.erro; }
        }));
      }
    }

    /* -------- PREVIEW -------- */
    if (action === "preview") {
      return json({
        ok: true,
        total: elegiveis.length,
        drive_configurado: comDrive,
        elegiveis: elegiveis.map((e) => ({
          ...e,
          pode_enviar_direto: !e.bloqueio && e.match?.conf === "alta",
        })),
      });
    }

    /* -------- TESTAR DRIVE -------- */
    if (action === "testar_drive") {
      if (!comDrive) {
        const s = statusDrive();
        const faltando = [!s.lovable ? "LOVABLE_API_KEY" : null, !s.drive ? "GOOGLE_DRIVE_API_KEY" : null].filter(Boolean);
        return json({ ok: false, drive_configurado: false, secrets: s, erro: `Falta o secret ${faltando.join(" e ")} no Supabase (Edge Functions → Secrets).` });
      }
      let conta: { email: string; nome: string };
      try {
        conta = await sondarDrive();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("testar_drive: conector não respondeu ·", msg);
        return json({ ok: false, drive_configurado: true, conector_ok: false, erro: msg });
      }
      const alvo = elegiveis.find((e) => ehUrl(e.comprovante) && extrairIdDrive(e.comprovante));
      if (!alvo) {
        return json({ ok: true, drive_configurado: true, conector_ok: true, conta: conta.email, base: baseDoDrive(), aviso: "Conector OK. Nenhum comprovante do Drive para testar." });
      }
      try {
        const arq = await baixarDoDrive(alvo.comprovante);
        return json({ ok: true, drive_configurado: true, conector_ok: true, conta: conta.email, base: baseDoDrive(), baixou: true, lancamento: alvo.estabelecimento ?? alvo.titulo, arquivo: arq.nome, mime: arq.mime, bytes: arq.bytes.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("testar_drive: download falhou ·", msg);
        return json({ ok: false, drive_configurado: true, conector_ok: true, conta: conta.email, base: baseDoDrive(), baixou: false, lancamento: alvo.estabelecimento ?? alvo.titulo, erro: msg });
      }
    }

    /* -------- ANEXAR ARQUIVO (upload manual) -------- */
    if (action === "anexar_arquivo") {
      const id = Number(body?.id);
      const nomeArq = String(body?.nome ?? "comprovante").slice(0, 120);
      const base64 = String(body?.base64 ?? "");
      if (!id || !base64) return json({ error: "Parâmetros faltando (id, base64)." }, 200);

      const item = elegiveis.find((e) => e.achado_id === id);
      if (!item) return json({ error: "Lançamento não está mais na lista de elegíveis." }, 200);
      if (!item.match?.codTitulo) return json({ error: "Não achei o título correspondente no Omie — não há onde anexar." }, 200);

      let bytes: Uint8Array;
      try {
        const limpo = base64.replace(/^data:[^;]+;base64,/, "");
        bytes = Uint8Array.from(atob(limpo), (c) => c.charCodeAt(0));
      } catch {
        return json({ error: "Arquivo inválido (base64)." }, 200);
      }
      if (!bytes.length) return json({ error: "Arquivo vazio." }, 200);
      if (bytes.length > 10 * 1024 * 1024) return json({ error: "Arquivo maior que 10 MB." }, 200);
      if (ehHtml(bytes)) return json({ error: "Isso é uma página HTML, não um comprovante. Baixe o arquivo do Drive e envie o PDF/imagem." }, 200);

      const seguro = nomeArq.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `hub/${item.cartao_id_unico ?? item.achado_id}/${Date.now()}_${seguro}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: body?.mime ? String(body.mime) : undefined, upsert: false });
      if (upErr) return json({ error: `Falha ao guardar o arquivo: ${upErr.message}` }, 200);

      let cTabelaOk: string;
      try {
        const r = await incluirAnexo({ nId: item.match.codTitulo, cTabela, nome: nomeArq, base64: toBase64(bytes), codInt: codIntAnexo(item.achado_id) });
        cTabelaOk = r.cTabela;
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 200);
      }

      const agora = new Date().toISOString();
      if (item.cartao_id) {
        await supabase.from("auditoria_cartao_lancamentos").update({ omie_cod_titulo: item.match.codTitulo, omie_anexo_enviado_em: agora, omie_anexo_nome: nomeArq, updated_at: agora }).eq("id", item.cartao_id);
      }
      if (item.origem === "achado") {
        const { data: atual } = await supabase.from("auditoria").select("trilha").eq("id", item.achado_id).maybeSingle();
        const trilha = Array.isArray((atual as any)?.trilha) ? (atual as any).trilha : [];
        await supabase.from("auditoria").update({ trilha: [...trilha, { evento: "comprovante_enviado_omie", canal: "hub_upload", omie_cod_titulo: item.match.codTitulo, cTabela: cTabelaOk, arquivo: nomeArq, timestamp: agora }], updated_at: agora }).eq("id", item.achado_id);
      }

      return json({ ok: true, anexado: true, omie_cod_titulo: item.match.codTitulo, cTabela: cTabelaOk, arquivo: nomeArq, storage_path: path });
    }

    /* -------- ENVIAR -------- */
    if (action !== "enviar") return json({ error: `Ação desconhecida: ${action}` }, 200);

    const idsPedidos: number[] | null = Array.isArray(body?.ids) ? body.ids.map(Number) : null;
    // `todos`: envio individual (drawer) ou "enviar tudo do escopo" — a pessoa já escolheu,
    // então não filtramos por confiança. Sem isso, cai na regra padrão (só alta automático).
    const todos = body?.todos === true;
    const alvos = elegiveis.filter((e) => {
      if (e.bloqueio) return false; // já enviado / Drive sem acesso / sem título / inválido
      if (idsPedidos) return idsPedidos.includes(e.achado_id); // dialog: itens marcados/auto
      if (todos) return true;                                  // drawer/escopo explícito
      return e.match!.conf === "alta";                         // padrão: só alta
    });

    const enviados: any[] = [];
    const falhas: any[] = [];

    for (const e of alvos) {
      try {
        // Busca o arquivo — do Drive ou do nosso bucket, conforme a origem.
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

        if (ehHtml(bytes)) throw new Error("O arquivo baixado é uma página HTML, não um comprovante.");
        if (bytes.length === 0) throw new Error("Arquivo vazio.");

        // incluirAnexo ZIPA, envia e CONFIRMA que o anexo colou (ou lança com diagnóstico).
        const { cTabela: cTabelaOk, variante } = await incluirAnexo({ nId: e.match!.codTitulo, cTabela, nome, base64: toBase64(bytes), codInt: codIntAnexo(e.achado_id) });
        console.log(`anexo OK · ${e.titulo} · título ${e.match!.codTitulo} · ${cTabelaOk} · ${variante}`);

        const agora = new Date().toISOString();

        if (e.cartao_id) {
          await supabase.from("auditoria_cartao_lancamentos").update({ omie_cod_titulo: e.match!.codTitulo, omie_anexo_enviado_em: agora, omie_anexo_nome: nome, updated_at: agora }).eq("id", e.cartao_id);
        }
        if (e.origem === "achado") {
          const { data: atual } = await supabase.from("auditoria").select("trilha").eq("id", e.achado_id).maybeSingle();
          const trilha = Array.isArray((atual as any)?.trilha) ? (atual as any).trilha : [];
          await supabase.from("auditoria").update({ trilha: [...trilha, { evento: "comprovante_enviado_omie", canal: "hub", omie_cod_titulo: e.match!.codTitulo, cTabela: cTabelaOk, arquivo: nome, timestamp: agora }], updated_at: agora }).eq("id", e.achado_id);
        }

        enviados.push({ achado_id: e.achado_id, titulo: e.titulo, omie_cod_titulo: e.match!.codTitulo, cTabela: cTabelaOk, variante, arquivo: nome });
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        console.error(`envio falhou · ${e.titulo} · título ${e.match?.codTitulo} · ${erro}`);
        falhas.push({ achado_id: e.achado_id, titulo: e.titulo, erro });
      }
    }

    return json({ ok: true, enviados: enviados.length, falhas: falhas.length, detalhe_enviados: enviados, detalhe_falhas: falhas, ignorados: elegiveis.length - alvos.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message
      : (e && typeof e === "object")
        ? ([(e as any).message, (e as any).details, (e as any).hint].filter(Boolean).join(" — ") || JSON.stringify(e))
        : String(e);
    console.error("omie-anexar-comprovante error:", msg);
    return json({ error: msg }, 200);
  }
});
