// Núcleo de Passagens: montar a busca do Google Flights e ler de volta o alerta
// que ele manda por e-mail.
//
// ESTE ARQUIVO NÃO IMPORTA NADA — mesmo motivo do `radar-precos.ts`: o Deno da
// Edge Function lê com `.ts` e o front lê via `src/lib/passagens.ts`, que só
// reexporta. Duas cópias do mesmo parser divergiriam na primeira vez que alguém
// ajustasse uma delas, e o sintoma não seria erro de build — seria a tela
// mostrando um preço que o servidor não gravou.
//
// POR QUE O GOOGLE FLIGHTS, E NÃO UMA API. Em 2026 o caminho de API fechou: a
// Amadeus Self-Service desligou em 17/07/2026 (portal fora do ar, chaves
// mortas), a Kiwi Tequila fechou para novos desenvolvedores em agosto, e o modo
// de teste da Duffel devolve sandbox, não preço real. O que sobrou de graça é o
// próprio Google: ele monitora quantas rotas você quiser, sem cobrar e sem
// anti-robô, e avisa por e-mail. O trabalho que sobra para o Hub é o que o
// Google não faz — comparar com o SEU teto e calar a boca no resto.
//
// O QUE ISTO NÃO É: um extrator genérico de e-mail de viagem. É um casador
// contra uma lista curta e conhecida — as viagens que estão abertas agora. Essa
// é a diferença entre um problema difícil ("de que voo fala este texto?") e um
// fácil ("qual destas oito viagens combina com este texto?"). Todo o desenho
// abaixo depende disso, e é o que o torna robusto a mudança de layout do Google.

/* ------------------------------------------------------------------ tipos */

export interface Aeroporto {
  /** Código IATA, em maiúsculas. É a chave. */
  iata: string;
  /** Como a pessoa chama: "São Paulo (Guarulhos)". */
  nome: string;
  /** Só a cidade, que é o que o e-mail do Google costuma escrever. */
  cidade: string;
  uf?: string;
  pais?: string;
}

/** A viagem, no mínimo que o casamento precisa saber. */
export interface ViagemParaCasar {
  id: string;
  origem: string;
  destino: string;
  /** ISO `YYYY-MM-DD`. */
  data_ida: string;
  data_volta?: string | null;
}

export interface Casamento {
  viagem_id: string | null;
  preco: number | null;
  /** `alta` grava sem perguntar; `media` grava e marca; `null` vai para a fila humana. */
  confianca: "alta" | "media" | null;
  /** Em português, para a tela. Sempre preenchido quando não casou. */
  motivo: string;
}

/* ---------------------------------------------------------- normalização */

/** minúsculas, sem acento, sem pontuação — a forma em que tudo aqui compara. */
export function norm(s: string | null | undefined): string {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------ aeroportos */

/**
 * Os aeroportos que a lista de escolha oferece.
 *
 * NÃO É EXAUSTIVA, E NÃO PRECISA SER: o formulário aceita IATA digitada à mão
 * para o que não estiver aqui. Esta lista existe para o caso comum — e o caso
 * comum de uma empresa capixaba é VIX contra as capitais.
 *
 * `cidade` é campo próprio, separado de `nome`, porque é ele que o e-mail do
 * Google escreve: o alerta fala "São Paulo", não "São Paulo (Guarulhos)".
 * Casar pelo nome completo erraria em todo alerta de GRU.
 */
export const AEROPORTOS: Aeroporto[] = [
  { iata: "VIX", nome: "Vitória", cidade: "Vitória", uf: "ES" },
  { iata: "GRU", nome: "São Paulo (Guarulhos)", cidade: "São Paulo", uf: "SP" },
  { iata: "CGH", nome: "São Paulo (Congonhas)", cidade: "São Paulo", uf: "SP" },
  { iata: "VCP", nome: "Campinas (Viracopos)", cidade: "Campinas", uf: "SP" },
  { iata: "GIG", nome: "Rio de Janeiro (Galeão)", cidade: "Rio de Janeiro", uf: "RJ" },
  { iata: "SDU", nome: "Rio de Janeiro (Santos Dumont)", cidade: "Rio de Janeiro", uf: "RJ" },
  { iata: "BSB", nome: "Brasília", cidade: "Brasília", uf: "DF" },
  { iata: "CNF", nome: "Belo Horizonte (Confins)", cidade: "Belo Horizonte", uf: "MG" },
  { iata: "SSA", nome: "Salvador", cidade: "Salvador", uf: "BA" },
  { iata: "REC", nome: "Recife", cidade: "Recife", uf: "PE" },
  { iata: "FOR", nome: "Fortaleza", cidade: "Fortaleza", uf: "CE" },
  { iata: "POA", nome: "Porto Alegre", cidade: "Porto Alegre", uf: "RS" },
  { iata: "CWB", nome: "Curitiba", cidade: "Curitiba", uf: "PR" },
  { iata: "FLN", nome: "Florianópolis", cidade: "Florianópolis", uf: "SC" },
  { iata: "NAT", nome: "Natal", cidade: "Natal", uf: "RN" },
  { iata: "MCZ", nome: "Maceió", cidade: "Maceió", uf: "AL" },
  { iata: "JPA", nome: "João Pessoa", cidade: "João Pessoa", uf: "PB" },
  { iata: "AJU", nome: "Aracaju", cidade: "Aracaju", uf: "SE" },
  { iata: "THE", nome: "Teresina", cidade: "Teresina", uf: "PI" },
  { iata: "SLZ", nome: "São Luís", cidade: "São Luís", uf: "MA" },
  { iata: "BEL", nome: "Belém", cidade: "Belém", uf: "PA" },
  { iata: "MAO", nome: "Manaus", cidade: "Manaus", uf: "AM" },
  { iata: "GYN", nome: "Goiânia", cidade: "Goiânia", uf: "GO" },
  { iata: "CGB", nome: "Cuiabá", cidade: "Cuiabá", uf: "MT" },
  { iata: "CGR", nome: "Campo Grande", cidade: "Campo Grande", uf: "MS" },
  { iata: "PMW", nome: "Palmas", cidade: "Palmas", uf: "TO" },
  { iata: "IGU", nome: "Foz do Iguaçu", cidade: "Foz do Iguaçu", uf: "PR" },
  { iata: "NVT", nome: "Navegantes", cidade: "Navegantes", uf: "SC" },
  { iata: "IOS", nome: "Ilhéus", cidade: "Ilhéus", uf: "BA" },
  { iata: "UDI", nome: "Uberlândia", cidade: "Uberlândia", uf: "MG" },
  { iata: "RAO", nome: "Ribeirão Preto", cidade: "Ribeirão Preto", uf: "SP" },
  { iata: "LDB", nome: "Londrina", cidade: "Londrina", uf: "PR" },
  { iata: "MGF", nome: "Maringá", cidade: "Maringá", uf: "PR" },
  { iata: "EZE", nome: "Buenos Aires (Ezeiza)", cidade: "Buenos Aires", pais: "Argentina" },
  { iata: "SCL", nome: "Santiago", cidade: "Santiago", pais: "Chile" },
  { iata: "MVD", nome: "Montevidéu", cidade: "Montevidéu", pais: "Uruguai" },
  { iata: "LIM", nome: "Lima", cidade: "Lima", pais: "Peru" },
  { iata: "BOG", nome: "Bogotá", cidade: "Bogotá", pais: "Colômbia" },
  { iata: "PTY", nome: "Cidade do Panamá", cidade: "Panamá", pais: "Panamá" },
  { iata: "MEX", nome: "Cidade do México", cidade: "Cidade do México", pais: "México" },
  { iata: "MIA", nome: "Miami", cidade: "Miami", pais: "EUA" },
  { iata: "MCO", nome: "Orlando", cidade: "Orlando", pais: "EUA" },
  { iata: "JFK", nome: "Nova York (JFK)", cidade: "Nova York", pais: "EUA" },
  { iata: "LIS", nome: "Lisboa", cidade: "Lisboa", pais: "Portugal" },
  { iata: "MAD", nome: "Madri", cidade: "Madri", pais: "Espanha" },
  { iata: "CDG", nome: "Paris (Charles de Gaulle)", cidade: "Paris", pais: "França" },
  { iata: "LHR", nome: "Londres (Heathrow)", cidade: "Londres", pais: "Reino Unido" },
];

const PORIATA = new Map(AEROPORTOS.map((a) => [a.iata, a]));

/** O aeroporto pela IATA. `null` para código digitado à mão que não está na lista. */
export function aeroporto(iata: string | null | undefined): Aeroporto | null {
  return PORIATA.get(String(iata ?? "").toUpperCase()) ?? null;
}

/** "GRU → REC" — o rótulo curto que a linha da tabela usa. */
export function rotaTexto(origem: string, destino: string): string {
  return `${String(origem ?? "").toUpperCase()} → ${String(destino ?? "").toUpperCase()}`;
}

/* --------------------------------------------------- o link do Google Flights */

/**
 * A busca do Google Flights já preenchida.
 *
 * O `q=` em linguagem natural é usado de propósito, em vez do parâmetro `tfs`
 * (que é um protobuf em base64): o `tfs` é o formato "de verdade" e muda sem
 * aviso, porque é interno. A frase em inglês é a interface pública que o Google
 * documenta para links e sobrevive a redesenho.
 *
 * `hl=pt-BR&curr=BRL` porque sem eles o Google decide pelo IP e pela conta — e
 * um alerta criado em dólar manda e-mail em dólar, que quebraria o parser de
 * preço lá embaixo sem ninguém entender por quê.
 */
export function linkGoogleFlights(v: {
  origem: string; destino: string; data_ida: string; data_volta?: string | null;
}): string {
  const q = v.data_volta
    ? `Flights from ${v.origem} to ${v.destino} on ${v.data_ida} through ${v.data_volta}`
    : `One way flights from ${v.origem} to ${v.destino} on ${v.data_ida}`;
  return `https://www.google.com/travel/flights?hl=pt-BR&curr=BRL&q=${encodeURIComponent(q)}`;
}

/* ------------------------------------------------------- leitura do preço */

/**
 * Abaixo disto não é tarifa: é taxa de bagagem, desconto anunciado, valor de
 * assento. O trecho mais barato de uma promoção doméstica real raramente passa
 * por baixo de R$ 80, e o alerta do Google anuncia a viagem, não a taxa.
 */
export const PRECO_MIN_PLAUSIVEL = 80;
/** Acima disto é erro de leitura (número de telefone, código, ano colado). */
export const PRECO_MAX_PLAUSIVEL = 100_000;

/**
 * Todo valor em reais que aparece no texto, na ordem em que aparece.
 *
 * Aceita "R$ 1.234", "R$ 1.234,56" e "R$989". NÃO aceita valor sem o "R$": num
 * e-mail cheio de datas, horários e números de voo, pegar dígito solto acharia
 * preço em tudo — e erraria sempre para o lado barato, que é o lado que dispara
 * aviso à toa e ensina a pessoa a ignorar o sino.
 */
export function precosNoTexto(texto: string): number[] {
  const out: number[] = [];
  const re = /R\$\s*([\d]{1,3}(?:\.[\d]{3})*|[\d]+)(?:,(\d{2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(texto ?? ""))) !== null) {
    const inteiro = m[1].replace(/\./g, "");
    const centavos = m[2] ?? "00";
    const v = Number(`${inteiro}.${centavos}`);
    if (Number.isFinite(v) && v >= PRECO_MIN_PLAUSIVEL && v <= PRECO_MAX_PLAUSIVEL) out.push(v);
  }
  return out;
}

/* ------------------------------------------------------------ o casamento */

const MESES_PT = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MESES_EN = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * As formas em que uma data pode estar escrita no e-mail, já normalizadas.
 *
 * O Google escreve a data de um jeito que depende do idioma da conta, do
 * formato curto ou longo e de haver ou não o ano. Em vez de tentar PARSEAR a
 * data do e-mail — que exigiria acertar todos os formatos —, geramos as formas
 * possíveis da data QUE JÁ CONHECEMOS e procuramos cada uma no texto. É a mesma
 * inversão que vale para as cidades: comparar contra o conhecido, não extrair
 * do desconhecido.
 */
export function formasDaData(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return [];
  const ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return [];
  const mp = MESES_PT[mes - 1], me = MESES_EN[mes - 1];
  const d = String(dia), dd = String(dia).padStart(2, "0");
  const mm = String(mes).padStart(2, "0");
  return [
    `${d} de ${mp}`, `${d} de ${mp.slice(0, 3)}`,   // 14 de novembro · 14 de nov
    `${d} ${mp}`, `${d} ${mp.slice(0, 3)}`,          // 14 novembro · 14 nov
    `${me} ${d}`, `${me.slice(0, 3)} ${d}`,          // november 14 · nov 14
    `${d} ${me}`, `${d} ${me.slice(0, 3)}`,          // 14 november · 14 nov
    `${dd} ${mm}`, `${dd} ${mm} ${ano}`,             // 14 11 · 14 11 2026 (após norm)
    `${ano} ${mm} ${dd}`,                            // 2026 11 14
  ].map(norm);
}

/**
 * De qual viagem aberta este e-mail fala, e por quanto.
 *
 * A PONTUAÇÃO É ASSIMÉTRICA de propósito. O destino vale mais que a origem
 * porque uma empresa sai quase sempre do mesmo lugar: num conjunto de oito
 * viagens saindo de VIX, casar pela origem não distingue nada, e um casamento
 * que não distingue é pior que nenhum — ele grava o preço de Recife na curva de
 * Salvador, e ninguém descobre olhando a tela.
 *
 * EMPATE NÃO CASA. Duas viagens para o mesmo destino em datas diferentes só se
 * separam pela data; se a data não apareceu no texto, as duas pontuam igual e a
 * resposta certa é `null` — o e-mail vai para a fila de atribuição humana, com
 * o motivo escrito. Chutar entre duas seria acertar metade das vezes e sujar a
 * curva na outra metade, sem deixar rastro de qual foi qual.
 */
export function casarEmail(
  assunto: string,
  corpo: string,
  viagens: ViagemParaCasar[],
): Casamento {
  const texto = norm(`${assunto ?? ""} ${corpo ?? ""}`);
  const precos = precosNoTexto(`${assunto ?? ""} ${corpo ?? ""}`);
  // O primeiro é a manchete: o alerta abre com o preço de que veio falar, e os
  // seguintes são as outras opções que ele lista embaixo.
  const preco = precos.length ? precos[0] : null;

  if (!viagens.length) {
    return { viagem_id: null, preco, confianca: null, motivo: "não há viagem em rastreamento para casar" };
  }

  const contem = (agulha: string) => !!agulha && texto.includes(agulha);
  const bate = (iata: string) => {
    const a = aeroporto(iata);
    const codigo = norm(iata);
    // IATA com fronteira: "rec" solto casaria dentro de "recife" e dentro de
    // "receber". A busca por palavra inteira é o que separa código de sílaba.
    const porCodigo = new RegExp(`(^| )${codigo}( |$)`).test(texto);
    return porCodigo || (a ? contem(norm(a.cidade)) : false);
  };

  const notas = viagens.map((v) => {
    let nota = 0;
    if (bate(v.destino)) nota += 3;
    if (bate(v.origem)) nota += 1;
    if (formasDaData(v.data_ida).some(contem)) nota += 3;
    if (v.data_volta && formasDaData(v.data_volta).some(contem)) nota += 1;
    return { v, nota };
  }).sort((a, b) => b.nota - a.nota);

  const melhor = notas[0];
  const segundo = notas[1];

  // Sem destino nem data não há do que se falar — casar por origem só diria
  // "saiu de Vitória", que é verdade para a lista inteira.
  if (melhor.nota < 3) {
    return { viagem_id: null, preco, confianca: null, motivo: "o e-mail não menciona destino nem data de nenhuma viagem aberta" };
  }
  if (segundo && segundo.nota === melhor.nota) {
    return {
      viagem_id: null, preco, confianca: null,
      motivo: `o e-mail combina igualmente com mais de uma viagem (${rotaTexto(melhor.v.origem, melhor.v.destino)} e ${rotaTexto(segundo.v.origem, segundo.v.destino)}) — falta a data no texto para desempatar`,
    };
  }
  if (preco == null) {
    return {
      viagem_id: melhor.v.id, preco: null, confianca: null,
      motivo: "casou com a viagem, mas não achei preço em reais no texto — o alerta pode ter vindo em outra moeda",
    };
  }

  // Destino + data é o par que identifica uma viagem sem ambiguidade.
  const confianca = melhor.nota >= 6 ? "alta" : "media";
  return {
    viagem_id: melhor.v.id, preco, confianca,
    motivo: confianca === "alta" ? "destino e data conferem" : "casou só pelo destino — sem a data no texto",
  };
}

/* ----------------------------------------------- o teto contra a âncora */

/** O que o Google diz do preço de hoje, na própria tela de busca. */
export type VereditoGoogle = "baixo" | "tipico" | "alto";

export const VEREDITO_GOOGLE_LABEL: Record<VereditoGoogle, string> = {
  baixo: "barato para esta rota",
  tipico: "no preço de sempre",
  alto: "caro para esta rota",
};

export interface LeituraDoTeto {
  /** Fração abaixo da âncora: 0.21 = o teto é 21% menor que o preço de hoje.
   *  Negativo quer dizer que o teto está ACIMA do preço de hoje. */
  folga: number | null;
  /** `true` quando o teto dispararia aviso já no primeiro preço. */
  dispara_agora: boolean;
  frase: string;
}

/**
 * O que o teto digitado SIGNIFICA — que é diferente de sugerir um teto.
 *
 * Com um preço só não há o que sugerir: um ponto não é curva, e um número
 * inventado a partir dele teria a mesma autoridade visual de um número medido.
 * O que dá para fazer com honestidade é traduzir: "R$ 3.000 é 21% abaixo dos
 * R$ 3.793 que o Google pede hoje". Aí quem decide decide sabendo.
 *
 * O CASO QUE MAIS IMPORTA É O TETO ACIMA DO PREÇO DE HOJE. Ele não é
 * "generoso": ele torna o aviso inútil, porque dispara no primeiro ponto e
 * confirma apenas que o preço de hoje é o preço de hoje. Quem cadastra não
 * percebe isso sozinho — o número parece razoável — e descobre semanas depois,
 * quando o sino tocou uma vez e nunca mais.
 */
export function lerTeto(
  teto: number,
  ancora: number | null | undefined,
  google?: VereditoGoogle | null,
): LeituraDoTeto {
  const contexto = google ? ` O Google classifica hoje como ${VEREDITO_GOOGLE_LABEL[google]}.` : "";

  if (!(teto > 0)) return { folga: null, dispara_agora: false, frase: "Defina o teto para o Hub saber quando avisar." };
  if (!(Number(ancora) > 0)) {
    return {
      folga: null, dispara_agora: false,
      frase: "Sem um preço de referência, o teto é um palpite: informe quanto o Google está pedindo agora." + contexto,
    };
  }

  const a = Number(ancora);
  const folga = (a - teto) / a;
  const pct = Math.round(Math.abs(folga) * 100);

  if (teto >= a) {
    return {
      folga, dispara_agora: true,
      frase: `Seu teto está ${pct === 0 ? "no mesmo valor do" : `${pct}% acima do`} preço de hoje — o aviso dispararia ` +
        "na primeira leitura e não diria nada. Para o sino significar algo, o teto precisa ficar abaixo do preço atual." + contexto,
    };
  }

  /* As faixas são grosseiras de propósito — são conselho, não veredito. O
     veredito de verdade vem depois, do `sugerirTeto` sobre a curva medida. */
  const conselho = folga < 0.05
    ? " É pouca margem: um teto colado no preço de hoje avisa por variação normal."
    : folga > 0.4
      ? " É bastante coisa: um teto tão abaixo pode nunca ser alcançado nesta janela."
      : "";

  return {
    folga, dispara_agora: false,
    frase: `Seu teto está ${pct}% abaixo do preço de hoje.${conselho}${contexto}`,
  };
}

/* ------------------------------------------- o relógio da antecedência */

export type Janela = "cedo" | "boa" | "encurtando" | "tarde" | "passou";

export interface LeituraDaJanela {
  janela: Janela;
  /** Curto, para o selo da linha. */
  selo: string;
  /** O que fazer, em uma frase. */
  texto: string;
}

/**
 * Em que ponto da janela de compra esta viagem está.
 *
 * O MÓDULO SÓ SABIA DAR BOA NOTÍCIA. Ele fala quando o preço entra no teto — e
 * fica mudo quando o preço nunca entra, que é o desfecho mais comum. A viagem
 * envelhece na lista, expira sozinha e alguém compra tarde, caro, sem que nada
 * tenha avisado. Ferramenta que só fala quando há boa notícia é ferramenta que
 * se aprende a ignorar.
 *
 * OS CORTES SÃO REGRA DE OPERAÇÃO, NÃO LEI DE MERCADO — e é bom que estejam
 * escritos num lugar só, para poderem ser discutidos. O ponto de partida é o que
 * o próprio Google Flights diz na tela de busca ("o período mais barato para
 * reservar costuma ser de 2 a 5 meses antes"), encostado na realidade de quem
 * compra: dentro de duas semanas, esperar deixou de ser estratégia e virou
 * torcida. Se a curva desta empresa contar outra história, mexa AQUI — e não em
 * cada tela que pergunta "já está na hora?".
 */
export const DIAS_JANELA_BOA = 90;
export const DIAS_ENCURTANDO = 30;
export const DIAS_TARDE = 14;

export function janelaDeCompra(dias: number): LeituraDaJanela {
  if (dias < 0) return { janela: "passou", selo: "já passou", texto: "A data de ida já passou." };
  if (dias <= DIAS_TARDE) {
    return {
      janela: "tarde", selo: `faltam ${dias}d`,
      texto: "Esperar deixou de ser estratégia: daqui para frente o preço tende a subir todo dia. Compre o melhor que houver.",
    };
  }
  if (dias <= DIAS_ENCURTANDO) {
    return {
      janela: "encurtando", selo: `faltam ${dias}d`,
      texto: "A janela está fechando. Se o preço não entrar no teto nos próximos dias, comprar um pouco acima dele pode sair mais barato que esperar.",
    };
  }
  if (dias <= DIAS_JANELA_BOA) {
    return { janela: "boa", selo: `faltam ${dias}d`, texto: "Está na janela em que costuma valer a pena comprar." };
  }
  return { janela: "cedo", selo: `faltam ${dias}d`, texto: "Ainda é cedo: dá para observar sem pressa." };
}

/* ------------------------------------------------- a fila de decisões */

export type TipoPendencia = "comprar" | "decidir" | "sem_preco" | "ligar_alerta" | "desligar_alerta";
export type Urgencia = "alta" | "media" | "baixa";

export interface Pendencia {
  tipo: TipoPendencia;
  urgencia: Urgencia;
  texto: string;
}

/** Quantos dias sem preço novo antes de desconfiar de que nada está chegando. */
export const DIAS_SEM_PRECO_SUSPEITO = 10;

/** O que o painel precisa saber de uma viagem para decidir o que ela pede. */
export interface ViagemParaFila {
  status: string;
  data_ida: string;
  teto: number;
  rastreando_em: string | null;
  ultimo_preco: number | null;
  ultimo_em: string | null;
  pontos: number;
}

/**
 * O que ESTA viagem pede de alguém hoje. Vazio = não pede nada.
 *
 * A TELA LISTAVA VIAGENS; QUEM COMPRA PRECISA DE UMA FILA. Com fluxo constante e
 * vários destinos, uma lista ordenada por data vira ruído em duas semanas — e o
 * que interessa nunca é "quais viagens existem", é "o que eu preciso resolver
 * agora". Só cinco coisas pedem ação, e três delas o módulo antes não dizia.
 *
 * ORDEM IMPORTA: a primeira pendência devolvida é a que manda na linha. Comprar
 * vem antes de decidir, e as duas vêm antes de tarefa administrativa — quem tem
 * uma passagem no teto não precisa ser lembrado de ligar alerta.
 */
export function pendenciasDaViagem(v: ViagemParaFila, hoje = new Date()): Pendencia[] {
  const fora: Pendencia[] = [];

  /* Viagem fechada só pode pedir uma coisa: desligar o rastreamento lá fora,
     que o Hub não alcança. */
  if (v.status !== "rastreando") {
    if (v.rastreando_em) {
      fora.push({
        tipo: "desligar_alerta", urgencia: "baixa",
        texto: "Viagem fechada, mas o alerta continua ligado no Google — os e-mails vão seguir chegando sem dono.",
      });
    }
    return fora;
  }

  const dias = diasAte(v.data_ida, hoje);
  const j = janelaDeCompra(dias);
  const noTeto = v.ultimo_preco != null && Number(v.ultimo_preco) <= Number(v.teto);

  if (noTeto) {
    fora.push({
      tipo: "comprar", urgencia: "alta",
      texto: `O último preço está dentro do teto. ${dias <= DIAS_ENCURTANDO ? "E o prazo está curto: comprar agora." : "Dá para comprar."}`,
    });
    return fora;
  }

  /* A METADE QUE FALTAVA. Preço fora do teto com o prazo acabando não gera
     alerta nenhum hoje — e é exatamente aí que se perde dinheiro, porque
     ninguém é avisado de que o tempo de esperar acabou. */
  if (j.janela === "tarde" || j.janela === "encurtando") {
    fora.push({
      tipo: "decidir", urgencia: j.janela === "tarde" ? "alta" : "media",
      texto: `${j.texto} O preço não entrou no teto${v.pontos ? "" : " e ainda não chegou preço nenhum"}.`,
    });
  }

  if (!v.rastreando_em) {
    fora.push({
      tipo: "ligar_alerta", urgencia: "media",
      texto: "O alerta nunca foi ligado no Google. Sem isso não chega e-mail e a curva não anda.",
    });
    return fora;
  }

  /* O ALERTA ESTÁ LIGADO E MESMO ASSIM NÃO CHEGA NADA. Ou o Google não escreveu
     ainda (normal nos primeiros dias), ou o casador não está reconhecendo os
     e-mails desta rota — e essa segunda hipótese é invisível sem esta linha:
     tudo responde 2xx, o painel fica verde, e a curva fica vazia para sempre. */
  const desde = v.ultimo_em ?? v.rastreando_em;
  const diasMudo = Math.floor((hoje.getTime() - new Date(desde).getTime()) / 86_400_000);
  if (diasMudo >= DIAS_SEM_PRECO_SUSPEITO) {
    fora.push({
      tipo: "sem_preco", urgencia: "media",
      texto: `${diasMudo} dias sem nenhum preço novo, com o alerta ligado. Confira se o Google está mandando e-mail desta rota.`,
    });
  }

  return fora;
}

/** A urgência mais alta de um conjunto — para ordenar a fila. */
export const PESO_URGENCIA: Record<Urgencia, number> = { alta: 3, media: 2, baixa: 1 };

/* ------------------------------------------------------------- a decisão */

/** Quanto falta (em dias) para a ida. Negativo = já passou. */
export function diasAte(iso: string, hoje = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return 0;
  const alvo = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const base = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  return Math.round((alvo - base) / 86_400_000);
}

/**
 * Este preço merece acordar alguém?
 *
 * SÓ NA DESCIDA QUE CRUZA O TETO, e essa é a regra inteira do módulo. O Google
 * avisa quando o preço MEXE; o Hub avisa quando o preço fica COMPRÁVEL — são
 * perguntas diferentes, e é a segunda que faz alguém abrir a tela. Com dezenas
 * de viagens rastreadas, repassar o "mexeu" do Google seria reproduzir a caixa
 * de entrada que este módulo existe para calar.
 *
 * `menorAntes` é o menor preço já visto NESTA viagem. Reavisar a cada novo
 * ponto abaixo do teto encheria o sino de "ainda está barato" — o segundo aviso
 * só sai quando o preço melhora de verdade sobre o melhor que já se viu.
 */
export function deveAvisar(
  preco: number,
  teto: number,
  menorAntes: number | null,
): { avisar: boolean; motivo: string } {
  if (!(preco > 0) || !(teto > 0)) return { avisar: false, motivo: "preço ou teto ausente" };
  if (preco > teto) return { avisar: false, motivo: "acima do teto" };
  if (menorAntes == null) return { avisar: true, motivo: "primeiro preço dentro do teto" };
  if (preco < menorAntes) return { avisar: true, motivo: "novo menor preço da viagem" };
  return { avisar: false, motivo: "dentro do teto, mas não é o menor já visto" };
}
