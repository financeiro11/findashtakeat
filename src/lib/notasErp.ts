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

import { lerGastoDeCartao } from "@/lib/observacaoTitulo";

export type SituacaoTitulo =
  | "com_nota"
  | "comprovante_aceito"
  | "so_comprovante"
  | "anexo_suspeito"
  | "pronta_para_enviar"
  | "espera_confirmacao"
  | "enviado_aguardando"
  | "sem_nota"
  | "erro_leitura"
  | "nao_verificado"
  | "dispensa"
  | "conferir";

/**
 * O QUE ESTÁ PENDURADO NO TÍTULO, na resposta do banco.
 *
 * `indefinido` é o estado mais comum hoje e não é falha: dos 758 títulos com
 * anexo no ERP, 702 nunca foram lidos por dentro. A varredura de triagem os
 * resolve com o tempo, e até lá eles contam como antes — transformar "não sei"
 * em "não tem" faria centenas de títulos saírem do verde por uma mudança de
 * leitura, não de fato.
 */
export type DocumentoClasse = "nota" | "comprovante" | "nao_documento" | "indefinido";

/**
 * A ordem de cobrança. NÃO dispensa nada — tudo continua exigindo nota; o que
 * muda é por onde se começa. Os cortes são decisão do financeiro (25/08/2026):
 * abaixo de R$ 150 irrelevante, até 500 médio, até 1.000 grave, acima urgente.
 */
export type Gravidade = "urgente" | "grave" | "medio" | "irrelevante";

export type Regra = "exige" | "dispensa" | "conferir";

export type LinhaTitulo = {
  cod_titulo: number;
  /** o nome que vai para a tela: apelido da Parametrização quando existe */
  favorecido: string;
  /** a razão social como o Omie a escreve — é ela que se procura no ERP */
  favorecido_cru: string;
  tem_apelido: boolean;
  /** a observação crua do título; é onde mora o lojista, no gasto de cartão */
  observacao: string | null;
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
  /** O que o Hub sabe que está pendurado: nota, comprovante, nao_documento… */
  documento_classe: DocumentoClasse | null;
  /** `false` quando o fornecedor está no cadastro de quem não emite NF. */
  fornecedor_emite_nf: boolean | null;
  /** O tipo que a IA leu no papel — "recibo", "boleto", "cupom_fiscal". */
  anexo_tipo_lido: string | null;
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
    /* Quanto do que falta é gasto de cartão. Continua no denominador da
       cobertura; sai só da lista de fornecedores, porque não se cobra nota de
       um CNPJ que é o balde da fatura — cobra-se de quem gastou. */
    cartao_titulos: number;
    cartao_valor: number;
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

/**
 * AS OPÇÕES DE CADA FILTRO DE COLUNA, e por que elas não saem do resultado.
 *
 * Vêm de `cap_notas_facetas`, que lê o PERÍODO INTEIRO — não o recorte já
 * filtrado. Se saíssem do resultado corrente, marcar "Softwares" apagaria todas
 * as outras categorias da lista e não haveria como trocar de ideia sem limpar o
 * filtro: um filtro que se fecha sozinho.
 *
 * `valor` é o código (`categoria_codigo`, `conta_codigo`), `rotulo` é o nome que
 * se lê. O corte é pelo código porque o nome da conta vem do cadastro do Omie e
 * muda quando alguém a renomeia lá.
 */
export type OpcaoFaceta = { valor: string; rotulo: string; titulos: number };

export type FacetasNotas = {
  categorias: OpcaoFaceta[];
  contas: OpcaoFaceta[];
  /** Só os meses que a lista realmente toca — mês vazio é um clique em branco. */
  meses: string[];
  valor: { min: number; max: number };
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
  /* OS DOIS ESTADOS DE COMPROVANTE, e a diferença entre eles é quem emitiu.
     Onde o fornecedor não emite nota, o recibo É o documento e o título está
     resolvido; onde ele emite, o recibo prova o gasto e não substitui a nota. */
  comprovante_aceito: {
    rotulo: "Recibo aceito", tom: "ok",
    ajuda: "Este fornecedor não emite nota fiscal — Uber, 99, fornecedor de fora — e o recibo dele É o documento. Conta como coberto, e não há o que cobrar. A lista de quem não emite fica em Configurações e você pode editá-la.",
  },
  so_comprovante: {
    rotulo: "Só comprovante — falta a NF", tom: "atencao",
    ajuda: "Tem papel pendurado no título (recibo, boleto, comprovante de pagamento), e não é a nota fiscal. O gasto está provado, então não é vermelho; mas o fornecedor EMITE nota e ela ainda falta. Desde 31/08/2026 o próprio Hub pendura esse papel: boleto e recibo do acervo sobem ao Omie marcados como comprovante, em vez de ficarem parados esperando uma nota que talvez nunca venha. Quando ela chegar, entra neste mesmo título — o Hub avisa que se resolveu.",
  },
  pronta_para_enviar: {
    rotulo: "Pronta para subir", tom: "atencao",
    ajuda: "O Hub TEM o arquivo da nota, o ERP não, e a linha já está NA FILA de envio. Não é tarefa de ninguém: a varredura roda a cada 7 ou 8 minutos e leva. Se uma linha ficar parada aqui, o motivo está em \"Falta um passo\". O que o Hub casou e ninguém enfileirou não entra neste estado — fica em \"Achada — falta você confirmar\".",
  },
  espera_confirmacao: {
    rotulo: "Achada — falta você confirmar", tom: "atencao",
    ajuda: "O Hub encontrou a nota e ligou a este título por evidência média — valor e data batem, mas o CNPJ não estava no papel para provar. Ela NÃO sobe sozinha: um clique em \"é esta\" a manda ao ERP. É o único estado em que a nota existe e está parada esperando gente.",
  },
  enviado_aguardando: {
    rotulo: "Subiu — conferindo no ERP", tom: "neutro",
    ajuda: "O Hub já mandou o arquivo e o Omie ainda não foi perguntado depois disso. Não conta como cobertura (só o ERP confirma) e não é tarefa de ninguém: a próxima varredura resolve.",
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
  "com_nota", "comprovante_aceito", "so_comprovante", "anexo_suspeito",
  "pronta_para_enviar", "espera_confirmacao", "enviado_aguardando",
  "sem_nota", "erro_leitura", "nao_verificado",
];

/**
 * As que contam como COBERTAS.
 *
 * `comprovante_aceito` entra porque ali o recibo é o documento que dá para ter —
 * e esta lista precisa ser a mesma régua que a `cap_notas_resumo` usa no banco.
 * Se as duas divergirem, o cartão de cima e a soma das linhas param de bater, e
 * ninguém consegue dizer qual dos dois está certo.
 */
export const SITUACOES_COBERTAS: SituacaoTitulo[] = ["com_nota", "comprovante_aceito"];

/**
 * O QUE UMA PESSOA PRECISA OLHAR — e é com isto que a aba Títulos nasce.
 *
 * `pronta_para_enviar` e `enviado_aguardando` saíram daqui em 26/08/2026. Os
 * dois são trabalho de máquina: o arquivo já está na mão do Hub e a varredura o
 * leva sozinha. Deixá-los no filtro inicial fazia a aba abrir com dezenas de
 * linhas que ninguém deveria tocar — e, pior, misturava as duas coisas: quem
 * clicava no cartão "Pronta para subir" caía numa lista majoritariamente de
 * "Sem nota", porque o cartão trocava de aba sem trocar o filtro.
 *
 * Continuam visíveis: como cartão no painel, como filtro que se pode marcar, e
 * em "Falta um passo" quando emperram.
 *
 * `espera_confirmacao` ENTRA aqui, e pelo motivo oposto ao dos dois de cima: a
 * nota existe, está na mão do Hub, e nenhuma varredura vai levá-la — ela espera
 * um clique de gente e mais nada. Deixá-la fora do filtro inicial seria a mesma
 * coisa que escondê-la para sempre.
 */
export const SITUACOES_FALTANDO: SituacaoTitulo[] = [
  "sem_nota", "anexo_suspeito", "espera_confirmacao", "so_comprovante",
];

/**
 * O que é nosso e anda sozinho — a fila de envio e a releitura do ERP. Existe
 * para a tela poder dizer "isto não é com você" numa frase só.
 */
export const SITUACOES_NOSSAS: SituacaoTitulo[] = ["pronta_para_enviar", "enviado_aguardando"];

/**
 * O corte escrito no botão da barra: "todas", o nome quando é um só, a contagem
 * quando são vários.
 *
 * Existe porque um botão que diz só "Situação" não informa nada — e o filtro de
 * situação NASCE LIGADO nesta tela (três das seis marcadas). Quem chega precisa
 * ler o recorte antes de ler a lista, senão conta linhas e acha que o número
 * encolheu sozinho.
 */
export function resumoDoCorte(
  marcados: readonly string[],
  rotuloDe: (v: string) => string,
  tudo: string,
  plural: string,
): string {
  if (!marcados.length) return tudo;
  if (marcados.length === 1) return rotuloDe(marcados[0]);
  return `${marcados.length} ${plural}`;
}

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
 * OS DOIS NÚMEROS DO CABEÇALHO — o que está resolvido e o que ao menos tem papel.
 *
 * `coberto` é a régua estrita, a mesma do banco (`SITUACOES_COBERTAS`): tem o
 * documento que dá para ter, e não há o que cobrar. É o número que manda.
 *
 * `com_documento` soma a esse o `so_comprovante` — o gasto que está PROVADO por
 * recibo, boleto ou comprovante de pagamento e cuja nota fiscal ainda falta.
 * Existe porque as duas perguntas são diferentes e as duas são feitas: "quanto
 * está em ordem no ERP?" e "de quanto eu não tenho papel nenhum?". Sem o segundo
 * número, o que falta de verdade (o vermelho) fica escondido atrás do que falta
 * de nota fiscal, e são coisas de tamanho bem diferente.
 *
 * O que NÃO entra, e por quê: `anexo_suspeito` tem arquivo pendurado, mas
 * ninguém sabe se é documento — contá-lo seria chamar de "provado" o que está
 * justamente na fila de alguém abrir. `pronta_para_enviar`, `enviado_aguardando`
 * e `espera_confirmacao` são notas na mão do HUB, não no ERP; entram na barra,
 * não neste par de números.
 *
 * O `coberto` sai daqui, e não de `val("com_nota")` como a tela fazia: desde que
 * o recibo aceito passou a contar (27/08/2026), o percentual vinha do banco com
 * os dois estados e o R$ logo abaixo dele mostrava só um — dois números do mesmo
 * cartão que não fechavam a divisão.
 */
export function coberturaEmValor(r: ResumoNotas | null): {
  coberto: number;
  so_comprovante: number;
  com_documento: number;
  pct_com_documento: number | null;
} {
  const vazio = { coberto: 0, so_comprovante: 0, com_documento: 0, pct_com_documento: null };
  if (!r) return vazio;

  const valorDe = (s: SituacaoTitulo) => r.situacoes.find((x) => x.situacao === s)?.valor ?? 0;
  const coberto = SITUACOES_COBERTAS.reduce((soma, s) => soma + valorDe(s), 0);
  const so_comprovante = valorDe("so_comprovante");
  const com_documento = coberto + so_comprovante;
  const base = r.meta.exigivel_valor;

  return {
    coberto, so_comprovante, com_documento,
    pct_com_documento: base > 0 ? (100 * com_documento) / base : null,
  };
}

/**
 * Quanto da barra cada estado ocupa. Devolve percentuais que somam 100 (ou zeros).
 * Usada na barra do mês e na do total — a mesma conta nos dois lugares.
 */
export function fatias(v: {
  com_nota: number; pronta: number; espera?: number; comprovante?: number;
  sem_nota: number; nao_verificado: number; total: number;
}): {
  com_nota: number; pronta: number; espera: number; comprovante: number;
  sem_nota: number; nao_verificado: number;
} {
  const t = v.total || 0;
  if (t <= 0) {
    return { com_nota: 0, pronta: 0, espera: 0, comprovante: 0, sem_nota: 0, nao_verificado: 0 };
  }
  const p = (n: number) => (100 * (n || 0)) / t;
  return {
    com_nota: p(v.com_nota),
    pronta: p(v.pronta),
    /* O GASTO ESTÁ PROVADO E A NOTA NÃO CHEGOU. Fatia própria porque não é
       nenhuma das outras duas coisas: no vermelho seria dizer que ninguém tem
       nada, e no verde seria dizer que está resolvido. */
    comprovante: p(v.comprovante ?? 0),
    /* Fatia própria porque é o único pedaço da barra que depende de uma PESSOA.
       Somada à amarela ("o Hub leva sozinho") ela ficaria escondida atrás de uma
       promessa que ninguém vai cumprir — a nota está achada e parada. */
    espera: p(v.espera ?? 0),
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

/**
 * O NOME QUE A LINHA MOSTRA — e por que ele não sai pronto do banco.
 *
 * O servidor já resolve o favorecido contra o cadastro do Omie e aplica o
 * apelido da Parametrização. Falta um caso, e é o mais comum da base: no cartão,
 * TODA linha chega como "Lancamento Fatura Cartao" e o lojista de verdade está
 * na observação, colado depois de um "|", com as MESMAS colunas posicionais do
 * OFX.
 *
 * Esse texto é lido aqui, e não no Postgres, de propósito: o repositório tem UM
 * parser de MEMO (`src/lib/cartao/ofx`, via `lerGastoDeCartao`), e um segundo
 * escrito em SQL faria esta tela e a do Cartão discordarem sobre o nome do mesmo
 * lojista. A trava do `ehCartao` vem junto — numa conta a pagar comum a
 * observação é o que o fornecedor escreveu ("Link para visualizar a NFS-e…"), e
 * lida como MEMO viraria um "estabelecimento" plausível e errado.
 *
 * O apelido é aplicado DE NOVO sobre o lojista extraído: "APPLE.COM/BILL" também
 * merece virar "Apple" se alguém cadastrou isso.
 */
export function nomeDaLinha(
  linha: Pick<LinhaTitulo, "favorecido" | "favorecido_cru" | "observacao" | "doc">,
  aplicarApelido: (nome: string, doc?: string | null) => string,
): { nome: string; cru: string; deCartao: boolean } {
  const cartao = lerGastoDeCartao(linha.favorecido_cru, linha.observacao);
  if (cartao?.estabelecimento) {
    return {
      nome: aplicarApelido(cartao.estabelecimento, null),
      cru: cartao.estabelecimento,
      deCartao: true,
    };
  }
  return { nome: linha.favorecido, cru: linha.favorecido_cru, deCartao: false };
}

/* ------------------------------ abrir o arquivo ------------------------------ */

/**
 * DE ONDE VEM O ARQUIVO DESTA LINHA — e por que a pergunta não é "qual botão".
 *
 * O arquivo mora em dois lugares e a pessoa não deveria ter de saber em qual:
 * se o Omie tem anexo, é ele que se abre (é o que está valendo no ERP); se não
 * tem e o Hub tem, abre-se o do Hub, que é o que vai subir. Quando não há
 * nenhum dos dois não há nada para ver — e é justamente esse o caso de "Sem
 * nota", em que o trabalho é cobrar, não conferir.
 */
export type OndeAbrir = "erp" | "hub" | null;

export function ondeAbrir(
  l: Pick<LinhaTitulo, "anexos_no_erp" | "nota_no_hub">,
): OndeAbrir {
  if ((l.anexos_no_erp ?? 0) > 0) return "erp";
  if (l.nota_no_hub) return "hub";
  return null;
}

/**
 * ONDE O HUB VIU A NOTA, dito em português.
 *
 * `nota_no_hub` é a coluna que a view monta com `string_agg` das fontes, e ela
 * chega crua: `acervo_a_confirmar`, `drive+cartao`. A tabela mostrava esse texto
 * do jeito que vinha, ao lado do clipe — cinco linhas escritas
 * "📎 acervo_a_confirmar" numa tela que o financeiro abre todo dia. Nome de
 * enum não é frase, e quem lê a tela não tem por que saber o que é um acervo.
 */
const FONTE_DA_NOTA: Record<string, string> = {
  acervo: "no acervo",
  acervo_a_confirmar: "no acervo",
  auditoria: "na auditoria",
  cartao: "na base do cartão",
  drive: "nas pastas do Drive",
  facilities: "no Facilities",
};

export function fonteDaNota(nota_no_hub: string | null): string | null {
  if (!nota_no_hub) return null;
  const partes = nota_no_hub.split("+").map((f) => FONTE_DA_NOTA[f]).filter(Boolean);
  // Fonte nova que ainda não tem tradução: melhor o nome cru do que nada.
  if (!partes.length) return nota_no_hub;
  return [...new Set(partes)].join(" e ");
}

/**
 * O endereço que dá para EMBUTIR — que não é sempre o que dá para abrir.
 *
 * O link do Drive que o Hub guarda é o `/view`, e ele recusa ser carregado
 * dentro de um iframe (X-Frame-Options): quem clicasse veria um quadro branco e
 * concluiria que o arquivo sumiu. O `/preview` é a mesma pasta, o mesmo arquivo
 * e a mesma permissão — só a versão que aceita moldura. Para abrir em nova aba
 * continua valendo o `/view`, que é o que a pessoa reconhece.
 */
export function urlParaEmbutir(url: string): string {
  const m = String(url ?? "").match(/^(https:\/\/drive\.google\.com\/file\/d\/[^/]+)\/(?:view|edit)\b/i);
  return m ? `${m[1]}/preview` : url;
}

/** O período padrão da tela: os últimos `meses` meses fechados + o corrente. */
export function periodoPadrao(hoje = new Date(), meses = 6): { de: string; ate: string } {
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0));
  const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - (meses - 1), 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { de: iso(ini), ate: iso(fim) };
}
