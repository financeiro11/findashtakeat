/**
 * A leitura da remuneração — degraus, resumo e recorte.
 *
 * Tudo aqui é função pura sobre o bloco que `remuneracao_painel()` devolve. Não
 * há Supabase, React nem formatação de moeda: é o que a tela pergunta ao dado,
 * escrito num lugar que dá para testar.
 */

export type MesRemuneracao = {
  /** Primeiro dia do mês trabalhado, ISO: "2026-03-01". */
  competencia: string;
  fixo: number;
  /**
   * Remuneração do SÓCIO, separada do fixo de propósito.
   *
   * Hoje só o Miguel recebe, e recebe as duas coisas: R$ 22.500 de salário como
   * CEO e R$ 4.361 de pró-labore no mesmo mês. Somar num balde só apagaria a
   * distinção — são naturezas diferentes e a ficha existe para mostrar as duas.
   */
  prolabore: number;
  premiacao: number;
  escala: number;
  outro: number;
  total: number;
  /** Quais fontes formaram o mês ("omie", "omie+conta_azul"…). */
  fontes: string | null;
  /**
   * A área que pagou o fixo do mês — o que vem depois do traço na categoria
   * ("3.1.1.2. Pessoal - Comercial" → "Comercial"). Nula em Pro Labore, que
   * não tem área.
   */
  area: string | null;
};

export type PessoaRemuneracao = {
  id: string;
  nome: string;
  codigo_rh: string | null;
  doc: string | null;
  eh_pessoa: boolean;
  cargo: string | null;
  /**
   * O time EFETIVO: `coalesce(rh_colaboradores.setor, remuneracao_pessoa.setor)`.
   *
   * O Portal RH manda; a classificação à mão preenche o buraco de quem ele não
   * conhece — 99 favorecidos com pagamento e sem ficha, quase todos gente que
   * saiu antes de abr/2026. É por este campo que o recorte do líder acontece,
   * então quem fica sem ele não entra em recorte nenhum.
   */
  setor: string | null;
  /** De onde veio o time: `"rh"`, `"manual"`, ou nulo quando ninguém o definiu. */
  setor_fonte: "rh" | "manual" | null;
  modalidade: string | null;
  /** Texto cru do espelho do RH — pode não ser data válida. */
  inicio: string | null;
  datadesl: string | null;
  valor_contrato: number | null;
  meses: MesRemuneracao[];
};

/**
 * O recorte que o SERVIDOR aplicou, dito por ele mesmo.
 *
 * A tela não deduz isto do que veio: "vieram 47 pessoas" não distingue um líder
 * de um mês vazio. `remuneracao_painel()` carimba o que fez, e o cabeçalho
 * repete em voz alta — quem olha um custo de R$ 1,1 M precisa saber que é o
 * custo de três times, não o da empresa.
 */
export type EscopoPainel = { tudo: boolean; setores?: string[] };

export type PainelRemuneracao = {
  meses: string[];
  pessoas: PessoaRemuneracao[];
  gerado_em: string;
  escopo?: EscopoPainel;
};

/** Um reajuste: o fixo mudou de um mês pago para o seguinte. */
export type Degrau = {
  competencia: string;
  de: number;
  para: number;
  /** Variação relativa (0.125 = +12,5%). */
  variacao: number;
};

/*
 * NÃO EXISTE COMPETÊNCIA PARCIAL NESTA SÉRIE — e já houve duas afirmações
 * contrárias, ambas erradas, ambas pelo mesmo motivo.
 *
 * A primeira dizia que dezembro/2025 era parcial: era eu comparando a minha
 * competência com uma DRE que, até ali, era por CAIXA. A segunda dizia que
 * dezembro/2023 era, porque faltariam o 13º e o adiantamento pagos dentro de
 * dezembro. Também não: a competência é `vencimento − 1 mês`, então um título
 * que vence em dezembro/2023 é competência NOVEMBRO/2023 — fora da série de
 * qualquer jeito. E dezembro/2023 tem os quatro blocos, 32 pessoas e
 * vencimentos de 05 a 16 de janeiro, exatamente como todo mês tem.
 *
 * A conferência que fecha o assunto: não há inchaço de 13º em novembro nenhum
 * da série (nov/24 com fixo médio de R$ 3.160, nov/25 com R$ 4.147, em linha
 * com os vizinhos). Décimo terceiro não passa por estas categorias.
 *
 * Se um dia entrar um export que comece no meio de um mês, o aviso volta — mas
 * com a prova junto, não com o raciocínio de que "a ponta deve estar faltando
 * alguma coisa".
 */

const num = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

/** "2026-03-01" → "mar/26". Fora do padrão, devolve o que veio. */
export function rotuloMes(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  // `||` e não `??`: competência vazia é string vazia, não nulo, e "" renderiza
  // uma célula em branco onde deveria estar o travessão.
  if (!m) return iso || "—";
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const mes = nomes[Number(m[2]) - 1];
  return mes ? `${mes}/${m[1].slice(2)}` : iso;
}

/** Quantos meses inteiros separam duas competências ISO. */
export function distanciaEmMeses(de: string, ate: string): number | null {
  const a = /^(\d{4})-(\d{2})/.exec(de ?? "");
  const b = /^(\d{4})-(\d{2})/.exec(ate ?? "");
  if (!a || !b) return null;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
}

/**
 * Variação mínima para uma mudança contar como reajuste.
 *
 * Meio por cento. O fixo do Miguel em junho/2026 é R$ 20.101 e não R$ 20.100
 * porque existe um título solto de R$ 1,00 no ERP — sem piso, isso viraria um
 * "reajuste de +0,0%" na linha do tempo dele. Relativo e não em reais para valer
 * igual num salário de R$ 2.500 e num de R$ 25.000; nenhum reajuste de verdade
 * é menor que isso.
 */
const REAJUSTE_MINIMO = 0.005;

/**
 * Um mês inflado entre dois normais — e o vizinho vazio.
 *
 * A competência da era Omie é o `dDtRegistro` do título, que é quando ALGUÉM
 * lançou a conta no ERP, não quando o mês foi trabalhado. Quando o lançamento
 * escorrega para o mês do vencimento, o salário de março cai em abril ao lado
 * do de abril: março fica sem fixo e abril com dois. Como `degrausDoFixo`
 * compara meses PAGOS consecutivos, o buraco desaparece e o que sobra é
 * "2.800 → 5.600 → 2.800" — um aumento de 100% seguido de um corte de 50%, e
 * nenhum dos dois aconteceu.
 *
 * Em 09/09/2026 eram oito pessoas assim (Diogo, Vitor Coelho, Ana Júlia,
 * Marcelo Amon, Luiz Paulo, Lhaisfar, Luis Guilherme e André Rocon), cada uma
 * com dois degraus falsos na ficha e o corte estampado na coluna "Último
 * reajuste" da lista.
 *
 * A régua exige as três coisas ao mesmo tempo — subiu muito, voltou muito, e
 * voltou para o MESMO patamar. Sem a terceira, um aumento de verdade dado logo
 * depois de um mês cheio seria engolido junto.
 */
const PICO_SUBIDA = 1.5;
const PICO_VOLTA = 0.75;
const PICO_MESMO_PATAMAR = 0.15;

function mesesDePico(valores: number[]): Set<number> {
  const pico = new Set<number>();
  for (let i = 1; i < valores.length - 1; i++) {
    const antes = valores[i - 1];
    const nele = valores[i];
    const depois = valores[i + 1];
    if (
      nele > antes * PICO_SUBIDA &&
      depois < nele * PICO_VOLTA &&
      Math.abs(depois - antes) < antes * PICO_MESMO_PATAMAR
    ) {
      pico.add(i);
    }
  }
  return pico;
}

/**
 * Os degraus do fixo ao longo dos meses pagos.
 *
 * Compara meses PAGOS consecutivos, não meses de calendário: quem ficou sem
 * receber em maio e voltou em junho tem um degrau maio→junho, não dois.
 *
 * São TRÊS as guardas, e cada uma nasceu de um falso reajuste na tela:
 *
 *   1. O primeiro e o último mês são ignorados como origem quando o valor é
 *      MENOR que o vizinho — mês de entrada e de saída são proporcionais aos
 *      dias trabalhados, e contá-los daria "aumento de 180%" no segundo mês de
 *      casa. Uma queda no MEIO da série continua aparecendo: essa é real.
 *   2. O último mês de quem JÁ SAIU é ignorado nos dois sentidos: o acerto de
 *      contas soma férias, 13º e o que sobrou do salário, e sai bem MAIOR. Para
 *      isso a função precisa de `referencia` — sem ela não dá para distinguir
 *      "o emprego acabou aqui" de "os dados acabam aqui".
 *   3. O pico de um mês só (`mesesDePico`) é ignorado na subida e na descida:
 *      são dois títulos que caíram na mesma competência porque o lançamento no
 *      ERP escorregou de mês.
 */
export function degrausDoFixo(
  meses: MesRemuneracao[],
  /**
   * O último mês FECHADO do painel (`ultimaCompetenciaFechada`). Serve para uma
   * coisa só: saber se o último mês DESTA pessoa é o fim do emprego dela ou só
   * a borda dos dados. Sem ele, o mês de rescisão vira reajuste.
   */
  referencia?: string | null,
): Degrau[] {
  // Ordena aqui em vez de confiar em quem chamou: a ficha passa `pessoa.meses`
  // cru, e a ordem da série é o que define o que é "primeiro" e "último" mês —
  // as três guardas abaixo dependem inteiramente dela.
  const pagos = meses
    .filter((m) => num(m.fixo) > 0)
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
  if (pagos.length < 2) return [];

  const pico = mesesDePico(pagos.map((m) => num(m.fixo)));

  // Saiu = parou de receber antes do último mês fechado. Nesse caso o mês final
  // não é um mês de trabalho: é rescisão, férias e 13º somados ao que sobrou do
  // salário. Com 21 meses de histórico isso deixou de ser exceção — 38 das 167
  // pessoas com fixo terminam a série num mês inflado, e sem esta guarda cada
  // uma delas ganharia um "reajuste de +100%" no mês em que foi embora.
  const saiu = !!referencia && pagos[pagos.length - 1].competencia < referencia;

  const out: Degrau[] = [];
  for (let i = 1; i < pagos.length; i++) {
    const de = num(pagos[i - 1].fixo);
    const para = num(pagos[i].fixo);
    if (de === para) continue;
    if (Math.abs(para - de) / de < REAJUSTE_MINIMO) continue;

    // Nem a subida para o pico nem a volta dele são reajuste — o mês só está
    // inflado porque recebeu o título que faltou no vizinho.
    if (pico.has(i) || pico.has(i - 1)) continue;

    // Primeiro mês menor que o seguinte: entrada proporcional, não é degrau.
    if (i === 1 && de < para * 0.95) continue;
    if (i === pagos.length - 1) {
      // Último mês menor que o anterior: saída proporcional, não é degrau.
      if (para < de * 0.95) continue;
      // Último mês de quem já saiu: o acerto de contas também não é degrau.
      if (saiu) continue;
    }

    out.push({ competencia: pagos[i].competencia, de, para, variacao: (para - de) / de });
  }
  return out;
}

/** Uma troca de time: a área que pagava mudou de um mês pago para o seguinte. */
export type MudancaDeArea = {
  competencia: string;
  de: string;
  para: string;
};

/**
 * A trajetória da pessoa pelos times, lida das categorias.
 *
 * É o único histórico de posição que existe: o Portal RH guarda o cargo de
 * HOJE, e nem o espelho nem o ERP têm série. A categoria do pagamento carrega a
 * área, e ela muda quando a pessoa muda de time.
 *
 * O QUE ISTO NÃO É: promoção. Subir de Analista Jr para Pleno dentro do mesmo
 * time não muda a categoria e não aparece aqui — só troca de time aparece. O
 * sinal de promoção que existe é o degrau no fixo (`degrausDoFixo`), e são
 * coisas diferentes: dá para trocar de área sem aumento e para ter aumento sem
 * trocar de área.
 *
 * Meses sem área (Pro Labore) são pulados em vez de virarem uma "saída": eles
 * não dizem que a pessoa deixou o time, dizem que aquele pagamento não tinha
 * área nenhuma.
 */
export function mudancasDeArea(meses: MesRemuneracao[]): MudancaDeArea[] {
  const comArea = meses
    .filter((m) => !!m.area)
    .sort((a, b) => a.competencia.localeCompare(b.competencia));

  const out: MudancaDeArea[] = [];
  for (let i = 1; i < comArea.length; i++) {
    const de = comArea[i - 1].area!;
    const para = comArea[i].area!;
    if (de !== para) out.push({ competencia: comArea[i].competencia, de, para });
  }
  return out;
}

/** A área do último mês pago — o time em que a pessoa está segundo o ERP. */
export function areaAtual(meses: MesRemuneracao[]): string | null {
  const comArea = meses
    .filter((m) => !!m.area)
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
  return comArea[comArea.length - 1]?.area ?? null;
}

export type ResumoPessoa = {
  /** O fixo do último mês em que a pessoa recebeu fixo. */
  fixoAtual: number | null;
  ultimoMes: string | null;
  /** Média da premiação nos meses em que houve premiação (0 se nunca houve). */
  premiacaoMedia: number;
  mesesComPremiacao: number;
  /** Soma de tudo, todos os meses conhecidos. */
  totalPeriodo: number;
  degraus: Degrau[];
  ultimoReajuste: Degrau | null;
  /** Trocas de time, na ordem em que aconteceram. */
  mudancas: MudancaDeArea[];
  /** A área do último mês pago — o time atual segundo o ERP. */
  area: string | null;
  /** Meses entre o último reajuste e o último mês pago. Null se nunca houve. */
  mesesSemReajuste: number | null;
  /**
   * Quanto o Portal RH está atrasado em relação ao que o Omie pagou.
   *
   * O OMIE É A VOZ DA VERDADE para salário: o que a pessoa ganha é o que saiu
   * do ERP, não o que está escrito na ficha do RH. `fixoAtual` já vem do Omie —
   * este campo existe só para acusar a ficha desatualizada, que é quase sempre
   * aditivo que ninguém lançou lá. Foi o caso do próprio diretor de receita:
   * contrato de R$ 20.000 no Portal RH, pagamento de R$ 22.500 desde julho/2026.
   *
   * Positivo = o RH está atrás do pagamento. Null quando não há ficha a comparar
   * — e a ausência de ficha nunca invalida o número do Omie.
   */
  divergenciaContrato: number | null;
  ativo: boolean;
};

/**
 * O último mês fechado do conjunto — a borda dos dados, não o fim de ninguém.
 *
 * Quem parou de receber ANTES disto saiu da empresa; quem recebeu até aqui
 * continua. É a única informação que falta para `degrausDoFixo` saber se o
 * último mês de uma pessoa é rescisão ou só o mês mais novo que existe.
 */
export function referenciaDoConjunto(pessoas: PessoaRemuneracao[]): string | null {
  const meses = [...new Set(pessoas.flatMap((p) => (p.meses ?? []).map((m) => m.competencia)))];
  return ultimaCompetenciaFechada(meses);
}

export function resumoDaPessoa(p: PessoaRemuneracao, referencia?: string | null): ResumoPessoa {
  const meses = [...(p.meses ?? [])].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const comFixo = meses.filter((m) => num(m.fixo) > 0);
  const ultimo = comFixo[comFixo.length - 1] ?? null;
  const comPremiacao = meses.filter((m) => num(m.premiacao) > 0);

  const degraus = degrausDoFixo(meses, referencia);
  const ultimoReajuste = degraus[degraus.length - 1] ?? null;

  const fixoAtual = ultimo ? num(ultimo.fixo) : null;
  const contrato = p.valor_contrato == null ? null : num(p.valor_contrato);

  return {
    fixoAtual,
    ultimoMes: ultimo?.competencia ?? null,
    premiacaoMedia: comPremiacao.length
      ? comPremiacao.reduce((s, m) => s + num(m.premiacao), 0) / comPremiacao.length
      : 0,
    mesesComPremiacao: comPremiacao.length,
    totalPeriodo: meses.reduce((s, m) => s + num(m.total), 0),
    degraus,
    ultimoReajuste,
    mudancas: mudancasDeArea(meses),
    area: areaAtual(meses),
    mesesSemReajuste:
      ultimoReajuste && ultimo
        ? distanciaEmMeses(ultimoReajuste.competencia, ultimo.competencia)
        : null,
    divergenciaContrato:
      contrato != null && contrato > 0 && fixoAtual != null ? fixoAtual - contrato : null,
    ativo: !p.datadesl,
  };
}

/**
 * O último mês FECHADO — a referência de "quem ainda está aqui".
 *
 * O mês corrente é sempre parcial: a folha é registrada no fim do mês, e no dia
 * 3 existem uns poucos títulos avulsos já lançados para ele. Usar o mês mais
 * recente como referência fazia a tela dizer que TODO MUNDO tinha saído — em
 * 03/09/2026 havia 1 lançamento em setembro contra 107 pessoas pagas em agosto,
 * e as 107 eram descartadas por "não receberam no último mês".
 *
 * Por isso a referência é o último mês anterior ao corrente. Determinístico, e
 * explicável para quem olhar a tela: o mês que já fechou.
 */
export function ultimaCompetenciaFechada(meses: string[], hoje = new Date()): string | null {
  const corrente = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const fechados = meses.filter((m) => m.slice(0, 7) < corrente).sort((a, b) => a.localeCompare(b));
  // Sem nenhum mês fechado (base recém-criada), o mais recente é o que há.
  return fechados[fechados.length - 1] ?? [...meses].sort((a, b) => a.localeCompare(b)).pop() ?? null;
}

/* ─────────────────────────── Comparação com os pares ─────────────────────────── */

/**
 * O fixo "cheio" da pessoa — o que ela ganha por mês inteiro trabalhado.
 *
 * NÃO é o fixo do último mês. Mês de entrada e mês de saída são proporcionais
 * aos dias, e usá-los na comparação com os pares afundaria a pessoa num
 * percentil que não é dela — o menor fixo do Comercial em ago/2026 é R$ 583, que
 * é meia semana de alguém, não um salário.
 *
 * O maior dos três últimos meses pagos resolve os dois lados: a entrada
 * proporcional fica para trás e a saída proporcional perde para o mês anterior.
 * Um reajuste recente continua ganhando, porque é o maior.
 */
export function fixoDeReferencia(meses: MesRemuneracao[]): number | null {
  const pagos = meses
    .filter((m) => num(m.fixo) > 0)
    .sort((a, b) => a.competencia.localeCompare(b.competencia))
    .slice(-3);
  if (!pagos.length) return null;
  return Math.max(...pagos.map((m) => num(m.fixo)));
}

/**
 * As competências cujo VARIÁVEL já foi lançado.
 *
 * A comissão de um mês entra no ERP depois do mês virar. Em 04/09/2026 a
 * competência de agosto tinha 4 títulos de variável contra 60 a 82 dos meses
 * anteriores — ela existe, mas está pela metade. Somar o total de alguém usando
 * agosto diria que a pessoa ganhou só o fixo, e comparar isso com quem tem cinco
 * meses cheios a colocaria no fundo do grupo por um motivo de calendário.
 *
 * O piso é relativo à própria empresa (um quarto da mediana dos meses
 * anteriores), e não um valor fixo: mês fraco de comissão continua entrando,
 * mês não lançado não.
 */
export function competenciasFechadas(
  pessoas: PessoaRemuneracao[],
  meses: string[],
): Set<string> {
  const ordenados = [...meses].sort((a, b) => a.localeCompare(b));
  const variavelDoMes = new Map<string, number>();
  for (const m of ordenados) variavelDoMes.set(m, 0);
  for (const p of pessoas) {
    if (!p.eh_pessoa) continue;
    for (const m of p.meses ?? []) {
      if (variavelDoMes.has(m.competencia)) {
        variavelDoMes.set(m.competencia, variavelDoMes.get(m.competencia)! + num(m.premiacao));
      }
    }
  }

  const fechadas = new Set<string>();
  const anteriores: number[] = [];
  for (const m of ordenados) {
    const v = variavelDoMes.get(m) ?? 0;
    // O primeiro mês não tem contra o que ser medido — entra.
    const piso = anteriores.length
      ? medianaDe([...anteriores].sort((a, b) => a - b)) * 0.25
      : 0;
    if (v >= piso) fechadas.add(m);
    anteriores.push(v);
  }
  return fechadas;
}

/**
 * A remuneração mensal típica da pessoa — fixo MAIS variável e escala.
 *
 * MEDIANA e não média: um mês proporcional de entrada ou de saída puxaria a
 * média para baixo, e a mediana o descarta sozinha.
 *
 * O total, e não o fixo, porque no comercial o fixo é quase o mesmo para todo
 * mundo (R$ 3.000 na maioria) e a diferença mora inteira na comissão — a Luiza
 * teve R$ 23.300 de variável em julho sobre os mesmos R$ 3.000 de fixo. Comparar
 * por fixo diria que o time inteiro está na mediana.
 */
export function remuneracaoMensalTipica(
  meses: MesRemuneracao[],
  fechadas: Set<string>,
): number | null {
  const totais = meses
    .filter((m) => fechadas.has(m.competencia) && num(m.total) > 0)
    .map((m) => num(m.total))
    .sort((a, b) => a - b);
  return totais.length ? medianaDe(totais) : null;
}

export type Pares = {
  /** O cargo que define o grupo. */
  cargo: string;
  quantos: number;
  /** Mediana do grupo na base comparada (remuneração mensal típica). */
  mediana: number;
  /** Onde a pessoa cai no grupo, de 0 a 100. */
  percentil: number;
  /** Diferença para a mediana, em reais. Negativo = ganha menos que a mediana. */
  contraMediana: number;
  /** O valor da própria pessoa na base comparada — o que a tela mostra. */
  valor: number;
  /** Quanto da remuneração dela é variável (0 a 1). Alto = o fixo engana. */
  parteVariavel: number;
};

const normCargo = (c: string | null | undefined) =>
  (c ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Quantos pares um cargo precisa ter para a mediana dizer alguma coisa. */
export const MINIMO_DE_PARES = 3;

/**
 * Onde cada pessoa está em relação a quem tem o MESMO CARGO.
 *
 * COMPARA A REMUNERAÇÃO INTEIRA, não o fixo. No comercial o fixo é quase o mesmo
 * para todo mundo — R$ 3.000 para a maioria dos vendedores — e a diferença mora
 * inteira na comissão: em julho/2026 a Luiza teve R$ 23.300 de variável e o
 * Thayrone R$ 4.900, sobre o mesmo fixo. Um comparador de fixo diria que os dois
 * estão na mediana, e estaria tecnicamente certo e completamente inútil.
 *
 * Por cargo e não por área: em agosto/2026 o Comercial tinha mediana de R$ 3.231
 * e máximo de R$ 27.800 — comparar um analista com um Head do mesmo time não
 * responde nada. O cargo vem do espelho do RH, único lugar onde ele existe.
 *
 * Grupos com menos de três pessoas não entram: mediana de dois é a média deles,
 * e "percentil 50 de um grupo de 2" é ruído com cara de dado. Quem não tem cargo
 * no RH também fica de fora — o mapa devolve só quem dá para comparar
 * honestamente.
 */
export function compararComPares(
  pessoas: PessoaRemuneracao[],
  meses: string[],
): Map<string, Pares> {
  const fechadas = competenciasFechadas(pessoas, meses);
  const grupos = new Map<string, {
    cargo: string;
    itens: { id: string; valor: number; parteVariavel: number }[];
  }>();

  for (const p of pessoas) {
    if (!p.eh_pessoa) continue;
    const chave = normCargo(p.cargo);
    if (!chave) continue;
    const valor = remuneracaoMensalTipica(p.meses ?? [], fechadas);
    if (valor == null || valor <= 0) continue;

    const cheios = (p.meses ?? []).filter((m) => fechadas.has(m.competencia));
    const total = cheios.reduce((s, m) => s + num(m.total), 0);
    const variavel = cheios.reduce((s, m) => s + num(m.premiacao) + num(m.escala), 0);

    const g = grupos.get(chave) ?? { cargo: p.cargo!.trim(), itens: [] };
    g.itens.push({ id: p.id, valor, parteVariavel: total > 0 ? variavel / total : 0 });
    grupos.set(chave, g);
  }

  const out = new Map<string, Pares>();
  for (const g of grupos.values()) {
    if (g.itens.length < MINIMO_DE_PARES) continue;
    const valores = g.itens.map((i) => i.valor).sort((a, b) => a - b);
    const mediana = medianaDe(valores);
    for (const item of g.itens) {
      // Percentil = quantos do grupo ganham MENOS, mais metade dos empatados.
      // Sem a metade dos empatados, três pessoas no mesmo salário cairiam no
      // percentil 0 — como se fossem as piores pagas do próprio grupo.
      const menores = valores.filter((v) => v < item.valor).length;
      const iguais = valores.filter((v) => v === item.valor).length;
      out.set(item.id, {
        cargo: g.cargo,
        quantos: g.itens.length,
        mediana,
        percentil: Math.round(((menores + iguais / 2) / valores.length) * 100),
        contraMediana: item.valor - mediana,
        valor: item.valor,
        parteVariavel: item.parteVariavel,
      });
    }
  }
  return out;
}

/** Mediana de uma lista JÁ ORDENADA. */
function medianaDe(ordenados: number[]): number {
  const n = ordenados.length;
  if (!n) return 0;
  const meio = Math.floor(n / 2);
  return n % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

/* ─────────────────────────── Custo por área ─────────────────────────── */

export type LinhaDeArea = {
  area: string;
  /** Um valor por mês, na ordem de `meses`. Zero onde ninguém daquela área foi pago. */
  serie: number[];
  total: number;
  /** Do primeiro mês com valor até o último. Null quando não dá para comparar. */
  variacao: number | null;
  /** Quanta gente a área tinha no mês de contagem (ver `noMes`). */
  pessoasNoMes: number;
};

/**
 * Quanto cada área custou, mês a mês.
 *
 * Usa a área do MÊS de cada lançamento, não a área atual da pessoa: quem trocou
 * de time em junho custou para o time antigo até maio, e atribuir o passado
 * inteiro ao time novo reescreveria a história dos dois.
 *
 * O DINHEIRO INCLUI QUEM NÃO É PESSOA; a CONTAGEM não. `eh_pessoa = false` diz
 * "não compare com gente" — vale para mediana, percentil e pares —, nunca "não
 * custou". Em 2024, 83 linhas trazem o time no lugar do nome ("rem comercial",
 * "escala suporte") e viraram balde de área justamente para entrar nesta conta:
 * pulá-las tirava R$ 17.365 de março/2024, 15% do mês. Uma empresa que caiu na
 * categoria de Pessoal também saiu do caixa e também tem área.
 *
 * @param noMes o mês em que a gente é contada, que NÃO precisa estar na série.
 *   O padrão — o último da série — costuma ser o mês corrente, que tem meia
 *   dúzia de avulsos lançados e nenhuma folha: por ele, toda área da tela dizia
 *   "0 pessoas". Quem chama passa o mês que está olhando.
 */
export function custoPorArea(
  pessoas: PessoaRemuneracao[],
  meses: string[],
  noMes?: string | null,
): LinhaDeArea[] {
  const indice = new Map(meses.map((m, i) => [m, i]));
  const areas = new Map<string, { serie: number[]; noMes: Set<string> }>();

  for (const p of pessoas) {
    for (const m of p.meses ?? []) {
      const i = indice.get(m.competencia);
      if (i == null) continue;
      const area = m.area ?? "Sem área";
      let a = areas.get(area);
      if (!a) {
        a = { serie: meses.map(() => 0), noMes: new Set<string>() };
        areas.set(area, a);
      }
      a.serie[i] += num(m.total);
    }
  }

  /* A contagem é de uma COMPETÊNCIA, não de uma posição na série — e quem
     chama tem motivo para contar num mês que ficou de fora dela: a série para
     no último mês FECHADO justamente para não terminar no despenhadeiro do mês
     corrente, e é o corrente que a tela conta quando alguém o põe em foco. Por
     índice, isso caía calado no mês anterior e a linha dizia "29 em set/26"
     mostrando o time de agosto.

     Passada separada porque, na primeira, o balde da área pode ainda não
     existir: quem o cria é um mês que está na série. */
  const mesDaContagem = noMes ?? meses[meses.length - 1] ?? null;
  if (mesDaContagem) {
    for (const p of pessoas) {
      // Aqui o `eh_pessoa` VALE, ao contrário da passada do dinheiro: "quantas
      // pessoas o Suporte tinha em julho" não pode contar o balde do time nem a
      // empresa que caiu na categoria como se fossem mais uma cabeça.
      if (!p.eh_pessoa) continue;
      for (const m of p.meses ?? []) {
        if (m.competencia !== mesDaContagem) continue;
        areas.get(m.area ?? "Sem área")?.noMes.add(p.id);
      }
    }
  }

  return [...areas.entries()]
    .map(([area, a]) => {
      const comValor = a.serie.map((v, i) => ({ v, i })).filter((x) => x.v > 0);
      const primeiro = comValor[0];
      const derradeiro = comValor[comValor.length - 1];
      return {
        area,
        serie: a.serie,
        total: a.serie.reduce((s, v) => s + v, 0),
        variacao:
          primeiro && derradeiro && primeiro.i !== derradeiro.i && primeiro.v > 0
            ? (derradeiro.v - primeiro.v) / primeiro.v
            : null,
        pessoasNoMes: a.noMes.size,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/* ─────────────────────────── Quem está sem time ───────────────────────────
   O recorte do líder casa por SETOR, que é o único vocabulário que separa
   Produto de Tecnologia — na categoria do Omie os dois recebem sob "Tecnologia".
   Só que o setor vem do Portal RH, e o Portal RH só conhece quem está lá hoje:
   99 favorecidos têm pagamento e não têm ficha, R$ 2,4 milhões de história, quase
   todos gente que saiu antes de abr/2026.

   Recortar só pelo que o RH conhece faria o 2025 de um líder aparecer 29% menor,
   em silêncio. A saída não é adivinhar pela área — "Comercial" é Field Sales,
   Inside Sales E Franquias, e o palpite mostraria o time de um líder para outro.
   É classificar à mão, uma vez, e guardar.

   O que esta parte faz é preparar essa mesa: quem falta, quanto pesa, e o que a
   categoria do Omie sugere quando ela é inequívoca. */

export type PessoaSemTime = {
  id: string;
  nome: string;
  ehPessoa: boolean;
  /** Primeiro e último mês pagos — dá para reconhecer alguém pela época. */
  de: string | null;
  ate: string | null;
  /** Quanto essa ficha custou no total. É por aqui que a lista se ordena. */
  total: number;
  /** A área que mais pagou essa pessoa, pela categoria do Omie. */
  areaPrincipal: string | null;
  /**
   * O setor sugerido: a área, quando existe um setor com esse nome exato.
   *
   * Sucesso, Onboarding, Suporte, Marketing e Tecnologia se chamam igual nos
   * dois vocabulários e a sugestão é segura. "Comercial" e "Novos Canais" não
   * são setores — ficam sem sugestão de propósito, porque escolher entre Field
   * Sales e Inside Sales é a informação que só uma pessoa tem, e um palpite aqui
   * entregaria o time de um líder para o outro.
   */
  sugestao: string | null;
};

/**
 * Quem tem pagamento e não tem time — a fila da classificação.
 *
 * @param setores os setores que existem, para saber quando a área serve de
 *   sugestão. Sem eles, ninguém recebe sugestão (e não o contrário: sugerir um
 *   setor que não existe faria a lista inteira parecer resolvida).
 */
export function pessoasSemTime(
  pessoas: PessoaRemuneracao[],
  setores: readonly string[],
): PessoaSemTime[] {
  const conhecidos = new Map(setores.map((s) => [normCargo(s), s]));

  return pessoas
    .filter((p) => !p.setor && (p.meses?.length ?? 0) > 0)
    .map((p) => {
      const meses = p.meses ?? [];
      // A área principal é a que somou MAIS DINHEIRO, não a mais frequente:
      // quem passou dez meses no Suporte e fechou o ano com uma premiação
      // grande do Comercial tem a decisão pendendo para onde o dinheiro foi.
      const porArea = new Map<string, number>();
      let total = 0;
      let de: string | null = null;
      let ate: string | null = null;
      for (const m of meses) {
        const v = num(m.total);
        total += v;
        if (m.area) porArea.set(m.area, (porArea.get(m.area) ?? 0) + v);
        if (de == null || m.competencia < de) de = m.competencia;
        if (ate == null || m.competencia > ate) ate = m.competencia;
      }
      const areaPrincipal =
        [...porArea.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        id: p.id,
        nome: p.nome,
        ehPessoa: p.eh_pessoa,
        de, ate, total,
        areaPrincipal,
        sugestao: areaPrincipal ? conhecidos.get(normCargo(areaPrincipal)) ?? null : null,
      };
    })
    // O que pesa primeiro: classificar em ordem de dinheiro é o que faz parar no
    // meio ainda deixar o recorte quase certo.
    .sort((a, b) => b.total - a.total);
}

/** Uma faixa aberta dos dois lados: `{min: 5000, max: null}` é "de 5.000 pra cima". */
export type Faixa = { min: number | null; max: number | null };

export const faixaVazia = (f?: Faixa) => !f || (f.min == null && f.max == null);

const naFaixa = (v: number | null, f?: Faixa) => {
  if (faixaVazia(f)) return true;
  // Sem valor não passa numa faixa: "quem ganha acima de 5.000" não inclui quem
  // não recebeu nada. Deixar passar encheria o filtro de linhas em branco.
  if (v == null) return false;
  if (f!.min != null && v < f!.min) return false;
  if (f!.max != null && v > f!.max) return false;
  return true;
};

/** As colunas numéricas que aceitam faixa. */
export type ColunaFaixa =
  | "tempoDeCasa" | "fixo" | "variavel" | "contraPares" | "semReajuste" | "totalPeriodo";

export type Filtros = {
  busca: string;
  /** Inclui quem já saiu (tem data de desligamento ou parou de receber). */
  incluirSaidas: boolean;
  /** Inclui favorecidos que não são pessoas (empresa que caiu na categoria). */
  incluirNaoPessoas: boolean;
  /** Só quem tem ficha no Portal RH. */
  soComFichaRh: boolean;
  /** Vazio = todos. Vários de uma vez: "Suporte E Onboarding" é uma pergunta real. */
  setores: string[];
  cargos: string[];
  faixas: Partial<Record<ColunaFaixa, Faixa>>;
};

export const FILTROS_VAZIOS: Filtros = {
  busca: "", incluirSaidas: false, incluirNaoPessoas: false, soComFichaRh: false,
  setores: [], cargos: [], faixas: {},
};

/** Quantos filtros estão ligados — o número que a tela mostra no botão de limpar. */
export function filtrosLigados(f: Filtros): number {
  return (f.busca.trim() ? 1 : 0)
    + (f.incluirSaidas ? 1 : 0) + (f.incluirNaoPessoas ? 1 : 0) + (f.soComFichaRh ? 1 : 0)
    + (f.setores.length ? 1 : 0) + (f.cargos.length ? 1 : 0)
    + Object.values(f.faixas).filter((x) => !faixaVazia(x)).length;
}

/** Texto que a busca varre por pessoa — nome, cargo, setor e código do RH. */
const alvoDaBusca = (p: PessoaRemuneracao) =>
  [p.nome, p.cargo, p.setor, p.codigo_rh].filter(Boolean).join(" ").toLowerCase();

/**
 * As pessoas como estavam ATÉ o mês em foco — a série de cada uma cortada ali.
 *
 * O seletor de mês do painel mexia só nos KPIs: a lista continuava sendo a de
 * hoje, com o fixo de hoje, mesmo com dezembro/2025 escolhido. O Thayrone, que
 * entrou em abril/2026, aparecia em dezembro/2025 ganhando os R$ 27.500 de
 * agora. Um filtro que não filtra é pior do que filtro nenhum, porque o número
 * ao lado dele parece ser do mês pedido.
 *
 * Cortar a série resolve tudo de uma vez e num lugar só: resumo, degraus,
 * comparação com os pares, tempo sem reajuste e minigráfico passam a enxergar
 * apenas o que já tinha acontecido, sem que nenhum deles precise saber que
 * existe um mês em foco.
 *
 * Devolve pessoas NOVAS e deixa o painel original intacto — a ficha e a
 * exportação mostram a trajetória inteira de propósito.
 */
export function recortarAte(
  pessoas: PessoaRemuneracao[],
  ate: string | null,
): PessoaRemuneracao[] {
  if (!ate) return pessoas;
  return pessoas.map((p) => {
    const meses = (p.meses ?? []).filter((m) => m.competencia <= ate);
    // Nada a cortar devolve a MESMA pessoa: quem consome compara por
    // identidade, e clonar 150 objetos a cada render remontaria a tabela
    // inteira a cada tecla digitada na busca.
    return meses.length === (p.meses?.length ?? 0) ? p : { ...p, meses };
  });
}

/** A competência mais recente da série, sem depender da ordem em que ela veio. */
const ultimaCompetenciaDe = (meses: MesRemuneracao[] | undefined) =>
  (meses ?? []).reduce<string | null>(
    (max, m) => (max == null || m.competencia > max ? m.competencia : max),
    null,
  );

/**
 * @param referencia o mês em foco — por padrão o último FECHADO (ver
 *   `ultimaCompetenciaFechada`). NUNCA o mês mais recente da base: o corrente é
 *   parcial e derrubaria como "saída" todo mundo que só recebeu no mês anterior
 *   — ou seja, a empresa toda.
 * @param presente `false` quando se está olhando para um mês PASSADO. Muda uma
 *   coisa só: quem nunca recebeu nada deixa de aparecer. No presente ele é o
 *   contratado que começa semana que vem e já está no Portal RH; em dezembro/25
 *   ele é alguém que ainda não era da casa, e mostrá-lo é o que fazia a lista
 *   parecer a mesma em todos os meses.
 */
export function filtrarPessoas(
  pessoas: PessoaRemuneracao[],
  f: Filtros,
  referencia: string | null,
  presente = true,
): PessoaRemuneracao[] {
  const termo = f.busca.trim().toLowerCase();
  const setores = new Set(f.setores);
  // `normCargo` e não um trim/lowercase próprio: é a MESMA normalização que
  // agrupa os pares. Se as duas divergirem, filtrar por um cargo pode devolver
  // um conjunto diferente do grupo contra o qual a pessoa foi comparada.
  const cargos = new Set(f.cargos.map(normCargo));
  return pessoas.filter((p) => {
    if (!f.incluirNaoPessoas && !p.eh_pessoa) return false;
    if (f.soComFichaRh && !p.codigo_rh) return false;
    if (setores.size && !(p.setor && setores.has(p.setor))) return false;
    if (cargos.size && !cargos.has(normCargo(p.cargo))) return false;

    if (!f.incluirSaidas) {
      // O desligamento só vale A PARTIR do mês em que aconteceu: quem saiu em
      // julho/26 ESTAVA aqui em dezembro/25 e tem de aparecer quando se olha
      // dezembro. Comparar por mês e não por dia mantém o presente como era —
      // quem saiu dia 20 de agosto já não está na lista de agosto.
      if (p.datadesl && (!referencia || p.datadesl.slice(0, 7) <= referencia.slice(0, 7))) {
        return false;
      }

      const ultimo = ultimaCompetenciaDe(p.meses);
      if (ultimo) {
        // Sem data de desligamento e sem receber no mês em foco: saiu e o
        // Portal RH não registrou, ou nunca teve ficha lá — é o caso da maioria
        // de quem foi removido do espelho ao sair.
        if (referencia && ultimo < referencia) return false;
      } else if (!presente) {
        // Nenhum pagamento até o mês em foco: não era da casa. A exceção do
        // recém-contratado (abaixo) é do presente e só dele.
        return false;
      }
      // Quem ainda não tem lançamento NENHUM passa no presente: é o contratado
      // que começa semana que vem e já está no Portal RH, e ele deve aparecer.
    }

    if (termo && !alvoDaBusca(p).includes(termo)) return false;
    return true;
  });
}

/* ─────────────────────────── A linha da tabela ───────────────────────────
   Pessoa mais tudo o que a tela calcula sobre ela. Existe porque filtro de
   faixa e ordenação trabalham sobre o CALCULADO (fixo de hoje, posição contra
   os pares, meses sem reajuste) e não sobre o que veio do banco — recalcular
   isso dentro de cada comparação de ordenação seria refazer o resumo de 150
   pessoas a cada clique de cabeçalho. */

export type LinhaPessoa = {
  pessoa: PessoaRemuneracao;
  resumo: ResumoPessoa;
  par?: Pares;
  /** Meses desde a admissão, do espelho do RH. Null quando a data não parseia. */
  tempoDeCasa: number | null;
};

export function montarLinhas(
  pessoas: PessoaRemuneracao[],
  pares: Map<string, Pares>,
  /**
   * A data do MÊS EM FOCO, não necessariamente hoje. Olhando dezembro/25, o
   * tempo de casa é o de dezembro — dizer "5 meses" para quem entraria só em
   * abril é a mesma mentira que mostrar o salário de hoje na folha de lá.
   */
  hoje = new Date(),
): LinhaPessoa[] {
  const mesHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
  const referencia = referenciaDoConjunto(pessoas);
  return pessoas.map((pessoa) => {
    const tempo = pessoa.inicio
      ? distanciaEmMeses(`${pessoa.inicio.slice(0, 7)}-01`, mesHoje)
      : null;
    return {
      pessoa,
      resumo: resumoDaPessoa(pessoa, referencia),
      par: pares.get(pessoa.id),
      // Negativo é quem ainda não tinha entrado no mês em foco. "−4 meses de
      // casa" não é tempo de casa nenhum, e ordenar por isso poria quem ainda
      // nem chegou na frente de quem está há seis anos.
      tempoDeCasa: tempo == null || tempo < 0 ? null : tempo,
    };
  });
}

/** O valor de uma linha na coluna pedida — o que a faixa mede e a ordem compara. */
export function valorDaColuna(l: LinhaPessoa, coluna: ColunaFaixa): number | null {
  switch (coluna) {
    case "tempoDeCasa":  return l.tempoDeCasa;
    case "fixo":         return l.resumo.fixoAtual;
    case "variavel":     return l.resumo.mesesComPremiacao ? l.resumo.premiacaoMedia : null;
    case "contraPares":  return l.par?.contraMediana ?? null;
    case "semReajuste":  return l.resumo.mesesSemReajuste;
    case "totalPeriodo": return l.resumo.totalPeriodo || null;
  }
}

export function filtrarPorFaixa(
  linhas: LinhaPessoa[],
  faixas: Filtros["faixas"],
): LinhaPessoa[] {
  const ativas = (Object.entries(faixas) as [ColunaFaixa, Faixa][])
    .filter(([, f]) => !faixaVazia(f));
  if (!ativas.length) return linhas;
  return linhas.filter((l) => ativas.every(([c, f]) => naFaixa(valorDaColuna(l, c), f)));
}

export type ColunaOrdenavel = ColunaFaixa | "nome" | "ultimoReajuste";
export type Ordem = { coluna: ColunaOrdenavel; desc: boolean };

/**
 * Ordena as linhas.
 *
 * Quem não tem valor na coluna vai SEMPRE para o fim, subindo ou descendo. Numa
 * ordenação decrescente por "fixo hoje", jogar os nulos no topo poria quem não
 * recebeu nada acima de quem mais ganha, que é o oposto do que se pediu.
 */
export function ordenarLinhas(linhas: LinhaPessoa[], ordem: Ordem): LinhaPessoa[] {
  const sinal = ordem.desc ? -1 : 1;
  return [...linhas].sort((a, b) => {
    if (ordem.coluna === "nome") {
      return sinal * a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR");
    }
    if (ordem.coluna === "ultimoReajuste") {
      // Pelo VALOR do reajuste em reais, que é o que a coluna mostra em destaque.
      const va = a.resumo.ultimoReajuste
        ? a.resumo.ultimoReajuste.para - a.resumo.ultimoReajuste.de : null;
      const vb = b.resumo.ultimoReajuste
        ? b.resumo.ultimoReajuste.para - b.resumo.ultimoReajuste.de : null;
      return comparar(va, vb, sinal);
    }
    return comparar(valorDaColuna(a, ordem.coluna), valorDaColuna(b, ordem.coluna), sinal);
  });
}

function comparar(a: number | null, b: number | null, sinal: number): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;   // nulo por último, sempre
  if (b == null) return -1;
  return sinal * (a - b);
}

/** Soma de um mês entre as pessoas dadas. */
export function totaisDoMes(pessoas: PessoaRemuneracao[], competencia: string) {
  let fixo = 0, prolabore = 0, premiacao = 0, escala = 0, outro = 0, gente = 0;
  for (const p of pessoas) {
    const m = p.meses?.find((x) => x.competencia === competencia);
    if (!m) continue;
    // O dinheiro de todo mundo; a cabeça só de quem é gente. Mesma divisão de
    // `custoPorArea`: o balde de área custou, mas não é mais uma pessoa no mês.
    if (p.eh_pessoa) gente++;
    fixo += num(m.fixo);
    prolabore += num(m.prolabore);
    premiacao += num(m.premiacao);
    escala += num(m.escala);
    outro += num(m.outro);
  }
  return {
    fixo, prolabore, premiacao, escala, outro,
    total: fixo + prolabore + premiacao + escala + outro,
    gente,
  };
}

/**
 * Quanto a folha custou NO ANO, até o mês em foco.
 *
 * Acumulado do ano-calendário do próprio mês — olhando dez/25, o "no ano" é
 * jan–dez/25, não os últimos doze meses e não 2026. É a mesma disciplina do
 * resto da tela: o seletor de mês é um corte no tempo, e um número rotulado
 * "no ano" que somasse o futuro do mês escolhido seria a mentira que o
 * `recortarAte` existe para evitar.
 *
 * Inclui quem foi pago e depois saiu, pelo mesmo motivo de `totaisDoMes`: quem
 * custou no ano, custou.
 */
export function custoNoAno(
  pessoas: PessoaRemuneracao[],
  mes: string,
): { total: number; meses: number } {
  const ano = mes.slice(0, 4);
  let total = 0;
  const vistos = new Set<string>();
  for (const p of pessoas) {
    for (const m of p.meses ?? []) {
      if (m.competencia.slice(0, 4) !== ano || m.competencia > mes) continue;
      total += num(m.total);
      vistos.add(m.competencia);
    }
  }
  return { total, meses: vistos.size };
}

/**
 * Quem está há mais tempo sem reajuste — o card que pede ação.
 *
 * Substituiu "Fichas do RH atrasadas" na visão de líder: aquela é pendência do
 * RH, e um Head não tem como resolvê-la. Esta ele resolve.
 *
 * Só entra quem TEM histórico de reajuste (`mesesSemReajuste` não nulo): quem
 * nunca teve um não está "há muito tempo sem", está no primeiro salário — e
 * misturar os dois faria o recém-contratado liderar o ranking do próprio mês
 * de entrada.
 */
export type SemReajuste = {
  /** Meses desde o último reajuste de quem está há mais tempo sem. */
  meses: number;
  nome: string;
  cargo: string | null;
  /** Quantos passaram do limiar — o número que transforma um caso em padrão. */
  acimaDoLimiar: number;
  limiar: number;
};

/** A partir de quantos meses sem reajuste a coisa vira assunto. */
export const LIMIAR_SEM_REAJUSTE = 12;

export function semReajusteHaMaisTempo(
  linhas: LinhaPessoa[],
  limiar = LIMIAR_SEM_REAJUSTE,
): SemReajuste | null {
  let pior: LinhaPessoa | null = null;
  let acima = 0;
  for (const l of linhas) {
    const m = l.resumo.mesesSemReajuste;
    if (m == null) continue;
    if (!l.pessoa.eh_pessoa) continue;  // balde de área não recebe reajuste
    if (m >= limiar) acima++;
    if (!pior || m > (pior.resumo.mesesSemReajuste ?? -1)) pior = l;
  }
  if (!pior || pior.resumo.mesesSemReajuste == null) return null;
  return {
    meses: pior.resumo.mesesSemReajuste,
    nome: pior.pessoa.nome,
    cargo: pior.pessoa.cargo,
    acimaDoLimiar: acima,
    limiar,
  };
}

/**
 * A faixa de cada cargo — a régua do time, do menor ao maior fixo.
 *
 * Ficou no lugar da tabela "Por área", que num recorte de um time só dizia
 * "Tecnologia 6, Administrativo 0, Onboarding 0" e uma variação de +798% que só
 * significava que o time não existia em dez/23.
 *
 * O FIXO, não o total: comparar cargos pelo total misturaria a comissão de
 * quem vende com o salário de quem não tem variável, e o Product Designer
 * apareceria "abaixo" de um vendedor num mês bom. Para a comissão existe o card
 * de comissão sobre o total.
 */
export type PessoaNaFaixa = { id: string; nome: string; fixo: number; tempoDeCasa: number | null };

export type FaixaDeCargo = {
  cargo: string;
  min: number;
  max: number;
  mediana: number;
  pessoas: PessoaNaFaixa[];
  /** `true` quando há mais de uma pessoa e elas não ganham igual. */
  temDispersao: boolean;
};

export function faixaPorCargo(linhas: LinhaPessoa[], mes: string): FaixaDeCargo[] {
  const porCargo = new Map<string, { rotulo: string; gente: PessoaNaFaixa[] }>();

  for (const l of linhas) {
    if (!l.pessoa.eh_pessoa) continue;
    const rotulo = (l.pessoa.cargo ?? "").trim();
    if (!rotulo) continue;  // sem cargo não há régua a que pertencer
    const m = l.pessoa.meses?.find((x) => x.competencia === mes);
    // O fixo do MÊS EM FOCO, e não o `fixoAtual` do resumo: numa viagem no
    // tempo o resumo já vem recortado, mas quem não recebeu fixo no mês (só
    // comissão, ou entrou depois) não tem posição nesta régua.
    const fixo = num(m?.fixo) + num(m?.prolabore);
    if (fixo <= 0) continue;
    const balde = porCargo.get(normCargo(rotulo)) ?? { rotulo, gente: [] };
    balde.gente.push({ id: l.pessoa.id, nome: l.pessoa.nome, fixo, tempoDeCasa: l.tempoDeCasa });
    porCargo.set(normCargo(rotulo), balde);
  }

  return [...porCargo.values()]
    .map(({ rotulo, gente }) => {
      const ordenada = [...gente].sort((a, b) => a.fixo - b.fixo);
      const vals = ordenada.map((g) => g.fixo);
      const meio = Math.floor(vals.length / 2);
      return {
        cargo: rotulo,
        min: vals[0],
        max: vals[vals.length - 1],
        mediana: vals.length % 2 ? vals[meio] : (vals[meio - 1] + vals[meio]) / 2,
        pessoas: ordenada,
        temDispersao: vals.length > 1 && vals[0] !== vals[vals.length - 1],
      };
    })
    // Do cargo mais caro para o mais barato: é a leitura de "onde está o
    // dinheiro", e põe a diretoria no topo em vez de espalhá-la por ordem
    // alfabética.
    .sort((a, b) => b.max - a.max || a.cargo.localeCompare(b.cargo, "pt-BR"));
}

export type CelulaPlanilha = string | number | null;

/** Uma aba da planilha, já descrita: o que tem, o que é dinheiro, que largura. */
export type Aba = {
  nome: string;
  linhas: CelulaPlanilha[][];
  /** Índices das colunas que são valor em reais. */
  moeda: number[];
  /** Índices das colunas que são percentual (já em pontos, ex.: 12.5). */
  percentual: number[];
  larguras: number[];
};

/**
 * A planilha em três abas.
 *
 * A versão anterior era UMA aba com cinco colunas por mês — quarenta colunas de
 * mês para sete meses, quase todas vazias, porque pró-labore é de uma pessoa e
 * escala de dezesseis. Ninguém lê isso; ninguém pivota isso.
 *
 * Agora:
 *
 *   Resumo      uma linha por pessoa, as vinte colunas que respondem "quanto
 *               ela ganha, desde quando, e como está em relação aos pares".
 *               É a aba que se abre.
 *   Mês a mês   FORMATO LONGO — uma linha por pessoa E mês. É o formato que
 *               vira tabela dinâmica sem esforço; o largo obriga quem for
 *               analisar a desempilhar tudo primeiro.
 *   Por área    o custo de cada time por mês, para a conversa de orçamento.
 *
 * Número sai como NÚMERO. "R$ 1.234,56" como texto não vira número em lugar
 * nenhum, e a coluna alinhada à esquerda é o sintoma que aparece só depois que
 * alguém já montou a tabela dinâmica em cima.
 *
 * Célula vazia é `null` e não zero: quem não recebeu naquele mês não ganhou
 * zero — não estava lá. A diferença some numa média.
 */
export function abasDaPlanilha(
  pessoas: PessoaRemuneracao[],
  meses: string[],
  pares: Map<string, Pares>,
  /**
   * O último mês fechado DO PAINEL, não o do recorte exportado.
   *
   * Deduzi-lo de `pessoas` fazia a planilha discordar da tela: exportando uma
   * pessoa só que saiu em julho/25, a referência virava julho/25, `saiu` dava
   * `false` e o acerto de contas dela reaparecia como "reajuste em jul/25" —
   * numa linha que a tela mostra como "nenhum". São 52 pessoas na base em
   * 09/09/2026, e o botão "Exportar histórico" da ficha manda exatamente uma
   * por vez.
   *
   * O mesmo vale para `fechadas`: a coluna "Mês fechado" mede se o VARIÁVEL DA
   * EMPRESA já foi lançado naquele mês, e medi-lo na comissão de uma pessoa só
   * responde outra pergunta.
   */
  referenciaDoPainel?: string | null,
  fechadasDoPainel?: Set<string>,
): Aba[] {
  const fechadas = fechadasDoPainel ?? competenciasFechadas(pessoas, meses);

  /* ── Resumo ── */
  /* A divisão por tipo somada no PERÍODO fica ao lado do total, não só no mês a
     mês: quem abre o Resumo quer saber de quanto do que a pessoa recebeu é
     salário e quanto é comissão sem ter de pivotar a outra aba. */
  const cabResumo = [
    "Nome", "Cargo", "Setor (RH)", "Área (ERP)", "Modalidade",
    "Início", "Tempo de casa (meses)", "Desligamento", "Meses pagos",
    "Fixo hoje", "Pró-labore/mês", "Variável médio",
    "Fixo no período", "Pró-labore no período", "Variável no período",
    "Escala no período", "Total no período", "% variável",
    "Último reajuste", "Reajuste R$", "Reajuste %", "Meses sem reajuste",
    "Trocas de time",
    "Mediana do cargo", "Contra a mediana", "Percentil", "Pares no cargo",
    "Contrato no RH", "Código RH", "CNPJ/CPF",
  ];

  const hoje = new Date();
  const mesHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

  const referencia = referenciaDoPainel ?? referenciaDoConjunto(pessoas);
  const linhasResumo = pessoas.map((p): CelulaPlanilha[] => {
    const r = resumoDaPessoa(p, referencia);
    const par = pares.get(p.id);
    const meses_ = p.meses ?? [];
    const ultimoMes = [...meses_].sort((a, b) => a.competencia.localeCompare(b.competencia)).pop();
    const soma = (f: (m: MesRemuneracao) => number) =>
      meses_.reduce((s, m) => s + num(f(m)), 0);
    const totalFixo = soma((m) => m.fixo);
    const totalPro = soma((m) => m.prolabore);
    const totalVar = soma((m) => m.premiacao);
    const totalEsc = soma((m) => m.escala);
    const total = r.totalPeriodo;
    return [
      p.nome,
      p.cargo ?? null,
      p.setor ?? null,
      r.area,
      p.modalidade ?? null,
      p.inicio ?? null,
      p.inicio ? distanciaEmMeses(`${p.inicio.slice(0, 7)}-01`, mesHoje) : null,
      p.datadesl ?? null,
      meses_.length || null,
      r.fixoAtual,
      num(ultimoMes?.prolabore) || null,
      r.mesesComPremiacao ? Math.round(r.premiacaoMedia * 100) / 100 : null,
      totalFixo || null,
      totalPro || null,
      totalVar || null,
      totalEsc || null,
      total || null,
      total > 0 ? Number((((totalVar + totalEsc) / total) * 100).toFixed(1)) : null,
      r.ultimoReajuste ? rotuloMes(r.ultimoReajuste.competencia) : null,
      r.ultimoReajuste ? Number((r.ultimoReajuste.para - r.ultimoReajuste.de).toFixed(2)) : null,
      r.ultimoReajuste ? Number((r.ultimoReajuste.variacao * 100).toFixed(1)) : null,
      r.mesesSemReajuste,
      r.mudancas.length
        ? [r.mudancas[0].de, ...r.mudancas.map((m) => m.para)].join(" → ")
        : null,
      par?.mediana ?? null,
      par?.contraMediana ?? null,
      par?.percentil ?? null,
      par?.quantos ?? null,
      p.valor_contrato == null ? null : num(p.valor_contrato),
      p.codigo_rh ?? null,
      p.doc ?? null,
    ];
  });

  /* ── Mês a mês, em formato longo ──
     Uma linha por pessoa e mês. `Mês fechado` diz se o variável daquele mês já
     foi lançado — sem essa coluna, quem somar o mês corrente vai concluir que a
     comissão caiu, quando ela só não entrou ainda. */
  const cabMes = [
    "Nome", "Cargo", "Competência", "Mês", "Área",
    "Fixo", "Pró-labore", "Variável", "Escala", "Total", "Mês fechado",
  ];

  const linhasMes: CelulaPlanilha[][] = [];
  for (const p of pessoas) {
    for (const m of [...(p.meses ?? [])].sort((a, b) => a.competencia.localeCompare(b.competencia))) {
      linhasMes.push([
        p.nome,
        p.cargo ?? null,
        m.competencia,
        rotuloMes(m.competencia),
        m.area ?? null,
        num(m.fixo) || null,
        num(m.prolabore) || null,
        num(m.premiacao) || null,
        num(m.escala) || null,
        num(m.total) || null,
        fechadas.has(m.competencia) ? "sim" : "não",
      ]);
    }
  }

  /* ── Por área ──
     A gente é contada no último mês FECHADO, não no último da série: o corrente
     tem meia dúzia de avulsos e nenhuma folha, e por ele a coluna sairia zerada
     em toda linha. O cabeçalho diz de que mês é a contagem. */
  const ultimaFechada = [...fechadas].sort((a, b) => a.localeCompare(b)).pop()
    ?? meses[meses.length - 1] ?? null;
  const areas = custoPorArea(pessoas, meses, ultimaFechada);
  const cabArea = [
    "Área", ...meses.map(rotuloMes), "Total", "Variação %",
    `Pessoas em ${rotuloMes(ultimaFechada ?? "")}`,
  ];
  const linhasArea = areas.map((a): CelulaPlanilha[] => [
    a.area,
    ...a.serie.map((v) => v || null),
    a.total || null,
    a.variacao == null ? null : Number((a.variacao * 100).toFixed(1)),
    a.pessoasNoMes || null,
  ]);

  return [
    {
      nome: "Resumo",
      // Índices conferidos contra `cabResumo` pelo teste "as colunas marcadas
      // como moeda são mesmo de dinheiro" — se a ordem mudar, ele acusa.
      linhas: [cabResumo, ...linhasResumo],
      moeda: [9, 10, 11, 12, 13, 14, 15, 16, 19, 23, 24, 27],
      percentual: [17, 20],
      larguras: [30, 24, 18, 15, 11, 11, 12, 12, 11,
                 12, 13, 13, 14, 16, 15, 14, 15, 10,
                 13, 12, 10, 12, 30, 15, 15, 10, 12, 14, 12, 18],
    },
    {
      nome: "Mês a mês",
      linhas: [cabMes, ...linhasMes],
      moeda: [5, 6, 7, 8, 9],
      percentual: [],
      larguras: [30, 24, 13, 9, 15, 12, 12, 12, 11, 12, 11],
    },
    {
      nome: "Por área",
      linhas: [cabArea, ...linhasArea],
      moeda: meses.map((_, i) => i + 1).concat([meses.length + 1]),
      percentual: [meses.length + 2],
      larguras: [18, ...meses.map(() => 12), 14, 11, 18],
    },
  ];
}

/** Mantida para o CSV: a mesma aba Resumo, sem formatação. */
export function matrizParaPlanilha(
  pessoas: PessoaRemuneracao[],
  meses: string[],
  /** O último mês fechado do painel — ver `abasDaPlanilha`. */
  referenciaDoPainel?: string | null,
): CelulaPlanilha[][] {
  const cabecalho = [
    "Nome", "Código RH", "Cargo", "Setor", "Área no ERP", "Trocas de time",
    "Modalidade", "Início", "Desligamento",
    "Valor de contrato", "Fixo atual",
    "Último reajuste", "Reajuste R$", "Reajuste %", "Meses sem reajuste",
    ...meses.flatMap((m) => [
      `${rotuloMes(m)} fixo`, `${rotuloMes(m)} pró-labore`, `${rotuloMes(m)} variável`,
      `${rotuloMes(m)} escala`, `${rotuloMes(m)} total`, `${rotuloMes(m)} área`,
    ]),
  ];

  const referencia = referenciaDoPainel ?? referenciaDoConjunto(pessoas);
  const linhas = pessoas.map((p): CelulaPlanilha[] => {
    const r = resumoDaPessoa(p, referencia);
    const porMes = new Map((p.meses ?? []).map((m) => [m.competencia, m]));
    return [
      p.nome,
      p.codigo_rh ?? null,
      p.cargo ?? null,
      p.setor ?? null,
      r.area,
      // A trajetória inteira numa célula: "Suporte → Onboarding → Suporte".
      r.mudancas.length
        ? [r.mudancas[0].de, ...r.mudancas.map((m) => m.para)].join(" → ")
        : null,
      p.modalidade ?? null,
      p.inicio ?? null,
      p.datadesl ?? null,
      p.valor_contrato == null ? null : num(p.valor_contrato),
      r.fixoAtual,
      r.ultimoReajuste ? rotuloMes(r.ultimoReajuste.competencia) : null,
      r.ultimoReajuste ? Number((r.ultimoReajuste.para - r.ultimoReajuste.de).toFixed(2)) : null,
      r.ultimoReajuste ? Number((r.ultimoReajuste.variacao * 100).toFixed(1)) : null,
      r.mesesSemReajuste,
      ...meses.flatMap((m): CelulaPlanilha[] => {
        const x = porMes.get(m);
        if (!x) return [null, null, null, null, null, null];
        return [
          num(x.fixo) || null, num(x.prolabore) || null, num(x.premiacao) || null,
          num(x.escala) || null, num(x.total) || null, x.area ?? null,
        ];
      }),
    ];
  });

  return [cabecalho, ...linhas];
}

/**
 * A mesma matriz em CSV, para quem prefere texto ao .xlsx.
 *
 * Ponto decimal, não vírgula: o Excel em pt-BR entende a vírgula, mas qualquer
 * outra coisa que leia o arquivo não.
 */
export function paraCsv(
  pessoas: PessoaRemuneracao[],
  meses: string[],
  referenciaDoPainel?: string | null,
): string {
  const sep = ";";
  const cel = (v: CelulaPlanilha) => {
    if (v == null) return "";
    if (typeof v === "number") return v.toFixed(2);
    return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  // BOM na frente: sem ele o Excel abre o CSV em ANSI e "Remuneração" vira
  // "RemuneraÃ§Ã£o" na primeira coluna que alguém for ler.
  return "﻿" + matrizParaPlanilha(pessoas, meses, referenciaDoPainel)
    .map((l) => l.map(cel).join(sep)).join("\n");
}
