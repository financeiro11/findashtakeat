/**
 * A auditoria só vale se ACUSAR. Cada teste aqui quebra a fatura de um jeito
 * diferente e cobra que a conferência correspondente deixe de fechar — um
 * `fecha: true` que nunca vira `false` é um selo de qualidade decorativo.
 */

import { describe, expect, it } from "vitest";
import type { LinhaOfx } from "./ofx";
import { expandir, separar } from "./provisionar";
import { auditar, pendencias, type EnvioRegistrado } from "./auditoria";

/* ------------------------------------------------------------------ */

const linha = (p: Partial<LinhaOfx> & { fitid: string; valor: number }): LinhaOfx => ({
  data: "2026-11-05",
  sinal: "debito",
  memo: p.memo ?? "LOJA GENERICA",
  estabelecimento: p.estabelecimento ?? "LOJA GENERICA",
  chave: p.chave ?? "LOJA GENERICA",
  parcela: null,
  cidade: null,
  exterior: null,
  tarifa: false,
  ...p,
});

const COMP = "2026-12-01";
const VENC = "2026-12-10";

/** À vista + uma compra em 3× + uma parcela 2/3 + um estorno. */
const FATURA: LinhaOfx[] = [
  linha({ fitid: "A1", valor: 100, chave: "UBER", estabelecimento: "UBER" }),
  linha({ fitid: "B1", valor: 30, parcela: { n: 1, de: 3 }, chave: "NET", estabelecimento: "NET" }),
  linha({ fitid: "C1", valor: 50, parcela: { n: 2, de: 3 }, chave: "VELHA", estabelecimento: "VELHA" }),
  linha({ fitid: "D1", valor: 20, sinal: "credito", memo: "ESTORNO DE COMPRA", chave: "X", estabelecimento: "X" }),
];

const montar = (linhas: LinhaOfx[] = FATURA, envios: EnvioRegistrado[] = [], comCategoria = true) => {
  const separacao = separar(linhas);
  const provisoes = expandir(separacao.linhas, COMP, VENC);
  return auditar({
    separacao, provisoes, envios,
    categoriaDe: () => (comCategoria ? "2.04.06" : null),
  });
};

const envio = (p: Partial<EnvioRegistrado> & { integracao: string }): EnvioRegistrado => ({
  codTitulo: "999", estabelecimento: "X", valor: 0, vencimento: null,
  status: "enviado", erro: null, ...p,
});

const conta = (a: ReturnType<typeof montar>, trecho: string) =>
  a.contas.find((c) => c.rotulo.includes(trecho))!;

/* ------------------------------------------------------------------ */

describe("auditoria da fatura", () => {
  it("fatura íntegra e ainda não enviada: tudo fecha", () => {
    const a = montar();
    expect(a.fecha).toBe(true);
    expect(a.contas.every((c) => c.ok)).toBe(true);
  });

  it("toda linha do arquivo vira uma linha auditada, inclusive as que não geram título", () => {
    const a = montar();
    expect(a.linhas).toHaveLength(4);
    expect(a.linhas.filter((l) => l.veredito === "nao-gera")).toHaveLength(2); // parcela 2/3 e estorno
  });

  it("a compra em 3x gera três títulos, e a auditoria os prende à linha de origem", () => {
    const a = montar();
    const b = a.linhas.find((l) => l.linha.fitid === "B1")!;
    expect(b.titulos).toHaveLength(3);
    expect(b.titulos.map((t) => t.parcela?.n)).toEqual([1, 2, 3]);
    expect(b.totalTitulos).toBe(90);
  });

  it("sem categoria no de-para, o título é 'sem-categoria' — é o que trava o envio", () => {
    const a = montar(FATURA, [], false);
    expect(a.resumo["sem-categoria"]).toBe(4); // 1 à vista + 3 parcelas
    expect(a.resumo["a-enviar"]).toBe(0);
    expect(pendencias(a)).toBeGreaterThan(0);
  });

  it("o que já subiu aparece como enviado, com o código do Omie", () => {
    const a = montar(FATURA, [envio({ integracao: "CARTAO-A1-01", valor: 100, codTitulo: "55044" })]);
    const t = a.linhas.find((l) => l.linha.fitid === "A1")!.titulos[0];
    expect(t.veredito).toBe("enviado");
    expect(t.codTitulo).toBe("55044");
    expect(a.resumo.enviado).toBe(1);
    expect(a.resumo["a-enviar"]).toBe(3);
  });

  it("envio com status 'erro' não conta como enviado — o título não existe no ERP", () => {
    const a = montar(FATURA, [envio({ integracao: "CARTAO-A1-01", valor: 100, status: "erro" })]);
    expect(a.linhas.find((l) => l.linha.fitid === "A1")!.titulos[0].veredito).toBe("a-enviar");
  });

  /* ---- o que a aba existe para achar ----------------------------- */

  it("ACUSA órfão: subiu ao Omie e não está mais nesta fatura", () => {
    const a = montar(FATURA, [envio({ integracao: "CARTAO-SUMIU-01", valor: 77 })]);
    expect(a.orfaos).toHaveLength(1);
    expect(a.orfaos[0].valor).toBe(77);
    expect(conta(a, "pertence a esta fatura").ok).toBe(false);
    expect(a.fecha).toBe(false);
  });

  it("ACUSA divergência de valor entre o que subiu e o que a fatura diz", () => {
    const a = montar(FATURA, [envio({ integracao: "CARTAO-A1-01", valor: 90 })]);
    const t = a.linhas.find((l) => l.linha.fitid === "A1")!.titulos[0];
    expect(t.divergencia).toContain("90,00");
    expect(t.divergencia).toContain("100,00");
    expect(conta(a, "subiu diferente").ok).toBe(false);
    expect(a.fecha).toBe(false);
  });

  it("ACUSA divergência de vencimento", () => {
    const a = montar(FATURA, [envio({ integracao: "CARTAO-A1-01", valor: 100, vencimento: "2026-11-10" })]);
    expect(a.linhas.find((l) => l.linha.fitid === "A1")!.titulos[0].divergencia).toContain("2026-11-10");
    expect(a.fecha).toBe(false);
  });

  it("ACUSA duas linhas com o mesmo fitid — a chave de idempotência colidiria", () => {
    const a = montar([...FATURA, linha({ fitid: "A1", valor: 100, chave: "UBER", estabelecimento: "UBER" })]);
    expect(conta(a, "idempotência").ok).toBe(false);
    expect(a.fecha).toBe(false);
  });

  it("a conta do dinheiro fecha nos dois lados: baldes contra arquivo, parcela contra linha", () => {
    const a = montar();
    expect(conta(a, "Nenhum valor se perdeu").esquerda).toBe(200); // 100 + 30 + 50 + 20
    expect(conta(a, "vale o que a linha diz").esquerda).toBe(130); // à vista + 1ª parcela
    expect(conta(a, "vale o que a linha diz").direita).toBe(130);
  });

  it("a contagem de títulos esperados é a série inteira, não só o mês", () => {
    const a = montar();
    expect(conta(a, "gerou os títulos que devia").esquerda).toBe(4); // 1 + 3
    expect(conta(a, "gerou os títulos que devia").direita).toBe(4);
  });

  it("fatura vazia não inventa pendência", () => {
    const a = montar([]);
    expect(a.fecha).toBe(true);
    expect(pendencias(a)).toBe(0);
  });
});
