// Edge Function: demonstracoes-justificar
//
// Escreve o rascunho do comentário que hoje é feito à mão no Tracker de
// Orçamento — "Ingram com um valor mais elevado. Mar = 39.149,15 / Abr =
// 78.139,61" — para cada célula da DRE/DFC que variou acima do limiar.
//
// COMO FUNCIONA
//   A tela manda as células candidatas (rubrica + valor + valor do mês anterior),
//   porque é ela que tem a hierarquia do demonstrativo e portanto os MESMOS
//   números que estão à vista. Aqui o trabalho é o que a tela não pode fazer:
//   descer nos lançamentos do Omie (`demonstracoes_contrapartes`), descobrir QUEM
//   se mexeu entre os dois meses e transformar isso em texto.
//
//   Os `drivers` (quem subiu, quem entrou, quem sumiu) e os `sinais` (concentração,
//   fornecedor que sumiu, variação sem lastro no Omie) são calculados em código,
//   não pela IA. A IA só REDIGE em cima deles. É o que impede a justificativa de
//   virar ficção plausível — e é por isso que os drivers ficam salvos ao lado do
//   texto: quem lê confere a conta sem sair da tela.
//
//   SEM DRIVER, SEM COMENTÁRIO. Se nenhum lançamento do Omie sustenta a variação,
//   a célula não ganha texto: a nota existe para ser colada no tracker, e "não
//   consegui explicar" não é uma nota. O buraco continua visível onde é
//   acionável — clicando na célula, no confronto entre a soma e o valor.
//
// Body: {
//   tipo: 'dre'|'dfc', mes: 'Jun-26', mesAnterior: 'May-26',
//   celulas: [{ rubrica, valor, valorAnterior, delta, deltaPct, despesa, fontes }],
//   force?: boolean            // regera até o que já foi aceito/reescrito
// }
//   `fontes` são os rótulos que compõem a célula (numa linha somada, os filhos):
//   é por eles que se acha o lançamento, porque o DE-PARA do Omie aponta para a
//   folha, nunca para o nome da linha somada.
//
//   A chamada só chega aqui para MÊS TRAVADO — ver lib/justificativas.ts.

// Versão FIXA, como na `demonstracoes-perguntar` e no `_shared/auth.ts`: com `@2`
// solto o bundler resolve a última do dia e já quebrou um deploy deste projeto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
// OpenAI, e não Gemini: a redação caía de 429 (cota) no meio do fechamento, que
// é justamente quando ela é usada. Mesma superfície de `generateJSON`.
import { generateJSON, handleCors, jsonResponse, errorResponse, DEFAULT_MODEL } from "../_shared/openai.ts";
import { buildOrgContext } from "../_shared/org-context.ts";
// O Omie guarda razão social; o comentário precisa sair com o nome da pessoa.
import { carregarPessoasPJ, pessoaDe, pessoasNoTexto } from "../_shared/pessoas-pj.ts";

/* Quantas células por chamada ao Gemini. Lotes grandes economizam tokens de
   contexto (o prompt de estilo é longo), mas pioram a qualidade: o modelo passa
   a repetir a mesma frase em rubricas diferentes. 12 foi o ponto em que os
   textos ainda saem específicos. */
const LOTE = 12;
/** Contrapartes citáveis por célula. Acima disso vira lista de compras. */
const MAX_DRIVERS = 6;

/* A história da rubrica, calculada no cliente (`src/lib/serieRubrica.ts`) e
   trafegada só como NÚMERO. A frase é montada aqui, com os mesmos formatadores
   dos drivers: sinal redigido em dois lugares diverge no primeiro ajuste que
   alguém fizer num deles. */
type SerieResumo = {
  janela: number;
  meses: number;
  mediana: number;
  mad: number;
  z: number | null;
  extremo: "maior" | "menor" | null;
  recorrente: boolean;
  ausente: boolean;
  zerada: boolean;
  ultimoMes: string | null;
  ultimoValor: number | null;
};

type Celula = {
  rubrica: string;
  valor: number | null;
  valorAnterior: number | null;
  delta: number;
  deltaPct: number | null;
  despesa: boolean;
  /* Rótulos que compõem a célula. Numa linha somada ("Pessoal", "Receita
     Recorrente") os lançamentos do Omie estão nos FILHOS: o DE-PARA aponta para
     "Equipe Comercial", nunca para "Pessoal". Procurar pelo nome da linha somada
     devolvia zero contraparte e o comentário saía dizendo que o Omie não
     explicava a variação — em 59% dos casos. */
  fontes?: string[];
  /* Por que a célula entrou na lista. Ausente nas chamadas de versões antigas
     da tela — nesse caso vale a régua de sempre. */
  motivo?: "variacao" | "ausencia" | "atipica";
  serie?: SerieResumo | null;
};

type Driver = {
  contraparte: string;
  /* A razão social que veio do Omie, quando `contraparte` acima é o nome da
     pessoa que a substituiu. Fica gravada porque o driver existe para ser
     CONFERIDO contra o Omie: trocar o nome sem deixar rastro tiraria de quem lê
     justamente a string que ele usaria para procurar lá. */
  razaoSocial?: string | null;
  categoria: string | null;
  atual: number;
  anterior: number;
  delta: number;
  movimento: "entrou" | "saiu" | "aumentou" | "reduziu";
  fmtAtual: string;
  fmtAnterior: string;
  fmtDelta: string;
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

/* ============================================================
 *  Estilo — destilado dos 133 comentários reais de jan–jun/26
 * ============================================================
 * Os exemplos são transcrições literais do tracker (inclusive a grafia).
 * Ficam aqui, e não numa tabela, porque são a DEFINIÇÃO do formato de saída:
 * mudar isso é mudar o contrato da função, não configurar um parâmetro.
 */
const ESTILO = `
Você escreve o rascunho dos comentários do Tracker de Orçamento da Takeat — as
notas que o time financeiro (Henrique e Júlia) fixa em cima das células da DRE e
da DFC quando um número varia. Elas são lidas no fechamento do mês e depois
coladas no tracker oficial.

COMO ELAS SÃO (transcrições reais):

• "Ingram com um valor mais elevado.
   Mar = 39.149,15
   Abr = 78.139,61"

• "Diferença causada principalmente pelo maior gasto em Google Cloud +8k e no ingram +2k"

• "Valor mais baixo por conta da grande alta no docupipe mês passado (diferença de 6k).
   Mai= 8.9k
   Jun=2.6k"

• "Número mais alto pela entrada do Guilherme do RPA (2,6k) e efetivação de Júlia (2,8k),
   pela saída da Amanda (12,5k) e pelo pagamento integral da Ana Clara (10k)."

• "Valor mais elevado pela primeira remuneração do Breno, saída da Georgia.
   Breno 14516,13
   Georgia 972,26"

• "Número elevado devido ao pagamento da AWS e do Ingram (24k e 57k, respectivamente)."

REGRAS

1. NOMEIE quem se mexeu. Um comentário que diz "aumento nos custos" sem dizer de
   quem não serve para nada. Use os nomes que vierem em "drivers" e os valores já
   formatados que vêm junto (fmtAtual/fmtAnterior/fmtDelta) — copie essas strings,
   NÃO refaça a conta nem invente casas decimais.
2. NÃO INVENTE A CAUSA. Você sabe QUEM mudou (isso veio do Omie); você não sabe
   POR QUÊ. "efetivação da Júlia", "a KXC esqueceu de emitir a cobrança" são coisas
   que só a pessoa sabe. Quando o padrão for reconhecível (fornecedor que aparece
   pela primeira vez, fornecedor que some, fatura que parece ter vindo dobrada,
   retroativo), escreva como POSSIBILIDADE — "pode ser", "aparenta ser" — nunca como
   fato consumado.
3. Se os "sinais" apontarem algo suspeito, diga em uma frase curta ao final, com o
   que conferir. É o principal uso disto: achar erro de lançamento antes de fechar.
4. 1 a 3 frases. Pode quebrar linha para listar nomes com valores, como nos exemplos.
   Sem bullets, sem markdown, sem título, sem saudação e SEM ASSINATURA.
5. Português do Brasil, tom de nota interna entre colegas. Direto. Sem "conforme
   pode-se observar", sem "é importante ressaltar".
6. Fale em "subiu"/"caiu" na leitura natural da rubrica: em linha de despesa, gastar
   mais é subir. Os valores já chegam com essa orientação aplicada.
7. O campo "movimento" já vem redigido e com o sinal resolvido ("caiu 23,0k").
   Copie a direção dele. NUNCA escreva o sinal junto do verbo — "caiu -23,0k" é
   erro, não ênfase.
8. Se a "cobertura" for baixa, diga o que os drivers explicam e pare aí, deixando
   claro que o resto não tem lastro nos lançamentos. Não invente o resto, e não
   encha o comentário de instruções de conferência — quem quiser o detalhe clica
   na célula e vê os lançamentos.
9. RUBRICA QUE SUMIU (sinal "ausencia_recorrente"): o comentário é sobre o que
   FALTOU, não sobre uma queda. Diga que a linha não veio, de quanto ela
   costumava ser, e cite quem lançava nela no mês anterior — são os drivers com
   movimento "saiu". A causa é hipótese: "pode ter caído em outra rubrica" é o
   mais longe que você pode ir. Nunca escreva que a empresa deixou de ter aquela
   receita ou aquele custo.
10. O campo "historico" é contexto para você ESCREVER, não um aviso. Use quando
   ajudar a dimensionar ("é o maior valor dos últimos 12 meses", "costuma ficar
   em torno de X"). Não o recite inteiro, e não o transforme em alerta.
`.trim();

/* ============================================================
 *  Drivers e sinais — determinísticos, calculados aqui
 * ============================================================ */

function montarDrivers(
  porContraparte: Map<string, { atual: number; anterior: number; categoria: string | null; razaoSocial?: string | null }>,
  despesa: boolean,
): { drivers: Driver[]; deltaOmie: number } {
  // Em rubrica de despesa os lançamentos são negativos. Vira módulo para o texto
  // ler como o tracker lê ("Ingram: 39.149,15 -> 78.139,61", e subir = gastar mais).
  const orient = (n: number) => (despesa ? Math.abs(n) : n);

  let deltaOmie = 0;
  const todos: Driver[] = [];
  for (const [contraparte, v] of porContraparte) {
    const atual = orient(v.atual);
    const anterior = orient(v.anterior);
    const delta = atual - anterior;
    deltaOmie += delta;
    if (Math.abs(delta) < 1) continue; // centavo de arredondamento não é driver
    todos.push({
      contraparte,
      razaoSocial: v.razaoSocial ?? null,
      categoria: v.categoria,
      atual, anterior, delta,
      movimento:
        Math.abs(anterior) < 1 ? "entrou"
        : Math.abs(atual) < 1 ? "saiu"
        : delta > 0 ? "aumentou" : "reduziu",
      fmtAtual: brl(atual),
      fmtAnterior: brl(anterior),
      fmtDelta: `${delta > 0 ? "+" : ""}${abrev(delta)}`,
    });
  }
  todos.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { drivers: todos.slice(0, MAX_DRIVERS), deltaOmie };
}

/** Suspeitas objetivas. São o gancho para achar erro — não opinião da IA. */
function montarSinais(c: Celula, drivers: Driver[], deltaOmie: number, deltaOrientado: number) {
  const sinais: { codigo: string; detalhe: string }[] = [];
  const absDelta = Math.abs(deltaOrientado);

  if (absDelta > 0 && Math.abs(deltaOmie) < absDelta * 0.3) {
    sinais.push({
      codigo: "sem_lastro_omie",
      detalhe: `Os lançamentos do Omie variaram ${abrev(deltaOmie)} enquanto a célula variou ${abrev(deltaOrientado)}. `
        + `Pode ser mês travado (valor veio do tracker), lançamento fora da janela de sincronização ou DE-PARA.`,
    });
  }
  const top = drivers[0];
  if (top && absDelta > 0 && Math.abs(top.delta) >= absDelta * 0.8) {
    sinais.push({
      codigo: "concentracao",
      detalhe: `${top.contraparte} sozinho responde por ${Math.round((Math.abs(top.delta) / absDelta) * 100)}% da variação.`,
    });
  }
  for (const d of drivers) {
    if (d.movimento === "saiu" && Math.abs(d.delta) >= absDelta * 0.25) {
      sinais.push({ codigo: "contraparte_sumiu", detalhe: `${d.contraparte} tinha ${d.fmtAnterior} e não teve nenhum lançamento neste mês.` });
    }
    if (d.movimento === "entrou" && Math.abs(d.delta) >= absDelta * 0.25) {
      sinais.push({ codigo: "contraparte_nova", detalhe: `${d.contraparte} aparece pela primeira vez, com ${d.fmtAtual}.` });
    }
  }
  if (c.valorAnterior == null) {
    sinais.push({ codigo: "sem_anterior", detalhe: "Não havia valor no mês anterior — a variação é de base zero." });
  }
  sinais.push(...sinaisDaSerie(c));
  return sinais;
}

/**
 * As suspeitas que só a HISTÓRIA da rubrica levanta — as que um par de meses
 * não consegue ver.
 *
 * Vão para os `sinais`, e não para o texto do prompt, porque são exatamente o
 * que a caixa âmbar da célula existe para mostrar: possível erro de lançamento.
 * O que é só CONTEXTO de redação ("é o maior valor dos últimos 12 meses") entra
 * pelo `historico` do payload, sem acender aviso nenhum.
 */
function sinaisDaSerie(c: Celula): { codigo: string; detalhe: string }[] {
  const s = c.serie;
  if (!s) return [];
  const out: { codigo: string; detalhe: string }[] = [];

  if (c.motivo === "ausencia") {
    const quantos = s.meses >= s.janela
      ? `nos ${s.janela} meses anteriores`
      : `em ${s.meses} dos ${s.janela} meses anteriores`;
    const ultimo = s.ultimoMes && s.ultimoValor != null
      ? ` — o último foi ${brl(s.ultimoValor)} em ${rotuloMes(s.ultimoMes)}`
      : "";
    out.push({
      codigo: "ausencia_recorrente",
      detalhe:
        `Esta rubrica teve valor ${quantos}, mediana ${brl(s.mediana)}${ultimo}, e neste mês está `
        + `${s.zerada ? "zerada" : "sem linha nenhuma"}. Confira se o lançamento caiu em outra rubrica, `
        + `se a categoria ficou fora do DE-PARA ou se de fato não houve movimento.`,
    });
  }

  /* Atípico contra a própria série: a variação em % é pequena, mas a rubrica
     não costuma se mexer tanto. Sem esta frase o comentário sairia dizendo
     "variou 5%" — que é justamente o motivo pelo qual ninguém olhava. */
  if (c.motivo === "atipica" && s.z != null && s.mad > 0) {
    out.push({
      codigo: "atipico_na_serie",
      detalhe:
        `A variação é pequena em percentual, mas grande para esta rubrica: ela costuma ficar em `
        + `${brl(s.mediana)} e oscilar cerca de ${brl(s.mad)}.`,
    });
  }
  return out;
}

/** O contexto de série que a IA usa para ESCREVER — não acende aviso. */
function historicoDoPrompt(s: SerieResumo | null | undefined) {
  if (!s || s.meses < 2) return null;
  return {
    mesesComValor: `${s.meses} de ${s.janela} meses anteriores`,
    tipico: brl(s.mediana),
    oscilacaoTipica: s.mad > 0 ? brl(s.mad) : null,
    posicao: s.extremo ? `é o ${s.extremo} valor dos últimos ${s.janela} meses` : null,
  };
}

/**
 * Percentual como texto, sem arredondar para o número redondo que engana.
 *
 * -99,996% virava "-100,0%" e o comentário passava a dizer que a rubrica zerou
 * numa célula que ainda tinha R$ 1,00. Quem confere para de acreditar no resto.
 */
function pctTexto(p: number | null): string | null {
  if (p == null || !Number.isFinite(p)) return null;
  const a = Math.abs(p) * 100;
  const casas = a > 99.9 && a < 100 ? 2 : 1;
  return `${a.toFixed(casas).replace(".", ",")}%`;
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
    await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const tipo = body?.tipo === "dfc" ? "dfc" : "dre";
    const mes = String(body?.mes ?? "").trim();
    const mesAnterior = String(body?.mesAnterior ?? "").trim();
    const force = !!body?.force;
    const celulas: Celula[] = Array.isArray(body?.celulas) ? body.celulas : [];

    if (!/^[A-Za-z]{3}-\d{2}$/.test(mes) || !/^[A-Za-z]{3}-\d{2}$/.test(mesAnterior)) {
      return jsonResponse({ error: "mes/mesAnterior inválidos (esperado 'Jun-26')." }, 200);
    }
    if (!celulas.length) return jsonResponse({ ok: true, geradas: 0, puladas: 0, motivo: "nenhuma célula candidata" });

    /* --- 1) O que já foi conferido por gente ------------------------------
       Regeneração não pode apagar trabalho humano. Mas se os NÚMEROS mudaram
       desde o aceite (reimport corrigiu o mês, sync recalculou), o "conferido"
       envelheceu: o texto é refeito e o status volta para 'novo'. */
    const { data: existentes } = await supabase
      .from("demonstracoes_justificativas")
      .select("id,rubrica,delta,status,texto_editado")
      .eq("tipo", tipo)
      .eq("mes", mes);

    /* Apagar um comentário é destrutivo, então só sai o que ninguém tocou:
       status 'novo' e sem reescrita. Aceito ou editado fica, mesmo obsoleto —
       a tela avisa que o número mudou. */
    const descartavel = (r: { status: string; texto_editado: string | null }) =>
      r.status === "novo" && !r.texto_editado;
    let removidas = 0;
    const apagar = async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase.from("demonstracoes_justificativas").delete().in("id", ids);
      if (!error) removidas += ids.length;
    };

    /* --- 1.1) Reconciliação: célula que não é mais candidata perde o texto ---
       `upsert` só reescreve o que volta, então comentário escrito sob a regra
       antiga (ou com o mês pela metade) ficaria na tela para sempre. A lista de
       candidatas que chega é a do mês INTEIRO — o que não está nela não variou o
       bastante para merecer comentário. */
    const candidatas = new Set(celulas.map((c) => c.rubrica));
    const orfas = ((existentes ?? []) as any[])
      .filter((r) => !candidatas.has(r.rubrica) && descartavel(r))
      .map((r) => String(r.id));
    await apagar(orfas);

    const anteriores = new Map<string, { id: string; delta: number | null; status: string; texto_editado: string | null }>();
    for (const r of (existentes ?? []) as any[]) anteriores.set(r.rubrica, r);

    const mudouNumero = (rub: string, delta: number) => {
      const a = anteriores.get(rub);
      if (!a || a.delta == null) return true;
      return Math.abs(Number(a.delta) - delta) > Math.max(1, Math.abs(delta) * 0.005);
    };

    const aRegerar: Celula[] = [];
    const reabrir: string[] = [];
    let puladas = 0;
    for (const c of celulas) {
      const a = anteriores.get(c.rubrica);
      // Número idêntico ao da última geração: o texto continua valendo. Reescrever
      // gastaria uma ida ao Gemini para produzir quase a mesma frase — e apagaria
      // a diferença entre "já conferido" e "acabou de sair".
      if (a && !force && !mudouNumero(c.rubrica, c.delta)) { puladas++; continue; }
      // Só reabre se foi apenas gerado e nunca foi revisado (status='novo').
      // Se o usuário já confirmou (status='aceito'), respeita a decisão mesmo que
      // o número mude ligeiramente — ex.: destravar mês, fazer ajuste no Omie,
      // retravar. Se reescreveu (texto_editado), também deixa quieto (pode reabrir
      // se forçar manualmente com force=true).
      if (a && !force && a.status === "novo" && mudouNumero(c.rubrica, c.delta)) {
        reabrir.push(a.id);
      }
      aRegerar.push(c);
    }
    if (!aRegerar.length) {
      return jsonResponse({ ok: true, geradas: 0, puladas, removidas, mes, tipo });
    }

    /* --- 2) Quem se mexeu, direto dos lançamentos do Omie ----------------- */
    const [{ data: contras, error: contraErr }, pessoas] = await Promise.all([
      supabase.rpc("demonstracoes_contrapartes", {
        p_tipo: tipo,
        p_meses: [mesAnterior, mes],
      }),
      /* O de-para "razão social -> pessoa". Entra AQUI, antes de montar os
         drivers, e não só na saída: assim o modelo nunca chega a ver a razão
         social, e os drivers gravados ao lado do texto já mostram o nome que a
         pessoa espera ler. */
      carregarPessoasPJ(supabase),
    ]);
    if (contraErr) throw contraErr;

    // rubrica -> contraparte -> { atual, anterior }
    const porRubrica = new Map<string, Map<string, { atual: number; anterior: number; categoria: string | null; razaoSocial?: string | null }>>();
    for (const r of (contras ?? []) as any[]) {
      const rub = String(r.rubrica);
      if (!porRubrica.has(rub)) porRubrica.set(rub, new Map());
      const m = porRubrica.get(rub)!;
      // Quando for cartão (contraparte genérica), use a categoria como nome melhorado
      let nome = String(r.contraparte ?? "Sem contraparte");
      if (nome === "Lancamento Fatura Cartao") {
        nome = String(r.categoria ?? nome);
      }
      /* A PJ de uma pessoa vira a pessoa. Aqui em cima, no ponto único onde o
         nome nasce: tudo o que vem depois — drivers, sinais, prompt, o jsonb
         gravado — herda o nome trocado sem precisar saber que a troca existe.
         Duas razões sociais da MESMA pessoa passam a somar num driver só, que é
         o que quem lê espera ver. */
      const daOmie = nome;
      nome = pessoaDe(pessoas, nome);
      const atualBase = m.get(nome) ?? {
        atual: 0,
        anterior: 0,
        categoria: r.categoria ?? null,
        razaoSocial: nome === daOmie ? null : daOmie,
      };
      if (r.mes === mes) atualBase.atual += Number(r.valor) || 0;
      else atualBase.anterior += Number(r.valor) || 0;
      m.set(nome, atualBase);
    }

    /* --- 3) Monta o dossiê de cada célula --------------------------------- */
    /* Uma contraparte pode aparecer em mais de uma fonte da mesma célula (a
       mesma pessoa em "Equipe Comercial" e "Equipe Operacional" dentro de
       "Pessoal"): soma, senão ela viraria dois drivers menores e nenhum deles
       explicaria nada sozinho. */
    const contrapartesDe = (c: Celula) => {
      const fontes = c.fontes?.length ? c.fontes : [c.rubrica];
      const uniao = new Map<string, { atual: number; anterior: number; categoria: string | null; razaoSocial?: string | null }>();
      for (const f of fontes) {
        for (const [nome, v] of porRubrica.get(f) ?? new Map()) {
          const acc = uniao.get(nome) ?? { atual: 0, anterior: 0, categoria: v.categoria, razaoSocial: v.razaoSocial ?? null };
          acc.atual += v.atual;
          acc.anterior += v.anterior;
          uniao.set(nome, acc);
        }
      }
      return uniao;
    };

    const dossiesTodos = aRegerar.map((c) => {
      const orient = (n: number | null) => (n == null ? 0 : c.despesa ? Math.abs(n) : n);
      const valorO = orient(c.valor);
      const anteriorO = orient(c.valorAnterior);
      const deltaO = valorO - anteriorO;

      const { drivers, deltaOmie } = montarDrivers(contrapartesDe(c), c.despesa);
      const sinais = montarSinais(c, drivers, deltaOmie, deltaO);
      const somaTop = drivers.reduce((s, d) => s + d.delta, 0);
      const cobertura = Math.abs(deltaO) > 0 ? somaTop / deltaO : null;
      const direcao = deltaO > 0 ? "subiu" : "caiu";
      const pct = pctTexto(c.deltaPct);

      /* Numa ausência em que o mês anterior TAMBÉM estava vazio o delta é zero,
         e "caiu 0" não é frase. Quem carrega o fato aí é a série, não o par. */
      const movimento = c.motivo === "ausencia" && Math.abs(deltaO) < 1
        ? `não veio neste mês (a rubrica costuma trazer ${brl(c.serie?.mediana ?? 0)})`
        : `${direcao} ${abrev(Math.abs(deltaO))}${pct ? ` (${pct})` : ""}`;

      return {
        celula: c,
        drivers,
        sinais,
        cobertura,
        payload: {
          rubrica: c.rubrica,
          natureza: c.despesa ? "despesa (subir = gastar mais)" : "receita/resultado",
          valorMesAtual: brl(valorO),
          valorMesAnterior: brl(anteriorO),
          // Já redigido, com o sinal resolvido: o modelo escrevia "caiu -23,0k"
          // quando recebia "-23,0k" e a instrução de falar em subiu/caiu.
          movimento,
          historico: historicoDoPrompt(c.serie),
          cobertura: cobertura == null ? null : `${Math.round(cobertura * 100)}% da variação está explicada pelos drivers abaixo`,
          drivers: drivers.map((d) => ({
            contraparte: d.contraparte,
            categoriaNoOmie: d.categoria,
            movimento: d.movimento,
            fmtAnterior: d.fmtAnterior,
            fmtAtual: d.fmtAtual,
            fmtDelta: d.fmtDelta,
          })),
          sinais: sinais.map((s) => s.detalhe),
        },
      };
    });

    /* Sem NENHUM lançamento do Omie por trás, não há comentário a escrever: o
       texto que saía ("os lançamentos do Omie não cobrem essa variação, verifique
       o tracker / a janela de sincronização / o DE-PARA") é a máquina admitindo
       que não sabe, em três frases de prosa, numa nota que existe para ser colada
       no tracker. Eram 62% do que havia na base. O fato continua visível onde ele
       é acionável: clicar na célula mostra os lançamentos e a diferença contra a
       soma. */
    const dossies = dossiesTodos.filter((d) => d.drivers.length > 0);
    const semLastro = dossiesTodos.length - dossies.length;

    /* --- 4) Redação ------------------------------------------------------- */
    let orgCtx = "";
    try { orgCtx = await buildOrgContext(supabase); } catch { /* segue sem a Biblioteca */ }

    const schema = {
      type: "object",
      properties: {
        justificativas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rubrica: { type: "string" },
              texto: { type: "string" },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
            },
            required: ["rubrica", "texto", "confianca"],
          },
        },
      },
      required: ["justificativas"],
    };

    const porRubricaTexto = new Map<string, { texto: string; confianca: string }>();
    /* Falha de redação NÃO é resposta. Contada aqui porque é ela que decide se o
       descarte pode rodar — e porque volta para a tela: uma regeração que não
       escreveu nada precisa dizer isso, não sair calada. */
    let lotesFalhos = 0;
    let falhaIA: string | null = null;

    const redigir = async (lote: typeof dossies) => {
      const out = await generateJSON<{ justificativas: { rubrica: string; texto: string; confianca: string }[] }>({
        consumidor: "dre_dfc",
        temperature: 0.35,
        responseSchema: schema,
        messages: [
          { role: "system", content: `${ESTILO}\n\n${orgCtx}` },
          {
            role: "user",
            content:
              `Demonstrativo: ${tipo.toUpperCase()}\n` +
              `Mês: ${rotuloMes(mes)} — comparado com ${rotuloMes(mesAnterior)}\n\n` +
              `Escreva uma justificativa para CADA rubrica abaixo. Devolva a mesma quantidade de itens, ` +
              `com o campo "rubrica" idêntico ao que veio.\n\n` +
              JSON.stringify(lote.map((d) => d.payload), null, 1),
          },
        ],
      });
      for (const j of out?.justificativas ?? []) {
        if (j?.rubrica && j?.texto) {
          porRubricaTexto.set(String(j.rubrica), {
            /* Rede, não o caminho principal — os drivers já foram trocados na
               entrada. Serve para a razão social que o modelo pescou na
               Biblioteca ou reescreveu por conta própria. */
            texto: pessoasNoTexto(pessoas, String(j.texto).trim()),
            confianca: ["alta", "media", "baixa"].includes(j.confianca) ? j.confianca : "media",
          });
        }
      }
    };

    for (let i = 0; i < dossies.length; i += LOTE) {
      const lote = dossies.slice(i, i + LOTE);
      try {
        await redigir(lote);
      } catch {
        // Segunda tentativa: regerar vários meses dispara as chamadas em rajada e
        // o provedor responde 429. A pausa é o que faz a segunda passar.
        await new Promise((r) => setTimeout(r, 4000));
        try {
          await redigir(lote);
        } catch (e) {
          // Um lote que falha não derruba os outros: o mês fica com as células que
          // deram certo, e a tela mostra menos comentários em vez de nenhum.
          lotesFalhos++;
          falhaIA = e instanceof Error ? e.message : String(e);
          console.error("lote falhou", i, e);
        }
      }
    }

    /* --- 5) Grava ---------------------------------------------------------
       `status`, `texto_editado` e `editado_*` ficam FORA do payload de propósito:
       o PostgREST só atualiza as colunas que recebe, então a decisão humana
       atravessa a regeração intacta. */
    const linhas = dossies
      .filter((d) => porRubricaTexto.has(d.celula.rubrica))
      .map((d) => {
        const g = porRubricaTexto.get(d.celula.rubrica)!;
        return {
          tipo,
          rubrica: d.celula.rubrica,
          mes,
          mes_anterior: mesAnterior,
          valor: d.celula.valor,
          valor_anterior: d.celula.valorAnterior,
          delta: d.celula.delta,
          delta_pct: d.celula.deltaPct,
          despesa: d.celula.despesa,
          texto: g.texto,
          drivers: d.drivers,
          cobertura: d.cobertura,
          // Cobertura magra é confiança baixa, independentemente do que a IA
          // achou de si mesma: ela redige bem justamente quando sabe pouco.
          confianca: Math.abs(Number(d.cobertura ?? 0)) < 0.5 ? "baixa" : g.confianca,
          sinais: d.sinais,
          modelo: DEFAULT_MODEL,
          gerado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        };
      });

    if (linhas.length) {
      const { error: upErr } = await supabase
        .from("demonstracoes_justificativas")
        .upsert(linhas, { onConflict: "tipo,rubrica,mes" });
      if (upErr) throw upErr;
    }

    if (reabrir.length) {
      await supabase
        .from("demonstracoes_justificativas")
        .update({ status: "novo", atualizado_em: new Date().toISOString() })
        .in("id", reabrir);
    }

    /* --- 6) Descarte do que deixou de merecer comentário ------------------
       SÓ POR DECISÃO, NUNCA POR FALHA. Esta distinção custou os comentários de
       Jun e Jul/26 da DRE: a regra anterior apagava toda célula sem texto novo,
       e "sem texto" incluía o lote que o Gemini recusou. A tela ficou vazia sem
       ninguém ter decidido nada.

       Some quem perdeu o lastro — decisão determinística, tomada aqui em cima,
       sem IA no meio. Quem o modelo simplesmente não devolveu FICA como estava.

       E o freio: se NENHUMA célula do mês tem driver, isso não é diagnóstico, é
       insumo quebrado (cache do Omie vazio, DE-PARA fora do ar). Nesse caso não
       se apaga nada — foi exatamente o formato do estrago. */
    const algumComDriver = dossiesTodos.some((d) => d.drivers.length > 0);
    if (algumComDriver) {
      const semLastroRubricas = new Set(
        dossiesTodos.filter((d) => d.drivers.length === 0).map((d) => d.celula.rubrica),
      );
      await apagar(
        ((existentes ?? []) as any[])
          .filter((r) => semLastroRubricas.has(r.rubrica) && descartavel(r))
          .map((r) => String(r.id)),
      );
    }

    return jsonResponse({
      ok: true,
      tipo,
      mes,
      geradas: linhas.length,
      puladas,
      reabertas: reabrir.length,
      // Variou, mas nenhum lançamento do Omie por trás: não vira comentário.
      sem_lastro: semLastro,
      removidas,
      sem_texto: dossies.length - linhas.length,
      // A tela precisa saber que a redação falhou — senão "0 geradas" passa por
      // "não havia o que gerar", que foi como o estrago passou despercebido.
      lotes_falhos: lotesFalhos,
      falha_ia: falhaIA,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("demonstracoes-justificar error:", msg);
    if (msg.includes("autentic") || msg.includes("permissão")) return jsonResponse({ error: msg }, 401);
    return errorResponse(e);
  }
});
