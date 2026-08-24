// Compartilhar uma anotação: o link do time, o link público e os comentários.
//
// São dois links, para dois destinatários:
//
//   • `/notas/<id>`  — quem tem login no Hub. Mesma URL no computador e no celular:
//     o App.tsx monta a árvore de telas pelo tamanho da TELA, então o endereço abre o
//     Workspace no computador e a nota em tela cheia no celular, sem link diferente
//     para cada aparelho. Quem clica sem sessão passa pelo /login e cai nela depois.
//
//   • `/n/<token>`   — quem NÃO tem conta. Lê e comenta; não edita. O anônimo nunca
//     toca `workspace_pages`: fala com duas funções SECURITY DEFINER
//     (`resolver_nota_publica`, `comentar_nota_publica`) que decidem o que devolver.
//
// As tabelas `workspace_links` e `workspace_comentarios` são de 08/2026 e ainda não
// estão em `src/integrations/supabase/types.ts` — o arquivo gerado está ~450 linhas
// atrás do banco, e regenerá-lo inteiro é uma mudança maior do que esta. Por isso o
// cliente sem tipo AQUI, e só aqui: todo o resto do app segue tipado, e as formas de
// entrada e saída estão declaradas logo abaixo.

import { supabase } from "@/integrations/supabase/client";

/** Cliente sem os tipos gerados — ver o comentário do topo. */
const db = supabase as any;

export type Comentario = {
  id: string;
  autor_nome: string;
  texto: string;
  /** `link` = escrito por quem abriu pelo endereço público, sem conta no Hub. */
  origem: "hub" | "link";
  resolvido: boolean;
  criado_em: string;
};

export type LinkPublico = {
  id: string;
  token: string;
  permite_comentario: boolean;
  acessos: number;
  criado_em: string;
  ultimo_acesso: string | null;
};

/* ------------------------------------------------------------------ *
 *  Endereços
 * ------------------------------------------------------------------ */

/** Só a máquina de quem está desenvolvendo. */
const EM_CASA = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.)/;

/**
 * O domínio que vai DENTRO do link — e que não é necessariamente o da aba atual.
 *
 * Estes endereços existem para sair daqui: vão para o WhatsApp de alguém. Copiado de
 * dentro do preview do Lovable, `window.location.origin` devolveria o domínio do
 * preview — que quem está de fora não abre, e o link chegaria quebrado sem nada acusar.
 * `VITE_HUB_URL` (o mesmo valor de `hub_base_url()` no banco) manda.
 *
 * Em localhost vale a própria máquina, senão não dá para testar a funcionalidade.
 */
export function baseDoHub(): string {
  const atual = window.location.origin;
  const canonico = (import.meta.env.VITE_HUB_URL as string | undefined)?.trim();
  if (!canonico || EM_CASA.test(atual)) return atual;
  return canonico.replace(/\/+$/, "");
}

export function urlDaNota(pageId: string): string {
  return `${baseDoHub()}/notas/${pageId}`;
}

export function urlPublica(token: string): string {
  return `${baseDoHub()}/n/${token}`;
}

/**
 * Copia para a área de transferência.
 *
 * `navigator.clipboard` não existe fora de HTTPS e recusa quando a aba não está em
 * foco — daí o caminho antigo do `<textarea>` atrás. Um botão "copiar" que falha
 * calado é pior do que não ter botão.
 */
export async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch { /* cai no caminho de baixo */ }

  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** True quando o aparelho tem folha de compartilhamento nativa (WhatsApp, e-mail…). */
export function temCompartilhamentoNativo(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator as any).share === "function";
}

/** Abre a folha do sistema. Devolve false se não existir ou se a pessoa cancelar. */
export async function compartilharNativo(titulo: string, url: string): Promise<boolean> {
  if (!temCompartilhamentoNativo()) return false;
  try {
    await (navigator as any).share({ title: titulo, text: titulo, url });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 *  Link público
 * ------------------------------------------------------------------ */

const CAMPOS_LINK = "id,token,permite_comentario,acessos,criado_em,ultimo_acesso";

/** O link ativo desta nota, ou null. Revogado não conta — um índice parcial garante um só. */
export async function buscarLink(pageId: string): Promise<LinkPublico | null> {
  const { data, error } = await db
    .from("workspace_links")
    .select(CAMPOS_LINK)
    .eq("page_id", pageId)
    .is("revogado_em", null)
    .maybeSingle();
  if (error) throw error;
  return (data as LinkPublico) ?? null;
}

/**
 * Cria (ou devolve, se já existir) o link público desta nota.
 *
 * 22 hexadecimais = 88 bits de sorteio: adivinhar um endereço válido não é caminho.
 * O `randomUUID` do navegador é criptográfico; o `Math.random` não seria.
 */
export async function criarLink(
  pageId: string,
  autor: { userId: string | null; nome: string | null },
): Promise<LinkPublico> {
  const existente = await buscarLink(pageId);
  if (existente) return existente;

  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 22);
  const { data, error } = await db
    .from("workspace_links")
    .insert({
      token,
      page_id: pageId,
      permite_comentario: true,
      criado_por: autor.userId,
      criado_por_nome: autor.nome,
    })
    .select(CAMPOS_LINK)
    .single();
  if (error) throw error;
  return data as LinkPublico;
}

/** Fecha a porta. A linha fica: quantas vezes abriram continua registrado. */
export async function revogarLink(linkId: string): Promise<void> {
  const { error } = await db
    .from("workspace_links")
    .update({ revogado_em: new Date().toISOString() })
    .eq("id", linkId);
  if (error) throw error;
}

export async function definirComentariosNoLink(linkId: string, permite: boolean): Promise<void> {
  const { error } = await db
    .from("workspace_links")
    .update({ permite_comentario: permite })
    .eq("id", linkId);
  if (error) throw error;
}

/* ------------------------------------------------------------------ *
 *  Comentários (lado de dentro do Hub)
 * ------------------------------------------------------------------ */

const CAMPOS_COMENTARIO = "id,autor_nome,texto,origem,resolvido,criado_em";

export async function listarComentarios(pageId: string): Promise<Comentario[]> {
  const { data, error } = await db
    .from("workspace_comentarios")
    .select(CAMPOS_COMENTARIO)
    .eq("page_id", pageId)
    .order("criado_em");
  if (error) throw error;
  return (data as Comentario[]) ?? [];
}

export async function comentar(
  pageId: string,
  autor: { userId: string | null; nome: string | null },
  texto: string,
): Promise<Comentario> {
  const { data, error } = await db
    .from("workspace_comentarios")
    .insert({
      page_id: pageId,
      autor_nome: autor.nome ?? "Time financeiro",
      autor_user_id: autor.userId,
      texto: texto.trim(),
      origem: "hub",
    })
    .select(CAMPOS_COMENTARIO)
    .single();
  if (error) throw error;
  return data as Comentario;
}

export async function definirResolvido(id: string, resolvido: boolean): Promise<void> {
  const { error } = await db.from("workspace_comentarios").update({ resolvido }).eq("id", id);
  if (error) throw error;
}

export async function apagarComentario(id: string): Promise<void> {
  const { error } = await db.from("workspace_comentarios").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Quantos comentários em aberto por nota — é o que acende o número no botão.
 *
 * Uma consulta só para a árvore inteira: uma por linha seriam 30 idas ao Supabase
 * para desenhar uma barra lateral.
 */
export async function comentariosAbertosPorNota(): Promise<Map<string, number>> {
  const { data, error } = await db
    .from("workspace_comentarios")
    .select("page_id")
    .eq("resolvido", false);
  if (error) throw error;
  const mapa = new Map<string, number>();
  for (const linha of (data as { page_id: string }[]) ?? []) {
    mapa.set(linha.page_id, (mapa.get(linha.page_id) ?? 0) + 1);
  }
  return mapa;
}

/** Quais notas têm link público ativo — mesma lógica de uma consulta só. */
export async function notasComLinkPublico(): Promise<Set<string>> {
  const { data, error } = await db
    .from("workspace_links")
    .select("page_id")
    .is("revogado_em", null);
  if (error) throw error;
  return new Set(((data as { page_id: string }[]) ?? []).map((l) => l.page_id));
}

/* ------------------------------------------------------------------ *
 *  Lado de fora: /n/<token>
 * ------------------------------------------------------------------ */

export type NotaPublicaOk = {
  titulo: string;
  icone: string | null;
  capa: string | null;
  conteudo: unknown;
  atualizado_em: string;
  ultimo_editor: string | null;
  compartilhado_por: string | null;
  permite_comentario: boolean;
  comentarios: Comentario[];
  erro?: undefined;
};
export type NotaPublicaErro = { erro: string };

export async function resolverNotaPublica(token: string): Promise<NotaPublicaOk | NotaPublicaErro> {
  const { data, error } = await db.rpc("resolver_nota_publica", { p_token: token });
  if (error) return { erro: "Não foi possível abrir este link. Tente de novo mais tarde." };
  return data as NotaPublicaOk | NotaPublicaErro;
}

export async function comentarNotaPublica(
  token: string,
  autor: string,
  texto: string,
): Promise<{ ok: true; comentario: Comentario } | NotaPublicaErro> {
  const { data, error } = await db.rpc("comentar_nota_publica", {
    p_token: token,
    p_autor: autor,
    p_texto: texto,
  });
  if (error) return { erro: "Não foi possível enviar o comentário. Tente de novo." };
  return data as { ok: true; comentario: Comentario } | NotaPublicaErro;
}
