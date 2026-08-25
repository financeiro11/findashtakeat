/**
 * A cobertura de notas de fornecedor dentro do Omie — o vocabulário e as contas.
 *
 * Lógica pura, separada da tela, porque é aqui que mora a definição de "cobertura"
 * — e um número de auditoria precisa de definição conferível, não de uma fórmula
 * enterrada num `useMemo`.
 *
 * A REGRA DO DENOMINADOR, que é a coisa mais importante deste arquivo:
 * transferência entre contas próprias, folha, tributo e tarifa bancária NÃO têm
 * nota de fornecedor. Contá-las como "faltando" faz a cobertura despencar por um
 * motivo que não é problema, e um número que se explica com ressalva não
 * sobrevive à primeira pergunta numa reunião. Por isso `dispensa` e `conferir`
 * ficam de fora dos DOIS lados da conta.
 */

export type SituacaoTitulo =
  | "com_nota"
  | "anexo_suspeito"
  | "pronta_para_enviar"
  | "sem_nota"
  | "erro_leitura"
  | "nao_verificado"
  | "dispensa"
  | "conferir";

/**
 * A ordem de cobrança. NÃO dispensa nada — tudo continua exigindo nota; o que
 * muda é por onde se começa. Os cortes são decisão do financeiro (25/08/2026):
 * abaixo de R$ 150 irrelevante, até 500 médio, até 1.000 grave, acima urgente.
 */
export type Gravidade = "urgente" | "grave" | "medio" | "irrelevante";

export type Regra = "exige" | "dispensa" | "conferir";

export type LinhaTitulo = {
  cod_titulo: number;
  favorecido: string;
  doc: string | null;
  categoria: string;
  categoria_codigo: string | null;
  conta: string;
  valor: number;
  competencia: string | null;
  vencimento: string | null;
  pagamento: string | null;
  situacao: SituacaoTitulo;
  gravidade: Gravidade;
  anexos_no_erp: number | null;
  anexos: Array<{ id: string | null; nome: string | null; tipo: string | null }> | null;
  anexo_classe: "nota" | "duvidoso" | "indefinido" | null;
  anexo_revisao: "nota" | "nao_e_nota" | null;
  nota_no_hub: string | null;
  enviado_em: string | null;
  nf_no_campo: string | null;
  documento: string | null;
  erro_leitura: string | null;
  anexo_lido_em: string | null;
  total_geral: number;
};

export type ResumoNotas = {
  meta: {
    de: string; ate: string;
    limiares: { medio: number; grave: number; urgente: number };
    titulos: number; valor: number;
    exigivel_titulos: number; exigivel_valor: number;
    cobertura_valor: number | null; cobertura_titulos: number | null;
    nao_verificado_valor: number;
    a_revisar: number;
    atualizado_em: string | null;
  };
  gravidade: Array<{ gravidade: Gravidade; titulos: number; valor: number }>;
  situacoes: Array<{ situacao: SituacaoTitulo; titulos: number; valor: number }>;
  meses: Array<{
    mes: string; titulos: number; valor: number;
    com_nota: number; valor_com_nota: number;
    sem_nota: number; valor_sem_nota: number;
    pronta: number; nao_verificado: number;
  }>;
  contas: Array<{
    conta: string; titulos: number; valor: number;
    com_nota: number; valor_com_nota: number; nao_verificado: number; cobertura: number | null;
  }>;
  categorias: Array<{
    categoria: string; codigo: string | null; titulos: number; valor: number;
    com_nota: number; sem_nota: number; pronta: number; nao_verificado: number;
    urgentes: number; valor_faltante: number; cobertura: number | null;
  }>;
  fornecedores: Array<{
    favorecido: string; doc: string | null; titulos: number;
    urgentes: number; valor_faltante: number;
  }>;
};

/** Como cada situação se chama e se lê na tela. `tom` é a cor semântica. */
export const SITUACAO: Record<SituacaoTitulo, {
  rotulo: string;
  tom: "ok" | "falta" | "atencao" | "neutro" | "fora";
  ajuda: string;
}> = {
  com_nota: {
    rotulo: "Com nota no ERP", tom: "ok",
    ajuda: "O Omie confirmou que existe anexo neste título. É o único estado verde.",
  },
  anexo_suspeito: {
    rotulo: "Anexo a conferir", tom: "atencao",
    ajuda: "Tem arquivo no ERP, mas o nome não identifica documento nenhum (\"nf_undefined_correta.pdf\", foto solta). Alguém precisa abrir e dizer se é a nota.",
  },
  pronta_para_enviar: {
    rotulo: "Pronta para subir", tom: "atencao",
    ajuda: "O Hub TEM o arquivo da nota e o ERP não. É falha nossa — e a mais fácil de corrigir, porque o arquivo já está na mão.",
  },
  sem_nota: {
    rotulo: "Sem nota", tom: "falta",
    ajuda: "Exige nota, o Omie foi consultado, não há anexo, e ninguém tem o arquivo. É o que precisa ser cobrado do fornecedor.",
  },
  erro_leitura: {
    rotulo: "Não deu para ler", tom: "atencao",
    ajuda: "O Omie recusou a consulta (rate limit ou tabela). Diferente de \"não tem nota\" — a varredura volta neste título.",
  },
  nao_verificado: {
    rotulo: "Ainda não verificado", tom: "neutro",
    ajuda: "Ninguém perguntou ao ERP sobre este título ainda. Enquanto houver linhas aqui, a cobertura é um piso, não o número.",
  },
  dispensa: {
    rotulo: "Não exige nota", tom: "fora",
    ajuda: "Transferência entre contas próprias, folha, tributo, tarifa. Não existe nota de fornecedor para isso.",
  },
  conferir: {
    rotulo: "Depende (bilhete/cupom)", tom: "fora",
    ajuda: "Passagem, hospedagem, refeição: às vezes vem nota, às vezes bilhete ou cupom. Fora da cobrança automática.",
  },
};

/** Como cada faixa de gravidade se chama e se lê. */
export const GRAVIDADE: Record<Gravidade, { rotulo: string; tom: string; ordem: number }> = {
  urgente:     { rotulo: "Urgente",     tom: "falta",   ordem: 1 },
  grave:       { rotulo: "Grave",       tom: "atencao", ordem: 2 },
  medio:       { rotulo: "Médio",       tom: "neutro",  ordem: 3 },
  irrelevante: { rotulo: "Irrelevante", tom: "fora",    ordem: 4 },
};

export const GRAVIDADES: Gravidade[] = ["urgente", "grave", "medio", "irrelevante"];

/** As situações que entram na conta de cobertura. */
export const SITUACOES_EXIGIVEIS: SituacaoTitulo[] = [
  "com_nota", "anexo_suspeito", "pronta_para_enviar", "sem_nota", "erro_leitura", "nao_verificado",
];

/** O que conta como "falta nota" para efeito de cobrança. */
export const SITUACOES_FALTANDO: SituacaoTitulo[] = ["sem_nota", "anexo_suspeito", "pronta_para_enviar"];

export const REGRA: Record<Regra, { rotulo: string; ajuda: string }> = {
  exige: { rotulo: "Exige nota", ajuda: "Entra na conta de cobertura e vira cobrança quando falta." },
  dispensa: { rotulo: "Não exige", ajuda: "Fora dos dois lados da conta — não é nota que falta, é despesa que não gera nota." },
  conferir: { rotulo: "Depende", ajuda: "Fora da conta automática, mas visível numa lista própria para alguém olhar." },
};

/* ------------------------------ formatação ------------------------------ */
// Convenção do projeto: o formatador normal devolve ReactNode com o valor cheio
// no hover; a variante `…Str` devolve string pura (title, template, eixo).

export const brlStr = (n: number | null | undefined): string =>
  `R$ ${Math.round(Number(n) || 0).toLocaleString("pt-BR")}`;

export const pctStr = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `${Number(n).toFixed(1).replace(".", ",")}%`;

export const dataStr = (s: string | null | undefined): string =>
  s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-08" → "ago/26". */
export function mesCurto(mes: string): string {
  const [a, m] = String(mes).split("-");
  const i = Number(m) - 1;
  return MESES[i] ? `${MESES[i]}/${a.slice(2)}` : mes;
}

/** CNPJ/CPF só dígitos → com máscara. Devolve o que veio quando não reconhece. */
export function formatarDoc(doc: string | null | undefined): string {
  const d = String(doc ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d || "—";
}

/* -------------------------------- as contas ------------------------------- */

/**
 * A frase que resume o mês em uma linha, com a ressalva quando ela existe.
 *
 * A ressalva NÃO é rodapé: enquanto houver título não verificado, a cobertura é
 * um piso — pode subir quando a varredura terminar, nunca descer. Dizer "62%"
 * sem dizer isso é prometer precisão que o dado ainda não tem.
 */
export function frasePanorama(r: ResumoNotas | null): string {
  if (!r) return "";
  const { exigivel_valor, cobertura_valor, nao_verificado_valor } = r.meta;
  if (!exigivel_valor) return "Nenhuma despesa que exige nota neste período.";
  if (cobertura_valor === null) return "Ainda não há leitura do ERP para este período.";

  const base = `${pctStr(cobertura_valor)} de ${brlStr(exigivel_valor)} com nota confirmada no Omie`;
  if (nao_verificado_valor > 0) {
    const falta = (100 * nao_verificado_valor) / exigivel_valor;
    return `${base} — e ${pctStr(falta)} ainda não foi verificado, então este número é um piso.`;
  }
  return `${base}. Todo o período foi verificado contra o ERP.`;
}

/**
 * Quanto da barra cada estado ocupa. Devolve percentuais que somam 100 (ou zeros).
 * Usada na barra do mês e na do total — a mesma conta nos dois lugares.
 */
export function fatias(v: {
  com_nota: number; pronta: number; sem_nota: number; nao_verificado: number; total: number;
}): { com_nota: number; pronta: number; sem_nota: number; nao_verificado: number } {
  const t = v.total || 0;
  if (t <= 0) return { com_nota: 0, pronta: 0, sem_nota: 0, nao_verificado: 0 };
  const p = (n: number) => (100 * (n || 0)) / t;
  return {
    com_nota: p(v.com_nota),
    pronta: p(v.pronta),
    sem_nota: p(v.sem_nota),
    nao_verificado: p(v.nao_verificado),
  };
}

/**
 * As categorias que mais devem nota, já filtradas do ruído.
 *
 * Categoria com um título de R$ 12 e cobertura 0% não é o problema de ninguém;
 * ordenar por PERCENTUAL faria ela liderar a lista. Ordena-se por valor faltante,
 * que é o que responde "onde vale a pena gastar a próxima hora de cobrança".
 */
export function categoriasCriticas(r: ResumoNotas | null, minimo = 0): ResumoNotas["categorias"] {
  if (!r) return [];
  return r.categorias
    .filter((c) => c.valor_faltante > minimo)
    .sort((a, b) => b.valor_faltante - a.valor_faltante);
}

/** O período padrão da tela: os últimos `meses` meses fechados + o corrente. */
export function periodoPadrao(hoje = new Date(), meses = 6): { de: string; ate: string } {
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0));
  const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - (meses - 1), 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { de: iso(ini), ate: iso(fim) };
}
