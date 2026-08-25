/**
 * Cartão → Omie: a chave do envio e o payload do título.
 *
 * Mora em `_shared` porque quem escreve no Omie é a Edge Function (Deno) e quem
 * decide se o botão aparece é a tela (Vite). Um módulo só, importado dos dois
 * lados — a alternativa era duplicar a chave e descobrir na pior hora que as
 * duas cópias discordavam.
 *
 * ------------------------------------------------------------------
 * A CHAVE
 * ------------------------------------------------------------------
 * Enquanto `ENVIO_AO_OMIE_LIBERADO` for `false`, o Hub não cria nada no ERP. A
 * garantia não é a constante — é o teste que anda com ela
 * (`src/lib/cartao/envio.test.ts`): ele varre o repo e REPROVA se aparecer
 * código capaz de criar conta a pagar no Omie fora dos dois arquivos
 * autorizados. Ligada, ele exige o contrário: que o caminho de escrita exista e
 * passe por aqui.
 *
 * Uma flag no banco ou em variável de ambiente poderia ser virada por engano, de
 * madrugada, no meio de um fechamento. Esta só vira num commit — com diff, com
 * autor e com o teste sendo alterado junto, de propósito.
 *
 * LIGADA EM 24/08/2026, por autorização direta. As faturas até ago/26
 * continuam bloqueadas pelo marco (abaixo) e pelo trigger no banco: as duas
 * travas são independentes de propósito.
 */
export const ENVIO_AO_OMIE_LIBERADO = true;

/** O que a tela diz enquanto o envio está desligado. `null` quando liberado. */
export function bloqueioDeEnvio(): string | null {
  return ENVIO_AO_OMIE_LIBERADO
    ? null
    : "O envio ao Omie está desligado. Esta tela confere a fatura e mostra o que seria "
      + "lançado; nada é criado no ERP. A liberação é feita no código, não por aqui.";
}

/* ------------------------------------------------------------------
 * O marco
 * ------------------------------------------------------------------ */

/**
 * Até esta competência, as faturas foram lançadas no Omie FORA do Hub.
 *
 * Espelha o marco do trigger `cartao_faturas_marco`
 * (`20260806120000_cartao_provisionamento.sql`). Está duplicado de propósito: o
 * banco é quem trava de verdade, e esta cópia serve para a tela explicar o
 * motivo antes de a pessoa tentar — e para a Edge Function recusar sem precisar
 * consultar nada.
 */
export const MARCO_FORA_DO_HUB = "2026-08-01";

/* ------------------------------------------------------------------
 * Os códigos fixos do cartão no Omie
 * ------------------------------------------------------------------
 * Lidos do que a analista já lançou à mão (título 5504552123 e os 1.679 títulos
 * à vista do mesmo fornecedor). Constantes, e não configuração, porque um
 * cartão corporativo tem um fornecedor e uma conta corrente — trocar isso é
 * mudar a contabilidade da empresa, não ajustar uma tela.
 */

/** "Lancamento Fatura Cartao" — o fornecedor genérico de toda compra do cartão. */
export const FORNECEDOR_CARTAO = 5470888220;

/** Conta corrente do cartão Sicoob. */
export const CONTA_CORRENTE_CARTAO = 5470793236;

/** Tipo de documento "Outros" — é o que os títulos de cartão já usam. */
export const TIPO_DOCUMENTO_CARTAO = "99999";

/* ------------------------------------------------------------------
 * Fatura de teste
 * ------------------------------------------------------------------ */

/**
 * Prefixo de FITID que marca uma fatura sintética.
 *
 * Não é uma flag no corpo do request de propósito: flag se esquece de mandar e
 * se manda errado. O prefixo vem DENTRO do arquivo, atravessa o parser, a
 * separação e o payload sem ninguém precisar lembrar dele, e ainda deixa o
 * rastro visível no `codigo_lancamento_integracao` do Omie
 * ("CARTAO-TESTEHUB0001-01"), que é por onde a limpeza acha o que apagar.
 */
export const PREFIXO_TESTE = "TESTEHUB";

export const ehTeste = (fitid: string): boolean =>
  String(fitid ?? "").toUpperCase().startsWith(PREFIXO_TESTE);

/** `codigo_lancamento_integracao` do Omie. Único por PARCELA, não por compra. */
export const integracaoDe = (fitid: string, parcela: number): string =>
  `CARTAO-${fitid}-${String(parcela).padStart(2, "0")}`;

/* ------------------------------------------------------------------
 * O título
 * ------------------------------------------------------------------ */

/** Um título a criar — o que a tela manda, já conferido por quem operou. */
export type TituloParaOmie = {
  /** Id do OFX. Mesmo em todas as parcelas da compra (o Sicoob reusa). */
  fitid: string;
  /** `codigo_lancamento_integracao`: a trava de idempotência no Omie. */
  integracao: string;
  /**
   * Data ORIGINAL da compra — ela vira `data_entrada`, que o Omie devolve como
   * `dDtRegistro`, que é o campo de onde o `omie-sync` tira a competência da
   * DRE. Ver a nota em `montarTitulo`.
   */
  dataCompra: string;                   // 'YYYY-MM-DD'
  vencimento: string;                   // 'YYYY-MM-DD'
  /** 1º dia da fatura em que esta parcela cai. Registro do Hub, não vai ao Omie. */
  competencia: string;                  // 'YYYY-MM-01'
  valor: number;
  parcela: { n: number; de: number } | null;
  codigoCategoria: string;
  descricaoCategoria?: string | null;
  estabelecimento: string;
  chave: string;
  /** MEMO cru da fatura. É ele que vai para a observação do título. */
  memo: string;
};

/** '2026-11-30' → '30/11/2026' (o Omie só aceita assim). */
export const dataBR = (iso: string): string => {
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/** "003/012". À vista não manda parcela nenhuma — é o que a prática já faz. */
const numeroParcela = (p: { n: number; de: number } | null): string | null =>
  p ? `${String(p.n).padStart(3, "0")}/${String(p.de).padStart(3, "0")}` : null;

/**
 * O `param` do `IncluirContaPagar`.
 *
 * ESPELHA CAMPO A CAMPO um título de cartão lançado à mão (5504552123, lido no
 * Omie em 24/08/2026). Não é invenção: é a mesma ficha que a analista preenche,
 * escrita por código.
 *
 *   codigo_cliente_fornecedor  5470888220  "Lancamento Fatura Cartao"
 *   id_conta_corrente          5470793236
 *   codigo_tipo_documento      99999
 *   observacao                 o MEMO cru da fatura, verbatim
 *   data_entrada               31/07/2026  ← data da COMPRA
 *   data_emissao               idem
 *   data_vencimento/previsao   11/10/2026  ← vencimento DESTA parcela
 *   numero_parcela             003/003
 *
 * A ÂNCORA CONTÁBIL É `data_entrada`, e ela é a data da COMPRA em todas as
 * parcelas — não o mês em que a parcela vence. Conferido nos títulos reais: os
 * 47 lançamentos com `dDtRegistro` = 31/07/2026 têm vencimento de 11/08/2026 a
 * 11/01/2027. Ou seja, uma compra em 12× reconhece o valor cheio na DRE do mês
 * da compra, e só o vencimento anda. É a prática que está no Omie desde sempre;
 * espalhar a competência por parcela criaria um degrau entre set/26 e tudo o
 * que veio antes.
 *
 * A observação leva o MEMO cru porque é dele que a DRE tira o lojista (a fila
 * `omie_titulo_texto` lê exatamente este campo). O título é do fornecedor
 * genérico do cartão; sem a observação, "quem recebeu" se perde.
 */
export function montarTitulo(t: TituloParaOmie): Record<string, unknown> {
  const marca = ehTeste(t.fitid) ? "[TESTE HUB] " : "";
  const param: Record<string, unknown> = {
    codigo_lancamento_integracao: t.integracao,
    codigo_cliente_fornecedor: FORNECEDOR_CARTAO,
    id_conta_corrente: CONTA_CORRENTE_CARTAO,
    codigo_tipo_documento: TIPO_DOCUMENTO_CARTAO,
    codigo_categoria: t.codigoCategoria,
    valor_documento: Number(t.valor.toFixed(2)),
    data_vencimento: dataBR(t.vencimento),
    data_previsao: dataBR(t.vencimento),
    data_emissao: dataBR(t.dataCompra),
    data_entrada: dataBR(t.dataCompra),
    // 240 é o limite do campo no Omie; o MEMO cabe folgado, a marca de teste
    // também, mas cortar aqui é mais barato que descobrir o limite em produção.
    observacao: `${marca}${t.memo.trim()}`.slice(0, 240),
  };
  const parc = numeroParcela(t.parcela);
  if (parc) param.numero_parcela = parc;
  // O documento fica vazio nos títulos reais (é o que a prática faz); na fatura
  // sintética ele é mais um lugar onde "isto é teste" está escrito.
  if (marca) param.numero_documento = "TESTE-HUB";
  return param;
}

/* ------------------------------------------------------------------
 * As recusas
 * ------------------------------------------------------------------ */

export type EstadoDaFatura = "pendente" | "fora_do_hub" | "enviado" | null;

/**
 * Por que este envio não pode acontecer — `null` quando pode.
 *
 * Pura de propósito: é a MESMA função que desabilita o botão na tela e que
 * recusa o request na Edge Function. Duas checagens escritas separadamente
 * divergem, e a que diverge para o lado permissivo duplica um mês de despesa.
 */
export function recusaDoEnvio(opts: {
  competencia: string;
  estadoDaFatura: EstadoDaFatura;
  titulos: { codigoCategoria?: string | null }[];
}): string | null {
  const bloqueio = bloqueioDeEnvio();
  if (bloqueio) return bloqueio;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.competencia)) {
    return "Competência da fatura não definida.";
  }
  if (opts.competencia <= MARCO_FORA_DO_HUB) {
    return `Faturas até ${MARCO_FORA_DO_HUB.slice(0, 7)} foram lançadas no Omie à mão, antes de o Hub existir. `
      + "Reenviar duplicaria a despesa do mês inteiro.";
  }
  if (opts.estadoDaFatura === "fora_do_hub") {
    return "Esta fatura está marcada como lançada fora do Hub.";
  }
  if (opts.estadoDaFatura === "enviado") {
    return "Esta fatura já foi enviada ao Omie pelo Hub.";
  }
  if (!opts.titulos.length) {
    return "Não há título a enviar nesta fatura.";
  }
  const semCategoria = opts.titulos.filter((t) => !String(t.codigoCategoria ?? "").trim()).length;
  if (semCategoria) {
    return `${semCategoria} título(s) ainda sem categoria do Omie. Defina a categoria de todo lojista antes de enviar.`;
  }
  return null;
}
