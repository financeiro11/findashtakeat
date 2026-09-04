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
  setor: string | null;
  modalidade: string | null;
  /** Texto cru do espelho do RH — pode não ser data válida. */
  inicio: string | null;
  datadesl: string | null;
  valor_contrato: number | null;
  meses: MesRemuneracao[];
};

export type PainelRemuneracao = {
  meses: string[];
  pessoas: PessoaRemuneracao[];
  gerado_em: string;
};

/** Um reajuste: o fixo mudou de um mês pago para o seguinte. */
export type Degrau = {
  competencia: string;
  de: number;
  para: number;
  /** Variação relativa (0.125 = +12,5%). */
  variacao: number;
};

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
 * Os degraus do fixo ao longo dos meses pagos.
 *
 * Compara meses PAGOS consecutivos, não meses de calendário: quem ficou sem
 * receber em maio e voltou em junho tem um degrau maio→junho, não dois.
 *
 * O primeiro e o último mês da série são ignorados como origem de degrau
 * quando o valor é MENOR que o vizinho: mês de entrada e mês de saída são
 * proporcionais aos dias trabalhados, e contá-los produziria um "aumento de
 * 180%" no segundo mês de casa que não é aumento nenhum. Um degrau de queda no
 * meio da série continua aparecendo — esse é real e alguém deve olhar.
 */
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

export function degrausDoFixo(meses: MesRemuneracao[]): Degrau[] {
  const pagos = meses.filter((m) => num(m.fixo) > 0);
  if (pagos.length < 2) return [];

  const out: Degrau[] = [];
  for (let i = 1; i < pagos.length; i++) {
    const de = num(pagos[i - 1].fixo);
    const para = num(pagos[i].fixo);
    if (de === para) continue;
    if (Math.abs(para - de) / de < REAJUSTE_MINIMO) continue;

    // Primeiro mês menor que o seguinte: entrada proporcional, não é degrau.
    if (i === 1 && de < para * 0.95) continue;
    // Último mês menor que o anterior: saída proporcional, não é degrau.
    if (i === pagos.length - 1 && para < de * 0.95) continue;

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

export function resumoDaPessoa(p: PessoaRemuneracao): ResumoPessoa {
  const meses = [...(p.meses ?? [])].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const comFixo = meses.filter((m) => num(m.fixo) > 0);
  const ultimo = comFixo[comFixo.length - 1] ?? null;
  const comPremiacao = meses.filter((m) => num(m.premiacao) > 0);

  const degraus = degrausDoFixo(meses);
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
  pessoasNoUltimoMes: number;
};

/**
 * Quanto cada área custou, mês a mês.
 *
 * Usa a área do MÊS de cada lançamento, não a área atual da pessoa: quem trocou
 * de time em junho custou para o time antigo até maio, e atribuir o passado
 * inteiro ao time novo reescreveria a história dos dois.
 */
export function custoPorArea(pessoas: PessoaRemuneracao[], meses: string[]): LinhaDeArea[] {
  const indice = new Map(meses.map((m, i) => [m, i]));
  const areas = new Map<string, { serie: number[]; pessoas: Set<string>[] }>();

  for (const p of pessoas) {
    if (!p.eh_pessoa) continue;
    for (const m of p.meses ?? []) {
      const i = indice.get(m.competencia);
      if (i == null) continue;
      const area = m.area ?? "Sem área";
      let a = areas.get(area);
      if (!a) {
        a = { serie: meses.map(() => 0), pessoas: meses.map(() => new Set<string>()) };
        areas.set(area, a);
      }
      a.serie[i] += num(m.total);
      a.pessoas[i].add(p.id);
    }
  }

  const ultimo = meses.length - 1;
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
        pessoasNoUltimoMes: ultimo >= 0 ? a.pessoas[ultimo].size : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export type Filtros = {
  busca: string;
  /** Inclui quem já saiu (tem data de desligamento ou parou de receber). */
  incluirSaidas: boolean;
  /** Inclui favorecidos que não são pessoas (empresa que caiu na categoria). */
  incluirNaoPessoas: boolean;
  /** Só quem tem ficha no Portal RH. */
  soComFichaRh: boolean;
  setor: string | null;
};

/** Texto que a busca varre por pessoa — nome, cargo, setor e código do RH. */
const alvoDaBusca = (p: PessoaRemuneracao) =>
  [p.nome, p.cargo, p.setor, p.codigo_rh].filter(Boolean).join(" ").toLowerCase();

/**
 * @param referencia o último mês FECHADO (ver `ultimaCompetenciaFechada`).
 *   NUNCA o mês mais recente da base: o corrente é parcial e derrubaria como
 *   "saída" todo mundo que só recebeu no mês anterior — ou seja, a empresa toda.
 */
export function filtrarPessoas(
  pessoas: PessoaRemuneracao[],
  f: Filtros,
  referencia: string | null,
): PessoaRemuneracao[] {
  const termo = f.busca.trim().toLowerCase();
  return pessoas.filter((p) => {
    if (!f.incluirNaoPessoas && !p.eh_pessoa) return false;
    if (f.soComFichaRh && !p.codigo_rh) return false;
    if (f.setor && p.setor !== f.setor) return false;

    if (!f.incluirSaidas) {
      if (p.datadesl) return false;
      // Sem data de desligamento e sem receber no último mês fechado: saiu e o
      // Portal RH não registrou, ou nunca teve ficha lá — é o caso da maioria
      // de quem foi removido do espelho ao sair.
      //
      // Quem ainda não tem lançamento NENHUM passa: é o contratado que começa
      // semana que vem e já está no Portal RH, e ele deve aparecer.
      const ultimo = p.meses?.length
        ? p.meses[p.meses.length - 1].competencia
        : null;
      if (referencia && ultimo && ultimo < referencia) return false;
    }

    if (termo && !alvoDaBusca(p).includes(termo)) return false;
    return true;
  });
}

/** Soma de um mês entre as pessoas dadas. */
export function totaisDoMes(pessoas: PessoaRemuneracao[], competencia: string) {
  let fixo = 0, prolabore = 0, premiacao = 0, escala = 0, outro = 0, gente = 0;
  for (const p of pessoas) {
    const m = p.meses?.find((x) => x.competencia === competencia);
    if (!m) continue;
    gente++;
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
): Aba[] {
  const fechadas = competenciasFechadas(pessoas, meses);

  /* ── Resumo ── */
  const cabResumo = [
    "Nome", "Cargo", "Setor (RH)", "Área (ERP)", "Modalidade",
    "Início", "Tempo de casa (meses)", "Desligamento",
    "Fixo hoje", "Pró-labore/mês", "Variável médio", "Total no período",
    "Último reajuste", "Reajuste R$", "Reajuste %", "Meses sem reajuste",
    "Trocas de time",
    "Mediana do cargo", "Contra a mediana", "Percentil", "Pares no cargo",
    "Contrato no RH", "Código RH", "CNPJ/CPF",
  ];

  const hoje = new Date();
  const mesHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

  const linhasResumo = pessoas.map((p): CelulaPlanilha[] => {
    const r = resumoDaPessoa(p);
    const par = pares.get(p.id);
    const ultimoMes = [...(p.meses ?? [])].sort((a, b) => a.competencia.localeCompare(b.competencia)).pop();
    return [
      p.nome,
      p.cargo ?? null,
      p.setor ?? null,
      r.area,
      p.modalidade ?? null,
      p.inicio ?? null,
      p.inicio ? distanciaEmMeses(`${p.inicio.slice(0, 7)}-01`, mesHoje) : null,
      p.datadesl ?? null,
      r.fixoAtual,
      num(ultimoMes?.prolabore) || null,
      r.mesesComPremiacao ? Math.round(r.premiacaoMedia * 100) / 100 : null,
      r.totalPeriodo || null,
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

  /* ── Por área ── */
  const areas = custoPorArea(pessoas, meses);
  const cabArea = ["Área", ...meses.map(rotuloMes), "Total", "Variação %", "Pessoas no último mês"];
  const linhasArea = areas.map((a): CelulaPlanilha[] => [
    a.area,
    ...a.serie.map((v) => v || null),
    a.total || null,
    a.variacao == null ? null : Number((a.variacao * 100).toFixed(1)),
    a.pessoasNoUltimoMes || null,
  ]);

  return [
    {
      nome: "Resumo",
      linhas: [cabResumo, ...linhasResumo],
      moeda: [8, 9, 10, 11, 13, 17, 18, 21],
      percentual: [14],
      larguras: [30, 24, 18, 15, 11, 11, 12, 12, 12, 13, 13, 15,
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

  const linhas = pessoas.map((p): CelulaPlanilha[] => {
    const r = resumoDaPessoa(p);
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
export function paraCsv(pessoas: PessoaRemuneracao[], meses: string[]): string {
  const sep = ";";
  const cel = (v: CelulaPlanilha) => {
    if (v == null) return "";
    if (typeof v === "number") return v.toFixed(2);
    return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  // BOM na frente: sem ele o Excel abre o CSV em ANSI e "Remuneração" vira
  // "RemuneraÃ§Ã£o" na primeira coluna que alguém for ler.
  return "﻿" + matrizParaPlanilha(pessoas, meses).map((l) => l.map(cel).join(sep)).join("\n");
}
