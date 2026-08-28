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
 * importa nada). Quem tem teste é o original — 87 casos sobre o texto que o
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

/**
 * A CHAVE DA NFS-e NACIONAL TEM 50 DÍGITOS, e não é chave de NF-e.
 *
 * O e-mail de emissão do Omie escreve o "Código de Verificação" da NFS-e —
 * `32053092246235634000124000000000063526087655914941` — e a janela deslizante
 * de 44 dígitos logo abaixo acha, DENTRO dele, uma sequência cujo dígito
 * verificador fecha por acaso. Foi o que gravou `9224623563400012400…` como
 * chave de acesso nas notas que chegam por essa caixa: um número que não
 * identifica documento nenhum, num campo cujo nome promete identidade.
 *
 * O que separa uma da outra sem chutar: as 7 primeiras casas da chave de NFS-e
 * são o código IBGE do município emissor, e todo município brasileiro começa
 * por 1 a 5 (3205309 = Vitória/ES, de onde vem a nota da Victoria Partners).
 * Só o bloco de exatamente 50 com IBGE plausível sai da disputa — um nome de
 * arquivo que grude 50 dígitos por outro motivo continua sendo varrido.
 */
const ehChaveNfse = (bloco: string): boolean => {
  if (bloco.length !== 50) return false;
  const ibge = Number(bloco.slice(0, 7));
  return ibge >= 1100000 && ibge <= 5399999;
};

/** O Código de Verificação da NFS-e nacional, quando ele está escrito no texto. */
export function chaveNfse(texto: string | null | undefined): string | null {
  for (const m of String(texto ?? "").matchAll(/\d{50}/g)) {
    if (ehChaveNfse(m[0])) return m[0];
  }
  return null;
}

/** A primeira chave de acesso VÁLIDA que aparecer no texto. */
export function chaveDeAcesso(texto: string | null | undefined): string | null {
  const s = String(texto ?? "");
  // Varre toda sequência de 44+ dígitos e também as janelas dentro dela: a
  // chave costuma vir grudada em outro número no nome do arquivo.
  for (const m of s.matchAll(/\d{44,}/g)) {
    const bloco = m[0];
    if (ehChaveNfse(bloco)) continue;
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
 * O e-mail é o DOCUMENTO, ou é um recado SOBRE o documento?
 *
 * `tipoDoDocumento` foi feito para nome de arquivo, onde "NFe" no nome quer
 * dizer que o arquivo é a nota. Em ASSUNTO DE E-MAIL isso deixa de valer: um
 * aviso de vencimento também escreve "NFS-e" no assunto, e o classificador o
 * chamava de nota.
 *
 * Medido em 26/08/2026, nas 489 linhas que chegaram sem anexo: TODAS estavam
 * gravadas como `tipo_documento = 'nota'`, e pelo menos 101 são declaradamente
 * recado — "VICTORIA PARTNERS - Aviso de Vencimento do Pix da NFS-e nº…" (58),
 * "Focus NFe - Lembrete de Fatura vencendo hoje" (32), "Recebemos seu
 * pagamento!" (10). Isso inflava a biblioteca com 489 documentos que não
 * existem, e mandava alguém procurar arquivo onde nunca houve arquivo.
 *
 * A distinção é de TEMPO, não de vocabulário: "sua nota fiscal está pronta",
 * "vence hoje", "recebemos seu pagamento" falam de um evento no calendário. A
 * nota em si não avisa nada — ela é.
 *
 * O que NÃO entra aqui, de propósito: "Envio da NFS-e", "Segue nota fiscal",
 * "Nota Fiscal Eletrônica". Esses são entrega, mesmo quando o anexo falhou.
 */
export function ehAvisoDeCobranca(assunto: string | null | undefined): boolean {
  const s = String(assunto ?? "").toLowerCase().replace(/[_]+/g, " ");
  if (!s) return false;
  /* "atraso" solto, e não "em atraso": o real é "Fatura com atraso de 5 dias". */
  return /\b(aviso|lembrete|vencendo|vence hoje|vence amanh|a vencer|atraso|atrasad)/.test(s)
    /* "vencimento do Pix", "vencimento em 10/08". NÃO é só `/vencimento/`:
       "NFS-e + Boleto Nº 891 - vencimento 10/08" ENTREGA o documento e apenas
       menciona a data. O que denuncia o recado é a data sendo anunciada. */
    || /vencimento (d[oae]|em|:)/.test(s)
    || /\b(recebemos|confirma[cç][aã]o d[eo] pagamento|pagamento (foi )?confirmado)/.test(s)
    || /est[aá] pronta\b/.test(s)
    || /\bacesse\b.*\b(fatura|nota)/.test(s);
}

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
  /* "nota" SEGUIDA DO NÚMERO vale, e não só "nota fiscal". O arquivo
     "2026-05-11_nota-0041742026-1778505996222-4179.pdf" — a NFS-e da F. Dutra,
     com o nome que o portal do emissor dá — caía em "outro" porque depois de
     "nota" vem um hífen e um número, não a palavra "fiscal". E "outro" não é
     rótulo inofensivo: `parece_nota` é coluna gerada de `tipo_documento`, e sem
     ela a nota perde as regras fortes do casador e todo o peso na disputa por
     um título.
     `\d` LOGO DEPOIS, e não `\bnota\b` solto, porque esta função também é
     chamada com ASSUNTO DE E-MAIL em `gmail-nf-sync` — e ali "sua nota está
     pronta" é recado, não documento (é a lição das 489 linhas sem anexo de
     26/08/2026). Nome de arquivo numera; recado não.
     Continua atrás de `boleto`, testado antes: "Boleto NF 11064" é boleto.

     "FATURA" ENTROU EM 28/08/2026, e por dois motivos.
     O primeiro é coerência: `invoice` já estava aqui, e fatura é a mesma
     palavra em português. O segundo é medido — no descarte inteiro da caixa
     (72 mensagens com anexo dadas como não fiscais), 4 têm "fatura" no NOME DO
     ARQUIVO, todas as quatro da Verisure ("SUA FATURA.PDF"), e NENHUMA delas
     tem assunto de recado. A palavra que assustava — "Fatura com atraso de 5
     dias", "Lembrete de Fatura vencendo hoje" — mora no ASSUNTO, e o assunto
     não decide `tipo_documento` de linha com anexo: `lerAnexo` classifica pelo
     nome do arquivo. Onde o assunto decide (a linha SEM arquivo) quem responde
     é `ehAvisoDeCobranca`, que já separa o recado da entrega.

     `\bfaturas?\b` e não `\bfatura`: sem a fronteira do fim, "Relatório de
     faturamento" viraria nota fiscal.

     O QUE PROTEGE DE VERDADE não é este regex, é o conteúdo: um PDF chamado
     "fatura" que por dentro é boleto vira boleto, e não conta como nota no ERP.
     Ver `ehBoletoPeloTexto`. */
  if (/\bnfe?\b|\bnfs-?e\b|danfe|nota[\s_-]*fiscal|notafiscal|\bnota[\s_.-]*\d|\bnf[\s_-]?\d|invoice|\bfaturas?\b/.test(s)) return "nota";
  if (/recibo|receipt|comprovante/.test(s)) return "recibo";
  return "outro";
}

/**
 * O PAPEL DIZ QUE É BOLETO, e o nome do arquivo não manda mais que ele.
 *
 * Marcar um lançamento como "COM NF" porque existe um boleto é mentir com cara
 * de resolvido: o contador abre o título e encontra uma cobrança, não o
 * documento fiscal. `tipoDoDocumento` já defende isso pela palavra escrita no
 * nome — só que o nome é escolha de quem salvou o arquivo, e "SUA FATURA.PDF"
 * não diz qual dos dois documentos veio dentro.
 *
 * Este freio existe porque "fatura" passou a valer como nota (28/08/2026). Ele
 * lê o texto que o PDF já entregou — não custa nada, o extrator rodou de
 * qualquer jeito — e desfaz o palpite do nome quando o conteúdo o contradiz.
 *
 * AS DUAS MARCAS, e a segunda é a que evita o tiro no pé:
 *   • de boleto: a ficha de compensação e o que só existe nela — linha
 *     digitável, nosso número, cedente/sacado, "não receber após o vencimento";
 *   • de nota: "nota fiscal", "NFS-e", "DANFE", "chave de acesso", "código de
 *     verificação", "discriminação dos serviços", ISSQN.
 *
 * SÓ VIRA BOLETO QUEM TEM A PRIMEIRA E NÃO TEM A SEGUNDA. Metade dos emissores
 * manda a NFS-e e o boleto NO MESMO PDF — "NFS-e + Boleto Nº 891" é um arquivo
 * real desta caixa. Ali as duas marcas aparecem, e o papel É a nota (com uma
 * cobrança grampeada). Derrubar esses seria trocar um erro pelo seu contrário.
 *
 * Os recortes do teste são SINTÉTICOS, ao contrário dos de DANFE — não havia
 * texto de boleto real extraído por `unpdf` no repositório para ancorar.
 */
const MARCA_BOLETO =
  /ficha de compensa|linha digit[áa]vel|nosso n[úu]mero|\bcedente\b|\bsacado\b|n[ãa]o receber ap[óo]s|autentica[çc][ãa]o mec[âa]nica|local de pagamento/i;
const MARCA_NOTA =
  /nota fiscal|notafiscal|\bnfs-?e\b|\bdanfe\b|chave de acesso|c[óo]digo de verifica|prestador de servi|discrimina[çc][ãa]o d[oa]s servi|\bissqn\b|\bnf-?e\b/i;

export function ehBoletoPeloTexto(texto: string | null | undefined): boolean {
  const t = String(texto ?? "");
  if (!t.trim()) return false;
  if (!MARCA_BOLETO.test(t)) return false;
  return !MARCA_NOTA.test(t);
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

  /* CHAVE DE ACESSO É PROVA DE QUE O PAPEL É NOTA, e vence o palpite do nome.
   *
   * `tipoDoDocumento` só sabe ler a palavra escrita no nome do arquivo, e há
   * emissor que não escreve nenhuma: o Bling despeja
   * "2026-08-05_9ada7958b5996e981676d96d3870e660.pdf" — um MD5 — e a
   * PrimeAcesso inteira caía como "outro". Só que o arquivo TEM os 44 dígitos
   * dentro, com DV conferido, e 44 dígitos com DV válido são a identidade de um
   * documento fiscal: não existe boleto com chave de acesso.
   *
   * Medido em 26/08/2026: 53 linhas com chave e `parece_nota = false`, 44 delas
   * com arquivo. Cada uma era uma nota que a regra 2 do casador (mesmo CNPJ na
   * janela) não alcançava — ela exige `parece_nota` — e que a fila do ERP
   * recusava pelo mesmo motivo.
   *
   * O que a chave NÃO derruba é a palavra explícita: "boleto", "recibo" e
   * "extrato" no nome continuam ganhando. Boleto que cita a NF no nome existe
   * ("Boleto NF 11064 - Parcela 1"), e ali quem está certo é a palavra. */
  const tipoDoNome = tipoDoDocumento(bruto);
  const tipo = chave && tipoDoNome === "outro" ? "nota" : tipoDoNome;

  return {
    data,
    chave,
    cnpj: daChave?.cnpj ?? null,
    competencia: daChave?.competencia ?? null,
    valor,
    tipo,
    descricao,
  };
}

/**
 * Os dois dígitos verificadores do CNPJ — módulo 11, pesos 2..9 ciclando.
 *
 * Serve para o mesmo que `chaveValida` serve à chave de acesso: separar um
 * número que É identidade de uma corrida de dígitos que só tem o comprimento
 * certo. Um número de instalação da concessionária tem catorze dígitos e não
 * fecha o DV; um CNPJ fecha.
 */
export function cnpjValido(bruto: string | null | undefined): boolean {
  const c = String(bruto ?? "").replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (ate: number): number => {
    let soma = 0;
    let peso = 2;
    for (let i = ate - 1; i >= 0; i--) {
      soma += Number(c[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
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
 *
 * A LISTA DE RAÍZES ERA A PORTA, E ELA ESTAVA FECHADA DEMAIS.
 *
 * Existem mais modelos fiscais do que NF-e e NFS-e, e cada um tem sua própria
 * tag de topo: a conta de luz é NF3e (modelo 66), o transporte é CT-e, a
 * telefonia é NFCom. A conta da EDP chega todo mês em
 * `ESCEFATELBT08_256003120341.xml` — e era recusada na primeira linha, antes de
 * qualquer campo ser lido, porque o nome da raiz dela não estava na lista.
 *
 * Enumerar modelos é uma corrida que não se ganha: o próximo fornecedor traz o
 * próximo. O que NÃO muda entre eles são os campos, que a SEFAZ padronizou —
 * `emit`, `CNPJ`, `xNome`, `vNF`, `dhEmi` — e a chave de acesso de 44 dígitos
 * com dígito verificador. Então a porta passa a ser: é XML, e no fim saiu ou um
 * CNPJ de terceiro ou uma chave válida. Sem nenhum dos dois, devolve nulo como
 * antes — um `pom.xml` continua não sendo nota.
 *
 * A CHAVE É PROCURADA NO DOCUMENTO INTEIRO (até 20 KB) e não só nos primeiros
 * 4 KB: fora da NF-e ela não fica no atributo `Id` do começo.
 */
export function lerXmlFiscal(texto: string | null | undefined, cnpjProprio?: string): XmlFiscal | null {
  const xml = String(texto ?? "");
  if (!/<\s*(?:\w+:)?[A-Za-z]/.test(xml)) return null;

  const chave = chaveDeAcesso((xml.match(/Id\s*=\s*"[^"]*"/i)?.[0] ?? "") + " " + xml.slice(0, 20_000));

  // NF-e: o emitente é `emit`; o `dest` somos nós.
  const emit = bloco(xml, "emit", "PrestadorServico", "Prestador");
  let cnpj = emit ? (tag(emit, "CNPJ", "Cnpj") ?? "")?.replace(/\D/g, "") : "";
  if (cnpj.length !== 14) cnpj = "";
  const emitente = emit ? tag(emit, "xNome", "RazaoSocial", "xFant", "NomeFantasia") : null;

  /* Genérico: o primeiro CNPJ que não é o nosso. Vale para o XML municipal que
     não usa nenhum dos nomes conhecidos.
     O DÍGITO VERIFICADOR VIROU OBRIGATÓRIO AQUI. Enquanto a porta de entrada
     era a lista de raízes, este laço só via XML de nota; agora ele vê qualquer
     XML, e uma corrida de catorze dígitos existe aos montes — código de barras,
     número de instalação, protocolo. Um CNPJ inventado é o pior resultado
     possível: ele casa a nota com um fornecedor que não existe, e faz isso com
     cara de certeza. `<CNPJ>` de tag continua valendo sem conferência: ali quem
     escreveu foi o emissor, e é campo, não coincidência. */
  if (!cnpj && cnpjProprio) {
    for (const m of xml.matchAll(/\b\d{14}\b/g)) {
      if (m[0] !== cnpjProprio && cnpjValido(m[0])) { cnpj = m[0]; break; }
    }
  }

  const totais = bloco(xml, "ICMSTot", "ValoresNfse", "Servico") || xml;
  const bruto = tag(totais, "vNF", "ValorLiquidoNfse", "ValorServicos", "vServ", "ValorTotal");
  const valor = bruto ? Number(String(bruto).replace(/[^\d.]/g, "")) : NaN;

  const dh = tag(xml, "dhEmi", "dEmi", "DataEmissao", "dhRecbto");
  const data = dh?.match(/^(\d{4})-(\d{2})-(\d{2})/) ? dh.slice(0, 10) : dataISO(dh ?? "");

  const numero = tag(xml, "nNF", "Numero", "NumeroNfse");

  const daChave = dadosDaChave(chave);

  /* A PORTA DE SAÍDA, agora que a de entrada abriu: sem CNPJ de terceiro e sem
     chave válida, não se sabe de quem é o papel — e um XML anônimo no acervo é
     ruído, não nota. Devolver nulo aqui deixa quem chamou seguir para o nome do
     arquivo, que é o que ele já fazia antes. */
  if (!cnpj && !daChave) return null;

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

/**
 * O LINK QUE É A NOTA — para o e-mail que não anexa nada.
 *
 * Metade dos emissores de NFS-e não manda arquivo: manda endereço. O Bling
 * escreve "Visualizar DANFE"; a Davam, que fatura a BuzzLead, escreve "Segue o
 * Link da Nota Fiscal" e um `/pdf/nfse/<id>/<id>`. Conferido em 27/08/2026: o
 * link da BuzzLead responde 200 com `application/pdf`, 40 KB, sem login. A nota
 * estava a um GET de distância e o acervo a registrava como "sem arquivo".
 *
 * O QUE ENTRA, e por que a lista é curta: só o que já se anuncia como documento
 * — termina em `.pdf`/`.xml`, ou tem `nfe|nfse|danfe|nota` no CAMINHO da URL.
 * Um e-mail de cobrança é cheio de link (rastreio, descadastro, "acesse o
 * portal", logotipo), e baixar tudo encheria o bucket de HTML.
 *
 * A EXTENSÃO PODE ESTAR NO CAMINHO, e não no fim do nome. O eNotas — o gateway
 * por onde GetDemo, ZapSign, ContaAzul, NALK, Hult e Reportei emitem — serve a
 * MESMA nota em dois endereços que só diferem no último segmento:
 *
 *   https://api.enotasgw.com.br/file/<id>/<id>/<id>/pdf   ← "Visualizar PDF"
 *   https://api.enotasgw.com.br/file/<id>/<id>/<id>/xml   ← "Baixar XML"
 *
 * Não há ponto em lugar nenhum, e o caminho não diz "nota": exigir `.pdf` no
 * fim descartava os dois. Medido em 28/08/2026: os dois respondem 200 com o
 * documento, sem login, dois meses depois do e-mail — e eram 39 notas de seis
 * fornecedores que o acervo contava como "sem arquivo", 14 delas com o título
 * já casado esperando só o papel.
 *
 * O PDF VEM NA FRENTE porque é a ordem do e-mail ("Visualizar PDF - Baixar
 * XML"), e é ele que alguém abre no ERP. O XML entra logo atrás e serve de
 * segunda tentativa se o primeiro falhar.
 *
 * `extras` É A OUTRA METADE, e sem ela nada disto adianta. Um e-mail só de
 * HTML — o normal de quem emite por gateway — escreve o endereço DENTRO da
 * tag, e o varredor de texto lê "Visualizar PDF" sem ler para onde. Quem
 * separa os `href` é `_shared/gmail.ts`, e os entrega por aqui. Medido:
 * `link_documento` estava preenchido em 4 linhas de 306 no acervo inteiro.
 *
 * O QUE SAI SEMPRE: o próprio Gmail (o `link` da linha já é isso) e os
 * encurtadores de rastreio, que respondem 200 para qualquer coisa e devolvem
 * uma página. `ehHtml` ainda segura no download, mas gastar a requisição para
 * descobrir isso é desperdício por e-mail.
 */
const LINK_FORA = /mail\.google\.com|googleusercontent|list-manage|sendgrid|mailchimp|hubspotlinks|doubleclick|unsubscribe|descadastr/i;
/* O segmento tem de FECHAR: `/nfse/` vale, "conferencia" não. Sem isso "nfe"
   casa dentro de qualquer palavra e o varredor baixa o rodapé do e-mail.
   `[/.]` no primeiro ramo aceita as duas grafias do formato: `nota.pdf` (o
   nome do arquivo) e `/…/pdf` (o formato como último segmento, que é o eNotas). */
const LINK_DOCUMENTO = /[/.](?:pdf|xml)(?:$|[?#])|\/(?:nfe|nfse|nfs-e|danfe|notafiscal|nota-fiscal|nota)(?:[/.?#-]|$)/i;

export function linksDeNota(
  texto: string | null | undefined,
  extras?: readonly string[] | null,
): string[] {
  const doTexto = [...String(texto ?? "").matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map((m) => m[0]);
  const achados: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of [...doTexto, ...(extras ?? [])]) {
    // Pontuação de fim de frase gruda na URL quando ela fecha o parágrafo.
    const url = String(bruto ?? "").trim().replace(/[.,;:]+$/, "");
    if (!/^https?:\/\//i.test(url)) continue;
    if (url.length > 900 || vistos.has(url)) continue;
    if (LINK_FORA.test(url)) continue;
    if (!LINK_DOCUMENTO.test(url)) continue;
    vistos.add(url);
    achados.push(url);
    if (achados.length >= 5) break;
  }
  return achados;
}

/**
 * "5,693.73" — o número escrito à americana.
 *
 * `valorBR` faria disso R$ 5,69: para ele o ponto é milhar e a vírgula é
 * decimal, exatamente ao contrário. Ler a fatura do HubSpot com o parser
 * errado não devolve erro — devolve um valor mil vezes menor, que não casa com
 * nada e não acusa nada.
 */
function valorEN(s: string): number | null {
  const n = Number(s.replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

/**
 * O número quando NÃO SE SABE de que país ele é.
 *
 * "US$ 5.693,73" é uma frase real da fatura do HubSpot: moeda americana,
 * pontuação brasileira — a empresa emite em dólar e localiza o documento para
 * o cliente. Assumir formato pelo símbolo da moeda foi o erro que isto conserta:
 * o parser americano leu "5.693,73" e devolveu **5,69**, mil vezes menor. Não
 * deu erro, não ficou nulo; casou com um título de R$ 10,30 e ninguém veria.
 *
 * A regra que funciona sem saber o país: **o ÚLTIMO separador é o decimal**.
 * "5.693,73" e "5,693.73" dão os dois 5693.73; o que vier antes é milhar, seja
 * ponto ou vírgula.
 *
 * Exigir DUAS casas depois do último separador é o que separa dinheiro de
 * quantidade: "2.000 Contatos de marketing" está na mesma fatura e não é valor.
 */
function numeroDeQualquerLugar(s: string): number | null {
  const t = s.trim();
  const ultimo = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  if (ultimo < 0) return null;
  if (t.length - ultimo - 1 !== 2) return null;
  const n = Number(`${t.slice(0, ultimo).replace(/[.,]/g, "")}.${t.slice(ultimo + 1)}`);
  return isFinite(n) ? n : null;
}

/** Dinheiro com centavos, em qualquer das duas pontuações. */
const DINHEIRO = String.raw`\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2}`;

export type ValorComMoeda = { valor: number; moeda: "BRL" | "USD" | "EUR" };

/**
 * O VALOR E A MOEDA, quando o documento não é brasileiro.
 *
 * HubSpot, Datadog e Campbells mandam invoice em dólar, e o corpo delas nunca
 * escreve "R$". Como `lerCorpoDeEmail` só procurava por "R$", as invoices
 * entravam no acervo com valor NULO — e sem valor nenhuma regra do casador
 * alcança. Medido em 27/08/2026: 483 notas com arquivo e sem valor.
 *
 * A ORDEM IMPORTA e é o cuidado central: "R$" ganha de tudo. Uma NFS-e
 * brasileira que cite "US$" numa observação continua sendo lida em reais; só o
 * documento SEM real nenhum é lido como estrangeiro.
 *
 * "$" sozinho só vale na ausência de "R$" no texto inteiro — senão o cifrão de
 * "R$ 1.000,00" seria lido como dólar em todo boleto do país.
 *
 * OS RÓTULOS VÊM EM ORDEM DE PREFERÊNCIA, e o zero NÃO conta. Este é o ponto
 * que custou caro: a fatura do HubSpot já paga escreve
 *
 *     Total devido US$ 0,00     Valor pago (USD) US$ 5.693,73
 *
 * Procurar "total" primeiro e aceitar o que vier devolve **zero** — e zero vira
 * `null`, então a nota entra muda no acervo com o valor impresso na cara dela.
 * Por isso a busca percorre os rótulos em ordem e PULA os que derem zero: numa
 * fatura paga o número é o "valor pago"; numa em aberto, o "total devido".
 */
export function valorComMoeda(texto: string | null | undefined): ValorComMoeda | null {
  const t = String(texto ?? "").replace(/\s+/g, " ");
  if (!t) return null;

  /* A marca da moeda é obrigatória: sem ela não há como saber se "1,00" é real,
     dólar ou um número solto. `R$` é opcional só no ramo brasileiro, onde a
     ausência de qualquer outra marca já responde a pergunta. */
  const MARCA = String.raw`R\$|US\$|USD|EUR|€|\$`;
  const ROTULOS = [
    String.raw`valor\s+pago|amount\s+paid|total\s+paid|valor\s+l[íi]quido`,
    String.raw`total\s+devido|amount\s+due|total\s+due|balance\s+due`,
    String.raw`invoice\s+total|grand\s+total|valor\s+total|valor\s+da\s+fatura|total|valor`,
  ];

  /* DOCUMENTO QUE TEM "R$" É DOCUMENTO EM REAL, e nele só vale número marcado
     com R$. Sem esta guarda, "Total R$ (a definir) $99.00" — nota brasileira
     cujo total não saiu — seria lida como R$ 9.900 pelo cifrão solto adiante. */
  const emReal = /R\$/.test(t);
  const decidir = (bruto: string, marca: string): ValorComMoeda | null => {
    const m = marca.toUpperCase();
    const ehReal = m.includes("R$");
    if (emReal && !ehReal) return null;
    const v = ehReal ? valorBR(bruto) : numeroDeQualquerLugar(bruto);
    if (v === null || v <= 0) return null;
    if (ehReal) return { valor: v, moeda: "BRL" };
    return { valor: v, moeda: m.includes("EUR") || m.includes("€") ? "EUR" : "USD" };
  };

  for (const rot of ROTULOS) {
    const re = new RegExp(String.raw`(?:${rot})[^\d]{0,40}(${MARCA})\s*(${DINHEIRO})`, "gi");
    for (const m of t.matchAll(re)) {
      const achado = decidir(m[2], m[1]);
      if (achado) return achado;
    }
  }

  /* Sem rótulo nenhum: o primeiro valor com marca. É o caso do recibo curto
     ("foi cobrado com US$ 5.693,73"), que não tem tabela nem total. */
  for (const m of t.matchAll(new RegExp(String.raw`(${MARCA})\s*(${DINHEIRO})`, "gi"))) {
    const achado = decidir(m[2], m[1]);
    if (achado) return achado;
  }
  return null;
}

export type CorpoDeEmail = {
  chave: string | null;
  cnpj: string | null;
  valor: number | null;
  data: string | null;
  numero: string | null;
  /** a razão social escrita ao lado do CNPJ do fornecedor — ver `nomeDoEmitente` */
  nome: string | null;
};

/** Palavra que FECHA uma razão social. É ela que diz onde o nome termina. */
const SUFIXO_SOCIETARIO = /^(?:ltda|eireli|epp|mei|me|s\/a|s\.?a\.?|inc\.?|llc)$/i;

/**
 * Rótulo do quadro — quem vem antes dele não faz parte do nome.
 * Testado pedaço a pedaço porque o formulário escreve "Fornecedor/Prestador".
 */
const ROTULO_DO_QUADRO =
  /^(?:emitente|prestador|fornecedor|cliente|tomador|remetente|destinat[áa]rio|raz[ãa]o|social|nome|cnpj|cpf|nota|fiscal|eletr[ôo]nica|nfe|nfse|nfs-?e|danfe)$/i;

/** Conector não abre razão social: "da ACME LTDA" é "ACME LTDA". */
const CONECTOR = /^(?:de|da|do|das|dos|e|a|o|em|para|pela|pelo|por|com)$/i;

/**
 * QUEM EMITIU, quando o e-mail vem por gateway.
 *
 * O remetente do e-mail não é o fornecedor: as 39 notas do eNotas chegaram
 * assinadas por "Nota Gateway" e "eNotas", e era esse o nome que ia para o
 * acervo — para a linha do ERP, para a busca por fornecedor e para quem
 * precisa achar o título no Omie. O nome de verdade está escrito no e-mail,
 * colado no CNPJ:
 *
 *   Para TAKEAT TECNOLOGIA LTDA   GETDEMO TECNOLOGIA LTDA 52.874.118/0001-42
 *                                 └──────── isto ────────┘
 *
 * O NOME TERMINA NO SUFIXO SOCIETÁRIO, e é só por isso que dá para saber onde
 * ele COMEÇA: anda-se para trás a partir do "LTDA" que fecha, e para-se no
 * rótulo do quadro ou no sufixo do nome ANTERIOR — que é o nosso, escrito ali
 * do lado em todo e-mail de nota. Sem esse freio, "Para TAKEAT TECNOLOGIA LTDA
 * GETDEMO TECNOLOGIA LTDA" viraria um nome só.
 *
 * SEM SUFIXO, DEVOLVE NULO. Um nome errado é pior do que o remetente: ele tem
 * cara de certo e carimba a nota com um fornecedor que não existe.
 *
 * O QUE ELE NÃO SABE FAZER: separar prosa do nome. "…emitida pela ACME LTDA"
 * volta com o "emitida pela" grudado, porque nada ali diz onde a frase acaba e
 * o nome começa. Isto foi escrito para o QUADRO — o formulário e o template de
 * gateway, onde o nome vem depois de um rótulo ou depois do nosso —, que é de
 * onde vêm as 39 notas que motivaram a função. Quem chama trata o resultado
 * como palpite melhor que o remetente, não como verdade do documento: o XML e
 * o DANFE continuam ganhando dele em `gmail-nf-sync`.
 */
export function nomeDoEmitente(texto: string | null | undefined, cnpj: string | null | undefined): string | null {
  const t = String(texto ?? "").replace(/\s+/g, " ");
  const doc = String(cnpj ?? "").replace(/\D/g, "");
  if (!t || doc.length !== 14) return null;

  // Onde ESTE CNPJ está escrito: o nome é o que vem imediatamente antes dele.
  let pos = -1;
  for (const m of t.matchAll(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g)) {
    if (soDigitos(m[0]) === doc) { pos = m.index ?? -1; break; }
  }
  if (pos < 0) return null;

  const antes = t.slice(Math.max(0, pos - 200), pos)
    .replace(/\b(?:cnpj|cpf)\b\s*[:.-]?\s*$/i, "")
    .trim();
  const palavras = antes.split(" ").filter(Boolean);
  const limpo = (i: number) => palavras[i].replace(/^[-–|(]+|[-–|),;:.]+$/g, "");

  let fim = palavras.length - 1;
  while (fim >= 0 && !limpo(fim)) fim--;
  if (fim < 0 || !SUFIXO_SOCIETARIO.test(limpo(fim))) return null;

  /* O bloco que fecha o nome pode ser mais de uma palavra: "LTDA - ME" é o
     mesmo nome, e a Reportei assina exatamente assim. */
  let bloco = fim;
  while (bloco - 1 >= 0 && (!limpo(bloco - 1) || SUFIXO_SOCIETARIO.test(limpo(bloco - 1)))) bloco--;

  let ini = bloco;
  for (let k = bloco - 1; k >= 0 && bloco - k <= 8; k--) {
    const p = limpo(k);
    if (!p) continue;                                             // separador solto
    if (p.split(/[/|]/).some((x) => ROTULO_DO_QUADRO.test(x))) break;
    if (SUFIXO_SOCIETARIO.test(p)) break;                         // acabou o nome ANTERIOR
    if (!/^[\p{L}\p{N}&.,'/-]+$/u.test(p)) break;
    ini = k;
  }
  while (ini < bloco && CONECTOR.test(limpo(ini))) ini++;
  if (ini >= bloco) return null;                                  // só sufixo, sem nome

  const nome = palavras.slice(ini, fim + 1).join(" ").replace(/^[\s,;-]+|[\s,;-]+$/g, "");
  return nome.length >= 4 ? nome.slice(0, 120) : null;
}

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
    /* Só o nome escrito ao lado DESTE CNPJ. O da chave de acesso não serve
       aqui: a chave prova quem emitiu, mas não escreve o nome em lugar nenhum. */
    nome: nomeDoEmitente(t, cnpj),
  };
}

export type ParcelaDaNota = { numero: number; vencimento: string | null; valor: number | null };

export type NotaDeEmailOmie = {
  emitente: string | null;
  cnpj: string | null;
  /** sem os zeros à esquerda — o e-mail escreve "0000000000635" */
  numero: string | null;
  /** os 50 dígitos do Código de Verificação, quando o município usa o padrão nacional */
  chave: string | null;
  /** ISO, da emissão */
  emissao: string | null;
  /** o VALOR DA NOTA, que é o bruto */
  valor: number | null;
  inscricaoMunicipal: string | null;
  rps: string | null;
  ordemServico: string | null;
  parcelas: ParcelaDaNota[];
  /**
   * ESTE E-MAIL ENTREGA A NOTA, ou fala dela?
   *
   * O quadro NÃO responde isso: o aviso de vencimento e o lembrete repetem o
   * mesmo quadro, campo por campo, com o mesmo código de verificação. Foi o que
   * gerou seis "documentos" para a NFS-e 927 numa primeira rodada — seis papéis
   * idênticos disputando um título só.
   *
   * Quem responde é a primeira frase, que o próprio Omie escreve: a entrega diz
   * "Este e-mail é um comprovante da emissão da NFS-e Nº 635"; o recado diz "é
   * um aviso de que o pix … vencerá hoje" ou "Gostaríamos de lembrar".
   */
  entrega: boolean;
};

/**
 * O E-MAIL DE EMISSÃO DO OMIE É A NOTA ESCRITA EM TEXTO.
 *
 * Todo fornecedor que emite pelo Omie manda o mesmo e-mail — "Este e-mail é um
 * comprovante da emissão da NFS-e Nº 635" — e nele um quadro rotulado com
 * emitente, CNPJ, número, valor, código de verificação, data de emissão e a
 * tabela de parcelas. Não vem anexo: vem um botão para o Portal Omie.
 *
 * E O BOTÃO NÃO LEVA A ARQUIVO NENHUM, medido em 28/08/2026: `portal.omie.com.br
 * /view/…` é uma página vazia que monta em JavaScript, e a API dela
 * (`portalapi.omie.com.br/api/portal/payment/<data>/<hash>`) responde
 * `403 recaptcha_challenge_required`. O outro link do e-mail vai para
 * `nfse.gov.br/ConsultaPublica?chave=…`, que pede hCaptcha. Os dois caminhos até
 * o PDF estão atrás de captcha — então o que se pode ler é este texto aqui.
 *
 * POR QUE `lerCorpoDeEmail` NÃO BASTAVA, e o estrago era silencioso:
 *   • o valor. O Omie escreve `Valor da Nota R$ 12000.00` — rótulo separado do
 *     número por uma célula, e pontuação americana. O varredor genérico procura
 *     `R$ 12.000,00` e voltava NULO: a nota de agosto da Victoria Partners
 *     entrou no acervo muda, com o valor impresso na cara dela;
 *   • o casamento errado. Quem tinha "R$ 11.262,00" escrito à brasileira era o
 *     AVISO DE VENCIMENTO, mandado dias depois. Resultado: o recado casou com o
 *     título e a nota não — nove títulos da Victoria Partners, R$ 101.358, com
 *     um anexo só entre eles;
 *   • a chave. Ver `ehChaveNfse` acima.
 *
 * O RETORNO É NULO quando o e-mail não é esse: só se lê o quadro quando o
 * quadro existe, e a leitura genérica continua respondendo por todo o resto.
 */
export function lerEmailOmie(texto: string | null | undefined): NotaDeEmailOmie | null {
  const t = String(texto ?? "").replace(/\s+/g, " ");
  /* A assinatura do template, e não a palavra "NFS-e": o aviso de vencimento e o
     lembrete falam de NFS-e o tempo todo e não trazem quadro nenhum. */
  if (!/Emitente\s/i.test(t) || !/N[úu]mero da Nota\s/i.test(t)) return null;

  const campo = (rotulo: string, valor: string): string | null =>
    t.match(new RegExp(`${rotulo}\\s+(${valor})`, "i"))?.[1]?.trim() ?? null;

  /* O emitente vai até o rótulo seguinte: no quadro ele é a única célula de
     linha inteira, e o que vem depois é sempre "CNPJ". */
  const emitente = t.match(/Emitente\s+(.{2,120}?)\s+CNPJ\b/i)?.[1]?.trim() ?? null;

  const numeroCru = campo(String.raw`N[úu]mero da Nota`, String.raw`\d{1,15}`);
  const valorCru = campo(String.raw`Valor da Nota\s*R\$`, DINHEIRO);
  const emissao = campo(String.raw`Data de Emiss[ãa]o`, String.raw`\d{2}/\d{2}/\d{4}`);

  /* A TABELA DE PARCELAS é o vencimento e o LÍQUIDO — na nota com ISS retido os
     dois valores são diferentes e os dois estão certos (R$ 12.000,00 de serviço,
     R$ 11.262,00 a pagar). Guardar os dois é o que deixa o casador escolher: o
     título no contas a pagar nasce pelo líquido. */
  const parcelas: ParcelaDaNota[] = [];
  const tabela = t.match(/Parcela\s+Vencimento\s+Valor[^\d]{0,12}(.*)$/i)?.[1] ?? "";
  const linha = new RegExp(String.raw`\b(\d{1,3})\s+(\d{2}/\d{2}/\d{4})\s+(${DINHEIRO})`, "g");
  for (const m of tabela.matchAll(linha)) {
    parcelas.push({ numero: Number(m[1]), vencimento: dataISO(m[2]), valor: numeroDeQualquerLugar(m[3]) });
    if (parcelas.length >= 60) break;
  }

  return {
    emitente,
    cnpj: campo("CNPJ", String.raw`[\d./-]{14,18}`)?.replace(/\D/g, "") ?? null,
    numero: numeroCru ? String(Number(numeroCru)) : null,
    chave: chaveNfse(t),
    emissao: emissao ? dataISO(emissao) : null,
    valor: valorCru ? numeroDeQualquerLugar(valorCru) : null,
    inscricaoMunicipal: campo(String.raw`Inscri[çc][ãa]o Municipal`, String.raw`[\w.\-/]{1,20}`),
    rps: campo(String.raw`N[ºo°.]{1,2}\s*da RPS`, String.raw`\d{1,15}`),
    ordemServico: campo(String.raw`Ordem de Servi[çc]o`, String.raw`\d{1,15}`),
    parcelas,
    entrega: /comprovante d[ae] emiss[ãa]o/i.test(t),
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
