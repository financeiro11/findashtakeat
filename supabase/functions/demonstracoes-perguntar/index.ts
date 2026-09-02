// Edge Function: demonstracoes-perguntar
//
// Responde a uma pergunta feita EM CIMA DE UMA CÉLULA da DRE/DFC — e a resposta
// fica registrada ali, no fio daquela célula.
//
// POR QUE EXISTE, se já há justificativa automática: a justificativa nasce de um
// gatilho da máquina (a célula variou acima do limiar) e por isso só fala do que
// se mexeu. A pergunta que fecha o mês costuma ser sobre o que NÃO se mexeu:
//
//   "quatro pessoas do comercial tiveram reajuste em julho; por que Pessoal não
//    subiu?"
//
// O fato que motiva a pergunta (o reajuste) não está em lugar nenhum do banco.
// Quem o traz é a pessoa; o que esta função faz é procurar o rastro dele nos
// lançamentos e dizer o que achou — ou que não achou.
//
// COMO FUNCIONA
//   A tela manda a célula com os MESMOS números que estão à vista (ela é quem
//   soma os filhos e aplica o valor manual — recalcular aqui produziria uma
//   resposta que não bate com o número ao lado). Aqui se faz o que a tela não
//   pode: descer nos lançamentos do Omie.
//
//   Três camadas de evidência, da mais mastigada para a mais crua:
//     • drivers      — quem se mexeu entre os dois meses (`demonstracoes_contrapartes`,
//                      o mesmo insumo das justificativas)
//     • lançamentos  — título a título nos dois meses (`demonstracoes_lancamentos_multi`)
//     • série + quebra por linha filha + o resumo do mês, que a tela já calculou
//
//   A IA REDIGE em cima disso; nada aqui é inventado por ela. Os drivers ficam
//   salvos ao lado da resposta pelo mesmo motivo da justificativa: quem lê
//   confere a conta sem sair da tela.
//
// E QUANDO O PEDIDO É DE CONSERTO
//   "Certamente tem receita financeira aqui. É da Paytime, e deveria estar
//    classificada como Receita Markup. Se estiver errado, conserte."
//
//   Isso não é pergunta: é um erro apontado por quem conhece a operação. Duas
//   coisas mudam em relação ao caminho acima.
//
//   1. ONDE SE PROCURA. A célula do exemplo está ZERADA — o lançamento existe,
//      mas caiu noutra linha, que é o que significa "classificado errado".
//      Procurar dentro da rubrica perguntada é procurar onde sabidamente não
//      está. Uma triagem curta extrai os NOMES da frase ("paytime") e
//      `demonstracoes_lancamentos_busca` varre o mês inteiro, em todas as
//      rubricas e inclusive fora do DE-PARA.
//   2. O QUE SE DEVOLVE. Junto da resposta vai uma PROPOSTA (`acao`): quais
//      títulos mover, para qual categoria, e por quê. Proposta, não execução —
//      quem aplica é a pessoa, num clique, na própria célula.
//
//   NADA AQUI ESCREVE NO OMIE. A alteração continua inteira em
//   `omie-trocar-categoria` (altera no ERP → confirma → espelha no cache →
//   grava trilha), chamada pela tela com os títulos desta proposta. Uma segunda
//   porta para o ERP seria uma segunda cópia daquela regra, e a cópia diverge na
//   primeira vez que alguém editar só um dos lados.
//
//   A peneira que sustenta tudo isso é `conferirAcao`: um `cod_titulo` é um
//   número de oito dígitos, exatamente o que um modelo produz plausível e
//   errado. Nenhum título é aceito de palavra — todos são procurados no mesmo
//   conjunto que foi enviado no prompt.
//
// Body: {
//   tipo:'dre'|'dfc', rubrica, mes:'Jul-26', mesAnterior:'Jun-26',
//   pergunta, fontes:string[], valor, valorAnterior, despesa, travado,
//   serie:[{mes,valor}], filhos:[{rubrica,valor,valorAnterior}],
//   resumoMes:[{rubrica,valor,valorAnterior}]
// }
//   `fontes` são os rótulos que compõem a célula (numa linha somada, os filhos):
//   é por eles que se acha o lançamento, porque o DE-PARA do Omie aponta para a
//   folha, nunca para o nome da linha somada.

// Versão FIXA, como no `_shared/auth.ts`: com `@2` solto o bundler resolve a
// última do dia e já quebrou um deploy deste projeto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
// OpenAI, e não Gemini: a redação caía de 429 (cota) no meio do fechamento, que
// é justamente quando ela é usada. Mesma superfície de `generateJSON`.
import { generateJSON, handleCors, jsonResponse, errorResponse, DEFAULT_MODEL } from "../_shared/openai.ts";
import { buildOrgContext } from "../_shared/org-context.ts";
// O Omie guarda razão social; a resposta precisa sair com o nome da pessoa.
import { carregarPessoasPJ, pessoaDe, pessoasNoTexto } from "../_shared/pessoas-pj.ts";

/* Quanto do dossiê cabe no prompt.
 *
 * Generoso de propósito, ao contrário das justificativas: lá o objetivo é UMA
 * frase sobre quem mais pesou, e citar demais estraga o texto. Aqui a pergunta
 * costuma ser sobre alguém específico — "quatro pessoas do comercial" são quatro
 * contrapartes no meio das ~50 de Pessoal, nenhuma delas entre as maiores. Com
 * corte apertado, a resposta seria "não vejo isso nos lançamentos" justamente
 * porque a linha da pessoa não coube. O modelo lê 1M de tokens; o gargalo aqui
 * não é ele. */
const MAX_DRIVERS = 40;
/** Lançamentos por mês no prompt. O que não cabe é contado, nunca omitido em silêncio. */
const MAX_LANCAMENTOS = 150;
/** Trocas anteriores da mesma célula que entram como contexto do fio. */
const MAX_FIO = 6;

/* A BUSCA NO MÊS INTEIRO — a peça que faz o chat conseguir consertar.
 *
 * Os blocos acima só enxergam a rubrica da célula, e é justamente onde o
 * lançamento procurado NÃO está: quando alguém diz "certamente tem receita
 * financeira aqui, é da Paytime", a célula está zerada porque o dinheiro caiu
 * noutra linha. `demonstracoes_lancamentos_busca` atravessa rubricas (e o que
 * está fora do DE-PARA) atrás dos nomes que a pergunta citou.
 *
 * Dois recortes separados de propósito, para um não expulsar o outro: o que casa
 * com os NOMES da pergunta, e o que compõe a própria célula. Num mês de "Pessoal"
 * as 300 linhas da rubrica engoliriam as três da Paytime se dividissem o teto. */
const MAX_BUSCA_NOMES = 150;
const MAX_BUSCA_CELULA = 120;
/** Termos que a triagem pode pedir. Mais que isso é a pergunta inteira virando busca. */
const MAX_TERMOS = 6;
/** Títulos que uma proposta pode mexer de uma vez. */
const MAX_ITENS_ACAO = 40;

/* A triagem é uma SEGUNDA chamada de IA, e ela entra antes do trabalho principal.
 * O worker morre por volta dos 150s sem exceção que dê para pegar — com os 90s
 * padrão nas duas, a soma estoura e a pessoa recebe 546 depois de dois minutos e
 * meio. Vinte segundos bastam para uma classificação de duas linhas, e o que
 * sobra continua sendo do texto, que é o que demora. */
const PRAZO_TRIAGEM_MS = 20_000;

/* `cGrupo` do movimento — espelha `grupoAlteravel` de `_shared/omie.ts`, do mesmo
   jeito que `src/lib/loteCategoria.ts` espelha na tela. A cópia existe para NÃO
   PROPOR o que o ERP vai recusar: previsão de OS/contrato tem a categoria no
   documento de origem, e perna bancária não tem classificação própria. */
const GRUPOS_ALTERAVEIS = new Set(["CONTA_A_PAGAR", "CONTA_A_RECEBER"]);

type Corpo = {
  tipo?: string;
  rubrica?: string;
  mes?: string;
  mesAnterior?: string;
  pergunta?: string;
  fontes?: string[];
  valor?: number | null;
  valorAnterior?: number | null;
  despesa?: boolean;
  travado?: boolean;
  percentual?: boolean;
  serie?: { mes: string; valor: number | null }[];
  filhos?: { rubrica: string; valor: number | null; valorAnterior: number | null }[];
  resumoMes?: { rubrica: string; valor: number | null; valorAnterior: number | null }[];
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "8,9k" / "1,25M" — a abreviação que o tracker usa nos comentários. */
function abrev(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(2).replace(".", ",")}M`;
  if (a >= 1_000) return `${s}${(a / 1_000).toFixed(1).replace(".", ",")}k`;
  return `${s}${a.toFixed(0)}`;
}

const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rotuloMes(k: string): string {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(k ?? "");
  if (!m) return k;
  const i = EN.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return i >= 0 ? `${MES_PT[i]}/${m[2]}` : k;
}

const dataCurta = (d: string | null) => (d ? String(d).slice(8, 10) + "/" + String(d).slice(5, 7) : "—");

/**
 * O MEMO da fatura, de dentro da observação do título.
 *
 * No cartão a contraparte é sempre o balde ("Lancamento Fatura Cartao") e o que
 * o gasto É está depois do "|". Vai CRU para o modelo, sem o parser de colunas
 * do cartão: duplicar aquele corte aqui faria esta resposta e a tela do cartão
 * discordarem sobre o nome do mesmo lojista.
 */
function memo(obs: string | null | undefined): string | null {
  if (!obs) return null;
  const corte = obs.lastIndexOf("|");
  const t = (corte >= 0 ? obs.slice(corte + 1) : obs).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 90) : null;
}

/* ============================================================
 *  O prompt
 * ============================================================
 * O tom é o mesmo das justificativas (destilado dos comentários reais do tracker),
 * mas a tarefa é outra: lá se DESCREVE uma variação, aqui se RESPONDE a alguém.
 * As regras que valem o preço estão em 3 e 4 — a pergunta quase sempre traz um
 * fato que o banco não conhece ("teve reajuste"), e o pior desfecho possível é a
 * IA confirmar esse fato de volta como se o tivesse verificado.
 */
const REGRAS = `
Você responde perguntas do time financeiro da Takeat (Henrique e Júlia) sobre uma
célula específica da DRE ou da DFC, no fechamento do mês. A resposta é lida ali
mesmo, em cima do número, e pode virar o comentário oficial daquela rubrica no
Tracker de Orçamento.

REGRAS

1. RESPONDA A PERGUNTA FEITA. Não escreva um resumo do mês, não repita a pergunta
   e não explique o que não foi perguntado.
2. NOMEIE quem se mexeu e cole os valores que vieram nos dados (já formatados).
   "aumento nos custos" sem dizer de quem não serve para nada.
3. A PERGUNTA COSTUMA TRAZER UM FATO QUE VOCÊ NÃO TEM COMO CONFERIR — um reajuste,
   uma contratação, uma renegociação. Trate isso como premissa de quem perguntou:
   procure o RASTRO dele nos lançamentos e diga o que encontrou. Se o rastro não
   está lá, diga isso com todas as letras ("nos lançamentos de julho o salário do
   Fulano continua em X, igual a junho") — nunca confirme o fato de volta como se
   o tivesse verificado, e nunca diga que a pessoa está enganada.
4. NÃO INVENTE A CAUSA. Os lançamentos dizem QUEM e QUANTO; o POR QUÊ quase nunca
   está lá. Quando o padrão for reconhecível (fornecedor que aparece pela primeira
   vez, fornecedor que some, fatura que parece dobrada, retroativo, pagamento
   partido em dois meses), escreva como POSSIBILIDADE — "pode ser", "aparenta ser".
5. QUANDO O DADO NÃO RESPONDE, DIGA. É uma resposta legítima e é a mais útil das
   erradas. Diga o que faltou e onde olhar (outro mês, outra rubrica, o Omie, o
   tracker, a folha).
6. Se o mês está TRAVADO, o valor da tela veio do tracker importado e não do Omie:
   os lançamentos podem não somar a célula. Só mencione isso quando for relevante
   para a resposta — e quando a diferença entre a soma e a célula for grande, é
   sempre relevante.
7. Direção: em rubrica de despesa, gastar mais é SUBIR. Os valores já chegam com
   essa orientação aplicada; não escreva sinal junto do verbo ("caiu -23,0k" é
   erro, não ênfase).
8. 1 a 4 frases. Pode quebrar linha para listar nomes com valores. Sem bullets,
   sem markdown, sem título, sem saudação, sem assinatura, sem "espero ter
   ajudado".
9. Português do Brasil, tom de nota interna entre colegas. Direto. Sem "conforme
   pode-se observar", sem "é importante ressaltar".

CONFIANÇA: "alta" quando os lançamentos mostram a resposta; "media" quando
mostram parte dela; "baixa" quando você está inferindo ou quando o dado não
alcança a pergunta.
`.trim();

/* ============================================================
 *  A triagem: pergunta ou pedido de conserto?
 * ============================================================
 * Chamada curta e barata que roda ANTES de buscar qualquer coisa, e que existe
 * por dois motivos independentes:
 *
 *   • dizer O QUE PROCURAR. A busca no mês inteiro precisa de termos; sem eles a
 *     alternativa seria mandar o mês inteiro para o prompt (milhares de linhas)
 *     ou não procurar nada. É a pergunta que sabe o nome — "é da paytime".
 *   • dizer se a pessoa quer CONSERTAR. Só nesse caso o plano de contas entra no
 *     prompt e a IA ganha permissão de propor. Oferecer uma alteração no ERP a
 *     quem só fez uma pergunta é empurrar mudança para quem não pediu.
 */
const REGRAS_TRIAGEM = `
Você lê UMA frase escrita pelo time financeiro em cima de uma célula da DRE/DFC e
devolve duas coisas. Não responda a pergunta, não explique nada.

1. intencao:
   • "correcao" — a pessoa afirma que algo está errado e quer que seja mudado
     ("está classificado errado, conserte", "isso aqui é markup, troca",
     "esse lançamento não devia estar nessa linha").
   • "pergunta" — a pessoa quer entender ("por que caiu?", "o que é isso?",
     "quem se mexeu aqui?"). Na dúvida, "pergunta": é a opção que não mexe em nada.

2. buscar: os NOMES PRÓPRIOS citados na frase que valha procurar nos lançamentos
   do mês — fornecedor, cliente, pessoa, produto, categoria. Um por item, sem
   artigo e sem sobrenome de empresa ("paytime", não "a Paytime Ltda").
   • Nome com menos de 3 letras não serve: casa dentro de qualquer palavra.
   • Palavra comum do vocabulário contábil ("receita", "despesa", "imposto",
     "custo", "markup") NÃO é nome próprio — deixe de fora, ela traria o mês
     inteiro de volta.
   • Nenhum nome citado? Devolva a lista vazia. É uma resposta legítima.
`.trim();

/* ============================================================
 *  Quando o pedido é de conserto
 * ============================================================
 * Só entra no prompt quando a triagem disse "correcao". A regra que paga o preço
 * é a A: o modelo não INVENTA um título. Ele escolhe entre os que recebeu, e o
 * servidor confere um a um contra a mesma lista antes de deixar a proposta chegar
 * na tela — uma alteração no ERP não pode nascer de um número alucinado.
 */
const REGRAS_CORRECAO = `

VOCÊ TAMBÉM PODE PROPOR A CORREÇÃO

Quem escreveu não está pedindo explicação: está dizendo que algo está errado e
quer que seja consertado. Além de responder, preencha \`acao\`.

A. SÓ PROPONHA O QUE ESTÁ NOS DADOS. Todo cod_titulo da proposta tem de ser
   copiado, exatamente, de \`lancamentosEncontrados\`. Título que não está nessa
   lista é recusado pelo servidor antes de chegar à tela — e a pessoa fica lendo
   uma promessa que não aconteceu.
B. TODOS os lançamentos que se encaixam, não só o primeiro. Erro de classificação
   quase nunca é de um lançamento só: a mesma assinatura cai na mesma categoria
   errada seis vezes no mesmo mês.
C. \`categoria_codigo\` sai de \`categoriasDisponiveis\`, escolhida pela RUBRICA de
   destino: quem corrige está mirando a linha da demonstração, não o código do
   plano de contas.
D. Só entra na proposta lançamento com \`alteravel: true\`. Previsão de ordem de
   serviço e perna bancária não têm categoria própria; para esses a resposta
   explica o que houve e a ação vira "tarefa", ou nenhuma.
E. NA DÚVIDA, NÃO PROPONHA — deixe \`acao\` nula. Se você não achou o lançamento
   que a pessoa descreve, diga o que procurou e o que encontrou. "Não achei
   nenhum lançamento da Paytime em Ago/26; os quatro que existem estão em julho,
   já em Receita Markup" é uma resposta excelente. Uma proposta errada custa uma
   alteração no ERP e uma conversa com a contabilidade.
F. Quando a correção não é de classificação — o período está fechado no Omie,
   falta a nota, é dúvida da contabilidade — use \`tipo: "tarefa"\`. Vira uma linha
   do checklist do fechamento, com o contexto já escrito no título.
G. Quando o problema é o NOME e não a linha ("isso aqui é o Café dos eventos"),
   use \`tipo: "apelido"\`.
H. \`resumo\` é a linha que a pessoa lê antes de clicar: o que vai acontecer, com
   quantos lançamentos e quanto dinheiro. \`motivo\` é uma frase que fica gravada na
   trilha do Omie — quem abrir o histórico daqui a seis meses tem que entender por
   que aquele lançamento mudou de lugar.

A RESPOSTA CONTINUA SENDO RESPOSTA: diga o que encontrou e o que a proposta faz.
Não escreva "clique em aplicar" nem "vou corrigir" — o botão está logo abaixo do
seu texto, e quem aplica é quem está lendo.
`;

/**
 * A falha da IA em português, com o que o provedor disse junto.
 *
 * O 429 (cota, rajada de chamadas) chegava na tela como "Edge Function returned
 * a non-2xx status code" — a pessoa não tinha como saber que era cota, muito
 * menos que bastava esperar. Uma falha de IA não é erro de sistema: volta 200
 * com este texto, como faz a geração automática.
 */
function motivoDaIA(e: unknown): string {
  const err = e as { status?: number; message?: string; detail?: string };
  const detalhe = (err?.detail ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (err?.status === 429) {
    return "A OpenAI recusou a chamada por cota (429) — costuma ser limite de uso ou "
      + "chamadas em rajada. Espere um pouco e pergunte de novo."
      + (detalhe ? ` OpenAI: ${detalhe}` : "");
  }
  return `A IA não respondeu${err?.status ? ` (${err.status})` : ""}: ${err?.message ?? String(e)}`
    + (detalhe ? ` — ${detalhe}` : "");
}

/* ============================================================
 *  A conferência da proposta
 * ============================================================
 * ESTA É A PARTE QUE IMPEDE UMA ALUCINAÇÃO DE VIRAR ALTERAÇÃO NO ERP.
 *
 * O modelo escreve texto; um `cod_titulo` é um número de oito dígitos, que é
 * exatamente o tipo de coisa que um modelo produz plausível e errada. Por isso
 * nada do que ele devolve é aceito de palavra: cada título é procurado no MESMO
 * conjunto que foi enviado no prompt, e o que não está lá é recusado com o motivo
 * escrito. O mesmo vale para a categoria de destino, que tem de existir em
 * `omie_categorias_disponiveis` (fora as inativas e as totalizadoras).
 *
 * O que sobra é uma proposta que a tela pode desenhar item a item — e que a
 * pessoa confere antes de clicar, porque quem aplica é ela.
 */

type Candidato = {
  cod_titulo: string;
  rubrica: string | null;
  mes: string;
  data: string | null;
  contraparte: string | null;
  documento: string | null;
  categoria: string | null;
  codigo: string | null;
  grupo: string | null;
  valor: number;
  observacao: string | null;
};

type CategoriaOmie = {
  codigo: string;
  descricao: string;
  despesa: boolean;
  receita: boolean;
  rubrica_dre: string | null;
  rubrica_dfc: string | null;
  usos: number;
};

/** O que o modelo devolveu — ainda sem conferência nenhuma. */
type AcaoCrua = {
  tipo?: string | null;
  resumo?: string | null;
  motivo?: string | null;
  categoria_codigo?: string | null;
  cod_titulos?: string[] | null;
  contraparte_nome?: string | null;
  apelido?: string | null;
  tarefa_titulo?: string | null;
  tarefa_responsavel?: string | null;
};

const texto = (v: unknown, max: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Por que este título não pode ser mexido — na língua de quem vai ler. */
function motivoNaoAlteravel(grupo: string | null): string {
  if (grupo?.startsWith("PREVISAO")) {
    return "previsão gerada por ordem de serviço/contrato — a categoria vem do documento de origem";
  }
  if (grupo?.startsWith("CONTA_CORRENTE")) return "perna bancária do título — não tem classificação própria";
  return "tipo de lançamento sem categoria alterável pelo Hub";
}

function conferirAcao(
  crua: AcaoCrua | null | undefined,
  candidatos: Map<string, Candidato>,
  categorias: CategoriaOmie[],
  tipo: "dre" | "dfc",
): Record<string, unknown> | null {
  const kind = texto(crua?.tipo, 40);
  if (!crua || !kind) return null;

  const resumo = texto(crua.resumo, 300) || null;
  const motivo = texto(crua.motivo, 400) || null;

  /* Tarefa e apelido não tocam no ERP: a validação é só de forma, e quem escreve
     de fato é a tela (`salvarApelido` e a RPC do fechamento têm as regras deles,
     e duplicá-las aqui criaria a segunda cópia que diverge). */
  if (kind === "tarefa") {
    const titulo = texto(crua.tarefa_titulo, 220);
    if (titulo.length < 3) return null;
    return { tipo: "tarefa", resumo, motivo, titulo, responsavel: texto(crua.tarefa_responsavel, 80) || null };
  }

  if (kind === "apelido") {
    const nome = texto(crua.contraparte_nome, 200);
    const apelido = texto(crua.apelido, 120);
    if (!nome || apelido.length < 2) return null;
    /* O CNPJ, quando algum dos lançamentos lidos souber dele: é identidade de
       verdade, e o cadastro casa por documento antes de casar por nome. */
    const chave = nome.toLowerCase();
    const doc = [...candidatos.values()]
      .find((c) => (c.contraparte ?? "").toLowerCase().includes(chave) && c.documento)?.documento ?? null;
    return { tipo: "apelido", resumo, motivo, nome, apelido, documento: doc };
  }

  if (kind !== "trocar_categoria") return null;

  const destino = categorias.find((c) => c.codigo === texto(crua.categoria_codigo, 40));
  // Categoria inventada, inativa ou totalizadora: a proposta inteira cai. Sem
  // destino não há o que propor, e adivinhar qual ele quis dizer é pior.
  if (!destino) return null;

  const rubricaDestino = (tipo === "dre" ? destino.rubrica_dre : destino.rubrica_dfc) ?? null;

  const itens: Record<string, unknown>[] = [];
  const recusados: Record<string, unknown>[] = [];
  const vistos = new Set<string>();
  let total = 0;

  for (const bruto of crua.cod_titulos ?? []) {
    const cod = texto(bruto, 40);
    if (!cod || vistos.has(cod)) continue;
    vistos.add(cod);

    const c = candidatos.get(cod);
    if (!c) {
      recusados.push({ cod_titulo: cod, motivo: "não está entre os lançamentos lidos" });
      continue;
    }
    if (!GRUPOS_ALTERAVEIS.has(String(c.grupo ?? ""))) {
      recusados.push({ cod_titulo: cod, contraparte: c.contraparte, motivo: motivoNaoAlteravel(c.grupo) });
      continue;
    }
    if (c.codigo === destino.codigo) {
      recusados.push({ cod_titulo: cod, contraparte: c.contraparte, motivo: "já está nessa categoria" });
      continue;
    }
    if (itens.length >= MAX_ITENS_ACAO) {
      recusados.push({ cod_titulo: cod, contraparte: c.contraparte, motivo: `acima do teto de ${MAX_ITENS_ACAO} por proposta` });
      continue;
    }

    total += c.valor;
    itens.push({
      cod_titulo: c.cod_titulo,
      data: c.data,
      mes: c.mes,
      contraparte: c.contraparte,
      valor: c.valor,
      grupo: c.grupo,
      categoria_codigo: c.codigo,
      categoria_descricao: c.categoria,
      rubrica_atual: c.rubrica,
    });
  }

  /* Proposta sem item nenhum ainda vai para a tela, com os motivos: "a IA quis
     mover quatro títulos e nenhum pode ser mexido" é informação, e engolir isso
     deixaria a resposta prometendo uma correção que sumiu no caminho. É a tela
     que decide não desenhar o botão. */
  return {
    tipo: "trocar_categoria",
    resumo,
    motivo,
    categoria: { codigo: destino.codigo, descricao: destino.descricao },
    rubrica_destino: rubricaDestino,
    itens,
    recusados,
    total,
  };
}

/* ============================================================ */

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body: Corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const tipo = body?.tipo === "dfc" ? "dfc" : "dre";
    const rubrica = String(body?.rubrica ?? "").trim();
    const mes = String(body?.mes ?? "").trim();
    const mesAnterior = String(body?.mesAnterior ?? "").trim();
    const pergunta = String(body?.pergunta ?? "").trim();
    const despesa = !!body?.despesa;
    const travado = !!body?.travado;
    /* Linha de % ("% Margem EBITDA"): o valor é uma razão, não dinheiro. Sem
       isto, 0,42 sairia formatado como R$ 0,42 e a resposta falaria de quarenta
       e dois centavos de margem. */
    const percentual = !!body?.percentual;
    const fontes = Array.isArray(body?.fontes) && body.fontes.length
      ? [...new Set(body.fontes.map((f) => String(f)))]
      : [rubrica];

    if (!rubrica) return jsonResponse({ error: "rubrica obrigatória." }, 200);
    if (!/^[A-Za-z]{3}-\d{2}$/.test(mes)) return jsonResponse({ error: "mes inválido (esperado 'Jul-26')." }, 200);
    if (pergunta.length < 3) return jsonResponse({ error: "Escreva a pergunta." }, 200);
    if (pergunta.length > 1500) return jsonResponse({ error: "Pergunta longa demais (máx. 1500 caracteres)." }, 200);

    const temAnterior = /^[A-Za-z]{3}-\d{2}$/.test(mesAnterior);
    const meses = temAnterior ? [mesAnterior, mes] : [mes];

    /* --- 0) Triagem: entender ou consertar? -------------------------------
       Disparada aqui e colhida depois do passo 3: ela só depende da FRASE, então
       roda enquanto o banco devolve o fio, os drivers e os lançamentos. Esperar
       por ela primeiro somaria os dois tempos por nada. */
    const triagemP = (async () => {
      try {
        const t = await generateJSON<{ intencao?: string; buscar?: string[] }>({
          temperature: 0,
          timeoutMs: PRAZO_TRIAGEM_MS,
          maxTokens: 300,
          responseSchema: {
            type: "object",
            properties: {
              intencao: { type: "string", enum: ["pergunta", "correcao"] },
              buscar: { type: "array", items: { type: "string" } },
            },
            required: ["intencao", "buscar"],
          },
          messages: [
            { role: "system", content: REGRAS_TRIAGEM },
            {
              role: "user",
              content: `Célula: "${rubrica}" em ${rotuloMes(mes)} da ${tipo.toUpperCase()}.\nFrase: ${pergunta}`,
            },
          ],
        });
        return {
          correcao: t?.intencao === "correcao",
          termos: [...new Set((t?.buscar ?? []).map((s) => texto(s, 60)).filter((s) => s.length >= 3))]
            .slice(0, MAX_TERMOS),
        };
      } catch (e) {
        /* A triagem cair não pode derrubar a pergunta. Sem ela o chat volta a ser
           exatamente o que era antes desta funcionalidade: responde pela célula,
           não procura no mês inteiro e não propõe nada. Degradar é melhor do que
           recusar uma pergunta que teria resposta. */
        console.error("triagem falhou (segue sem busca nem proposta):", e);
        return { correcao: false, termos: [] as string[] };
      }
    })();

    /* Orientação dos valores: em rubrica de despesa o Omie lança negativo. O
       sinal é INVERTIDO, não posto em módulo — assim gastar mais é positivo (que
       é como se lê no tracker) e um estorno continua aparecendo como negativo.
       Em módulo, o estorno viraria gasto, e ele é justamente o tipo de coisa que
       responde "por que não subiu". */
    const orient = (n: number | null | undefined) => (n == null ? 0 : despesa ? -n : n);
    /** O valor da CÉLULA — dinheiro na maioria das linhas, percentual em algumas. */
    const fmtCelula = (n: number) =>
      percentual ? `${(n * 100).toFixed(1).replace(".", ",")}%` : brl(n);

    /* --- 1) O fio: o que já foi perguntado nesta célula ------------------- */
    const { data: fioData } = await supabase
      .from("demonstracoes_perguntas")
      .select("pergunta,resposta,autor_email,criado_em")
      .eq("tipo", tipo)
      .eq("rubrica", rubrica)
      .eq("mes", mes)
      .order("criado_em", { ascending: true });
    const fio = ((fioData ?? []) as { pergunta: string; resposta: string }[]).slice(-MAX_FIO);

    /* --- 2) Quem se mexeu (mesmo insumo das justificativas) --------------- */
    const [{ data: contras, error: contraErr }, pessoas] = await Promise.all([
      supabase.rpc("demonstracoes_contrapartes", {
        p_tipo: tipo,
        p_meses: meses,
      }),
      /* O de-para "razão social -> pessoa". Esta função é a que mais expõe nome:
         40 contrapartes, 150 lançamentos e a observação CRUA do título. Por isso
         ele entra nos três, e ainda varre a resposta pronta no fim. */
      carregarPessoasPJ(supabase),
    ]);
    if (contraErr) throw contraErr;

    const porFonte = new Set(fontes.map((f) => f.trim().toLowerCase()));
    const porContraparte = new Map<string, { atual: number; anterior: number; categoria: string | null; n: number }>();
    for (const r of (contras ?? []) as Record<string, unknown>[]) {
      if (!porFonte.has(String(r.rubrica ?? "").trim().toLowerCase())) continue;
      const nome = pessoaDe(pessoas, String(r.contraparte ?? "Sem contraparte"));
      const acc = porContraparte.get(nome) ?? { atual: 0, anterior: 0, categoria: (r.categoria as string) ?? null, n: 0 };
      const v = orient(Number(r.valor) || 0);
      if (String(r.mes) === mes) acc.atual += v; else acc.anterior += v;
      acc.n += Number(r.lancamentos) || 0;
      porContraparte.set(nome, acc);
    }

    const drivers = [...porContraparte.entries()]
      .map(([contraparte, v]) => {
        const delta = v.atual - v.anterior;
        return {
          contraparte,
          categoria: v.categoria,
          atual: v.atual,
          anterior: v.anterior,
          delta,
          movimento:
            Math.abs(v.anterior) < 1 ? "entrou"
            : Math.abs(v.atual) < 1 ? "saiu"
            : Math.abs(delta) < 1 ? "igual"
            : delta > 0 ? "aumentou" : "reduziu",
          fmtAtual: brl(v.atual),
          fmtAnterior: brl(v.anterior),
          fmtDelta: `${delta > 0 ? "+" : ""}${abrev(delta)}`,
        };
      })
      /* Ordenado pelo TAMANHO, não pela variação: numa pergunta do tipo "por que
         não subiu?", quem ficou igual é a resposta — e ordenar por delta jogaria
         justamente essa gente para fora do corte. */
      .sort((a, b) => Math.max(Math.abs(b.atual), Math.abs(b.anterior)) - Math.max(Math.abs(a.atual), Math.abs(a.anterior)))
      .slice(0, MAX_DRIVERS);

    /* --- 3) Os lançamentos, título a título ------------------------------- */
    const { data: lanc, error: lancErr } = await supabase.rpc("demonstracoes_lancamentos_multi", {
      p_tipo: tipo,
      p_rubricas: fontes,
      p_meses: meses,
    });
    if (lancErr) throw lancErr;

    const porMes = new Map<string, Record<string, unknown>[]>();
    for (const l of (lanc ?? []) as Record<string, unknown>[]) {
      const k = String(l.mes);
      const acc = porMes.get(k);
      if (acc) acc.push(l); else porMes.set(k, [l]);
    }

    const blocos = meses.map((m) => {
      const linhas = porMes.get(m) ?? [];
      const soma = linhas.reduce((s, l) => s + orient(Number(l.valor) || 0), 0);
      const mostradas = [...linhas]
        .sort((a, b) => Math.abs(Number(b.valor) || 0) - Math.abs(Number(a.valor) || 0))
        .slice(0, MAX_LANCAMENTOS);
      return {
        mes: rotuloMes(m),
        lancamentos: linhas.length,
        somaDosLancamentos: brl(soma),
        soma,
        // O que não coube é CONTADO. Um corte silencioso viraria "só teve isso" na
        // cabeça de quem lê a resposta.
        omitidos: linhas.length - mostradas.length,
        linhas: mostradas.map((l) => ({
          data: dataCurta(l.data as string),
          contraparte: pessoaDe(pessoas, (l.contraparte as string) ?? "sem nome no cadastro"),
          rubrica: l.rubrica,
          categoriaNoOmie: l.categoria,
          valor: brl(orient(Number(l.valor) || 0)),
          /* O memo vai cru (é o que mantém esta resposta e a tela do cartão
             falando do mesmo lojista), mas a razão social que for de uma pessoa
             sai trocada: é justamente aqui que ela escapava da troca dos
             drivers e reaparecia no texto. O `null` é preservado — vira "sem
             observação" na leitura do modelo, e "" diria outra coisa. */
          textoDoTitulo: (() => {
            const m = memo(l.observacao as string);
            return m == null ? null : pessoasNoTexto(pessoas, m);
          })(),
        })),
      };
    });

    /* --- 3b) O mês inteiro, atrás do que a pergunta nomeou ----------------
       Os blocos acima param na fronteira da célula. Aqui se atravessa: o
       lançamento classificado errado está, por definição, na rubrica errada. */
    const { correcao, termos } = await triagemP;

    const candidatos = new Map<string, Candidato>();
    const guardar = (linhas: unknown) => {
      for (const l of (linhas ?? []) as Record<string, unknown>[]) {
        const cod = texto(l.cod_titulo, 40);
        if (!cod || candidatos.has(cod)) continue;
        candidatos.set(cod, {
          cod_titulo: cod,
          rubrica: (l.rubrica as string) ?? null,
          mes: String(l.mes ?? ""),
          data: (l.data as string) ?? null,
          contraparte: pessoaDe(pessoas, (l.contraparte as string) ?? "sem nome no cadastro"),
          documento: (l.documento as string) ?? null,
          categoria: (l.categoria as string) ?? null,
          codigo: (l.codigo as string) ?? null,
          grupo: (l.grupo as string) ?? null,
          valor: Number(l.valor) || 0,
          observacao: (l.observacao as string) ?? null,
        });
      }
    };

    const [porNome, daCelula, catRows] = await Promise.all([
      termos.length
        ? supabase.rpc("demonstracoes_lancamentos_busca", {
          p_tipo: tipo, p_meses: meses, p_busca: termos, p_limite: MAX_BUSCA_NOMES,
        })
        : Promise.resolve({ data: null, error: null }),
      /* A própria célula só entra no conjunto de candidatos quando há conserto a
         fazer — é o caso "essa linha aqui está errada", em que o alvo é a rubrica
         e não um fornecedor. Numa pergunta comum seria uma varredura para nada.
         Vai numa chamada SEPARADA da busca por nome, e não no mesmo array de
         termos, para os dois recortes não dividirem o mesmo teto: num mês de
         "Pessoal" as 300 linhas da rubrica engoliriam as três da Paytime. */
      correcao
        ? supabase.rpc("demonstracoes_lancamentos_busca", {
          p_tipo: tipo, p_meses: meses, p_busca: fontes, p_limite: MAX_BUSCA_CELULA,
        })
        : Promise.resolve({ data: null, error: null }),
      // O plano de contas só é carregado quando há proposta a montar: são 133
      // linhas que não têm o que fazer no prompt de uma pergunta comum.
      correcao ? supabase.rpc("omie_categorias_disponiveis") : Promise.resolve({ data: null, error: null }),
    ]);

    /* Busca que falha não derruba a resposta: ela é ENRIQUECIMENTO. O que se
       perde é a proposta — e a resposta sai dizendo o que viu na célula. */
    if (porNome.error) console.error("busca por nome falhou:", porNome.error.message);
    if (daCelula.error) console.error("busca da célula falhou:", daCelula.error.message);
    if (catRows?.error) console.error("categorias não carregadas:", catRows.error.message);
    guardar(porNome.data);
    guardar(daCelula.data);
    const categorias = (catRows?.data as CategoriaOmie[] | null) ?? [];

    /* Sinal CRU aqui, ao contrário dos blocos da célula: esta lista atravessa
       rubricas, e orientá-la pela natureza da célula perguntada faria a receita
       aparecer negativa sempre que a pergunta fosse sobre uma despesa — o mesmo
       motivo de `linhaSolta` mais abaixo. */
    const encontrados = [...candidatos.values()]
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
      .map((c) => ({
        cod_titulo: c.cod_titulo,
        data: dataCurta(c.data),
        mes: rotuloMes(c.mes),
        contraparte: c.contraparte,
        // Nulo aqui é informação, não falha: a categoria está fora do DE-PARA e o
        // lançamento não aparece em linha nenhuma da demonstração.
        rubricaAtual: c.rubrica ?? "fora do DE-PARA — não aparece na demonstração",
        categoriaNoOmie: c.categoria,
        categoriaCodigo: c.codigo,
        valor: brl(c.valor),
        alteravel: GRUPOS_ALTERAVEIS.has(String(c.grupo ?? "")),
        textoDoTitulo: (() => {
          const m = memo(c.observacao);
          return m == null ? null : pessoasNoTexto(pessoas, m);
        })(),
      }));

    /* --- 4) O que a tela já sabe ------------------------------------------ */
    const valorO = orient(body?.valor);
    const anteriorO = orient(body?.valorAnterior);
    const deltaO = valorO - anteriorO;
    const somaOmie = blocos.find((b) => b.mes === rotuloMes(mes))?.soma ?? 0;
    const diferenca = valorO - somaOmie;

    const serie = (body?.serie ?? [])
      .filter((p) => p && typeof p.mes === "string")
      .map((p) => ({ mes: rotuloMes(p.mes), valor: p.valor == null ? null : fmtCelula(orient(p.valor)) }));

    type Linha = { rubrica: string; valor: number | null; valorAnterior: number | null };
    /* Filha de uma rubrica de despesa também é despesa: entra com a MESMA
       orientação da célula, senão a quebra apareceria com o sinal trocado em
       relação ao número que ela compõe. */
    const linhaFilha = (l: Linha) => ({
      rubrica: l.rubrica,
      atual: l.valor == null ? null : brl(orient(l.valor)),
      anterior: l.valorAnterior == null ? null : brl(orient(l.valorAnterior)),
    });
    /* As outras linhas do mês vão CRUAS, como estão na demonstração. Orientá-las
       pela natureza da célula perguntada faria a Receita Bruta aparecer negativa
       sempre que a pergunta fosse sobre uma despesa. */
    const linhaSolta = (l: Linha) => ({
      rubrica: l.rubrica,
      atual: l.valor == null ? null : brl(l.valor),
      anterior: l.valorAnterior == null ? null : brl(l.valorAnterior),
    });

    const payload = {
      demonstrativo: tipo.toUpperCase(),
      rubrica,
      mes: rotuloMes(mes),
      mesAnterior: temAnterior ? rotuloMes(mesAnterior) : null,
      natureza: percentual
        ? "linha de percentual — o valor é uma razão entre outras duas linhas, não dinheiro"
        : despesa
          ? "despesa — valores orientados: positivo = gasto, negativo = estorno/crédito"
          : "receita/resultado",
      valorNaTela: fmtCelula(valorO),
      valorNoMesAnterior: temAnterior ? fmtCelula(anteriorO) : null,
      variacao: !temAnterior ? null
        : percentual
          ? `${deltaO > 0 ? "subiu" : deltaO < 0 ? "caiu" : "ficou igual"} ${(Math.abs(deltaO) * 100).toFixed(1).replace(".", ",")} p.p.`
          : `${deltaO > 0 ? "subiu" : deltaO < 0 ? "caiu" : "ficou igual"} ${abrev(Math.abs(deltaO))}`,
      mesTravado: travado,
      // Numa linha de percentual não há o que conferir: ela não tem lançamento
      // próprio, e comparar uma razão com a soma de reais só produziria ruído.
      conferencia: percentual ? null : {
        somaDosLancamentosDoOmie: brl(somaOmie),
        diferencaContraATela: brl(diferenca),
        observacao: Math.abs(diferenca) < 1
          ? "a soma dos lançamentos bate com a célula"
          : travado
            ? "mês travado: o valor da tela veio do tracker importado, não do Omie"
            : "a soma dos lançamentos não bate com a célula (lançamento fora da janela de sincronização, DE-PARA ou valor digitado à mão)",
      },
      /* Sem isto, uma linha derivada (EBITDA, Margem, um total) receberia uma
         resposta construída sobre lançamento nenhum — e o modelo preencheria o
         vazio. Aqui ele sabe que não há o que descer. */
      temLancamentoProprio: (lanc ?? []).length > 0,
      serieDaCelula: serie,
      composicaoPorLinhaFilha: (body?.filhos ?? []).map(linhaFilha),
      /* Não é convite para falar das outras linhas: é o que permite responder
         "não subiu aqui porque foi parar ali" sem inventar. Vêm com o sinal da
         demonstração (despesa negativa). */
      outrasLinhasDoMes: (body?.resumoMes ?? []).map(linhaSolta),
      quemSeMexeu: drivers.map((d) => ({
        contraparte: d.contraparte,
        categoriaNoOmie: d.categoria,
        movimento: d.movimento,
        mesAnterior: d.fmtAnterior,
        mesAtual: d.fmtAtual,
        variacao: d.fmtDelta,
      })),
      lancamentosDoOmie: blocos.map(({ soma: _soma, ...b }) => b),
      /* O que a célula não vê. Só entra quando a pergunta nomeou alguém (ou pediu
         conserto): é a única lista da qual uma proposta pode tirar títulos, e é
         também o que permite responder "está lançado, mas em Receita Markup". */
      ...(encontrados.length
        ? {
          lancamentosEncontrados: {
            procureiPor: termos.length ? termos : fontes,
            nosMeses: meses.map(rotuloMes),
            achados: encontrados.length,
            nota: "varredura do mês inteiro, em TODAS as rubricas — inclusive fora do DE-PARA. "
              + "É desta lista, e só dela, que podem sair os cod_titulo de uma proposta.",
            linhas: encontrados,
          },
        }
        : termos.length
          ? { lancamentosEncontrados: { procureiPor: termos, achados: 0, nota: "nenhum lançamento do mês casa com esses nomes." } }
          : {}),
      ...(correcao && categorias.length
        ? {
          categoriasDisponiveis: categorias
            // Categoria que a empresa realmente usa primeiro: o destino certo é,
            // quase sempre, um dos que já receberam lançamento parecido.
            .sort((a, b) => (Number(b.usos) || 0) - (Number(a.usos) || 0))
            .map((c) => ({
              codigo: c.codigo,
              descricao: c.descricao,
              rubrica: (tipo === "dre" ? c.rubrica_dre : c.rubrica_dfc) ?? "fora do DE-PARA",
            })),
        }
        : {}),
    };

    /* --- 5) Redação ------------------------------------------------------- */
    let orgCtx = "";
    try { orgCtx = await buildOrgContext(supabase); } catch { /* segue sem a Biblioteca */ }

    /* `acao` fica FORA do `required`: no modo estrito da OpenAI o que não é
       exigido vira anulável (ver `paraStrict` em `_shared/openai.ts`), e é
       exatamente o que se quer — "não há o que propor" precisa ser uma saída
       possível, senão o modelo inventa uma correção para preencher o campo. */
    const schema = {
      type: "object",
      properties: {
        resposta: { type: "string" },
        confianca: { type: "string", enum: ["alta", "media", "baixa"] },
        ...(correcao
          ? {
            acao: {
              type: "object",
              properties: {
                tipo: { type: "string", enum: ["trocar_categoria", "apelido", "tarefa"] },
                resumo: { type: "string" },
                motivo: { type: "string" },
                categoria_codigo: { type: "string" },
                cod_titulos: { type: "array", items: { type: "string" } },
                contraparte_nome: { type: "string" },
                apelido: { type: "string" },
                tarefa_titulo: { type: "string" },
                tarefa_responsavel: { type: "string" },
              },
              required: ["tipo"],
            },
          }
          : {}),
      },
      required: ["resposta", "confianca"],
    };

    /* As respostas do fio foram gravadas antes de o de-para existir (ou antes
       deste nome entrar nele) e carregam a razão social. Sem esta passada, o
       modelo leria "DALBER NEGOCIOS" no próprio histórico e repetiria. */
    const historico = fio.length
      ? `\n\nJÁ FOI PERGUNTADO NESTA MESMA CÉLULA (mais antigo primeiro) — a pergunta de agora pode ser um repique disto:\n`
        + fio.map((f, i) => `${i + 1}. P: ${f.pergunta}\n   R: ${pessoasNoTexto(pessoas, f.resposta)}`).join("\n")
      : "";

    const redigir = () => generateJSON<{ resposta: string; confianca: string; acao?: AcaoCrua | null }>({
      temperature: 0.3,
      responseSchema: schema,
      messages: [
        { role: "system", content: `${REGRAS}${correcao ? REGRAS_CORRECAO : ""}\n\n${orgCtx}` },
        {
          role: "user",
          content:
            `PERGUNTA: ${pergunta}\n\n`
            + `Ela é sobre a célula "${rubrica}" em ${rotuloMes(mes)} da ${tipo.toUpperCase()}.`
            + historico
            + `\n\nDADOS DA CÉLULA:\n`
            + JSON.stringify(payload, null, 1),
        },
      ],
    });

    /* Uma segunda tentativa, com pausa — mesmo remédio da geração automática: o
       provedor responde 429 quando as chamadas vêm em rajada, e a pausa é o que
       faz a segunda passar. Se falhar de novo, o motivo vai para a tela em
       PORTUGUÊS, com status 200: falha de IA não é a função quebrando. */
    let out: { resposta: string; confianca: string; acao?: AcaoCrua | null } | null = null;
    try {
      out = await redigir();
    } catch {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        out = await redigir();
      } catch (e2) {
        console.error("demonstracoes-perguntar IA falhou:", e2);
        return jsonResponse({ error: motivoDaIA(e2) }, 200);
      }
    }

    /* Rede, não o caminho principal — drivers, lançamentos e memo já foram
       trocados na entrada. Serve para a razão social que o modelo pescou na
       Biblioteca ou reescreveu por conta própria. */
    const resposta = pessoasNoTexto(pessoas, String(out?.resposta ?? "").trim());
    if (!resposta) {
      return jsonResponse({ error: "A IA não devolveu resposta. Tente reformular a pergunta." }, 200);
    }

    /* A proposta passa pela peneira: título que não veio nos dados, categoria que
       não existe e lançamento que o ERP não deixa mexer caem aqui, e não na cara
       de quem clicar. `null` significa "só resposta", que é o desfecho normal. */
    const acao = correcao ? conferirAcao(out?.acao, candidatos, categorias, tipo) : null;

    /* --- 6) Grava --------------------------------------------------------- */
    const { data: linha, error: insErr } = await supabase
      .from("demonstracoes_perguntas")
      .insert({
        tipo,
        rubrica,
        mes,
        mes_anterior: temAnterior ? mesAnterior : null,
        pergunta,
        resposta,
        valor: body?.valor ?? null,
        valor_anterior: body?.valorAnterior ?? null,
        travado,
        drivers,
        dados: {
          fontes,
          lancamentos: (lanc ?? []).length,
          omitidos: blocos.reduce((s, b) => s + b.omitidos, 0),
          soma_omie: somaOmie,
          diferenca_contra_tela: diferenca,
          contrapartes: porContraparte.size,
          // A prova da varredura larga, ao lado da prova da célula: quem lê a
          // resposta vê que ela procurou "paytime" no mês inteiro e achou 4.
          busca: termos,
          encontrados: candidatos.size,
          correcao,
        },
        acao,
        acao_estado: acao ? "proposta" : null,
        confianca: ["alta", "media", "baixa"].includes(String(out?.confianca)) ? out.confianca : "media",
        autor_id: caller.userId,
        autor_email: caller.email ?? null,
        modelo: DEFAULT_MODEL,
      })
      .select("*")
      .single();
    if (insErr) throw insErr;

    return jsonResponse({ ok: true, pergunta: linha });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("demonstracoes-perguntar error:", msg);
    if (msg.includes("autentic") || msg.includes("permissão")) return jsonResponse({ error: msg }, 401);
    return errorResponse(e);
  }
});
