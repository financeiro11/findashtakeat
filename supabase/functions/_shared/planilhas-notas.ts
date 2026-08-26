/* ---------------------------------------------------------------------------
 * As cinco planilhas de formulário viram NOTAS FISCAIS com link.
 *
 * O irmão deste arquivo, `planilhasApelidos.ts`, lê as MESMAS planilhas para
 * outra pergunta ("quem é esta contraparte?"). Aqui a pergunta é outra: **onde
 * está a nota deste pagamento?** — e por isso o que importa não é o apelido, e
 * sim o par (o que foi pago, qual arquivo prova).
 *
 * O que cada linha de formulário tem, e que o extrato nunca terá: o CNPJ que o
 * colaborador digitou, o valor exato da nota, e o arquivo que ele anexou. Isso
 * é evidência, não palpite — e é a razão de existirem 2.000 linhas destas
 * enquanto a auditoria do PIX segue perguntando "cadê a nota?".
 *
 * O QUE ELE NÃO FAZ: casar com o lançamento. Isso precisa do banco e mora na
 * RPC `planilhas_notas_casar`. Aqui sai a NOTA, com as chaves de busca que ela
 * oferece (CNPJ, valor, data, nome), e quem decide é lá.
 *
 * ---------------------------------------------------------------------------
 * AS TRÊS ARMADILHAS QUE SÓ APARECERAM NO DADO REAL:
 *
 * 1. **A ordem da data muda de planilha para planilha — e, em Eventos, de
 *    LINHA para linha.** Reembolsos veio de um formulário em locale americano
 *    ("11/19/2024", 316 linhas provam `mm/dd`); Compras, NFs de colaboradores e
 *    Parceiros são `dd/mm` (439 linhas provam). E Eventos tem os dois: 327
 *    linhas com hora, todas `mm/dd`, e 121 sem hora, todas `dd/mm` — são duas
 *    safras de formulário na mesma aba. Ler tudo como `dd/mm` jogaria 181
 *    linhas de Eventos e 316 de Reembolsos para o mês errado, e um mês errado
 *    aqui é a nota casando com o pagamento errado. Por isso `ordemDasDatas`
 *    INFERE a ordem em vez de assumi-la, e infere separando por "tem hora".
 *
 * 2. **O link não mora só na coluna de upload.** Em Reembolsos há DUAS colunas
 *    de arquivo (497 + 279), e em 14 linhas alguém colou o link dentro da
 *    descrição; em Eventos, 24 vêm na observação. Varre-se a linha inteira.
 *
 * 3. **Uma linha pode ter vários arquivos** (17 em Compras): o Forms separa por
 *    vírgula dentro da mesma célula. Cada arquivo vira uma nota própria, com
 *    `ordem` dizendo qual é — porque quem anexa no ERP anexa um por vez.
 *
 * ESTE É O GÊMEO EM DENO de `src/lib/planilhasNotas.ts`. Cópia verbatim: só a
 * linha do `import` muda, porque Deno e Vite não dividem módulo. Quem tem
 * teste é o original (`src/lib/planilhasNotas.test.ts`, 32 casos tirados de
 * linhas reais das cinco planilhas) — mexeu aqui, mexa lá e rode os testes.
 * ------------------------------------------------------------------------- */

import {
  cnpjsEm, coluna, emRegistros, juntarDetalhes, nomeProprio, numeroBR, soDigitos,
  type Registro,
} from "./planilhas-apelidos.ts";

export type FonteNota =
  | "compras" | "reembolsos" | "nfs_colaboradores" | "eventos" | "parceiros";

export const FONTES: { fonte: FonteNota; id: string; rotulo: string }[] = [
  { fonte: "compras", id: "1Y2jvIpZDrwe30z3M_UVazzBv2BrtJJujT-S0SUt2JqM", rotulo: "Formulário de Compras" },
  { fonte: "reembolsos", id: "1P7O1xRyrybuDQOfw3WIRkne15FOM7bBPMTWweMrCulA", rotulo: "Reembolsos Takeat - NFs" },
  { fonte: "nfs_colaboradores", id: "1jd0-LRwWdElNBttQP0z-8bv_rJ-Hh92aX9eE2pL9uwc", rotulo: "NFS-e (colaboradores)" },
  { fonte: "eventos", id: "1TQU3dph4qOTUpOXPCwp-bahVRxEORE9DjGKX3RRuCNs", rotulo: "NFs - Eventos & Parcerias" },
  { fonte: "parceiros", id: "1A_J9MPtdpCqA0PrafjA28KT-3HMBuQyGOtSCjZTfEEU", rotulo: "NFs - Parceiros (Novo)" },
];

export type NotaPlanilha = {
  fonte: FonteNota;
  /** número da linha na planilha (2 = primeira linha de dados), para achar de volta */
  linha: number;
  /** qual arquivo desta linha — 1 quando só há um */
  ordem: number;
  /** chave estável: `fonte|linha|driveId`. É o `on conflict` do upsert. */
  chave: string;
  /** quando o formulário foi enviado (ISO) — NÃO é a data do pagamento */
  enviadoEm: string | null;
  nome: string | null;
  /** CNPJ de quem emitiu, 14 dígitos */
  cnpj: string | null;
  /** a chave PIX quando ela é um documento — é para ONDE o dinheiro foi */
  documento: string | null;
  /** o valor da nota */
  valor: number | null;
  /** a parcela, quando o formulário a declara — é ela que aparece na fatura */
  valorParcela: number | null;
  /** "Cartão de Crédito", "PIX", "Boleto"… — separa o alvo antes de casar */
  formaPagamento: string | null;
  /** "2026-06", quando dá para resolver */
  competencia: string | null;
  oQueE: string | null;
  detalhe: string | null;
  /** o que a automação que já existe escreveu de volta na planilha */
  statusPlanilha: string | null;
  /** a planilha AFIRMA que a nota já foi anexada no ERP — o alvo do double check */
  dizAnexado: boolean;
  /** id do arquivo no Drive */
  driveId: string;
  /** link canônico de visualização */
  link: string;
};

/* -------------------------------------------------------------------------
 * Datas
 * ---------------------------------------------------------------------- */

type Ordem = "dmy" | "mdy";

/** Separa "30/06/2026 10:39:03" em partes, sem decidir quem é dia e quem é mês. */
function partes(s: string | null | undefined): { a: number; b: number; ano: string; temHora: boolean } | null {
  const t = String(s ?? "").trim();
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!m) return null;
  return { a: Number(m[1]), b: Number(m[2]), ano: m[3], temHora: /\d{1,2}:\d{2}/.test(t) };
}

/**
 * Infere `dd/mm` ou `mm/dd` OLHANDO O CONJUNTO, e não o palpite de quem lê.
 *
 * Um componente maior que 12 só pode ser dia — é essa a prova. Um grupo sem
 * nenhuma prova cai em `dd/mm`, que é o formulário em português.
 *
 * A separação por "tem hora" existe porque a aba de Eventos tem duas safras
 * misturadas: o carimbo automático (com hora, americano) e a data digitada à
 * mão numa migração antiga (sem hora, brasileira). Sem separar, a evidência de
 * um grupo contamina o outro e metade das linhas vira mês errado.
 */
export function ordemDasDatas(valores: (string | null | undefined)[]): (s: string | null | undefined) => string | null {
  const votos = { comHora: { dmy: 0, mdy: 0 }, semHora: { dmy: 0, mdy: 0 } };
  for (const v of valores) {
    const p = partes(v);
    if (!p) continue;
    const alvo = p.temHora ? votos.comHora : votos.semHora;
    if (p.a > 12) alvo.dmy++;
    else if (p.b > 12) alvo.mdy++;
  }
  const decidir = (v: { dmy: number; mdy: number }): Ordem => (v.mdy > v.dmy ? "mdy" : "dmy");
  const comHora = decidir(votos.comHora);
  const semHora = decidir(votos.semHora);

  return (s) => {
    const p = partes(s);
    if (!p) return null;
    const ordem = p.temHora ? comHora : semHora;
    const [d, mes] = ordem === "dmy" ? [p.a, p.b] : [p.b, p.a];
    if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
    return `${p.ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * "Junho", "2026-06", "06/2026" -> "2026-06".
 *
 * Metade dos formulários pergunta o mês pelo NOME e não pede o ano — o ano sai
 * da data de envio. E quando o mês declarado é maior que o mês do envio, é do
 * ano anterior: quem manda a nota de dezembro em janeiro está fechando o ano
 * passado, não adiantando onze meses.
 */
export function competenciaDe(texto: string | null | undefined, enviadoEm: string | null): string | null {
  const t = String(texto ?? "").trim();
  if (!t) return null;

  const iso = t.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;

  const br = t.match(/^(\d{1,2})[/-](\d{4})$/);
  if (br) return `${br[2]}-${String(Number(br[1])).padStart(2, "0")}`;

  /* A faixa de acentos vai em ESCAPE (`\u0300-\u036f`) e nunca com o caractere
     combinante literal — ele não sobrevive a uma cópia entre arquivos, e este
     módulo tem um gêmeo em Deno que é feito exatamente de cópia. */
  const semAcento = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const alvo = semAcento(t);
  const i = MESES.findIndex((m) => alvo.startsWith(semAcento(m)));
  if (i < 0) return null;

  const base = enviadoEm ? new Date(`${enviadoEm}T12:00:00Z`) : null;
  if (!base || isNaN(base.getTime())) return null;
  const anoEnvio = base.getUTCFullYear();
  const mesEnvio = base.getUTCMonth() + 1;
  const ano = i + 1 > mesEnvio ? anoEnvio - 1 : anoEnvio;
  return `${ano}-${String(i + 1).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------
 * Arquivos
 * ---------------------------------------------------------------------- */

/**
 * Todo arquivo do Drive citado no texto, em ordem e sem repetir.
 *
 * O Forms grava `open?id=`, mas gente colando link à mão traz `/file/d/<id>/`
 * e `uc?id=`. Só o ID importa — é ele que dá o link canônico e a chave estável.
 */
export function drivesEm(texto: string | null | undefined): string[] {
  const out: string[] = [];
  const visto = new Set<string>();
  const s = String(texto ?? "");
  const padroes = [
    /drive\.google\.com\/open\?id=([\w-]{15,})/gi,
    /drive\.google\.com\/file\/d\/([\w-]{15,})/gi,
    /drive\.google\.com\/uc\?(?:export=\w+&)?id=([\w-]{15,})/gi,
    /drive\.google\.com\/drive\/folders\/([\w-]{15,})/gi,
  ];
  for (const re of padroes) {
    for (const m of s.matchAll(re)) {
      if (visto.has(m[1])) continue;
      visto.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

export const linkDoDrive = (id: string) => `https://drive.google.com/file/d/${id}/view`;

/** Todos os arquivos da linha, varrendo TODAS as colunas (ver armadilha 2). */
function arquivosDaLinha(r: Registro): string[] {
  const out: string[] = [];
  const visto = new Set<string>();
  for (const v of Object.values(r)) {
    for (const id of drivesEm(v)) {
      if (visto.has(id)) continue;
      visto.add(id);
      out.push(id);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------
 * "A planilha diz que já anexou"
 * ---------------------------------------------------------------------- */

/**
 * A automação que já existe escreve o desfecho na própria planilha: "Anexado! ✓"
 * (527 linhas), "Lançado e Anexado!!!" (58), "PAGO! Em 20/08".
 *
 * Isso não é prova — é PROMESSA, e é justamente o que o double check verifica
 * contra o `ListarAnexo` do ERP. Uma linha que diz "Anexado!" e um título sem
 * anexo nenhum é o achado mais valioso desta esteira inteira.
 */
export function dizQueAnexou(status: string | null | undefined): boolean {
  const t = String(status ?? "").toLowerCase();
  if (!t) return false;
  if (/erro|falha|reprovado|não encontrado|nao encontrado|duplicad|aguardando|conferir/.test(t)) {
    // "Lançado e Anexado!!! | - erro ao parsear resposta IA" anexou e depois
    // tropeçou na categoria: o anexo aconteceu, o erro é de outra etapa.
    return /anexad/.test(t);
  }
  return /anexad|anexou/.test(t);
}

/* -------------------------------------------------------------------------
 * O extrator
 * ---------------------------------------------------------------------- */

type Mapa = {
  /** rótulos aceitos para cada campo, em ordem de preferência */
  nome: string[];
  cnpj: string[];
  documento: string[];
  valor: string[];
  parcela: string[];
  forma: string[];
  competencia: string[];
  oQueE: string[];
  detalhe: string[];
  status: string[];
};

const VAZIO: string[] = [];

/**
 * Onde cada campo mora, planilha por planilha.
 *
 * É uma tabela e não um `if` por fonte porque as perguntas mudam de texto sem
 * avisar — `coluna()` casa por PEDAÇO do rótulo, então "valor da nf" continua
 * achando a coluna depois que alguém acrescenta "(apenas número e vírgula)".
 */
const MAPAS: Record<FonteNota, Mapa> = {
  compras: {
    nome: ["nome completo"],
    cnpj: VAZIO,           // o formulário de compras não pergunta CNPJ
    documento: VAZIO,
    valor: ["valor ("],
    parcela: ["valor da parcela"],
    forma: ["forma de pagamento"],
    competencia: VAZIO,
    oQueE: ["tipo de compra"],
    detalhe: ["justificativa", "site em que"],
    status: VAZIO,
  },
  reembolsos: {
    nome: ["nome completo"],
    cnpj: ["cnpj"],
    documento: VAZIO,
    valor: ["valor total do reembolso", "valor"],
    parcela: VAZIO,
    forma: VAZIO,
    competencia: VAZIO,
    oQueE: ["motivo do reembolso"],
    detalhe: ["descrição do reembolso"],
    status: ["status auto"],
  },
  nfs_colaboradores: {
    nome: ["nome completo"],
    cnpj: ["número cnpj", "cnpj"],
    documento: VAZIO,
    valor: ["informe o valor", "valor"],
    parcela: VAZIO,
    forma: VAZIO,
    competencia: ["mês de competência", "competência"],
    oQueE: ["a nota se refere"],
    detalhe: ["desabafar"],
    status: ["status automa"],
  },
  eventos: {
    nome: ["nome da consultoria"],
    cnpj: ["cnpj do beneficiário", "cnpj"],
    documento: VAZIO,
    valor: ["valor da nf", "valor"],
    parcela: VAZIO,
    forma: VAZIO,
    competencia: ["mes de referência", "mês de referência"],
    oQueE: ["canal", "beneficiário"],
    detalhe: ["observações"],
    status: VAZIO,
  },
  parceiros: {
    nome: ["nome do parceiro"],
    cnpj: ["cnpj"],
    // A chave PIX é para ONDE o dinheiro saiu — vale mais que o CNPJ do
    // emitente quando os dois discordam (e discordam: há linha com NF de um
    // CNPJ e pagamento na chave de outro).
    documento: ["chave pix"],
    valor: ["valor (somente", "valor"],
    parcela: VAZIO,
    forma: VAZIO,
    competencia: ["competencia", "competência"],
    oQueE: ["categoria"],
    detalhe: ["detalhamento", "observações"],
    status: ["status automa"],
  },
};

/** Primeiro CNPJ achado na coluna, ou no texto dela quando vem enterrado. */
function cnpjDaColuna(r: Registro, chave: string): string | null {
  if (!chave) return null;
  const achados = cnpjsEm(r[chave]);
  if (achados.length) return achados[0];
  // CPF de 11 dígitos não é CNPJ, mas é documento — quem trata é `documentoDe`.
  return null;
}

/** CNPJ ou CPF: a chave PIX pode ser qualquer um dos dois. */
function documentoDe(texto: string | null | undefined): string | null {
  const d = soDigitos(texto);
  if (d.length === 14 || d.length === 11) return d;
  const cnpj = cnpjsEm(texto);
  return cnpj.length ? cnpj[0] : null;
}

/**
 * A planilha inteira vira notas. Uma nota por ARQUIVO — linha com dois anexos
 * dá duas, porque quem anexa no ERP anexa um por vez.
 */
export function notasDaPlanilha(fonte: FonteNota, csv: string): NotaPlanilha[] {
  const regs = emRegistros(csv);
  if (!regs.length) return [];

  const mapa = MAPAS[fonte];
  const cabecalho = regs[0];
  const cData = Object.keys(cabecalho)[0]; // "Carimbo de data/hora" | "Timestamp"
  const c = {
    nome: coluna(cabecalho, ...mapa.nome),
    cnpj: coluna(cabecalho, ...mapa.cnpj),
    documento: coluna(cabecalho, ...mapa.documento),
    valor: coluna(cabecalho, ...mapa.valor),
    parcela: coluna(cabecalho, ...mapa.parcela),
    forma: coluna(cabecalho, ...mapa.forma),
    competencia: coluna(cabecalho, ...mapa.competencia),
    oQueE: coluna(cabecalho, ...mapa.oQueE),
    status: coluna(cabecalho, ...mapa.status),
  };
  const cDetalhe = mapa.detalhe.map((p) => coluna(cabecalho, p)).filter(Boolean);

  const lerData = ordemDasDatas(regs.map((r) => r[cData]));

  const out: NotaPlanilha[] = [];
  regs.forEach((r, i) => {
    const arquivos = arquivosDaLinha(r);
    if (!arquivos.length) return; // linha sem anexo não é nota — é só um pedido

    const enviadoEm = lerData(r[cData]);
    const valor = numeroBR(r[c.valor]);
    const parcela = c.parcela ? numeroBR(r[c.parcela]) : null;
    const status = c.status ? (r[c.status] || null) : null;
    const nome = c.nome ? nomeProprio(r[c.nome]) || null : null;

    // O CNPJ pode estar na coluna certa, na chave PIX, ou enterrado no texto
    // livre — a planilha de Eventos guarda metade dos seus na observação.
    const doColuna = cnpjDaColuna(r, c.cnpj);
    const doDocumento = c.documento ? documentoDe(r[c.documento]) : null;
    const doTexto = cDetalhe.flatMap((k) => cnpjsEm(r[k]));
    const cnpj = doColuna ?? (doDocumento && doDocumento.length === 14 ? doDocumento : null) ?? doTexto[0] ?? null;

    const detalhe = juntarDetalhes(cDetalhe.map((k) => r[k]), 300);

    arquivos.forEach((driveId, ordem) => {
      out.push({
        fonte,
        linha: i + 2,
        ordem: ordem + 1,
        chave: `${fonte}|${i + 2}|${driveId}`,
        enviadoEm,
        nome,
        cnpj,
        documento: doDocumento && doDocumento !== cnpj ? doDocumento : null,
        valor,
        valorParcela: parcela && parcela !== valor ? parcela : null,
        formaPagamento: c.forma ? (r[c.forma] || null) : null,
        competencia: c.competencia ? competenciaDe(r[c.competencia], enviadoEm) : null,
        oQueE: c.oQueE ? (r[c.oQueE] || null) : null,
        detalhe,
        statusPlanilha: status,
        dizAnexado: dizQueAnexou(status),
        driveId,
        link: linkDoDrive(driveId),
      });
    });
  });
  return out;
}
