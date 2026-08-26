// Radar de Preços (Facilities) — o front lê a MESMA regra que o servidor.
//
// Não há cópia aqui: o núcleo vive em `supabase/functions/_shared/radar-precos.ts`
// (arquivo sem imports, por isso o Vite e o Deno leem os dois). O que o front
// ganha com isso é a prévia honesta na hora de cadastrar o alvo — a tela mostra
// "entendi: notebook, i5+, 16GB, SSD 512, até R$ 3.000" usando exatamente o
// código que vai recusar ou aprovar os anúncios depois.
export * from "../../supabase/functions/_shared/radar-precos";

import type { AlvoSpecs } from "../../supabase/functions/_shared/radar-precos";

/** Resumo em uma linha do que o radar entendeu do pedido — para a prévia e para o card. */
export function resumoDoAlvo(s: AlvoSpecs | null | undefined): string {
  if (!s) return "—";
  const p: string[] = [s.categoria];
  if (s.marcas?.length) p.push(s.marcas.join("/"));
  if (s.cpu_tier_min) {
    const nome = { 1: "entrada", 3: "i3", 5: "i5", 7: "i7", 9: "i9" }[s.cpu_tier_min] ?? `tier ${s.cpu_tier_min}`;
    p.push(s.cpu_geracao_min ? `${nome} ${s.cpu_geracao_min}ª+` : `${nome}+`);
  }
  if (s.ram_gb_min) p.push(`${s.ram_gb_min}GB RAM`);
  if (s.armazenamento_gb_min) p.push(`${s.armazenamento_tipo === "ssd" ? "SSD " : ""}${s.armazenamento_gb_min}GB`);
  if (s.tela_pol_min || s.tela_pol_max) {
    p.push(s.tela_pol_min && s.tela_pol_max ? `${s.tela_pol_min}–${s.tela_pol_max}"` : `${s.tela_pol_min ?? s.tela_pol_max}"`);
  }
  const conds = s.condicoes?.length ? s.condicoes : ["novo"];
  if (conds.length !== 1 || conds[0] !== "novo") p.push(conds.join("/"));
  return p.join(" · ");
}

/** Nome amigável da fonte para a tela. */
export const FONTE_LABEL: Record<string, string> = {
  kabum: "Kabum",
  terabyte: "Terabyte",
  zoom: "Zoom",
  buscape: "Buscapé",
  amazon: "Amazon",
  magalu: "Magalu",
  mercado_livre: "Mercado Livre",
};

export function fonteLabel(f: string | null | undefined): string {
  if (!f) return "—";
  return FONTE_LABEL[f] ?? f.replace(/_/g, " ");
}
