// Edge Function: vigia-series
//
// O cron que faz o Hub avisar antes de você perguntar.
//
// Todo achado analítico deste projeto nascia dentro de um `useMemo` — ou seja,
// só existia DEPOIS que alguém abria a tela. Um selo não pode estar aceso antes
// da visita se o número só é calculado na visita. Esta função é o outro lado
// disso: mede sozinha, de madrugada, e GRAVA em `sinais`.
//
// ===========================================================================
// A DIVISÃO DE TRABALHO, QUE É A DECISÃO CENTRAL
//
//   1. O Postgres MEDE   (`sinal_cobertura_notas`, `sinal_tarefas_idade`)
//   2. A banda DECIDE    (`_shared/sinais-banda.ts`, testada em src/lib/sinais/)
//   3. A IA só REDIGE    (a frase em português e o rascunho da ação)
//
// A IA não escolhe o que é relevante. Se ela cair, o sinal continua tocando com
// o texto seco do fallback — e é por isso que `corpo` e `acao` são anuláveis no
// banco. O contrário (modelo decidindo se algo é anormal) tornaria "hoje não
// apareceu nada" uma frase sem significado, porque amanhã o mesmo número podia
// dar outro veredito.
//
// ===========================================================================
// RITMO, NÃO TOTAL
//
// A comparação do mês corrente é sempre contra os anteriores NO MESMO DIA ÚTIL.
// Comparar "12 notas até hoje" com "40 no mês passado inteiro" gritaria todo dia
// 10 de todo mês, e o sino perderia a credibilidade na primeira semana.
//
// Body (tudo opcional):
//   { serie?: 'notas.cobertura', preview?: true, hoje?: '2026-08-31' }
//
// `preview` mede e avalia SEM chamar a IA e SEM gravar — é o modo de calibrar a
// banda: mexe num parâmetro em `sinal_serie` e vê o que mudaria, de graça.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, handleCors, jsonResponse, errorResponse, temChave } from "../_shared/openai.ts";
import {
  avaliar, dataDoNesimoDiaUtil, diasUteisAte, iso, MIN_HISTORICO,
  type Veredito,
} from "../_shared/sinais-banda.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
};

/* Teto para a redação. O trabalho que importa (medir e gravar) já está feito
   quando a IA é chamada; deixá-la sem rédea é o caminho conhecido para o worker
   morrer aos 150s e perder TUDO na hora de gravar. */
const PRAZO_IA_MS = 25_000;

type Serie = {
  serie: string; modulo: string; titulo: string; descricao: string | null; rota: string;
  direcao: "abaixo" | "acima" | "ambos";
  k: number; folga: number; min_relativo: number; historico_meses: number;
  gravidade: string; dono_user_id: string | null; ativa: boolean;
};

/** Um candidato a sinal: já passou pela banda, ainda não passou pela IA. */
type Candidato = {
  chave: string;
  assinatura: string;
  titulo: string;
  /** O valor medido nesta rodada — é ele que `medida.atual` guarda. */
  atual: number;
  valor: number | null;
  dono: string | null;
  veredito: Veredito;
  /** Os fatos que a IA vai transformar em frase. Ela não faz conta. */
  dossie: Record<string, unknown>;
  /** O texto de emergência, usado quando a IA falha. */
  fallback: { corpo: string; acao: string };
  rascunho: Record<string, unknown> | null;
};

/* ============================================================ utilidades */

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const brl = (x: number) =>
  x.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const MES_PT = ["janeiro","fevereiro","março","abril","maio","junho",
                "julho","agosto","setembro","outubro","novembro","dezembro"];

/**
 * A assinatura é o MODO do problema, não o tamanho dele.
 *
 * Se ela carregasse o número, cada ponto decimal a mais criaria um sinal novo e
 * o que você leu ontem voltaria a piscar hoje — que é exatamente o defeito que
 * `integracao_estado` já tinha resolvido tirando dígitos da assinatura. Duas
 * faixas bastam: uma queda leve que vira colapso merece tocar de novo, uma que
 * só oscila não.
 */
function faixaDoDesvio(relativo: number): "forte" | "leve" {
  return Math.abs(relativo) >= 0.5 ? "forte" : "leve";
}

/* ================================================== série: cobertura de nota */

async function medirCobertura(supa: any, s: Serie, hoje: Date): Promise<Candidato[]> {
  const n = diasUteisAte(hoje);
  /* Antes do primeiro dia útil do mês não há o que comparar: a competência
     corrente está vazia e a cobertura seria 0/0. Calar aqui é o certo. */
  if (n < 1) return [];

  const ano = hoje.getUTCFullYear();
  const mes0 = hoje.getUTCMonth();

  const lerJanela = async (a: number, m: number, ate: Date) => {
    const { data, error } = await supa.rpc("sinal_cobertura_notas", {
      p_de: iso(new Date(Date.UTC(a, m, 1))),
      p_ate: iso(ate),
    });
    if (error) throw new Error(`sinal_cobertura_notas: ${error.message}`);
    return data as { cobertura: number | null; exigem: number; emitidas: number;
                     falta: number; valor_falta: number } | null;
  };

  const atual = await lerJanela(ano, mes0, hoje);
  if (!atual || atual.cobertura === null) return [];

  /* Cada mês anterior é recortado no SEU n-ésimo dia útil — é isso que torna a
     comparação honesta. Sequencial de propósito: são ~2,8s por chamada contra a
     mesma tabela, e disparar seis em paralelo só troca espera por contenção. */
  const historico: number[] = [];
  const detalhe: { mes: string; cobertura: number }[] = [];
  for (let i = s.historico_meses; i >= 1; i--) {
    const d = new Date(Date.UTC(ano, mes0 - i, 1));
    const ate = dataDoNesimoDiaUtil(d.getUTCFullYear(), d.getUTCMonth(), n);
    const r = await lerJanela(d.getUTCFullYear(), d.getUTCMonth(), ate);
    if (r?.cobertura !== null && r?.cobertura !== undefined) {
      historico.push(r.cobertura);
      detalhe.push({ mes: `${MES_PT[d.getUTCMonth()]}/${d.getUTCFullYear()}`, cobertura: r.cobertura });
    }
  }

  const v = avaliar(atual.cobertura, historico, {
    k: s.k, folga: s.folga, direcao: s.direcao, minRelativo: s.min_relativo,
  });
  if (!v.disparou) return [];

  const competencia = `${ano}-${String(mes0 + 1).padStart(2, "0")}`;
  const mesNome = `${MES_PT[mes0]}/${ano}`;

  return [{
    chave: competencia,
    assinatura: `cobertura_${s.direcao}_${faixaDoDesvio(v.relativo)}`,
    titulo: `Emissão de nota travada em ${mesNome}`,
    atual: atual.cobertura,
    valor: atual.valor_falta ?? null,
    dono: s.dono_user_id,
    veredito: v,
    dossie: {
      mes: mesNome,
      dias_uteis_corridos: n,
      cobertura_atual: pct(atual.cobertura),
      cobertura_normal: pct(v.banda.centro),
      historico: detalhe.map((d) => `${d.mes}: ${pct(d.cobertura)}`),
      cobrancas_que_exigem_nota: atual.exigem,
      ja_emitidas: atual.emitidas,
      sem_nota: atual.falta,
      valor_sem_nota: brl(atual.valor_falta ?? 0),
    },
    fallback: {
      corpo: `A cobertura de emissão em ${mesNome} está em ${pct(atual.cobertura)}, contra ${pct(v.banda.centro)} de costume no mesmo ponto do mês. São ${atual.falta} cobranças recebidas sem nota, somando ${brl(atual.valor_falta ?? 0)}.`,
      acao: "Abrir a fila de emissão e conferir o que está travando.",
    },
    rascunho: { tipo: "abrir_fila_notas", competencia, rota: `${s.rota}?competencia=${competencia}` },
  }];
}

/* ==================================================== série: tarefa encalhada */

async function medirTarefas(supa: any, s: Serie): Promise<Candidato[]> {
  const { data, error } = await supa.rpc("sinal_tarefas_idade");
  if (error) throw new Error(`sinal_tarefas_idade: ${error.message}`);
  const linhas = (data ?? []) as {
    id: string; titulo: string; status: string; responsavel: string | null;
    prioridade: string | null; prazo: string | null;
    dias_ativos: number; dono_user_id: string | null;
  }[];

  /* A anomalia aqui é de DISTRIBUIÇÃO, não temporal: a tarefa é sinal quando
     destoa das OUTRAS do mesmo status, não do próprio passado. Comparar entre
     status seria injusto — "Revisão" é naturalmente mais lento que "Em
     andamento", e a diferença viraria alarme todo dia. */
  const porStatus = new Map<string, typeof linhas>();
  for (const l of linhas) {
    if (!porStatus.has(l.status)) porStatus.set(l.status, []);
    porStatus.get(l.status)!.push(l);
  }

  const out: Candidato[] = [];
  for (const [status, tarefas] of porStatus) {
    if (tarefas.length < MIN_HISTORICO + 1) continue; // +1: a própria não entra na banda dela

    for (const t of tarefas) {
      const outras = tarefas.filter((x) => x.id !== t.id).map((x) => Number(x.dias_ativos));
      const v = avaliar(Number(t.dias_ativos), outras, {
        k: s.k, folga: s.folga, direcao: s.direcao, minRelativo: s.min_relativo,
      });
      if (!v.disparou) continue;

      const dias = Math.round(Number(t.dias_ativos));
      const normal = Math.round(v.banda.centro);
      out.push({
        chave: t.id,
        /* O modo é "encalhada NESTE status". Sem o status na assinatura, mover o
           card e ele encalhar de novo seria o mesmo sinal; com o número de dias
           na assinatura, ele renasceria a cada 24h. */
        assinatura: `encalhada_${status}`,
        titulo: `"${t.titulo}" parada há ${dias}d em ${status}`,
        atual: Number(t.dias_ativos),
        valor: null,
        dono: t.dono_user_id,
        veredito: v,
        dossie: {
          tarefa: t.titulo, status, responsavel: t.responsavel ?? "sem dono",
          prioridade: t.prioridade, prazo: t.prazo,
          dias_ativos: dias, dias_tipicos_no_status: normal,
          quantas_outras_no_status: outras.length,
        },
        fallback: {
          corpo: `Está há ${dias} dias em "${status}", contra ${normal} das outras tarefas na mesma coluna. O tempo em coluna que não conta idade já foi descontado.`,
          acao: "Destravar ou mover para a coluna certa.",
        },
        rascunho: { tipo: "abrir_tarefa", tarefa_id: t.id, rota: `${s.rota}?tarefa=${t.id}` },
      });
    }
  }
  return out;
}

/* =========================================================== a redação da IA */

const ESTILO = `
Você escreve os avisos que aparecem no sino do Hub financeiro da Takeat — o
painel interno que Henrique e Júlia usam todo dia. Cada aviso nasce de um número
que JÁ FOI MEDIDO e JÁ FOI julgado anormal por uma conta estatística. Você não
decide se é relevante: isso está decidido. Seu trabalho é dizer, em português
claro, o que aconteceu e o que fazer a respeito.

REGRAS

1. NÃO FAÇA CONTA. Todos os números chegam prontos e formatados no dossiê. Copie-os
   como estão. Se você calcular qualquer coisa, vai divergir da tela — e a tela
   é que está certa.
2. COMECE PELO FATO, NÃO PELO ALARME. "A emissão de nota parou em 11% do normal"
   e não "Atenção! Identificamos uma anomalia crítica".
3. A AÇÃO É UMA FRASE IMPERATIVA E CONCRETA, com o primeiro passo real. "Abrir a
   fila de emissão e ver quantas travaram no cadastro do tomador" serve;
   "monitorar a situação" não serve para nada.
4. NÃO INVENTE CAUSA. Você não sabe por que caiu. Se quiser levantar hipótese,
   marque como hipótese ("pode ser..."), e só quando o dossiê der base.
5. DUAS A TRÊS FRASES no corpo. Quem lê está no meio de outra coisa.
6. Sem emoji, sem "Olá", sem se apresentar.

Responda SÓ com JSON: {"corpo": "...", "acao": "..."}
`.trim();

async function redigir(c: Candidato, s: Serie): Promise<{ corpo: string; acao: string }> {
  if (!temChave()) return c.fallback;
  try {
    const r = await generateJSON<{ corpo?: string; acao?: string }>({
      messages: [
        { role: "system", content: ESTILO },
        {
          role: "user",
          content:
            `Série: ${s.titulo}\n${s.descricao ?? ""}\n\n` +
            `DOSSIÊ (números já apurados — copie, não recalcule):\n` +
            JSON.stringify(c.dossie, null, 2),
        },
      ],
      temperature: 0.3,
      maxTokens: 400,
      timeoutMs: PRAZO_IA_MS,
    });
    const corpo = String(r?.corpo ?? "").trim();
    const acao = String(r?.acao ?? "").trim();
    /* Resposta vazia ou truncada cai no texto seco: um sinal sem frase ainda
       avisa; um sinal com frase pela metade confunde. */
    return corpo && acao ? { corpo, acao } : c.fallback;
  } catch {
    return c.fallback;
  }
}

/* ================================================================== o portão */

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  /* A tela chama com usuário logado; o cron chama com `x-cron-token`, porque
     `disparar_automacao` não manda Authorization. Sem os dois caminhos, o cron
     das 7h morreria em 401 calado — e o sintoma seria o sino simplesmente
     parar de trazer coisa nova, que é o tipo de falha que se descobre semanas
     depois. */
  try {
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supa.from("internal_cron_tokens")
        .select("name").eq("name", "vigia-series").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const soEsta: string | undefined = body?.serie;
    const preview = body?.preview === true;
    const hoje = body?.hoje ? new Date(`${body.hoje}T12:00:00Z`) : new Date();

    let q = supa.from("sinal_serie").select("*").eq("ativa", true);
    if (soEsta) q = q.eq("serie", soEsta);
    const { data: series, error: eSeries } = await q;
    if (eSeries) throw new Error(eSeries.message);

    const relatorio: Record<string, unknown>[] = [];

    for (const s of (series ?? []) as Serie[]) {
      let candidatos: Candidato[] = [];
      try {
        if (s.serie === "notas.cobertura") candidatos = await medirCobertura(supa, s, hoje);
        else if (s.serie === "tarefas.encalhada") candidatos = await medirTarefas(supa, s);
        else { relatorio.push({ serie: s.serie, erro: "sem medidor" }); continue; }
      } catch (e) {
        /* Uma série que quebra não pode levar as outras junto: o sino ficaria
           mudo por inteiro por causa de uma RPC. */
        relatorio.push({ serie: s.serie, erro: (e as Error).message });
        continue;
      }

      if (preview) {
        relatorio.push({
          serie: s.serie, preview: true, candidatos: candidatos.length,
          detalhe: candidatos.map((c) => ({
            chave: c.chave, titulo: c.titulo,
            z: Number(c.veredito.z.toFixed(2)),
            relativo: Number(c.veredito.relativo.toFixed(4)),
            centro: c.veredito.banda.centro, n: c.veredito.banda.n,
          })),
        });
        continue;
      }

      const vivos: string[] = [];
      for (const c of candidatos) {
        const { corpo, acao } = await redigir(c, s);
        const { error } = await supa.rpc("sinal_gravar", {
          p_serie: s.serie, p_chave: c.chave, p_assinatura: c.assinatura,
          p_titulo: c.titulo, p_corpo: corpo, p_acao: acao,
          p_rascunho: c.rascunho, p_valor: c.valor,
          p_gravidade: s.gravidade, p_dono: c.dono,
          p_medida: {
            atual: c.atual, z: c.veredito.z, relativo: c.veredito.relativo,
            centro: c.veredito.banda.centro, dispersao: c.veredito.banda.dispersao,
            piso: c.veredito.banda.piso, teto: c.veredito.banda.teto,
            n: c.veredito.banda.n, medido_em: new Date().toISOString(),
          },
        });
        if (error) throw new Error(`sinal_gravar: ${error.message}`);
        vivos.push(`${c.chave}|${c.assinatura}`);
      }

      /* O que não reapareceu voltou para dentro da banda — fecha sozinho. Cobrar
         um "ok" por um problema que deixou de existir ensina que o sino dá
         trabalho à toa. */
      const { data: fechados } = await supa.rpc("sinal_resolver_ausentes", {
        p_serie: s.serie, p_vivos: vivos,
      });

      relatorio.push({ serie: s.serie, abertos: vivos.length, resolvidos: fechados ?? 0 });
    }

    return jsonResponse({ ok: true, quando: new Date().toISOString(), series: relatorio });
  } catch (e) {
    return errorResponse(e);
  }
});
