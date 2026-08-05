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
// Body: {
//   tipo: 'dre'|'dfc', mes: 'Jun-26', mesAnterior: 'May-26',
//   celulas: [{ rubrica, valor, valorAnterior, delta, deltaPct, despesa }],
//   force?: boolean            // regera até o que já foi aceito/reescrito
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, handleCors, jsonResponse, errorResponse, DEFAULT_MODEL } from "../_shared/gemini.ts";
import { buildOrgContext } from "../_shared/org-context.ts";

/* Quantas células por chamada ao Gemini. Lotes grandes economizam tokens de
   contexto (o prompt de estilo é longo), mas pioram a qualidade: o modelo passa
   a repetir a mesma frase em rubricas diferentes. 12 foi o ponto em que os
   textos ainda saem específicos. */
const LOTE = 12;
/** Contrapartes citáveis por célula. Acima disso vira lista de compras. */
const MAX_DRIVERS = 6;

type Celula = {
  rubrica: string;
  valor: number | null;
  valorAnterior: number | null;
  delta: number;
  deltaPct: number | null;
  despesa: boolean;
};

type Driver = {
  contraparte: string;
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
7. Se os drivers não explicarem a variação (veja "cobertura" e o sinal
   "sem_lastro_omie"), NÃO force uma explicação: diga que os lançamentos do Omie não
   cobrem a diferença e indique onde olhar (mês travado vindo do tracker, lançamento
   fora da janela de sincronização, ou DE-PARA).
`.trim();

/* ============================================================
 *  Drivers e sinais — determinísticos, calculados aqui
 * ============================================================ */

function montarDrivers(
  porContraparte: Map<string, { atual: number; anterior: number; categoria: string | null }>,
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
  if (!c.valorAnterior) {
    sinais.push({ codigo: "sem_anterior", detalhe: "Não havia valor no mês anterior — a variação é de base zero." });
  }
  return sinais;
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
    if (!aRegerar.length) return jsonResponse({ ok: true, geradas: 0, puladas, mes, tipo });

    /* --- 2) Quem se mexeu, direto dos lançamentos do Omie ----------------- */
    const { data: contras, error: contraErr } = await supabase.rpc("demonstracoes_contrapartes", {
      p_tipo: tipo,
      p_meses: [mesAnterior, mes],
    });
    if (contraErr) throw contraErr;

    // rubrica -> contraparte -> { atual, anterior }
    const porRubrica = new Map<string, Map<string, { atual: number; anterior: number; categoria: string | null }>>();
    for (const r of (contras ?? []) as any[]) {
      const rub = String(r.rubrica);
      if (!porRubrica.has(rub)) porRubrica.set(rub, new Map());
      const m = porRubrica.get(rub)!;
      // Quando for cartão (contraparte genérica), use a categoria como nome melhorado
      let nome = String(r.contraparte ?? "Sem contraparte");
      if (nome === "Lancamento Fatura Cartao") {
        nome = String(r.categoria ?? nome);
      }
      const atualBase = m.get(nome) ?? { atual: 0, anterior: 0, categoria: r.categoria ?? null };
      if (r.mes === mes) atualBase.atual += Number(r.valor) || 0;
      else atualBase.anterior += Number(r.valor) || 0;
      m.set(nome, atualBase);
    }

    /* --- 3) Monta o dossiê de cada célula --------------------------------- */
    const dossies = aRegerar.map((c) => {
      const orient = (n: number | null) => (n == null ? 0 : c.despesa ? Math.abs(n) : n);
      const valorO = orient(c.valor);
      const anteriorO = orient(c.valorAnterior);
      const deltaO = valorO - anteriorO;

      const { drivers, deltaOmie } = montarDrivers(porRubrica.get(c.rubrica) ?? new Map(), c.despesa);
      const sinais = montarSinais(c, drivers, deltaOmie, deltaO);
      const somaTop = drivers.reduce((s, d) => s + d.delta, 0);
      const cobertura = Math.abs(deltaO) > 0 ? somaTop / deltaO : null;

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
          variacao: `${deltaO > 0 ? "+" : ""}${abrev(deltaO)}`,
          variacaoPct: c.deltaPct == null ? null : `${(c.deltaPct * 100).toFixed(1).replace(".", ",")}%`,
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
    for (let i = 0; i < dossies.length; i += LOTE) {
      const lote = dossies.slice(i, i + LOTE);
      try {
        const out = await generateJSON<{ justificativas: { rubrica: string; texto: string; confianca: string }[] }>({
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
              texto: String(j.texto).trim(),
              confianca: ["alta", "media", "baixa"].includes(j.confianca) ? j.confianca : "media",
            });
          }
        }
      } catch (e) {
        // Um lote que falha não derruba os outros: o mês fica com as células que
        // deram certo, e a tela mostra menos comentários em vez de nenhum.
        console.error("lote falhou", i, e);
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
          // Sem driver que explique, a confiança é baixa independentemente do que
          // a IA achou de si mesma.
          confianca: d.drivers.length === 0 ? "baixa" : g.confianca,
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

    return jsonResponse({
      ok: true,
      tipo,
      mes,
      geradas: linhas.length,
      puladas,
      reabertas: reabrir.length,
      sem_texto: dossies.length - linhas.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("demonstracoes-justificar error:", msg);
    if (msg.includes("autentic") || msg.includes("permissão")) return jsonResponse({ error: msg }, 401);
    return errorResponse(e);
  }
});
