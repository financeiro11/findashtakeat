/**
 * O MEMO da fatura de cartão, lido — O ÚNICO leitor do repositório.
 *
 * POR QUE ESTE ARQUIVO MUDOU DE LUGAR. A leitura do MEMO nasceu dentro de
 * `src/lib/cartao/ofx.ts`, junto do parser do arquivo OFX, e o cabeçalho de
 * `src/lib/observacaoTitulo.ts` avisava com todas as letras: "o repositório tem
 * um só, de propósito, e duplicá-lo faria a auditoria e a tela do cartão
 * discordarem sobre o nome do mesmo lojista".
 *
 * Só que o mesmo MEMO precisa ser lido do OUTRO lado — numa Edge Function, para
 * escrever o nome do lojista de volta no Omie. Escrever um segundo leitor lá
 * seria exatamente o que aquele aviso proíbe. Então o leitor desceu para
 * `_shared/`, que é onde este repositório já põe o código que os dois runtimes
 * usam (mesmo desenho de `_shared/cartao-envio.ts`), e `src/lib/cartao/ofx.ts`
 * passou a importar daqui. Nada foi copiado: o arquivo do front reexporta.
 *
 * O QUE O MEMO É. Uma linha de colunas POSICIONAIS que o emissor monta:
 *
 *   OPENAI *CHATGPT SUBS  02/06  OPENAI.COM - R$ 525,00  U$ 102,79  V.DOL 5,1075
 *   |-------- 0..22 ------||-22..27--||------------ 30.. ---------------------|
 *        estabelecimento     parcela              cauda (cidade ou câmbio)
 *
 * As posições são o contrato, não a heurística: cortar por espaço partiria
 * "AMERICAN AIR" no meio e juntaria a cidade ao nome.
 */

/** Compra internacional: a cauda do MEMO traz o câmbio da operação. */
export type Exterior = {
  /** "ANTHROPIC.COM" — o domínio é o nome mais estável que a fatura oferece. */
  dominio: string;
  /** Valor original cobrado pelo lojista, como veio ("R$ 550,00", "US$ 29,00"). */
  originalTexto: string;
  valorUsd: number | null;
  cotacao: number | null;
};

export type Memo = {
  estabelecimento: string;
  parcela: { n: number; de: number } | null;
  cidade: string | null;
  exterior: Exterior | null;
};

/** "1.234,56" → 1234.56. Devolve null quando não é número. */
export function numeroBR(v: string): number | null {
  const limpo = v.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/* As colunas do MEMO. Ver o desenho no cabeçalho. */
export const COL_PARCELA = 22;
export const COL_CAUDA = 30;

const ehParcela = (s: string) => /^\d{2}\/\d{2}$/.test(s);

/**
 * Nome de exibição: tira o que a fatura acrescenta e o lojista não tem.
 *
 *  • `(3485)` — final do cartão, só aparece na anuidade.
 *  • O "V" final ("SENTRYV", "NineComercioV", "AMERICANAS SAV") é marcador do
 *    emissor, não do lojista: convivem "ANTHROPICV" e "ANTHROPIC" na mesma
 *    fatura. Só cai quando está grudado numa palavra de 2+ letras, para não
 *    comer o nome de quem realmente termina em V.
 */
export function limparNome(bruto: string): string {
  // O espaço em branco cai PRIMEIRO: o nome chega com o resto da coluna de 22
  // caracteres, e "MP*MERCADOLIVREV      " não casa com um `V$`.
  return bruto
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\(\d{4}\)$/, "")
    .replace(/(?<=[A-Za-z0-9]{2})V$/, "")
    .trim();
}

/** "ANTHROPIC.COM - R$ 550,00    U$ 109,35    V.DOL 5,0297" */
function lerExterior(cauda: string): Exterior | null {
  const m = cauda.match(
    /^(.+?)\s+-\s+((?:R\$|US\$|EUR|€)\s*[\d.,]+)\s+U\$\s*([\d.,]+)\s+V\.DOL\s*([\d.,]+)/i,
  );
  if (!m) return null;
  return {
    dominio: m[1].trim(),
    originalTexto: m[2].replace(/\s+/g, " ").trim(),
    valorUsd: numeroBR(m[3]),
    cotacao: numeroBR(m[4]),
  };
}

export function lerMemo(memo: string): Memo {
  const monta = (nomeBruto: string, cauda: string): Memo => {
    const exterior = cauda ? lerExterior(cauda) : null;
    return {
      estabelecimento: limparNome(nomeBruto),
      parcela: null,
      cidade: exterior ? null : (cauda.trim() || null),
      exterior,
    };
  };

  const naColuna = memo.slice(COL_PARCELA, COL_PARCELA + 5);

  // Caso normal: as colunas conferem (com parcela, ou com a faixa em branco).
  if (ehParcela(naColuna) || (memo.length > COL_CAUDA && /^\s+$/.test(memo.slice(COL_PARCELA, COL_CAUDA)))) {
    const r = monta(memo.slice(0, COL_PARCELA), memo.slice(COL_CAUDA));
    if (ehParcela(naColuna)) {
      const [n, de] = naColuna.split("/").map(Number);
      r.parcela = { n, de };
    }
    return r;
  }

  // Fallback da anuidade: `ANUIDADE VISA C      (3485) 07/12`, parcela fora da
  // coluna. Vale a ÚLTIMA ocorrência — o final do cartão pode parecer NN/NN.
  const todas = [...memo.matchAll(/(\d{2})\/(\d{2})/g)];
  const ultima = todas[todas.length - 1];
  if (ultima?.index !== undefined) {
    const r = monta(memo.slice(0, ultima.index), memo.slice(ultima.index + 5));
    r.parcela = { n: Number(ultima[1]), de: Number(ultima[2]) };
    return r;
  }

  // Descrição curta do próprio emissor ("IOF OPERACAO EXTERIOR",
  // "PAGAMENTO-BOLETO BANCARIO"): não tem colunas, o MEMO inteiro é o nome.
  return monta(memo, "");
}

/* ==========================================================================
 *  A observação do título do Omie
 * ==========================================================================
 * No cartão, a observação é o que diz o que o gasto É — a contraparte do título
 * é sempre "Lancamento Fatura Cartao". O Omie carimba um prefixo na importação
 * automática e cola o MEMO da fatura depois de um "|":
 *
 *   Conta a Pagar importada automaticamente em 04/08/2026 às 12:51.
 *   |OPENAI *CHATGPT SUBS          OPENAI.COM - R$ 525,00  U$ 102,79  V.DOL 5,1075
 */

/**
 * O MEMO cru de dentro da observação, ou null quando não há texto.
 *
 * NÃO faz trim à esquerda: `lerMemo` corta por POSIÇÃO de coluna (22 e 30), e um
 * espaço a menos no começo desloca tudo — o estabelecimento sairia partido.
 */
export function memoDaObservacao(obs: string | null | undefined): string | null {
  if (!obs) return null;
  const corte = obs.lastIndexOf("|");
  const memo = corte >= 0 ? obs.slice(corte + 1) : obs;
  return memo.trim() ? memo : null;
}

/**
 * Título do Omie que é gasto de cartão.
 *
 * A fatura entra no ERP com uma contraparte-carimbo — hoje "Lancamento Fatura
 * Cartao" (4.294 movimentos) e "Lancamento cartão itau" (19). É pelo nome mesmo
 * que dá para reconhecer: não existe campo no movimento dizendo "isto é cartão",
 * e o cadastro é criado justamente para servir de balde da fatura.
 */
export function ehCartao(contraparte: string | null | undefined): boolean {
  const s = (contraparte ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /cartao/.test(s) && /(lancamento|fatura)/.test(s);
}

/**
 * O lojista de um título de cartão, ou null.
 *
 * A trava do `ehCartao` mora aqui, e não em cada tela, porque esquecê-la não dá
 * erro: dá uma linha plausível e errada. A varredura diária guarda a observação
 * de TODA conta a pagar, e num título comum esse texto é o que o fornecedor
 * escreveu — "Link para visualizar a NFS-e: https://…", condição de pagamento,
 * número do contrato. Lido como MEMO (que é posicional), o começo da frase vira
 * "estabelecimento": a linha perde o nome do fornecedor e o mesmo lançamento
 * passa a ter um nome na lista e outro na ponte.
 */
export function lojistaDoTitulo(
  contraparte: string | null | undefined,
  obs: string | null | undefined,
): string | null {
  if (!ehCartao(contraparte)) return null;
  const memo = memoDaObservacao(obs);
  if (!memo) return null;
  const nome = lerMemo(memo).estabelecimento?.trim();
  return nome || null;
}
