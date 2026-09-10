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
 *
 * TRÊS CAMADAS DE TEXTO, E CADA UMA RESPONDE OUTRA PERGUNTA. O `rotulo` diz O QUE
 * foi ("Consultou fornecedor"); o `detalhe` é telegráfico e serve para conferir
 * ("36.977.317/0001-20 · existe no Omie"); a `narrativa` é a frase que um analista
 * escreveria, com o propósito e o desfecho juntos ("Antes de lançar, conferiu quem
 * é o fornecedor da nota: achou no Omie e ele já tem regra na Biblioteca"). E o
 * `porQue` é fixo por tarefa — explica o PAPEL do passo na rotina, não esta linha.
 *
 * TUDO ISSO É ESCRITO À MÃO, DE PROPÓSITO. Mandar cada linha para um modelo
 * redigir custaria uma ida ao modelo por linha de trilha, para descrever um JSON
 * de cinco campos que já sabemos ler — e o painel existe justamente para mostrar
 * quanto custa dar um passo a mais. Frase determinística é grátis, instantânea,
 * igual toda vez, e não inventa o que o JSON não disse.
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
  /**
   * Por que este passo existe na rotina. Texto FIXO: não fala desta linha, fala
   * do papel da tarefa. É o que responde "para que serve consultar fornecedor?"
   * sem repetir a mesma explicação nas 101 vezes em que ela consultou um.
   */
  porQue: string;
  /** A frase desta linha: propósito e desfecho juntos, como um analista contaria. */
  narrativa?: (e: Obj, s: Obj, nome: NomeDe, x: Execucao) => string;
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

/* ----------------------------------------------- pecinhas de redação */

/**
 * Monta a frase a partir de pedaços, descartando os vazios.
 *
 * Existe porque quase todo campo do JSON pode faltar: `nome` vem nulo, `categoria`
 * não vem, `codigo_omie` só aparece quando deu certo. Concatenar na mão daria
 * "Lançou  para  com vencimento ." toda vez que um pedaço sumisse. Aqui o pedaço
 * ausente simplesmente não entra, e a pontuação encostada sobra limpa.
 */
const frase = (...partes: (string | false | null | undefined)[]): string => {
  const texto = partes
    .filter(Boolean)
    .map((p) => String(p).trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/\(\s+/g, "(")
    /* Contração de preposição com artigo. O pedaço que vem do JSON já traz o
       artigo ("o CNPJ 17990627000130", "o fornecedor abcdef12") porque nem sempre
       se sabe qual preposição virá antes dele — então a costura sai "de o CNPJ" e
       é aqui que vira "do CNPJ". Sem isto, metade das frases de fornecedor sai
       com erro de português. */
    .replace(/\bde ([oa]s?)\b/g, (_m, art: string) => `d${art}`)
    .replace(/\bem ([oa]s?)\b/g, (_m, art: string) => `n${art}`)
    .replace(/\bpor ([oa]s?)\b/g, (_m, art: string) => `pel${art}`)
    /* Aspas de texto de gente ("Fornecedor conferido e liberado.") já podem vir
       com ponto dentro — o ponto de fora dobraria. */
    .replace(/([.!?])"\./g, '$1"')
    .trim();
  if (!texto) return "";
  /* A aspa de fecho conta como fim de frase — senão o `."` que acabou de ser
     limpo ganha o ponto de volta e vira `.".` outra vez. */
  return /[.!?…]["»)]?$/.test(texto) ? texto : `${texto}.`;
};

/** "1 título" / "7 títulos" — plural escrito, não "título(s)". */
const qtd = (n: number | null | undefined, um: string, varios: string): string => {
  const v = Number(n ?? 0);
  return `${v.toLocaleString("pt-BR")} ${v === 1 ? um : varios}`;
};

/** "2026-09-04" → "04/09/2026". O que já vem dd/mm/aaaa passa direto. */
const dataBr = (v: unknown): string => {
  const t = txt(v).trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : t;
};

/**
 * Quem é a contraparte desta linha, no melhor nome disponível.
 *
 * A trilha identifica fornecedor de quatro jeitos diferentes conforme a tarefa:
 * `fornecedor_id` (às vezes uuid da Biblioteca, às vezes o id do Omie), `nome`,
 * `razao_social` ou só o CNPJ. Cair no "fornecedor abcdef12" é o último recurso —
 * antes disso vale qualquer nome escrito que exista no JSON.
 */
const SEM_NOME = "o fornecedor ";

const quemE = (e: Obj, s: Obj, nome: NomeDe): string => {
  const porId = forn(e, nome);
  if (porId && !porId.startsWith("fornecedor ")) return porId;
  const escrito = txt(e.nome) || txt(e.razao_social) || txt(s.nome);
  if (escrito) return escrito;
  const doc = txt(e.cnpj) || txt(e.documento_norm);
  if (doc) return `o CNPJ ${doc}`;
  /* Último recurso: o id abreviado, com artigo, para a preposição contrair certo
     em "para o fornecedor abcdef12" / "do fornecedor abcdef12". */
  return porId ? `${SEM_NOME}${porId.replace(/^fornecedor /, "")}` : "";
};

/** O motivo da recusa em português, quando o runtime carimba um. */
const motivoDaFalha = (s: Obj): string => {
  const motivo = txt(s.motivo);
  if (motivo === "api_bloqueada") {
    return "ela mesma segurou a mão — foram três erros seguidos do Omie no último minuto, "
      + "e insistir bloquearia a chave de integração por 30 minutos";
  }
  if (motivo === "erro_omie") return "o Omie recusou o pedido";
  return motivo ? `motivo registrado: ${motivo}` : "o Omie recusou o pedido";
};

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
    porQue:
      "O lançamento de verdade: cria o título no contas a pagar do Omie, com fornecedor, "
      + "valor, vencimento e categoria. Tudo o que vem antes na rotina existe para dar "
      + "confiança suficiente para chegar aqui.",
    detalhe: (e, s, nome) =>
      juntar(forn(e, nome), brlStr(num(e.valor)), e.vencimento ? `venc. ${txt(e.vencimento)}` : "",
        s.codigo_omie ? `Omie ${txt(s.codigo_omie)}` : ""),
    narrativa: (e, s, nome, x) => {
      const alvo = frase(
        "uma conta a pagar de", brlStr(num(e.valor)),
        quemE(e, s, nome) && `para ${quemE(e, s, nome)}`,
        txt(e.vencimento) && `com vencimento em ${dataBr(e.vencimento)}`,
        txt(e.categoria) && `na categoria ${txt(e.categoria)}`,
      ).replace(/\.$/, "");

      if (x.resultado === "escalado") {
        const existentes = Array.isArray(s.existentes) ? s.existentes : [];
        return frase(
          "Ia lançar", `${alvo},`,
          s.bloqueado_por_duplicidade === true
            ? `mas travou no freio de duplicidade: já havia ${qtd(existentes.length, "título igual", "títulos iguais")} no Omie`
              + `${existentes.length ? ` (${existentes.join(" e ")})` : ""}`
            : "mas parou antes de escrever",
          "— passou a decisão para uma pessoa.",
        );
      }
      if (x.resultado === "falhou") {
        return frase("Tentou lançar", `${alvo},`, "e não conseguiu:", `${motivoDaFalha(s)}.`,
          "Nada foi criado no Omie.");
      }
      return frase(
        "Lançou no Omie", `${alvo}.`,
        txt(s.codigo_omie)
          && `O título nasceu ${txt(s.status) ? `com status ${txt(s.status)} ` : ""}sob o código ${txt(s.codigo_omie)}`,
      );
    },
    valor: (e) => num(e.valor),
  },
  editar_lancamento_omie: {
    rotulo: "Editou lançamento no Omie",
    classe: "escrita",
    porQue:
      "Mexer num título que já existe — trocar valor ou vencimento. É a ação de maior "
      + "alcance dela no dia a dia, e a que mais aparece em rajada quando um pedido do "
      + "chat vira uma edição por título.",
    detalhe: (e, s) =>
      juntar(
        e.codigo_lancamento ? `título ${txt(e.codigo_lancamento)}` : "",
        num(s.valor_anterior) != null && num(e.novo_valor) != null
          ? `${brlStr(num(s.valor_anterior))} → ${brlStr(num(e.novo_valor))}` : "",
        txt(s.vencimento_anterior) && txt(e.novo_vencimento)
          ? `venc. ${txt(s.vencimento_anterior)} → ${txt(e.novo_vencimento)}` : "",
      ),
    narrativa: (e, s) => {
      const alvo = txt(e.codigo_lancamento) ? `o título ${txt(e.codigo_lancamento)}` : "um título";
      const mudancas: string[] = [];
      let pediuAlgo = false;
      let mudouAlgo = false;

      if (num(e.novo_valor) != null) {
        pediuAlgo = true;
        const antes = num(s.valor_anterior);
        if (antes != null && antes !== num(e.novo_valor)) {
          mudouAlgo = true;
          mudancas.push(`o valor de ${brlStr(antes)} para ${brlStr(num(e.novo_valor))}`);
        } else {
          mudancas.push(`o valor pedido, ${brlStr(num(e.novo_valor))}, já era o que estava lá`);
        }
      }
      if (txt(e.novo_vencimento)) {
        pediuAlgo = true;
        const antes = txt(s.vencimento_anterior);
        if (antes && antes !== txt(e.novo_vencimento)) {
          mudouAlgo = true;
          mudancas.push(`o vencimento de ${dataBr(antes)} para ${dataBr(e.novo_vencimento)}`);
        } else {
          mudancas.push(`o vencimento pedido, ${dataBr(e.novo_vencimento)}, já era o que estava lá`);
        }
      }

      return frase(
        pediuAlgo && !mudouAlgo ? "Abriu" : "Editou", alvo, "no Omie:",
        mudancas.length ? `${mudancas.join(" e ")}.` : "sem pedir mudança de valor nem de vencimento.",
        pediuAlgo && !mudouAlgo && "A edição foi ao Omie e não mudou nada — passo que custou uma ida ao modelo à toa.",
        txt(e.origem) === "comando_direto_chat"
          && "Não foi rotina dela: veio de um pedido direto no chat.",
      );
    },
    valor: (e) => num(e.novo_valor),
  },
  excluir_lancamento_omie: {
    rotulo: "Excluiu lançamento do Omie",
    classe: "escrita",
    porQue:
      "Apagar um título do contas a pagar. É a ação mais destrutiva do catálogo dela e "
      + "por isso costuma parar em escalada em vez de seguir sozinha.",
    detalhe: (e, s) =>
      juntar(e.codigo_lancamento ? `título ${txt(e.codigo_lancamento)}` : "", txt(s.motivo)),
    narrativa: (e, s, _nome, x) => {
      const alvo = txt(e.codigo_lancamento) ? `o título ${txt(e.codigo_lancamento)}` : "um título";
      if (x.resultado === "executado") return frase("Apagou", alvo, "do contas a pagar do Omie.");
      return frase(
        "Ia apagar", alvo, "do Omie e parou antes:",
        txt(s.motivo) ? `${txt(s.motivo)}.` : "não seguiu adiante.",
      );
    },
  },
  dar_entrada_nota: {
    rotulo: "Deu entrada na nota",
    classe: "escrita",
    porQue:
      "Dar entrada é mover a nota de etapa no Omie (de recebida para conferida) — o passo "
      + "que a contabilidade espera para poder fechar o mês.",
    detalhe: (e, s) =>
      juntar(e.cod_titulo ? `título ${txt(e.cod_titulo)}` : "",
        s.etapa_alterada === true ? `etapa ${txt(e.nova_etapa)}` : "etapa não mudou",
        txt(s.erro_etapa)),
    narrativa: (e, s) => frase(
      s.etapa_alterada === true ? "Moveu" : "Tentou mover",
      txt(e.cod_titulo) ? `o título ${txt(e.cod_titulo)}` : "a nota",
      txt(e.nova_etapa) && `para a etapa ${txt(e.nova_etapa)}`, "no Omie.",
      s.etapa_alterada === true ? "" : txt(s.erro_etapa) ? `O Omie recusou: ${txt(s.erro_etapa)}` : "A etapa não mudou.",
      txt(s.aviso_anexo),
    ),
  },
  vincular_nota_ao_cap: {
    rotulo: "Vinculou a nota ao título",
    classe: "escrita",
    porQue:
      "Carimba a chave da NF-e dentro do título do Omie. É o que amarra a nota ao "
      + "pagamento, para que depois se saiba qual documento sustenta cada saída.",
    detalhe: (e, s) =>
      juntar(e.cod_titulo ? `título ${txt(e.cod_titulo)}` : "",
        s.carimbo === true ? "chave carimbada" : "sem carimbo", txt(s.erro_carimbo)),
    narrativa: (e, s) => frase(
      s.carimbo === true ? "Carimbou" : "Tentou carimbar",
      "a chave da nota fiscal dentro",
      txt(e.cod_titulo) ? `do título ${txt(e.cod_titulo)}` : "do título", "no Omie.",
      s.carimbo === true ? "" : txt(s.erro_carimbo) ? `Não colou: ${txt(s.erro_carimbo)}` : "O carimbo não pegou.",
      txt(s.aviso_anexo),
    ),
  },
  anexar_documento: {
    rotulo: "Anexou documento ao título",
    classe: "escrita",
    porQue:
      "Título sem documento é título cego. Depois de lançar, ela pendura no título do Omie "
      + "o boleto e a nota que vieram junto — é o que permite conferir o pagamento depois.",
    detalhe: (e, s) => {
      const anexados = Array.isArray(s.anexados) ? s.anexados.length : 0;
      const falhas = Array.isArray(s.falhas) ? s.falhas.length : 0;
      return juntar(
        e.codigo_lancamento ? `título ${txt(e.codigo_lancamento)}` : "",
        `${anexados} anexo${anexados === 1 ? "" : "s"}`,
        falhas ? `${falhas} falharam` : "",
      );
    },
    narrativa: (e, s, _nome, x) => {
      const anexados = Array.isArray(s.anexados) ? s.anexados : [];
      const falhas = Array.isArray(s.falhas) ? s.falhas.length : 0;
      const pedidos = Array.isArray(e.arquivos) ? (e.arquivos as unknown[]).map(txt)
        : txt(e.nome_arquivo) ? [txt(e.nome_arquivo)] : [];
      const daOnde = txt(e.origem) === "email" ? "que vieram no e-mail"
        : txt(e.origem) === "caminho" ? "de um arquivo salvo" : "";
      const alvo = txt(e.codigo_lancamento) ? `no título ${txt(e.codigo_lancamento)}` : "no título";

      if (x.resultado !== "executado" || (!anexados.length && pedidos.length)) {
        return frase(
          "Tentou pendurar", pedidos.length ? qtd(pedidos.length, "arquivo", "arquivos") : "o documento",
          daOnde, alvo, "e o anexo não subiu.",
        );
      }
      return frase(
        "Pendurou", qtd(anexados.length, "arquivo", "arquivos"), daOnde, `${alvo}:`,
        pedidos.slice(0, 2).map((n) => `"${n}"`).join(" e ")
          + (pedidos.length > 2 ? ` e mais ${pedidos.length - 2}` : ""),
        falhas ? `— ${qtd(falhas, "arquivo falhou", "arquivos falharam")}` : "",
      );
    },
  },
  conferir_fixos_do_dia: {
    rotulo: "Conferiu os fixos do dia",
    classe: "escrita",
    porQue:
      "É como ela abre o dia: percorre o calendário de contas fixas (aluguel, contabilidade, "
      + "assinaturas) e vê o que já deveria ter virado título no Omie. Com `lancar: false` ela "
      + "só confere; com `lancar: true` ela cria o que falta.",
    /* `lancar: false` é ensaio: ela olha o calendário e não cria nada. Contar
       isso como escrita infla o relatório com trabalho que não aconteceu. */
    classeDe: (e) => (e.lancar === true ? "escrita" : "leitura"),
    detalhe: (e, s) =>
      juntar(txt(e.data), `${num(s.criadas) ?? 0} criada(s)`, `${num(s.pendentes) ?? 0} pendente(s)`),
    narrativa: (e, s) => {
      const dia = dataBr(e.data);
      const pendentes = num(s.pendentes) ?? 0;
      const criadas = num(s.criadas) ?? 0;
      const jaLancado = num(s.ja_lancado) ?? 0;

      if (e.lancar === true) {
        return frase(
          "Percorreu o calendário de contas fixas de", `${dia}`, "e lançou o que faltava:",
          `${qtd(criadas, "conta criada", "contas criadas")}`,
          jaLancado ? `, ${qtd(jaLancado, "já estava lançada", "já estavam lançadas")}` : "",
          pendentes ? `e ${qtd(pendentes, "ainda pendente", "ainda pendentes")}` : "e nada ficou pendente",
        );
      }
      return frase(
        "Conferência de rotina do calendário de contas fixas de", `${dia},`,
        "no modo só-olhar (veio com `lancar: false`), então não criou nada.",
        pendentes
          ? `Achou ${qtd(pendentes, "fixo que ainda não virou título", "fixos que ainda não viraram título")} no Omie.`
          : "Nenhum fixo em aberto.",
      );
    },
  },
  registrar_obrigacao: {
    rotulo: "Registrou obrigação",
    classe: "escrita",
    porQue:
      "Obrigação é o compromisso que já se conhece antes da nota chegar — um contrato "
      + "assinado, uma parcela combinada. Registrar faz o valor aparecer na projeção de "
      + "caixa em vez de surgir de surpresa no dia do vencimento.",
    detalhe: (e, s) => juntar(brlStr(num(e.valor)), txt(e.vencimento), txt(s.estado)),
    narrativa: (e, s, nome) => frase(
      "Registrou um compromisso de", brlStr(num(e.valor)),
      quemE(e, s, nome) && `com ${quemE(e, s, nome)}`,
      txt(e.vencimento) && `para ${dataBr(e.vencimento)}`,
      "— assim ele já entra na projeção de caixa antes de a nota chegar.",
      txt(s.estado) === "aguardando_nota" ? "Está aguardando a nota."
        : txt(s.estado) && `Estado: ${txt(s.estado)}.`,
    ),
    valor: (e) => num(e.valor),
  },

  /* --- cadastro de fornecedor: muda a Biblioteca e o Omie --- */
  cadastrar_fornecedor_do_documento: {
    rotulo: "Cadastrou fornecedor",
    classe: "escrita",
    porQue:
      "Quando a nota chega de alguém que não existe em lugar nenhum, ela abre a ficha a "
      + "partir do próprio documento — razão social e CNPJ conferidos na Receita.",
    detalhe: (e, s) => juntar(txt(e.razao_social), txt(e.cnpj), txt(s.situacao_cadastral)),
    narrativa: (e, s) => frase(
      "Abriu a ficha de", txt(e.razao_social) || `CNPJ ${txt(e.cnpj)}`,
      txt(e.razao_social) && txt(e.cnpj) && `(CNPJ ${txt(e.cnpj)})`,
      "a partir do documento que chegou",
      txt(e.origem_do_nome) === "receita" ? ", com o nome conferido na Receita Federal" : "",
      ".",
      txt(s.situacao_cadastral) && `Situação cadastral: ${txt(s.situacao_cadastral)}.`,
      txt(s.omie_id) && `No Omie ficou com o código ${txt(s.omie_id)}.`,
    ),
  },
  criar_fornecedor_omie: {
    rotulo: "Criou fornecedor no Omie",
    classe: "escrita",
    porQue:
      "Cria a ficha do fornecedor dentro do Omie. Sem ela não há para quem lançar o "
      + "título — é pré-requisito do contas a pagar, não um cadastro solto.",
    detalhe: (e, s) => juntar(txt(e.razao_social), txt(e.cnpj), txt(s.omie_id) && `Omie ${txt(s.omie_id)}`),
    narrativa: (e, s, _nome, x) => {
      const quem = frase(txt(e.razao_social) || `o CNPJ ${txt(e.cnpj)}`,
        txt(e.razao_social) && txt(e.cnpj) && `(CNPJ ${txt(e.cnpj)})`).replace(/\.$/, "");
      if (x.resultado !== "executado") {
        return frase("Tentou criar no Omie a ficha de", `${quem},`, "e o Omie recusou o cadastro — "
          + "sem ficha, não há como lançar título para ele.");
      }
      return frase("Criou no Omie a ficha de", `${quem}`,
        txt(s.omie_id) && `, que ficou com o código ${txt(s.omie_id)}`);
    },
  },
  espelhar_fornecedor_do_omie: {
    rotulo: "Espelhou fornecedor do Omie",
    classe: "escrita",
    porQue:
      "O caminho inverso do cadastro: a ficha já existe no Omie e ela a copia para a "
      + "Biblioteca daqui, que é onde moram apelido, categoria e regra de governança.",
    detalhe: (_e, s) => txt(s.nome),
    narrativa: (e, s) => frase(
      "Trouxe do Omie para a Biblioteca daqui a ficha de", txt(s.nome) || "um fornecedor",
      txt(e.cnpj) && `(CNPJ ${txt(e.cnpj)})`,
      "— é aqui que ele ganha apelido, categoria e regra.",
    ),
  },
  cadastrar_dado_bancario_fornecedor: {
    rotulo: "Cadastrou dado bancário",
    classe: "escrita",
    porQue:
      "Sem chave PIX ou conta cadastrada, o título até existe mas ninguém consegue pagar. "
      + "É a informação que transforma um lançamento em pagamento possível.",
    detalhe: (e, s, nome) =>
      juntar(forn(e, nome), s.chave_anterior ? "substituiu a chave anterior" : "primeira chave"),
    narrativa: (e, s, nome) => frase(
      "Gravou os dados de pagamento de", quemE(e, s, nome) || "um fornecedor", "—",
      s.chave_anterior ? "substituindo a chave que estava cadastrada" : "era a primeira chave dele",
      ".",
      txt(e.origem) === "comando_direto_chat" && "Veio de um pedido direto no chat.",
    ),
  },
  liberar_fornecedor: {
    rotulo: "Liberou fornecedor",
    classe: "escrita",
    porQue:
      "Liberar é dizer que, para este fornecedor, ela pode lançar sozinha sem parar para "
      + "perguntar. É a chave que separa o que ela executa do que ela escala.",
    detalhe: (e, s) => juntar(txt(s.nome), txt(e.motivo)),
    narrativa: (e, s) => frase(
      e.liberar === false ? "Tirou a liberação de" : "Liberou",
      txt(s.nome) || "um fornecedor",
      e.liberar === false
        ? "— lançamentos dele voltam a precisar de gente."
        : "para lançamento automático — daqui em diante ela pode lançar sozinha para ele.",
      txt(e.motivo) && `Motivo registrado: "${txt(e.motivo)}".`,
    ),
  },
  ensinar_categoria: {
    rotulo: "Ensinou a categoria",
    classe: "escrita",
    porQue:
      "O caminho de volta do aprendizado: alguém confirma qual era a categoria certa e ela "
      + "grava a regra, para não perguntar de novo na próxima nota do mesmo fornecedor.",
    detalhe: (e, s) => juntar(txt(e.categoria), txt(s.acao), txt(e.observacao)),
    narrativa: (e, s) => frase(
      txt(s.acao) === "criada" ? "Aprendeu uma regra nova:" : "Atualizou a regra:",
      "para o CNPJ", txt(e.documento_norm) || "informado,", "a categoria passa a ser",
      `${txt(e.categoria)}`,
      txt(s.categoria_anterior) && `(antes era ${txt(s.categoria_anterior)})`,
      "— na próxima nota dele ela não precisa perguntar.",
      txt(e.observacao) && `${txt(e.observacao)}`,
    ),
  },
  marcar_evento_em_lote: {
    rotulo: "Marcou evento em lote",
    classe: "escrita",
    porQue:
      "Junta um conjunto de títulos sob um mesmo rótulo de evento, para que apareçam "
      + "agrupados nos relatórios em vez de espalhados.",
    detalhe: (e, s) => juntar(txt(e.titulo), txt(s.acao)),
    narrativa: (e, s) => frase(
      txt(s.acao) === "ja_existia"
        ? `Pediu a marcação do evento "${txt(e.titulo)}", que já existia — nada mudou`
        : `Criou a marcação de evento "${txt(e.titulo)}", para agrupar esses títulos no relatório`,
      ".",
      txt(e.observacao),
    ),
  },

  /* --- caixa de entrada e trilha --- */
  marcar_email_processado: {
    rotulo: "Marcou e-mail como lido",
    classe: "escrita",
    porQue:
      "O fecho do ciclo da caixa de entrada: o e-mail já virou título, então ela o marca "
      + "como tratado para não voltar a ele na varredura de amanhã.",
    detalhe: (e) => (e.uid ? `uid ${txt(e.uid)}` : ""),
    narrativa: (e, s) => frase(
      s.marcado === false ? "Tentou fechar" : "Fechou", "o e-mail",
      txt(e.uid) && `${txt(e.uid)}`, "na caixa de entrada:",
      s.marcado === false ? "a marcação não pegou e ele deve voltar na próxima varredura."
        : "já foi tratado, então não volta na próxima varredura.",
    ),
  },
  sincronizar_titulos: {
    rotulo: "Sincronizou títulos do Omie",
    classe: "escrita",
    porQue:
      "Puxa do Omie os títulos criados ou alterados nos últimos dias para o espelho local. "
      + "É o que permite às consultas dela responderem sem ir ao Omie a cada pergunta.",
    detalhe: (_e, s) =>
      juntar(`${num(s.sincronizados) ?? 0} títulos`, txt(s.desde) && `desde ${txt(s.desde)}`),
    narrativa: (_e, s) => frase(
      "Atualizou o espelho local dos títulos do Omie",
      txt(s.desde) && `de ${dataBr(s.desde)}${txt(s.ate) ? ` a ${dataBr(s.ate)}` : ""}`, ":",
      `${qtd(num(s.sincronizados), "título trazido", "títulos trazidos")}`,
      num(s.ignorados) ? `e ${qtd(num(s.ignorados), "ignorado", "ignorados")}` : "",
    ),
  },
  resolver_excecao: {
    rotulo: "Resolveu uma exceção",
    classe: "escrita",
    porQue:
      "Tira um caso da fila do humano registrando o que foi decidido. A resolução fica "
      + "escrita na exceção, e é dela que sai o aprendizado.",
    detalhe: (e, s) => juntar(txt(s.titulo), txt(e.resolucao)),
    narrativa: (e, s) => frase(
      "Fechou um caso que estava parado na fila do humano",
      txt(s.titulo) && `("${txt(s.titulo)}"`,
      txt(s.tipo) && `${txt(s.titulo) ? ", tipo" : "(tipo"} ${rotuloCru(txt(s.tipo)).toLowerCase()}`,
      (txt(s.titulo) || txt(s.tipo)) && ")", ".",
      txt(e.resolucao) && `Resolução registrada: "${txt(e.resolucao)}".`,
    ),
  },

  /* --- consultas: trabalho real, mas nada muda de lado nenhum --- */
  consultar_fornecedor: {
    rotulo: "Consultou fornecedor",
    classe: "leitura",
    porQue:
      "É o crachá na portaria. Antes de lançar qualquer coisa ela pergunta duas coisas "
      + "sobre a contraparte: existe ficha no Omie (senão não há para quem lançar) e existe "
      + "regra na Biblioteca (categoria, centro de custo, liberação). São essas duas "
      + "respostas que decidem se ela segue sozinha ou escala.",
    detalhe: (e, s) =>
      juntar(txt(e.nome) || txt(e.cnpj),
        s.existe_no_omie === true ? "existe no Omie" : "não existe no Omie",
        s.tem_governanca === true ? "com governança" : ""),
    narrativa: (e, s) => {
      const temCnpj = !!txt(e.cnpj);
      const quem = txt(e.nome) || txt(e.cnpj) || "a contraparte";
      const noOmie = s.existe_no_omie === true
        ? "tem ficha no Omie"
        : "não apareceu no Omie";
      const naCasa = s.tem_governanca === true
        ? "e a Biblioteca daqui já tem regra para ele (categoria e centro de custo definidos)"
        : "e a Biblioteca daqui também não tem regra para ele";

      return frase(
        "Conferiu quem é", `${quem}`,
        temCnpj ? `pelo CNPJ ${txt(e.cnpj)}` : "pelo nome, sem CNPJ",
        `— ${noOmie} ${naCasa}.`,
        /* A busca por nome é frágil e isso explica metade das respostas "não existe
           no Omie" da trilha: a ORION dá "não existe" procurada por "Orion" e "existe"
           procurada pelo CNPJ, minutos depois. Quem lê precisa saber disso para não
           concluir que o fornecedor não está cadastrado. */
        !temCnpj && s.existe_no_omie !== true
          && "Vale lembrar que sem CNPJ a busca é pelo nome escrito, e nome que não bate "
             + "com o cadastro não acha — não é prova de que ele não exista.",
      );
    },
  },
  consultar_cnpj_emissor: {
    rotulo: "Consultou o CNPJ do emissor",
    classe: "leitura",
    porQue:
      "Primeiro passo depois de ler o documento: descobrir de quem é o CNPJ que emitiu a "
      + "nota, antes de sair procurando essa pessoa no Omie.",
    detalhe: (e, s) => juntar(txt(e.cnpj), s.encontrado === true ? "encontrado" : "não encontrado"),
    narrativa: (e, s) => frase(
      "Perguntou de quem é o CNPJ", txt(e.cnpj) || "da nota", "que emitiu o documento:",
      s.encontrado === true
        ? "achou o cadastro."
        : "não achou cadastro nenhum, então teve de identificar o emissor por outro caminho.",
    ),
  },
  consultar_regra_categoria: {
    rotulo: "Consultou a regra de categoria",
    classe: "leitura",
    porQue:
      "A regra é o que ela já aprendeu: para este fornecedor, esta categoria e este centro "
      + "de custo. Ter regra é o que permite classificar o lançamento sem perguntar a ninguém.",
    detalhe: (e, s, nome) =>
      juntar(forn(e, nome), s.encontrada === true ? "achou regra" : "sem regra"),
    narrativa: (e, s, nome) => frase(
      "Perguntou à Biblioteca em que categoria classificar o gasto de",
      `${quemE(e, s, nome) || "um fornecedor"}:`,
      s.encontrada === true
        ? "achou regra pronta e classificou por ela, sem precisar decidir na hora."
        : "não há regra cadastrada, então a categoria teria de ser decidida na hora.",
    ),
  },
  verificar_lancamento_existente: {
    rotulo: "Checou se o lançamento já existia",
    classe: "leitura",
    porQue:
      "O freio de duplicidade. Antes de criar a conta a pagar ela procura no Omie um título "
      + "do mesmo fornecedor, mesmo valor e mesmo vencimento. Achando, não lança de novo — é "
      + "o passo que impede pagar duas vezes a mesma nota.",
    detalhe: (e, s, nome) =>
      juntar(forn(e, nome), brlStr(num(e.valor)), `${num(s.encontrados) ?? 0} encontrado(s)`),
    narrativa: (e, s, nome) => {
      const achados = num(s.encontrados) ?? 0;
      return frase(
        "Freio de duplicidade antes de lançar: procurou",
        txt(e.fonte) === "omie_ao_vivo" ? "no Omie ao vivo" : "no Omie",
        "um título",
        quemE(e, s, nome) && `de ${quemE(e, s, nome)}`,
        `de ${brlStr(num(e.valor))}`,
        txt(e.vencimento) && `com vencimento ${dataBr(e.vencimento)}`, ".",
        achados === 0
          ? "Não achou nenhum — caminho livre para lançar."
          : `Achou ${qtd(achados, "título parecido", "títulos parecidos")} — é candidato a duplicidade.`,
      );
    },
  },
  buscar_cap_para_nota: {
    rotulo: "Procurou o título da nota",
    classe: "leitura",
    porQue:
      "O caminho inverso do lançamento: a nota chegou depois, e ela procura qual título já "
      + "existente corresponde a ela, para casar os dois em vez de lançar em duplicidade.",
    detalhe: (e, s) =>
      juntar(txt(e.cnpj), brlStr(num(e.valor)), `${num(s.candidatos) ?? 0} candidato(s)`, txt(s.criterio)),
    narrativa: (e, s) => {
      const candidatos = num(s.candidatos) ?? 0;
      return frase(
        "Procurou a qual título já lançado esta nota corresponde —",
        txt(e.cnpj) && `CNPJ ${txt(e.cnpj)},`, brlStr(num(e.valor)),
        txt(e.emissao) && `, emitida em ${dataBr(e.emissao)}`, ".",
        candidatos === 0
          ? "Nenhum candidato: a nota ficou sem título para casar."
          : `${qtd(candidatos, "candidato", "candidatos")}${s.unico === true ? ", um só" : ""}`
            + `${txt(s.criterio) && txt(s.criterio) !== "nenhum" ? `, pelo critério ${txt(s.criterio)}` : ""}.`,
      );
    },
  },
  ler_documento_email: {
    rotulo: "Leu documento do e-mail",
    classe: "leitura",
    porQue:
      "É como ela lê um anexo: baixa o arquivo do e-mail e extrai o texto. É desse texto "
      + "que saem CNPJ, valor e vencimento — sem ele o resto da rotina não tem o que checar.",
    detalhe: (e, s) =>
      juntar(txt(e.nome_anexo), num(s.caracteres_extraidos) != null
        ? `${num(s.caracteres_extraidos)} caracteres` : ""),
    narrativa: (e, s) => {
      const arquivo = txt(e.nome_anexo);
      const tipo = /\.xml$/i.test(arquivo) ? "o XML"
        : /\.pdf$/i.test(arquivo) ? "o PDF"
        : /\.(png|jpe?g)$/i.test(arquivo) ? "a imagem" : "o anexo";
      const chars = num(s.caracteres_extraidos);
      const magro = chars != null && chars < 300;

      return frase(
        "Abriu", tipo, arquivo && `"${arquivo}"`,
        txt(e.uid) ? `que veio no e-mail ${txt(e.uid)}` : "que veio no e-mail", "e extraiu",
        chars != null ? `${chars.toLocaleString("pt-BR")} caracteres de texto` : "o texto", ".",
        magro
          ? "É pouquíssimo para uma nota fiscal — desse arquivo não sai CNPJ, valor nem vencimento, "
            + "então o dado teve de vir de outro anexo."
          : "É daqui que ela tira CNPJ, valor e vencimento.",
      );
    },
  },
  listar_emails_novos: {
    rotulo: "Olhou a caixa de entrada",
    classe: "leitura",
    porQue:
      "A varredura da caixa de entrada — é por aqui que o ciclo do dia começa. Tudo o que "
      + "vira título nasce de um e-mail encontrado neste passo.",
    detalhe: (_e, s) => `${num(s.encontrados) ?? 0} e-mail(s)`,
    narrativa: (e, s) => {
      const achados = num(s.encontrados) ?? 0;
      return frase(
        "Verificação de rotina da caixa de entrada",
        num(e.limite) != null && `(olhando os ${num(e.limite)} mais recentes)`, ":",
        achados === 0
          ? "não havia nada novo para tratar."
          : `${qtd(achados, "e-mail novo", "e-mails novos")} para tratar.`,
      );
    },
  },
  listar_vencimentos: {
    rotulo: "Listou vencimentos",
    classe: "leitura",
    porQue:
      "A pergunta de tesouraria mais básica: o que vence daqui a pouco e quanto isso soma. "
      + "É a leitura que antecede qualquer decisão sobre o caixa do dia.",
    detalhe: (e, s) =>
      juntar(e.dias ? `${txt(e.dias)} dia(s) à frente` : "", `${num(s.caps) ?? 0} título(s)`),
    narrativa: (e, s) => frase(
      "Levantou o que vence",
      num(e.dias) == null ? "à frente"
        : num(e.dias) === 1 ? "no próximo dia"
        : `nos próximos ${qtd(num(e.dias), "dia", "dias")}`, ":",
      `${qtd(num(s.caps), "título", "títulos")}`,
      num(s.total) ? `somando ${brlStr(num(s.total))}` : "",
      num(s.eventos) ? `, mais ${qtd(num(s.eventos), "evento de agenda", "eventos de agenda")}` : "",
    ),
  },
  listar_lancamentos_cartao: {
    rotulo: "Listou lançamentos do cartão",
    classe: "leitura",
    porQue:
      "Nem toda despesa vira conta a pagar: o que foi pago no cartão entra pela fatura. Ela "
      + "confere a lista do cartão para não lançar em duplicidade uma compra que já foi paga.",
    detalhe: (_e, s) => `${num(s.encontrados) ?? 0} lançamento(s)`,
    narrativa: (e, s) => {
      const achados = num(s.encontrados) ?? 0;
      return frase(
        "Conferiu os lançamentos de cartão",
        e.apenas_pendentes === true ? "ainda pendentes" : "(pendentes e já tratados)",
        txt(e.vencimento) && `com vencimento ${dataBr(e.vencimento)}`,
        "— é o que evita lançar de novo uma compra já paga na fatura.",
        achados === 0 ? "Nenhum lançamento na lista." : `${qtd(achados, "lançamento", "lançamentos")}.`,
      );
    },
  },
  listar_notas_pendentes_entrada: {
    rotulo: "Listou notas pendentes de entrada",
    classe: "leitura",
    porQue:
      "Mostra a fila de notas que chegaram ao Omie e ainda não tiveram entrada dada — o "
      + "trabalho acumulado que a contabilidade espera ver zerado.",
    detalhe: (_e, s) => `${num(s.notas) ?? 0} nota(s)`,
    narrativa: (e, s) => frase(
      "Levantou a fila de notas que já chegaram ao Omie e ainda não tiveram entrada dada:",
      `${qtd(num(s.notas), "nota", "notas")}`,
      num(e.pagina) != null && num(e.pagina)! > 1 ? `(página ${num(e.pagina)})` : "",
    ),
  },
  gasto_por_categoria: {
    rotulo: "Somou o gasto por categoria",
    classe: "leitura",
    porQue:
      "Uma pergunta de relatório: quanto foi para determinada categoria num período. "
      + "Responder isso não move dinheiro nenhum — o total que sai daqui é resposta, não "
      + "pagamento, e por isso nunca entra na soma do que ela lançou.",
    /* O `total_pago` daqui é RESPOSTA DE CONSULTA, não dinheiro que ela moveu.
       É por isso que esta tarefa não tem `valor`: somá-la ao "valor lançado"
       diria que a agente pagou dois milhões e setecentos mil reais num mês. */
    detalhe: (e, s) =>
      juntar(txt(e.categoria) || "todas as categorias",
        `${num(s.titulos) ?? 0} título(s)`, `pago ${brlStr(num(s.total_pago))}`),
    narrativa: (e, s) => frase(
      "Somou o gasto",
      txt(e.categoria) ? `da categoria "${txt(e.categoria)}"` : "de todas as categorias",
      txt(e.de) && `entre ${dataBr(e.de)} e ${dataBr(e.ate)}`, ":",
      `${qtd(num(s.titulos), "título", "títulos")},`,
      `${brlStr(num(s.total_pago))} já pago`,
      num(s.total_em_aberto) ? `e ${brlStr(num(s.total_em_aberto))} em aberto` : "", ".",
      "É resposta de consulta — ela não moveu esse dinheiro.",
    ),
  },
  agenda_do_dia: {
    rotulo: "Conferiu a agenda do dia",
    classe: "leitura",
    porQue:
      "A foto da tesouraria no começo do dia: o que vence hoje, o que já passou do prazo e "
      + "quantos casos estão parados esperando decisão de uma pessoa.",
    detalhe: (_e, s) =>
      juntar(`${num(s.vence_hoje) ?? 0} vencem hoje`, `${num(s.atrasados) ?? 0} atrasado(s)`,
        `${num(s.excecoes) ?? 0} exceção(ões)`),
    narrativa: (e, s) => frase(
      "Abriu a agenda da tesouraria",
      num(e.dias_a_frente) != null && `(olhando ${qtd(num(e.dias_a_frente), "dia", "dias")} à frente)`, ":",
      `${qtd(num(s.vence_hoje), "título vence hoje", "títulos vencem hoje")},`,
      `${qtd(num(s.atrasados), "está em atraso", "estão em atraso")}`,
      `e ${qtd(num(s.excecoes), "caso está parado", "casos estão parados")} na fila do humano`,
    ),
  },
  conciliar_nfse_periodo: {
    rotulo: "Conciliou NFS-e do período",
    classe: "leitura",
    porQue:
      "Passa o período inteiro conferindo quais notas de serviço já estão ligadas ao seu "
      + "título e quais ainda não — é o levantamento que precede o trabalho de casar as duas pontas.",
    detalhe: (e, s) =>
      juntar(`${txt(e.data_de)}–${txt(e.data_ate)}`, `${num(s.vincular) ?? 0} a vincular`,
        `${num(s.sem_xml) ?? 0} sem XML`),
    narrativa: (e, s) => frase(
      "Conferiu as notas de serviço de", `${dataBr(e.data_de)} a ${dataBr(e.data_ate)}:`,
      `${qtd(num(s.ja_vinculado), "já está ligada ao título", "já estão ligadas ao título")},`,
      `${qtd(num(s.vincular), "pronta para vincular", "prontas para vincular")}`,
      num(s.ambiguo) ? `, ${qtd(num(s.ambiguo), "ambígua", "ambíguas")}` : "",
      num(s.sem_xml) ? `e ${qtd(num(s.sem_xml), "sem XML", "sem XML")}` : "",
    ),
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
 * A frase em português desta linha.
 *
 * Vazia para tarefa que o dicionário não conhece — e é assim que tem de ser. Uma
 * frase genérica montada a partir do nome da tarefa ("Executou pagar boleto
 * sozinha com sucesso") soa igualzinho a uma frase escrita com conhecimento de
 * causa, e quem lê não teria como distinguir as duas. Melhor a tela dizer que não
 * sabe, como já faz o selo "não classificada".
 */
export function narrativaDe(e: Execucao, nome: NomeDe = () => null): string {
  const v = verbete(e.tarefa);
  if (!v?.narrativa) return "";
  try {
    return v.narrativa(obj(e.entrada), obj(e.saida), nome, e).trim();
  } catch {
    return "";
  }
}

/** Para que serve este passo na rotina — texto fixo da tarefa, não desta linha. */
export function porQueDe(e: Execucao): string {
  return verbete(e.tarefa)?.porQue ?? "";
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

/* ------------------------------------------------------------ episódios */

/**
 * A trilha é uma lista de passos, mas o trabalho dela vem em CORRENTES.
 *
 * "Consultou fornecedor" sozinho não quer dizer nada; a mesma linha dentro de
 * "chegou uma nota por e-mail → leu os dois anexos → identificou o emissor →
 * conferiu duplicidade → lançou → anexou → fechou o e-mail" é óbvia. É a diferença
 * entre ver os passos e ver a rotina, e era o que a lista plana escondia.
 *
 * NÃO EXISTE ID DE CORRENTE NA TABELA. O runtime não carimba nada que amarre um
 * passo ao seguinte, então o corte é por proximidade no tempo: passou de cinco
 * minutos sem agir, começou outra coisa. A janela não é chute — nas correntes
 * reais os passos ficam a segundos um do outro, e o intervalo entre uma corrente e
 * a seguinte é de vinte minutos para cima. Um `marcar_email_processado` também
 * fecha a corrente, porque é literalmente o fim do ciclo da caixa de entrada.
 *
 * O corte é HEURÍSTICA, e a tela deixa desligar. Um agrupamento errado que não se
 * pode desfazer é pior do que lista nenhuma: quem audita precisa poder ver os
 * passos crus, na ordem em que aconteceram, sem nada por cima.
 */
export const JANELA_EPISODIO_MS = 5 * 60 * 1000;

/** Depois do fecho do ciclo do e-mail, o próximo passo já é outra história. */
const FOLGA_APOS_FECHO_MS = 30 * 1000;

export type Episodio = {
  /** O id da primeira ação — serve de chave estável na lista. */
  id: string;
  titulo: string;
  /** Do que se tratava: o fornecedor, o valor, o título. Pode vir vazio. */
  assunto: string;
  /** Em que deu: "lançou R$ 870,00", "só consulta — nada mudou". */
  desfecho: string;
  /** Para que serve esta rotina — fixo por família, como o `porQue` da tarefa. */
  porQue: string;
  inicio: string;
  fim: string;
  /** Em ordem cronológica: episódio é uma história, e história se lê do começo. */
  acoes: Execucao[];
};

/**
 * As famílias de rotina, em ordem de prioridade.
 *
 * A corrente ganha o título da PRIMEIRA família que aparecer nela, não da mais
 * frequente: numa corrente que lê e-mail e depois lança, o que se quer ler no
 * cabeçalho é "chegou um documento por e-mail", que é a história; o lançamento é o
 * desfecho, e sai no `desfecho`.
 */
const FAMILIAS: { titulo: string; porQue: string; tarefas: string[] }[] = [
  {
    titulo: "Documento que chegou por e-mail",
    porQue:
      "A rotina da caixa de entrada, de ponta a ponta: ela varre os e-mails novos, lê os "
      + "anexos, descobre quem emitiu, confere se aquilo já não foi lançado nem pago no "
      + "cartão, lança a conta a pagar, pendura os documentos no título e fecha marcando o "
      + "e-mail como tratado. É o ciclo que mais se repete no dia dela.",
    tarefas: ["listar_emails_novos", "ler_documento_email", "marcar_email_processado"],
  },
  {
    titulo: "Nota fiscal e o título dela",
    porQue:
      "O trabalho de casar as duas pontas: a nota que chegou e o título que já existe no "
      + "Omie. Procura o par, carimba a chave da nota no título e move a etapa — é o que a "
      + "contabilidade precisa para fechar o mês.",
    tarefas: ["buscar_cap_para_nota", "vincular_nota_ao_cap", "dar_entrada_nota",
      "conciliar_nfse_periodo", "listar_notas_pendentes_entrada"],
  },
  {
    titulo: "Lançamento no contas a pagar",
    porQue:
      "Criar o compromisso no Omie: confere duplicidade, lança o título e pendura o "
      + "documento que o sustenta.",
    tarefas: ["criar_conta_pagar", "registrar_obrigacao", "anexar_documento"],
  },
  {
    titulo: "Mexeu em títulos que já existiam",
    porQue:
      "Alterar ou apagar títulos já lançados. Quase sempre nasce de um pedido direto no "
      + "chat, e é a rotina em que uma corrente longa custa caro: cada título mexido é uma "
      + "ida inteira ao modelo.",
    tarefas: ["editar_lancamento_omie", "excluir_lancamento_omie"],
  },
  {
    titulo: "Cadastro de fornecedor",
    porQue:
      "Abrir ou arrumar a ficha de quem recebe: cadastro no Omie, espelho na Biblioteca, "
      + "dados bancários, liberação para lançamento automático e a categoria que ela aprende.",
    tarefas: ["cadastrar_fornecedor_do_documento", "criar_fornecedor_omie",
      "espelhar_fornecedor_do_omie", "cadastrar_dado_bancario_fornecedor",
      "liberar_fornecedor", "ensinar_categoria", "marcar_evento_em_lote"],
  },
  {
    titulo: "Ronda de abertura do dia",
    porQue:
      "Como ela começa o expediente: a agenda da tesouraria, o calendário de contas fixas, "
      + "o que vence à frente e o espelho local dos títulos atualizado.",
    tarefas: ["agenda_do_dia", "conferir_fixos_do_dia", "listar_vencimentos",
      "sincronizar_titulos", "gasto_por_categoria"],
  },
];

const SO_CONSULTAS = {
  titulo: "Rodada de consultas",
  porQue:
    "Uma sequência que só perguntou coisas — a fornecedores, a regras, ao Omie — sem "
    + "escrever em lugar nenhum. É trabalho de verdade e custa o mesmo por passo, mas "
    + "nada mudou de estado.",
};

function tituloDaCorrente(acoes: Execucao[]): { titulo: string; porQue: string } {
  const tarefas = new Set(acoes.map((a) => a.tarefa));
  for (const f of FAMILIAS) {
    if (f.tarefas.some((t) => tarefas.has(t))) return { titulo: f.titulo, porQue: f.porQue };
  }
  if (acoes.every((a) => classeDe(a) === "leitura")) return SO_CONSULTAS;
  return { titulo: "Sequência de ações", porQue: "" };
}

/** De quem/do que a corrente tratava — o primeiro nome e o primeiro título que aparecerem. */
function assuntoDaCorrente(acoes: Execucao[], nome: NomeDe): string {
  let quem = "";
  let codigo = "";
  for (const a of acoes) {
    const e = obj(a.entrada);
    const s = obj(a.saida);
    if (!quem) {
      const candidato = quemE(e, s, nome);
      /* Um uuid abreviado não é nome de ninguém: no cabeçalho do episódio ele
         seria pior do que campo vazio. */
      if (candidato && !candidato.startsWith(SEM_NOME)) quem = candidato;
    }
    if (!codigo) {
      codigo = txt(a.entidade_id) || txt(s.codigo_omie) || txt(e.codigo_lancamento) || txt(e.cod_titulo);
    }
  }
  return juntar(quem, codigo && `título ${codigo}`);
}

function desfechoDaCorrente(acoes: Execucao[]): string {
  let lancado = 0;
  let escritas = 0;
  let falhas = 0;
  let escaladas = 0;

  for (const a of acoes) {
    lancado += valorLancado(a) ?? 0;
    if (a.resultado === "falhou") falhas++;
    else if (a.resultado === "escalado") escaladas++;
    else if (a.resultado === "executado" && classeDe(a) === "escrita") escritas++;
  }

  const partes: string[] = [];
  if (lancado) partes.push(`lançou ${brlStr(lancado)}`);
  else if (escritas) partes.push(qtd(escritas, "escrita no Omie", "escritas no Omie"));
  if (escaladas) partes.push(qtd(escaladas, "passo escalado para uma pessoa", "passos escalados para uma pessoa"));
  if (falhas) partes.push(qtd(falhas, "passo falhou", "passos falharam"));
  if (!partes.length) partes.push("só consulta — nada mudou de lado nenhum");
  return partes.join(" · ");
}

/**
 * Corta a trilha em correntes de trabalho e dá nome a cada uma.
 *
 * Recebe as execuções em qualquer ordem e devolve os episódios do mais novo para o
 * mais velho — a ordem da tela —, com as ações DENTRO de cada episódio em ordem
 * crescente, que é a ordem em que a história aconteceu.
 */
export function agruparEmEpisodios(
  execucoes: Execucao[],
  nome: NomeDe = () => null,
  janelaMs: number = JANELA_EPISODIO_MS,
): Episodio[] {
  const ordenadas = [...(execucoes ?? [])].sort(
    (a, b) => a.executado_em.localeCompare(b.executado_em) || a.id.localeCompare(b.id),
  );

  const correntes: Execucao[][] = [];
  for (const e of ordenadas) {
    const atual = correntes.at(-1);
    const anterior = atual?.at(-1);
    if (!atual || !anterior) {
      correntes.push([e]);
      continue;
    }
    const distancia = new Date(e.executado_em).getTime() - new Date(anterior.executado_em).getTime();
    const fechouOCiclo = anterior.tarefa === "marcar_email_processado" && distancia > FOLGA_APOS_FECHO_MS;
    if (!Number.isFinite(distancia) || distancia > janelaMs || fechouOCiclo) correntes.push([e]);
    else atual.push(e);
  }

  return correntes
    .map((acoes): Episodio => {
      const { titulo, porQue } = tituloDaCorrente(acoes);
      return {
        id: acoes[0].id,
        titulo,
        porQue,
        assunto: assuntoDaCorrente(acoes, nome),
        desfecho: desfechoDaCorrente(acoes),
        inicio: acoes[0].executado_em,
        fim: acoes[acoes.length - 1].executado_em,
        acoes,
      };
    })
    .reverse();
}

/** "14:51" — o relógio de um extremo do episódio, no fuso de quem lê. */
export function horaCurta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** "14:51" quando começa e acaba no mesmo minuto; "14:51–14:53" quando não. */
export function janelaDoEpisodio(ep: Episodio): string {
  const de = horaCurta(ep.inicio);
  const ate = horaCurta(ep.fim);
  return de === ate ? de : `${de}–${ate}`;
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
