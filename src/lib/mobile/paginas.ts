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

/** Só o que a trilha e a lista de subpáginas mostram — sem `content`. */
export type PaginaResumo = { id: string; parent_id: string | null; title: string; icon: string | null };
const CAMPOS_RESUMO = "id,parent_id,title,icon";

export type NotaCompleta = {
  nota: PaginaWorkspace | null;
  filhos: PaginaResumo[];
  /** Do ancestral mais distante até o pai direto. */
  trilha: PaginaResumo[];
};

/**
 * A nota, as filhas dela e a cadeia de pais.
 *
 * Antes esta tela chamava `carregarPaginas()` — o `content` de TODA página do workspace,
 * inclusive playbooks longos, para exibir uma. Numa rede de celular isso é a diferença
 * entre abrir na hora e parecer travado. As consultas de trilha e filhos nem pedem
 * `content`.
 */
export async function carregarNota(id: string): Promise<NotaCompleta> {
  const [pagina, filhos] = await Promise.all([
    supabase.from("workspace_pages").select(CAMPOS_PAGINA)
      .eq("id", id).eq("archived", false).eq("oculta", false).maybeSingle(),
    supabase.from("workspace_pages").select(CAMPOS_RESUMO)
      .eq("parent_id", id).eq("archived", false).eq("oculta", false)
      .order("position").order("updated_at", { ascending: false }),
  ]);
  if (pagina.error) throw pagina.error;

  const nota = (pagina.data as PaginaWorkspace) ?? null;
  const trilha: PaginaResumo[] = [];
  // Teto de 10: uma referência circular em `parent_id` travaria o app num laço infinito.
  let alvo = nota?.parent_id ?? null;
  for (let i = 0; alvo && i < 10; i++) {
    const { data } = await supabase.from("workspace_pages").select(CAMPOS_RESUMO).eq("id", alvo).maybeSingle();
    if (!data) break;
    const pai = data as PaginaResumo;
    trilha.unshift(pai);
    alvo = pai.parent_id;
  }

  return { nota, filhos: ((filhos.data as PaginaResumo[]) ?? []), trilha };
}
