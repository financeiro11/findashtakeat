// Novidades do Hub — o que a tela precisa saber sobre o diário de bordo.
//
// Só regra pura (tipos, rótulo do dia, contagem do que ainda não foi lido), fora
// do componente: é o que dá para testar sem montar React — a suíte de .tsx deste
// repositório está quebrada por falta do @testing-library/dom.
//
// Quem produz esses dados é a Edge Function `hub-novidades-sync`, que lê os
// commits do GitHub. Ver supabase/functions/hub-novidades-sync/index.ts.

export type TipoNovidade = "novidade" | "melhoria" | "correcao" | "bastidor";

export type ItemNovidade = {
  titulo: string;
  o_que_muda: string;
  tipo: TipoNovidade | string;
  area: string;
  rota: string | null;
  commits: string[];
  hora: string;
};

export type CommitNovidade = {
  sha: string;
  assunto: string;
  autor: string;
  data: string;
  url: string;
  arquivos?: string[];
  area?: string;
};

export type DiaNovidades = {
  dia: string;                 // YYYY-MM-DD (America/Sao_Paulo)
  resumo: string | null;
  itens: ItemNovidade[];
  commits: CommitNovidade[];
  n_commits: number;
  redigido_por: string;        // 'ia' | 'commits'
  gerado_em: string;
};

/* ------------------------------- aparência ------------------------------- */
export const TIPO_META: Record<TipoNovidade, { rotulo: string; chip: string; ponto: string }> = {
  novidade:  { rotulo: "novo",      chip: "bg-primary/10 text-primary",                                     ponto: "bg-primary" },
  melhoria:  { rotulo: "melhoria",  chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400",                   ponto: "bg-sky-500" },
  correcao:  { rotulo: "correção",  chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",       ponto: "bg-emerald-500" },
  bastidor:  { rotulo: "bastidor",  chip: "bg-secondary text-muted-foreground",                             ponto: "bg-muted-foreground/40" },
};

export const metaDoTipo = (t: string) => TIPO_META[(t as TipoNovidade)] ?? TIPO_META.melhoria;

/** Bastidor = migração, cron, tipo, teste: aconteceu, mas não muda nada na tela. */
export const ehBastidor = (i: ItemNovidade) => i.tipo === "bastidor";

/* --------------------------------- datas --------------------------------- */
const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "2026-08-24" -> Date local (sem passar por UTC, que jogaria para o dia anterior). */
export function parseDia(dia: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export const hojeBRT = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Rótulo humano de um dia: "hoje", "ontem" ou "terça-feira, 19/08". */
export function rotuloDoDia(dia: string, hoje = hojeBRT()): string {
  if (dia === hoje) return "hoje";
  const d = parseDia(dia);
  const ontem = new Date(parseDia(hoje).getTime() - 86_400_000);
  const mesmo = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mesmo(d, ontem)) return "ontem";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${DIAS_SEMANA[d.getDay()]}, ${dd}/${mm}`;
}

/* ------------------------------ o que é novo ------------------------------ */
/**
 * Quantas mudanças a pessoa ainda não viu.
 *
 * Conta só o que aparece na tela (bastidor fica de fora): o selo existe para
 * dizer "tem coisa nova para você olhar", e migração de banco não é.
 * `vistoAte = null` (primeira visita) conta tudo — é honesto, ela não viu nada.
 */
export function contarNaoLidos(dias: DiaNovidades[], vistoAte: string | null): number {
  return dias
    .filter((d) => !vistoAte || d.dia > vistoAte)
    .reduce((s, d) => s + d.itens.filter((i) => !ehBastidor(i)).length, 0);
}

/** O dia mais recente com alguma novidade — é até onde a marca de leitura vai. */
export function ultimoDiaComItem(dias: DiaNovidades[]): string | null {
  const comItem = dias.filter((d) => d.itens.length > 0).map((d) => d.dia).sort();
  return comItem.length ? comItem[comItem.length - 1] : null;
}
