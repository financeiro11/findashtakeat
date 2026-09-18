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
  /** Canais que não lançaram e deixaram este número incompleto (direto ou por herança). */
  faltam?: string[];
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

/** Valor de um `[cost:uuid]` no mês. null = mês sem custo lançado ou ref não identificada. */
export function custoDaRef(lista: CustoOS[] | undefined, id: string): number | null {
  if (!lista) return null; // mês sem custo nenhum lançado: não dá para calcular
  const alvo = CUSTO_POR_REF[id];
  if (!alvo) return null;
  return lista.filter((c) => c.grupo === alvo.grupo && c.categoria === alvo.categoria)
    .reduce((a, c) => a + (c.valor ?? 0), 0);
}

/** A linha de custo entra no CAC consolidado (ou no CAC MKT)? A regra, num lugar só. */
export function custoEntraNoCAC(c: { grupo: string; categoria: string }, mkt: boolean): boolean {
  return mkt ? c.grupo === "Investimentos" || c.grupo === "Comissões" : !FORA_DO_CAC.includes(c.categoria);
}

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
    const gravar = (id: string, valor: number, origem: Origem, nota: string, faltam?: string[]) => {
      const l = pegar(id);
      if (l && l.realizado != null) return false;
      linhasDoMes.set(id, {
        indicator_id: id, ano, mes, competencia: comp, orcado: l?.orcado ?? null,
        realizado: valor, origem, nota, ...(faltam?.length ? { faltam } : {}),
      });
      return true;
    };
    // Os canais faltantes das entradas: "incompleto" precisa dizer POR QUÊ, senão lê-se
    // "mês em andamento" (foi a leitura do financeiro em 18/09 olhando agosto fechado).
    const faltasDe = (refs: string[]) => [...new Set(refs.flatMap((r) => pegar(r)?.faltam ?? []))];
    const notaDeFalta = (f: string[]) => (f.length ? ` Incompleto: usa total sem ${f.join(", ")}, que não lançou o mês.` : "");

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
    const custo = (id: string): number | null => custoDaRef(lista, id);

    const leitura = (id: string) => {
      const l = pegar(id);
      return l?.realizado ?? null;
    };
    // Número calculado em cima de parcial/estimado herda a marca pior das entradas.
    const origemDe = (refs: string[]): Origem =>
      refs.reduce<Origem>((o, r) => pior(o, pegar(r)?.origem ?? "os"), "os");

    const calcularCAC = (ind: IndicadorOS, no: No): { v: number; origem: Origem; nota: string; faltam: string[] } | null => {
      if (!lista || no.t !== "op" || no.op !== "/") return null;
      const { refs } = refsDe(no.a);
      const novos = avaliar(no.b, leitura, () => null);
      if (novos == null || novos === 0) return null;
      const ads = refs.reduce((a, r) => a + (leitura(r) ?? 0), 0);
      const ehMkt = ind.id === cacMkt?.id;
      const custosDaRegra = lista
        .filter((c) => custoEntraNoCAC(c, ehMkt))
        .reduce((a, c) => a + (c.valor ?? 0), 0);
      const origem = pior(ehMkt ? "hub_estimado" : "hub", origemDe(refsDe(no.b).refs));
      const nota = ehMkt
        ? "Estimado: Investimentos + Comissões + ADS ÷ novos clientes (1 custo da fórmula do OS não é identificável)."
        : `Custos do OS menos ${FORA_DO_CAC.join(", ")}, mais ADS, ÷ novos clientes.`;
      return { v: (custosDaRegra + ads) / novos, origem, nota: nota + notaDeFalta(faltasDe(refsDe(no.b).refs)), faltam: faltasDe(refsDe(no.b).refs) };
    };

    // O número que o OS entregou pronto NUNCA é trocado aqui, mesmo quando a fórmula dele dá
    // outro valor: a tela tem de bater com o OS (decisão do financeiro, 18/09/2026). A
    // divergência vira item de `inconsistenciasDoMes`, para o time do OS corrigir lá.

    // --- ponto fixo: fórmula que depende de fórmula (LTV ← TM MRR ← Novo MRR Total) ---
    for (let volta = 0, aceitarParcial = false; volta < 12; volta++) {
      let mudou = false;
      for (const { ind, no } of formulas) {
        if (pegar(ind.id)?.realizado != null) continue;

        if (ind.id === cacTotal?.id || ind.id === cacMkt?.id) {
          const r = calcularCAC(ind, no);
          if (r) mudou = gravar(ind.id, r.v, r.origem, r.nota, r.faltam) || mudou;
          continue;
        }

        const { refs, custos: cs } = refsDe(no);
        const v = avaliar(no, leitura, custo);
        if (v != null) {
          const base = origemDe(refs);
          const f = faltasDe(refs);
          mudou = gravar(ind.id, v, pior("hub", base),
            (cs.length ? "Calculado pelo Hub com a fórmula do OS (custo de os_custos)." : "Calculado pelo Hub com a fórmula do OS.") + notaDeFalta(f),
            f) || mudou;
          continue;
        }

        if (aceitarParcial && ehSomaPura(no)) {
          const presentes = refs.filter((r) => leitura(r) != null);
          if (!presentes.length) continue;
          const faltaram = [...new Set([
            ...refs.filter((r) => leitura(r) == null).map((r) => porId.get(r)?.canal ?? "?"),
            ...faltasDe(presentes),
          ])];
          const soma = presentes.reduce((a, r) => a + (leitura(r) as number), 0);
          mudou = gravar(ind.id, soma, "hub_parcial",
            `Incompleto: soma dos canais que lançaram; ${faltaram.join(", ")} não lançou o mês.`, faltaram) || mudou;
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

/* ================================ memória de cálculo ================================ */
//
// "De onde saiu este número?" — para cada indicador num mês, a conta aberta: a fórmula com
// NOMES no lugar dos uuids, a mesma conta com os VALORES, cada entrada com a origem dela e,
// no CAC, a lista de custos com o que entra e o que fica fora. Usa as mesmas regras de
// `completarMensal` (custoDaRef, custoEntraNoCAC) — a explicação não pode contar uma
// história diferente da conta.

export type EntradaExplicada = {
  id: string | null;       // null = não é indicador do OS (ex.: clientes da carteira)
  nome: string;
  valor: number | null;
  unidade?: string | null;
  origem: Origem;
  nota?: string;
  /** É calculado também: dá para abrir a memória dele. */
  calculado: boolean;
};

export type CustoExplicado = { grupo: string; categoria: string; valor: number; entra: boolean };

export type Explicacao = {
  tipo: "lancado" | "formula" | "regra_cac" | "carteira" | "estimativa" | "sem_dado";
  resultado: number | null;
  origem: Origem;
  nota?: string;
  /** A fórmula do OS com nomes. */
  formula?: string;
  /** A mesma conta com os valores do mês. */
  conta?: string;
  entradas: EntradaExplicada[];
  custos?: CustoExplicado[];
  /** Quando o número veio do OS e é fórmula: o que a fórmula dá com os números do mês. */
  refeito?: number | null;
  observacoes: string[];
};

type IndicadorComUnidade = IndicadorOS & { unidade?: string | null };

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
const SIMBOLO: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷" };

/** Escreve a árvore de volta, trocando cada folha (ref ou custo) pelo texto de `folha`. */
export function escrever(no: No, folha: (n: No) => string): string {
  switch (no.t) {
    case "num": return String(no.v).replace(".", ",");
    case "ref":
    case "custo": return folha(no);
    case "neg": return `−${escrever(no.a, folha)}`;
    case "op": {
      const lado = (filho: No, direito: boolean) => {
        const t = escrever(filho, folha);
        if (filho.t !== "op") return t;
        const menor = PREC[filho.op] < PREC[no.op];
        // À direita, mesmo nível só dispensa parêntese em a + (b + c) e a × (b × c): o resto
        // ou muda a conta (a − (b − c)) ou esconde o agrupamento que o OS escreveu
        // (TM × (1 ÷ churn)), e quem audita lê a fórmula como ele pensou.
        const redundante = filho.op === no.op && (no.op === "+" || no.op === "*");
        const direitaQuebra = direito && PREC[filho.op] === PREC[no.op] && !redundante;
        return menor || direitaQuebra ? `(${t})` : t;
      };
      return `${lado(no.a, false)} ${SIMBOLO[no.op]} ${lado(no.b, true)}`;
    }
  }
}

export function explicar(
  id: string,
  competencia: string,
  indicadores: IndicadorComUnidade[],
  linhas: LinhaMensalOS[], // JÁ completadas (saída de completarMensal)
  custos: CustoOS[],
  assinaturas: AssinaturaOS[],
  fmt: (v: number | null, unidade?: string | null) => string =
    (v) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })),
): Explicacao {
  const comp = competencia.slice(0, 10);
  const porId = new Map(indicadores.map((i) => [i.id, i]));
  const doMes = new Map(linhas.filter((l) => l.competencia?.slice(0, 10) === comp).map((l) => [l.indicator_id, l]));
  const ind = porId.get(id);
  const linha = doMes.get(id);
  const resultado = linha?.realizado ?? null;
  const origem: Origem = linha?.origem ?? "os";
  const base = { resultado, origem, nota: linha?.nota, entradas: [] as EntradaExplicada[], observacoes: [] as string[] };
  if (!ind) return { ...base, tipo: "sem_dado", observacoes: ["Indicador não encontrado no OS."] };

  const nomeDe = (i?: IndicadorOS) =>
    i ? (i.canal === ind.canal ? i.indicador : `${i.canal} › ${i.indicador}`) : "indicador desconhecido";
  const entradaDe = (rid: string): EntradaExplicada => {
    const i = porId.get(rid) as IndicadorComUnidade | undefined;
    const l = doMes.get(rid);
    const o: Origem = l?.origem ?? "os";
    return {
      id: rid, nome: nomeDe(i), valor: l?.realizado ?? null, unidade: i?.unidade,
      origem: o, nota: l?.nota, calculado: !!(i?.e_formula && i.formula) || o !== "os",
    };
  };
  const lista = custos.filter((c) => c.competencia?.slice(0, 10) === comp);
  const listaOuNada = lista.length ? lista : undefined;
  const clientesDe = (c: string) => assinaturas.find((a) => a.competencia.slice(0, 10) === c)?.clientes ?? null;

  // --- Total Clientes: vem da carteira ---
  if (ind.canal === "Consolidado" && ind.indicador === "Total Clientes") {
    return {
      ...base, tipo: "carteira",
      formula: "Clientes ativos no fim do mês (carteira do OS)",
      conta: `${fmt(resultado)} clientes`,
      entradas: [{ id: null, nome: "Clientes ativos · os_assinaturas", valor: clientesDe(comp), origem: "os", calculado: false }],
      observacoes: ["O indicador está inativo e sem valor no OS; o Hub usa a carteira do próprio OS."],
    };
  }

  // --- churn de Ativação estimado ---
  if (ind.canal === "Ativação" && ind.indicador === "Customer Churn" && origem === "hub_estimado") {
    const pctInd = indicadores.find((i) => i.canal === "Ativação" && i.indicador === "% Customer Churn");
    const pctE = pctInd ? entradaDe(pctInd.id) : null;
    const cli = clientesDe(mesAnterior(comp));
    return {
      ...base, tipo: "estimativa",
      formula: "% Customer Churn × clientes da base (fim do mês anterior)",
      conta: `${fmt(pctE?.valor ?? null, "percent")} × ${fmt(cli)} = ${fmt(resultado)}`,
      entradas: [
        ...(pctE ? [pctE] : []),
        { id: null, nome: "Clientes da base · os_assinaturas do mês anterior", valor: cli, origem: "os", calculado: false },
      ],
      observacoes: ["Desde abr/26 o OS lança só o percentual do churn da Ativação; a quantidade é estimada com o mesmo denominador que o OS usa."],
    };
  }

  let no: No | null = null;
  if (ind.e_formula && ind.formula) {
    try { no = parseFormula(ind.formula); } catch { no = null; }
  }

  // --- CAC e CAC MKT consolidados calculados pela regra ---
  const ehCAC = ind.departamento === "Aquisição" && ind.canal === "Consolidado" &&
    (ind.indicador === "CAC" || ind.indicador === "CAC MKT");
  if (ehCAC && origem !== "os" && no && no.t === "op" && no.op === "/") {
    const mkt = ind.indicador === "CAC MKT";
    const ads = [...new Set(refsDe(no.a).refs)].map(entradaDe);
    const divisor = [...new Set(refsDe(no.b).refs)].map(entradaDe);
    const custosExp: CustoExplicado[] = lista.map((c) => ({
      grupo: c.grupo, categoria: c.categoria, valor: c.valor ?? 0, entra: custoEntraNoCAC(c, mkt),
    }));
    const somaCustos = custosExp.filter((c) => c.entra).reduce((a, c) => a + c.valor, 0);
    const somaAds = ads.reduce((a, e) => a + (e.valor ?? 0), 0);
    const novos = divisor[0]?.valor ?? null;
    return {
      ...base, tipo: "regra_cac",
      formula: mkt
        ? "(Investimentos + Comissões + investimento em ADS) ÷ Novos Clientes Total"
        : `(custos do OS menos ${FORA_DO_CAC.join(", ")} + investimento em ADS) ÷ Novos Clientes Total`,
      conta: `(${fmt(somaCustos, "BRL")} + ${fmt(somaAds, "BRL")}) ÷ ${fmt(novos)} = ${fmt(resultado, "BRL")}`,
      entradas: [...ads, ...divisor],
      custos: custosExp,
      observacoes: [
        mkt
          ? "A fórmula do OS soma 7 custos: 6 são Investimentos e Comissões e 1 não é identificável (o OS não expõe o mapa dos custos). Por isso é estimado."
          : "A fórmula do OS soma 16 custos que ele não identifica; a regra aprovada (tudo menos as equipes de operação) dá exatamente essas 16 categorias.",
        ...(ads.some((e) => e.valor == null) ? ["ADS sem lançamento no mês entra como zero."] : []),
      ],
    };
  }

  // --- fórmula do OS (calculada pelo OS ou pelo Hub) ---
  if (no) {
    const { refs, custos: cs } = refsDe(no);
    const entradas = [...new Set(refs)].map(entradaDe);
    const custoNome = (cid: string) => {
      const a = CUSTO_POR_REF[cid];
      return a ? `Custo ${a.grupo} › ${a.categoria}` : "Custo não identificado";
    };
    for (const cid of [...new Set(cs)]) {
      entradas.push({ id: null, nome: custoNome(cid), valor: custoDaRef(listaOuNada, cid), unidade: "BRL", origem: "os", calculado: false });
    }
    const leitura = (rid: string) => doMes.get(rid)?.realizado ?? null;
    const refeito = avaliar(no, leitura, (cid) => custoDaRef(listaOuNada, cid));
    const idDaFolha = (n: No) => (n.t === "ref" || n.t === "custo" ? n.id : "");
    const formula = escrever(no, (n) => (n.t === "ref" ? nomeDe(porId.get(n.id)) : custoNome(idDaFolha(n))));
    const conta = escrever(no, (n) => {
      if (n.t === "ref") return fmt(leitura(n.id), (porId.get(n.id) as IndicadorComUnidade | undefined)?.unidade);
      return fmt(custoDaRef(listaOuNada, idDaFolha(n)), "BRL");
    }) + ` = ${fmt(resultado, ind.unidade)}`;
    const observacoes: string[] = [];
    if (origem === "hub_parcial") {
      const parciais = entradas.filter((e) => e.origem === "hub_parcial").map((e) => e.nome);
      observacoes.push(ehSomaPura(no) && entradas.some((e) => e.valor == null)
        ? "Soma parcial: os canais sem lançamento ficaram de fora (aparecem como “não lançado” abaixo)."
        : `Parcial porque usa ${parciais.length ? parciais.join(", ") : "número parcial"}, que soma só os canais que lançaram.`);
    }
    if (origem === "os" && resultado != null && refeito != null &&
        Math.abs(refeito - resultado) > Math.max(0.01, Math.abs(resultado) * 0.005)) {
      observacoes.push(`O OS informa ${fmt(resultado, ind.unidade)}, mas a fórmula dele com os números do mês dá ${fmt(refeito, ind.unidade)}.`);
    }
    if (cs.some((c) => !CUSTO_POR_REF[c])) {
      observacoes.push("A fórmula usa custo que o OS não identifica; enquanto ele não expuser o mapa, o Hub não consegue refazê-la.");
    }
    return { ...base, tipo: "formula", formula, conta, entradas, refeito, observacoes };
  }

  // --- lançado direto no OS ---
  if (resultado == null) return { ...base, tipo: "sem_dado", observacoes: ["Sem lançamento no OS para este mês."] };
  return { ...base, tipo: "lancado", observacoes: ["Número lançado (ou importado) direto no Takeat OS — não é calculado."] };
}

/* ================================ inconsistências do OS ================================ */
//
// O Hub mostra o número do OS como ele está — a tela tem de bater com o OS (decisão do
// financeiro, 18/09/2026). O que parece errado no OS vira item desta lista, que o
// financeiro repassa ao time que mantém o OS. Cada item diz o que está errado e o que o
// Hub encontrou, com os números, para o outro lado conseguir achar sem perguntar.

export type TipoInconsistencia =
  | "formula_divergente"   // o número pronto do OS não bate com a fórmula dele
  | "nao_calculado"        // o OS tem a fórmula e deixa o resultado vazio
  | "canal_sem_lancamento" // total consolidado parcial porque um canal não lançou
  | "sentido"              // indicador "menor é melhor" sem a marca no OS
  | "sem_quantidade"       // o OS lança só o %, não a quantidade
  | "custo_divergente";    // matriz de custos do OS ≠ Painel CAC (acrescentado pela tela)

export type Inconsistencia = {
  tipo: TipoInconsistencia;
  /** Indicador a que o item se refere, quando é um só (para marcar na tela). */
  indicadorId?: string;
  texto: string;
};

export const TITULO_INCONSISTENCIA: Record<TipoInconsistencia, string> = {
  formula_divergente: "Número do OS diferente da fórmula dele",
  nao_calculado: "Fórmula que o OS não calcula",
  canal_sem_lancamento: "Canal sem lançamento no mês",
  sentido: "Indicador “menor é melhor” sem a marca",
  sem_quantidade: "Só o percentual, sem a quantidade",
  custo_divergente: "Custo do OS diferente do Painel CAC (Omie)",
};

type IndicadorAuditado = IndicadorOS & { menor_e_melhor?: boolean | null; ativo?: boolean | null; unidade?: string | null };

const fmtPadrao = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

export function inconsistenciasDoMes(
  indicadores: IndicadorAuditado[],
  linhas: LinhaMensalOS[], // JÁ completadas (saída de completarMensal)
  custos: CustoOS[],
  competencia: string,
  fmt: (v: number | null, unidade?: string | null) => string = fmtPadrao,
): Inconsistencia[] {
  const comp = competencia.slice(0, 10);
  const porId = new Map(indicadores.map((i) => [i.id, i]));
  const doMes = new Map(linhas.filter((l) => l.competencia?.slice(0, 10) === comp).map((l) => [l.indicator_id, l]));
  const lista = custos.filter((c) => c.competencia?.slice(0, 10) === comp);
  const listaOuNada = lista.length ? lista : undefined;
  const nome = (i: IndicadorOS) => `${i.canal} › ${i.indicador}`;
  const saida: Inconsistencia[] = [];

  const formulas = indicadores
    .filter((i) => i.e_formula && i.formula && i.ativo !== false)
    .map((i) => { try { return { i, no: parseFormula(i.formula!) }; } catch { return null; } })
    .filter((x): x is { i: IndicadorAuditado; no: No } => x != null);

  // O número do OS, não o que o Hub preencheu: a conferência é da conta DELE.
  const doOS = (rid: string) => {
    const l = doMes.get(rid);
    return l && (l.origem ?? "os") === "os" ? l.realizado : null;
  };

  // 1. número pronto do OS × fórmula do OS, com as entradas do OS
  for (const { i, no } of formulas) {
    const l = doMes.get(i.id);
    if (!l || l.realizado == null || (l.origem ?? "os") !== "os") continue;
    const refeito = avaliar(no, doOS, (cid) => custoDaRef(listaOuNada, cid));
    if (refeito == null || !isFinite(refeito)) continue;
    if (Math.abs(refeito - l.realizado) <= Math.max(0.01, Math.abs(l.realizado) * 0.005)) continue;
    const truncado = l.realizado === Math.trunc(refeito) || (l.realizado === 0 && Math.abs(refeito) < 100);
    saida.push({
      tipo: "formula_divergente", indicadorId: i.id,
      texto: `${nome(i)}: o OS mostra ${fmt(l.realizado, i.unidade)}, mas a fórmula dele com os números do mês dá ` +
        `${fmt(refeito, i.unidade)}${truncado ? " — parece divisão entre inteiros (as casas decimais somem)" : ""}.`,
    });
  }

  // 2. fórmula sem resultado no OS que o Hub calculou
  const vazios = formulas.filter(({ i }) => {
    const l = doMes.get(i.id);
    return l && l.realizado != null && (l.origem ?? "os") !== "os";
  });
  if (vazios.length) {
    const consolidado = vazios.filter(({ i }) => i.canal === "Consolidado");
    const resto = vazios.length - consolidado.length;
    saida.push({
      tipo: "nao_calculado",
      texto: `O OS tem a fórmula mas deixa vazio: ${consolidado.map(({ i }) => `${i.indicador} (${i.departamento})`).join(", ") || "—"}` +
        `${resto > 0 ? ` e mais ${resto} indicador(es) de canal` : ""}. O Hub calcula com a fórmula do próprio OS e marca como “Hub”.`,
    });
  }

  // 3. canais que deixaram totais parciais
  const faltasPorCanal = new Map<string, Set<string>>();
  for (const { i, no } of formulas) {
    const l = doMes.get(i.id);
    if (l?.origem !== "hub_parcial" || !ehSomaPura(no)) continue;
    for (const rid of refsDe(no).refs) {
      if (doOS(rid) != null) continue;
      const r = porId.get(rid);
      if (!r) continue;
      if (!faltasPorCanal.has(r.canal)) faltasPorCanal.set(r.canal, new Set());
      faltasPorCanal.get(r.canal)!.add(r.indicador);
    }
  }
  for (const [canal, nomes] of faltasPorCanal) {
    saida.push({
      tipo: "canal_sem_lancamento",
      texto: `${canal} não lançou ${[...nomes].join(", ")} — os totais consolidados que somam esse canal ficam parciais.`,
    });
  }

  // 4. sentido: o nome diz "menor é melhor", o OS não marca
  const semMarca = [...new Set(indicadores
    .filter((i) => i.ativo !== false && !i.menor_e_melhor && sentidoDe({ indicador: i.indicador, menor_e_melhor: false }) === "menor")
    .map((i) => i.indicador))];
  if (semMarca.length) {
    saida.push({
      tipo: "sentido",
      texto: `Sem a marca “menor é melhor”: ${semMarca.join(", ")}. O próprio OS calcula o atingimento ao contrário (churn de 2,3% contra meta de 1% sai 230%).`,
    });
  }

  // 5. churn da Ativação só em %
  for (const [rid, l] of doMes) {
    const i = porId.get(rid);
    if (i?.canal === "Ativação" && i.indicador === "Customer Churn" && l.origem === "hub_estimado") {
      saida.push({
        tipo: "sem_quantidade", indicadorId: rid,
        texto: `Ativação › Customer Churn: o OS lança só o %; a quantidade (${fmt(l.realizado, i.unidade)}) é estimada pelo Hub.`,
      });
    }
  }

  return saida;
}

/** O texto para colar numa mensagem ao time do OS. */
export function textoParaEnviar(itens: Inconsistencia[], rotuloMes: string): string {
  const grupos = new Map<TipoInconsistencia, Inconsistencia[]>();
  for (const i of itens) {
    if (!grupos.has(i.tipo)) grupos.set(i.tipo, []);
    grupos.get(i.tipo)!.push(i);
  }
  const partes = [`Inconsistências no Takeat OS — ${rotuloMes} (conferência do Hub Financeiro)`];
  let n = 0;
  for (const [tipo, lista] of grupos) {
    partes.push("", TITULO_INCONSISTENCIA[tipo]);
    for (const i of lista) partes.push(`${++n}. ${i.texto}`);
  }
  return partes.join("\n");
}
