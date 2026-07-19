// Helpers compartilhados do módulo Facilities (compras & fornecedores).
import { supabase } from "@/integrations/supabase/client";

// Supabase client sem tipos gerados para as tabelas novas (mesmo padrão de Demonstracoes.tsx).
export const db = supabase as any;

// ===== Tipos =====
export type SolicStatus =
  | "solicitado"
  | "em_cotacao"
  | "aguardando_aprovacao"
  | "aprovado"
  | "comprado"
  | "recusado";

export interface FornecedorAnexo {
  nome: string;
  url: string;
  tamanho: number;
}

export interface Fornecedor {
  id: string;
  nome: string;
  categoria: string | null;
  contato: string | null;
  tem_contrato: boolean;
  status: string;
  observacao: string | null;
  contratos: FornecedorAnexo[];
  created_at: string;
  updated_at: string;
}

export interface Solicitacao {
  id: string;
  titulo: string;
  categoria: string | null;
  valor: number | null;
  status: SolicStatus;
  solicitante: string | null;
  observacao: string | null;
  decidido_por: string | null;
  decidido_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface Cotacao {
  id: string;
  solicitacao_id: string;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  valor: number;
  escolhida: boolean;
  anexo_url: string | null;
  created_at: string;
}

export interface Compra {
  id: string;
  solicitacao_id: string | null;
  data: string;
  item: string;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  categoria: string | null;
  forma_pagamento: "cartao_corporativo" | "pix_boleto" | "reembolso" | null;
  nf_status: "ok" | "pendente";
  valor: number;
  created_at: string;
}

export interface Contrato {
  id: string;
  fornecedor_id: string | null;
  fornecedor_nome: string;
  descricao: string | null;
  categoria: string | null;
  valor_mensal: number;
  status: "ativo" | "renovar" | "encerrado";
  vence_em: string | null;
  renova_em: string | null;
  sem_prazo: boolean;
  created_at: string;
  updated_at: string;
}

// ===== Categorias (com cor do "dot") =====
export const CATEGORIAS = [
  "Mobiliário",
  "TI",
  "Manutenção",
  "Limpeza",
  "Copa/Cozinha",
  "Happy hour",
  "Material de escritório",
] as const;

export const CAT_COLOR: Record<string, string> = {
  "Mobiliário": "#e8833a",
  "TI": "#8b5cf6",
  "Manutenção": "#f0a020",
  "Limpeza": "#14b8a6",
  "Copa/Cozinha": "#7c5cfc",
  "Happy hour": "#e5484d",
  "Material de escritório": "#3b82f6",
};

export function catColor(cat: string | null | undefined): string {
  return (cat && CAT_COLOR[cat]) || "#94a3b8";
}

// ===== Pipeline de status (ordem das colunas do kanban) =====
export const PIPELINE: { key: SolicStatus; label: string; color: string }[] = [
  { key: "solicitado", label: "Solicitado", color: "#14b8a6" },
  { key: "em_cotacao", label: "Em cotação", color: "#8b5cf6" },
  { key: "aguardando_aprovacao", label: "Aguardando aprovação", color: "#f0a020" },
  { key: "aprovado", label: "Aprovado", color: "#16a34a" },
  { key: "comprado", label: "Comprado", color: "#64748b" },
];

export const STATUS_LABEL: Record<SolicStatus, string> = {
  solicitado: "Solicitado",
  em_cotacao: "Em cotação",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado",
  comprado: "Comprado",
  recusado: "Recusado",
};

// Compras acima deste valor exigem aprovação do admin.
export const LIMITE_APROVACAO = 500;

export const FORMA_PAGAMENTO_LABEL: Record<string, string> = {
  cartao_corporativo: "Cartão corporativo",
  pix_boleto: "PIX/boleto",
  reembolso: "Reembolso",
};

// ===== Formatação =====
export function fmtBRL(v: number | null | undefined, comCentavos = false): string {
  if (v == null || isNaN(v)) return "—";
  return (
    "R$ " +
    Number(v).toLocaleString("pt-BR", {
      minimumFractionDigits: comCentavos ? 2 : 0,
      maximumFractionDigits: comCentavos ? 2 : 0,
    })
  );
}

// "8,9k" para os rótulos do gráfico
export function fmtK(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1).replace(".", ",") + "k";
  return String(Math.round(v));
}

export function fmtData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("pt-BR");
}

// Converte string digitada ("3.480", "3480,50", "R$ 1.200") em número.
export function parseValor(s: string): number | null {
  if (!s) return null;
  const clean = s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

export const MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
