export type Flow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  owner_name: string | null;
  playbook_id: string | null;
  nodes: any[];
  edges: any[];
  viewport: { x: number; y: number; zoom: number };
  archived: boolean;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
};

export const NODE_TYPES_LIST = [
  { type: "start", label: "Início", desc: "Ponto inicial do fluxo" },
  { type: "step", label: "Etapa", desc: "Ação ou tarefa" },
  { type: "decision", label: "Decisão", desc: "Bifurcação Sim/Não" },
  { type: "subprocess", label: "Subprocesso", desc: "Bloco composto" },
  { type: "end", label: "Fim", desc: "Conclusão do fluxo" },
  { type: "note", label: "Anotação", desc: "Comentário/nota" },
  { type: "lane", label: "Raia", desc: "Swimlane / responsável" },
] as const;
