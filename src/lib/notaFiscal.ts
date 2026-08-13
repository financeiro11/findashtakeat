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

/**
 * O total da nota.
 *
 * Depois do cabeçalho vem uma fileira de seis números (frete, seguro, desconto,
 * outras despesas, IPI e o total) e logo em seguida "TRANSPORTADOR". O total é o
 * ÚLTIMO da fileira — pegar o primeiro devolveria o frete, que costuma ser 0,00
 * e casaria com nada.
 */
function totalDaNota(bloco: string): number | null {
  const m = bloco.match(/VALOR TOTAL DA NOTA([\s\S]{0,200}?)(?:TRANSPORTADOR|$)/i);
  if (!m) return null;
  const numeros = m[1].match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
  if (!numeros?.length) return null;
  return valorBR(numeros[numeros.length - 1]);
}

/**
 * As descrições dos produtos.
 *
 * Cada item termina numa sequência reconhecível: NCM (8 dígitos), CST ou CSOSN
 * (3 ou 4) e CFOP (4). O que vem antes disso, tirando o código interno do
 * vendedor, é a descrição. Ancorar no fim do item — e não no começo — é o que
 * aguenta a descrição que quebra em duas linhas ("Jogo De Copos De Vidro 6
 * Pecas Para Agua Suco\n\n255ml Ruvolo").
 */
function itensDaNota(bloco: string): string[] {
  const dados = bloco.match(/ICMS IPI([\s\S]*?)(?:CÁLCULO DO ISSQN|CALCULO DO ISSQN|DADOS ADICIONAIS|$)/i);
  if (!dados) return [];

  const itens: string[] = [];
  /* A cauda numérica do item entra no casamento (`{0,6}` no fim) de propósito:
     sem consumi-la, ela sobra na frente do item SEGUINTE e vira "PINGADEIRA +
     0,00 0,00 0,00 10210321 TAMPA…". */
  const re = /(.{0,400}?)\s+\d{8}\s+\d{3,4}\s+\d{4}\s+\S{1,4}\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+(?:\s+[\d.,]+){0,6}/g;
  const texto = dados[1].replace(/\s*\n\s*/g, " ");

  for (const m of texto.matchAll(re)) {
    if (m[1].length >= 3) itens.push(limparDescricao(m[1]));
  }
  return itens.filter((s) => s.length >= 3);
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
