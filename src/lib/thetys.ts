/* O que a TETS fez — a leitura de `agente_execucoes`, do lado puro.
 *
 * QUEM ESCREVE ESTA TABELA NÃO É O HUB. O runtime da agente roda fora deste
 * repositório e grava uma linha por decisão: `tarefa`, `entrada`, `saida`,
 * `resultado`. Daqui só se lê. Isso decide quase tudo o que está neste arquivo:
 * campo que ela não manda não existe (latência vem sempre nula, confiança em 11
 * de 314 linhas), e tarefa que aparecer amanhã tem que caber sem quebrar a tela.
 *
 * CONTAR "AÇÕES" É ENGANOSO, e é o erro que este arquivo existe para evitar. Das
 * 314 primeiras linhas, 65 são "consultei um fornecedor" e 30 são "verifiquei se
 * o lançamento já existia" — trabalho de verdade, mas trabalho de LEITURA. Somar
 * isso com "lançou 30 contas a pagar" e anunciar "314 ações" transforma um
 * relatório num número inflado que ninguém pode usar para decidir nada. Por isso
 * cada tarefa é classificada, e o painel mostra os dois lados separados.
 *
 * TRÊS CLASSES, NÃO DUAS. Tarefa desconhecida não vira "leitura" por omissão nem
 * "escrita" por susto: vira `desconhecida` e aparece como tal. Quando o runtime
 * ganhar uma capacidade nova, o painel diz "não sei o que é isto" em vez de
 * contá-la errado com cara de certeza — a mesma regra do `null` das Integrações.
 *
 * O DIA É O DIA DAQUI. `executado_em` é timestamptz e o Postgres guarda em UTC;
 * uma ação das 21h de terça em São Paulo é quarta-feira em UTC. Agrupar por
 * `toISOString().slice(0,10)` jogaria as ações do fim da tarde para o dia
 * seguinte, e o relatório de "ontem" viria com buraco na ponta. `diaLocal` usa o
 * fuso do navegador, que é o de quem lê.
 */

/* ------------------------------------------------------------------ tipos */

export type Resultado = "executado" | "proposto" | "escalado" | "falhou";
export type Classe = "escrita" | "leitura" | "desconhecida";
export type Modo = "producao" | "teste";

export type Execucao = {
  id: string;
  agente_id: string;
  tarefa: string;
  entidade: string | null;
  entidade_id: string | null;
  regra_id: string | null;
  entrada: unknown;
  saida: unknown;
  confianca: number | null;
  alcada: string | null;
  resultado: Resultado;
  corrigido_por_humano: boolean;
  correcao: unknown;
  corrigido_em: string | null;
  latencia_ms: number | null;
  erro: string | null;
  executado_em: string;
};

export type Excecao = {
  id: string;
  agente_id: string;
  execucao_id: string | null;
  tipo: string;
  titulo: string;
  descricao: string | null;
  severidade: "baixa" | "media" | "alta" | "critica";
  valor: number | null;
  entidade: string | null;
  entidade_id: string | null;
  sla_horas: number;
  vence_em: string | null;
  status: "aberta" | "em_analise" | "resolvida" | "descartada";
  resolucao: string | null;
  resolvido_em: string | null;
  criado_em: string;
};

/** Traduz um id de fornecedor (uuid de `lib_fornecedores`) no nome de tela. */
export type NomeDe = (id: string | null | undefined) => string | null;

/* -------------------------------------------------------------- pecinhas */

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};

const txt = (v: unknown): string => (v == null ? "" : String(v));

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Reais por extenso, string pura — é para template literal, PDF e planilha. */
export function brlStr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `R$ ${Number(n).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** O dia de `executado_em` no fuso de quem lê — "2026-09-02". */
export function diaLocal(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "02/09 09:12" — o carimbo de uma linha da trilha. */
export function horaLocal(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Produção ou ensaio.
 *
 * O runtime carimba `_modo` dentro da `entrada`. Nas 314 primeiras linhas ele
 * veio `"teste"` em TODAS — a agente ainda não virou a chave. Uma linha sem o
 * campo é tratada como produção: quando o carimbo sumir (porque o runtime parou
 * de mandá-lo ao entrar em operação), o padrão certo é contar como trabalho.
 */
export function modoDe(e: Execucao): Modo {
  return txt(obj(e.entrada)._modo).toLowerCase() === "teste" ? "teste" : "producao";
}

/* --------------------------------------------------- dicionário de tarefas */

type Verbete = {
  rotulo: string;
  classe: Classe;
  /** Quando o parâmetro é que decide se ela mudou algo (`lancar: false` só confere). */
  classeDe?: (e: Obj, s: Obj) => Classe;
  /** A linha de apoio, em português. Vazia quando o rótulo já diz tudo. */
  detalhe?: (e: Obj, s: Obj, nome: NomeDe) => string;
  /** Só onde a ação de fato lança dinheiro — ver `valorLancado`. */
  valor?: (e: Obj, s: Obj) => number | null;
};

/** Nome do fornecedor pelo id, com o id abreviado como último recurso. */
const forn = (e: Obj, nome: NomeDe, campo = "fornecedor_id"): string => {
  const id = txt(e[campo]);
  if (!id) return "";
  return nome(id) ?? `fornecedor ${id.slice(0, 8)}`;
};

const juntar = (...partes: (string | null | undefined)[]): string =>
  partes.map((p) => txt(p).trim()).filter(Boolean).join(" · ");

/**
 * As 28 tarefas que a agente já executou, mais o que elas querem dizer.
 *
 * O `detalhe` lê `entrada` e `saida` porque o formato do JSON é DIFERENTE por
 * tarefa — não há um campo "descrição" para exibir. É o mesmo desenho do
 * `O_QUE_FAZ` do painel de automações: um dicionário escrito à mão é o que separa
 * uma trilha legível de um despejo de JSON.
 */
export const TAREFAS: Record<string, Verbete> = {
  /* --- o ciclo do contas a pagar: é aqui que ela mexe no Omie --- */
  criar_conta_pagar: {
    rotulo: "Lançou conta a pagar",
    classe: "escrita",
    detalhe: (e, s, nome) =>
      juntar(forn(e, nome), brlStr(num(e.valor)), e.vencimento ? `venc. ${txt(e.vencimento)}` : "",
        s.codigo_omie ? `Omie ${txt(s.codigo_omie)}` : ""),
    valor: (e) => num(e.valor),
  },
  editar_lancamento_omie: {
    rotulo: "Editou lançamento no Omie",
    classe: "escrita",
    detalhe: (e, s) =>
      juntar(
        e.codigo_lancamento ? `título ${txt(e.codigo_lancamento)}` : "",
        num(s.valor_anterior) != null && num(e.novo_valor) != null
          ? `${brlStr(num(s.valor_anterior))} → ${brlStr(num(e.novo_valor))}` : "",
        txt(s.vencimento_anterior) && txt(e.novo_vencimento)
          ? `venc. ${txt(s.vencimento_anterior)} → ${txt(e.novo_vencimento)}` : "",
      ),
    valor: (e) => num(e.novo_valor),
  },
  dar_entrada_nota: {
    rotulo: "Deu entrada na nota",
    classe: "escrita",
    detalhe: (e, s) =>
      juntar(e.cod_titulo ? `título ${txt(e.cod_titulo)}` : "",
        s.etapa_alterada === true ? `etapa ${txt(e.nova_etapa)}` : "etapa não mudou",
        txt(s.erro_etapa)),
  },
  vincular_nota_ao_cap: {
    rotulo: "Vinculou a nota ao título",
    classe: "escrita",
    detalhe: (e, s) =>
      juntar(e.cod_titulo ? `título ${txt(e.cod_titulo)}` : "",
        s.carimbo === true ? "chave carimbada" : "sem carimbo", txt(s.erro_carimbo)),
  },
  anexar_documento: {
    rotulo: "Anexou documento ao título",
    classe: "escrita",
    detalhe: (e, s) => {
      const anexados = Array.isArray(s.anexados) ? s.anexados.length : 0;
      const falhas = Array.isArray(s.falhas) ? s.falhas.length : 0;
      return juntar(
        e.codigo_lancamento ? `título ${txt(e.codigo_lancamento)}` : "",
        `${anexados} anexo${anexados === 1 ? "" : "s"}`,
        falhas ? `${falhas} falharam` : "",
      );
    },
  },
  conferir_fixos_do_dia: {
    rotulo: "Conferiu os fixos do dia",
    classe: "escrita",
    /* `lancar: false` é ensaio: ela olha o calendário e não cria nada. Contar
       isso como escrita infla o relatório com trabalho que não aconteceu. */
    classeDe: (e) => (e.lancar === true ? "escrita" : "leitura"),
    detalhe: (e, s) =>
      juntar(txt(e.data), `${num(s.criadas) ?? 0} criada(s)`, `${num(s.pendentes) ?? 0} pendente(s)`),
  },
  registrar_obrigacao: {
    rotulo: "Registrou obrigação",
    classe: "escrita",
    detalhe: (e, s) => juntar(brlStr(num(e.valor)), txt(e.vencimento), txt(s.estado)),
    valor: (e) => num(e.valor),
  },

  /* --- cadastro de fornecedor: muda a Biblioteca e o Omie --- */
  cadastrar_fornecedor_do_documento: {
    rotulo: "Cadastrou fornecedor",
    classe: "escrita",
    detalhe: (e, s) => juntar(txt(e.razao_social), txt(e.cnpj), txt(s.situacao_cadastral)),
  },
  espelhar_fornecedor_do_omie: {
    rotulo: "Espelhou fornecedor do Omie",
    classe: "escrita",
    detalhe: (_e, s) => txt(s.nome),
  },
  cadastrar_dado_bancario_fornecedor: {
    rotulo: "Cadastrou dado bancário",
    classe: "escrita",
    detalhe: (e, s, nome) =>
      juntar(forn(e, nome), s.chave_anterior ? "substituiu a chave anterior" : "primeira chave"),
  },
  liberar_fornecedor: {
    rotulo: "Liberou fornecedor",
    classe: "escrita",
    detalhe: (e, s) => juntar(txt(s.nome), txt(e.motivo)),
  },
  ensinar_categoria: {
    rotulo: "Ensinou a categoria",
    classe: "escrita",
    detalhe: (e, s) => juntar(txt(e.categoria), txt(s.acao), txt(e.observacao)),
  },
  marcar_evento_em_lote: {
    rotulo: "Marcou evento em lote",
    classe: "escrita",
    detalhe: (e, s) => juntar(txt(e.titulo), txt(s.acao)),
  },

  /* --- caixa de entrada e trilha --- */
  marcar_email_processado: {
    rotulo: "Marcou e-mail como lido",
    classe: "escrita",
    detalhe: (e) => (e.uid ? `uid ${txt(e.uid)}` : ""),
  },
  sincronizar_titulos: {
    rotulo: "Sincronizou títulos do Omie",
    classe: "escrita",
    detalhe: (_e, s) =>
      juntar(`${num(s.sincronizados) ?? 0} títulos`, txt(s.desde) && `desde ${txt(s.desde)}`),
  },
  resolver_excecao: {
    rotulo: "Resolveu uma exceção",
    classe: "escrita",
    detalhe: (e, s) => juntar(txt(s.titulo), txt(e.resolucao)),
  },

  /* --- consultas: trabalho real, mas nada muda de lado nenhum --- */
  consultar_fornecedor: {
    rotulo: "Consultou fornecedor",
    classe: "leitura",
    detalhe: (e, s) =>
      juntar(txt(e.nome) || txt(e.cnpj),
        s.existe_no_omie === true ? "existe no Omie" : "não existe no Omie",
        s.tem_governanca === true ? "com governança" : ""),
  },
  consultar_regra_categoria: {
    rotulo: "Consultou a regra de categoria",
    classe: "leitura",
    detalhe: (e, s, nome) =>
      juntar(forn(e, nome), s.encontrada === true ? "achou regra" : "sem regra"),
  },
  verificar_lancamento_existente: {
    rotulo: "Checou se o lançamento já existia",
    classe: "leitura",
    detalhe: (e, s, nome) =>
      juntar(forn(e, nome), brlStr(num(e.valor)), `${num(s.encontrados) ?? 0} encontrado(s)`),
  },
  buscar_cap_para_nota: {
    rotulo: "Procurou o título da nota",
    classe: "leitura",
    detalhe: (e, s) =>
      juntar(txt(e.cnpj), brlStr(num(e.valor)), `${num(s.candidatos) ?? 0} candidato(s)`, txt(s.criterio)),
  },
  ler_documento_email: {
    rotulo: "Leu documento do e-mail",
    classe: "leitura",
    detalhe: (e, s) =>
      juntar(txt(e.nome_anexo), num(s.caracteres_extraidos) != null
        ? `${num(s.caracteres_extraidos)} caracteres` : ""),
  },
  listar_emails_novos: {
    rotulo: "Olhou a caixa de entrada",
    classe: "leitura",
    detalhe: (_e, s) => `${num(s.encontrados) ?? 0} e-mail(s)`,
  },
  listar_vencimentos: {
    rotulo: "Listou vencimentos",
    classe: "leitura",
    detalhe: (e, s) =>
      juntar(e.dias ? `${txt(e.dias)} dia(s) à frente` : "", `${num(s.caps) ?? 0} título(s)`),
  },
  listar_lancamentos_cartao: {
    rotulo: "Listou lançamentos do cartão",
    classe: "leitura",
    detalhe: (_e, s) => `${num(s.encontrados) ?? 0} lançamento(s)`,
  },
  listar_notas_pendentes_entrada: {
    rotulo: "Listou notas pendentes de entrada",
    classe: "leitura",
    detalhe: (_e, s) => `${num(s.notas) ?? 0} nota(s)`,
  },
  gasto_por_categoria: {
    rotulo: "Somou o gasto por categoria",
    classe: "leitura",
    /* O `total_pago` daqui é RESPOSTA DE CONSULTA, não dinheiro que ela moveu.
       É por isso que esta tarefa não tem `valor`: somá-la ao "valor lançado"
       diria que a agente pagou dois milhões e setecentos mil reais num mês. */
    detalhe: (e, s) =>
      juntar(txt(e.categoria) || "todas as categorias",
        `${num(s.titulos) ?? 0} título(s)`, `pago ${brlStr(num(s.total_pago))}`),
  },
  agenda_do_dia: {
    rotulo: "Conferiu a agenda do dia",
    classe: "leitura",
    detalhe: (_e, s) =>
      juntar(`${num(s.vence_hoje) ?? 0} vencem hoje`, `${num(s.atrasados) ?? 0} atrasado(s)`,
        `${num(s.excecoes) ?? 0} exceção(ões)`),
  },
  conciliar_nfse_periodo: {
    rotulo: "Conciliou NFS-e do período",
    classe: "leitura",
    detalhe: (e, s) =>
      juntar(`${txt(e.data_de)}–${txt(e.data_ate)}`, `${num(s.vincular) ?? 0} a vincular`,
        `${num(s.sem_xml) ?? 0} sem XML`),
  },
};

/** O rótulo de uma tarefa que o dicionário não conhece: `criar_conta` → "Criar conta". */
export function rotuloCru(tarefa: string): string {
  const limpo = txt(tarefa).replace(/_/g, " ").trim();
  return limpo ? limpo.charAt(0).toUpperCase() + limpo.slice(1) : "(sem tarefa)";
}

export function verbete(tarefa: string): Verbete | null {
  return TAREFAS[tarefa] ?? null;
}

export function rotuloDe(e: Execucao): string {
  return verbete(e.tarefa)?.rotulo ?? rotuloCru(e.tarefa);
}

export function classeDe(e: Execucao): Classe {
  const v = verbete(e.tarefa);
  if (!v) return "desconhecida";
  return v.classeDe ? v.classeDe(obj(e.entrada), obj(e.saida)) : v.classe;
}

export function detalheDe(e: Execucao, nome: NomeDe = () => null): string {
  const v = verbete(e.tarefa);
  if (!v?.detalhe) return "";
  try {
    return v.detalhe(obj(e.entrada), obj(e.saida), nome).trim();
  } catch {
    /* JSON com formato inesperado não pode derrubar a linha da trilha: sem o
       detalhe ainda se lê a hora, a tarefa e o resultado, que é o essencial. */
    return "";
  }
}

/**
 * O dinheiro que ESTA ação lançou — não o que ela consultou.
 *
 * Só quatro tarefas têm valor, e todas as quatro escrevem em algum lugar. É o que
 * permite dizer "lançou 30 contas somando R$ X" sem que a soma engorde com o
 * resultado de uma consulta de gasto por categoria.
 */
export function valorLancado(e: Execucao): number | null {
  const v = verbete(e.tarefa);
  if (!v?.valor) return null;
  if (e.resultado !== "executado") return null; // o que falhou não lançou nada
  try {
    return v.valor(obj(e.entrada), obj(e.saida));
  } catch {
    return null;
  }
}

/** O texto da correção humana, quando alguém carimbou a linha. */
export function textoCorrecao(e: Execucao): string {
  return txt(obj(e.correcao).texto).trim();
}

/* -------------------------------------------------------------- o resumo */

export type LinhaTarefa = {
  tarefa: string;
  rotulo: string;
  classe: Classe;
  n: number;
  falhas: number;
  valor: number;
};

export type LinhaDia = { dia: string; n: number; escritas: number; falhas: number };

export type Resumo = {
  total: number;
  escritas: number;
  leituras: number;
  desconhecidas: number;
  executadas: number;
  propostas: number;
  escaladas: number;
  falhas: number;
  corrigidas: number;
  /** Contas a pagar e obrigações que ela de fato lançou no período. */
  lancamentos: { n: number; valor: number };
  emTeste: number;
  emProducao: number;
  porTarefa: LinhaTarefa[];
  porDia: LinhaDia[];
  primeira: string | null;
  ultima: string | null;
};

const RESUMO_VAZIO: Resumo = {
  total: 0, escritas: 0, leituras: 0, desconhecidas: 0,
  executadas: 0, propostas: 0, escaladas: 0, falhas: 0, corrigidas: 0,
  lancamentos: { n: 0, valor: 0 },
  emTeste: 0, emProducao: 0,
  porTarefa: [], porDia: [], primeira: null, ultima: null,
};

export function resumir(execucoes: Execucao[]): Resumo {
  const lista = execucoes ?? [];
  if (!lista.length) return { ...RESUMO_VAZIO, lancamentos: { n: 0, valor: 0 }, porTarefa: [], porDia: [] };

  const r: Resumo = {
    ...RESUMO_VAZIO,
    lancamentos: { n: 0, valor: 0 },
    porTarefa: [],
    porDia: [],
  };

  const tarefas = new Map<string, LinhaTarefa>();
  const dias = new Map<string, LinhaDia>();

  for (const e of lista) {
    const classe = classeDe(e);
    const falhou = e.resultado === "falhou";

    r.total++;
    if (classe === "escrita") r.escritas++;
    else if (classe === "leitura") r.leituras++;
    else r.desconhecidas++;

    if (e.resultado === "executado") r.executadas++;
    else if (e.resultado === "proposto") r.propostas++;
    else if (e.resultado === "escalado") r.escaladas++;
    else if (falhou) r.falhas++;

    if (e.corrigido_por_humano) r.corrigidas++;
    if (modoDe(e) === "teste") r.emTeste++; else r.emProducao++;

    const valor = valorLancado(e);
    if (valor != null) { r.lancamentos.n++; r.lancamentos.valor += valor; }

    const chave = e.tarefa || "(sem tarefa)";
    const linha = tarefas.get(chave) ?? {
      tarefa: chave, rotulo: rotuloDe(e), classe, n: 0, falhas: 0, valor: 0,
    };
    linha.n++;
    if (falhou) linha.falhas++;
    if (valor != null) linha.valor += valor;
    tarefas.set(chave, linha);

    const dia = diaLocal(e.executado_em);
    const ld = dias.get(dia) ?? { dia, n: 0, escritas: 0, falhas: 0 };
    ld.n++;
    if (classe === "escrita") ld.escritas++;
    if (falhou) ld.falhas++;
    dias.set(dia, ld);

    if (!r.primeira || e.executado_em < r.primeira) r.primeira = e.executado_em;
    if (!r.ultima || e.executado_em > r.ultima) r.ultima = e.executado_em;
  }

  /* Escrita antes de leitura, e dentro de cada bloco a mais frequente na frente:
     quem abre o relatório quer ver o que ela MUDOU no topo. */
  const peso: Record<Classe, number> = { escrita: 0, desconhecida: 1, leitura: 2 };
  r.porTarefa = [...tarefas.values()].sort(
    (a, b) => peso[a.classe] - peso[b.classe] || b.n - a.n || a.rotulo.localeCompare(b.rotulo, "pt-BR"),
  );
  r.porDia = [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia));

  return r;
}

/* --------------------------------------------------------- as exceções */

export type ResumoExcecoes = {
  abertas: number;
  vencidas: number;
  resolvidasNoPeriodo: number;
  porTipo: { tipo: string; n: number }[];
};

/** "fornecedor_nao_liberado" → "Fornecedor não liberado" não dá: o banco não tem acento. */
export const TIPO_EXCECAO: Record<string, string> = {
  fornecedor_nao_liberado: "Fornecedor não liberado",
  fornecedor_desconhecido: "Fornecedor desconhecido",
  anomalia_historico: "Fora do padrão histórico",
  anomalia_valor: "Valor fora do padrão",
  sem_dado_bancario: "Fornecedor sem dado bancário",
  categoria_incerta: "Categoria incerta",
  dados_incompletos: "Dados incompletos",
  dados_insuficientes: "Dados insuficientes",
  fixo_do_calendario_sem_cap: "Fixo do calendário sem título",
  vencimento_ausente: "Vencimento ausente",
  nota_fiscal_sem_vencimento: "Nota fiscal sem vencimento",
  falha_integracao_omie: "Falha de integração com o Omie",
  erro_integracao: "Erro de integração",
  integracao_fornecedor: "Integração do fornecedor",
  forma_pagamento_indefinida: "Forma de pagamento indefinida",
  vinculo_cartao_nao_encontrado: "Vínculo de cartão não encontrado",
  possivel_duplicidade: "Possível duplicidade",
  falha_leitura_documento: "Falha ao ler o documento",
};

export const rotuloExcecao = (tipo: string): string =>
  TIPO_EXCECAO[tipo] ?? rotuloCru(tipo);

export const excecaoAberta = (x: Excecao): boolean =>
  x.status === "aberta" || x.status === "em_analise";

export function excecaoVencida(x: Excecao, agora: Date = new Date()): boolean {
  return excecaoAberta(x) && !!x.vence_em && new Date(x.vence_em) < agora;
}

export function resumirExcecoes(
  excecoes: Excecao[],
  periodo?: { de: Date; ate: Date },
  agora: Date = new Date(),
): ResumoExcecoes {
  const lista = excecoes ?? [];
  const tipos = new Map<string, number>();
  let abertas = 0, vencidas = 0, resolvidas = 0;

  for (const x of lista) {
    if (excecaoAberta(x)) {
      abertas++;
      if (excecaoVencida(x, agora)) vencidas++;
      tipos.set(x.tipo, (tipos.get(x.tipo) ?? 0) + 1);
    } else if (x.resolvido_em && periodo) {
      const q = new Date(x.resolvido_em);
      if (q >= periodo.de && q <= periodo.ate) resolvidas++;
    }
  }

  return {
    abertas,
    vencidas,
    resolvidasNoPeriodo: resolvidas,
    porTipo: [...tipos.entries()]
      .map(([tipo, n]) => ({ tipo, n }))
      .sort((a, b) => b.n - a.n || a.tipo.localeCompare(b.tipo, "pt-BR")),
  };
}

/* ---------------------------------------------------------- o período */

export type Atalho = "ontem" | "hoje" | "7dias" | "mes" | "mes_passado" | "personalizado";

export type Periodo = { de: Date; ate: Date; rotulo: string };

const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const fimDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const somarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const DIA_MES = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Os atalhos do seletor, sempre em dias INTEIROS do fuso de quem lê.
 *
 * "7 dias" é ontem-menos-seis até ontem — sete dias fechados, sem o de hoje pela
 * metade. Misturar um dia em curso com seis completos faz a média do relatório
 * mentir para baixo toda manhã.
 */
export function periodoDe(atalho: Atalho, hoje: Date = new Date()): Periodo {
  const ontem = somarDias(hoje, -1);
  switch (atalho) {
    case "hoje":
      return { de: inicioDoDia(hoje), ate: fimDoDia(hoje), rotulo: `Hoje · ${DIA_MES(hoje)}` };
    case "ontem":
      return { de: inicioDoDia(ontem), ate: fimDoDia(ontem), rotulo: `Ontem · ${DIA_MES(ontem)}` };
    case "7dias": {
      const de = somarDias(ontem, -6);
      return { de: inicioDoDia(de), ate: fimDoDia(ontem), rotulo: `7 dias · ${DIA_MES(de)} a ${DIA_MES(ontem)}` };
    }
    case "mes_passado": {
      const de = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const ate = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      return { de: inicioDoDia(de), ate: fimDoDia(ate), rotulo: `${DIA_MES(de)} a ${DIA_MES(ate)}` };
    }
    case "mes":
    default: {
      const de = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      return { de: inicioDoDia(de), ate: fimDoDia(hoje), rotulo: `Este mês · ${DIA_MES(de)} a ${DIA_MES(hoje)}` };
    }
  }
}

/** "2026-09-01" (do `<input type="date">`) → o período fechado desses dois dias. */
export function periodoManual(de: string, ate: string): Periodo | null {
  const a = de?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const b = ate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!a || !b) return null;
  const d1 = new Date(+a[1], +a[2] - 1, +a[3]);
  const d2 = new Date(+b[1], +b[2] - 1, +b[3]);
  if (d2 < d1) return periodoManual(ate, de);
  return { de: inicioDoDia(d1), ate: fimDoDia(d2), rotulo: `${DIA_MES(d1)} a ${DIA_MES(d2)}` };
}

/** Nome de arquivo do relatório: `thetys-2026-09-01_2026-09-02`. */
export function nomeDoArquivo(p: Periodo): string {
  return `thetys-${diaLocal(p.de)}_${diaLocal(p.ate)}`;
}
