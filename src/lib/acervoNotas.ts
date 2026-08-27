/* ---------------------------------------------------------------------------
 * Por que um documento do acervo NÃO chegou ao ERP.
 *
 * OS OUTROS NÍVEIS DA TELA respondem "onde está o arquivo" e "quem decide".
 * Nenhum respondia a pergunta que faz a fila crescer: por que ESTE documento
 * parou. Sem ela, "Sem alvo" era um monte com uma ajuda dizendo que não havia o
 * que fazer — e havia, só que a tela não sabia distinguir "nenhum título bate"
 * de "três títulos batem e alguém precisa escolher".
 *
 * A TAXONOMIA NÃO NASCE AQUI. Ela é da view `notas_externas_parada`, que decide
 * o motivo de cada nota numa cascata (a ordem importa: o primeiro que casar
 * vence). Este módulo só dá nome, cor e frase a cada motivo, e soma os que
 * pedem gente. Mudar quem é o quê se faz na view; mudar como se lê, aqui.
 *
 * Puro de propósito: sem React e sem Supabase, é o que dá para testar sozinho.
 * ------------------------------------------------------------------------- */

/**
 * Os motivos, na MESMA ordem da cascata da view — ler daqui é ler a regra.
 *
 *   no_erp          já subiu, acabou
 *   arquivado       alguém arquivou à mão (o porquê está em `arquivado_por`)
 *   copia           é cópia de outro documento do acervo
 *   sem_arquivo     a linha existe, o arquivo não
 *   na_fila         tem alvo e já está na fila do ERP
 *   sobe_sozinha    tem alvo com confiança exata/alta, ou apontado à mão
 *   espera_gente    tem alvo, mas a confiança é baixa — pede conferência
 *   disputado       dois documentos querem o mesmo título
 *   ja_resolvido    cabia em vários, e os que deviam nota já têm
 *   varios_alvos    mais de um título cabe, e alguém precisa escolher
 *   fora_do_alcance mais velho que a janela que o ERP responde
 *   sem_candidato   nenhum título bate
 */
export type MotivoParada =
  | "no_erp" | "arquivado" | "copia" | "sem_arquivo"
  | "na_fila" | "sobe_sozinha" | "espera_gente"
  | "disputado" | "ja_resolvido" | "varios_alvos"
  | "fora_do_alcance" | "sem_candidato";

/** Contagem e dinheiro de um motivo. O valor é o que decide por onde começar. */
export type BaldeParada = { docs: number; valor: number };

/** A janela que o ERP responde — de quando o Hub tem título carregado. */
export type JanelaErp = {
  id: number;
  inicio: string | null;
  titulos: number | null;
  atualizado_em: string | null;
} | null;

/** O que `notas_externas_por_que_parou()` devolve. */
export type PorQueParou = {
  motivos: Partial<Record<MotivoParada, BaldeParada>>;
  /** Só de quem está em `arquivado`: o motivo escrito na hora de arquivar. */
  arquivado_por: Record<string, BaldeParada>;
  janela_erp: JanelaErp;
};

/** `tom` indexa o mapa `TOM` da tela — não invente cor nova aqui. */
export type Descricao = {
  rotulo: string;
  ajuda: string;
  tom: "ok" | "falta" | "atencao" | "neutro" | "fora";
};

export const MOTIVO: Record<MotivoParada, Descricao> = {
  no_erp: {
    rotulo: "No ERP",
    tom: "ok",
    ajuda: "Já subiu e está anexado ao título. Não pede nada de ninguém.",
  },
  na_fila: {
    rotulo: "Na fila",
    tom: "ok",
    ajuda: "Tem alvo e está esperando a vez de subir. O cron leva daqui — não precisa mandar de novo.",
  },
  sobe_sozinha: {
    rotulo: "Sobe sozinha",
    tom: "ok",
    ajuda:
      "O casamento é exato ou de confiança alta, ou alguém já apontou o título à mão. "
      + "Vai ao ERP sem passar por ninguém.",
  },
  espera_gente: {
    rotulo: "Espera conferência",
    tom: "atencao",
    ajuda:
      "Achou um título, mas com confiança baixa demais para subir sozinha. "
      + "Alguém confirma que é aquele mesmo — ou aponta outro.",
  },
  sem_candidato: {
    rotulo: "Nenhum título bate",
    tom: "falta",
    ajuda:
      "O casador não achou título nenhum para este documento, dentro da janela que o ERP responde. "
      + "Costuma ser nota de fornecedor que ainda não virou conta a pagar, valor que diverge do "
      + "lançado, ou documento que não é despesa nossa.",
  },
  varios_alvos: {
    rotulo: "Mais de um cabe",
    tom: "falta",
    ajuda:
      "Dois ou mais títulos batem igualmente bem, e o casador é determinístico: o que empatou hoje "
      + "empata amanhã. Abrir e escolher é a única saída — e escolher marca o alvo como manual, "
      + "então ele sobe sozinho depois.",
  },
  disputado: {
    rotulo: "Dois querem o mesmo",
    tom: "falta",
    ajuda:
      "Mais de um documento aponta para o MESMO título. Um deles está certo e o outro é cópia, "
      + "nota de outra parcela ou de outro mês — enquanto não se separa, nenhum sobe.",
  },
  ja_resolvido: {
    rotulo: "Já resolvido",
    tom: "ok",
    ajuda: "Cabia em vários títulos, e todos os que deviam nota já têm a sua. Não sobrou dívida.",
  },
  arquivado: {
    rotulo: "Arquivado",
    tom: "fora",
    ajuda:
      "Tirado da fila de propósito, com motivo escrito. Arquivar sem mostrar o que foi arquivado "
      + "seria apagar com outro nome — por isso os motivos aparecem ao lado.",
  },
  fora_do_alcance: {
    rotulo: "Fora do alcance",
    tom: "fora",
    ajuda:
      "Mais velho que a janela de títulos que o Hub carregou do ERP. Não há alvo a encontrar: "
      + "não é documento perdido, é documento anterior ao que o sistema enxerga.",
  },
  copia: {
    rotulo: "Cópia",
    tom: "fora",
    ajuda: "É o mesmo arquivo de outro documento do acervo. Quem responde é o original.",
  },
  sem_arquivo: {
    rotulo: "Sem arquivo",
    tom: "fora",
    ajuda: "A linha existe na planilha, mas o arquivo nunca chegou. Não há o que anexar.",
  },
};

/**
 * Os três que PEDEM GENTE — e são só três de propósito.
 *
 * `espera_gente` fica de fora porque já tem alvo: ele é conferência, e a
 * conferência tem o próprio recorte na tela. Aqui estão os casos em que o
 * casador esgotou o que sabia fazer e não vai mudar de ideia sozinho.
 */
export const MOTIVOS_PARADOS: MotivoParada[] = ["sem_candidato", "varios_alvos", "disputado"];

/**
 * Quantos documentos e quanto dinheiro estão parados esperando decisão humana.
 *
 * Soma só `MOTIVOS_PARADOS`: é o número que fica ACIMA daqueles três cartões, e
 * um total que não fosse a soma do que está logo abaixo faria quem lê procurar
 * a diferença que não existe.
 */
export function totalParado(p: PorQueParou | null): { docs: number; valor: number } {
  let docs = 0;
  let valor = 0;
  for (const m of MOTIVOS_PARADOS) {
    const b = p?.motivos?.[m];
    docs += b?.docs ?? 0;
    valor += Number(b?.valor ?? 0);
  }
  return { docs, valor };
}

const dataBR = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : "";
};

/**
 * A frase que explica `fora_do_alcance` — ou vazio, quando não há o que dizer.
 *
 * Existe porque "fora do alcance" soa como falha do Hub e não é: é o limite do
 * que ele carregou do ERP. Dizer desde quando, e sobre quantos títulos, é a
 * diferença entre "sumiu" e "ainda não entrou na conta".
 *
 * Devolve string vazia (e não null) porque a tela testa com `!!` antes de
 * renderizar — um null aqui viraria "null" na tela em alguma refatoração futura.
 */
export function fraseDaJanela(j: JanelaErp): string {
  if (!j?.inicio) return "";
  const quantos = Number(j.titulos ?? 0);
  return (
    `O Hub responde pelos títulos do ERP a partir de ${dataBR(j.inicio)}`
    + (quantos > 0 ? ` (${quantos.toLocaleString("pt-BR")} títulos carregados)` : "")
    + ". Documento mais velho que isso não tem alvo a encontrar — é limite da janela, não sumiço."
  );
}
