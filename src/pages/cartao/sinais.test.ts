/**
 * O detector de sinais da fatura do cartão.
 *
 * O módulo mora em `supabase/functions/_shared/` porque quem detecta é a Edge
 * Function (só ela vê a história INTEIRA do fornecedor; a tela só carrega o
 * período à vista). O teste mora aqui porque o vitest deste repo só varre `src/`
 * — importar por caminho relativo é o que evita a única alternativa, que era
 * manter duas cópias do detector e vê-las divergir.
 *
 * Os números NÃO são inventados: são as séries reais de 2026 que motivaram o
 * recurso, e os limiares foram calibrados contra elas. Se alguém mexer numa
 * constante, é aqui que aparece o efeito.
 */

import { describe, expect, it } from "vitest";
import { detectar, type PontoSerie } from "../../../supabase/functions/_shared/cartao-sinais";

const FATURAS = [
  "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01",
  "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01",
];

/** Monta a série de um fornecedor. `null` = não veio naquela fatura. */
function serie(
  e: string,
  valores: (number | null)[],
  opts: { n?: number; c?: string; d?: string } = {},
): PontoSerie[] {
  return valores.flatMap((v, i) =>
    v == null ? [] : [{
      e, m: FATURAS[i], v, n: opts.n ?? 1,
      c: opts.c ?? "Software / SaaS / Nuvem", d: opts.d ?? "", ci: "SAO PAULO",
    }],
  );
}

/* Séries reais (arredondadas ao real) — jan a ago/26. */
const SYMPLA = serie("SYMPLA", [77, 77, 77, 77, 2195, 77, 77, 15878], { n: 5, c: "Eventos / Marketing" });
const HUBSPOT = serie("HUBSPOT", [22979, 25429, 24800, 26348, null, 53156, 29545, 29138], { n: 3 });
/* Uber dobrou em mai/26 (1.703 -> 3.896) com 96 lançamentos: mês de mais
   corrida, não cobrança dobrada. É o falso positivo que derrubou a primeira
   versão da regra `dobrada`. */
const UBER = serie("UBER", [900, 1200, 1336, 3101, 3896, 2000, 2100, 2200], { n: 96, c: "Mobilidade" });
/* Padaria: 5,4× a mediana, mas o excesso é de R$ 627 — ruído. */
const PADARIA = serie("PADARIA E CONFEITARI", [null, null, null, null, null, 144, 251, 771], { n: 6 });
/* Google (outros): sobe de patamar em jul/26 e FICA lá (15.082 → 15.100). A
   mediana leva meses para acompanhar, então sem o corte sobre o recorde ago/26
   apareceria como "13× acima do normal" com o valor parado. */
const GOOGLE = serie(
  "GOOGLE (outros)",
  [215, 5367, 1158, 367, 972, 3575, 15082, 15100],
  { n: 26 },
);

const achar = (cs: ReturnType<typeof detectar>, e: string, sinal?: string) =>
  cs.find((c) => c.estabelecimento === e && (!sinal || c.sinal === sinal));

describe("detectar — pico sobre a própria história", () => {
  const cs = detectar([...SYMPLA, ...PADARIA], FATURAS, "2026-08-01");

  it("acha a Sympla saindo de R$ 77 para R$ 15.878", () => {
    const c = achar(cs, "SYMPLA", "pico");
    expect(c).toBeTruthy();
    expect(c!.valorReferencia).toBe(77);
    // 15878 / 77
    expect(Math.round(c!.razao!)).toBe(206);
    expect(c!.nivel).toBe("critico");
    expect(c!.titulo).toContain("acima do normal");
  });

  it("leva os fatos formatados — a IA copia, não recalcula", () => {
    const c = achar(cs, "SYMPLA", "pico")!;
    /* `toLocaleString('pt-BR')` separa o "R$" com espaço NÃO-QUEBRÁVEL (U+00A0) —
       igual ao `fmtBRLStr` da tela e ao `brl` das justificativas da DRE. Quem
       normaliza é o TESTE (o `\s` casa o U+00A0), não o formatador: trocá-lo aqui
       faria o card do cartão quebrar linha entre "R$" e o número onde nenhuma
       outra tela quebra. */
    const fatos = c.fatos.join(" ").replace(/\s+/g, " ");
    expect(fatos).toContain("R$ 15.878,00");
    expect(fatos).toContain("R$ 77,00");
    // A prova do sinal vai junto: uma barra por fatura, inclusive as vazias.
    expect(c.serie).toHaveLength(8);
    expect(c.serie[7].v).toBe(15878);
  });

  it("ignora variação grande em valor pequeno (5,4× de R$ 144 para R$ 771)", () => {
    expect(achar(cs, "PADARIA E CONFEITARI")).toBeUndefined();
  });

  it("patamar novo dispara UMA vez: no mês do salto, não no mês seguinte", () => {
    // jul/26 é o salto (2,81× o recorde anterior) — vira pico.
    const jul = detectar(GOOGLE, FATURAS, "2026-07-01");
    expect(achar(jul, "GOOGLE (outros)", "pico")).toBeTruthy();
    // ago/26 fica parado no mesmo valor (bate o recorde por R$ 18) — não vira.
    // A mediana ainda é R$ 1.158, então a razão continua 13×: é ela, e só ela,
    // que faria o painel repetir o alerta com o gasto imóvel.
    const ago = detectar(GOOGLE, FATURAS, "2026-08-01");
    expect(achar(ago, "GOOGLE (outros)")).toBeUndefined();
  });

  it("não repete o pico no mês seguinte: a mediana já incorporou o salto", () => {
    // Em set/26 a Sympla volta ao normal — e mesmo se subisse de novo para
    // 15.878 não seria RECORDE, então não vira pico outra vez.
    const set = [...FATURAS, "2026-09-01"];
    const cs2 = detectar([...SYMPLA, ...serie("SYMPLA", [], {})].concat(
      [{ e: "SYMPLA", m: "2026-09-01", v: 15878, n: 5, c: "Eventos / Marketing", d: "", ci: "SP" }],
    ), set, "2026-09-01");
    expect(achar(cs2, "SYMPLA", "pico")).toBeUndefined();
  });
});

describe("detectar — recorrente que não veio", () => {
  it("acha o HubSpot faltando em mai/26, no meio do período", () => {
    const cs = detectar(HUBSPOT, FATURAS, "2026-05-01");
    const c = achar(cs, "HUBSPOT", "ausente");
    expect(c).toBeTruthy();
    expect(c!.valor).toBe(0);
    expect(c!.nivel).toBe("critico");          // mediana acima de R$ 10 mil
    expect(c!.titulo).toBe("HUBSPOT não veio nesta fatura");
    expect(c!.fatos.join(" ")).toContain("3 últimas seguidas");
  });

  it("não acusa ausência de quem não é mensal", () => {
    // Vem em 4 faturas, mas com buraco nas 3 imediatamente anteriores: não é
    // cobrança mensal, é fornecedor eventual.
    const eventual = serie("CLARIMAQEQUI", [2165, 2165, 2165, 2165, null, null, null, null]);
    const cs = detectar(eventual, FATURAS, "2026-08-01");
    expect(achar(cs, "CLARIMAQEQUI")).toBeUndefined();
  });

  it("não acusa ausência de mensalidade barata", () => {
    const barata = serie("SERVICINHO", [50, 50, 50, 50, 50, 50, 50, null]);
    const cs = detectar(barata, FATURAS, "2026-08-01");
    expect(achar(cs, "SERVICINHO")).toBeUndefined();
  });
});

describe("detectar — cobrança dobrada", () => {
  it("acha o HubSpot de jun/26 (2,12× a mediana, 3 lançamentos) e liga ao mês que faltou", () => {
    const cs = detectar(HUBSPOT, FATURAS, "2026-06-01");
    const c = achar(cs, "HUBSPOT", "dobrada");
    expect(c).toBeTruthy();
    expect(Number(c!.razao!.toFixed(2))).toBe(2.12);
    expect(c!.fatos.join(" ")).toContain("mai/26");
  });

  it("não confunde mês de mais volume com cobrança dobrada", () => {
    // Uber: 2,29× a mediana em mai/26, mas com 96 lançamentos.
    const cs = detectar(UBER, FATURAS, "2026-05-01");
    expect(achar(cs, "UBER", "dobrada")).toBeUndefined();
  });

  it("pico e dobrada não se sobrepõem — as faixas não se cruzam", () => {
    const cs = detectar([...SYMPLA, ...HUBSPOT], FATURAS, "2026-08-01");
    for (const e of ["SYMPLA", "HUBSPOT"]) {
      expect(cs.filter((c) => c.estabelecimento === e).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("detectar — bordas", () => {
  it("fatura fora da lista não devolve nada", () => {
    expect(detectar(SYMPLA, FATURAS, "2025-12-01")).toEqual([]);
  });

  it("a primeira fatura do histórico não tem base para comparar", () => {
    expect(detectar([...SYMPLA, ...HUBSPOT], FATURAS, "2026-01-01")).toEqual([]);
  });

  it("ordena por dinheiro em jogo e respeita o teto de 8 por fatura", () => {
    // 12 fornecedores que picam na última fatura, com excessos crescentes.
    const muitos = Array.from({ length: 12 }, (_, i) =>
      serie(`F${i}`, [1000, 1000, 1000, 1000, 1000, 1000, 1000, 5000 + i * 1000]),
    ).flat();
    const cs = detectar(muitos, FATURAS, "2026-08-01");
    expect(cs).toHaveLength(8);
    expect(cs[0].estabelecimento).toBe("F11");
    expect(cs.map((c) => c.peso)).toEqual([...cs.map((c) => c.peso)].sort((a, b) => b - a));
  });
});
