/* ---------------------------------------------------------------------------
 * O e-mail de desligamento, lido pelo Hub.
 *
 * A ficha do RH não guarda o que decide metade do acerto: dias de férias já
 * tirados, variável do mês, e o motivo — que é quem define se cabe a multa de
 * uma remuneração inteira. Tudo isso o gestor escreve no e-mail de
 * desligamento, e até agora alguém tinha que abrir a caixa, achar o e-mail e
 * digitar na mão. Digitar na mão é onde o número erra.
 *
 * O QUE ESTE MÓDULO É: a parte determinística disso — montar a busca, escolher
 * entre os e-mails que voltaram, e classificar o motivo. A leitura do texto
 * livre fica com a IA, mas a CLASSIFICAÇÃO não: "reestruturação" custa 1x
 * remuneração e "pedido de demissão" custa zero, e essa conta não pode depender
 * de o modelo estar num dia bom. A IA extrai o motivo COMO ESTÁ ESCRITO; quem
 * decide o que ele significa é `classificarMotivo`, aqui, com teste em cima.
 *
 * O TYPO É PARTE DA BUSCA. "Delisgamento" é como boa parte dos e-mails antigos
 * saiu, e procurar só a grafia certa perde o histórico inteiro.
 *
 * NADA AQUI ESCREVE NA CAIXA. O escopo do Gmail é `readonly`.
 * ------------------------------------------------------------------------- */

export const norm = (s: unknown): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** As duas grafias do assunto. A errada é a mais comum nos e-mails antigos. */
export const GRAFIAS = ["Desligamento", "Delisgamento"];

/**
 * As buscas, da mais específica para a mais aberta.
 *
 * A primeira acha o e-mail que segue o padrão ("Desligamento Maria Silva"). A
 * segunda existe porque o assunto real muitas vezes traz só o primeiro nome, ou
 * o nome com um sobrenome que não é o da ficha — aí quem separa é a pontuação
 * do assunto, não o Gmail.
 */
export function consultasDoDesligamento(nome: string): string[] {
  const limpo = String(nome ?? "").trim();
  if (!limpo) return [];
  const exatas = GRAFIAS.map((g) => `subject:"${g} ${limpo}"`).join(" OR ");
  const primeiro = limpo.split(/\s+/)[0];
  const soAssunto = GRAFIAS.map((g) => `subject:${g}`).join(" OR ");
  return [`(${exatas})`, `(${soAssunto}) "${primeiro}"`];
}

/**
 * O quanto um assunto fala DESTA pessoa: a fração dos nomes da ficha que
 * aparecem nele. "Desligamento Maria" para "Maria Silva Souza" dá 1/3 — pouco,
 * mas acima de zero; "Desligamento João" dá 0 e está fora.
 *
 * Partículas ("da", "de", "dos") não contam: elas casariam com meio mundo.
 */
const PARTICULAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);

export function pontuarAssunto(nome: string, assunto: string): number {
  const partes = norm(nome).split(" ").filter((p) => p.length > 1 && !PARTICULAS.has(p));
  if (!partes.length) return 0;
  const alvo = ` ${norm(assunto)} `;
  const achou = partes.filter((p) => alvo.includes(` ${p} `)).length;
  return achou / partes.length;
}

export type EmailCandidato = { id: string; assunto: string; data: string | null };

/**
 * Escolhe o e-mail da pessoa entre os que a busca trouxe.
 *
 * Homônimo não se resolve no chute: quando sobra mais de um e-mail com a MESMA
 * pontuação máxima e datas diferentes, os dois voltam para alguém escolher.
 */
export function escolherEmail<T extends EmailCandidato>(
  nome: string,
  candidatos: T[],
  minimo = 0.5,
): { escolhido: T | null; ambiguos: T[] } {
  const pontuados = candidatos
    .map((c) => ({ c, p: pontuarAssunto(nome, c.assunto) }))
    .filter((x) => x.p >= minimo)
    .sort((a, b) => b.p - a.p || (b.c.data ?? "").localeCompare(a.c.data ?? ""));
  if (!pontuados.length) return { escolhido: null, ambiguos: [] };

  const topo = pontuados[0].p;
  const empatados = pontuados.filter((x) => x.p === topo).map((x) => x.c);
  // Mesma pontuação e mesma data = o mesmo desligamento em duplicata; passa.
  const datas = new Set(empatados.map((c) => c.data ?? ""));
  if (empatados.length > 1 && datas.size > 1) return { escolhido: null, ambiguos: empatados };
  return { escolhido: empatados[0], ambiguos: [] };
}

/* ─────────────────────────── Classificação do motivo ───────────────────────
   Determinística de propósito: é ela que decide a multa de um mês inteiro. */

export type Classificacao = "voluntario" | "involuntario";

const VOLUNTARIO = [
  "PEDIDO DE DEMISSAO", "PEDIU DEMISSAO", "PEDIU PARA SAIR", "DEMISSAO VOLUNTARIA",
  "PROPOSTA DE OUTRA EMPRESA", "PROPOSTA EXTERNA", "OUTRA OPORTUNIDADE",
  "NOVA OPORTUNIDADE", "DECISAO PESSOAL", "MOTIVOS PESSOAIS",
  "MUDANCA DE CARREIRA", "TRANSICAO DE CARREIRA", "VOLUNTARIO", "VOLUNTARIA",
];

const INVOLUNTARIO = [
  "PERFORMANCE", "DESEMPENHO", "BAIXA ENTREGA", "METAS NAO ATINGIDAS",
  "NAO ATINGIU AS METAS", "REESTRUTURACAO", "RESTRUTURACAO", "CORTE DE CUSTOS",
  "DECISAO DA EMPRESA", "FIT CULTURAL", "REPROVACAO NO PERIODO DE EXPERIENCIA",
  "REPROVADO NO PERIODO DE EXPERIENCIA", "PERIODO DE EXPERIENCIA",
  "INVOLUNTARIO", "INVOLUNTARIA", "DESLIGADO PELA EMPRESA",
];

/**
 * O que a skill chama de ambíguo — "saída acordada", "não está mais na
 * empresa", campo vazio — sai daqui como `null` de propósito. Null vira
 * pergunta na tela; chutar viraria um mês de remuneração a mais ou a menos.
 */
export function classificarMotivo(motivo: unknown): Classificacao | null {
  const t = ` ${norm(motivo)} `;
  if (t.trim() === "") return null;
  const bateu = (lista: string[]) => lista.some((termo) => t.includes(` ${termo} `) || t.includes(termo));
  const vol = bateu(VOLUNTARIO);
  const inv = bateu(INVOLUNTARIO);
  if (vol === inv) return null; // nenhum, ou os dois: não dá para decidir
  return vol ? "voluntario" : "involuntario";
}

/* ─────────────────────────── Extração do corpo ─────────────────────────── */

export type CamposDoEmail = {
  ultimoDia: string | null;
  remuneracao: number | null;
  variavel: number | null;
  diasDeFeriasTirados: number | null;
  motivo: string | null;
};

export const SCHEMA_EXTRACAO = {
  type: "object",
  properties: {
    ultimoDia: { type: "string", description: "Último dia trabalhado em AAAA-MM-DD, ou vazio" },
    remuneracao: { type: "number", description: "Remuneração mensal em reais, ou 0 se não houver" },
    variavel: { type: "number", description: "Variável/comissão em reais; -1 se o e-mail não fala de variável" },
    diasDeFeriasTirados: { type: "number", description: "Dias de férias já tirados, ou -1 se não houver" },
    motivo: { type: "string", description: "Motivo do desligamento, copiado como está escrito" },
  },
  required: ["ultimoDia", "remuneracao", "variavel", "diasDeFeriasTirados", "motivo"],
};

export const INSTRUCAO_EXTRACAO = [
  "Você transcreve um e-mail de desligamento de PJ para campos. É leitura, não interpretação.",
  "",
  "Regras:",
  "- Copie SÓ o que está escrito. Nunca deduza, nunca calcule, nunca complete.",
  "- Valor ausente: string vazia para texto, 0 para remuneração, -1 para variável e -1 para dias de férias.",
  "- -1 em dias de férias significa 'o e-mail não fala de férias'. 0 significa 'o e-mail diz que não tirou'.",
  "  A diferença decide se alguém vai ter que perguntar ao gestor — não troque um pelo outro.",
  "- Mesma coisa na variável: -1 é 'o e-mail não fala de variável'; 0 é 'o e-mail diz que não há'.",
  "- Datas em AAAA-MM-DD. O e-mail é brasileiro: 03/08/2026 é 3 de agosto.",
  "- Dinheiro em número puro: 'R$ 3.700,00' vira 3700.",
  "- O motivo vai copiado como está escrito, na frase do gestor. Não resuma e não classifique.",
].join("\n");

const soNumero = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

const soData = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
};

/**
 * A saída crua da IA virando campos com significado.
 *
 * Os sentinelas do prompt (0 em remuneração, -1 em variável e férias, "" em texto) voltam a
 * ser `null` aqui, porque "não informado" e "informado como zero" são coisas
 * diferentes rua abaixo: um vira pergunta ao gestor, o outro vira conta.
 */
export function normalizarExtracao(bruto: unknown): CamposDoEmail {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const dias = soNumero(o.diasDeFeriasTirados);
  const remun = soNumero(o.remuneracao);
  const varia = soNumero(o.variavel);
  const motivo = String(o.motivo ?? "").trim();
  return {
    ultimoDia: soData(o.ultimoDia),
    remuneracao: remun !== null && remun > 0 ? remun : null,
    // Variável zero é informação — o gestor escreveu "sem variável". O -1 do
    // prompt é o "não fala disso", e vira não informado (com aviso na tela).
    variavel: varia !== null && varia >= 0 ? varia : null,
    diasDeFeriasTirados: dias !== null && dias >= 0 ? dias : null,
    motivo: motivo || null,
  };
}
