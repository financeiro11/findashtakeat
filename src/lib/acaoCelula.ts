/* ============================================================================
 * A correção que o chat da célula propõe.
 *
 * O fio da célula (lib/perguntas) fazia uma coisa só: perguntar e ler. Mas metade
 * do que se escreve ali não é pergunta — é um erro apontado por quem conhece a
 * operação ("isso é da Paytime, deveria ser markup, conserte"). Até aqui a
 * resposta a esse pedido era um texto concordando, e a correção continuava sendo
 * um segundo gesto noutro lugar.
 *
 * Este módulo é o CONTRATO entre a proposta que a Edge Function devolve e o botão
 * que a executa. Ele é puro de propósito: as decisões que valem a pena testar —
 * o que está aplicável, quanto dinheiro a proposta move, o que dizer quando
 * nenhum item sobrou — não deviam depender de levantar React nem o Supabase.
 *
 * O QUE ELE NÃO FAZ: escrever no Omie. Isso é `omie-trocar-categoria`, o mesmo
 * caminho do lápis do drill-down, com a mesma trilha em
 * `omie_categoria_alteracoes`. A proposta só diz QUAIS títulos e PARA ONDE.
 * ========================================================================== */

import type { ItemLote } from "@/lib/loteCategoria";
import { podeTrocarCategoria } from "@/lib/loteCategoria";

/** Um lançamento que a proposta quer mover, já conferido contra o Omie no servidor. */
export type ItemAcao = {
  cod_titulo: string;
  data: string | null;
  /** 'Ago-26' — a proposta pode atravessar o mês anterior. */
  mes: string;
  contraparte: string | null;
  /** Sinal cru da demonstração: despesa negativa. */
  valor: number;
  grupo: string | null;
  categoria_codigo: string | null;
  categoria_descricao: string | null;
  /** Onde ele cai HOJE. Nulo = fora do DE-PARA, não aparece na demonstração. */
  rubrica_atual: string | null;
};

/** Título que a IA quis mexer e o servidor barrou — com o motivo escrito. */
export type RecusaAcao = { cod_titulo: string; contraparte?: string | null; motivo: string };

export type AcaoTrocarCategoria = {
  tipo: "trocar_categoria";
  resumo: string | null;
  /** Uma frase; fica gravada na trilha do Omie. */
  motivo: string | null;
  categoria: { codigo: string; descricao: string };
  rubrica_destino: string | null;
  itens: ItemAcao[];
  recusados: RecusaAcao[];
  total: number;
};

export type AcaoApelido = {
  tipo: "apelido";
  resumo: string | null;
  motivo: string | null;
  nome: string;
  apelido: string;
  documento: string | null;
};

export type AcaoTarefa = {
  tipo: "tarefa";
  resumo: string | null;
  motivo: string | null;
  titulo: string;
  responsavel: string | null;
};

export type AcaoCelula = AcaoTrocarCategoria | AcaoApelido | AcaoTarefa;

export type EstadoAcao = "proposta" | "aplicada" | "descartada";

/** O que ficou registrado depois do clique — é o que a pessoa lê quando volta. */
export type ResultadoAcao = {
  tipo: AcaoCelula["tipo"];
  ok: number;
  falhas?: { cod_titulo: string; erro: string }[];
  naoTentados?: number;
  interrompidoPor?: string | null;
  /** Para apelido e tarefa, que não são lote. */
  detalhe?: string | null;
};

/* -------------------------------------------------------------------------
 * Leitura da proposta
 * ---------------------------------------------------------------------- */

/**
 * A proposta veio do banco como `jsonb`: pode ser qualquer coisa.
 *
 * Vale a checagem estreita porque esta linha pode ter sido gravada por uma versão
 * anterior da Edge Function — e um `acao.itens.map` num campo que virou objeto
 * derruba a página inteira da DRE, não só o balão.
 */
export function lerAcao(bruta: unknown): AcaoCelula | null {
  if (!bruta || typeof bruta !== "object") return null;
  const a = bruta as Record<string, unknown>;

  if (a.tipo === "trocar_categoria") {
    const cat = a.categoria as { codigo?: string; descricao?: string } | undefined;
    if (!cat?.codigo) return null;
    return {
      tipo: "trocar_categoria",
      resumo: (a.resumo as string) ?? null,
      motivo: (a.motivo as string) ?? null,
      categoria: { codigo: String(cat.codigo), descricao: String(cat.descricao ?? cat.codigo) },
      rubrica_destino: (a.rubrica_destino as string) ?? null,
      itens: Array.isArray(a.itens) ? (a.itens as ItemAcao[]) : [],
      recusados: Array.isArray(a.recusados) ? (a.recusados as RecusaAcao[]) : [],
      total: Number(a.total) || 0,
    };
  }

  if (a.tipo === "apelido" && a.nome && a.apelido) {
    return {
      tipo: "apelido",
      resumo: (a.resumo as string) ?? null,
      motivo: (a.motivo as string) ?? null,
      nome: String(a.nome),
      apelido: String(a.apelido),
      documento: (a.documento as string) ?? null,
    };
  }

  if (a.tipo === "tarefa" && a.titulo) {
    return {
      tipo: "tarefa",
      resumo: (a.resumo as string) ?? null,
      motivo: (a.motivo as string) ?? null,
      titulo: String(a.titulo),
      responsavel: (a.responsavel as string) ?? null,
    };
  }

  return null;
}

/**
 * O que de fato dá para aplicar.
 *
 * O servidor já barrou previsão de OS e perna bancária, mas a checagem se repete
 * aqui pelo mesmo motivo que `TrocarCategoriaLote` a repete: a tela não pode
 * OFERECER o que o ERP vai recusar. Se um dia a peneira do servidor mudar, o
 * botão continua contando certo.
 */
export function itensAplicaveis(acao: AcaoTrocarCategoria, escolhidos?: Set<string>): ItemAcao[] {
  return acao.itens.filter(
    (i) => podeTrocarCategoria(i.grupo) && (!escolhidos || escolhidos.has(i.cod_titulo)),
  );
}

/** O que a proposta move, em dinheiro — para o cartão dizer o tamanho do gesto. */
export function totalDosItens(itens: ItemAcao[]): number {
  return itens.reduce((s, i) => s + (Number(i.valor) || 0), 0);
}

/** A tradução para o laço que já existe (`trocarEmLote`). */
export function paraLote(itens: ItemAcao[]): ItemLote[] {
  return itens.map((i) => ({
    codTitulo: i.cod_titulo,
    contraparte: i.contraparte,
    valor: i.valor,
    categoriaCodigo: i.categoria_codigo,
    categoriaDescricao: i.categoria_descricao,
  }));
}

/**
 * A linha do cartão, quando a IA não escreveu um resumo decente.
 *
 * Nunca fica em branco: um cartão sem título é um botão sem legenda, e este
 * botão altera o ERP.
 */
export function tituloDaAcao(acao: AcaoCelula): string {
  if (acao.resumo) return acao.resumo;

  if (acao.tipo === "trocar_categoria") {
    const n = acao.itens.length;
    const alvo = acao.rubrica_destino ?? acao.categoria.descricao;
    return n === 1 ? `Mover 1 lançamento para ${alvo}` : `Mover ${n} lançamentos para ${alvo}`;
  }
  if (acao.tipo === "apelido") return `Chamar “${acao.nome}” de “${acao.apelido}”`;
  return acao.titulo;
}

/**
 * Por que não há botão.
 *
 * Uma proposta pode chegar sem nenhum item aplicável — a IA quis mover quatro
 * títulos e os quatro são previsão de ordem de serviço. Esconder isso deixaria a
 * resposta prometendo uma correção que nunca apareceu; o certo é dizer o que
 * houve, com o motivo que o servidor devolveu.
 */
export function motivoSemBotao(acao: AcaoCelula): string | null {
  if (acao.tipo !== "trocar_categoria") return null;
  if (itensAplicaveis(acao).length > 0) return null;

  if (!acao.recusados.length) return "A IA não conseguiu apontar nenhum lançamento para mover.";

  const motivos = [...new Set(acao.recusados.map((r) => r.motivo))];
  const n = acao.recusados.length;
  return `${n === 1 ? "O lançamento apontado não pode" : `Os ${n} lançamentos apontados não podem`} `
    + `ser alterados por aqui: ${motivos.join("; ")}.`;
}

/** A frase do toast, no tom de quem precisa decidir o que fazer agora. */
export function fraseDoResultado(r: ResultadoAcao): string {
  if (r.tipo === "apelido") return r.ok ? "Apelido cadastrado." : "Não consegui cadastrar o apelido.";
  if (r.tipo === "tarefa") return r.ok ? "Subtarefa criada no card Fechamento." : "Não consegui criar a subtarefa.";

  const falhas = r.falhas?.length ?? 0;
  const naoTentados = r.naoTentados ?? 0;
  if (r.ok && !falhas && !naoTentados) {
    return `${r.ok} ${r.ok === 1 ? "lançamento alterado" : "lançamentos alterados"} no Omie.`;
  }
  if (r.ok) {
    return `${r.ok} ${r.ok === 1 ? "alterado" : "alterados"}, ${falhas} recusado(s)`
      + (naoTentados ? `, ${naoTentados} não tentado(s).` : ".");
  }
  return `Nenhum lançamento foi alterado — ${falhas} recusado(s)`
    + (naoTentados ? `, ${naoTentados} não tentado(s).` : ".");
}
