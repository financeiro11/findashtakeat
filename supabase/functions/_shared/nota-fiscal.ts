/* ---------------------------------------------------------------------------
 * DANFE em texto -> o que foi comprado.
 *
 * A pasta de comprovantes do Mercado Livre guarda a NF-e de cada pedido em PDF
 * de texto (não escaneado), e é ela que responde o que a linha "MERCADO LIVRE
 * R$ 45,60" da DRE realmente foi: uma pingadeira e uma tampa de purificador,
 * vendidas pela Pure Water.
 *
 * SEM IA DE PROPÓSITO. Os rótulos do DANFE são fixos por lei ("RECEBEMOS DE …",
 * "VALOR TOTAL DA NOTA", "CHAVE DE ACESSO"), então o que dá para ancorar em
 * texto não precisa de modelo — e valor e data são justamente a chave do
 * casamento, onde um erro cria um comprovante colado no lançamento errado. O
 * OCR (aí sim com modelo) só entra na outra pasta, a das fotos do WhatsApp,
 * onde não existe texto nenhum para ancorar.
 *
 * GÊMEO EM DENO de `src/lib/notaFiscal.ts`, cópia verbatim (o arquivo não
 * importa nada). Quem tem teste é o original — 16 casos sobre o texto que o
 * PRÓPRIO `unpdf` extrai das notas reais.
 *
 * UM PDF PODE TER VÁRIAS NOTAS. Um pedido do Mercado Livre com dois vendedores
 * gera dois DANFEs no mesmo arquivo — `NF_compra_2000014180117577.pdf` tem a
 * MULTIMIX (R$ 135,50) e a DEPÓSITO DOS COPOS (R$ 26,00). Ler o arquivo como se
 * fosse uma nota só casaria o valor errado, então a quebra vem antes de tudo.
 * ------------------------------------------------------------------------- */

export type Danfe = {
  /** quem vendeu de verdade — "PURE WATER COMERCIO DE PECAS…", não "Mercado Livre" */
  emitente: string;
  /** só dígitos, tirado da chave de acesso (posições 7 a 20) */
  cnpjEmitente: string | null;
  /** ISO, da emissão */
  data: string | null;
  /** VALOR TOTAL DA NOTA */
  valor: number | null;
  /** a descrição de cada produto, na ordem em que aparece */
  itens: string[];
  /** os 44 dígitos, quando legíveis */
  chave: string | null;
};

const soDigitos = (s: string) => s.replace(/\D/g, "");

/** "135,50" -> 135.5. No DANFE o formato é sempre pt-BR. */
function valorBR(s: string): number | null {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}

function dataISO(s: string): string | null {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * A chave de acesso tem 44 dígitos e carrega o CNPJ do emitente:
 * cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + série(3) + número(9) + …
 *
 * Vale mais do que procurar "CNPJ" no texto: a página tem o CNPJ do emitente, o
 * do destinatário e o da transportadora, e a ordem deles muda entre layouts.
 */
function cnpjDaChave(chave: string | null): string | null {
  if (!chave || chave.length !== 44) return null;
  const cnpj = chave.slice(6, 20);
  return /^\d{14}$/.test(cnpj) ? cnpj : null;
}

/** Os 44 dígitos, que no texto vêm em grupos de quatro. */
function acharChave(bloco: string): string | null {
  for (const m of bloco.matchAll(/(?:\d{4}[ .]){10}\d{4}/g)) {
    const d = soDigitos(m[0]);
    if (d.length === 44) return d;
  }
  const solta = bloco.match(/\b\d{44}\b/);
  return solta ? solta[0] : null;
}

/** Todo número no formato brasileiro, INCLUSIVE os grudados. */
const NUMERO = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

/**
 * O total da nota.
 *
 * O `unpdf` (que é quem lê o PDF em produção) devolve o quadro assim: TODOS os
 * onze rótulos primeiro e só depois os onze números, numa linha só. Não dá para
 * contar posição — a ordem dos números não segue a dos rótulos, porque o
 * extrator lê o quadro por linha visual, e o total fica antes do IPI.
 *
 * Pior: números saem GRUDADOS. "45,600,00" é "45,60" seguido de "0,00", não
 * quarenta e cinco mil e seiscentos. O `matchAll` resolve sozinho — ele casa
 * "45,60" e recomeça em "0,00" — mas só porque o formato exige as duas casas.
 *
 * O total é o MAIOR do quadro: ele é a soma dos componentes (produtos + frete +
 * seguro + outras + IPI), então nenhum deles pode superá-lo. A exceção teórica é
 * uma nota com desconto grande, em que "valor dos produtos" passa o total —
 * nessas o casamento simplesmente não acha par, que é melhor do que casar
 * errado.
 */
function totalDaNota(bloco: string): number | null {
  const i = bloco.search(/VALOR TOTAL DA NOTA/i);
  if (i < 0) return null;

  // Só a corrida de números que vem logo depois: para no primeiro caractere que
  // não é dígito, vírgula, ponto ou espaço ("CÁLCULO DO IMPOSTO").
  const depois = bloco.slice(i + "VALOR TOTAL DA NOTA".length);
  const corrida = depois.match(/^[\s\d.,]+/);
  if (!corrida) return null;

  const valores = [...corrida[0].matchAll(NUMERO)]
    .map((m) => valorBR(m[0]))
    .filter((v): v is number => v !== null);
  if (!valores.length) return null;
  return Math.max(...valores);
}

/**
 * Uma linha de item, ancorada nos DOIS lados.
 *
 * À esquerda, o código do vendedor: começa por até 3 letras e tem um dígito
 * ("10210320", "V789985036464", "9680703"). À direita, a trinca fiscal — NCM
 * (8 dígitos), CST/CSOSN (3 ou 4) e CFOP (4) — seguida de unidade, quantidade e
 * dois valores.
 *
 * Ancorar só à direita não bastou: o `unpdf` cola o cabeçalho do quadro na
 * mesma linha, e a descrição saía como "…VALOR PRODUTO 10210320 PINGADEIRA FR
 * CINZA". Exigir que a linha COMECE num código resolve, porque nenhum rótulo do
 * cabeçalho tem dígito no meio ("VALOR", "PRODUTO", "ALÍQUOTAS") e "0,00"
 * também não serve de código — a vírgula não entra em `[\w.-]`.
 */
const ITEM = /\b([A-Z]{0,3}\d[\w.-]{2,})\s+(.{3,110}?)\s+\d{8}\s+\d{3,4}\s+\d{4}\s+\S{1,4}\s+[\d.,]+\s+[\d.,]+/g;

/**
 * As descrições dos produtos.
 *
 * Aguenta a descrição que o extrator quebra no meio ("Jogo De Copos De Vidro 6
 * Pecas Para Agua Suco 255ml Ruvolo") porque o que delimita é o par
 * código-à-esquerda / trinca-fiscal-à-direita, não a quebra de linha.
 */
function itensDaNota(bloco: string): string[] {
  const texto = bloco.replace(/\s+/g, " ");
  const itens: string[] = [];

  for (const m of texto.matchAll(ITEM)) {
    const desc = limparDescricao(m[2]);
    // Sem letra nenhuma não é descrição, é sobra de número.
    if (desc.length >= 3 && /\p{L}/u.test(desc)) itens.push(desc);
  }
  return itens;
}

/**
 * Tira o que vem antes da descrição de verdade.
 *
 * Sobram duas coisas na frente: o código interno do vendedor ("10210320",
 * "V789985036464") e o número do item ("5 Conjunto 6 xicaras…"). São dois
 * formatos diferentes e podem vir os dois juntos, então a limpeza roda em laço
 * até parar de mudar — a mesma forma do `chaveContraparte` com sufixo
 * societário. Para quando o token começa por letra, que é onde a descrição
 * começa.
 */
function limparDescricao(bruto: string): string {
  let s = bruto.replace(/\s+/g, " ").trim();
  for (;;) {
    const antes = s;
    s = s
      .replace(/^[\d.,]+\s+/, "")            // número solto
      .replace(/^[A-Z]{0,2}\d[\w-]*\s+/, "") // código do vendedor
      .trim();
    if (s === antes) return s;
  }
}

/**
 * Quebra o texto do PDF em uma entrada por nota.
 *
 * "RECEBEMOS DE <fulano> OS PRODUTOS CONSTANTES" é o canhoto, e todo DANFE
 * começa por ele — é a única marca confiável de onde uma nota termina e a
 * seguinte começa.
 */
export function lerDanfes(texto: string): Danfe[] {
  const t = String(texto ?? "");
  if (!t.trim()) return [];

  const marcas = [...t.matchAll(/RECEBEMOS DE\s+([\s\S]{1,180}?)\s+OS PRODUTOS CONSTANTES/gi)];
  if (!marcas.length) return [];

  const notas: Danfe[] = [];
  for (let i = 0; i < marcas.length; i++) {
    const ini = marcas[i].index ?? 0;
    const fim = i + 1 < marcas.length ? (marcas[i + 1].index ?? t.length) : t.length;
    const bloco = t.slice(ini, fim);

    const chave = acharChave(bloco);
    notas.push({
      emitente: marcas[i][1].replace(/\s+/g, " ").trim(),
      cnpjEmitente: cnpjDaChave(chave),
      data: dataISO(bloco),
      valor: totalDaNota(bloco),
      itens: itensDaNota(bloco),
      chave,
    });
  }
  return notas;
}

/**
 * A frase que vai para a linha da DRE.
 *
 * Curta de propósito: ela divide espaço com a data, o valor e o nome da
 * contraparte. O comprovante inteiro fica a um clique.
 */
export function descricaoDaNota(nota: Danfe, teto = 90): string {
  const itens = nota.itens.filter(Boolean);
  if (!itens.length) return nota.emitente;

  let s = itens[0];
  for (let i = 1; i < itens.length && s.length + itens[i].length + 3 <= teto; i++) {
    s += " + " + itens[i];
  }
  if (itens.length > 1 && !s.includes(" + ")) s += ` +${itens.length - 1}`;
  return s.length > teto ? s.slice(0, teto - 1).trimEnd() + "…" : s;
}
