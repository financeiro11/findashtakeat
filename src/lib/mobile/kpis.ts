// Os cinco cartões do topo da aba Início.
//
// Nada é calculado aqui: cada cartão só LÊ um snapshot já fechado ou uma linha de saldo.
// As chaves usadas em `dados` (jsonb) são exatamente as das telas do desktop —
// `saldo_consolidado`/`n_contas` (Caixa.tsx), `kpis.mrr_core`/`kpis.clientes_ativos`
// (assinaturas/Recorrencia.tsx) e `kpis.churn_valor`/`kpis.pct_receita_geral`
// (assinaturas/Churn.tsx). Inventar chave nova aqui criaria um segundo número para a
// mesma pergunta, e o do celular seria o errado.

import { fmtBRL, fmtInt, fmtPct } from "./formato";

export type ChaveKpi = "sicoob" | "asaas" | "caixa" | "assinaturas" | "churn";

export type CartaoKpi = {
  chave: ChaveKpi;
  rotulo: string;
  valor: string;
  detalhe: string;
  quando: string | null;
  /** Horas até o dado ser considerado velho. */
  janelaHoras: number;
  /**
   * A aba do app que mostra de onde o número saiu, quando existe uma. Saldo de banco tem
   * (o extrato da conta); caixa, MRR e churn não — as telas deles ficaram no computador, e
   * um cartão que não leva a lugar nenhum não deve parecer clicável.
   */
  destino?: string;
};

/**
 * A janela muda por cartão porque a cadência muda: saldo e caixa vêm de cron DIÁRIO (48h
 * parado já é falha), enquanto assinaturas e churn são fechamentos MENSAIS — marcá-los de
 * âmbar no dia 3 de todo mês seria alarme falso, e alarme falso todo mês é alarme que
 * ninguém mais lê.
 */
export const JANELA_DIARIA = 48;
export const JANELA_MENSAL = 24 * 45;

export type FontesKpi = {
  sicoob?: { conta?: string | null; saldo?: number | null; atualizado_em?: string | null } | null;
  asaas?: { conta?: string | null; saldo?: number | null; atualizado_em?: string | null } | null;
  caixa?: { dados?: any; gerado_em?: string | null } | null;
  assinaturas?: { mes_label?: string; dados?: any; gerado_em?: string | null } | null;
  churn?: { mes_label?: string; dados?: any; gerado_em?: string | null } | null;
};

export function montarKpis({ sicoob, asaas, caixa, assinaturas, churn }: FontesKpi): CartaoKpi[] {
  const cartoes: CartaoKpi[] = [];

  if (sicoob) {
    cartoes.push({
      chave: "sicoob", rotulo: "Saldo Sicoob",
      valor: fmtBRL(sicoob.saldo), detalhe: sicoob.conta || "Conta corrente",
      quando: sicoob.atualizado_em ?? null, janelaHoras: JANELA_DIARIA,
      destino: "/extratos?fonte=sicoob",
    });
  }
  if (asaas) {
    cartoes.push({
      chave: "asaas", rotulo: "Saldo Asaas",
      valor: fmtBRL(asaas.saldo), detalhe: asaas.conta || "Conta Asaas",
      quando: asaas.atualizado_em ?? null, janelaHoras: JANELA_DIARIA,
      destino: "/extratos?fonte=asaas",
    });
  }
  if (caixa?.dados) {
    const d = caixa.dados;
    cartoes.push({
      chave: "caixa", rotulo: "Caixa Omie",
      valor: fmtBRL(d.saldo_consolidado),
      detalhe: `${fmtInt(d.n_contas ?? d.contas?.length ?? 0)} contas consolidadas`,
      quando: d.sincronizado_em ?? caixa.gerado_em ?? null, janelaHoras: JANELA_DIARIA,
    });
  }
  if (assinaturas?.dados) {
    const k = assinaturas.dados.kpis ?? {};
    cartoes.push({
      chave: "assinaturas", rotulo: `MRR · ${assinaturas.mes_label ?? "—"}`,
      valor: fmtBRL(k.mrr_core),
      detalhe: `${fmtInt(k.clientes_ativos)} clientes · ticket ${fmtBRL(k.ticket_medio)}`,
      quando: assinaturas.gerado_em ?? null, janelaHoras: JANELA_MENSAL,
    });
  }
  if (churn?.dados) {
    const k = churn.dados.kpis ?? {};
    cartoes.push({
      chave: "churn", rotulo: `Churn · ${churn.mes_label ?? "—"}`,
      valor: fmtBRL(k.churn_valor),
      detalhe: `${fmtPct(k.pct_receita_geral)} da receita · ${fmtInt(k.churn_qtd)} clientes`,
      quando: churn.gerado_em ?? null, janelaHoras: JANELA_MENSAL,
    });
  }

  return cartoes;
}
