export const PLAYBOOK_CATEGORIES = [
  "Fechamento mensal",
  "Conciliação bancária",
  "Cartão de crédito",
  "Conta corrente",
  "Importação para Omie",
  "Comissões",
  "Editais",
  "Reembolsos",
  "Pagamentos",
  "Rotinas internas",
] as const;

export const PLAYBOOK_STATUSES = [
  "Rascunho",
  "Em revisão",
  "Publicado",
  "Desatualizado",
  "Arquivado",
] as const;

export type PlaybookCategory = string;
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number];

export const STATUS_STYLES: Record<string, string> = {
  "Rascunho": "bg-muted text-muted-foreground border-border",
  "Em revisão": "bg-amber-100 text-amber-800 border-amber-200",
  "Publicado": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Desatualizado": "bg-rose-100 text-rose-800 border-rose-200",
  "Arquivado": "bg-zinc-200 text-zinc-700 border-zinc-300",
};

export type Playbook = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  owner_name: string | null;
  content: any;
  archived: boolean;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
};
