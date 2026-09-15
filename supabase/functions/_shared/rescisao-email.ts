/* ---------------------------------------------------------------------------
 * O e-mail de desligamento, lido pelo Hub.
 *
 * A ficha do RH não guarda o que decide metade do acerto: dias de férias já
 * tirados, comissão a receber e o tipo de saída — que é quem define se cabe a
 * multa de uma remuneração inteira. Tudo isso o gestor escreve no e-mail de
 * desligamento.
 *
 * COMO O E-MAIL É DE VERDADE (lido na caixa em 15/09/2026, doze conversas):
 *   • o ASSUNTO quase nunca tem o nome — "Solicitação de Desligamento",
 *     "Desligamento - Produto", "Desligamento Involuntário". Quem diz de quem
 *     se trata é a linha "Nome do colaborador:" do CORPO, e com a grafia do
 *     gestor, não a da ficha ("Igor Baptista" para "Igor Calmon Baptisti");
 *   • a RESPOSTA CORRIGE: a segunda mensagem troca a data de 31/08 para 16/08,
 *     "tem comissão" vira "não tem", "involuntário" vira "é voluntário então".
 *     Ler só a mensagem que a busca achou é ler o rascunho;
 *   • o e-mail chega ANTES ou DEPOIS da saída — um mês depois, num caso;
 *   • a comissão vem em conta ("396 (comissão) + 210,00 (plantão)"), em
 *     promessa ("a que for atingida no final do mês") ou em negativa.
 *
 * O QUE ESTE MÓDULO É: a parte determinística — montar a busca, reconhecer a
 * pessoa, escolher as conversas e classificar o desligamento. A leitura do
 * texto livre fica com a IA; a CLASSIFICAÇÃO não. "Reestruturação" custa uma
 * remuneração e "pedido de demissão" custa zero, e essa conta não pode depender
 * de o modelo estar num dia bom.
 *
 * O TYPO É PARTE DA BUSCA: "Delisgamento" é como saiu parte dos e-mails antigos.
 *
 * NADA AQUI ESCREVE NA CAIXA. O escopo do Gmail é `readonly`.
 * ------------------------------------------------------------------------- */

export const norm = (s: unknown): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** As duas grafias do assunto. */
export const GRAFIAS = ["Desligamento", "Delisgamento"];

/** O e-mail chega até um mês antes da saída… */
export const JANELA_ANTES_DIAS = 30;
/** …e já chegou um mês DEPOIS dela (o de 23/06 falava de uma saída em 24/05). */
export const JANELA_DEPOIS_DIAS = 60;

const DIA = 86_400_000;

const paraUTC = (iso: string | null | undefined): number | null => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

const dataDoGmail = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
};

/**
 * A busca: todo e-mail com "desligamento" no assunto, na janela da saída.
 *
 * O nome NÃO entra na consulta — ele quase nunca está no assunto, e procurar no
 * corpo pelo Gmail exige a grafia exata, que é justamente a que não se tem. Quem
 * separa a pessoa é `triarConversas`, depois de ler.
 */
export function consultaDoDesligamento(datadesl: string | null): string {
  const assunto = `(${GRAFIAS.map((g) => `subject:${g}`).join(" OR ")})`;
  const alvo = paraUTC(datadesl);
  if (alvo === null) return assunto;
  const de = dataDoGmail(alvo - JANELA_ANTES_DIAS * DIA);
  const ate = dataDoGmail(alvo + (JANELA_DEPOIS_DIAS + 1) * DIA); // `before:` é exclusivo
  return `${assunto} after:${de} before:${ate}`;
}

/* ─────────────────────────── Quem é a pessoa ─────────────────────────── */

/** Partículas não contam: "de" e "da" casariam com meio mundo. */
const PARTICULAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);

const tokensDoNome = (nome: string) =>
  norm(nome).split(" ").filter((p) => p.length > 1 && !PARTICULAS.has(p));

/** Iguais, ou a uma letra de distância (troca, sobra ou falta). */
function aUmaLetra(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let erros = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++erros > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return erros + (a.length - i) + (b.length - j) <= 1;
}

/**
 * A grafia do gestor não é a da ficha: "Baptista" para "Baptisti". Uma letra
 * de folga resolve — mas só em nome de 5 letras ou mais, porque em "Lu"/"Luz"
 * ou "Ana"/"Ane" uma letra já é outra pessoa.
 */
function tokenBate(token: string, palavras: Set<string>): boolean {
  if (palavras.has(token)) return true;
  if (token.length < 5) return false;
  for (const p of palavras) if (p.length >= 4 && aUmaLetra(p, token)) return true;
  return false;
}

/**
 * As linhas "Nome:" / "Nome do colaborador;" / "*Nome: *" do corpo, como estão.
 *
 * É nelas que se procura a pessoa quando existem, e não no texto todo: a
 * assinatura de quem responde ("Ana Clara Mongin, RH") está em toda conversa,
 * e uma desligada chamada Ana Clara casaria com todas.
 */
export function nomesDeclarados(texto: string): string[] {
  const achados: string[] = [];
  const re = /nome(?:\s+d[oa]\s+colaborador[a]?|\s+completo)?[\s*_]*[:;][\s*_]*([^\n]+)/gi;
  for (const m of String(texto ?? "").matchAll(re)) {
    const nome = m[1].replace(/[*_]/g, "").trim();
    if (nome && !achados.includes(nome)) achados.push(nome);
  }
  return achados;
}

export type Reconhecimento = "certo" | "so-primeiro-nome" | "nao";

function reconhecerEm(nome: string, texto: string): Reconhecimento {
  const partes = tokensDoNome(nome);
  if (!partes.length) return "nao";
  const palavras = new Set(norm(texto).split(" "));
  const [primeiro, ...resto] = partes;
  if (!tokenBate(primeiro, palavras)) return "nao";
  if (!resto.length) return "certo";
  return resto.some((t) => tokenBate(t, palavras)) ? "certo" : "so-primeiro-nome";
}

const PESO: Record<Reconhecimento, number> = { certo: 2, "so-primeiro-nome": 1, nao: 0 };

/**
 * Esta conversa fala desta pessoa?
 *
 * "certo" pede primeiro nome E um sobrenome — "Ricardo Antunes" é o Ricardo
 * Ramires Antunes; "José Ricardo Fiaes" não é. Só o primeiro nome vira
 * "so-primeiro-nome": não se descarta, mas também não se usa sem alguém olhar.
 */
export function reconhecerPessoa(nome: string, texto: string): Reconhecimento {
  const declarados = nomesDeclarados(texto);
  const alvos = declarados.length ? declarados : [texto];
  return alvos
    .map((t) => reconhecerEm(nome, t))
    .reduce((a, b) => (PESO[b] > PESO[a] ? b : a), "nao" as Reconhecimento);
}

export type ConversaCandidata = {
  threadId: string;
  assunto: string;
  /** Data da última mensagem, AAAA-MM-DD. */
  data: string | null;
  remetente: string;
  texto: string;
};

/**
 * Das conversas da janela, quais são desta pessoa.
 *
 * Até três, as mais perto da data de saída — o mesmo desligamento costuma ter
 * o original, um encaminhado e uma correção em conversas separadas, e é lendo
 * todas que a correção aparece. Saem em ORDEM CRONOLÓGICA, que é a ordem em que
 * a mais nova desmente a mais velha.
 */
export function triarConversas<T extends ConversaCandidata>(
  nome: string,
  datadesl: string | null,
  conversas: T[],
  maximo = 3,
): { certas: T[]; duvidosas: T[] } {
  const alvo = paraUTC(datadesl);
  const distancia = (c: T) => {
    const d = paraUTC(c.data);
    return alvo === null || d === null ? Number.MAX_SAFE_INTEGER : Math.abs(d - alvo);
  };
  const certas: T[] = [];
  const duvidosas: T[] = [];
  for (const c of conversas) {
    const r = reconhecerPessoa(nome, `${c.assunto}\n${c.texto}`);
    if (r === "certo") certas.push(c);
    else if (r === "so-primeiro-nome") duvidosas.push(c);
  }
  return {
    certas: certas
      .sort((a, b) => distancia(a) - distancia(b))
      .slice(0, maximo)
      .sort((a, b) => (a.data ?? "").localeCompare(b.data ?? "")),
    duvidosas: duvidosas.sort((a, b) => distancia(a) - distancia(b)),
  };
}

/* ─────────────────────────── Classificação ───────────────────────────
   Determinística de propósito: é ela que decide a multa de um mês inteiro. */

export type Classificacao = "voluntario" | "involuntario";

const VOLUNTARIO = [
  "PEDIDO DE DEMISSAO", "PEDIU DEMISSAO", "PEDIU PARA SAIR", "DEMISSAO VOLUNTARIA",
  "PEDIU DESLIGAMENTO", "PEDIU O DESLIGAMENTO",
  "PROPOSTA DE OUTRA EMPRESA", "PROPOSTA EXTERNA", "OUTRA OPORTUNIDADE",
  "NOVA OPORTUNIDADE", "DECISAO PESSOAL", "MOTIVOS PESSOAIS", "PROBLEMAS PESSOAIS",
  "QUESTOES PESSOAIS", "PROJETO PESSOAL",
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
 * O motivo em texto livre, lido por termo INTEIRO.
 *
 * Inteiro de propósito: "INVOLUNTARIO" contém "VOLUNTARIO", e casar pedaço de
 * palavra fazia todo motivo escrito "involuntário" puxar para os dois lados —
 * e sair nulo.
 *
 * O ambíguo ("saída acordada", "não está mais na empresa", vazio) sai `null`:
 * nulo vira pergunta na tela; chutar viraria um mês de remuneração.
 */
export function classificarMotivo(motivo: unknown): Classificacao | null {
  const t = ` ${norm(motivo)} `;
  if (t.trim() === "") return null;
  const bateu = (lista: string[]) => lista.some((termo) => t.includes(` ${termo} `));
  const vol = bateu(VOLUNTARIO);
  const inv = bateu(INVOLUNTARIO);
  if (vol === inv) return null;
  return vol ? "voluntario" : "involuntario";
}

/** O campo "Tipo de desligamento", como o gestor marcou: "-Voluntário", "Involuntário." */
export function tipoEscrito(tipo: unknown): Classificacao | null {
  const palavras = new Set(norm(tipo).split(" "));
  const inv = palavras.has("INVOLUNTARIO") || palavras.has("INVOLUNTARIA");
  const vol = palavras.has("VOLUNTARIO") || palavras.has("VOLUNTARIA");
  if (inv === vol) return null;
  return inv ? "involuntario" : "voluntario";
}

/**
 * Tipo marcado e motivo escrito, juntos.
 *
 * Os dois concordando, ou só um falando: vale o que falou. Os dois discordando
 * — "Voluntário" com motivo "desempenho comportamental", que existe na base —
 * não se escolhe lado: volta nulo com `conflito`, e a tela pergunta.
 */
export function classificarDesligamento(
  tipo: unknown,
  motivo: unknown,
): { classificacao: Classificacao | null; conflito: boolean } {
  const peloTipo = tipoEscrito(tipo);
  const peloMotivo = classificarMotivo(motivo);
  if (peloTipo && peloMotivo && peloTipo !== peloMotivo) return { classificacao: null, conflito: true };
  return { classificacao: peloTipo ?? peloMotivo, conflito: false };
}

/* ─────────────────────────── Extração do corpo ─────────────────────────── */

export type CamposDoEmail = {
  nomeNoEmail: string | null;
  ultimoDia: string | null;
  remuneracao: number | null;
  variavel: number | null;
  /** O que o e-mail escreveu sobre comissão, como está. */
  variavelTexto: string | null;
  diasDeFeriasTirados: number | null;
  /** O que o e-mail escreveu sobre férias, como está. */
  feriasTexto: string | null;
  /** O tipo marcado, na versão final da conversa. */
  tipo: string | null;
  motivo: string | null;
};

export const SCHEMA_EXTRACAO = {
  type: "object",
  properties: {
    nomeNoEmail: { type: "string", description: "Nome do colaborador como escrito no e-mail" },
    ultimoDia: { type: "string", description: "Último dia trabalhado / data da rescisão, AAAA-MM-DD, ou vazio" },
    remuneracao: { type: "number", description: "Remuneração mensal em reais, ou 0 se não houver" },
    variavel: { type: "number", description: "Comissão/variável a receber em reais; 0 se o e-mail diz que não há; -1 se não diz o valor" },
    variavelTexto: { type: "string", description: "O que o e-mail escreveu sobre comissão, copiado" },
    diasDeFeriasTirados: { type: "number", description: "Dias de férias já tirados; 0 se não tirou; -1 se não informa" },
    feriasTexto: { type: "string", description: "O que o e-mail escreveu sobre férias, copiado" },
    tipo: { type: "string", description: "Tipo de desligamento na versão final da conversa, copiado" },
    motivo: { type: "string", description: "Motivo do desligamento na versão final da conversa, copiado" },
  },
  required: [
    "nomeNoEmail", "ultimoDia", "remuneracao", "variavel", "variavelTexto",
    "diasDeFeriasTirados", "feriasTexto", "tipo", "motivo",
  ],
};

export const INSTRUCAO_EXTRACAO = [
  "Você transcreve e-mails de desligamento de PJ para campos. É leitura, não interpretação.",
  "",
  "O material é uma ou mais conversas, com as mensagens em ordem de chegada.",
  "",
  "A MAIS NOVA MANDA:",
  "- Quando uma mensagem posterior muda um campo, vale a posterior. A correção pode vir em",
  "  formulário repetido (a data passou de 31/08 para 16/08) ou em frase solta",
  "  (\"Corrigindo: é um desligamento voluntário então\").",
  "- Linhas começando com \">\" são CITAÇÃO de uma mensagem mais velha. O texto próprio da",
  "  mensagem, acima da citação, é mais novo que ela. Às vezes a citação é a única cópia do",
  "  formulário original — use-a, mas deixe a frase nova por cima corrigir.",
  "- Pergunta sem resposta (\"ele não possui comissão?\") não muda campo nenhum.",
  "- Só dados do colaborador indicado. Se a conversa falar de mais de uma pessoa, ignore as outras.",
  "",
  "CAMPOS:",
  "- Copie SÓ o que está escrito. Nunca deduza, nunca complete.",
  "- ultimoDia: AAAA-MM-DD. O e-mail é brasileiro: 03/08/2026 é 3 de agosto. Sem ano escrito",
  "  (\"31/08.\"), use o ano da mensagem onde a data aparece. Sem data: string vazia.",
  "- remuneracao: número puro ('R$ 3.700,00' vira 3700). Sem valor: 0.",
  "- variavel (comissão, plantão, venda a receber):",
  "    'Não possui', 'Não recebe', 'R$ 0,00', 'Não, canal não atingiu a meta' -> 0",
  "    valores escritos -> a SOMA deles ('396 (comissão) + 210,00 (plantão)' -> 606)",
  "    'Tem R$ 250,00 a receber de uma venda' -> 250",
  "    promessa sem número ('Sim, a que for atingida no final do mês') ou campo ausente -> -1",
  "- variavelTexto: o trecho sobre comissão, copiado como está (vazio se não há).",
  "- diasDeFeriasTirados: '0', 'Não houve férias', 'não tirou' -> 0; número escrito -> o número;",
  "  'Não informou' ou campo ausente -> -1. -1 e 0 são coisas diferentes: -1 obriga alguém",
  "  a perguntar ao gestor. Não troque um pelo outro.",
  "- feriasTexto: o trecho sobre férias, copiado (vazio se não há).",
  "- tipo: o tipo de desligamento na versão final, copiado ('Voluntário', 'Involuntário').",
  "- motivo: a frase do motivo na versão final, copiada. Não resuma e não classifique.",
].join("\n");

/** Teto por mensagem e total — um formulário de desligamento cabe folgado. */
const CORPO_MENSAGEM_MAX = 6_000;
const CORPO_TOTAL_MAX = 16_000;

export type MensagemParaLer = { data: string | null; remetente: string; corpo: string };

/** As conversas escolhidas, montadas no formato que a instrução descreve. */
export function textoParaExtracao(
  nome: string,
  conversas: { assunto: string; mensagens: MensagemParaLer[] }[],
): string {
  const partes = [`Colaborador: ${nome}`, ""];
  let resta = CORPO_TOTAL_MAX;
  conversas.forEach((c, i) => {
    partes.push(`=== Conversa ${i + 1}: "${c.assunto}" ===`);
    for (const m of c.mensagens) {
      const corpo = String(m.corpo ?? "").slice(0, Math.max(0, Math.min(CORPO_MENSAGEM_MAX, resta)));
      resta -= corpo.length;
      partes.push(`--- Mensagem de ${m.remetente}, em ${m.data ?? "data desconhecida"} ---`, corpo, "");
    }
  });
  return partes.join("\n");
}

/**
 * Número de um valor que devia ser número.
 *
 * Texto com MAIS DE UM número volta nulo: "396 + 210,00" colado viraria 396210,
 * e um acerto de seis dígitos a mais passa despercebido numa tela cheia.
 */
const soNumero = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const grupos = String(v ?? "").match(/-?\d[\d.]*(?:,\d+)?/g) ?? [];
  if (grupos.length !== 1) return null;
  let g = grupos[0];
  if (g.includes(",")) g = g.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(g)) g = g.replace(/\./g, "");
  const n = Number(g);
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

const soTexto = (v: unknown): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s || null;
};

/**
 * A saída crua da IA virando campos com significado.
 *
 * Os sentinelas do prompt (0 em remuneração, -1 em variável e férias, "" em
 * texto) voltam a ser `null`, porque "não informado" e "informado como zero"
 * são coisas diferentes rua abaixo: um vira pergunta ao gestor, o outro vira
 * conta.
 */
export function normalizarExtracao(bruto: unknown): CamposDoEmail {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const dias = soNumero(o.diasDeFeriasTirados);
  const remun = soNumero(o.remuneracao);
  const varia = soNumero(o.variavel);
  return {
    nomeNoEmail: soTexto(o.nomeNoEmail),
    ultimoDia: soData(o.ultimoDia),
    remuneracao: remun !== null && remun > 0 ? remun : null,
    // Zero é o gestor dizendo "não há"; o -1 do prompt é o e-mail calado.
    variavel: varia !== null && varia >= 0 ? varia : null,
    variavelTexto: soTexto(o.variavelTexto),
    diasDeFeriasTirados: dias !== null && dias >= 0 ? dias : null,
    feriasTexto: soTexto(o.feriasTexto),
    tipo: soTexto(o.tipo),
    motivo: soTexto(o.motivo),
  };
}
