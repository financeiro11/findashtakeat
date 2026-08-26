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
 *
 * GÊMEO EM DENO de `src/lib/notaFiscal.ts`, cópia verbatim (o arquivo não
 * importa nada). Quem tem teste é o original — 40 casos sobre o texto que o
 * PRÓPRIO `unpdf` extrai das notas reais, sobre chaves de acesso conferidas
 * contra o e-mail que as trouxe, sobre nomes de arquivo da pasta do Gmail e
 * sobre corpos de e-mail copiados da caixa `financeiro@`.
 *
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

/* ===========================================================================
 * A NOTA SEM ABRIR O ARQUIVO
 *
 * A pasta "0. Gmail" do Drive é o depósito dos anexos que chegam por e-mail, e
 * lá o NOME DO ARQUIVO já é dado estruturado:
 *
 *   2026-08-10_32260827250919000190550000001309411003058314-nfe.pdf
 *   └ data do e-mail  └ chave de acesso da NF-e (44 dígitos)
 *
 * A chave carrega o CNPJ do emitente e o mês da emissão. Isso é IDENTIDADE, e
 * sai de graça — sem baixar o PDF, sem OCR, sem modelo. Para uma esteira que
 * casa 2.000 notas com 6.000 lançamentos, a diferença entre "valor parecido" e
 * "mesmo CNPJ" é a diferença entre proposta e certeza.
 * ======================================================================== */

/**
 * O dígito verificador da chave — módulo 11, pesos 2 a 9 da direita para a
 * esquerda.
 *
 * Existe porque nome de arquivo é cheio de número comprido que não é chave:
 * "ESCEFATELBT06_00000000026855605451_0000004045A.pdf" tem 20 e 11 dígitos
 * seguidos, e um boleto tem 47. Sem conferir o DV, qualquer sequência de 44
 * viraria um CNPJ inventado — e um CNPJ inventado casa a nota com o fornecedor
 * errado, que é pior do que não casar.
 */
export function chaveValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto === 0 || resto === 1 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

/** A primeira chave de acesso VÁLIDA que aparecer no texto. */
export function chaveDeAcesso(texto: string | null | undefined): string | null {
  const s = String(texto ?? "");
  // Varre toda sequência de 44+ dígitos e também as janelas dentro dela: a
  // chave costuma vir grudada em outro número no nome do arquivo.
  for (const m of s.matchAll(/\d{44,}/g)) {
    const bloco = m[0];
    for (let i = 0; i + 44 <= bloco.length; i++) {
      const candidata = bloco.slice(i, i + 44);
      if (chaveValida(candidata)) return candidata;
    }
  }
  return null;
}

export type DadosDaChave = {
  cnpj: string;
  /** "2026-08" — o mês da EMISSÃO, que vem dentro da própria chave */
  competencia: string;
  numero: string;
};

/** cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + série(3) + número(9) + … */
export function dadosDaChave(chave: string | null | undefined): DadosDaChave | null {
  const c = String(chave ?? "");
  if (!chaveValida(c)) return null;
  const aa = c.slice(2, 4);
  const mm = c.slice(4, 6);
  if (Number(mm) < 1 || Number(mm) > 12) return null;
  return {
    cnpj: c.slice(6, 20),
    competencia: `20${aa}-${mm}`,
    numero: String(Number(c.slice(25, 34))),
  };
}

export type TipoDocumento = "nota" | "boleto" | "recibo" | "extrato" | "outro";

/**
 * Nota, boleto ou recibo — pelo nome do arquivo.
 *
 * Metade do que chega por e-mail NÃO é nota fiscal: na pasta de agosto há
 * "BOLETO - 4535.pdf" ao lado de "notafiscal_998_10418.pdf", e o mesmo
 * fornecedor manda os dois no mesmo e-mail. Marcar um lançamento como "COM NF"
 * porque existe um boleto é mentir com cara de resolvido — o contador abre o
 * título e encontra uma cobrança, não o documento fiscal.
 *
 * A ordem importa: "Boletos 3x Serviço Os. 1-453" contém "serviço" e "boleto",
 * e é boleto. Por isso boleto ganha de nota.
 */
export function tipoDoDocumento(nome: string | null | undefined): TipoDocumento {
  /* O `_` vira espaço ANTES de qualquer teste: para o regex ele é caractere de
     palavra, então `\bboleto` não casa em "2026-08-03_BOLETO - 4535.pdf" — e
     era exatamente esse o nome do arquivo na pasta de agosto. */
  const s = String(nome ?? "").toLowerCase().replace(/[_]+/g, " ");
  if (!s) return "outro";
  if (/\bboleto/.test(s)) return "boleto";
  if (/\bextrato|statement/.test(s)) return "extrato";
  if (/\bnfe?\b|\bnfs-?e\b|danfe|nota[\s_-]*fiscal|notafiscal|\bnf[\s_-]?\d|invoice/.test(s)) return "nota";
  if (/recibo|receipt|comprovante/.test(s)) return "recibo";
  return "outro";
}

export type NomeDeArquivo = {
  /** a data que o depósito do Gmail carimba no começo do nome */
  data: string | null;
  chave: string | null;
  cnpj: string | null;
  /** competência tirada da chave, não do nome da pasta */
  competencia: string | null;
  valor: number | null;
  tipo: TipoDocumento;
  /** o nome sem o carimbo de data e sem a chave — o que sobra descreve */
  descricao: string | null;
};

/**
 * Lê o que o nome do arquivo já entrega.
 *
 * Três formatos convivem na mesma pasta, e todos foram vistos:
 *   "2026-08-10_32260827250919000190550000001309411003058314-nfe.pdf"
 *   "20260817_Takeat - 0003198.pdf"
 *   "2026-08-05_TAKEAT TECNOLOGIA LTDA; ORION; NFSe; 012888; R$ 870,00.pdf"
 *
 * O terceiro traz o VALOR escrito — e o valor é metade do casamento.
 */
export function lerNomeDeArquivo(nome: string | null | undefined): NomeDeArquivo {
  const bruto = String(nome ?? "").trim();
  const semExt = bruto.replace(/\.(pdf|xml|jpe?g|png|heic|webp)$/i, "");

  // O carimbo do depósito: "AAAA-MM-DD_" ou "AAAAMMDD_", sempre no começo.
  let data: string | null = null;
  let resto = semExt;
  const carimbo = semExt.match(/^(\d{4})-?(\d{2})-?(\d{2})[_\s-]+/);
  if (carimbo) {
    const [, a, m, d] = carimbo;
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      data = `${a}-${m}-${d}`;
      resto = semExt.slice(carimbo[0].length);
    }
  }

  const chave = chaveDeAcesso(semExt);
  const daChave = dadosDaChave(chave);

  // "R$ 870,00" escrito no nome. Só com o "R$" à frente: um número solto no
  // nome é número de nota muito mais vezes do que é dinheiro.
  const mValor = resto.match(/R\$\s*([\d.]+,\d{2})/i);
  const valor = mValor ? valorBR(mValor[1]) : null;

  const descricao = resto
    .replace(/\d{44}/g, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s;,-]+|[\s;,-]+$/g, "")
    .trim() || null;

  return {
    data,
    chave,
    cnpj: daChave?.cnpj ?? null,
    competencia: daChave?.competencia ?? null,
    valor,
    tipo: tipoDoDocumento(bruto),
    descricao,
  };
}

export type XmlFiscal = {
  emitente: string | null;
  cnpj: string | null;
  data: string | null;
  valor: number | null;
  chave: string | null;
  numero: string | null;
};

/** O conteúdo da tag, dentro de um bloco. Sem DOMParser: o Deno não tem. */
const tag = (bloco: string, ...nomes: string[]): string | null => {
  for (const n of nomes) {
    const m = bloco.match(new RegExp(`<(?:\\w+:)?${n}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${n}>`, "i"));
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
};

/** O bloco de uma tag-container (emit, dest, PrestadorServico…). */
const bloco = (xml: string, ...nomes: string[]): string => {
  for (const n of nomes) {
    const m = xml.match(new RegExp(`<(?:\\w+:)?${n}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${n}>`, "i"));
    if (m) return m[1];
  }
  return "";
};

/**
 * O XML da nota — a fonte mais exata que existe, e a mais barata.
 *
 * Vários fornecedores anexam o XML junto do PDF. Ali CNPJ, valor, data e chave
 * estão em campo próprio, sem layout, sem OCR e sem ambiguidade: é a diferença
 * entre ler a nota e adivinhá-la.
 *
 * DUAS FAMÍLIAS, e a segunda não tem padrão nacional. A NF-e (mercadoria) é
 * `emit`/`vNF`; a NFS-e (serviço) é municipal e varia — o que se repete é
 * `PrestadorServico` e algum `Valor…`. Onde nenhuma casa, cai no genérico: o
 * primeiro CNPJ que NÃO é o nosso.
 *
 * ATENÇÃO AO SEPARADOR: no XML o valor é sempre "2135.74", ponto decimal. Ler
 * como pt-BR faria R$ 2.135,74 virar R$ 213.574,00.
 */
export function lerXmlFiscal(texto: string | null | undefined, cnpjProprio?: string): XmlFiscal | null {
  const xml = String(texto ?? "");
  if (!/<\s*(?:\w+:)?(?:nfe|NFe|infNFe|CompNfse|Nfse|InfNfse|nfeProc)/i.test(xml)) return null;

  const chave = chaveDeAcesso((xml.match(/Id\s*=\s*"[^"]*"/i)?.[0] ?? "") + " " + xml.slice(0, 4000));

  // NF-e: o emitente é `emit`; o `dest` somos nós.
  const emit = bloco(xml, "emit", "PrestadorServico", "Prestador");
  let cnpj = emit ? (tag(emit, "CNPJ", "Cnpj") ?? "")?.replace(/\D/g, "") : "";
  if (cnpj.length !== 14) cnpj = "";
  const emitente = emit ? tag(emit, "xNome", "RazaoSocial", "xFant", "NomeFantasia") : null;

  // Genérico: o primeiro CNPJ que não é o nosso. Vale para o XML municipal que
  // não usa nenhum dos nomes conhecidos.
  if (!cnpj && cnpjProprio) {
    for (const m of xml.matchAll(/\b\d{14}\b/g)) {
      if (m[0] !== cnpjProprio) { cnpj = m[0]; break; }
    }
  }

  const totais = bloco(xml, "ICMSTot", "ValoresNfse", "Servico") || xml;
  const bruto = tag(totais, "vNF", "ValorLiquidoNfse", "ValorServicos", "vServ", "ValorTotal");
  const valor = bruto ? Number(String(bruto).replace(/[^\d.]/g, "")) : NaN;

  const dh = tag(xml, "dhEmi", "dEmi", "DataEmissao", "dhRecbto");
  const data = dh?.match(/^(\d{4})-(\d{2})-(\d{2})/) ? dh.slice(0, 10) : dataISO(dh ?? "");

  const numero = tag(xml, "nNF", "Numero", "NumeroNfse");

  const daChave = dadosDaChave(chave);
  return {
    emitente: emitente ?? null,
    cnpj: cnpj || daChave?.cnpj || null,
    data: data ?? null,
    valor: isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : null,
    chave,
    numero: numero ?? daChave?.numero ?? null,
  };
}

/**
 * Todo CNPJ do texto, formatado ou não, na ordem em que aparece e sem repetir.
 *
 * A GUARDA DE FRONTEIRA NÃO É ZELO: sem ela, catorze dígitos de DENTRO da chave
 * de acesso viram CNPJ. A chave `3226083697731700012055…` começa com
 * "32260836977317", que tem cara de CNPJ e não é — o CNPJ verdadeiro está na
 * posição 7. Um teste com e-mail real pegou isso: o fornecedor saía como uma
 * empresa que não existe.
 *
 * Feita sem lookbehind de propósito — o gêmeo deste arquivo roda no navegador.
 *
 * Local, porque este arquivo não importa nada: é o que permite que o gêmeo em
 * Deno seja cópia verbatim.
 */
function cnpjsEm(texto: string): string[] {
  const achados: string[] = [];
  const visto = new Set<string>();
  for (const m of texto.matchAll(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g)) {
    const i = m.index ?? 0;
    // Grudado em outro dígito = pedaço de um número maior, não um CNPJ.
    if (/\d/.test(texto[i - 1] ?? "") || /\d/.test(texto[i + m[0].length] ?? "")) continue;
    const d = soDigitos(m[0]);
    if (d.length === 14 && !visto.has(d)) { visto.add(d); achados.push(d); }
  }
  return achados;
}

export type CorpoDeEmail = {
  chave: string | null;
  cnpj: string | null;
  valor: number | null;
  data: string | null;
  numero: string | null;
};

/**
 * O CORPO DO E-MAIL — a fonte que o depósito de anexos no Drive nunca teve.
 *
 * Metade dos fornecedores escreve tudo em texto puro, e às vezes escreve melhor
 * do que o anexo:
 *
 *   "Fornecedor/Prestador FRACALOSSI MATERIAL ELETRICO LTDA
 *    CNPJ: 27.250.919/0001-90 Cliente/Tomador TAKEAT TECNOLOGIA LTDA
 *    CNPJ: 37.511.891/0001-50 ... Valor: R$275,80"
 *
 * Repare nos DOIS CNPJs: o nosso está ali do lado. Pegar "o primeiro CNPJ do
 * texto" casaria a nota com a própria Takeat — por isso o CNPJ da casa é
 * argumento obrigatório e sai da disputa.
 *
 * Serve para dois casos que sem ele ficam de fora: o e-mail que traz SÓ LINK
 * (o Bling manda "Visualizar DANFE" e nenhum arquivo) e o anexo ilegível cujo
 * texto ao redor diz o que ele deveria dizer.
 */
export function lerCorpoDeEmail(texto: string | null | undefined, cnpjProprio: string): CorpoDeEmail {
  const t = String(texto ?? "").replace(/\s+/g, " ");
  const proprio = cnpjProprio.replace(/\D/g, "");

  const chave = chaveDeAcesso(t);
  const daChave = dadosDaChave(chave);

  /* O CNPJ: primeiro o que vem logo depois de um rótulo de quem emitiu, porque
     é o único jeito de acertar quando há vários no texto. Sem rótulo, o
     primeiro que não é o nosso. E a chave sempre desempata, porque ela É o
     emitente. */
  let cnpj: string | null = null;
  const rotulo = t.match(/(?:fornecedor|prestador|emitente|remetente|raz[ãa]o social)/i);
  if (rotulo?.index !== undefined) {
    // A janela depois do rótulo passa pelo MESMO varredor, com a mesma guarda
    // de fronteira — senão a chave de acesso logo adiante viraria o emitente.
    const janela = t.slice(rotulo.index, rotulo.index + 160);
    cnpj = cnpjsEm(janela).find((c) => c !== proprio) ?? null;
  }
  if (!cnpj) cnpj = cnpjsEm(t).find((c) => c !== proprio) ?? null;

  /* O valor: só com "R$" à frente. Número solto num e-mail é número de nota,
     de pedido, de chamado e de contrato muito mais vezes do que é dinheiro — e
     "US$ 0,00" da fatura do HubSpot não é real. Prefere o que vem depois da
     palavra "valor"; senão, o primeiro. */
  const valorRotulado = t.match(/valor[^\d]{0,20}R\$\s*([\d.]+,\d{2})/i);
  const valorQualquer = t.match(/R\$\s*([\d.]+,\d{2})/);
  const bruto = valorRotulado?.[1] ?? valorQualquer?.[1] ?? null;
  const valor = bruto ? valorBR(bruto) : null;

  /* A data: a de EMISSÃO, não a de vencimento — o vencimento é outro dia e
     jogaria a janela do casamento para o mês seguinte. Sem rótulo de emissão,
     nenhuma data: chutar aqui é pior do que não ter. */
  const dataRotulada = t.match(/(?:emiss[ãa]o|emitida?\s+em|data\s+de\s+emiss[ãa]o)[^\d]{0,20}(\d{2}\/\d{2}\/\d{4})/i);
  const data = dataRotulada ? dataISO(dataRotulada[1]) : null;

  const numero = t.match(/(?:nota fiscal|nf-?e?|nfs-?e|n[úu]mero|n[ºo°.]{1,2})\s*[:\s]\s*0*(\d{1,9})\b/i)?.[1] ?? null;

  return {
    chave,
    cnpj: cnpj ?? daChave?.cnpj ?? null,
    valor,
    data,
    numero: numero ?? daChave?.numero ?? null,
  };
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
