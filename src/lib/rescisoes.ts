/* Rescisões — as contas que a tela precisa e que não são do banco.
 *
 * O que mora aqui é o que dá para conferir sem Supabase: a soma das verbas
 * contra o total que a skill declarou, o prazo do art. 477, o tempo de casa e o
 * resumo do ano. A tela só formata.
 *
 * A REGRA CENTRAL é a da conferência. Os totais chegam prontos da skill e as
 * verbas também; quando os dois discordam, este módulo NÃO escolhe — devolve a
 * diferença para a tela mostrar. Recalcular por cima esconderia justamente o
 * erro que interessa achar (e já aconteceu no cartão: total congelado ao lado de
 * matriz viva é como se cria discrepância silenciosa).
 */

export type SituacaoRescisao = "calculada" | "conferida" | "paga" | "cancelada";
export type TipoVerba = "provento" | "desconto" | "fgts" | "informativo";

/* A skill que roda hoje é a "Rescisão PJ" e ela classifica em voluntário /
   involuntário — é essa classificação que liga a multa de 1× remuneração. Os
   valores da CLT continuam aqui porque o painel é o mesmo para os dois mundos. */
export type MotivoRescisao =
  | "voluntario" | "involuntario"
  | "sem_justa_causa" | "pedido_demissao" | "justa_causa" | "acordo_484a"
  | "termino_experiencia" | "termino_contrato" | "rescisao_indireta"
  | "fim_contrato_pj" | "outro";

/** De onde a skill tirou o dado — o que permite auditar sem refazer a conta. */
export type Fonte = { texto: string; url?: string | null };

export type Rescisao = {
  id: string;
  chave: string;
  colaborador: string;
  colaborador_id: string | null;
  cpf: string | null;
  matricula: string | null;
  cargo: string | null;
  departamento: string | null;
  centro_custo: string | null;
  vinculo: string;
  admissao: string | null;
  aviso_em: string | null;
  desligamento: string;
  motivo: MotivoRescisao;
  aviso_previo: string | null;
  aviso_dias: number | null;
  salario_base: number | null;
  total_proventos: number;
  total_descontos: number;
  liquido: number;
  fgts_base_multa: number | null;
  fgts_multa: number | null;
  fgts_recolher: number | null;
  encargos: number | null;
  custo_empresa: number | null;
  data_pagamento_prevista: string | null;
  data_pagamento: string | null;
  situacao: SituacaoRescisao;
  memoria_md: string | null;
  observacao: string | null;
  fonte: string | null;
  skill_versao: string | null;
  calculado_em: string | null;
  arquivo: string | null;
  registrado_em: string;
  atualizado_em: string;

  /* ---- o que a skill de Rescisão PJ produz ---- */
  tipo_desligamento: "voluntario" | "involuntario" | null;
  motivo_texto: string | null;          // o campo "Motivo desligamento" do e-mail, cru
  fonte_remuneracao: "planilha" | "email" | null;
  dias_ferias_tirados: number | null;
  meses_trabalhados: number | null;     // pela regra do "mês cheio" (>15 dias)
  dias_trabalhados_mes: number | null;
  dias_mes_saida: number | null;
  flash_mensal: number | null;
  fontes: (Fonte | string)[] | null;
  alertas: string[] | null;
  texto_resposta: string | null;        // a resposta formatada, como a skill imprimiu
};

export type Verba = {
  id: string;
  rescisao_id: string;
  ordem: number;
  tipo: TipoVerba;
  rubrica: string;
  referencia: string | null;
  base: number | null;
  valor: number;
  formula: string | null;
  fundamento: string | null;
  incide_inss: boolean | null;
  incide_irrf: boolean | null;
  incide_fgts: boolean | null;
};

/** Rótulo, forma curta (para a coluna estreita) e tom da cor. */
export const MOTIVOS: Record<MotivoRescisao, { label: string; curto: string; tom: "neg" | "neu" | "warn" }> = {
  // Skill PJ — é a classificação que decide se há multa de 1× remuneração.
  involuntario:        { label: "Desligamento pela empresa",      curto: "Involuntário",     tom: "neg" },
  voluntario:          { label: "Saída por iniciativa da pessoa", curto: "Voluntário",       tom: "neu" },
  // CLT
  sem_justa_causa:     { label: "Dispensa sem justa causa",       curto: "Sem justa causa",  tom: "neg" },
  pedido_demissao:     { label: "Pedido de demissão",             curto: "Pediu demissão",   tom: "neu" },
  justa_causa:         { label: "Dispensa por justa causa",       curto: "Justa causa",      tom: "warn" },
  acordo_484a:         { label: "Acordo (CLT art. 484-A)",        curto: "Acordo",           tom: "neu" },
  termino_experiencia: { label: "Fim do contrato de experiência", curto: "Experiência",      tom: "neu" },
  termino_contrato:    { label: "Término de contrato",            curto: "Fim de contrato",  tom: "neu" },
  rescisao_indireta:   { label: "Rescisão indireta",              curto: "Indireta",         tom: "warn" },
  fim_contrato_pj:     { label: "Fim de contrato PJ",             curto: "Fim PJ",           tom: "neu" },
  outro:               { label: "Outro",                          curto: "Outro",            tom: "neu" },
};

export const SITUACOES: Record<SituacaoRescisao, { label: string; ordem: number }> = {
  calculada: { label: "Calculada", ordem: 0 },
  conferida: { label: "Conferida", ordem: 1 },
  paga:      { label: "Paga",      ordem: 2 },
  cancelada: { label: "Cancelada", ordem: 3 },
};

export const AVISOS: Record<string, string> = {
  indenizado:    "Aviso indenizado",
  trabalhado:    "Aviso trabalhado",
  dispensado:    "Aviso dispensado",
  nao_cumprido:  "Aviso não cumprido (descontado)",
  nao_se_aplica: "Sem aviso prévio",
};

export const TIPOS_VERBA: Record<TipoVerba, { label: string; nota: string }> = {
  provento:    { label: "Proventos",   nota: "entram no líquido a pagar" },
  desconto:    { label: "Descontos",   nota: "saem do líquido" },
  fgts:        { label: "FGTS",        nota: "vai para a conta / guia — fora do líquido" },
  informativo: { label: "Informativo", nota: "base de cálculo e referência — não soma" },
};

/** Um centavo de folga: numeric(14,2) de um lado, float do outro. */
const TOLERANCIA = 0.005;

/** 'YYYY-MM-DD' vira meia-dia local — nunca o dia anterior por fuso. */
export function dataLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtData(iso: string | null | undefined): string {
  const d = dataLocal(iso);
  return d ? d.toLocaleDateString("pt-BR") : "—";
}

/** Valor em real, string pura (para title=, template literal e planilha). */
export function brlStr(n: number | null | undefined): string {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Dias corridos entre duas datas (b − a), já normalizadas para meia-dia. */
export function diasEntre(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Tempo de casa. `texto` é curto porque vive numa linha de apoio. */
export function tempoDeCasa(admissao: string | null, desligamento: string | null): {
  dias: number; anos: number; meses: number; texto: string;
} | null {
  const de = dataLocal(admissao), ate = dataLocal(desligamento);
  if (!de || !ate) return null;
  const dias = diasEntre(de, ate);
  if (dias < 0) return null;
  const totalMeses = Math.max(0, (ate.getFullYear() - de.getFullYear()) * 12 + (ate.getMonth() - de.getMonth())
    - (ate.getDate() < de.getDate() ? 1 : 0));
  const anos = Math.floor(totalMeses / 12), meses = totalMeses % 12;
  const texto = anos > 0
    ? (meses > 0 ? `${anos}a ${meses}m` : `${anos}a`)
    : (totalMeses > 0 ? `${totalMeses} ${totalMeses === 1 ? "mês" : "meses"}` : `${dias} dia${dias === 1 ? "" : "s"}`);
  return { dias, anos, meses, texto };
}

/* ------------------------------------------------------------------
 * Conferência — a soma das verbas contra o total declarado
 * ------------------------------------------------------------------
 * 'fgts' e 'informativo' ficam FORA do líquido de propósito: a multa de 40% vai
 * para a conta do FGTS, não para o bolso de quem saiu. Somá-la como provento
 * estouraria o líquido em 40% — e é o erro mais fácil de cometer aqui.
 */
export function conferir(r: Rescisao, verbas: Verba[]): {
  proventos: number; descontos: number; fgts: number; liquido: number;
  difProventos: number; difDescontos: number; difLiquido: number;
  fecha: boolean; semVerbas: boolean;
} {
  const soma = (t: TipoVerba) => verbas.filter((v) => v.tipo === t).reduce((a, v) => a + Number(v.valor || 0), 0);
  const proventos = soma("provento"), descontos = soma("desconto"), fgts = soma("fgts");
  const liquido = proventos - descontos;
  const difProventos = Number(r.total_proventos || 0) - proventos;
  const difDescontos = Number(r.total_descontos || 0) - descontos;
  const difLiquido = Number(r.liquido || 0) - liquido;
  const semVerbas = verbas.length === 0;
  return {
    proventos, descontos, fgts, liquido,
    difProventos, difDescontos, difLiquido,
    // Sem verbas não há o que conferir: não é "fecha", é "não deu para olhar".
    fecha: !semVerbas && Math.abs(difLiquido) < TOLERANCIA
      && Math.abs(difProventos) < TOLERANCIA && Math.abs(difDescontos) < TOLERANCIA,
    semVerbas,
  };
}

export type EstadoPrazo = "pago" | "cancelada" | "no_prazo" | "hoje" | "atrasado" | "sem_prazo";

/* Previsão de pagamento. A data vem do banco — a skill manda a combinada e, na
 * falta dela, a função de registro grava desligamento + 10 dias. Aqui só se lê e
 * se conta quantos dias faltam, para a tela dizer "vence em 3 dias" em vez de
 * obrigar quem lê a fazer a conta de cabeça.
 *
 * Os 10 dias são o prazo legal do art. 477 §6º só quando o vínculo é CLT. Em PJ
 * (que é o caso de toda rescisão que a skill calcula hoje) não há prazo em lei —
 * é uma previsão, e a tela não pode chamá-la de obrigação legal. Ver
 * `rotuloPrazo`. */
export function prazo(r: Rescisao, hoje: Date = new Date()): {
  data: string | null; dias: number | null; estado: EstadoPrazo; texto: string;
} {
  if (r.situacao === "cancelada") return { data: null, dias: null, estado: "cancelada", texto: "cancelada" };
  if (r.situacao === "paga" || r.data_pagamento) {
    return { data: r.data_pagamento, dias: null, estado: "pago", texto: r.data_pagamento ? `paga em ${fmtData(r.data_pagamento)}` : "paga" };
  }
  const prev = dataLocal(r.data_pagamento_prevista);
  if (!prev) return { data: null, dias: null, estado: "sem_prazo", texto: "sem prazo" };
  const ref = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12, 0, 0);
  const dias = diasEntre(ref, prev);
  if (dias < 0) return { data: r.data_pagamento_prevista, dias, estado: "atrasado", texto: `atrasada ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"}` };
  if (dias === 0) return { data: r.data_pagamento_prevista, dias, estado: "hoje", texto: "vence hoje" };
  return { data: r.data_pagamento_prevista, dias, estado: "no_prazo", texto: `vence em ${dias} dia${dias === 1 ? "" : "s"}` };
}

/** Como chamar a data prevista: em PJ é combinado, em CLT é prazo de lei. */
export function rotuloPrazo(r: Rescisao): { curto: string; explicacao: string } {
  return (r.vinculo ?? "").toLowerCase() === "clt"
    ? { curto: "prazo legal", explicacao: "CLT art. 477 §6º — 10 dias corridos do término do contrato" }
    : { curto: "previsão", explicacao: "PJ não tem prazo em lei; sem data combinada, o Hub assume 10 dias após o desligamento" };
}

/** O que sai do caixa. Numa rescisão PJ é o próprio total a receber. */
export function custoDe(r: Rescisao): number {
  if (r.custo_empresa != null) return Number(r.custo_empresa);
  return Number(r.liquido || 0) + encargosDe(r);
}

/** FGTS + encargos — zero em PJ, que é o caso de toda rescisão de hoje. */
export function encargosDe(r: Rescisao): number {
  return Number(r.fgts_multa || 0) + Number(r.fgts_recolher || 0) + Number(r.encargos || 0);
}

/* A coluna "custo da empresa" só faz sentido quando difere do total a receber.
   Em PJ os dois são o mesmo número, e duas colunas idênticas lado a lado são
   ruído que faz duvidar de qual é a certa. */
export function temEncargos(rows: Rescisao[]): boolean {
  return rows.some((r) => encargosDe(r) > 0);
}

/** PJ tem "remuneração"; CLT tem "salário base". Mesma coluna, nomes diferentes. */
export function rotuloRemuneracao(vinculo: string | null | undefined): string {
  return (vinculo ?? "").toLowerCase() === "clt" ? "Salário base" : "Remuneração";
}

/** As fontes chegam como texto ou {texto,url} — a tela lida com uma forma só. */
export function fontesDe(r: Rescisao): Fonte[] {
  const l = Array.isArray(r.fontes) ? r.fontes : [];
  return l
    .map((f) => (typeof f === "string" ? { texto: f } : { texto: f?.texto ?? "", url: f?.url ?? null }))
    .filter((f) => f.texto.trim() !== "");
}

/* As ressalvas que a skill deu em voz alta ("variável não informado", "férias
   além do direito acumulado"). Sobrevivem no registro porque são exatamente o
   que ninguém lembra um mês depois — e o que muda a leitura do número. */
export function alertasDe(r: Rescisao): string[] {
  return (Array.isArray(r.alertas) ? r.alertas : []).filter((a) => typeof a === "string" && a.trim() !== "");
}

/* ------------------------------------------------------------------
 * Resumo do período — os números do cabeçalho
 * ------------------------------------------------------------------
 * Canceladas ficam fora de TODA soma (e da contagem): elas continuam na lista,
 * riscadas, porque "esse cálculo foi cancelado" é informação — mas somá-las
 * inventaria custo que nunca saiu.
 */
export function resumoAno(rows: Rescisao[], hoje: Date = new Date()): {
  qtd: number; custo: number; liquido: number; fgts: number; encargos: number;
  medio: number; mesesCasa: number | null;
  aPagar: number; qtdAPagar: number; atrasadas: number; valorAtrasado: number;
  porMotivo: { motivo: MotivoRescisao; qtd: number; custo: number }[];
  canceladas: number;
} {
  const vivas = rows.filter((r) => r.situacao !== "cancelada");
  const custo = vivas.reduce((a, r) => a + custoDe(r), 0);
  const liquido = vivas.reduce((a, r) => a + Number(r.liquido || 0), 0);
  const fgts = vivas.reduce((a, r) => a + Number(r.fgts_multa || 0) + Number(r.fgts_recolher || 0), 0);
  const encargos = vivas.reduce((a, r) => a + Number(r.encargos || 0), 0);

  const naoPagas = vivas.filter((r) => r.situacao !== "paga" && !r.data_pagamento);
  const atrasadas = naoPagas.filter((r) => prazo(r, hoje).estado === "atrasado");

  const casas = vivas.map((r) => tempoDeCasa(r.admissao, r.desligamento)).filter(Boolean) as { anos: number; meses: number }[];
  const mesesCasa = casas.length ? casas.reduce((a, c) => a + c.anos * 12 + c.meses, 0) / casas.length : null;

  const mapa = new Map<MotivoRescisao, { qtd: number; custo: number }>();
  for (const r of vivas) {
    const cur = mapa.get(r.motivo) ?? { qtd: 0, custo: 0 };
    mapa.set(r.motivo, { qtd: cur.qtd + 1, custo: cur.custo + custoDe(r) });
  }

  return {
    qtd: vivas.length,
    custo, liquido, fgts, encargos,
    medio: vivas.length ? custo / vivas.length : 0,
    mesesCasa,
    aPagar: naoPagas.reduce((a, r) => a + Number(r.liquido || 0), 0),
    qtdAPagar: naoPagas.length,
    atrasadas: atrasadas.length,
    valorAtrasado: atrasadas.reduce((a, r) => a + Number(r.liquido || 0), 0),
    porMotivo: [...mapa.entries()]
      .map(([motivo, v]) => ({ motivo, ...v }))
      .sort((a, b) => b.custo - a.custo),
    canceladas: rows.length - vivas.length,
  };
}

/** As verbas na ordem em que se lê um espelho de rescisão. */
export function agruparVerbas(verbas: Verba[]): { tipo: TipoVerba; total: number; itens: Verba[] }[] {
  const ordem: TipoVerba[] = ["provento", "desconto", "fgts", "informativo"];
  return ordem
    .map((tipo) => {
      const itens = verbas.filter((v) => v.tipo === tipo).sort((a, b) => a.ordem - b.ordem);
      // 'informativo' é referência, não dinheiro: somar viraria um total sem sentido.
      const total = tipo === "informativo" ? 0 : itens.reduce((a, v) => a + Number(v.valor || 0), 0);
      return { tipo, total, itens };
    })
    .filter((g) => g.itens.length > 0);
}

/** A busca varre o que está ESCRITO na linha — nome, cargo, área, motivo. */
export function filtrar(rows: Rescisao[], busca: string): Rescisao[] {
  const q = busca.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => [
    r.colaborador, r.cargo ?? "", r.departamento ?? "", r.centro_custo ?? "",
    MOTIVOS[r.motivo]?.label ?? r.motivo, SITUACOES[r.situacao]?.label ?? r.situacao,
    // O motivo escrito pelo gestor no e-mail está NA LINHA — procurar por
    // "performance" tem de achar quem saiu por performance.
    r.motivo_texto ?? "",
    r.cpf ?? "", r.matricula ?? "",
  ].join(" ").toLowerCase().includes(q));
}

/* Planilha: uma linha por rescisão. As colunas de FGTS/encargos só entram quando
   alguma linha tem valor nelas — numa exportação 100% PJ, três colunas zeradas
   só atrapalham quem vai somar. */
export function paraAOA(rows: Rescisao[]): (string | number)[][] {
  const comEncargos = temEncargos(rows);
  const cab = [
    "Colaborador", "Cargo", "Área", "Vínculo", "Admissão", "Desligamento", "Tempo de casa",
    "Tipo", "Motivo (e-mail)", "Remuneração", "Fonte da remuneração",
    "Meses (férias)", "Dias de férias tirados",
    "Proventos", "Descontos", "Total a receber",
    ...(comEncargos ? ["FGTS multa", "FGTS a recolher", "Encargos", "Custo da empresa"] : []),
    "Prazo de pagamento", "Pago em", "Situação", "Calculado por", "Calculado em", "Ressalvas",
  ];
  const corpo = rows.map((r) => [
    r.colaborador, r.cargo ?? "", r.departamento ?? r.centro_custo ?? "", r.vinculo,
    r.admissao ?? "", r.desligamento, tempoDeCasa(r.admissao, r.desligamento)?.texto ?? "",
    MOTIVOS[r.motivo]?.label ?? r.motivo, r.motivo_texto ?? "",
    Number(r.salario_base ?? 0), r.fonte_remuneracao ?? "",
    r.meses_trabalhados ?? "", r.dias_ferias_tirados ?? "",
    Number(r.total_proventos ?? 0), Number(r.total_descontos ?? 0), Number(r.liquido ?? 0),
    ...(comEncargos
      ? [Number(r.fgts_multa ?? 0), Number(r.fgts_recolher ?? 0), Number(r.encargos ?? 0), custoDe(r)]
      : []),
    r.data_pagamento_prevista ?? "", r.data_pagamento ?? "",
    SITUACOES[r.situacao]?.label ?? r.situacao,
    r.fonte ?? "", r.calculado_em ? new Date(r.calculado_em).toLocaleString("pt-BR") : "",
    alertasDe(r).join(" · "),
  ]);
  return [cab, ...corpo];
}
