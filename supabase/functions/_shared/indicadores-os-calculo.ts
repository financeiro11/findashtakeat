// O que o Hub calcula quando o Takeat OS deixa o realizado vazio.
//
// O OS publica a FÓRMULA de cada indicador calculado ("[uuid] + [uuid]", "[cost:uuid] /
// [uuid]"), mas em 18/09/2026 só materializava o resultado de 52 dos 71: CAC, LTV, TM MRR,
// Payback e os totais consolidados vinham vazios. Aqui a fórmula é lida e avaliada sobre os
// mesmos números do OS, e cada valor preenchido carrega de onde veio (`origem`) e por quê
// (`nota`), para a tela nunca misturar número do OS com número do Hub sem dizer.
//
// Três regras decididas com o financeiro (18/09/2026):
//   1. SOMA com canal faltando (o Novo MRR Total de ago/26 sem Comunidade) soma o que foi
//      lançado e sai `hub_parcial`, com os canais que faltaram na nota.
//   2. `[cost:uuid]` não é o id de `os_custos` — o OS não expõe o mapa. Os custos que as
//      fórmulas POR CANAL identificam sem ambiguidade estão em CUSTO_POR_REF. O CAC
//      consolidado usa a regra aprovada: todo `os_custos` MENOS as equipes Sucesso, Suporte e
//      Liderança OPS (bate com os 16 custos da fórmula do OS), mais o ADS da fórmula.
//   3. O CAC MKT tem 1 custo que não se identifica: sai como Investimentos + Comissões + ADS,
//      marcado `hub_estimado`.

// Mora em _shared porque roda nos dois lados: a tela /indicadores (src/lib reexporta) e a
// Edge Function os-indicadores-calcular, que grava o resultado em `os_painel_calculado` para
// o Assistente e a Revisão do Mês. Um cálculo só — duas cópias divergiriam no primeiro ajuste.
// Sem import nenhum de propósito: o Deno e o Vite leem o mesmo arquivo.

/**
 * De onde veio o realizado. `os` = lançado ou calculado pelo próprio OS; o resto foi o Hub
 * que calculou porque o OS deixou vazio.
 */
export type Origem = "os" | "hub" | "hub_parcial" | "hub_estimado";

/** O que o cálculo precisa de cada indicador (a linha de `os_indicadores`). */
export type IndicadorOS = {
  id: string;
  departamento: string;
  canal: string;
  indicador: string;
  e_formula: boolean | null;
  formula?: string | null;
};

/** Uma linha de `os_painel_mensal`, com a origem quando o Hub preencheu. */
export type LinhaMensalOS = {
  indicator_id: string;
  ano: number;
  mes: number;
  competencia: string;
  orcado: number | null;
  realizado: number | null;
  origem?: Origem;
  nota?: string;
};

export type CustoOS = { competencia: string; grupo: string; categoria: string; valor: number | null };
export type AssinaturaOS = { competencia: string; clientes: number | null };

/* ================================ sentido ================================ */

export type Sentido = "maior" | "menor" | "neutro";

// O OS só marca `menor_e_melhor` nos dois tempos do Suporte (18/09/2026). Churn,
// cancelamento, downsell, CAC e CPL vêm sem a marca, e o `atingimento_pct` do próprio OS
// sai como "230%" para um churn de 2,3% contra meta de 1% — lido pelo sentido padrão, o
// pior resultado do mês pareceria o melhor. A regra por nome cobre isso até o OS corrigir
// a marca; a marca, quando vier, vale sozinha. Mora aqui para a tela e o Assistente
// lerem o farol do mesmo jeito.
const MENOR_POR_NOME = /churn|cancelad|downsell|\bcac\b|\bcpl\b|payback|tempo|ratio volume/;
// Investimento é orçamento a gastar, não meta a bater: passar do orçado não é "bom".
const NEUTRO_POR_NOME = /^investimento/;

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// LTV/CAC tem "cac" no nome e é o contrário: quanto MAIOR, melhor. Achado no teste com o
// dado real de ago/26, que dizia "3,18 contra meta 3 — ruim".
const MAIOR_POR_NOME = /^ltv/;

export function sentidoDe(ind: { indicador: string; menor_e_melhor?: boolean | null }): Sentido {
  if (ind.menor_e_melhor) return "menor";
  const nome = semAcento(ind.indicador ?? "");
  if (MAIOR_POR_NOME.test(nome)) return "maior";
  if (NEUTRO_POR_NOME.test(nome)) return "neutro";
  if (MENOR_POR_NOME.test(nome)) return "menor";
  return "maior";
}

/* ================================ parser ================================ */

export type No =
  | { t: "num"; v: number }
  | { t: "ref"; id: string }
  | { t: "custo"; id: string }
  | { t: "neg"; a: No }
  | { t: "op"; op: "+" | "-" | "*" | "/"; a: No; b: No };

const TOKEN = /\s*(\[cost:[0-9a-f-]{36}\]|\[[0-9a-f-]{36}\]|\d+(?:\.\d+)?|[()+\-*/])/y;

function tokens(f: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < f.length) {
    if (/^\s*$/.test(f.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(f);
    if (!m) throw new Error(`Fórmula ilegível perto de "${f.slice(pos, pos + 20)}"`);
    out.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  return out;
}

/** Lê a fórmula do OS. Lança erro se não for aritmética simples sobre refs e números. */
export function parseFormula(f: string): No {
  const tk = tokens(f);
  let i = 0;
  const ver = () => tk[i];
  const tomar = () => tk[i++];

  function fator(): No {
    const t = tomar();
    if (t === undefined) throw new Error("Fórmula terminou antes da hora");
    if (t === "(") {
      const e = expr();
      if (tomar() !== ")") throw new Error("Parêntese sem fechar");
      return e;
    }
    if (t === "-") return { t: "neg", a: fator() };
    if (t.startsWith("[cost:")) return { t: "custo", id: t.slice(6, -1) };
    if (t.startsWith("[")) return { t: "ref", id: t.slice(1, -1) };
    const v = Number(t);
    if (!isFinite(v)) throw new Error(`Token inesperado "${t}"`);
    return { t: "num", v };
  }
  function termo(): No {
    let a = fator();
    while (ver() === "*" || ver() === "/") {
      const op = tomar() as "*" | "/";
      a = { t: "op", op, a, b: fator() };
    }
    return a;
  }
  function expr(): No {
    let a = termo();
    while (ver() === "+" || ver() === "-") {
      const op = tomar() as "+" | "-";
      a = { t: "op", op, a, b: termo() };
    }
    return a;
  }

  const raiz = expr();
  if (i < tk.length) throw new Error(`Sobrou "${tk.slice(i).join(" ")}" no fim da fórmula`);
  return raiz;
}

/** As refs de indicador e de custo que a fórmula cita. */
export function refsDe(no: No): { refs: string[]; custos: string[] } {
  const refs: string[] = [];
  const custos: string[] = [];
  const andar = (n: No) => {
    if (n.t === "ref") refs.push(n.id);
    else if (n.t === "custo") custos.push(n.id);
    else if (n.t === "neg") andar(n.a);
    else if (n.t === "op") { andar(n.a); andar(n.b); }
  };
  andar(no);
  return { refs, custos };
}

/** Só `+` entre refs de indicador — o caso em que faltar um canal pode virar "parcial". */
export function ehSomaPura(no: No): boolean {
  if (no.t === "ref") return true;
  return no.t === "op" && no.op === "+" && ehSomaPura(no.a) && ehSomaPura(no.b);
}

/** Avalia com null contagioso: qualquer entrada vazia (ou divisão por zero) dá null. */
export function avaliar(no: No, valor: (id: string) => number | null, custo: (id: string) => number | null): number | null {
  switch (no.t) {
    case "num": return no.v;
    case "ref": return valor(no.id);
    case "custo": return custo(no.id);
    case "neg": { const a = avaliar(no.a, valor, custo); return a == null ? null : -a; }
    case "op": {
      const a = avaliar(no.a, valor, custo);
      const b = avaliar(no.b, valor, custo);
      if (a == null || b == null) return null;
      if (no.op === "+") return a + b;
      if (no.op === "-") return a - b;
      if (no.op === "*") return a * b;
      return b === 0 ? null : a / b;
    }
  }
}

/**
 * Os indicadores que DEPENDEM de um sensível (direta ou indiretamente) também são sensíveis.
 *
 * O OS marca só Margem de Contribuição e LTV. Mas LTV/CAC e CAC Payback são calculados com
 * eles, e com LTV/CAC e o CAC (que não é sensível) qualquer um reconstrói o LTV. Quem não vê
 * as Demonstrações não pode ver nenhum dos três.
 */
export function idsSensiveis(indicadores: (IndicadorOS & { sensivel?: boolean | null })[]): Set<string> {
  const sens = new Set(indicadores.filter((i) => i.sensivel).map((i) => i.id));
  const deps = indicadores
    .filter((i) => i.e_formula && i.formula)
    .map((i) => {
      try { return { id: i.id, refs: refsDe(parseFormula(i.formula!)).refs }; } catch { return null; }
    })
    .filter((x): x is { id: string; refs: string[] } => x != null);
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const d of deps) {
      if (!sens.has(d.id) && d.refs.some((r) => sens.has(r))) { sens.add(d.id); mudou = true; }
    }
  }
  return sens;
}

/* ================================ custos ================================ */

/**
 * `[cost:uuid]` → categoria de `os_custos`, só o que as fórmulas POR CANAL identificam sem
 * ambiguidade (o CAC de cada canal cita um custo só). O que não está aqui não se resolve.
 */
export const CUSTO_POR_REF: Record<string, { grupo: string; categoria: string }> = {
  "4795d14c-485d-4df5-b764-03b2cb9f74e5": { grupo: "Comissões", categoria: "Agência de Marketing" },
  "1819576e-bfa9-4311-83bc-23fc27507dee": { grupo: "Comissões", categoria: "Consultores" },
  "bfe13f38-b91c-45ce-8818-3ec9443af67d": { grupo: "Comissões", categoria: "Contadores" },
  // Está no CAC MKT (investimento + comissão), então é o investimento em eventos, não a equipe.
  "6849b020-9833-404d-ad37-3fa838975cd6": { grupo: "Investimentos", categoria: "Eventos" },
  // Fora do CAC MKT: é a equipe.
  "4e520604-5143-4cab-ba2d-ba2bb7dd50f5": { grupo: "Equipes", categoria: "Field Sales" },
};

/** Equipes que não são aquisição — a regra do CAC consolidado aprovada em 18/09/2026. */
export const FORA_DO_CAC = ["Sucesso", "Suporte", "Liderança OPS"];

/* ================================ completar o mês ================================ */

const PESO: Record<Origem, number> = { os: 0, hub: 1, hub_estimado: 2, hub_parcial: 3 };
const pior = (a: Origem, b: Origem): Origem => (PESO[a] >= PESO[b] ? a : b);
const mesAnterior = (c: string) => {
  const [a, m] = c.slice(0, 7).split("-").map(Number);
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, "0")}-01`;
};

/**
 * Devolve as linhas do OS com os vazios preenchidos quando dá para calcular. Nunca
 * sobrescreve número do OS: só preenche `realizado` nulo (ou linha que não existe).
 */
export function completarMensal(
  indicadores: IndicadorOS[],
  linhas: LinhaMensalOS[],
  custos: CustoOS[],
  assinaturas: AssinaturaOS[],
): LinhaMensalOS[] {
  const porId = new Map(indicadores.map((i) => [i.id, i]));
  const achar = (canal: string, nome: string, depto?: string) =>
    indicadores.find((i) => i.canal === canal && i.indicador === nome && (!depto || i.departamento === depto));

  const clientesDoMes = new Map(assinaturas.map((a) => [a.competencia.slice(0, 10), a.clientes]));
  const custosDoMes = new Map<string, CustoOS[]>();
  for (const c of custos) {
    const k = c.competencia.slice(0, 10);
    if (!custosDoMes.has(k)) custosDoMes.set(k, []);
    custosDoMes.get(k)!.push(c);
  }

  // Estado: comp → id → linha (cópia, para não mexer no array de entrada).
  const estado = new Map<string, Map<string, LinhaMensalOS>>();
  // O OS manda o TOTAL ANUAL como mês 13, sem competência. Não é mês: fica de fora.
  for (const l of linhas) {
    if (!l.competencia) continue;
    const k = l.competencia.slice(0, 10);
    if (!estado.has(k)) estado.set(k, new Map());
    estado.get(k)!.set(l.indicator_id, { ...l, origem: l.origem ?? "os" });
  }

  const formulas = indicadores
    .filter((i) => i.e_formula && i.formula)
    .map((i) => {
      try { return { ind: i, no: parseFormula(i.formula!) }; } catch { return null; }
    })
    .filter((x): x is { ind: IndicadorOS; no: No } => x != null);

  const cacTotal = achar("Consolidado", "CAC", "Aquisição");
  const cacMkt = achar("Consolidado", "CAC MKT", "Aquisição");
  const totalClientes = achar("Consolidado", "Total Clientes");
  const ativChurnQtd = achar("Ativação", "Customer Churn");
  const ativChurnPct = achar("Ativação", "% Customer Churn");

  for (const [comp, linhasDoMes] of estado) {
    const [ano, mes] = comp.split("-").map(Number);
    const pegar = (id: string) => linhasDoMes.get(id);
    const gravar = (id: string, valor: number, origem: Origem, nota: string) => {
      const l = pegar(id);
      if (l && l.realizado != null) return false;
      linhasDoMes.set(id, {
        indicator_id: id, ano, mes, competencia: comp, orcado: l?.orcado ?? null,
        realizado: valor, origem, nota,
      });
      return true;
    };

    // --- entradas que o OS não traz ---
    const cli = clientesDoMes.get(comp);
    if (totalClientes && cli != null) {
      gravar(totalClientes.id, cli, "hub", "Clientes ativos no mês, da carteira do OS (os_assinaturas).");
    }
    const cliBase = clientesDoMes.get(mesAnterior(comp));
    const pctAtiv = ativChurnPct ? pegar(ativChurnPct.id)?.realizado : null;
    if (ativChurnQtd && pctAtiv != null && cliBase != null) {
      gravar(ativChurnQtd.id, Math.round((pctAtiv / 100) * cliBase), "hub_estimado",
        `Estimado: ${pctAtiv}% × ${cliBase} clientes da base (o OS lança só o %).`);
    }

    const lista = custosDoMes.get(comp);
    const custo = (id: string): number | null => {
      if (!lista) return null; // mês sem custo nenhum lançado: não dá para calcular
      const alvo = CUSTO_POR_REF[id];
      if (!alvo) return null;
      return lista.filter((c) => c.grupo === alvo.grupo && c.categoria === alvo.categoria)
        .reduce((a, c) => a + (c.valor ?? 0), 0);
    };

    const leitura = (id: string) => {
      const l = pegar(id);
      return l?.realizado ?? null;
    };
    // Número calculado em cima de parcial/estimado herda a marca pior das entradas.
    const origemDe = (refs: string[]): Origem =>
      refs.reduce<Origem>((o, r) => pior(o, pegar(r)?.origem ?? "os"), "os");

    const calcularCAC = (ind: IndicadorOS, no: No): { v: number; origem: Origem; nota: string } | null => {
      if (!lista || no.t !== "op" || no.op !== "/") return null;
      const { refs } = refsDe(no.a);
      const novos = avaliar(no.b, leitura, () => null);
      if (novos == null || novos === 0) return null;
      const ads = refs.reduce((a, r) => a + (leitura(r) ?? 0), 0);
      const ehMkt = ind.id === cacMkt?.id;
      const custosDaRegra = lista
        .filter((c) => (ehMkt ? c.grupo === "Investimentos" || c.grupo === "Comissões" : !FORA_DO_CAC.includes(c.categoria)))
        .reduce((a, c) => a + (c.valor ?? 0), 0);
      const origem = pior(ehMkt ? "hub_estimado" : "hub", origemDe(refsDe(no.b).refs));
      const nota = ehMkt
        ? "Estimado: Investimentos + Comissões + ADS ÷ novos clientes (1 custo da fórmula do OS não é identificável)."
        : `Custos do OS menos ${FORA_DO_CAC.join(", ")}, mais ADS, ÷ novos clientes.`;
      return { v: (custosDaRegra + ads) / novos, origem, nota };
    };

    // --- ponto fixo: fórmula que depende de fórmula (LTV ← TM MRR ← Novo MRR Total) ---
    for (let volta = 0, aceitarParcial = false; volta < 12; volta++) {
      let mudou = false;
      for (const { ind, no } of formulas) {
        if (pegar(ind.id)?.realizado != null) continue;

        if (ind.id === cacTotal?.id || ind.id === cacMkt?.id) {
          const r = calcularCAC(ind, no);
          if (r) mudou = gravar(ind.id, r.v, r.origem, r.nota) || mudou;
          continue;
        }

        const { refs, custos: cs } = refsDe(no);
        const v = avaliar(no, leitura, custo);
        if (v != null) {
          const base = origemDe(refs);
          mudou = gravar(ind.id, v, pior("hub", base), cs.length ? "Calculado pelo Hub com a fórmula do OS (custo de os_custos)." : "Calculado pelo Hub com a fórmula do OS.") || mudou;
          continue;
        }

        if (aceitarParcial && ehSomaPura(no)) {
          const presentes = refs.filter((r) => leitura(r) != null);
          if (!presentes.length) continue;
          const faltaram = refs.filter((r) => leitura(r) == null).map((r) => porId.get(r)?.canal ?? "?");
          const soma = presentes.reduce((a, r) => a + (leitura(r) as number), 0);
          mudou = gravar(ind.id, soma, "hub_parcial", `Parcial: soma dos canais que lançaram; faltou ${[...new Set(faltaram)].join(", ")}.`) || mudou;
        }
      }
      if (!mudou) {
        if (aceitarParcial) break;
        aceitarParcial = true; // só depois que nada mais fecha inteiro
      }
    }
  }

  return [...estado.values()].flatMap((m) => [...m.values()]);
}
