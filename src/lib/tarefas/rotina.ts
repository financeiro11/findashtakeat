/**
 * A cadência de uma rotina — quando ela volta.
 *
 * Antes de existir este arquivo, `tarefas.rotina` era só um adjetivo: um booleano
 * que dizia "esta tarefa costuma voltar" e servia exclusivamente para a Análise
 * Semanal somar quanto do esforço é repetição. Ninguém criava nada: a tarefa da
 * semana seguinte nascia da mão de uma pessoa que lembrou. O texto do checkbox
 * ("volta sozinha toda semana/mês") descrevia um fato observado, não uma causa —
 * e era exatamente o que confundia quem lia.
 *
 * Agora a cadência é um dado: `tarefas.rotina_cadencia`. Um cron diário
 * (`public.tarefas_rotinas_gerar`, migration 20260831140000) lê essa cadência e
 * cria a ocorrência do dia. As funções aqui são o espelho FIEL da mesma conta em
 * SQL — a tela usa para mostrar "próxima: 05/09" enquanto a pessoa configura, o
 * banco usa para gerar. Se mudar a regra de um lado, mude do outro.
 *
 * Datas aqui são sempre locais e sem hora (`new Date(y, m, d)`): a rotina é um
 * fato de calendário, e converter para UTC no meio do caminho é o que faz "dia 1"
 * virar "dia 31 do mês passado" para quem está em UTC-3.
 */

/** 1 = segunda … 7 = domingo (ISO, igual ao `isodow` do Postgres). */
export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** O que fazer quando a data mensal cai em sábado/domingo. */
export type AjusteFds = "antecipar" | "adiar";

export type Cadencia =
  | { tipo: "diaria"; somente_uteis?: boolean }
  | { tipo: "semanal"; dias: DiaSemana[] }
  | { tipo: "mensal"; dias: number[]; ultimo_dia?: boolean; ajuste_fds?: AjusteFds | null };

export const TIPOS_CADENCIA = ["diaria", "semanal", "mensal"] as const;
export type TipoCadencia = (typeof TIPOS_CADENCIA)[number];

export const NOMES_DIA: Record<DiaSemana, string> = {
  1: "segunda", 2: "terça", 3: "quarta", 4: "quinta", 5: "sexta", 6: "sábado", 7: "domingo",
};
export const SIGLAS_DIA: Record<DiaSemana, string> = {
  1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb", 7: "Dom",
};
export const DIAS_SEMANA: DiaSemana[] = [1, 2, 3, 4, 5, 6, 7];

/** Marcador de "último dia do mês" dentro da grade de dias — 31 é o dia 31 literal. */
export const ULTIMO_DIA = 0;

export const CADENCIA_PADRAO: Cadencia = { tipo: "mensal", dias: [5] };

/* ------------------------------------------------------------------ datas -- */

/** isodow de uma Date: 1 = segunda … 7 = domingo (o `getDay()` do JS é 0 = domingo). */
export function isodow(d: Date): DiaSemana {
  return (d.getDay() === 0 ? 7 : d.getDay()) as DiaSemana;
}

export function ehFimDeSemana(d: Date): boolean {
  const w = isodow(d);
  return w === 6 || w === 7;
}

/** Quantos dias tem o mês daquela data. */
export function diasNoMes(ano: number, mes0: number): number {
  return new Date(ano, mes0 + 1, 0).getDate();
}

function dia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function somaDias(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** ISO `YYYY-MM-DD` da data local — é assim que `tarefas.prazo` (date) é gravado. */
export function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Lê `YYYY-MM-DD` como data LOCAL (o `new Date("2026-09-05")` do JS lê como UTC). */
export function deIso(s: string): Date {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(a, (m || 1) - 1, d || 1);
}

function aplicaAjusteFds(d: Date, ajuste: AjusteFds | null | undefined): Date {
  if (!ajuste || !ehFimDeSemana(d)) return d;
  if (ajuste === "antecipar") return somaDias(d, isodow(d) === 6 ? -1 : -2);   // sáb→sex, dom→sex
  return somaDias(d, isodow(d) === 6 ? 2 : 1);                                 // sáb→seg, dom→seg
}

export function cadenciaValida(c: Cadencia | null | undefined): c is Cadencia {
  if (!c) return false;
  if (c.tipo === "diaria") return true;
  if (c.tipo === "semanal") return Array.isArray(c.dias) && c.dias.length > 0;
  if (c.tipo === "mensal") return (Array.isArray(c.dias) && c.dias.length > 0) || !!c.ultimo_dia;
  return false;
}

/**
 * Todas as datas em que a rotina cai no intervalo [de, ate], em ordem.
 *
 * Varre dia a dia de propósito, em vez de fazer aritmética de mês: é a varredura
 * que resolve sozinha fevereiro (uma rotina "todo dia 31" simplesmente não tem
 * data em fevereiro — e é isso que "dia 31" quer dizer; quem quer o fim do mês
 * marca "último dia do mês", que é uma opção separada) e o ajuste de fim de
 * semana, que pode empurrar duas datas para o mesmo dia útil.
 */
export function datasDaCadencia(c: Cadencia | null | undefined, de: Date, ate: Date): Date[] {
  if (!cadenciaValida(c)) return [];
  const inicio = dia(de);
  const fim = dia(ate);
  if (fim < inicio) return [];

  /* A janela de varredura começa 3 dias antes: com "antecipar", uma data de
     segunda-feira 1º pode ser puxada para a sexta anterior — que está fora do
     intervalo pedido, mas a data ajustada pode cair dentro dele. */
  const cursorFim = somaDias(fim, 3);
  const vistas = new Set<string>();
  const out: Date[] = [];

  for (let d = somaDias(inicio, -3); d <= cursorFim; d = somaDias(d, 1)) {
    let bate = false;
    if (c.tipo === "diaria") {
      bate = c.somente_uteis ? !ehFimDeSemana(d) : true;
    } else if (c.tipo === "semanal") {
      bate = c.dias.includes(isodow(d));
    } else {
      const ultimo = d.getDate() === diasNoMes(d.getFullYear(), d.getMonth());
      bate = (c.dias || []).includes(d.getDate()) || (!!c.ultimo_dia && ultimo);
    }
    if (!bate) continue;

    const alvo = c.tipo === "mensal" ? aplicaAjusteFds(d, c.ajuste_fds) : d;
    if (alvo < inicio || alvo > fim) continue;
    const k = iso(alvo);
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(alvo);
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** A primeira data em que a rotina cai a partir de `de` (inclusive). `null` se não cair em 1 ano. */
export function proximaData(c: Cadencia | null | undefined, de: Date = new Date()): Date | null {
  const inicio = dia(de);
  return datasDaCadencia(c, inicio, somaDias(inicio, 400))[0] ?? null;
}

/** Esta data é uma das que a cadência produz? */
export function ehDataDaCadencia(c: Cadencia | null | undefined, d: Date): boolean {
  return datasDaCadencia(c, d, d).length > 0;
}

/**
 * O prazo que uma rotina DEVE ter — e por que ele não pode ser livre.
 *
 * Uma tarefa marcada "todo dia 31" com prazo 30/09 não é uma escolha, é uma
 * contradição: o cartão anuncia uma regra e vence noutro dia. Pior, ela duplica
 * — o gerador cria a ocorrência do dia da cadência enquanto a de prazo torto
 * segue aberta, e o quadro passa a ter duas da mesma rotina.
 *
 * A âncora é o prazo ATUAL, não hoje: quem escreveu 05/09 numa rotina de dias
 * 6, 16, 21, 26 e 31 queria o dia 6, não o próximo da lista contado de hoje.
 * Puxar para "o mais próximo a partir do que a pessoa escreveu" preserva a
 * intenção; só quando esse prazo já passou é que a conta recomeça de hoje,
 * porque data vencida não serve para nada.
 *
 * ATRASO NÃO É DIVERGÊNCIA. Um prazo que a cadência produz continua valendo
 * mesmo vencido: aquela ocorrência está atrasada, e empurrá-la para a data
 * seguinte apagaria o atraso — que é a informação mais útil que o cartão tem.
 * Só se conserta a contradição: prazo que a regra NÃO produz.
 *
 * Devolve `null` quando não há o que ajustar (sem cadência, ou o prazo já bate).
 */
export function ajustarPrazoACadencia(
  c: Cadencia | null | undefined,
  prazoISO: string,
  hoje: Date = new Date(),
): string | null {
  if (!cadenciaValida(c)) return null;
  const hojeD = dia(hoje);
  const atual = prazoISO ? deIso(prazoISO) : null;
  if (atual && ehDataDaCadencia(c, atual)) return null;

  const ancora = atual && atual > hojeD ? atual : hojeD;
  const alvo = proximaData(c, ancora);
  if (!alvo) return null;
  return prazoISO && iso(alvo) === prazoISO ? null : iso(alvo);
}

/* ------------------------------------------------------------------ texto -- */

function lista(itens: string[]): string {
  if (itens.length === 0) return "";
  if (itens.length === 1) return itens[0];
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * A cadência em português, do jeito que cabe num selo de card.
 *
 * É este texto — e não a palavra "rotina" — que aparece no quadro, porque
 * "rotina" nunca respondeu a pergunta que quem olha o card faz: quando?
 */
export function descreverCadencia(c: Cadencia | null | undefined): string {
  if (!cadenciaValida(c)) return "";
  if (c.tipo === "diaria") return c.somente_uteis ? "todo dia útil" : "todo dia";
  if (c.tipo === "semanal") {
    const dias = [...c.dias].sort((a, b) => a - b).map(d => NOMES_DIA[d]);
    return dias.length === 1 ? `toda ${dias[0]}` : `${lista(dias)}`;
  }
  const partes: string[] = [];
  const dias = [...(c.dias || [])].sort((a, b) => a - b);
  if (dias.length === 1) partes.push(`todo dia ${dias[0]}`);
  else if (dias.length > 1) partes.push(`dias ${lista(dias.map(String))}`);
  if (c.ultimo_dia) partes.push("último dia do mês");
  return lista(partes);
}

/** O mesmo texto, com o aviso do ajuste — para tooltip e para o painel. */
export function descreverCadenciaLonga(c: Cadencia | null | undefined): string {
  const base = descreverCadencia(c);
  if (!base) return "";
  if (c?.tipo !== "mensal" || !c.ajuste_fds) return base;
  return `${base} (se cair no fim de semana, ${c.ajuste_fds === "antecipar" ? "antecipa para a sexta" : "adia para a segunda"})`;
}

/* --------------------------------------------------------------- travessia -- */

/**
 * Lê o JSONB que veio do banco, devolvendo `null` para qualquer coisa que não
 * seja uma cadência que a gente saiba executar. O banco aceita jsonb livre;
 * a tela não pode quebrar por causa de uma linha escrita à mão.
 */
export function lerCadencia(v: unknown): Cadencia | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const dias = Array.isArray(o.dias) ? (o.dias as unknown[]).filter(n => typeof n === "number") as number[] : [];
  if (o.tipo === "diaria") return { tipo: "diaria", somente_uteis: !!o.somente_uteis };
  if (o.tipo === "semanal") {
    const ds = dias.filter(n => n >= 1 && n <= 7) as DiaSemana[];
    return ds.length ? { tipo: "semanal", dias: ds } : null;
  }
  if (o.tipo === "mensal") {
    const ds = dias.filter(n => n >= 1 && n <= 31);
    const ultimo = !!o.ultimo_dia;
    if (!ds.length && !ultimo) return null;
    const aj = o.ajuste_fds === "antecipar" || o.ajuste_fds === "adiar" ? o.ajuste_fds : null;
    return { tipo: "mensal", dias: ds, ultimo_dia: ultimo, ajuste_fds: aj };
  }
  return null;
}
