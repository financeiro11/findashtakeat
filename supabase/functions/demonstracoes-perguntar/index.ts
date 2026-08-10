// Edge Function: demonstracoes-perguntar
//
// Responde a uma pergunta feita EM CIMA DE UMA CÉLULA da DRE/DFC — e a resposta
// fica registrada ali, no fio daquela célula.
//
// POR QUE EXISTE, se já há justificativa automática: a justificativa nasce de um
// gatilho da máquina (a célula variou acima do limiar) e por isso só fala do que
// se mexeu. A pergunta que fecha o mês costuma ser sobre o que NÃO se mexeu:
//
//   "quatro pessoas do comercial tiveram reajuste em julho; por que Pessoal não
//    subiu?"
//
// O fato que motiva a pergunta (o reajuste) não está em lugar nenhum do banco.
// Quem o traz é a pessoa; o que esta função faz é procurar o rastro dele nos
// lançamentos e dizer o que achou — ou que não achou.
//
// COMO FUNCIONA
//   A tela manda a célula com os MESMOS números que estão à vista (ela é quem
//   soma os filhos e aplica o valor manual — recalcular aqui produziria uma
//   resposta que não bate com o número ao lado). Aqui se faz o que a tela não
//   pode: descer nos lançamentos do Omie.
//
//   Três camadas de evidência, da mais mastigada para a mais crua:
//     • drivers      — quem se mexeu entre os dois meses (`demonstracoes_contrapartes`,
//                      o mesmo insumo das justificativas)
//     • lançamentos  — título a título nos dois meses (`demonstracoes_lancamentos_multi`)
//     • série + quebra por linha filha + o resumo do mês, que a tela já calculou
//
//   A IA REDIGE em cima disso; nada aqui é inventado por ela. Os drivers ficam
//   salvos ao lado da resposta pelo mesmo motivo da justificativa: quem lê
//   confere a conta sem sair da tela.
//
// Body: {
//   tipo:'dre'|'dfc', rubrica, mes:'Jul-26', mesAnterior:'Jun-26',
//   pergunta, fontes:string[], valor, valorAnterior, despesa, travado,
//   serie:[{mes,valor}], filhos:[{rubrica,valor,valorAnterior}],
//   resumoMes:[{rubrica,valor,valorAnterior}]
// }
//   `fontes` são os rótulos que compõem a célula (numa linha somada, os filhos):
//   é por eles que se acha o lançamento, porque o DE-PARA do Omie aponta para a
//   folha, nunca para o nome da linha somada.

// Versão FIXA, como no `_shared/auth.ts`: com `@2` solto o bundler resolve a
// última do dia e já quebrou um deploy deste projeto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
// OpenAI, e não Gemini: a redação caía de 429 (cota) no meio do fechamento, que
// é justamente quando ela é usada. Mesma superfície de `generateJSON`.
import { generateJSON, handleCors, jsonResponse, errorResponse, DEFAULT_MODEL } from "../_shared/openai.ts";
import { buildOrgContext } from "../_shared/org-context.ts";
// O Omie guarda razão social; a resposta precisa sair com o nome da pessoa.
import { carregarPessoasPJ, pessoaDe, pessoasNoTexto } from "../_shared/pessoas-pj.ts";

/* Quanto do dossiê cabe no prompt.
 *
 * Generoso de propósito, ao contrário das justificativas: lá o objetivo é UMA
 * frase sobre quem mais pesou, e citar demais estraga o texto. Aqui a pergunta
 * costuma ser sobre alguém específico — "quatro pessoas do comercial" são quatro
 * contrapartes no meio das ~50 de Pessoal, nenhuma delas entre as maiores. Com
 * corte apertado, a resposta seria "não vejo isso nos lançamentos" justamente
 * porque a linha da pessoa não coube. O modelo lê 1M de tokens; o gargalo aqui
 * não é ele. */
const MAX_DRIVERS = 40;
/** Lançamentos por mês no prompt. O que não cabe é contado, nunca omitido em silêncio. */
const MAX_LANCAMENTOS = 150;
/** Trocas anteriores da mesma célula que entram como contexto do fio. */
const MAX_FIO = 6;

type Corpo = {
  tipo?: string;
  rubrica?: string;
  mes?: string;
  mesAnterior?: string;
  pergunta?: string;
  fontes?: string[];
  valor?: number | null;
  valorAnterior?: number | null;
  despesa?: boolean;
  travado?: boolean;
  percentual?: boolean;
  serie?: { mes: string; valor: number | null }[];
  filhos?: { rubrica: string; valor: number | null; valorAnterior: number | null }[];
  resumoMes?: { rubrica: string; valor: number | null; valorAnterior: number | null }[];
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "8,9k" / "1,25M" — a abreviação que o tracker usa nos comentários. */
function abrev(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(2).replace(".", ",")}M`;
  if (a >= 1_000) return `${s}${(a / 1_000).toFixed(1).replace(".", ",")}k`;
  return `${s}${a.toFixed(0)}`;
}

const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rotuloMes(k: string): string {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(k ?? "");
  if (!m) return k;
  const i = EN.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return i >= 0 ? `${MES_PT[i]}/${m[2]}` : k;
}

const dataCurta = (d: string | null) => (d ? String(d).slice(8, 10) + "/" + String(d).slice(5, 7) : "—");

/**
 * O MEMO da fatura, de dentro da observação do título.
 *
 * No cartão a contraparte é sempre o balde ("Lancamento Fatura Cartao") e o que
 * o gasto É está depois do "|". Vai CRU para o modelo, sem o parser de colunas
 * do cartão: duplicar aquele corte aqui faria esta resposta e a tela do cartão
 * discordarem sobre o nome do mesmo lojista.
 */
function memo(obs: string | null | undefined): string | null {
  if (!obs) return null;
  const corte = obs.lastIndexOf("|");
  const t = (corte >= 0 ? obs.slice(corte + 1) : obs).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 90) : null;
}

/* ============================================================
 *  O prompt
 * ============================================================
 * O tom é o mesmo das justificativas (destilado dos comentários reais do tracker),
 * mas a tarefa é outra: lá se DESCREVE uma variação, aqui se RESPONDE a alguém.
 * As regras que valem o preço estão em 3 e 4 — a pergunta quase sempre traz um
 * fato que o banco não conhece ("teve reajuste"), e o pior desfecho possível é a
 * IA confirmar esse fato de volta como se o tivesse verificado.
 */
const REGRAS = `
Você responde perguntas do time financeiro da Takeat (Henrique e Júlia) sobre uma
célula específica da DRE ou da DFC, no fechamento do mês. A resposta é lida ali
mesmo, em cima do número, e pode virar o comentário oficial daquela rubrica no
Tracker de Orçamento.

REGRAS

1. RESPONDA A PERGUNTA FEITA. Não escreva um resumo do mês, não repita a pergunta
   e não explique o que não foi perguntado.
2. NOMEIE quem se mexeu e cole os valores que vieram nos dados (já formatados).
   "aumento nos custos" sem dizer de quem não serve para nada.
3. A PERGUNTA COSTUMA TRAZER UM FATO QUE VOCÊ NÃO TEM COMO CONFERIR — um reajuste,
   uma contratação, uma renegociação. Trate isso como premissa de quem perguntou:
   procure o RASTRO dele nos lançamentos e diga o que encontrou. Se o rastro não
   está lá, diga isso com todas as letras ("nos lançamentos de julho o salário do
   Fulano continua em X, igual a junho") — nunca confirme o fato de volta como se
   o tivesse verificado, e nunca diga que a pessoa está enganada.
4. NÃO INVENTE A CAUSA. Os lançamentos dizem QUEM e QUANTO; o POR QUÊ quase nunca
   está lá. Quando o padrão for reconhecível (fornecedor que aparece pela primeira
   vez, fornecedor que some, fatura que parece dobrada, retroativo, pagamento
   partido em dois meses), escreva como POSSIBILIDADE — "pode ser", "aparenta ser".
5. QUANDO O DADO NÃO RESPONDE, DIGA. É uma resposta legítima e é a mais útil das
   erradas. Diga o que faltou e onde olhar (outro mês, outra rubrica, o Omie, o
   tracker, a folha).
6. Se o mês está TRAVADO, o valor da tela veio do tracker importado e não do Omie:
   os lançamentos podem não somar a célula. Só mencione isso quando for relevante
   para a resposta — e quando a diferença entre a soma e a célula for grande, é
   sempre relevante.
7. Direção: em rubrica de despesa, gastar mais é SUBIR. Os valores já chegam com
   essa orientação aplicada; não escreva sinal junto do verbo ("caiu -23,0k" é
   erro, não ênfase).
8. 1 a 4 frases. Pode quebrar linha para listar nomes com valores. Sem bullets,
   sem markdown, sem título, sem saudação, sem assinatura, sem "espero ter
   ajudado".
9. Português do Brasil, tom de nota interna entre colegas. Direto. Sem "conforme
   pode-se observar", sem "é importante ressaltar".

CONFIANÇA: "alta" quando os lançamentos mostram a resposta; "media" quando
mostram parte dela; "baixa" quando você está inferindo ou quando o dado não
alcança a pergunta.
`.trim();

/**
 * A falha da IA em português, com o que o provedor disse junto.
 *
 * O 429 (cota, rajada de chamadas) chegava na tela como "Edge Function returned
 * a non-2xx status code" — a pessoa não tinha como saber que era cota, muito
 * menos que bastava esperar. Uma falha de IA não é erro de sistema: volta 200
 * com este texto, como faz a geração automática.
 */
function motivoDaIA(e: unknown): string {
  const err = e as { status?: number; message?: string; detail?: string };
  const detalhe = (err?.detail ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (err?.status === 429) {
    return "A OpenAI recusou a chamada por cota (429) — costuma ser limite de uso ou "
      + "chamadas em rajada. Espere um pouco e pergunte de novo."
      + (detalhe ? ` OpenAI: ${detalhe}` : "");
  }
  return `A IA não respondeu${err?.status ? ` (${err.status})` : ""}: ${err?.message ?? String(e)}`
    + (detalhe ? ` — ${detalhe}` : "");
}

/* ============================================================ */

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body: Corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const tipo = body?.tipo === "dfc" ? "dfc" : "dre";
    const rubrica = String(body?.rubrica ?? "").trim();
    const mes = String(body?.mes ?? "").trim();
    const mesAnterior = String(body?.mesAnterior ?? "").trim();
    const pergunta = String(body?.pergunta ?? "").trim();
    const despesa = !!body?.despesa;
    const travado = !!body?.travado;
    /* Linha de % ("% Margem EBITDA"): o valor é uma razão, não dinheiro. Sem
       isto, 0,42 sairia formatado como R$ 0,42 e a resposta falaria de quarenta
       e dois centavos de margem. */
    const percentual = !!body?.percentual;
    const fontes = Array.isArray(body?.fontes) && body.fontes.length
      ? [...new Set(body.fontes.map((f) => String(f)))]
      : [rubrica];

    if (!rubrica) return jsonResponse({ error: "rubrica obrigatória." }, 200);
    if (!/^[A-Za-z]{3}-\d{2}$/.test(mes)) return jsonResponse({ error: "mes inválido (esperado 'Jul-26')." }, 200);
    if (pergunta.length < 3) return jsonResponse({ error: "Escreva a pergunta." }, 200);
    if (pergunta.length > 1500) return jsonResponse({ error: "Pergunta longa demais (máx. 1500 caracteres)." }, 200);

    const temAnterior = /^[A-Za-z]{3}-\d{2}$/.test(mesAnterior);
    const meses = temAnterior ? [mesAnterior, mes] : [mes];

    /* Orientação dos valores: em rubrica de despesa o Omie lança negativo. O
       sinal é INVERTIDO, não posto em módulo — assim gastar mais é positivo (que
       é como se lê no tracker) e um estorno continua aparecendo como negativo.
       Em módulo, o estorno viraria gasto, e ele é justamente o tipo de coisa que
       responde "por que não subiu". */
    const orient = (n: number | null | undefined) => (n == null ? 0 : despesa ? -n : n);
    /** O valor da CÉLULA — dinheiro na maioria das linhas, percentual em algumas. */
    const fmtCelula = (n: number) =>
      percentual ? `${(n * 100).toFixed(1).replace(".", ",")}%` : brl(n);

    /* --- 1) O fio: o que já foi perguntado nesta célula ------------------- */
    const { data: fioData } = await supabase
      .from("demonstracoes_perguntas")
      .select("pergunta,resposta,autor_email,criado_em")
      .eq("tipo", tipo)
      .eq("rubrica", rubrica)
      .eq("mes", mes)
      .order("criado_em", { ascending: true });
    const fio = ((fioData ?? []) as { pergunta: string; resposta: string }[]).slice(-MAX_FIO);

    /* --- 2) Quem se mexeu (mesmo insumo das justificativas) --------------- */
    const [{ data: contras, error: contraErr }, pessoas] = await Promise.all([
      supabase.rpc("demonstracoes_contrapartes", {
        p_tipo: tipo,
        p_meses: meses,
      }),
      /* O de-para "razão social -> pessoa". Esta função é a que mais expõe nome:
         40 contrapartes, 150 lançamentos e a observação CRUA do título. Por isso
         ele entra nos três, e ainda varre a resposta pronta no fim. */
      carregarPessoasPJ(supabase),
    ]);
    if (contraErr) throw contraErr;

    const porFonte = new Set(fontes.map((f) => f.trim().toLowerCase()));
    const porContraparte = new Map<string, { atual: number; anterior: number; categoria: string | null; n: number }>();
    for (const r of (contras ?? []) as Record<string, unknown>[]) {
      if (!porFonte.has(String(r.rubrica ?? "").trim().toLowerCase())) continue;
      const nome = pessoaDe(pessoas, String(r.contraparte ?? "Sem contraparte"));
      const acc = porContraparte.get(nome) ?? { atual: 0, anterior: 0, categoria: (r.categoria as string) ?? null, n: 0 };
      const v = orient(Number(r.valor) || 0);
      if (String(r.mes) === mes) acc.atual += v; else acc.anterior += v;
      acc.n += Number(r.lancamentos) || 0;
      porContraparte.set(nome, acc);
    }

    const drivers = [...porContraparte.entries()]
      .map(([contraparte, v]) => {
        const delta = v.atual - v.anterior;
        return {
          contraparte,
          categoria: v.categoria,
          atual: v.atual,
          anterior: v.anterior,
          delta,
          movimento:
            Math.abs(v.anterior) < 1 ? "entrou"
            : Math.abs(v.atual) < 1 ? "saiu"
            : Math.abs(delta) < 1 ? "igual"
            : delta > 0 ? "aumentou" : "reduziu",
          fmtAtual: brl(v.atual),
          fmtAnterior: brl(v.anterior),
          fmtDelta: `${delta > 0 ? "+" : ""}${abrev(delta)}`,
        };
      })
      /* Ordenado pelo TAMANHO, não pela variação: numa pergunta do tipo "por que
         não subiu?", quem ficou igual é a resposta — e ordenar por delta jogaria
         justamente essa gente para fora do corte. */
      .sort((a, b) => Math.max(Math.abs(b.atual), Math.abs(b.anterior)) - Math.max(Math.abs(a.atual), Math.abs(a.anterior)))
      .slice(0, MAX_DRIVERS);

    /* --- 3) Os lançamentos, título a título ------------------------------- */
    const { data: lanc, error: lancErr } = await supabase.rpc("demonstracoes_lancamentos_multi", {
      p_tipo: tipo,
      p_rubricas: fontes,
      p_meses: meses,
    });
    if (lancErr) throw lancErr;

    const porMes = new Map<string, Record<string, unknown>[]>();
    for (const l of (lanc ?? []) as Record<string, unknown>[]) {
      const k = String(l.mes);
      const acc = porMes.get(k);
      if (acc) acc.push(l); else porMes.set(k, [l]);
    }

    const blocos = meses.map((m) => {
      const linhas = porMes.get(m) ?? [];
      const soma = linhas.reduce((s, l) => s + orient(Number(l.valor) || 0), 0);
      const mostradas = [...linhas]
        .sort((a, b) => Math.abs(Number(b.valor) || 0) - Math.abs(Number(a.valor) || 0))
        .slice(0, MAX_LANCAMENTOS);
      return {
        mes: rotuloMes(m),
        lancamentos: linhas.length,
        somaDosLancamentos: brl(soma),
        soma,
        // O que não coube é CONTADO. Um corte silencioso viraria "só teve isso" na
        // cabeça de quem lê a resposta.
        omitidos: linhas.length - mostradas.length,
        linhas: mostradas.map((l) => ({
          data: dataCurta(l.data as string),
          contraparte: pessoaDe(pessoas, (l.contraparte as string) ?? "sem nome no cadastro"),
          rubrica: l.rubrica,
          categoriaNoOmie: l.categoria,
          valor: brl(orient(Number(l.valor) || 0)),
          /* O memo vai cru (é o que mantém esta resposta e a tela do cartão
             falando do mesmo lojista), mas a razão social que for de uma pessoa
             sai trocada: é justamente aqui que ela escapava da troca dos
             drivers e reaparecia no texto. O `null` é preservado — vira "sem
             observação" na leitura do modelo, e "" diria outra coisa. */
          textoDoTitulo: (() => {
            const m = memo(l.observacao as string);
            return m == null ? null : pessoasNoTexto(pessoas, m);
          })(),
        })),
      };
    });

    /* --- 4) O que a tela já sabe ------------------------------------------ */
    const valorO = orient(body?.valor);
    const anteriorO = orient(body?.valorAnterior);
    const deltaO = valorO - anteriorO;
    const somaOmie = blocos.find((b) => b.mes === rotuloMes(mes))?.soma ?? 0;
    const diferenca = valorO - somaOmie;

    const serie = (body?.serie ?? [])
      .filter((p) => p && typeof p.mes === "string")
      .map((p) => ({ mes: rotuloMes(p.mes), valor: p.valor == null ? null : fmtCelula(orient(p.valor)) }));

    type Linha = { rubrica: string; valor: number | null; valorAnterior: number | null };
    /* Filha de uma rubrica de despesa também é despesa: entra com a MESMA
       orientação da célula, senão a quebra apareceria com o sinal trocado em
       relação ao número que ela compõe. */
    const linhaFilha = (l: Linha) => ({
      rubrica: l.rubrica,
      atual: l.valor == null ? null : brl(orient(l.valor)),
      anterior: l.valorAnterior == null ? null : brl(orient(l.valorAnterior)),
    });
    /* As outras linhas do mês vão CRUAS, como estão na demonstração. Orientá-las
       pela natureza da célula perguntada faria a Receita Bruta aparecer negativa
       sempre que a pergunta fosse sobre uma despesa. */
    const linhaSolta = (l: Linha) => ({
      rubrica: l.rubrica,
      atual: l.valor == null ? null : brl(l.valor),
      anterior: l.valorAnterior == null ? null : brl(l.valorAnterior),
    });

    const payload = {
      demonstrativo: tipo.toUpperCase(),
      rubrica,
      mes: rotuloMes(mes),
      mesAnterior: temAnterior ? rotuloMes(mesAnterior) : null,
      natureza: percentual
        ? "linha de percentual — o valor é uma razão entre outras duas linhas, não dinheiro"
        : despesa
          ? "despesa — valores orientados: positivo = gasto, negativo = estorno/crédito"
          : "receita/resultado",
      valorNaTela: fmtCelula(valorO),
      valorNoMesAnterior: temAnterior ? fmtCelula(anteriorO) : null,
      variacao: !temAnterior ? null
        : percentual
          ? `${deltaO > 0 ? "subiu" : deltaO < 0 ? "caiu" : "ficou igual"} ${(Math.abs(deltaO) * 100).toFixed(1).replace(".", ",")} p.p.`
          : `${deltaO > 0 ? "subiu" : deltaO < 0 ? "caiu" : "ficou igual"} ${abrev(Math.abs(deltaO))}`,
      mesTravado: travado,
      // Numa linha de percentual não há o que conferir: ela não tem lançamento
      // próprio, e comparar uma razão com a soma de reais só produziria ruído.
      conferencia: percentual ? null : {
        somaDosLancamentosDoOmie: brl(somaOmie),
        diferencaContraATela: brl(diferenca),
        observacao: Math.abs(diferenca) < 1
          ? "a soma dos lançamentos bate com a célula"
          : travado
            ? "mês travado: o valor da tela veio do tracker importado, não do Omie"
            : "a soma dos lançamentos não bate com a célula (lançamento fora da janela de sincronização, DE-PARA ou valor digitado à mão)",
      },
      /* Sem isto, uma linha derivada (EBITDA, Margem, um total) receberia uma
         resposta construída sobre lançamento nenhum — e o modelo preencheria o
         vazio. Aqui ele sabe que não há o que descer. */
      temLancamentoProprio: (lanc ?? []).length > 0,
      serieDaCelula: serie,
      composicaoPorLinhaFilha: (body?.filhos ?? []).map(linhaFilha),
      /* Não é convite para falar das outras linhas: é o que permite responder
         "não subiu aqui porque foi parar ali" sem inventar. Vêm com o sinal da
         demonstração (despesa negativa). */
      outrasLinhasDoMes: (body?.resumoMes ?? []).map(linhaSolta),
      quemSeMexeu: drivers.map((d) => ({
        contraparte: d.contraparte,
        categoriaNoOmie: d.categoria,
        movimento: d.movimento,
        mesAnterior: d.fmtAnterior,
        mesAtual: d.fmtAtual,
        variacao: d.fmtDelta,
      })),
      lancamentosDoOmie: blocos.map(({ soma: _soma, ...b }) => b),
    };

    /* --- 5) Redação ------------------------------------------------------- */
    let orgCtx = "";
    try { orgCtx = await buildOrgContext(supabase); } catch { /* segue sem a Biblioteca */ }

    const schema = {
      type: "object",
      properties: {
        resposta: { type: "string" },
        confianca: { type: "string", enum: ["alta", "media", "baixa"] },
      },
      required: ["resposta", "confianca"],
    };

    /* As respostas do fio foram gravadas antes de o de-para existir (ou antes
       deste nome entrar nele) e carregam a razão social. Sem esta passada, o
       modelo leria "DALBER NEGOCIOS" no próprio histórico e repetiria. */
    const historico = fio.length
      ? `\n\nJÁ FOI PERGUNTADO NESTA MESMA CÉLULA (mais antigo primeiro) — a pergunta de agora pode ser um repique disto:\n`
        + fio.map((f, i) => `${i + 1}. P: ${f.pergunta}\n   R: ${pessoasNoTexto(pessoas, f.resposta)}`).join("\n")
      : "";

    const redigir = () => generateJSON<{ resposta: string; confianca: string }>({
      temperature: 0.3,
      responseSchema: schema,
      messages: [
        { role: "system", content: `${REGRAS}\n\n${orgCtx}` },
        {
          role: "user",
          content:
            `PERGUNTA: ${pergunta}\n\n`
            + `Ela é sobre a célula "${rubrica}" em ${rotuloMes(mes)} da ${tipo.toUpperCase()}.`
            + historico
            + `\n\nDADOS DA CÉLULA:\n`
            + JSON.stringify(payload, null, 1),
        },
      ],
    });

    /* Uma segunda tentativa, com pausa — mesmo remédio da geração automática: o
       provedor responde 429 quando as chamadas vêm em rajada, e a pausa é o que
       faz a segunda passar. Se falhar de novo, o motivo vai para a tela em
       PORTUGUÊS, com status 200: falha de IA não é a função quebrando. */
    let out: { resposta: string; confianca: string } | null = null;
    try {
      out = await redigir();
    } catch {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        out = await redigir();
      } catch (e2) {
        console.error("demonstracoes-perguntar IA falhou:", e2);
        return jsonResponse({ error: motivoDaIA(e2) }, 200);
      }
    }

    /* Rede, não o caminho principal — drivers, lançamentos e memo já foram
       trocados na entrada. Serve para a razão social que o modelo pescou na
       Biblioteca ou reescreveu por conta própria. */
    const resposta = pessoasNoTexto(pessoas, String(out?.resposta ?? "").trim());
    if (!resposta) {
      return jsonResponse({ error: "A IA não devolveu resposta. Tente reformular a pergunta." }, 200);
    }

    /* --- 6) Grava --------------------------------------------------------- */
    const { data: linha, error: insErr } = await supabase
      .from("demonstracoes_perguntas")
      .insert({
        tipo,
        rubrica,
        mes,
        mes_anterior: temAnterior ? mesAnterior : null,
        pergunta,
        resposta,
        valor: body?.valor ?? null,
        valor_anterior: body?.valorAnterior ?? null,
        travado,
        drivers,
        dados: {
          fontes,
          lancamentos: (lanc ?? []).length,
          omitidos: blocos.reduce((s, b) => s + b.omitidos, 0),
          soma_omie: somaOmie,
          diferenca_contra_tela: diferenca,
          contrapartes: porContraparte.size,
        },
        confianca: ["alta", "media", "baixa"].includes(String(out?.confianca)) ? out.confianca : "media",
        autor_id: caller.userId,
        autor_email: caller.email ?? null,
        modelo: DEFAULT_MODEL,
      })
      .select("*")
      .single();
    if (insErr) throw insErr;

    return jsonResponse({ ok: true, pergunta: linha });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("demonstracoes-perguntar error:", msg);
    if (msg.includes("autentic") || msg.includes("permissão")) return jsonResponse({ error: msg }, 401);
    return errorResponse(e);
  }
});
