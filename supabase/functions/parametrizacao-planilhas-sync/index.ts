// Edge Function: parametrizacao-planilhas-sync
//
// Cruza as quatro planilhas de formulário com as contrapartes da DRE/DFC e
// escreve o que elas dizem em `parametrizacao_evidencias`.
//
// POR QUE ISTO EXISTE, e não um modelo adivinhando: as planilhas guardam
// TESTEMUNHO de quem gastou — o site onde comprou, a justificativa escrita à
// mão, o CNPJ do prestador. "KAZEMHAMMOUD" nenhum modelo decifra; a pessoa que
// digitou o formulário já explicou o que era.
//
// AS TRÊS CHAVES, em ordem de confiança:
//   • CNPJ ......... identidade. Vira apelido SOZINHO (confiança alta).
//   • valor+data ... casamento contra a fatura do cartão. Vira PROPOSTA.
//                    Casa-se pela PARCELA, não pelo total: a fatura mostra a
//                    parcela, e casar pelo total achava 31 lojistas onde a
//                    parcela acha 48.
//   • nome ......... último recurso, sempre PROPOSTA.
//
// NUNCA PISA EM NOME ESCRITO À MÃO: o apply só toca `lib_fornecedores.apelido`
// quando ele está vazio. O sync roda toda semana e reprocessa tudo; sem essa
// regra, a segunda rodada desfaria o trabalho da pessoa.
//
// Body: { action?: 'sync' | 'previa' }
//   'previa' faz tudo menos gravar — é como se confere o estrago antes.
// Cron: header `x-cron-token` com o token de `internal_cron_tokens`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import {
  candidatosDeCompras, candidatosDeEventos, candidatosDeReembolsos,
  candidatosDeNfsColaboradores, juntarDetalhes, maisComum, soDigitos,
  type Candidato, type Fonte,
} from "../_shared/planilhas-apelidos.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* As quatro planilhas. O endpoint de export entrega o CSV sem OAuth desde que o
   compartilhamento "qualquer pessoa com o link" siga ativo — mesmo caminho do
   `churn-sheet-sync`. Se alguém desligar, a fonte cai sozinha e as outras três
   continuam (ver `baixar`). */
const PLANILHAS: { fonte: Fonte; id: string; rotulo: string }[] = [
  { fonte: "compras", id: "1Y2jvIpZDrwe30z3M_UVazzBv2BrtJJujT-S0SUt2JqM", rotulo: "Formulário de Compras" },
  { fonte: "reembolsos", id: "1P7O1xRyrybuDQOfw3WIRkne15FOM7bBPMTWweMrCulA", rotulo: "Reembolsos Takeat - NFs" },
  { fonte: "nfs_colaboradores", id: "1jd0-LRwWdElNBttQP0z-8bv_rJ-Hh92aX9eE2pL9uwc", rotulo: "NFS-e (colaboradores)" },
  { fonte: "eventos", id: "1TQU3dph4qOTUpOXPCwp-bahVRxEORE9DjGKX3RRuCNs", rotulo: "NFs - Eventos & Parcerias" },
];

/** Janela do casamento por valor+data: a compra do dia 30 cai na fatura seguinte. */
const DIAS_ANTES = 7;
const DIAS_DEPOIS = 45;
const TOLERANCIA = 0.02;

type Contraparte = {
  origem: string; nome: string; documento: string | null; lancamentos: number;
};
type LinhaCartao = { data: string; valor: number; estabelecimento: string };

/* A MESMA chave normalizada de `src/lib/pessoasPJ.ts` (que por sua vez usa o
   `normalize` de `src/lib/normalize.ts`). Duplicada aqui pelo mesmo motivo que o
   parser: Deno e Vite não dividem módulo. Se um dia divergirem, o apelido casa
   na exibição e não casa aqui — ou o contrário.
   A faixa de acentos vai em escape (`\u0300-\u036f`), nunca com o caractere
   combinante literal: ele não sobrevive a uma cópia entre arquivos. */
function chaveContraparte(s: string | null | undefined): string {
  let t = String(s ?? "").replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  for (;;) {
    const antes = t;
    t = t.replace(/\s+(SOCIEDADE\s+INDIVIDUAL\s+DE\s+ADVOCACIA|UNIPESSOAL|EIRELI|LTDA|EPP|MEI|ME|SS|S\s+A|SA|EI)$/, "").trim();
    if (t === antes) return t;
  }
}

async function baixar(id: string): Promise<{ csv: string | null; erro: string | null }> {
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, {
      redirect: "follow", signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) {
      return { csv: null, erro: r.status === 401 || r.status === 403
        ? "sem acesso — ligue 'qualquer pessoa com o link' nesta planilha"
        : `HTTP ${r.status}` };
    }
    const tipo = r.headers.get("content-type") ?? "";
    const csv = await r.text();
    // Sem compartilhamento o Google devolve 200 com a página de login.
    if (!tipo.includes("csv") || /^\s*<!DOCTYPE html/i.test(csv)) {
      return { csv: null, erro: "sem acesso — ligue 'qualquer pessoa com o link' nesta planilha" };
    }
    return { csv, erro: null };
  } catch (e) {
    return { csv: null, erro: String((e as Error)?.message ?? e) };
  }
}

const lerFonte = (fonte: Fonte, csv: string): Candidato[] =>
  fonte === "compras" ? candidatosDeCompras(csv)
  : fonte === "reembolsos" ? candidatosDeReembolsos(csv)
  : fonte === "nfs_colaboradores" ? candidatosDeNfsColaboradores(csv)
  : candidatosDeEventos(csv);

/** Uma evidência pronta para gravar — já agregada por contraparte. */
type Evidencia = {
  fonte: Fonte;
  contraparte_origem: string;
  contraparte_nome: string;
  chave: string;
  documento_norm: string | null;
  chave_tipo: string;
  confianca: string;
  apelido: string | null;
  o_que_e: string | null;
  detalhe: string | null;
  ocorrencias: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const token = req.headers.get("x-cron-token");
    let ehCron = false;
    if (token) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "parametrizacao-planilhas-sync").eq("token", token).maybeSingle();
      ehCron = !!data;
    }
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const previa = body?.action === "previa";

    /* ---------------- 1. as planilhas ---------------- */
    const fontes: Record<string, { linhas: number; erro: string | null }> = {};
    const candidatos: Candidato[] = [];
    for (const p of PLANILHAS) {
      const { csv, erro } = await baixar(p.id);
      if (!csv) { fontes[p.fonte] = { linhas: 0, erro }; continue; }
      const c = lerFonte(p.fonte, csv);
      candidatos.push(...c);
      fontes[p.fonte] = { linhas: c.length, erro: null };
    }

    /* ---------------- 2. contra o que casar ---------------- */
    const { data: cps, error: eCps } = await supabase.rpc("parametrizacao_contrapartes");
    if (eCps) throw new Error(`contrapartes: ${eCps.message}`);
    const contrapartes = (cps ?? []) as Contraparte[];

    const porDoc = new Map<string, Contraparte>();
    const porNome = new Map<string, Contraparte>();
    for (const c of contrapartes) {
      const d = soDigitos(c.documento);
      if (d.length >= 11 && !porDoc.has(d)) porDoc.set(d, c);
      const k = chaveContraparte(c.nome);
      // Mais lançamentos ganha o nome: se duas contrapartes normalizam igual, a
      // que aparece mais é a que a pessoa tinha em mente.
      const atual = porNome.get(k);
      if (k.length >= 4 && (!atual || c.lancamentos > atual.lancamentos)) porNome.set(k, c);
    }

    /* A fatura, só para o casamento por valor+data. `estabelecimento` já é o
       lojista canônico (o `limparNome` do parser do OFX). */
    const cartao: LinhaCartao[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase.from("cartao_lancamentos")
        .select("data,valor,estabelecimento").range(de, de + 999);
      if (error) throw new Error(`cartao_lancamentos: ${error.message}`);
      const bloco = (data ?? []) as LinhaCartao[];
      cartao.push(...bloco);
      if (bloco.length < 1000) break;
    }

    /* ---------------- 3. casar ---------------- */
    type Balde = { cp: Contraparte; tipo: string; conf: string; apelidos: string[]; oQue: string[]; det: string[]; n: number };
    const baldes = new Map<string, Balde>();   // `${fonte}::${chave}`
    let semCasar = 0;
    let ambiguos = 0;

    const guardar = (fonte: Fonte, cp: Contraparte, c: Candidato, tipo: string, conf: string) => {
      const chave = chaveContraparte(cp.nome);
      const k = `${fonte}::${chave}`;
      const b = baldes.get(k) ?? { cp, tipo, conf, apelidos: [], oQue: [], det: [], n: 0 };
      b.n++;
      if (c.apelido) b.apelidos.push(c.apelido);
      if (c.oQueE) b.oQue.push(c.oQueE);
      if (c.detalhe) b.det.push(c.detalhe);
      baldes.set(k, b);
    };

    for (const c of candidatos) {
      if (c.chaveTipo === "cnpj" && c.cnpj) {
        const cp = porDoc.get(c.cnpj);
        if (!cp) { semCasar++; continue; }
        guardar(c.fonte, cp, c, "cnpj", "alta");
        continue;
      }

      if (c.chaveTipo === "valor_data" && c.data && c.valor) {
        const alvo = new Date(`${c.data}T12:00:00Z`).getTime();
        const achados = new Set<string>();
        for (const l of cartao) {
          if (Math.abs(Math.abs(Number(l.valor)) - c.valor) >= TOLERANCIA) continue;
          const d = new Date(`${l.data}T12:00:00Z`).getTime();
          const dias = (d - alvo) / 86_400_000;
          if (dias < -DIAS_ANTES || dias > DIAS_DEPOIS) continue;
          if (l.estabelecimento) achados.add(l.estabelecimento);
        }
        // Dois lojistas com o mesmo valor na mesma janela: não dá para saber
        // qual foi, e chutar aqui é o que a planilha veio evitar.
        if (achados.size !== 1) { if (achados.size > 1) ambiguos++; else semCasar++; continue; }
        const cp = porNome.get(chaveContraparte([...achados][0]));
        if (!cp) { semCasar++; continue; }
        guardar(c.fonte, cp, c, "valor_data", "media");
        continue;
      }

      if (c.nome) {
        const cp = porNome.get(chaveContraparte(c.nome));
        if (!cp) { semCasar++; continue; }
        guardar(c.fonte, cp, c, "nome", "media");
        continue;
      }
      semCasar++;
    }

    /* ---------------- 4. virar evidência ---------------- */
    const evidencias: Evidencia[] = [];
    for (const [k, b] of baldes) {
      const fonte = k.split("::")[0] as Fonte;
      evidencias.push({
        fonte,
        contraparte_origem: b.cp.origem,
        contraparte_nome: b.cp.nome,
        chave: chaveContraparte(b.cp.nome),
        documento_norm: soDigitos(b.cp.documento) || null,
        chave_tipo: b.tipo,
        confianca: b.conf,
        // Sem apelido na planilha (compra presencial), o nome da contraparte
        // continua valendo — o que a planilha acrescenta é o "o que é".
        apelido: maisComum(b.apelidos),
        o_que_e: maisComum(b.oQue),
        detalhe: juntarDetalhes(b.det),
        ocorrencias: b.n,
      });
    }

    if (previa) {
      return json({
        ok: true, previa: true, fontes,
        candidatos: candidatos.length, evidencias: evidencias.length,
        por_chave: {
          cnpj: evidencias.filter((e) => e.chave_tipo === "cnpj").length,
          valor_data: evidencias.filter((e) => e.chave_tipo === "valor_data").length,
          nome: evidencias.filter((e) => e.chave_tipo === "nome").length,
        },
        sem_casar: semCasar, ambiguos,
        amostra: evidencias.slice(0, 12),
      });
    }

    /* ---------------- 5. gravar ---------------- */
    let gravadas = 0;
    for (let i = 0; i < evidencias.length; i += 200) {
      const lote = evidencias.slice(i, i + 200).map((e) => ({ ...e, atualizado_em: new Date().toISOString() }));
      const { error } = await supabase.from("parametrizacao_evidencias")
        .upsert(lote, { onConflict: "fonte,chave" });
      if (error) throw new Error(`gravar evidências: ${error.message}`);
      gravadas += lote.length;
    }

    /* ---------------- 6. aplicar SÓ o que veio por CNPJ ----------------
       Identidade não é palpite, então entra sozinho. E só onde o apelido está
       vazio: o que alguém escreveu à mão vale mais do que qualquer planilha, e
       este sync roda toda semana. */
    /* Ordem de preferência entre as planilhas, porque a MESMA contraparte pode
       ter CNPJ em duas delas. As NFs de colaborador são um cadastro formal com
       nome completo e setor; Eventos é texto livre. Sem esta ordem, quem
       aplicasse por último ganhava — e "por último" era a ordem do `Map`. */
    const PREFERENCIA: Record<string, number> = {
      nfs_colaboradores: 0, eventos: 1, reembolsos: 2, compras: 3,
    };
    const aplicaveis = evidencias
      .filter((e) => e.chave_tipo === "cnpj" && e.apelido)
      .sort((a, b) => (PREFERENCIA[a.fonte] ?? 9) - (PREFERENCIA[b.fonte] ?? 9));

    /* Quem já foi nomeado NESTA rodada. O mapa do cadastro foi lido antes do
       laço, então `forn.apelido` continua nulo em memória depois do UPDATE —
       sem este controle, a segunda evidência sobrescreveria a primeira. */
    const jaNomeados = new Set<string>();
    let aplicados = 0;
    let criados = 0;

    if (aplicaveis.length) {
      /* O cadastro inteiro de uma vez. `documento` na tabela vem formatado
         ("45.462.019/0001-98"), então o casamento é feito aqui, com os mesmos
         dígitos que o resto do sync usa. */
      const { data: cadastro, error: eCad } = await supabase.from("lib_fornecedores")
        .select("id,nome,documento,apelido,status");
      if (eCad) throw new Error(`cadastro: ${eCad.message}`);

      const fornPorDoc = new Map<string, Record<string, unknown>>();
      const fornPorNome = new Map<string, Record<string, unknown>>();
      for (const f of cadastro ?? []) {
        const d = soDigitos(String(f.documento ?? ""));
        if (d.length >= 11) fornPorDoc.set(d, f);
        fornPorNome.set(chaveContraparte(String(f.nome ?? "")), f);
      }

      const agora = new Date().toISOString();
      for (const e of aplicaveis) {
        const forn = (e.documento_norm ? fornPorDoc.get(e.documento_norm) : undefined)
          ?? fornPorNome.get(e.chave);

        if (forn) {
          const id = String(forn.id);
          if (forn.status === "ignorado") continue;
          if (jaNomeados.has(id)) continue;                  // já nomeado nesta rodada
          if (String(forn.apelido ?? "").trim()) continue;   // já tem nome: não pisa
          const { error } = await supabase.from("lib_fornecedores").update({
            apelido: e.apelido, o_que_e: e.o_que_e, atualizado_em: agora,
          }).eq("id", forn.id);
          if (error) continue;
          jaNomeados.add(id);
          aplicados++;
        } else {
          // Contraparte que existe no Omie mas ainda não tinha cadastro na
          // Biblioteca. Nasce já nomeada.
          const { error } = await supabase.from("lib_fornecedores").insert({
            nome: e.contraparte_nome,
            documento: e.documento_norm,
            apelido: e.apelido, o_que_e: e.o_que_e,
            origem: e.contraparte_origem === "cartao" ? "cartao" : "omie",
          });
          if (error) continue;
          criados++;
          aplicados++;
        }

        await supabase.from("parametrizacao_evidencias")
          .update({ aplicado_em: agora })
          .eq("fonte", e.fonte).eq("chave", e.chave);
      }
    }

    return json({
      ok: true, fontes,
      candidatos: candidatos.length,
      evidencias: gravadas,
      aplicados_por_cnpj: aplicados,
      cadastros_criados: criados,
      propostas: gravadas - aplicados,
      sem_casar: semCasar, ambiguos,
    });
  } catch (e) {
    console.error("parametrizacao-planilhas-sync", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
