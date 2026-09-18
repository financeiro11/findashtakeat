/* ---------------------------------------------------------------------------
 * TAREFAS EM SEGUNDO PLANO — o trabalho não mora na janela que o mostra.
 *
 * O PEDIDO (18/09/2026): "não posso ter de ficar esperando um processo parado
 * para poder atuar em outras coisas". Até aqui cada corrente longa (emitir,
 * refazer nota) vivia DENTRO do componente do diálogo: fechar a janela ou era
 * proibido, ou matava a corrente no meio — o "Fechar e deixar rodando" do
 * EmitirAgora desligava o laço, e uma nota cancelada podia ficar sem a certa.
 *
 * A REGRA: o trabalho roda aqui, num módulo fora do React, e a tela é só uma
 * janela sobre ele. Fechar o diálogo, trocar de página, abrir outra tarefa —
 * nada disso para nada. O que para é `parar(id)`, dito pela pessoa, e o laço
 * confere em `ctx.segue()` entre um degrau e outro.
 *
 * O LIMITE, dito na cara: é o NAVEGADOR que conduz (as correntes do Omie não
 * cabem nos 150s de uma Edge Function). Fechar a aba do Hub interrompe — por
 * isso há o aviso de `beforeunload` enquanto houver tarefa rodando.
 * ------------------------------------------------------------------------- */

import { useSyncExternalStore } from "react";
import { toast } from "sonner";

export type EstadoPasso = "espera" | "correndo" | "ok" | "atencao" | "falhou" | "pulado";
export type EstadoTarefa = "rodando" | "ok" | "atencao" | "falhou" | "parada";

export interface PassoTarefa { id: string; titulo: string; estado: EstadoPasso; detalhe: string | null }

/** O que sobrou para uma pessoa decidir — e o que a máquina já tentou antes. */
export interface ParaVoce {
  id_asaas: string | null;
  nome: string;
  titulo: string;
  oQueFazer: string;
  tentado: string[];
}

export interface Tarefa {
  id: string;
  /** Mesma chave rodando = mesma tarefa: o segundo clique reabre, não duplica. */
  chave: string | null;
  titulo: string;
  subtitulo: string | null;
  estado: EstadoTarefa;
  /** A frase do desfecho (ou do instante), para a lista do cabeçalho. */
  resumo: string | null;
  passos: PassoTarefa[];
  /** O resultado que a pessoa veio ver ("NFS-e 20501"). */
  destaques: Array<{ rotulo: string; valor: string }>;
  avisos: string[];
  paraVoce: ParaVoce[];
  /** O estado próprio de quem tem vista própria (a faixa da emissão em massa lê o placar daqui). */
  dados: unknown;
  iniciadaEm: number;
  terminadaEm: number | null;
}

export interface Contexto {
  id: string;
  /** Falso depois que a pessoa mandou parar. Confira entre um degrau e outro. */
  segue: () => boolean;
  /** Marca um passo declarado no início. Id desconhecido é ignorado. */
  passo: (id: string, estado: EstadoPasso, detalhe?: string | null) => void;
  atualizar: (patch: Partial<Pick<Tarefa, "resumo" | "destaques" | "avisos" | "paraVoce" | "subtitulo" | "dados">>) => void;
}

export interface Desfecho { estado?: Exclude<EstadoTarefa, "rodando">; resumo?: string | null }

/* ------------------------------ o armazém -------------------------------- */

let tarefas: Tarefa[] = [];
let aberta: string | null = null;
const paradas = new Set<string>();
const ouvintes = new Set<() => void>();
/** O que já terminou fica na lista por um tempo, para ser lido; depois sai. */
const GUARDAR_TERMINADAS = 12;

const avisar = () => { for (const f of ouvintes) f(); };

function mudar(id: string, f: (t: Tarefa) => Tarefa) {
  tarefas = tarefas.map((t) => (t.id === id ? f(t) : t));
  avisar();
}

export const rodando = () => tarefas.filter((t) => t.estado === "rodando");

/** O desfecho quando o trabalho não disse: passo que falhou manda; pendência vira atenção. */
export function desfechoPadrao(t: Pick<Tarefa, "passos" | "paraVoce">): Exclude<EstadoTarefa, "rodando" | "parada"> {
  if (t.passos.some((p) => p.estado === "falhou")) return "falhou";
  if (t.paraVoce.length || t.passos.some((p) => p.estado === "atencao")) return "atencao";
  return "ok";
}

let seq = 0;

export function iniciarTarefa(
  def: { chave?: string | null; titulo: string; subtitulo?: string | null; passos: Array<{ id: string; titulo: string }> },
  trabalho: (ctx: Contexto) => Promise<Desfecho | void>,
  opts: { aoTerminar?: (t: Tarefa) => void } = {},
): string {
  const chave = def.chave ?? null;
  const igual = chave ? tarefas.find((t) => t.chave === chave && t.estado === "rodando") : null;
  if (igual) return igual.id;

  const id = `t${Date.now().toString(36)}${(seq++).toString(36)}`;
  const nova: Tarefa = {
    id, chave, titulo: def.titulo, subtitulo: def.subtitulo ?? null, estado: "rodando", resumo: null,
    passos: def.passos.map((p) => ({ ...p, estado: "espera", detalhe: null })),
    destaques: [], avisos: [], paraVoce: [], dados: null, iniciadaEm: Date.now(), terminadaEm: null,
  };
  const terminadas = tarefas.filter((t) => t.estado !== "rodando").slice(0, GUARDAR_TERMINADAS - 1);
  tarefas = [nova, ...tarefas.filter((t) => t.estado === "rodando"), ...terminadas];
  avisar();

  const ctx: Contexto = {
    id,
    segue: () => !paradas.has(id),
    passo: (pid, estado, detalhe = null) =>
      mudar(id, (t) => ({ ...t, passos: t.passos.map((p) => (p.id === pid ? { ...p, estado, detalhe } : p)) })),
    atualizar: (patch) => mudar(id, (t) => ({ ...t, ...patch })),
  };

  void (async () => {
    let fim: Desfecho = {};
    try {
      fim = ((await trabalho(ctx)) as Desfecho | undefined) ?? {};
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      mudar(id, (t) => ({
        ...t,
        passos: t.passos.map((p) => (p.estado === "correndo" ? { ...p, estado: "falhou", detalhe: msg } : p)),
      }));
      fim = { estado: "falhou", resumo: msg };
    }
    const parada = paradas.has(id);
    paradas.delete(id);
    mudar(id, (t) => ({
      ...t,
      estado: parada ? "parada" : fim.estado ?? desfechoPadrao(t),
      resumo: fim.resumo ?? (parada ? "Parada a seu pedido." : t.resumo),
      passos: t.passos.map((p) => (p.estado === "correndo" ? { ...p, estado: parada ? "espera" : "atencao" } : p)),
      terminadaEm: Date.now(),
    }));
    const t = tarefas.find((x) => x.id === id)!;
    try { opts.aoTerminar?.(t); } catch { /* quem ouvia pode já não existir */ }
    anunciar(t);
  })();

  return id;
}

/** Pede para parar. O degrau em curso termina; o seguinte não começa. */
export function parar(id: string) {
  if (tarefas.some((t) => t.id === id && t.estado === "rodando")) { paradas.add(id); avisar(); }
}

export function dispensar(id: string) {
  tarefas = tarefas.filter((t) => t.id !== id || t.estado === "rodando");
  if (aberta === id) aberta = null;
  avisar();
}

export function abrirTarefa(id: string | null) { aberta = id; avisar(); }

/* O toast é o que avisa quem já foi fazer outra coisa — e por isso só aparece
   se a tarefa não está aberta na frente da pessoa. */
function anunciar(t: Tarefa) {
  if (aberta === t.id) return;
  const acao = { label: "Ver", onClick: () => abrirTarefa(t.id) };
  const descricao = t.resumo ?? t.subtitulo ?? undefined;
  if (t.estado === "ok") toast.success(`${t.titulo} — concluído`, { description: descricao, action: acao, duration: 10000 });
  else if (t.estado === "parada") toast.info(`${t.titulo} — parada`, { description: descricao, action: acao });
  else if (t.estado === "falhou") toast.error(`${t.titulo} — falhou`, { description: descricao, action: acao, duration: 20000 });
  else toast.warning(`${t.titulo} — precisa de você`, { description: descricao, action: acao, duration: 20000 });
}

/* ------------------------------ fechar a aba ------------------------------ */

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!rodando().length) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

/* --------------------------------- React ---------------------------------- */

const inscrever = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };

export function useTarefas(): Tarefa[] {
  return useSyncExternalStore(inscrever, () => tarefas);
}

export function useTarefaAberta(): Tarefa | null {
  const id = useSyncExternalStore(inscrever, () => aberta);
  const lista = useTarefas();
  return id ? lista.find((t) => t.id === id) ?? null : null;
}

export const foiPedidoParar = (id: string) => paradas.has(id);

/** Só para os testes. */
export function _zerar() { tarefas = []; aberta = null; paradas.clear(); avisar(); }
