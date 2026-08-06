import { describe, it, expect } from "vitest";
import { JANELA_DIARIA, JANELA_MENSAL, montarKpis } from "./kpis";

/* O Intl separa "R$" do número com espaço fixo; aqui só o formato importa. */
const espacos = (s: string) => s.replace(/\s/g, " ");

describe("montarKpis", () => {
  it("lê as mesmas chaves do jsonb que as telas do desktop", () => {
    const cartoes = montarKpis({
      sicoob: { conta: "Sicoob 1234-5", saldo: 1234.56, atualizado_em: "2026-08-06T09:00:00Z" },
      asaas: { conta: "Asaas", saldo: 987.65, atualizado_em: "2026-08-06T09:00:00Z" },
      caixa: { dados: { saldo_consolidado: 250000, n_contas: 4, sincronizado_em: "2026-08-06T09:05:00Z" } },
      assinaturas: {
        mes_label: "Jul/26",
        dados: { kpis: { mrr_core: 310000, clientes_ativos: 812, ticket_medio: 381.77 } },
        gerado_em: "2026-08-02T06:00:00Z",
      },
      churn: {
        mes_label: "Jul/26",
        dados: { kpis: { churn_valor: 12500, churn_qtd: 31, pct_receita_geral: 4.03 } },
        gerado_em: "2026-08-02T06:00:00Z",
      },
    });

    expect(cartoes.map((c) => c.chave)).toEqual(["sicoob", "asaas", "caixa", "assinaturas", "churn"]);
    expect(espacos(cartoes[0].valor)).toBe("R$ 1.234,56");
    expect(espacos(cartoes[2].valor)).toBe("R$ 250.000,00");
    expect(cartoes[2].detalhe).toBe("4 contas consolidadas");
    expect(cartoes[3].rotulo).toBe("MRR · Jul/26");
    expect(espacos(cartoes[3].detalhe)).toBe("812 clientes · ticket R$ 381,77");
    expect(cartoes[4].detalhe).toContain("4,0% da receita");
  });

  it("cai fora quando a fonte não existe, em vez de mostrar zero", () => {
    expect(montarKpis({})).toEqual([]);
    expect(montarKpis({ caixa: { dados: null } })).toEqual([]);
  });

  it("caixa usa n_contas e, sem ele, o tamanho da lista", () => {
    const [cartao] = montarKpis({ caixa: { dados: { saldo_consolidado: 10, contas: [{}, {}, {}] } } });
    expect(cartao.detalhe).toBe("3 contas consolidadas");
  });

  it("cadência diária alerta em 48h; a mensal só depois de 45 dias", () => {
    const cartoes = montarKpis({
      sicoob: { saldo: 1, atualizado_em: "2026-08-06T09:00:00Z" },
      churn: { mes_label: "Jul/26", dados: { kpis: {} }, gerado_em: "2026-08-02T06:00:00Z" },
    });
    expect(cartoes[0].janelaHoras).toBe(JANELA_DIARIA);
    expect(cartoes[1].janelaHoras).toBe(JANELA_MENSAL);
  });
});
