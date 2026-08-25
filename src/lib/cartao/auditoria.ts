/**
 * A conferência da fatura: provar que nada foi esquecido pelo caminho.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * A tela separa 647 linhas em quatro baldes e transforma parte delas em títulos
 * do Omie. Cada etapa é defensável isoladamente — mas quem assina o fechamento
 * não precisa de etapas defensáveis, precisa de UMA afirmação: *toda* linha do
 * arquivo teve um destino, e o destino de cada uma está escrito.
 *
 * Uma linha pode sumir de três jeitos silenciosos, e nenhum deles dá erro:
 *
 *   • cair num balde e não gerar o título que devia (parcelamento mal lido);
 *   • gerar o título e o envio parar no meio (fatura grande, lote interrompido);
 *   • ter subido ao Omie numa importação anterior e não estar mais no arquivo
 *     de hoje — o título existe no ERP e não tem mais dono na fatura.
 *
 * O terceiro é o pior porque é invisível dos dois lados: a tela mostra a fatura
 * de hoje, o Omie mostra o título, e ninguém olha os dois juntos. É o `órfão`
 * daqui.
 *
 * COMO SE PROVA
 * Não por inspeção — por igualdade. `contas` é uma lista de somas que TÊM de
 * bater, cada uma com os dois lados à mostra. Se qualquer uma não fechar, a
 * aba diz qual e por quanto, em vez de exibir um verde genérico.
 *
 * Módulo puro: sem React, sem Supabase, sem relógio.
 */

import type { LinhaClassificada, Provisao, Separacao } from "./provisionar";

/* ------------------------------------------------------------------ */

export type Veredito =
  /** O título existe no Omie, criado por este Hub. */
  | "enviado"
  /** Vai subir no próximo envio: tem categoria e ainda não foi criado. */
  | "a-enviar"
  /** Trava o envio da fatura inteira — lojista sem categoria no de-para. */
  | "sem-categoria"
  /** Não gera título de propósito: parcela ≥ 2, pagamento da fatura, estorno. */
  | "nao-gera"
  /** Está no Omie e NÃO está nesta fatura. Ninguém mais olha por ele. */
  | "orfao";

/** Um envio já gravado em `cartao_envios_omie`. */
export type EnvioRegistrado = {
  integracao: string;
  codTitulo: string | null;
  estabelecimento: string | null;
  valor: number;
  vencimento: string | null;
  status: string;
  erro: string | null;
};

export type TituloAuditado = {
  integracao: string;
  estabelecimento: string;
  competencia: string;
  vencimento: string;
  valor: number;
  parcela: { n: number; de: number } | null;
  codTitulo: string | null;
  veredito: Veredito;
  /**
   * O que subiu ao Omie diverge do que a fatura de hoje diz. Acontece quando o
   * arquivo é reimportado depois de corrigido: o título velho continua lá com o
   * valor velho, e só a comparação lado a lado revela.
   */
  divergencia: string | null;
};

export type LinhaAuditada = {
  linha: LinhaClassificada;
  titulos: TituloAuditado[];
  /** O estado da linha inteira — o mais grave entre os títulos que ela gerou. */
  veredito: Veredito;
  /** Soma dos títulos desta linha (a série toda, não só a parcela desta fatura). */
  totalTitulos: number;
};

export type Conferencia = {
  rotulo: string;
  tipo: "quantidade" | "dinheiro";
  /** O que o arquivo diz. */
  esquerda: number;
  /** O que a automação produziu. */
  direita: number;
  ok: boolean;
  /** O que significa não bater — escrito antes de acontecer. */
  nota: string;
};

export type Auditoria = {
  linhas: LinhaAuditada[];
  orfaos: TituloAuditado[];
  contas: Conferencia[];
  resumo: Record<Veredito, number>;
  /** Toda conferência fechou. É a única frase que a aba pode afirmar. */
  fecha: boolean;
};

/* ------------------------------------------------------------------ */

/** Meio centavo: dinheiro em ponto flutuante não se compara com `===`. */
const igual = (a: number, b: number) => Math.abs(a - b) < 0.005;

const soma = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/** O mais grave primeiro — é ele que nomeia a linha e ordena a lista. */
const GRAVIDADE: Veredito[] = ["orfao", "sem-categoria", "a-enviar", "enviado", "nao-gera"];

const pior = (vs: Veredito[]): Veredito => {
  for (const v of GRAVIDADE) if (vs.includes(v)) return v;
  return "nao-gera";
};

const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/* ------------------------------------------------------------------ */

/**
 * Confere a fatura contra o que a automação fez com ela.
 *
 * `categoriaDe` devolve o código da categoria do lojista (ou `null`): é a única
 * informação que não sai do arquivo, e é ela que separa "vai subir" de "está
 * travado". Recebe a chave já fundida por `chaveDe`.
 */
export function auditar(opts: {
  separacao: Separacao;
  provisoes: Provisao[];
  envios: EnvioRegistrado[];
  categoriaDe: (chave: string) => string | null;
}): Auditoria {
  const { separacao, provisoes, envios, categoriaDe } = opts;

  const enviados = new Map<string, EnvioRegistrado>();
  for (const e of envios) if (e.status === "enviado") enviados.set(e.integracao, e);

  /* As provisões de cada linha, pelo fitid que as originou. */
  const porFitid = new Map<string, Provisao[]>();
  for (const p of provisoes) {
    const lista = porFitid.get(p.fitid) ?? [];
    lista.push(p);
    porFitid.set(p.fitid, lista);
  }

  const vistos = new Set<string>();

  const linhas: LinhaAuditada[] = separacao.linhas.map((linha) => {
    const gera = linha.balde === "avista" || linha.balde === "primeira";
    const provs = gera ? (porFitid.get(linha.fitid) ?? []) : [];
    const temCategoria = Boolean(categoriaDe(linha.chave));

    const titulos: TituloAuditado[] = provs.map((p) => {
      vistos.add(p.integracao);
      const env = enviados.get(p.integracao);

      const difs: string[] = [];
      if (env) {
        if (!igual(env.valor, p.valor)) {
          difs.push(`subiu por ${brl(env.valor)}, a fatura diz ${brl(p.valor)}`);
        }
        if (env.vencimento && env.vencimento !== p.vencimento) {
          difs.push(`venceu em ${env.vencimento}, a fatura projeta ${p.vencimento}`);
        }
      }

      return {
        integracao: p.integracao,
        estabelecimento: p.estabelecimento,
        competencia: p.competencia,
        vencimento: p.vencimento,
        valor: p.valor,
        parcela: p.parcela,
        codTitulo: env?.codTitulo ?? null,
        veredito: env ? "enviado" : temCategoria ? "a-enviar" : "sem-categoria",
        divergencia: difs.length ? difs.join(" · ") : null,
      };
    });

    return {
      linha,
      titulos,
      veredito: gera ? pior(titulos.map((t) => t.veredito)) : "nao-gera",
      totalTitulos: soma(titulos.map((t) => t.valor)),
    };
  });

  /* Está no Omie e não tem mais dono nesta fatura. */
  const orfaos: TituloAuditado[] = [...enviados.values()]
    .filter((e) => !vistos.has(e.integracao))
    .map((e) => ({
      integracao: e.integracao,
      estabelecimento: e.estabelecimento ?? "—",
      competencia: "",
      vencimento: e.vencimento ?? "",
      valor: e.valor,
      parcela: null,
      codTitulo: e.codTitulo,
      veredito: "orfao" as const,
      divergencia: "Subiu ao Omie e não está nesta fatura.",
    }));

  /* ---- as igualdades que têm de fechar ---------------------------- */

  const geradoras = [...separacao.porBalde.avista, ...separacao.porBalde.primeira];
  const titulosEsperados = soma(geradoras.map((l) => l.parcela?.de ?? 1));
  const primeirasParcelas = provisoes.filter((p) => !p.parcela || p.parcela.n === 1);
  const divergentes = linhas.flatMap((l) => l.titulos).filter((t) => t.divergencia).length;

  /* Cada uma é uma igualdade: o lado esquerdo é o que o arquivo diz, o direito é
     o que a automação produziu. `ok` não se escreve — se calcula. */
  const bruto: Omit<Conferencia, "ok">[] = [
    {
      rotulo: "Toda linha do arquivo foi classificada",
      tipo: "quantidade",
      esquerda: separacao.linhas.length,
      direita: soma([
        separacao.porBalde.avista.length, separacao.porBalde.primeira.length,
        separacao.porBalde.ignorar.length, separacao.porBalde["nao-financeiro"].length,
      ]),
      nota: "Linha sem balde não aparece em aba nenhuma — some sem erro.",
    },
    {
      rotulo: "Nenhum valor se perdeu na separação",
      tipo: "dinheiro",
      esquerda: soma(separacao.linhas.map((l) => l.valor)),
      direita: soma([
        separacao.totais.avista, separacao.totais.primeira,
        separacao.totais.ignorar, separacao.totais["nao-financeiro"],
      ]),
      nota: "A soma dos quatro baldes é a soma do arquivo, sempre.",
    },
    {
      rotulo: "Cada linha gerou os títulos que devia",
      tipo: "quantidade",
      esquerda: titulosEsperados,
      direita: provisoes.length,
      nota: "À vista gera 1; 1ª de N gera N. Faltando, um mês à frente chega vazio.",
    },
    {
      rotulo: "A parcela desta fatura vale o que a linha diz",
      tipo: "dinheiro",
      esquerda: separacao.totais.avista + separacao.totais.primeira,
      direita: soma(primeirasParcelas.map((p) => p.valor)),
      nota: "O que entra no Omie por esta fatura tem de ser o gasto do ciclo.",
    },
    {
      rotulo: "Nenhuma chave de idempotência repetida",
      tipo: "quantidade",
      esquerda: provisoes.length,
      direita: new Set(provisoes.map((p) => p.integracao)).size,
      nota: "Duas linhas com a mesma chave: o Omie aceita uma e recusa a outra calado.",
    },
    {
      rotulo: "Todo título já no Omie pertence a esta fatura",
      tipo: "quantidade",
      esquerda: 0,
      direita: orfaos.length,
      nota: "Órfão é despesa lançada que ninguém mais confere — nem aqui, nem no ERP.",
    },
    {
      rotulo: "Nenhum título subiu diferente do que a fatura diz",
      tipo: "quantidade",
      esquerda: 0,
      direita: divergentes,
      nota: "Reimportar o arquivo corrigido não corrige o que já está no ERP.",
    },
  ];

  const contas: Conferencia[] = bruto.map((c) => ({
    ...c,
    ok: c.tipo === "dinheiro" ? igual(c.esquerda, c.direita) : c.esquerda === c.direita,
  }));

  /* ---- resumo ----------------------------------------------------- */

  const resumo: Record<Veredito, number> = {
    enviado: 0, "a-enviar": 0, "sem-categoria": 0, "nao-gera": 0, orfao: orfaos.length,
  };
  for (const l of linhas) {
    if (l.veredito === "nao-gera") resumo["nao-gera"] += 1;
    else for (const t of l.titulos) resumo[t.veredito] += 1;
  }

  return { linhas, orfaos, contas, resumo, fecha: contas.every((c) => c.ok) };
}

/** Quantas pendências a aba precisa anunciar antes de alguém abri-la. */
export const pendencias = (a: Auditoria): number =>
  a.contas.filter((c) => !c.ok).length + a.resumo["sem-categoria"] + a.orfaos.length;
