/* ---------------------------------------------------------------------------
 * As planilhas de formulário viram candidatos a apelido.
 *
 * Quatro formulários guardam TESTEMUNHO de quem gastou — o site onde comprou, a
 * justificativa escrita à mão, o CNPJ do prestador. É fonte melhor do que
 * qualquer modelo adivinhando a partir de "KAZEMHAMMOUD", e é o que faz este
 * módulo existir: ele não interpreta nada, só extrai e organiza o que já está
 * escrito.
 *
 * O QUE ELE NÃO FAZ: casar com a contraparte. Isso precisa do banco (a fatura, o
 * cache do Omie) e mora na Edge Function. Aqui saem CANDIDATOS com a chave de
 * busca — um CNPJ, um par valor+data, um nome — e quem resolve é lá.
 *
 * Puro de propósito: as planilhas são sujas de um jeito que só se descobre
 * testando (valor com vírgula e ponto, parcela com dízima, coluna deslocada,
 * CNPJ enterrado em texto livre), e nada disso se testa com HTTP no meio.
 *
 * O gêmeo em Deno está em `supabase/functions/_shared/planilhas-apelidos.ts` —
 * mesma relação que `normalize.ts` tem com `_shared/normalize.ts`.
 * ------------------------------------------------------------------------- */

export type Fonte = "compras" | "reembolsos" | "nfs_colaboradores" | "eventos";
export type ChaveTipo = "cnpj" | "valor_data" | "nome";

export type Candidato = {
  fonte: Fonte;
  chaveTipo: ChaveTipo;
  /** só dígitos, 14 posições */
  cnpj?: string | null;
  nome?: string | null;
  /** ISO, "2026-07-01" */
  data?: string | null;
  /** o valor que aparece NA FATURA — a parcela, não o total */
  valor?: number | null;
  apelido: string;
  oQueE: string | null;
  /** a frase crua de quem escreveu, para conferir de onde saiu o apelido */
  detalhe: string | null;
};

/* -------------------------------------------------------------------------
 * CSV
 * ---------------------------------------------------------------------- */

/**
 * CSV com aspas, vírgula dentro do campo e quebra de linha dentro do campo.
 *
 * Não dá para usar `split(",")`: metade das justificativas tem vírgula, e várias
 * têm parágrafo inteiro ("a. Não lembrei de pegar todas as notas :(\nb. ...").
 */
export function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

export type Registro = Record<string, string>;

/** Cabeçalho -> lista de objetos, já sem as linhas totalmente vazias. */
export function emRegistros(csv: string): Registro[] {
  const linhas = parseCsv(csv);
  if (!linhas.length) return [];
  const cab = linhas[0].map((c) => c.trim());
  return linhas.slice(1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(cab.map((c, i) => [c, (r[i] ?? "").trim()])));
}

/** Acha a coluna pelo começo do rótulo — os formulários mudam o texto da pergunta. */
export function coluna(reg: Registro | undefined, ...pedacos: string[]): string {
  if (!reg) return "";
  const chaves = Object.keys(reg);
  for (const p of pedacos) {
    const alvo = p.toLowerCase();
    const k = chaves.find((c) => c.toLowerCase().includes(alvo));
    if (k) return k;
  }
  return "";
}

/* -------------------------------------------------------------------------
 * Limpeza de campo
 * ---------------------------------------------------------------------- */

export const soDigitos = (s: string | null | undefined): string =>
  String(s ?? "").replace(/\D/g, "");

/**
 * Todo CNPJ que aparece no texto, formatado ou não.
 *
 * Precisa varrer texto livre porque metade dos CNPJs da planilha de Eventos está
 * na coluna de observação ("PIX para pagamento 34723501000118 Cuer negócios"),
 * não numa coluna própria.
 */
export function cnpjsEm(texto: string | null | undefined): string[] {
  const achados = new Set<string>();
  const s = String(texto ?? "");
  for (const m of s.matchAll(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g)) {
    const d = soDigitos(m[0]);
    if (d.length === 14) achados.add(d);
  }
  return [...achados];
}

/**
 * "1.616,56", "R$ 127.39 ", "145", "237.6633333" -> número.
 *
 * O formulário pede "apenas números e vírgula" e recebe de tudo. A regra que
 * decide: se tem vírgula, o ponto é separador de milhar; se não tem, o ponto é
 * decimal. Sem isso "R$ 127.39" (que alguém digitou com ponto) viraria 12739.
 */
export function numeroBR(s: string | null | undefined): number | null {
  let t = String(s ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  if (!isFinite(n) || n <= 0) return null;
  // A parcela vem de uma divisão feita pelo próprio formulário e chega com dízima
  // ("237.6633333"); a fatura tem duas casas.
  return Math.round(n * 100) / 100;
}

/** "30/09/2025 13:23:02" e "11/19/2024 12:27:13" -> ISO. */
export function dataDaPlanilha(s: string | null | undefined, ordem: "dmy" | "mdy" = "dmy"): string | null {
  const m = String(s ?? "").trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!m) return null;
  const a = m[3];
  const [d, mes] = ordem === "dmy" ? [m[1], m[2]] : [m[2], m[1]];
  const dd = d.padStart(2, "0");
  const mm = mes.padStart(2, "0");
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return `${a}-${mm}-${dd}`;
}

/**
 * "MICHAEL CARDOSO THOMÉ" -> "Michael Cardoso Thomé"; deixa em paz quem já veio
 * com caixa boa. Preposição de nome fica minúscula.
 */
export function nomeProprio(s: string | null | undefined): string {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  // Já tem minúscula? A pessoa escreveu com capricho — não mexer.
  if (/[a-zà-ÿ]/.test(t) && /[A-ZÀ-Ý]/.test(t)) return t;
  const miudas = new Set(["de", "da", "do", "das", "dos", "e"]);
  return t.toLowerCase().split(" ")
    .map((p, i) => (i > 0 && miudas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

/**
 * O que serve como apelido e o que é lixo da coluna "site".
 *
 * A pergunta é aberta ("indique o site em que foi realizada") e as respostas vão
 * de "Kabum" a uma URL de 300 caracteres com utm_campaign, passando por "Compra
 * foi no Hubspot, em Dólares. U$145.80" e "Não foi uma compra online".
 */
export function siteComoApelido(s: string | null | undefined): string | null {
  let t = String(s ?? "").trim();
  if (!t) return null;
  if (/^n[ãa]o foi uma compra online$/i.test(t)) return null;
  if (/^(link de pagamento|assinatura direta|compra via link)/i.test(t)) return null;

  // URL: fica só o domínio, sem www e sem o resto.
  const url = t.match(/^https?:\/\/([^/?#\s]+)/i);
  if (url) t = url[1].replace(/^www\./i, "");
  else if (/^[\w-]+(\.[\w-]+)+$/.test(t)) t = t.replace(/^www\./i, "");

  // Frase, não nome de loja. Quatro palavras é o teto do que vira rótulo.
  if (t.split(/\s+/).length > 4 || t.length > 40) return null;
  return nomeProprio(t);
}

/** Junta as frases distintas, da mais curta para a mais longa, até o teto. */
export function juntarDetalhes(frases: (string | null | undefined)[], teto = 400): string | null {
  const vistas = new Set<string>();
  const limpas: string[] = [];
  for (const f of frases) {
    const t = String(f ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (vistas.has(k)) continue;
    vistas.add(k);
    limpas.push(t);
  }
  if (!limpas.length) return null;
  limpas.sort((a, b) => a.length - b.length);

  const out: string[] = [];
  let usado = 0;
  for (const f of limpas) {
    if (usado + f.length + 3 > teto) break;
    out.push(f);
    usado += f.length + 3;
  }
  return (out.length ? out : [limpas[0].slice(0, teto)]).join(" · ");
}

/** O valor que mais aparece — usado para "o que é" quando a coluna é fechada. */
export function maisComum(valores: (string | null | undefined)[]): string | null {
  const conta = new Map<string, number>();
  for (const v of valores) {
    const t = String(v ?? "").trim();
    if (t) conta.set(t, (conta.get(t) ?? 0) + 1);
  }
  let melhor: string | null = null;
  let max = 0;
  for (const [k, n] of conta) if (n > max) { melhor = k; max = n; }
  return melhor;
}

/* -------------------------------------------------------------------------
 * 1. NFs Colaboradores — CNPJ -> pessoa. A fonte mais limpa das quatro.
 * ---------------------------------------------------------------------- */

export function candidatosDeNfsColaboradores(csv: string): Candidato[] {
  const regs = emRegistros(csv);
  if (!regs.length) return [];

  const cNome = coluna(regs[0], "nome completo", "nome");
  const cCnpj = coluna(regs[0], "cnpj");
  const cSetor = coluna(regs[0], "setor");
  const cRefere = coluna(regs[0], "a nota se refere");

  const porCnpj = new Map<string, { nome: string[]; setor: string[]; refere: string[] }>();
  for (const r of regs) {
    const cnpj = soDigitos(r[cCnpj]);
    if (cnpj.length !== 14) continue;
    const g = porCnpj.get(cnpj) ?? { nome: [], setor: [], refere: [] };
    if (r[cNome]) g.nome.push(r[cNome]);
    if (r[cSetor]) g.setor.push(r[cSetor]);
    if (r[cRefere]) g.refere.push(r[cRefere]);
    porCnpj.set(cnpj, g);
  }

  const out: Candidato[] = [];
  for (const [cnpj, g] of porCnpj) {
    const nome = nomeProprio(maisComum(g.nome) ?? "");
    if (!nome) continue;
    const setor = maisComum(g.setor);
    const refere = maisComum(g.refere);
    out.push({
      fonte: "nfs_colaboradores",
      chaveTipo: "cnpj",
      cnpj,
      apelido: nome,
      // "Remuneração — Comercial": é literalmente a resposta a "o que é este gasto".
      oQueE: [refere, setor].filter(Boolean).join(" — ") || null,
      detalhe: `NF de colaborador · ${g.nome.length} nota(s) enviada(s) pelo formulário`,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------
 * 2. Eventos & Parcerias — consultores e influenciadores.
 *
 * A planilha mais bagunçada: colunas deslocadas (o link da NF aparece onde
 * deveria estar o valor), CNPJ em texto livre e o mesmo parceiro escrito de três
 * jeitos. Por isso o CNPJ manda, e o nome sozinho nunca passa de "media".
 * ---------------------------------------------------------------------- */

export function candidatosDeEventos(csv: string): Candidato[] {
  const regs = emRegistros(csv);
  if (!regs.length) return [];

  const cNome = coluna(regs[0], "nome da consultoria");
  const cCanal = coluna(regs[0], "canal");
  const cCnpj = coluna(regs[0], "cnpj do beneficiário", "cnpj");
  const cObs = coluna(regs[0], "observações", "beneficiário");

  type Acum = { nomes: string[]; canais: string[]; obs: string[] };
  const porCnpj = new Map<string, Acum>();
  const porNome = new Map<string, Acum>();

  for (const r of regs) {
    const nome = (r[cNome] ?? "").trim();
    if (!nome || /^(cliente|garçom|garcom)$/i.test(nome)) continue;

    // O CNPJ pode estar na coluna própria OU escondido na observação.
    const cnpjs = [...cnpjsEm(r[cCnpj]), ...cnpjsEm(r[cObs])];
    const acumular = (m: Map<string, Acum>, k: string) => {
      const g = m.get(k) ?? { nomes: [], canais: [], obs: [] };
      g.nomes.push(nome);
      if (r[cCanal]) g.canais.push(r[cCanal]);
      if (r[cObs]) g.obs.push(r[cObs]);
      m.set(k, g);
    };

    if (cnpjs.length === 1) acumular(porCnpj, cnpjs[0]);
    else acumular(porNome, nome.toLowerCase().replace(/\s+/g, " "));
  }

  const rotular = (g: Acum): { apelido: string; oQueE: string | null } => {
    const bruto = maisComum(g.nomes) ?? g.nomes[0] ?? "";
    return {
      apelido: nomeProprio(bruto),
      oQueE: maisComum(g.canais) || "Consultor / parceiro de eventos",
    };
  };

  const out: Candidato[] = [];
  for (const [cnpj, g] of porCnpj) {
    const { apelido, oQueE } = rotular(g);
    if (!apelido) continue;
    out.push({
      fonte: "eventos", chaveTipo: "cnpj", cnpj, apelido, oQueE,
      detalhe: juntarDetalhes([`${g.nomes.length} NF(s) de parceria`, ...g.obs.slice(0, 2)]),
    });
  }
  for (const [, g] of porNome) {
    const { apelido, oQueE } = rotular(g);
    if (!apelido) continue;
    out.push({
      fonte: "eventos", chaveTipo: "nome", nome: apelido, apelido, oQueE,
      detalhe: juntarDetalhes([`${g.nomes.length} NF(s) de parceria`, ...g.obs.slice(0, 2)]),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------
 * 3. Reembolsos — o dinheiro vai para a PESSOA, não para o lojista.
 *
 * No Omie a contraparte de um reembolso é o colaborador. Então esta planilha não
 * nomeia o "Tudo Delícia": ela responde o que foi o PIX para a Amanda, com os
 * motivos que ela mesma escreveu.
 * ---------------------------------------------------------------------- */

export function candidatosDeReembolsos(csv: string): Candidato[] {
  const regs = emRegistros(csv);
  if (!regs.length) return [];

  const cNome = coluna(regs[0], "nome completo", "nome");
  const cSetor = coluna(regs[0], "setor");
  const cMotivo = coluna(regs[0], "motivo do reembolso");
  const cCnpj = coluna(regs[0], "cnpj");

  type Acum = { nomes: string[]; setor: string[]; motivos: string[]; cnpjs: Set<string>; n: number };
  const porPessoa = new Map<string, Acum>();

  for (const r of regs) {
    const nome = nomeProprio(r[cNome]);
    if (!nome || nome.length < 4) continue;
    // Agrupa pela grafia normalizada, mas guarda as originais: "Miguel " e
    // "miguel" são a mesma pessoa, e o rótulo sai da forma mais escrita.
    const k = nome.toLowerCase();
    const g = porPessoa.get(k) ?? { nomes: [], setor: [], motivos: [], cnpjs: new Set<string>(), n: 0 };
    g.n++;
    g.nomes.push(nome);
    if (r[cSetor]) g.setor.push(r[cSetor]);
    if (r[cMotivo]) g.motivos.push(r[cMotivo]);
    for (const c of cnpjsEm(r[cCnpj])) g.cnpjs.add(c);
    porPessoa.set(k, g);
  }

  const out: Candidato[] = [];
  for (const [, g] of porPessoa) {
    const setor = maisComum(g.setor);
    const motivos = juntarDetalhes(g.motivos, 160);
    const apelido = nomeProprio(maisComum(g.nomes) ?? "");
    if (!apelido) continue;
    const cnpj = g.cnpjs.size === 1 ? [...g.cnpjs][0] : null;
    out.push({
      fonte: "reembolsos",
      // Com CNPJ é identidade; sem, casa pelo nome e não passa de "media".
      chaveTipo: cnpj ? "cnpj" : "nome",
      cnpj,
      nome: apelido,
      apelido,
      oQueE: [setor ? `Reembolsos · ${setor}` : "Reembolsos", motivos].filter(Boolean).join(" — "),
      detalhe: `${g.n} reembolso(s) pedido(s) pelo formulário`,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------
 * 4. Compras — o único que casa por valor+data.
 *
 * Devolve UMA linha por compra (não agregado): quem casa com a fatura é a Edge
 * Function, e só depois de saber o lojista dá para agrupar. O valor devolvido é
 * o da PARCELA — é ela que aparece na fatura, e casar pelo total achava 31
 * lojistas onde a parcela acha 48.
 * ---------------------------------------------------------------------- */

export function candidatosDeCompras(csv: string): Candidato[] {
  const regs = emRegistros(csv);
  if (!regs.length) return [];

  const cData = Object.keys(regs[0])[0]; // "Carimbo de data/hora"
  const cTotal = coluna(regs[0], "valor (");
  const cParcela = coluna(regs[0], "valor da parcela");
  const cSite = coluna(regs[0], "site em que");
  const cJust = coluna(regs[0], "justificativa");
  const cTipo = coluna(regs[0], "tipo de compra");

  const out: Candidato[] = [];
  for (const r of regs) {
    const data = dataDaPlanilha(r[cData]);
    // Parcela primeiro; sem ela, o total (compra à vista tem os dois iguais).
    const valor = numeroBR(r[cParcela]) ?? numeroBR(r[cTotal]);
    if (!data || !valor) continue;

    const site = siteComoApelido(r[cSite]);
    const just = (r[cJust] ?? "").replace(/\s+/g, " ").trim();
    const tipo = (r[cTipo] ?? "").trim();
    if (!site && !just) continue;

    out.push({
      fonte: "compras",
      chaveTipo: "valor_data",
      data,
      valor,
      // Sem site, o apelido sai do casamento (o lojista da fatura); o que a
      // planilha acrescenta aí é só o "o que é".
      apelido: site ?? "",
      oQueE: tipo || null,
      detalhe: just || null,
    });
  }
  return out;
}
