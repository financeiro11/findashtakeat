// Edge Function: auditoria-excluir-comprovante
//
// TIRAR O COMPROVANTE ERRADO — do Hub e, se a pessoa marcar, do título no Omie.
//
// O "Anexar comprovante" da Auditoria sabia pôr e não sabia tirar: um PDF de
// outra compra subia, a linha virava COM NF, a conferência às vezes até
// aprovava sozinha, e o único jeito de desfazer era abrir o banco e o ERP.
//
// DUAS CHAMADAS, PORQUE APAGAR NO ERP NÃO TEM DESFAZER:
//   1. sem `aplicar` → só LÊ: o arquivo do Hub e a lista de anexos do título,
//      cada um dizendo se foi o Hub que mandou. A tela pré-marca esses.
//   2. com `aplicar: true` + `omie_nomes` → apaga o que foi marcado, um a um,
//      com as guardas da `omie-anexo-remover` (nome único, resolve tudo contra
//      uma leitura só, e confere relendo — o Omie responde 200 para coisa que
//      não fez). Se algum nome pedido não passa na guarda, NADA é apagado.
//
// O QUE ACONTECE COM A LINHA. O arquivo do Hub sempre sai (é ele o errado): o
// caminho some de `link_comprovante` nos dois lados da mesma nota (achado e
// lançamento do cartão), o objeto é apagado do bucket, e os carimbos de envio
// ao Omie são limpos. Sem o carimbo e sem o caminho, a varredura de envio não
// tem o que reenviar — limpar só o carimbo e manter o arquivo faria o cron
// mandar o mesmo PDF errado de volta em 15 minutos.
//
// A categoria só volta a SEM NF se o título do Omie ficou sem anexo: a nota
// posta à mão no ERP continua sendo nota. E a aprovação automática que leu o
// arquivo excluído é desfeita (ver `desfazerAprovacao`).
//
// Body:
//   { origem: "achado" | "cartao" | "pix", id_unico: string,
//     aplicar?: boolean, omie_nomes?: string[] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthError, requireUser } from "../_shared/auth.ts";
import { listarAnexos, omieCall, type AnexoDoOmie } from "../_shared/omie-rpc.ts";
import {
  anexosParaEscolher,
  desfazerAprovacao,
  fraseDaRecusa,
  leituraDoTitulo,
  nomeDoCaminho,
  resolverExclusao,
} from "../_shared/anexo-exclusao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
const TABELA_OMIE = "conta-pagar";
/** O que conta como "tem papel" na base do cartão — perder o papel volta a SEM NF. */
const STATUS_NF_COM_PAPEL = new Set(["OK", "OK (conferir)", "SÓ COMPROVANTE"]);

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ehCaminhoDoBucket = (v: string | null) => !!v && !/^https?:\/\//i.test(v) && v.includes("/");
const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Origem = "achado" | "cartao" | "pix";

const COLS_ACHADO =
  "id, id_unico, status, categoria, trilha, link_comprovante, id_transacao, omie_cod_titulo, omie_anexo_nome, ia_arquivo, ia_aprovado_em";
const COLS_CARTAO =
  "id, id_unico, link_comprovante, arquivo_comprovante, status_nf, omie_cod_titulo, omie_anexo_nome";

type Alvo = {
  /** o comprovante guardado no Hub (caminho no bucket ou link do Drive) */
  link: string | null;
  /** o nome que a tela mostra */
  arquivo: string | null;
  codTitulo: string | null;
  /** o nome com que o Hub mandou ao Omie — é o que a tela pré-marca */
  nomeNoOmie: string | null;
  achados: any[];
  cartoes: any[];
  pix: any | null;
};

const codNumerico = (v: unknown) => {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? s : null;
};

async function carregarAlvo(supa: any, origem: Origem, idUnico: string): Promise<Alvo | null> {
  if (origem === "pix") {
    const { data: p, error } = await supa.from("auditoria_pix_lancamentos")
      .select("id, id_unico, status, tem_comprovante, comprovante_url, anexo_nome, omie_anexo_nome")
      .eq("id_unico", idUnico).maybeSingle();
    if (error) throw error;
    if (!p) return null;
    // `id_unico` do PIX É o nCodTitulo, e o anexo mora só no Omie: não há arquivo do Hub.
    return {
      link: null, arquivo: p.anexo_nome ?? null, codTitulo: codNumerico(p.id_unico),
      nomeNoOmie: p.omie_anexo_nome || p.anexo_nome || null, achados: [], cartoes: [], pix: p,
    };
  }

  if (origem === "achado") {
    const { data: a, error } = await supa.from("auditoria").select(COLS_ACHADO).eq("id_unico", idUnico).maybeSingle();
    if (error) throw error;
    if (!a) return null;
    let c: any = null;
    if (a.id_transacao) {
      const r = await supa.from("auditoria_cartao_lancamentos").select(COLS_CARTAO).eq("id_unico", a.id_transacao).maybeSingle();
      if (r.error) throw r.error;
      c = r.data;
    }
    // Mesma precedência da tela: o link do achado e, vazio, o do lançamento de origem.
    const link = a.link_comprovante || c?.link_comprovante || null;
    return {
      link,
      arquivo: nomeDoCaminho(link) || c?.arquivo_comprovante || link,
      codTitulo: codNumerico(c?.omie_cod_titulo ?? a.omie_cod_titulo),
      nomeNoOmie: a.omie_anexo_nome || c?.omie_anexo_nome || nomeDoCaminho(link) || c?.arquivo_comprovante || null,
      achados: [a], cartoes: c ? [c] : [], pix: null,
    };
  }

  const { data: c, error } = await supa.from("auditoria_cartao_lancamentos").select(COLS_CARTAO).eq("id_unico", idUnico).maybeSingle();
  if (error) throw error;
  if (!c) return null;
  const { data: achados, error: errA } = await supa.from("auditoria").select(COLS_ACHADO).eq("id_transacao", idUnico);
  if (errA) throw errA;
  return {
    link: c.link_comprovante || null,
    arquivo: c.arquivo_comprovante || nomeDoCaminho(c.link_comprovante) || c.link_comprovante || null,
    codTitulo: codNumerico(c.omie_cod_titulo),
    nomeNoOmie: c.omie_anexo_nome || c.arquivo_comprovante || nomeDoCaminho(c.link_comprovante) || null,
    achados: achados ?? [], cartoes: [c], pix: null,
  };
}

/**
 * Grava a releitura em `omie_titulo_anexo`, para o clipe da tela não continuar
 * mostrando o arquivo que acabou de sair até a próxima varredura passar.
 *
 * A revisão de gente e a leitura da IA eram sobre o conjunto que existia: com
 * arquivo removido, a revisão cai, e a leitura cai se foi do arquivo removido.
 */
async function gravarLeituraDoTitulo(
  supa: any, cod: string, anexos: AnexoDoOmie[], removidos: { nome: string; id: string }[],
) {
  const { qtd, parece_nota, classe } = leituraDoTitulo(anexos);
  const { data: atual } = await supa.from("omie_titulo_anexo").select("ia_arquivo").eq("cod_titulo", Number(cod)).maybeSingle();
  const saiu = new Set(removidos.flatMap((r) => [r.nome, r.id]));
  const linha: Record<string, unknown> = {
    cod_titulo: Number(cod),
    c_tabela: TABELA_OMIE,
    qtd,
    anexos: anexos.map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho })),
    parece_nota,
    classe,
    lido_em: new Date().toISOString(),
    erro: null,
    retentar: true,
    revisao: null,
    revisado_em: null,
    revisado_por: null,
  };
  if (qtd === 0 || (atual?.ia_arquivo && saiu.has(atual.ia_arquivo))) {
    Object.assign(linha, { ia_leitura: null, ia_veredito: null, ia_motivo: null, ia_conferido_em: null, ia_arquivo: null });
  }
  const { error } = await supa.from("omie_titulo_anexo").upsert(linha, { onConflict: "cod_titulo" });
  if (error) console.warn("omie_titulo_anexo não atualizado:", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    // A mesma capacidade que abre /governanca/auditoria no PORTAO (src/lib/modules.ts).
    if (!caller.isService && !caller.pode("conciliacao")) {
      return json({ error: "Seu perfil não tem acesso à Auditoria." });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const origem = String(body?.origem ?? "") as Origem;
    const idUnico = String(body?.id_unico ?? "").trim();
    const aplicar = body?.aplicar === true;
    const pedidos: string[] = Array.isArray(body?.omie_nomes)
      ? [...new Set((body.omie_nomes as unknown[]).map((n) => String(n ?? "").trim()).filter(Boolean))].slice(0, 20)
      : [];

    if (!["achado", "cartao", "pix"].includes(origem)) return json({ error: "Origem inválida." });
    if (!idUnico) return json({ error: "Falta o id_unico do lançamento." });

    const alvo = await carregarAlvo(supabase, origem, idUnico);
    if (!alvo) return json({ error: `Lançamento ${idUnico} não encontrado.` });

    const antes = alvo.codTitulo ? await listarAnexos(alvo.codTitulo, TABELA_OMIE) : null;

    /* ------------------------------ prévia ------------------------------ */
    if (!aplicar) {
      return json({
        ok: true,
        aplicou: false,
        hub: alvo.link ? { arquivo: alvo.arquivo, no_bucket: ehCaminhoDoBucket(alvo.link) } : null,
        omie: alvo.codTitulo && antes
          ? {
            cod_titulo: alvo.codTitulo,
            lido: antes.ok,
            erro: antes.ok ? null : (antes.erro ?? "leitura recusada pelo Omie"),
            anexos: antes.ok ? anexosParaEscolher(antes.anexos, alvo.nomeNoOmie) : [],
          }
          : null,
      });
    }

    /* ------------------------------ aplicar ----------------------------- */
    if (!alvo.link && !pedidos.length) {
      return json({ error: "Nada para excluir: não há comprovante no Hub e nenhum anexo do Omie foi marcado." });
    }

    const removidos: { nome: string; id: string }[] = [];
    const falhas: string[] = [];
    let depois: { anexos: AnexoDoOmie[]; lido_em: string } | null = null;

    if (pedidos.length) {
      if (!alvo.codTitulo || !antes) return json({ error: "Este lançamento não tem título casado no Omie." });
      if (!antes.ok) {
        return json({ error: `Não consegui ler os anexos do título no Omie (${antes.erro}). Nada foi apagado — tente de novo em instantes.` });
      }
      // Tudo ou nada na guarda: um nome que não passa trava a exclusão inteira,
      // antes de qualquer chamada que não se desfaz.
      const { apagar, recusas } = resolverExclusao(antes.anexos, pedidos);
      if (recusas.length) return json({ error: `Nada foi apagado: ${recusas.map(fraseDaRecusa).join("; ")}.` });

      const erroDe = new Map<string, string>();
      for (const [i, a] of apagar.entries()) {
        if (i > 0) await espera(1_200);
        try {
          await omieCall("geral/anexo", "ExcluirAnexo", { nId: Number(alvo.codTitulo), cTabela: TABELA_OMIE, nIdAnexo: a.id });
        } catch (e) {
          erroDe.set(a.nome, msgDe(e).slice(0, 200));
        }
      }

      /* O 200 do Omie não é prova. Reler é — depois de esperar, porque reler o
         mesmo título colado na leitura anterior é o que ele chama de redundante. */
      await espera(4_000);
      const releitura = await listarAnexos(alvo.codTitulo, TABELA_OMIE);
      if (releitura.ok) {
        depois = { anexos: releitura.anexos, lido_em: new Date().toISOString() };
        const ficou = new Set(releitura.anexos.map((a) => a.nome ?? ""));
        for (const a of apagar) {
          if (!ficou.has(a.nome)) removidos.push(a);
          else falhas.push(`${a.nome}: ${erroDe.get(a.nome) ?? "continua no título"}`);
        }
        if (removidos.length) await gravarLeituraDoTitulo(supabase, alvo.codTitulo, releitura.anexos, removidos);
      } else {
        // Sem releitura não se afirma nada — nem que saiu, nem que ficou.
        for (const a of apagar) falhas.push(`${a.nome}: ${erroDe.get(a.nome) ?? `não deu para conferir (${releitura.erro})`}`);
      }
    }

    const hubSaiu = !!alvo.link;
    if (!hubSaiu && !removidos.length) {
      return json({ error: `Nada foi apagado. ${falhas.join("; ")}` });
    }

    // O que sobrou de papel no título. Sem título casado, o Hub era o único papel.
    const restantes: string[] = depois
      ? depois.anexos.map((a) => a.nome ?? "?")
      : antes?.ok ? antes.anexos.map((a) => a.nome ?? "?") : [];
    const semPapel = restantes.length === 0;

    const agora = new Date().toISOString();
    const por = caller.email ?? "hub";
    const doOmie = removidos.length ? ` · removido do Omie: ${removidos.map((r) => r.nome).join(", ")}` : "";
    let aviso: string | null = null;
    let statusNovo: string | null = null;

    /* ------------------------------- PIX -------------------------------- */
    if (origem === "pix" && alvo.pix && removidos.length) {
      const p = alvo.pix;
      const patch: Record<string, unknown> = {
        updated_at: agora,
        omie_anexo_enviado_em: null,
        omie_anexo_nome: null,
        tem_comprovante: !semPapel,
        anexo_nome: restantes[0] ?? null,
        // Era o link do primeiro anexo — talvez o que saiu. Com anexo sobrando,
        // `anexo_verificado = false` faz o passo "anexos" buscar o link do que ficou.
        comprovante_url: null,
        anexo_verificado: semPapel,
      };
      if (semPapel && p.status === "Aprovado") { patch.status = "Pendente"; statusNovo = "Pendente"; }
      const { error } = await supabase.from("auditoria_pix_lancamentos").update(patch).eq("id", p.id);
      if (error) return json({ error: `Anexo removido do Omie, mas falhou ao gravar a linha do PIX: ${error.message}` });
    }

    /* ------------------------- achado e cartão -------------------------- */
    if (origem !== "pix") {
      // Primeiro a linha que a pessoa clicou: se ela não aceitar, o arquivo fica
      // no bucket e a tela não mente sobre o que foi feito.
      const principal = origem === "achado" ? "achado" : "cartao";

      for (const c of alvo.cartoes) {
        // Outro papel no lançamento do cartão (não o que está saindo) não é mexido.
        if (c.link_comprovante && c.link_comprovante !== alvo.link) continue;
        const patch: Record<string, unknown> = { updated_at: agora };
        if (hubSaiu) Object.assign(patch, { link_comprovante: null, arquivo_comprovante: null });
        if (hubSaiu || removidos.length) Object.assign(patch, { omie_anexo_enviado_em: null, omie_anexo_nome: null });
        if (semPapel && STATUS_NF_COM_PAPEL.has(c.status_nf)) patch.status_nf = "SEM NF";
        const { error } = await supabase.from("auditoria_cartao_lancamentos").update(patch).eq("id", c.id);
        if (error) {
          if (principal === "cartao") return json({ error: `Não consegui gravar o lançamento do cartão: ${error.message}` });
          console.warn("cartão vinculado não atualizado:", error.message);
        }
      }

      for (const a of alvo.achados) {
        if (a.link_comprovante && a.link_comprovante !== alvo.link) continue;
        const patch: Record<string, unknown> = {
          updated_at: agora, omie_anexo_enviado_em: null, omie_anexo_nome: null,
        };
        const mudancas: string[] = [];
        if (hubSaiu) patch.link_comprovante = null;
        if (semPapel && a.categoria === "COM NF") { patch.categoria = "SEM NF"; mudancas.push("categoria → SEM NF"); }
        const volta = desfazerAprovacao(a, alvo.link);
        if (volta) {
          patch.status = volta.status;
          patch.ia_aprovado_em = null;
          mudancas.push(`status → ${volta.status} (a aprovação automática tinha lido este arquivo)`);
          if (origem === "achado") statusNovo = volta.status;
        }
        const trilha = Array.isArray(a.trilha) ? a.trilha : [];
        patch.trilha = [...trilha, {
          em: agora,
          por,
          tipo: "comprovante_excluido",
          arquivo: alvo.arquivo,
          ...(volta ? { de: "Aprovado", para: volta.status } : {}),
          texto: `Comprovante excluído pelo Hub: ${hubSaiu ? alvo.arquivo ?? "arquivo" : "só no Omie"}${doOmie}` +
            (mudancas.length ? ` · ${mudancas.join(" · ")}` : ""),
        }];
        const { error } = await supabase.from("auditoria").update(patch).eq("id", a.id);
        if (error) {
          if (principal === "achado") return json({ error: `Não consegui gravar o achado: ${error.message}` });
          console.warn("achado vinculado não atualizado:", error.message);
        }
      }

      // Por último o objeto: só depois de nenhuma linha apontar mais para ele.
      if (hubSaiu && ehCaminhoDoBucket(alvo.link)) {
        const { error } = await supabase.storage.from(BUCKET).remove([alvo.link!.replace(/^\/+/, "")]);
        if (error) aviso = `O lançamento ficou sem o comprovante, mas o arquivo não saiu do armazenamento: ${error.message}`;
      }
    }

    return json({
      ok: true,
      aplicou: true,
      hub_removido: hubSaiu && origem !== "pix",
      omie: {
        removidos: removidos.map((r) => r.nome),
        falhas,
        restantes,
        depois: depois ? { ...leituraDoTitulo(depois.anexos), lido_em: depois.lido_em } : null,
      },
      sem_papel: semPapel,
      status_novo: statusNovo,
      aviso,
    });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, 401);
    console.error("auditoria-excluir-comprovante:", msgDe(e));
    return json({ error: msgDe(e) });
  }
});
