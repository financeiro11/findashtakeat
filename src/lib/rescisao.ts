/**
 * O acerto de um PJ desligado.
 *
 * Isto não é "o proporcional dos dias" — é a conta inteira da saída: férias
 * proporcionais (menos as que a pessoa já tirou), o proporcional do mês em que
 * saiu, a variável do e-mail de desligamento, a multa de rescisão e a devolução
 * do Flash que já tinha sido creditado para o mês cheio.
 *
 * Duas coisas o RH não guarda e o cálculo precisa: quantos dias de férias a
 * pessoa já tirou e quanto de variável entra no acerto. Uma terceira — se a
 * saída foi voluntária ou involuntária — o RH guarda em `tipodesl`, mas na
 * maioria das fichas o campo está vazio, e é justamente ele que decide a multa
 * de um mês inteiro. Nada disso se chuta: falta virou pendência, e enquanto
 * houver pendência o total não fecha.
 *
 * Regras conforme a política vigente desde 01/07/2026 (Henrique/Miguel): multa
 * de 1× remuneração em desligamento involuntário, independente do tempo de
 * casa; a carência de 90 dias da regra anterior está revogada.
 */

import { normalize } from "@/lib/normalize";

/** Valor cheio do Flash no mês. O benefício cai no dia 1º pelo mês inteiro. */
export const FLASH_MENSAL = 500;

/** Acima disso, o mês conta inteiro para férias. */
const DIAS_PARA_MES_CHEIO = 15;

/** Direito de férias por mês trabalhado — usado só no aviso de antecipação. */
const DIAS_DE_FERIAS_POR_MES = 2.5;

/** Até aqui, férias não informadas podem ser assumidas como zero. */
const MESES_ATE_PODER_ASSUMIR_ZERO = 6;

export type Classificacao = "voluntario" | "involuntario";

/** O que a ficha do RH entrega. Datas em ISO (`YYYY-MM-DD`), como vêm do banco. */
export type FichaDoDesligado = {
  inicio?: unknown;
  datadesl?: unknown;
  valor?: unknown;
  /** "Voluntário" / "Involuntário" — quase sempre vazio. */
  tipodesl?: unknown;
  /** Só distingue quem tem Flash de quem não tem; o valor da coluna às vezes já vem rateado. */
  flash?: unknown;
  valor_liberalidade?: unknown;
  /** A ficha chega inteira, com as outras ~60 colunas do RH junto. */
  [outraColuna: string]: unknown;
};

/** O que só o e-mail de desligamento (ou o usuário) sabe responder. */
export type EntradasDaRescisao = {
  /** Dias de férias já tirados. `null` = ainda não informado. */
  diasDeFeriasTirados?: number | null;
  /** Variável/comissão do acerto. Ausente no e-mail = R$ 0,00, com aviso. */
  variavel?: number | null;
  /** Preenche o que falta em `tipodesl`; sobrepõe o campo do RH quando informado. */
  classificacao?: Classificacao | null;
};

export type LinhaDaRescisao = {
  chave: string;
  rotulo: string;
  detalhe?: string;
  valor: number;
  /** Entra subtraindo no total. */
  desconto?: boolean;
};

export type Rescisao = {
  valor: number;
  /** Meses completos de casa, para "6 meses" e para o aviso de antecipação. */
  mesesDeCasa: number;
  /** Meses que contam para férias pela regra do mês cheio. */
  mesesDeFerias: number;
  diasDoMes: number;
  diasTrabalhadosNoMes: number;
  diasNaoTrabalhadosNoMes: number;
  feriasBrutas: number;
  diasDeFeriasTirados: number;
  descontoDeFerias: number;
  proporcional: number;
  variavel: number;
  classificacao: Classificacao | null;
  /** De onde veio a classificação usada. */
  origemDaClassificacao: "rh" | "usuario" | null;
  multa: number;
  descontoFlash: number;
  liberalidade: number;
  linhas: LinhaDaRescisao[];
  total: number;
  /** Impedem fechar o total. */
  pendencias: string[];
  /** Não impedem, mas quem paga precisa ler. */
  avisos: string[];
};

export const parseISO = (s: unknown): Date | null => {
  if (!s || typeof s !== "string") return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/**
 * Lê `tipodesl`. Só reconhece o que é inequívoco: "saída acordada", "não está
 * mais na empresa" e o campo vazio caem fora de propósito — são o caso ambíguo,
 * que a skill manda parar e perguntar.
 */
export function classificacaoDoRH(tipodesl: unknown): Classificacao | null {
  const t = normalize(String(tipodesl ?? "")); // "Involuntário" -> "INVOLUNTARIO"
  if (!t) return null;
  if (t.startsWith("INVOLUNT")) return "involuntario";
  if (t.startsWith("VOLUNT")) return "voluntario";
  return null;
}

const ultimoDiaDoMes = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

const mesmoMes = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** Meses completos entre duas datas — o "tempo de casa" em número. */
export function mesesDeCasa(inicio: Date, fim: Date): number {
  let meses = (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth());
  if (fim.getDate() < inicio.getDate()) meses -= 1;
  return Math.max(0, meses);
}

/**
 * Meses que contam para férias, pela regra do mês cheio (>15 dias trabalhados):
 * o mês de admissão conta se entrou até o dia 15, o mês de saída conta se saiu
 * no dia 16 ou depois, e os do meio contam sempre.
 */
export function mesesParaFerias(inicio: Date, desl: Date): number {
  if (desl < inicio) return 0;
  if (mesmoMes(inicio, desl)) {
    return desl.getDate() - inicio.getDate() + 1 > DIAS_PARA_MES_CHEIO ? 1 : 0;
  }
  const intervalo =
    (desl.getFullYear() - inicio.getFullYear()) * 12 + (desl.getMonth() - inicio.getMonth()) + 1;
  let meses = intervalo - 2; // os intermediários contam sempre
  if (inicio.getDate() <= DIAS_PARA_MES_CHEIO) meses += 1;
  if (desl.getDate() > DIAS_PARA_MES_CHEIO) meses += 1;
  return Math.max(0, meses);
}

/**
 * Dias trabalhados no mês da saída. Quem entrou e saiu no mesmo mês só conta o
 * pedaço entre as duas datas.
 */
export function diasTrabalhadosNoMesDaSaida(inicio: Date | null, desl: Date): number {
  const dias = inicio && mesmoMes(inicio, desl) ? desl.getDate() - inicio.getDate() + 1 : desl.getDate();
  return Math.min(ultimoDiaDoMes(desl), Math.max(0, dias));
}

export function calcularRescisao(
  ficha: FichaDoDesligado,
  entradas: EntradasDaRescisao = {},
): Rescisao | null {
  const inicio = parseISO(ficha.inicio);
  const desl = parseISO(ficha.datadesl);
  const valor = num(ficha.valor);
  if (!desl || !valor) return null;

  const pendencias: string[] = [];
  const avisos: string[] = [];

  const diasDoMes = ultimoDiaDoMes(desl);
  const diasTrabalhados = diasTrabalhadosNoMesDaSaida(inicio, desl);
  const diasNaoTrabalhados = diasDoMes - diasTrabalhados;

  /* A) Férias proporcionais. */
  const meses = inicio ? mesesParaFerias(inicio, desl) : 0;
  const casa = inicio ? mesesDeCasa(inicio, desl) : 0;
  const feriasBrutas = inicio ? (valor / 12) * meses : 0;
  if (!inicio) {
    avisos.push(
      "Data de início ausente na ficha do RH — as férias proporcionais não entraram no total.",
    );
  }
  if (meses > 12) {
    avisos.push(
      `A conta soma ${meses} meses de férias (${meses}/12 de remuneração). ` +
        "A regra não prevê corte por período aquisitivo — confirme se é isso mesmo.",
    );
  }

  /* A.1) Desconto das férias já tiradas. */
  const informouFerias = entradas.diasDeFeriasTirados !== null && entradas.diasDeFeriasTirados !== undefined;
  const diasTirados = informouFerias ? Math.max(0, num(entradas.diasDeFeriasTirados)) : 0;
  if (!informouFerias) {
    if (casa > MESES_ATE_PODER_ASSUMIR_ZERO) {
      pendencias.push(
        `${casa} meses de casa: informe quantos dias de férias a pessoa já tirou. Com esse tempo, zero não se assume.`,
      );
    } else {
      avisos.push(
        "Dias de férias já tirados não informados. Com até 6 meses de casa, a conta assume 0 — confirme no e-mail de desligamento.",
      );
    }
  }
  const descontoDeFerias = (valor / 30) * diasTirados;
  if (diasTirados > meses * DIAS_DE_FERIAS_POR_MES) {
    avisos.push(
      `${diasTirados} dias de férias tirados para ${meses} ${meses === 1 ? "mês" : "meses"} de direito: ` +
        "houve antecipação. O desconto está inteiro na conta e pode zerar (ou virar) o saldo.",
    );
  }

  /* B) Proporcional do mês da saída — dias reais do mês, nunca 30 fixo. */
  const proporcional = valor * (diasTrabalhados / diasDoMes);

  /* C) Variável / comissão. */
  const informouVariavel = entradas.variavel !== null && entradas.variavel !== undefined;
  const variavel = informouVariavel ? num(entradas.variavel) : 0;
  if (!informouVariavel) {
    avisos.push("Variável/comissão não informada — entrou como R$ 0,00, conforme o e-mail de desligamento.");
  }

  /* E) Multa de rescisão. */
  const doRH = classificacaoDoRH(ficha.tipodesl);
  const classificacao = entradas.classificacao ?? doRH;
  const origemDaClassificacao = entradas.classificacao ? "usuario" : doRH ? "rh" : null;
  if (!classificacao) {
    pendencias.push(
      "Tipo de desligamento em branco na ficha do RH. Voluntário ou involuntário muda o total em uma remuneração inteira — classifique antes de pagar.",
    );
  }
  if (entradas.classificacao && doRH && entradas.classificacao !== doRH) {
    avisos.push(
      `A ficha do RH diz "${String(ficha.tipodesl)}" e a conta está usando ${
        entradas.classificacao === "involuntario" ? "involuntário" : "voluntário"
      }.`,
    );
  }
  const multa = classificacao === "involuntario" ? valor : 0;

  /* D) Devolução do Flash. */
  const temFlash = ficha.flash === null || ficha.flash === undefined || num(ficha.flash) > 0;
  const descontoFlash = temFlash ? FLASH_MENSAL * (diasNaoTrabalhados / diasDoMes) : 0;

  const liberalidade = num(ficha.valor_liberalidade);

  const linhas: LinhaDaRescisao[] = [];
  if (inicio) {
    linhas.push({
      chave: "ferias",
      rotulo: "Férias proporcionais",
      detalhe: `${fmt(valor)} ÷ 12 × ${meses} ${meses === 1 ? "mês" : "meses"}`,
      valor: feriasBrutas,
    });
  }
  if (diasTirados > 0) {
    linhas.push({
      chave: "ferias-tiradas",
      rotulo: "Férias já tiradas",
      detalhe: `${fmt(valor)} ÷ 30 × ${diasTirados} ${diasTirados === 1 ? "dia" : "dias"}`,
      valor: descontoDeFerias,
      desconto: true,
    });
  }
  linhas.push({
    chave: "proporcional",
    rotulo: "Proporcional do mês da saída",
    detalhe: `${fmt(valor)} × ${diasTrabalhados}/${diasDoMes}`,
    valor: proporcional,
  });
  linhas.push({
    chave: "variavel",
    rotulo: "Variável / comissão",
    detalhe: informouVariavel ? undefined : "não informada no e-mail",
    valor: variavel,
  });
  if (classificacao === "involuntario") {
    linhas.push({
      chave: "multa",
      rotulo: "Multa de rescisão",
      detalhe: "involuntário — 1 remuneração",
      valor: multa,
    });
  }
  if (descontoFlash > 0) {
    linhas.push({
      chave: "flash",
      rotulo: "Devolução do Flash",
      detalhe: `${fmt(FLASH_MENSAL)} × ${diasNaoTrabalhados}/${diasDoMes} não trabalhados`,
      valor: descontoFlash,
      desconto: true,
    });
  }
  if (liberalidade > 0) {
    linhas.push({ chave: "liberalidade", rotulo: "Liberalidade", valor: liberalidade });
  }

  const total = linhas.reduce((s, l) => s + (l.desconto ? -l.valor : l.valor), 0);

  return {
    valor,
    mesesDeCasa: casa,
    mesesDeFerias: meses,
    diasDoMes,
    diasTrabalhadosNoMes: diasTrabalhados,
    diasNaoTrabalhadosNoMes: diasNaoTrabalhados,
    feriasBrutas,
    diasDeFeriasTirados: diasTirados,
    descontoDeFerias,
    proporcional,
    variavel,
    classificacao,
    origemDaClassificacao,
    multa,
    descontoFlash,
    liberalidade,
    linhas,
    total,
    pendencias,
    avisos,
  };
}

/**
 * O acerto em texto plano, componente a componente, como manda o formato de
 * saída da rescisão — é o que se cola no e-mail de aprovação.
 */
export function rescisaoEmTexto(nome: string, r: Rescisao, datadesl: unknown): string {
  const linhas = r.linhas.map(
    (l) =>
      `${l.desconto ? "− " : "+ "}${l.rotulo}${l.detalhe ? ` (${l.detalhe})` : ""}: ${fmt(l.valor)}`,
  );
  const data = typeof datadesl === "string" ? datadesl.slice(0, 10).split("-").reverse().join("/") : "—";
  return [
    `Rescisão — ${nome}`,
    `Último dia trabalhado: ${data}`,
    `Remuneração mensal: ${fmt(r.valor)}`,
    r.classificacao ? `Tipo: ${r.classificacao === "involuntario" ? "involuntário" : "voluntário"}` : "Tipo: não classificado",
    "",
    ...linhas,
    `TOTAL: ${fmt(r.total)}`,
    ...(r.pendencias.length ? ["", "Pendências:", ...r.pendencias.map((p) => `- ${p}`)] : []),
    ...(r.avisos.length ? ["", "Avisos:", ...r.avisos.map((a) => `- ${a}`)] : []),
    "",
    "Fontes: ficha do RH (Central do Financeiro) e e-mail de desligamento.",
  ].join("\n");
}
