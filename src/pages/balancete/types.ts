export type BalanceteGroup = "ativo" | "passivo" | "pl" | "receita" | "despesa" | "resultado";

export interface BalanceteAccount {
  id: string;
  code: string;
  name: string;
  level: number;
  parent_id: string | null;
  group: BalanceteGroup;
  saldo_anterior: number;
  debito: number;
  credito: number;
  saldo_atual: number;
  is_total: boolean;
}

export interface BalanceteTotals {
  ativo_total: number;
  passivo_total: number;
  patrimonio_liquido: number;
  resultado_acumulado: number;
  disponibilidades: number;
  obrigacoes_curto_prazo: number;
}

export interface BalanceteData {
  version: 2;
  kind: "balancete";
  imported_at: string;
  source: "pdf" | "excel" | "manual";
  accounts: BalanceteAccount[];
  totals: BalanceteTotals;
}

export interface AccountNode extends BalanceteAccount {
  children: AccountNode[];
}
