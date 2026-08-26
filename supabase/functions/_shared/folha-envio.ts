/**
 * Folha → Omie: quem entra no lote do mês, por quanto, e o que impede o envio.
 *
 * Mora em `_shared` pelo mesmo motivo que `cartao-envio.ts`: quem escreve no
 * Omie é a Edge Function (Deno) e quem decide se o botão aparece é a tela
 * (Vite). Um módulo só, importado dos dois lados — duas cópias da regra
 * divergem, e a que diverge para o lado permissivo duplica a folha do mês.
 *
 * ATENÇÃO ao irmão mais velho: `cartao-envio.ts` está sob o guarda de
 * `src/lib/cartao/envio.test.ts`, que varre o repo e REPROVA qualquer arquivo
 * fora da lista de autorizados que saiba criar título no Omie. Este módulo é
 * puro de propósito — ele decide O QUE lançar, nunca lança. O payload e a
 * chamada entram na lista de autorizados num commit separado, deliberado, com
 * a chave abaixo sendo virada junto.
 *
 * ------------------------------------------------------------------
 * A CHAVE
 * ------------------------------------------------------------------
 * Nasceu DESLIGADA. Enquanto era `false`, a tela mostrava a prévia completa e o
 * lote inteiro conferido, mas nada era criado no ERP. Ligar é um commit — com
 * diff, com autor. Uma flag em variável de ambiente pode ser virada por engano
 * de madrugada no meio de um fechamento; esta, não.
 *
 * LIGADA EM 26/08/2026, por autorização direta, para o primeiro envio real:
 * dois títulos de teste antes dos cento e dois. O que autorizou o passo foi o
 * payload ter sido conferido campo a campo contra a planilha de importação de
 * julho/2026 e contra o fluxo n8n de conta a pagar que já roda em produção.
 *
 * LIGAR NÃO LIBERA A FOLHA INTEIRA, e isso é o ponto. As outras travas seguem
 * de pé e são independentes: o marco (competências até julho recusadas), o
 * estado em `folha_envios_omie` (mês já enviado recusado) e as pendências de
 * cadastro. Na data em que foi ligada, o envio dos 102 continuava barrado por
 * quatro pessoas dividirem um CNPJ e seis terem documento incompleto — dado
 * errado no RH, que nenhuma chave deveria destravar.
 */
export const ENVIO_FOLHA_LIBERADO = true;

/** O que a tela diz enquanto o envio está desligado. `null` quando liberado. */
export function bloqueioDaFolha(): string | null {
  return ENVIO_FOLHA_LIBERADO
    ? null
    : "O envio da folha ao Omie está desligado. Esta tela monta e confere o lote "
      + "do mês, mas nada é criado no ERP. A liberação é feita no código, não por aqui.";
}

/* ------------------------------------------------------------------
 * O marco
 * ------------------------------------------------------------------ */

/**
 * Até esta competência, a folha foi lançada no Omie FORA do Hub.
 *
 * Julho/2026 foi a última lançada à mão (registro 31/07, vencimento 05/08) —
 * confirmado pelo financeiro em 26/08/2026. Logo a primeira que o Hub pode
 * provisionar é agosto/2026, com vencimento em 05/09.
 *
 * É a única trava que impede reprovisionar um mês que a analista já fez — e
 * reprovisionar folha duplica cem títulos de uma vez, não um.
 */
export const MARCO_FOLHA_FORA_DO_HUB = "2026-07-01";

/* ------------------------------------------------------------------
 * As três datas de um título de folha
 * ------------------------------------------------------------------
 * A competência é o mês TRABALHADO; o pagamento cai no mês seguinte. Como no
 * cartão, a âncora contábil é `data_entrada` — e aqui ela é o último dia da
 * competência, não a data do pagamento. Trocar isto joga a folha de agosto para
 * a DRE de setembro.
 *
 *   competência 2026-08  →  registro    31/08/2026   (data_entrada / data_emissao)
 *                           vencimento  05/09/2026   (data_vencimento)
 *                           previsão    07/09/2026   (data_previsao, se 05 cair no fim de semana)
 */

/** Dia fixo do vencimento, no mês seguinte ao da competência. */
export const DIA_DO_VENCIMENTO = 5;

/** Último dia da competência — o registro contábil do título. */
export function registroDa(competencia: string): string {
  const [a, m] = String(competencia).slice(0, 7).split("-").map(Number);
  return iso(new Date(a, m, 0)); // dia 0 do mês seguinte = último dia deste
}

/** Dia 5 do mês seguinte ao da competência. */
export function vencimentoDa(competencia: string): string {
  const [a, m] = String(competencia).slice(0, 7).split("-").map(Number);
  return iso(new Date(a, m, DIA_DO_VENCIMENTO));
}

/**
 * A previsão de pagamento.
 *
 * O vencimento é fixo no dia 5; quando ele cai em sábado ou domingo, o dinheiro
 * só sai na segunda seguinte, e é a previsão que anda — não o vencimento. São
 * dois campos no Omie de propósito, e misturá-los apaga a informação de que o
 * título venceu no fim de semana.
 *
 * NÃO trata feriado: não há calendário de feriados no Hub, e inventar um que
 * erre é pior do que a pessoa ver a data e ajustar. Fim de semana cobre a
 * maioria dos casos e é verificável sem tabela nenhuma.
 */
export function previsaoDe(vencimentoISO: string): string {
  const d = parseISO(vencimentoISO);
  if (!d) return vencimentoISO;
  const semana = d.getDay(); // 0 = domingo, 6 = sábado
  if (semana === 6) d.setDate(d.getDate() + 2);
  else if (semana === 0) d.setDate(d.getDate() + 1);
  return iso(d);
}

/** Date → 'AAAA-MM-DD' local (o `toISOString` volta um dia em fuso negativo). */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------
 * A chave de idempotência
 * ------------------------------------------------------------------ */

/**
 * `codigo_lancamento_integracao` do Omie. Único por PESSOA e por COMPETÊNCIA.
 *
 * A chave é o `codigo` do RH ("COL-003057"), NÃO o CNPJ.
 *
 * O CNPJ parecia a escolha óbvia — é o documento, deveria identificar a PJ. Mas
 * o espelho do RH, lido em 26/08/2026, tem QUATRO pessoas ativas dividindo o
 * CNPJ 37.511.891/0001-50 (André Luis Rocon, Caio Caiado, Kelly Travieso e
 * Wericles Silva), mais cinco documentos truncados e dois em branco. Com o CNPJ
 * na chave, essas quatro pessoas geram a MESMA `FOLHA-…`: o Omie aceita a
 * primeira e recusa as outras três por duplicidade. Três pessoas não recebem, e
 * o erro aparece como "título duplicado", que ninguém lê como "faltou pagar".
 *
 * `codigo` é único nas 112 linhas do espelho e nunca vem vazio — é a chave que o
 * próprio RH usa. O CNPJ continua indispensável, mas para achar o fornecedor no
 * Omie, não para identificar a competência da pessoa.
 */
export const integracaoFolhaDe = (codigo: string, competencia: string): string =>
  `FOLHA-${String(codigo ?? "").trim().toUpperCase()}-${String(competencia).slice(0, 7)}`;

export const soDigitos = (s: unknown): string => String(s ?? "").replace(/\D/g, "");

/* ------------------------------------------------------------------
 * O mês comercial
 * ------------------------------------------------------------------ */

/** Todo rateio desta folha usa mês de 30 dias — é a base comercial que o RH já pratica. */
export const DIAS_DO_MES_COMERCIAL = 30;

/** 'AAAA-MM-DD' → Date local, ou null. Não usa `new Date(iso)`: isso lê como UTC e volta um dia. */
export function parseISO(s: unknown): Date | null {
  if (!s || typeof s !== "string") return null;
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  return a && m && d ? new Date(a, m - 1, d) : null;
}

/** '2026-11-30' → '30/11/2026' (o Omie só aceita assim). */
export const dataBR = (iso: string): string => {
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

const noMesDe = (d: Date | null, ano: number, mes: number) =>
  !!d && d.getFullYear() === ano && d.getMonth() === mes;

const arred2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------
 * Os dois de-para
 * ------------------------------------------------------------------
 * O `setor` do espelho do RH é texto livre — a mesma área aparece como
 * "Marketing" numa linha e "Branding" noutra, porque cada um digita o que quer.
 * Confirmado pelo financeiro em 26/08/2026. Por isso ele NÃO entra aqui: o que
 * vale é o `departamento` padronizado da planilha da folha, e a categoria do
 * Omie sai do departamento.
 *
 * O vínculo é POR PESSOA, não por nome de área. Traduzir setor → departamento
 * seria 1→muitos ("Marketing" do RH se divide entre Branding e Conteúdo,
 * Comunidade e Performance) e não há como escolher pelo nome do setor.
 *
 * `lib_departamentos`, da Biblioteca, é uma TERCEIRA lista e está desatualizada
 * — não serve de fonte para nada disto.
 */

/** O que o de-para devolve para uma pessoa. */
export type DeParaDaPessoa = {
  /** Departamento padronizado, o da planilha da folha. */
  departamento: string;
  /** `codigo_categoria` do Omie — fixo por departamento, salvo exceção da pessoa. */
  categoria: string;
  /** Último valor efetivamente provisionado. `null` para quem nunca entrou numa folha. */
  valorReferencia?: number | null;
  /**
   * Salário corrigido no Hub. Quando presente, MANDA na folha.
   *
   * O espelho do RH é reescrito a cada sync, então a correção não pode morar
   * lá — duraria até o próximo ciclo e sumiria calada. Mora no de-para e passa
   * por cima do espelho aqui.
   */
  valorAjustado?: number | null;
  /** Quanto o espelho dizia quando a correção foi feita. */
  valorRhNoAjuste?: number | null;
};

/**
 * A partir de quanta variação a linha é marcada na prévia.
 *
 * Não bloqueia o envio — chama atenção. A diferença entre marcar e barrar é
 * que aumento de salário é rotina e erro de digitação também: quem decide qual
 * é qual é quem confere.
 *
 * O número saiu de um caso real. Em 26/08/2026 o espelho do RH trazia
 * R$ 24.000 para quem a folha de julho pagou R$ 2.400 — um dígito a mais. Eram
 * 23 divergências, e o TOTAL das duas folhas quase empatava (490.294 contra
 * 489.460), porque os erros se cancelavam. Conferir o total não pega nada
 * disso; conferir linha a linha, sim.
 */
export const VARIACAO_QUE_CHAMA_ATENCAO = 0.10;

/** Resolve o de-para de uma pessoa pelo código do RH. `null` = ainda não mapeada. */
export type ResolveDePara = (codigo: string) => DeParaDaPessoa | null;

/* ------------------------------------------------------------------
 * O que entra no lote
 * ------------------------------------------------------------------ */

/** O que o lote precisa saber de um colaborador. Espelha `rh_colaboradores`. */
export type ColaboradorDaFolha = {
  id: string;
  /** `codigo` do RH ("COL-003057") — a chave estável da pessoa. Ver `integracaoFolhaDe`. */
  codigo: string | null;
  nome: string;
  cnpj: string | null;
  razao?: string | null;
  cargo?: string | null;
  valor: number | null;
  /** 'AAAA-MM-DD' */
  inicio: string | null;
  /** 'AAAA-MM-DD'; preenchido = desligado. Quem tem data não entra na folha. */
  datadesl: string | null;
};

/**
 * Por que o valor desta linha não é o salário cheio.
 *
 * Só há dois: mês inteiro, ou rateado por admissão no meio do mês. NÃO existe
 * rateio de rescisão aqui — quem foi desligado é pago pelo processo de
 * rescisão, em /governanca/rescisoes, e não entra nesta folha.
 */
export type MotivoDoRateio = "cheio" | "admissao";

/** Uma linha do lote, já conferida — é o que a prévia mostra e o que o envio consome. */
export type ItemDaFolha = {
  colaboradorId: string;
  codigo: string;
  nome: string;
  cnpj: string;
  razao: string | null;
  /** Do de-para, não do RH. Vazio = pessoa ainda não mapeada (vira pendência). */
  departamento: string;
  /** `codigo_categoria` do Omie. Vazio = pendência; nunca chuta. */
  categoria: string;
  /** Último valor provisionado, para comparar. `null` = primeira folha da pessoa. */
  valorReferencia: number | null;
  /** Variação do salário contra a referência (0.1 = +10%). `null` sem referência. */
  variacao: number | null;
  /** A variação passou do limite? É o que a prévia marca em vermelho. */
  chamaAtencao: boolean;
  /** Salário que a folha vai usar: o ajuste quando existe, senão o do espelho. */
  valorBase: number;
  /** O que o espelho do RH diz hoje. */
  valorRh: number;
  /** O ajuste feito no Hub, se houver. `null` = a folha está usando o espelho. */
  valorAjustado: number | null;
  /**
   * O ajuste virou redundante: o espelho do RH já chegou no mesmo valor.
   * Vale mostrar para alguém poder limpar em vez de carregar para sempre um
   * valor fixo que ninguém lembra por que existe.
   */
  ajusteRedundante: boolean;
  /** Dias trabalhados na competência, em base comercial de 30. */
  dias: number;
  motivo: MotivoDoRateio;
  /** O que vai no `valor_documento`. Igual ao salário quando o mês é cheio. */
  valor: number;
  /** `codigo_lancamento_integracao` — a trava contra pagar duas vezes. */
  integracao: string;
};

/** Quem ficou de fora, e por quê — a prévia mostra isto junto, não escondido. */
export type ForaDoLote = {
  colaboradorId: string;
  nome: string;
  motivo: string;
};

export type Lote = {
  competencia: string;
  /** Último dia da competência — `data_entrada`/`data_emissao`, a âncora da DRE. */
  registro: string;
  /** Dia 5 do mês seguinte — `data_vencimento`. */
  vencimento: string;
  /** A data que VAI valer: a exceção da competência quando existe, senão a regra. */
  previsao: string;
  /** O que a regra daria, sem exceção. Igual a `previsao` quando não há exceção. */
  previsaoRegra: string;
  /** Há exceção nesta competência? A prévia mostra as duas datas quando sim. */
  previsaoExcepcional: boolean;
  itens: ItemDaFolha[];
  fora: ForaDoLote[];
  total: number;
};

/**
 * Dias trabalhados na competência, em base comercial de 30.
 *
 * Quem atravessa o mês inteiro recebe 30; quem foi admitido no meio conta do
 * dia da entrada até o fim do mês, inclusive.
 *
 * Desligamento não aparece aqui de propósito: `montarLote` tira do lote quem
 * saiu até o fim da competência, antes de chegar nesta conta.
 */
export function diasTrabalhados(
  inicio: Date | null,
  ano: number,
  mes: number,
): { dias: number; motivo: MotivoDoRateio } {
  if (!noMesDe(inicio, ano, mes)) return { dias: DIAS_DO_MES_COMERCIAL, motivo: "cheio" };
  return { dias: limita(DIAS_DO_MES_COMERCIAL - inicio!.getDate() + 1), motivo: "admissao" };
}

const limita = (d: number) => Math.max(0, Math.min(DIAS_DO_MES_COMERCIAL, d));

/**
 * O lote de uma competência.
 *
 * Só gente ATIVA na competência. Fica de fora quem ainda não tinha entrado,
 * quem foi desligado até o fim do mês, quem não tem salário e quem resulta em
 * zero dia.
 *
 * Nada some calado: cada exclusão vai para `fora` com o motivo escrito, porque
 * uma pessoa faltando na folha é um problema maior do que uma linha a mais na
 * prévia — e mais difícil de notar.
 */
export function montarLote(
  colaboradores: ColaboradorDaFolha[],
  competencia: string,
  deParaDe: ResolveDePara = () => null,
  /**
   * Data de pagamento que substitui a da regra NESTA competência.
   *
   * Existe porque mês de exceção existe — setembro/2026 antecipou o pagamento
   * da segunda para a sexta anterior. Mexer em `previsaoDe` para acomodar isso
   * transformaria a exceção de um mês na regra de todos os meses seguintes, e
   * ninguém lembraria de desfazer.
   */
  previsaoManual: string | null = null,
): Lote {
  const comp = String(competencia).slice(0, 7);
  const ref = parseISO(`${comp}-01`);
  const vencimento = ref ? vencimentoDa(comp) : "";
  const previsaoRegra = ref ? previsaoDe(vencimento) : "";
  const excecao = parseISO(previsaoManual) ? String(previsaoManual).slice(0, 10) : "";
  const datas = {
    registro: ref ? registroDa(comp) : "",
    vencimento,
    previsao: excecao || previsaoRegra,
    previsaoRegra,
    previsaoExcepcional: !!excecao && excecao !== previsaoRegra,
  };
  if (!ref) return { competencia, ...datas, itens: [], fora: [], total: 0 };

  const ano = ref.getFullYear();
  const mes = ref.getMonth();
  const ultimoDia = new Date(ano, mes + 1, 0);

  const itens: ItemDaFolha[] = [];
  const fora: ForaDoLote[] = [];

  for (const c of colaboradores) {
    const nome = String(c.nome ?? "—");
    const inicio = parseISO(c.inicio);
    const desl = parseISO(c.datadesl);

    const codigo = String(c.codigo ?? "").trim().toUpperCase();
    if (!codigo) {
      // Sem o código não há chave de idempotência, e sem ela o reenvio paga de
      // novo. Fora do lote é o único desfecho seguro.
      fora.push({ colaboradorId: c.id, nome, motivo: "Sem código do RH — não dá para garantir envio único" });
      continue;
    }
    if (!inicio) {
      fora.push({ colaboradorId: c.id, nome, motivo: "Sem data de início no cadastro do RH" });
      continue;
    }
    if (inicio > ultimoDia) {
      fora.push({ colaboradorId: c.id, nome, motivo: "Entrou depois desta competência" });
      continue;
    }

    /* Desligado NÃO entra na folha — é pago pelo processo de rescisão, em
       /governanca/rescisoes, que calcula as parcelas e controla o pagamento.
       Provisionar aqui também pagaria os mesmos dias duas vezes.
       (Decidido com o financeiro em 26/08/2026.)

       A comparação é com o FIM da competência, não com hoje: quem sai em
       setembro trabalhou agosto inteiro, e a folha de agosto é dele. Cortar
       por "tem data de desligamento" tiraria essa pessoa de um mês que ela
       tem a receber. */
    if (desl && desl <= ultimoDia) {
      fora.push({
        colaboradorId: c.id,
        nome,
        motivo: `Desligado em ${dataBR(String(c.datadesl))} — pago pela rescisão`,
      });
      continue;
    }

    /* Sem de-para a pessoa NÃO sai do lote: ela aparece na prévia com o campo
       vazio, e `pendenciasDoLote` barra o envio. Some daqui seria pior — folha
       com uma pessoa a menos não dá erro em lugar nenhum. */
    const dePara = deParaDe(codigo);

    /* O ajuste do Hub passa por cima do espelho. Zero é ajuste válido? Não:
       zerar alguém é tirá-lo da folha, e isso se faz pelo desligamento, não
       por um campo de valor. Ajuste tem de ser positivo para valer. */
    const valorRh = Number(c.valor) || 0;
    const aj = Number(dePara?.valorAjustado ?? NaN);
    const valorAjustado = Number.isFinite(aj) && aj > 0 ? arred2(aj) : null;
    const valorBase = valorAjustado ?? valorRh;

    if (valorBase <= 0) {
      fora.push({ colaboradorId: c.id, nome, motivo: "Sem valor mensal no cadastro do RH" });
      continue;
    }

    const { dias, motivo } = diasTrabalhados(inicio, ano, mes);
    if (dias <= 0) {
      fora.push({ colaboradorId: c.id, nome, motivo: "Nenhum dia trabalhado nesta competência" });
      continue;
    }

    /* A comparação é do salário CHEIO contra o cheio de referência, nunca do
       rateado: quem entrou dia 20 recebe um terço, e comparar o terço com o
       mês inteiro marcaria toda admissão como suspeita. */
    const refBruta = Number(dePara?.valorReferencia ?? NaN);
    const referencia = Number.isFinite(refBruta) && refBruta > 0 ? refBruta : null;
    const variacao = referencia === null ? null : (valorBase - referencia) / referencia;

    const valor =
      motivo === "cheio" ? arred2(valorBase) : arred2((valorBase / DIAS_DO_MES_COMERCIAL) * dias);

    itens.push({
      colaboradorId: c.id,
      codigo,
      nome,
      cnpj: soDigitos(c.cnpj),
      razao: c.razao ?? null,
      departamento: dePara?.departamento ?? "",
      categoria: dePara?.categoria ?? "",
      valorReferencia: referencia,
      variacao,
      chamaAtencao: variacao !== null && Math.abs(variacao) >= VARIACAO_QUE_CHAMA_ATENCAO,
      valorBase,
      valorRh,
      valorAjustado,
      ajusteRedundante: valorAjustado !== null && arred2(valorRh) === valorAjustado,
      dias,
      motivo,
      valor,
      integracao: integracaoFolhaDe(codigo, competencia),
    });
  }

  itens.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  fora.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    competencia,
    ...datas,
    itens,
    fora,
    total: arred2(itens.reduce((s, i) => s + i.valor, 0)),
  };
}

/* ------------------------------------------------------------------
 * As recusas
 * ------------------------------------------------------------------ */

export type EstadoDaFolha = "pendente" | "fora_do_hub" | "enviado" | null;

/** O que ainda falta resolver numa linha antes de ela poder virar título. */
export type PendenciaDoItem = {
  /** CNPJ só com dígitos — usado para achar o fornecedor e para flagrar repetição. */
  cnpj: string;
  /** Fornecedor do Omie casado pelo CNPJ; `null` = não achou. */
  codigoFornecedor: number | null;
  /** Categoria da pessoa, vinda do de-para; vazio = sem categoria definida. */
  codigoCategoria: string | null;
};

/**
 * Por que este envio não pode acontecer — `null` quando pode.
 *
 * Pura de propósito: é a MESMA função que desabilita o botão na tela e que
 * recusa o request na Edge Function. Duas checagens escritas separadamente
 * divergem, e aqui a que diverge para o lado permissivo paga a folha duas vezes.
 */
export function recusaDaFolha(opts: {
  competencia: string;
  estado: EstadoDaFolha;
  itens: PendenciaDoItem[];
}): string | null {
  const bloqueio = bloqueioDaFolha();
  if (bloqueio) return bloqueio;

  const comp = String(opts.competencia ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(comp)) return "Competência da folha não definida.";

  if (`${comp}-01` <= MARCO_FOLHA_FORA_DO_HUB) {
    return `Folhas até ${MARCO_FOLHA_FORA_DO_HUB.slice(0, 7)} foram lançadas no Omie à mão, antes de o Hub existir. `
      + "Reprovisionar duplicaria a folha inteira do mês.";
  }
  if (opts.estado === "fora_do_hub") return "Esta competência está marcada como lançada fora do Hub.";
  if (opts.estado === "enviado") return "A folha desta competência já foi enviada ao Omie pelo Hub.";

  return pendenciasDoLote(opts.itens);
}

/**
 * O que falta resolver nas LINHAS — separado de `recusaDaFolha` de propósito.
 *
 * Estas checagens não dependem da chave nem do marco, então ficam verificáveis
 * mesmo com o envio desligado. Não é detalhe de organização: são as travas que
 * nasceram de defeitos reais lidos no espelho do RH em 26/08/2026, e uma trava
 * que só roda depois de alguém ligar a chave é uma trava sem teste.
 */
export function pendenciasDoLote(itens: PendenciaDoItem[]): string | null {
  if (!itens.length) return "Não há ninguém no lote desta competência.";

  /* CNPJ dividido por mais de uma pessoa não é curiosidade de cadastro: os
     títulos vão todos para o MESMO fornecedor no Omie, e quem conferir o
     extrato do prestador vê o valor de quatro salários juntos. No espelho lido
     em 26/08/2026 eram quatro pessoas no CNPJ 37.511.891/0001-50. */
  const porCnpj = new Map<string, number>();
  for (const i of itens) {
    const c = soDigitos(i.cnpj);
    if (c) porCnpj.set(c, (porCnpj.get(c) ?? 0) + 1);
  }
  const repetidos = [...porCnpj.values()].filter((n) => n > 1).length;
  if (repetidos) {
    return `${repetidos} CNPJ(s) aparecem em mais de um colaborador do lote. `
      + "Os títulos iriam todos para o mesmo fornecedor no Omie. Corrija o cadastro antes de enviar.";
  }

  // Cinco documentos truncados e dois em branco no mesmo espelho.
  const semCnpj = itens.filter((i) => soDigitos(i.cnpj).length !== 14).length;
  if (semCnpj) {
    return `${semCnpj} colaborador(es) com CNPJ ausente ou incompleto. `
      + "Sem documento válido não há fornecedor no Omie.";
  }

  const semFornecedor = itens.filter((i) => !i.codigoFornecedor).length;
  if (semFornecedor) {
    return `${semFornecedor} colaborador(es) sem fornecedor correspondente no Omie. `
      + "Cadastre o CNPJ no Omie (ou corrija no RH) antes de enviar.";
  }

  const semCategoria = itens.filter((i) => !String(i.codigoCategoria ?? "").trim()).length;
  if (semCategoria) {
    return `${semCategoria} colaborador(es) sem categoria do Omie definida. `
      + "Defina a categoria de todos antes de enviar.";
  }

  return null;
}

/* ------------------------------------------------------------------
 * O título
 * ------------------------------------------------------------------
 * ESPELHA a planilha de importação que o financeiro usou até a folha de
 * julho/2026 ("Provisão pag junho.xlsx", 103 linhas, lida em 26/08/2026),
 * cruzada com o payload do fluxo n8n que já cria conta a pagar de parceiro.
 * Não é invenção: é a mesma ficha preenchida à mão, escrita por código.
 *
 * Das 62 colunas do template do Omie, a folha usa NOVE:
 *
 *   C  Fornecedor            → codigo_cliente_fornecedor  (achado pelo CNPJ)
 *   D  Categoria             → codigo_categoria
 *   E  Conta Corrente        → id_conta_corrente          FIXO "Sicoob - Conta Corrente"
 *   F  Valor da Conta        → valor_documento
 *   J  Data de Registro      → data_entrada               31/07/2026 na folha de julho
 *   K  Data de Vencimento    → data_vencimento            05/08/2026
 *   S  Observações           → observacao                 o NOME da pessoa
 *   AA Forma de Pagamento    → cnab.codigo_forma_pagamento   FIXO "TRA"
 *   AJ Finalidade            → cnab.finalidade_transferencia FIXO "01.3"
 *   AX Departamento (100%)   → departamentos[].cCodDep com nPerc 100
 *
 * O QUE FICA DE FORA, porque ficava em branco nas 103 linhas: data de emissão,
 * tipo de documento, número do documento, parcela, nota fiscal e todos os
 * impostos. O fluxo de parceiro manda `codigo_tipo_documento: "NF"` porque ali
 * existe nota; folha não tem nota, então o campo não vai.
 *
 * A DIFERENÇA DELIBERADA: a coluna B (Código de Integração) ficava VAZIA na
 * importação manual. Sem ela o Omie aceita o mesmo arquivo duas vezes e cria a
 * folha em dobro, sem reclamar de nada. Aqui ela é obrigatória.
 */

/** "Transferência Bancária" na planilha. */
export const FORMA_PAGAMENTO_FOLHA = "TRA";

/** "Transferência por Chave PIX" na planilha. */
export const FINALIDADE_PIX_FOLHA = "01.3";

/** Percentual do departamento no título — a coluna é "Departamento (100%)". */
export const PERCENTUAL_DEPARTAMENTO = 100;

/**
 * A conta que paga a folha, pelo NOME do cadastro do Omie.
 *
 * Fica pelo nome e não pelo id numérico de propósito: o id (5455988727 em
 * 26/08/2026) só existe no cadastro do ERP, e um número solto no código é algo
 * que ninguém consegue conferir lendo. O nome é o mesmo que a planilha de
 * importação usava na coluna "Conta Corrente", então dá para bater as duas
 * coisas a olho. O id sai do cache `folha_cadastros`.
 */
export const CONTA_CORRENTE_FOLHA = "Sicoob - Conta Corrente";

/** Um título de folha a criar, já conferido na prévia. */
export type TituloDaFolha = {
  /** `codigo_lancamento_integracao` — a trava contra pagar duas vezes. */
  integracao: string;
  /** Fornecedor no Omie, achado pelo CNPJ. */
  codigoFornecedor: number;
  /** Conta corrente que paga a folha ("Sicoob - Conta Corrente"). */
  idContaCorrente: number;
  codigoCategoria: string;
  /** Código do departamento no Omie, do de-para. */
  codigoDepartamento: string;
  valor: number;
  /** Último dia da competência — vira `data_entrada`/`dDtRegistro`. */
  registro: string;                    // 'AAAA-MM-DD'
  vencimento: string;                  // 'AAAA-MM-DD'
  previsao: string;                    // 'AAAA-MM-DD'
  /** Vai cru na observação: é por ele que se sabe de quem é o título. */
  nome: string;
  /** Chave PIX do fornecedor; sem ela, o CNPJ (é o que o fluxo de parceiro faz). */
  chavePix: string | null;
  cnpj: string;
  /** Razão social — `nome_transferencia` do CNAB. */
  razao: string | null;
};

/** O `param` do `IncluirContaPagar`. */
export function montarTituloFolha(t: TituloDaFolha): Record<string, unknown> {
  const cnpj = soDigitos(t.cnpj);
  return {
    codigo_lancamento_integracao: t.integracao,
    codigo_cliente_fornecedor: t.codigoFornecedor,
    id_conta_corrente: t.idContaCorrente,
    codigo_categoria: t.codigoCategoria,
    valor_documento: Number(t.valor.toFixed(2)),
    // A âncora contábil: último dia da competência, não o dia do pagamento.
    data_entrada: dataBR(t.registro),
    data_vencimento: dataBR(t.vencimento),
    data_previsao: dataBR(t.previsao),
    // 240 é o limite do campo no Omie; nome de gente cabe folgado.
    observacao: t.nome.trim().slice(0, 240),
    departamentos: [{
      cCodDep: t.codigoDepartamento,
      nPerc: PERCENTUAL_DEPARTAMENTO,
    }],
    cnab_integracao_bancaria: {
      codigo_forma_pagamento: FORMA_PAGAMENTO_FOLHA,
      finalidade_transferencia: FINALIDADE_PIX_FOLHA,
      pix_qrcode: (t.chavePix ?? "").trim() || cnpj,
      cpf_cnpj_transferencia: cnpj,
      nome_transferencia: (t.razao ?? "").trim() || t.nome.trim(),
    },
  };
}

/* ------------------------------------------------------------------
 * O código da categoria
 * ------------------------------------------------------------------
 * NÃO dá para deduzir o código a partir da descrição. Isto aqui já esteve
 * errado, e o erro passaria despercebido:
 *
 *   descrição na planilha        código REAL no Omie
 *   "3.1.1.4. Pessoal - Tecnologia"   →  2.03.13
 *   "3.1.1.2. Pessoal - Comercial"    →  2.03.11
 *   "3.2.7.1. Pessoal - Onboarding"   →  2.02.92
 *   "3.2.22 Diretores - Administrativo" → 2.04.95
 *
 * O "3.1.1.4." é a numeração contábil INTERNA da empresa, escrita dentro do
 * texto da descrição. O `codigo_categoria` do Omie é outra numeração, sem
 * relação nenhuma com ela. Conferido contra `ListarCategorias` em 26/08/2026
 * (177 categorias no cadastro).
 *
 * Por isso a resolução é por CONSULTA ao catálogo, nunca por regra de texto.
 * A planilha de importação podia casar por descrição porque o importador do
 * Omie resolve o nome sozinho; a API não faz esse favor.
 */

/** Uma categoria como o Omie a devolve. */
export type CategoriaDoOmie = { codigo: string; descricao: string; conta_inativa?: boolean };

const chaveDescricao = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Monta o resolvedor descrição → `codigo_categoria`, a partir do catálogo
 * cacheado por `omie-folha-cadastros-sync`.
 *
 * Devolve `null` quando a descrição não existe no cadastro — e aí a pessoa vira
 * pendência na prévia. Chutar um código aqui é despesa na conta errada da DRE.
 */
export function resolvedorDeCategoria(
  catalogo: CategoriaDoOmie[],
): (descricao: string) => string | null {
  const porDescricao = new Map<string, string>();
  for (const c of catalogo) {
    if (c?.conta_inativa) continue;
    const k = chaveDescricao(c.descricao);
    if (k && !porDescricao.has(k)) porDescricao.set(k, String(c.codigo));
  }
  return (descricao: string) => porDescricao.get(chaveDescricao(descricao)) ?? null;
}

/* ------------------------------------------------------------------
 * Por que NÃO existe envio em lote
 * ------------------------------------------------------------------
 * O `IncluirContaPagarPorLote` parecia o caminho óbvio: cem títulos numa
 * chamada em vez de cem chamadas. Testado em 26/08/2026 com dois títulos
 * reais, e o Omie recusou:
 *
 *   ERROR: Tag [DEPARTAMENTOS] não faz parte da estrutura do tipo complexo
 *   [conta_pagar_cadastro]!
 *
 * O `conta_pagar_cadastro` do lote é uma estrutura REDUZIDA — aceita
 * fornecedor, vencimento, valor, categoria e conta corrente, e mais nada. O
 * exemplo da documentação mostra só esses campos justamente porque são os
 * únicos, e não por brevidade.
 *
 * Departamento é uma das nove colunas que a importação manual preenche, então
 * abrir mão dele não era opção: o título nasceria sem centro de custo e a DRE
 * por área ficaria furada. O envio é um a um, por `IncluirContaPagar`, que é o
 * mesmo endpoint que o fluxo n8n de conta a pagar de parceiro já usa em
 * produção.
 *
 * NÃO TENTE O LOTE DE NOVO sem antes conferir se o Omie mudou a estrutura.
 * Este comentário existe para poupar a próxima pessoa de descobrir isso com
 * cem títulos.
 */
