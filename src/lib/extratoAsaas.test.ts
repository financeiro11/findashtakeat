import { describe, it, expect } from "vitest";
import { classificaAsaas, resumirAsaas, taxaEstornada, type LancamentoAsaas } from "./extratoAsaas";

/* As frases são as do extrato de verdade (asaas_extrato), copiadas como o Asaas
   as escreve — inclusive os nomes de cliente que quebravam o classificador. */

const deb = (historico: string, valor: number): LancamentoAsaas => ({ tipo: "debito", valor, historico });
const cred = (historico: string, valor: number): LancamentoAsaas => ({ tipo: "credito", valor, historico });

describe("classificaAsaas", () => {
  it("separa a taxa do Pix da transferência de saldo feita via Pix", () => {
    expect(classificaAsaas("Taxa do Pix - fatura nr. 847174650 Varanda Café e prosa")).toBe("pix");
    // R$ 781 mil em 14 lançamentos: é a varrida do saldo para o banco, não taxa.
    expect(classificaAsaas("Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA")).toBe("transferencia");
  });

  it("não confunde 'coNFeitaria' com nota fiscal", () => {
    expect(classificaAsaas("Taxa de cartão - fatura nr. 832699264 Confeitaria Vista Alegre")).toBe("cartao");
    expect(classificaAsaas("Taxa de emissão da nota fiscal de serviço nr. 16783 - fatura nr. 848311865 Espeto Music Empório")).toBe("nf");
  });

  it("lê os demais tipos do extrato", () => {
    expect(classificaAsaas("Cobrança recebida - fatura nr. 847174650 Varanda Café e prosa")).toBe("cobranca");
    expect(classificaAsaas("Taxa de mensageria - fatura nr. 848311865 Espeto Music Empório")).toBe("mensageria");
    expect(classificaAsaas("Taxa de boleto - fatura nr. 831720490 RANCHO BURGUER")).toBe("boleto");
    expect(classificaAsaas("Taxa de notificação por WhatsApp da cobrança 844795652 Sorveteria do Alemão")).toBe("whatsapp");
    expect(classificaAsaas("Estorno - fatura nr. 843328335 NuQuintal")).toBe("estorno");
    expect(classificaAsaas("Bloqueio de saldo devido ao chargeback - fatura nr. 835120784 A Âncora")).toBe("chargeback");
    expect(classificaAsaas("Cancelamento do bloqueio de saldo devido ao chargeback - fatura nr. 835120784 A Âncora")).toBe("chargeback");
    expect(classificaAsaas(null)).toBe("outros");
  });

  it("uma taxa nova do Asaas continua sendo taxa", () => {
    expect(classificaAsaas("Taxa de análise de crédito - fatura nr. 999")).toBe("taxa");
  });
});

describe("taxaEstornada", () => {
  it("aponta a taxa que o crédito devolve", () => {
    expect(taxaEstornada("Estorno da taxa de cartão - fatura nr. 843236401 Café com Baguett's")).toBe("cartao");
    expect(taxaEstornada("Estorno - fatura nr. 843328335 NuQuintal")).toBeNull();
  });
});

describe("resumirAsaas", () => {
  const extrato: LancamentoAsaas[] = [
    cred("Cobrança recebida - fatura nr. 1 Varanda Café e prosa", 270.11),
    cred("Cobrança recebida - fatura nr. 2 Espeto Music Empório", 543.08),
    deb("Taxa do Pix - fatura nr. 1 Varanda Café e prosa", 1.99),
    deb("Taxa do Pix - fatura nr. 2 Espeto Music Empório", 1.99),
    deb("Taxa de mensageria - fatura nr. 1 Varanda Café e prosa", 0.89),
    deb("Taxa de cartão - fatura nr. 3 Confeitaria Vista Alegre", 12.4),
    deb("Taxa de emissão da nota fiscal de serviço nr. 16783 - fatura nr. 2", 1),
    deb("Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA", 55_000),
    deb("Estorno - fatura nr. 4 Dilione", 100),
    cred("Estorno da taxa de cartão - fatura nr. 3 Confeitaria Vista Alegre", 2.4),
  ];
  const r = resumirAsaas(extrato);

  it("a transferência de saldo fica fora do total de taxas", () => {
    expect(r.taxas.find((t) => t.key === "pix")).toMatchObject({ v: 3.98, q: 2 });
    expect(r.totalTaxas).toBeCloseTo(1.99 + 1.99 + 0.89 + (12.4 - 2.4) + 1, 2);
    expect(r.qtdTaxas).toBe(5);
    expect(r.fora.map((f) => f.key)).toEqual(["transferencia", "estorno"]);
    expect(r.fora[0].v).toBe(55_000);
  });

  it("o estorno da taxa abate a taxa que o gerou", () => {
    expect(r.taxas.find((t) => t.key === "cartao")).toMatchObject({ v: 10, q: 1 });
  });

  it("as taxas saem da que mais pesa para a que menos pesa", () => {
    expect(r.taxas.map((t) => t.key)).toEqual(["cartao", "pix", "nf", "mensageria"]);
  });

  it("o custo sobre o recebido volta ao mundo real", () => {
    expect(r.recebido).toEqual({ v: 813.19, q: 2 });
    // Antes da correção a transferência entrava aqui e o painel dizia 227%.
    expect(r.custoPct).toBeLessThan(3);
  });

  it("extrato vazio não estoura nem divide por zero", () => {
    const z = resumirAsaas([]);
    expect(z.totalTaxas).toBe(0);
    expect(z.custoPct).toBe(0);
    expect(z.taxas).toEqual([]);
  });
});
