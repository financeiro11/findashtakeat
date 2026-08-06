// Leitura de `workspace_pages` (as "Anotações" do desktop) para a aba Notas.

import { supabase } from "@/integrations/supabase/client";

export type PaginaWorkspace = {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  content: any;
  is_favorite: boolean;
  archived: boolean;
  oculta: boolean;
  position: number;
  created_by_name: string | null;
  last_edited_by: string | null;
  updated_at: string;
};

export const CAMPOS_PAGINA =
  "id,parent_id,title,icon,content,is_favorite,archived,oculta,position,created_by_name,last_edited_by,updated_at";

/** As duas colunas de visibilidade do desktop valem aqui igual: arquivada e oculta não aparecem. */
export async function carregarPaginas(): Promise<PaginaWorkspace[]> {
  const { data, error } = await supabase
    .from("workspace_pages")
    .select(CAMPOS_PAGINA)
    .eq("archived", false)
    .eq("oculta", false)
    .order("is_favorite", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as PaginaWorkspace[]) ?? [];
}
