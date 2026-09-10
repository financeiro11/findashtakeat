/* ============================================================================
 * O extrato do Asaas virando lançamento de conta corrente no Omie.
 *
 * O PROBLEMA. A conta "ASAAS Disponível" (nCodCC 5460455582) existe no Omie e
 * nunca teve UM lançamento — nem título, nem movimento. O saldo que o painel de
 * caixa mostra para ela é emprestado: `omie-caixa-sync` sobrescreve o número do
 * ERP pelo `/finance/balance` da API do Asaas, justamente porque não há extrato
 * embaixo. Enquanto isso o Hub tem o extrato inteiro em `asaas_extrato`.
 *
 * POR QUE RESUMO DIÁRIO, E NÃO LINHA A LINHA. Cada taxa e cada split do Asaas é
 * uma linha: agosto/26 teve 7.948 delas. Agrupadas por dia e natureza viram
 * 149 lançamentos no mês (~5/dia) — o saldo fecha exatamente igual, o razão do
 * Omie continua legível, e o detalhe fica no Hub, onde já está e onde já há
 * tela para ele. Decisão do financeiro em 10/09/2026.
 *
 * AS CATEGORIAS SÃO ESCOLHIDAS PARA NÃO MEXER NA RECEITA. Hoje a receita entra
 * no Omie por dois caminhos que já se sobrepõem (o consolidado mensal lançado à
 * mão e os títulos que a emissão de NFS-e cria). Este extrato é a TERCEIRA
 * leitura do mesmo dinheiro, e por isso entra em categoria neutra:
 *
 *   • recebimentos e estornos → o par `1.04.94` / `2.10.96` ("Transferência de
 *     Entrada" e "Transferência de Saída"). São categorias DO USUÁRIO, e o
 *     `omie-caixa-sync` já conhece como transferência (CATEGORIAS_TRANSFERENCIA)
 *     e que NÃO estão no `omie_dre_mapa` — logo não criam rubrica nem somam na
 *     DRE. Não usar o par nativo `0.01.01`/`0.01.02`: aqueles são `nao_exibir:S`
 *     e `transferencia:S`, isto é, a máquina de transferência do próprio Omie.
 *
 *   • as taxas → as categorias REAIS (`2.01.03` Meios de Pagamento, `2.01.92`
 *     Cobrança Clientes, `2.01.93` Emissão NF). Essas três estão no de-para e
 *     apontam para a rubrica "Meios de Pagamento" — a única linha da DRE que o
 *     Omie legitimamente não tinha, porque a taxa do Asaas é descontada na
 *     liquidação e nunca vira conta a pagar. Com o extrato dentro do ERP, ela
 *     passa a nascer da fonte, e o remendo diário de
 *     `demonstracoes-meios-pagamento` pode ser aposentado.
 *
 * ESTA CLASSIFICAÇÃO TEM DUAS GÊMEAS. `src/lib/extratoAsaas.ts` pinta o painel
 * da conta corrente e a RPC `asaas_taxas_mes` soma a linha da DRE. As três leem
 * a MESMA frase do Asaas, pelo MESMO começo. `src/lib/extratoOmie.test.ts`
 * quebra se esta aqui divergir da do painel — taxa nova, ou frase que o Asaas
 * mudar, se conserta nas três pontas ou em nenhuma.
 * ========================================================================== */

/** Conta "ASAAS Disponível" no plano de contas do Omie. */
export const NCODCC_ASAAS_DISPONIVEL = "5460455582";

/**
 * Conta "ASAAS Pago" — onde o financeiro lança à mão o título consolidado do
 * mês. Não é conta bancária: no Asaas existe UMA conta, e é a Disponível.
 */
export const NCODCC_ASAAS_PAGO = "5471927663";

/** Par neutro (do usuário, fora do de-para da DRE). Ver cabeçalho. */
export const CATEGORIA_ENTRADA = "1.04.94";
export const CATEGORIA_SAIDA = "2.10.96";

export type Natureza =
  | "recebimento"
  | "taxa_meios"
  | "taxa_cobranca"
  | "taxa_nf"
  | "transferencia"
  | "estorno"
  | "outros"
  /** A perna na "ASAAS Pago" do que entrou na Disponível. Ver `contrapartidasNoPago`. */
  | "saida_pago";

/** Sigla do `cCodIntLanc`. Três letras porque o campo tem teto de 20 caracteres. */
export const SIGLA: Record<Natureza, string> = {
  recebimento: "REC",
  taxa_meios: "TXM",
  taxa_cobranca: "TXC",
  taxa_nf: "TXN",
  transferencia: "TRF",
  estorno: "EST",
  outros: "OUT",
  saida_pago: "SPG",
};

export const ROTULO: Record<Natureza, string> = {
  recebimento: "Recebimentos de cobranças",
  taxa_meios: "Taxas de meios de pagamento",
  taxa_cobranca: "Taxas de cobrança ao cliente",
  taxa_nf: "Taxas de emissão de NF",
  transferencia: "Transferência para conta bancária",
  estorno: "Estornos e chargebacks",
  outros: "Outros lançamentos",
  saida_pago: "Crédito na conta Asaas (saída do faturado)",
};

/**
 * Categoria fixa da natureza. As que faltam (recebimento, transferência,
 * estorno, outros) escolhem pelo SINAL do líquido do dia — ver `categoriaDe`.
 */
const CATEGORIA_FIXA: Partial<Record<Natureza, string>> = {
  taxa_meios: "2.01.03",
  taxa_cobranca: "2.01.92",
  taxa_nf: "2.01.93",
};

/** Cópia de `src/lib/normalize.ts` — o Deno não enxerga `src/`. */
function normalize(s: string): string {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A natureza sai do COMEÇO da frase, nunca de "contém" — a frase do Asaas é
 * gerada por evento e começa sempre pelo tipo. Ler por "contém" já custou caro
 * duas vezes: a varrida de saldo para o banco ("Transação via Pix com chave
 * para TAKEAT…") entrava como taxa do Pix, e `includes("nf")` casava dentro de
 * "co**nf**eitaria". O `TAXA` solto no fim é de propósito: tipo de taxa novo
 * cai em "meios de pagamento" e continua somando, em vez de sumir da conta.
 */
export function classificar(historico: string | null | undefined): Natureza {
  const s = normalize(historico ?? "");
  const comeca = (...p: string[]) => p.some((x) => s.startsWith(x));

  /* "Estorno da taxa de cartão" é um CRÉDITO que devolve uma taxa já cobrada.
     Ele volta para o balde da própria taxa, e não para "estornos", porque é lá
     que precisa abater — o líquido do dia já sai certo, sem conta à parte. */
  if (comeca("ESTORNO DA TAXA")) return classificar(s.replace(/^ESTORNO DA /, ""));

  if (comeca("COBRANCA RECEBIDA", "RECEBIMENTO DA COBRANCA")) return "recebimento";

  if (comeca("TAXA DE MENSAGERIA")) return "taxa_cobranca";
  if (comeca("TAXA DE NOTIFICACAO POR WHATSAPP", "TAXA DE NOTIFICACAO VIA WHATSAPP")) return "taxa_cobranca";
  if (comeca("TAXA DE EMISSAO DA NOTA FISCAL", "TAXA DE EMISSAO DE NOTA FISCAL")) return "taxa_nf";
  if (comeca("TAXA")) return "taxa_meios";

  if (comeca("TRANSACAO VIA PIX", "TRANSACAO VIA TED", "TRANSFERENCIA", "SAQUE")) return "transferencia";

  // Chargeback e estorno saem no mesmo balde: os dois são dinheiro voltando ao
  // cliente, e o Omie não tem categoria que os separe.
  if (s.includes("CHARGEBACK") || comeca("ESTORNO")) return "estorno";
  return "outros";
}

export type LinhaExtrato = {
  id_transacao: string;
  /** 'YYYY-MM-DD' */
  data_movimento: string;
  /** 'credito' | 'debito' */
  tipo: string | null;
  /** Sempre positivo no espelho; o sinal está em `tipo`. */
  valor: number | string | null;
  historico: string | null;
};

export type LancamentoDiario = {
  /** 'YYYY-MM-DD' */
  dia: string;
  natureza: Natureza;
  /** Chave de idempotência no Omie: 'ASAAS-20260903-TXM' (18 caracteres). */
  cod_int_lanc: string;
  categoria: string;
  /** LÍQUIDO do dia, ASSINADO: positivo entra na conta, negativo sai. */
  valor: number;
  entradas: number;
  saidas: number;
  /** Quantas linhas do extrato do Asaas foram resumidas nesta. */
  lancamentos: number;
  observacao: string;
  /** Conta do Omie. Ausente = "ASAAS Disponível", que é o extrato propriamente dito. */
  ncodcc?: string;
};

const ehCredito = (tipo: string | null | undefined): boolean =>
  normalize(tipo ?? "").startsWith("CRED");

const cent = (n: number) => Math.round(n * 100) / 100;

/** '2026-09-03' → '20260903'. */
export const compacta = (dia: string) => String(dia ?? "").slice(0, 10).replace(/-/g, "");

/** '2026-09-03' → '03/09/2026', que é como o Omie lê data. */
export const dataOmie = (dia: string) => {
  const d = String(dia ?? "").slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
};

export const codIntLanc = (dia: string, natureza: Natureza) =>
  `ASAAS-${compacta(dia)}-${SIGLA[natureza]}`;

/**
 * Categoria do lançamento — e, por tabela, a DIREÇÃO dele.
 *
 * ISTO NÃO É DETALHE DE ESTILO. Sondado contra lançamentos reais do Omie em
 * 10/09/2026: `nValorLanc` vai SEMPRE POSITIVO, tanto na entrada quanto na
 * saída (um resgate de RDC de R$ 160.255,90 chega como `nValorLanc: 160255.9`,
 * `cCodCateg: "0.01.02"`, `cNatureza: "P"`). Quem diz se o dinheiro entra ou
 * sai é a CATEGORIA — `conta_receita` contra `conta_despesa` no plano de contas
 * — e o `cNatureza` da resposta é consequência, não entrada. Mandar valor
 * negativo achando que inverte o lançamento é o erro que viraria o saldo da
 * conta de cabeça para baixo sem uma única mensagem de erro.
 *
 * Daí a taxa que fecha o dia CREDORA (estorno maior que a taxa cobrada) sair
 * pela categoria de entrada, e não pela categoria de taxa: a direção certa vale
 * mais que a pureza da rubrica, e o caso é de centavos — em agosto/26 foram
 * R$ 101,80 de estorno de taxa contra R$ 21.114,66 cobrados. O preview marca
 * quando acontece.
 */
export function categoriaDe(natureza: Natureza, valor: number): string {
  if (valor >= 0) return CATEGORIA_ENTRADA;
  return CATEGORIA_FIXA[natureza] ?? CATEGORIA_SAIDA;
}

/**
 * Resume o extrato em um lançamento por (dia × natureza), com o valor LÍQUIDO.
 *
 * Líquido, e não duas linhas, porque é o líquido que move o saldo: num dia com
 * R$ 3.412 de taxa e R$ 12 de estorno de taxa, o que saiu da conta foram
 * R$ 3.400. Dia cujo líquido dá exatamente zero não vira lançamento — não há o
 * que registrar, e um lançamento de zero só sujaria o razão.
 */
export function agruparPorDia(linhas: LinhaExtrato[]): LancamentoDiario[] {
  type Balde = { entradas: number; saidas: number; lancamentos: number };
  const baldes = new Map<string, Balde>();

  for (const l of linhas) {
    const dia = String(l.data_movimento ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
    const v = Math.abs(Number(l.valor) || 0);
    if (!v) continue;

    const natureza = classificar(l.historico);
    const chave = `${dia}|${natureza}`;
    const b = baldes.get(chave) ?? { entradas: 0, saidas: 0, lancamentos: 0 };
    if (ehCredito(l.tipo)) b.entradas += v;
    else b.saidas += v;
    b.lancamentos++;
    baldes.set(chave, b);
  }

  const out: LancamentoDiario[] = [];
  for (const [chave, b] of baldes) {
    const [dia, nat] = chave.split("|");
    const natureza = nat as Natureza;
    const valor = cent(b.entradas - b.saidas);
    if (valor === 0) continue;

    out.push({
      dia,
      natureza,
      cod_int_lanc: codIntLanc(dia, natureza),
      categoria: categoriaDe(natureza, valor),
      valor,
      entradas: cent(b.entradas),
      saidas: cent(b.saidas),
      lancamentos: b.lancamentos,
      /* Nem "›" nem ">". Medido em 10/09/2026 contra o ERP: o Omie APAGA o "›"
         (sobra espaço duplo) e devolve o ">" como `&gt;`, escapado. O "·" e a
         vírgula passam intactos. Os 207 lançamentos da carga inicial ficaram com
         o `&gt;` na observação — é feio e é só isso, não vale 207 AlterarLancCC. */
      observacao: `Asaas · ${ROTULO[natureza]} · ${b.lancamentos} `
        + `${b.lancamentos === 1 ? "lançamento" : "lançamentos"} do dia, líquido. `
        + `Detalhe no Hub, em Caixa, aba Conta Corrente, Asaas.`,
    });
  }

  // Ordem estável: por dia e, dentro do dia, pela sigla. O relatório do preview
  // e a fila de envio precisam sair sempre iguais para dar para comparar.
  return out.sort((a, b) =>
    a.dia === b.dia ? SIGLA[a.natureza].localeCompare(SIGLA[b.natureza]) : a.dia.localeCompare(b.dia));
}

/* ==========================================================================
 * LINHA A LINHA — a exigência da contabilidade.
 *
 * 10/09/2026, Alessandra Azevedo (Hult): "os lançamentos no Omie devem ser um
 * espelho do Asaas... todas as movimentações lançadas no Asaas também devem
 * constar no Omie, com os mesmos valores e informações". O resumo diário
 * (`agruparPorDia`) deixa de bastar: cada linha do extrato vira um lançamento.
 *
 * A chave de integração é o **`id_transacao` do próprio Asaas** (`ftn_...`, 16
 * caracteres, cabe nos 20 do `cCodIntLanc`). Não é só conveniente: é a única
 * chave que sobrevive a qualquer reprocessamento, porque nasce do outro lado.
 *
 * O `cObs` leva o histórico ORIGINAL, sem reescrita — é o "com as mesmas
 * informações" do pedido, e é o que permite alguém no ERP achar a fatura.
 *
 * A categoria sai da mesma escada de sempre (`classificar` + `categoriaDe`), a
 * mesma do resumo diário e a mesma do painel: taxa vai na categoria real, o
 * resto no par neutro. Uma régua só para as três leituras.
 * ========================================================================== */

export type LancamentoLinha = {
  /** `cCodIntLanc` no Omie e chave primária aqui. */
  id_transacao: string;
  /** 'YYYY-MM-DD' */
  dia: string;
  natureza: Natureza;
  categoria: string;
  /** ASSINADO: positivo entra na conta, negativo sai. */
  valor: number;
  /** O histórico do Asaas, como ele veio. */
  observacao: string;
};

/** Teto do `cObs` — o Omie não documenta limite, e frase gigante não ajuda ninguém. */
const OBS_MAX = 300;

/**
 * Uma linha do extrato → um lançamento do Omie. Linha sem id, sem data válida
 * ou de valor zero fica de fora: não há o que espelhar, e um lançamento de zero
 * só sujaria o razão que a contabilidade vai ler.
 */
export function linhasParaOmie(linhas: LinhaExtrato[]): LancamentoLinha[] {
  const out: LancamentoLinha[] = [];
  for (const l of linhas) {
    const id = String(l.id_transacao ?? "").trim();
    const dia = String(l.data_movimento ?? "").slice(0, 10);
    const bruto = Math.abs(Number(l.valor) || 0);
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(dia) || !bruto) continue;

    const natureza = classificar(l.historico);
    const valor = cent(ehCredito(l.tipo) ? bruto : -bruto);
    out.push({
      id_transacao: id,
      dia,
      natureza,
      categoria: categoriaDe(natureza, valor),
      valor,
      observacao: String(l.historico ?? ROTULO[natureza]).slice(0, OBS_MAX),
    });
  }
  // Ordem estável: por dia e, dentro do dia, pelo id — a fila de envio e o
  // relatório precisam sair sempre iguais para dar para comparar duas rodadas.
  return out.sort((a, b) =>
    a.dia === b.dia ? a.id_transacao.localeCompare(b.id_transacao) : a.dia.localeCompare(b.dia));
}

/** Soma assinada do que o Asaas movimentou — é o que o saldo do Omie tem de andar. */
export const liquidoDe = (ls: LancamentoDiario[]): number =>
  cent(ls.reduce((s, l) => s + l.valor, 0));

/**
 * A PERNA QUE FALTAVA: o que entra na "ASAAS Disponível" sai da "ASAAS Pago".
 *
 * A `ASAAS Pago` recebe o título consolidado que o financeiro lança à mão todo
 * mês e nunca teve saída nenhuma — no ERP ela acumulava quase seis milhões que
 * não existem, porque o dinheiro real já tinha ido para o Sicoob. É o mesmo
 * dinheiro andando de "faturado" para "disponível", e o extrato sabe o dia
 * exato de cada travessia: é o recebimento de cobrança.
 *
 * Com a perna, o saldo da conta passa a significar **faturado que ainda não
 * caiu** — conferido em 10/09/2026 contra o próprio Asaas: resíduo de
 * R$ 728.793,15 contra R$ 756.911,66 de confirmado-não-creditado mais
 * vencido-não-pago, 3,7% de folga.
 *
 * Só o RECEBIMENTO gera contrapartida. Taxa, transferência para o banco e
 * estorno acontecem depois que o dinheiro já está disponível — dar perna a eles
 * mexeria no faturado por um evento que não é faturamento.
 */
export function contrapartidasNoPago(ls: LancamentoDiario[]): LancamentoDiario[] {
  return ls
    .filter((l) => l.natureza === "recebimento" && l.valor > 0)
    .map((l) => ({
      dia: l.dia,
      natureza: "saida_pago" as Natureza,
      cod_int_lanc: codIntLanc(l.dia, "saida_pago"),
      // Sai da conta: categoria de despesa, que é o que dá a direção no Omie.
      categoria: CATEGORIA_SAIDA,
      valor: -l.valor,
      entradas: 0,
      saidas: l.valor,
      lancamentos: l.lancamentos,
      ncodcc: NCODCC_ASAAS_PAGO,
      observacao: `Asaas · Crédito na conta Asaas · ${l.lancamentos} `
        + `${l.lancamentos === 1 ? "cobrança recebida" : "cobranças recebidas"} do dia. `
        + `Contrapartida do que entrou na ASAAS Disponível; o que fica aqui é o faturado ainda não creditado.`,
    }));
}
