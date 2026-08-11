/* ============================================================================
 * Linha de cálculo é CALCULADA — inclusive no banco.
 *
 * O blob da DRE/DFC é uma tabela plana: uma linha por rubrica, uma coluna por
 * mês. Nele, "EBITDA" e "Receita Líquida" ficavam guardados como se fossem dado,
 * do mesmo jeito que "Servidor". Não são: são o resultado das linhas de cima.
 *
 * Enquanto quem escrevia era só o omie-sync isso funcionava, porque ele calcula
 * os totais antes de gravar. O import do tracker não: ele copia a célula de
 * total do arquivo como veio. E o arquivo se contradiz — a fórmula do Lucro
 * Líquido para no intervalo AJ82:AJ85 e deixa o IRF (linha 88) de fora, então o
 * total gravado não era a soma das próprias parcelas dele. A tela mostrava esse
 * número e não tinha como saber.
 *
 * Este módulo fecha o buraco na origem: toda escrita passa por aqui e as linhas
 * derivadas são REESCRITAS a partir das folhas. Depois disto, "o que está
 * gravado" e "a soma das parcelas" são a mesma coisa por construção — na tela,
 * no CSV, na IA e em qualquer consulta que leia a tabela direto.
 *
 * O que é derivado:
 *   • BLOCO   — nó com filhos no esquema. Vale a soma dos filhos, sempre.
 *   • TOTAL   — a cascata (`CASCATA`): EBITDA, Lucro Líquido, Fluxo Livre…
 *   • %       — a divisão (`kind: "percent"`), em pontos percentuais.
 *   • CASHBURN — a queima do mês (fluxo livre − captação extraordinária).
 *
 * O que NÃO é derivado, e por quê:
 *   • Folha — é o dado. Vem do Omie, do tracker ou da mão de alguém.
 *   • Rubrica fora do esquema — o blob acumula órfãs do Omie. Ficam intactas;
 *     também não entram em soma nenhuma, igual à tela.
 *   • "(+) Ajustes de EBITDA" — sai da tabela de decisões, não de outras linhas.
 *     Quem escreve é ebitda-ajustado.ts.
 *   • A coluna em que a linha não tem NENHUMA parcela. Fica como está: derivar
 *     ali apagaria o agregado de um mês antigo que nunca teve detalhe.
 *   • Qualquer mês que o chamador não tenha passado em `colunas` — em especial o
 *     MÊS TRAVADO, que é a demonstração já assinada. Ver o comentário da função.
 *
 * Para BLOCO isto não muda nada na tela: a grade já mostra pai como soma dos
 * filhos. O que muda de fato é o TOTAL, que a tela lia gravado — e passa a ser
 * o mesmo número que o painel de conferência sempre disse que ele deveria ser.
 *
 * PURO: não toca no banco. Roda depois dos valores manuais (que mexem em folha)
 * e depois do EBITDA Ajustado (que escreve a linha de ajustes) — nessa ordem, um
 * total nunca fica olhando para uma parcela velha.
 * ========================================================================== */

import {
  CASCATA, CASHBURN, NOVOS_EMPRESTIMOS, cashburnDoMes,
  DFC_SCHEMA, DRE_SCHEMA, type Node,
} from "./demonstracoes-schema.ts";

export type Dados = { columns: string[]; rows: Record<string, unknown>[] };

const chave = (s: string) => (s ?? "").trim().toLowerCase();

/** Centavos, para não deixar 0.1+0.2 virar 0.30000000000000004 no banco. */
const cent = (n: number) => Math.round(n * 100) / 100;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Blocos do esquema, dos mais fundos para os mais rasos — filho antes do pai. */
function blocosDeBaixoParaCima(nodes: Node[], acc: Node[] = []): Node[] {
  for (const n of nodes) {
    if (n.children?.length) {
      blocosDeBaixoParaCima(n.children, acc);
      acc.push(n);
    }
  }
  return acc;
}

function percentuais(nodes: Node[], acc: Node[] = []): Node[] {
  for (const n of nodes) {
    if (n.kind === "percent" && n.pctOf) acc.push(n);
    if (n.children?.length) percentuais(n.children, acc);
  }
  return acc;
}

/**
 * Reescreve as linhas derivadas — SÓ nas colunas que esta escrita tem direito de
 * escrever.
 *
 * `colunas` não é um detalhe de performance, é a regra de quem manda no mês.
 * Mês travado (`demonstracoes_mes_trancado`) é a demonstração que a diretoria já
 * assinou: o omie-sync nunca o toca, e recalcular ali reescreveria o passado
 * fechado por conta própria. Quem chama passa exatamente o que acabou de mexer —
 * o import passa os meses do arquivo, o valor manual passa a célula, o sync
 * passa o que não está travado. Um mês fechado só muda quando alguém
 * REIMPORTA aquele mês, que é uma decisão de pessoa.
 *
 * Devolve um blob novo — não muta o recebido.
 */
export function recalcularDerivadas(
  tipo: "dre" | "dfc",
  dados: Dados,
  colunas: Set<string>,
): Dados {
  const schema = tipo === "dre" ? DRE_SCHEMA : DFC_SCHEMA;
  const columns = [...(dados.columns ?? [])];
  const meses = columns.filter((c) => c !== "Conta" && colunas.has(c));
  const rows = (dados.rows ?? []).map((r) => ({ ...r }));

  const porConta = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const conta = String(r["Conta"] ?? "").trim();
    if (conta) porConta.set(chave(conta), r);
  }

  /* Os nomes sob os quais uma rubrica pode estar gravada. O tracker batizou
     várias linhas da DFC diferente do esquema ("Entradas" × "Entradas
     Operacionais"), e ignorar isso não dá erro: dá DUAS linhas para a mesma
     rubrica, uma escrita por aqui e a outra do arquivo — foi o que aconteceu e
     é o que este mapa impede. Ver `alias` em demonstracoes-schema.ts. */
  const apelidos = new Map<string, string[]>();
  const indexarApelidos = (nodes: Node[]) => {
    for (const n of nodes) {
      apelidos.set(chave(n.label), [n.label, ...(n.alias ?? [])]);
      if (n.children?.length) indexarApelidos(n.children);
    }
  };
  indexarApelidos(schema);
  const nomesDe = (rotulo: string) => apelidos.get(chave(rotulo)) ?? [rotulo];

  /** Primeiro o rótulo do esquema, depois os apelidos — nunca soma os dois. */
  const ler = (rotulo: string, col: string): number | null => {
    for (const nome of nomesDe(rotulo)) {
      const v = num(porConta.get(chave(nome))?.[col]);
      if (v !== null) return v;
    }
    return null;
  };

  /**
   * Escreve o valor derivado — e SÓ quando há de onde derivar.
   *
   * Valor nulo significa "esta coluna não tem nenhuma das parcelas": aí a célula
   * fica como está, não é apagada. É o que protege o histórico em que só existe
   * o agregado — mês antigo cujo detalhe nunca foi carregado tem "(-) SG&A" e
   * nenhuma equipe embaixo, e derivar ali apagaria o único número que existe.
   * A regra do módulo é derivar o que dá, nunca destruir o que não dá.
   *
   * A grafia que já está na base é preservada ("Encargos sociais" vs "Encargos
   * Sociais"): criar a variante faria duas linhas para a mesma rubrica, e a tela
   * indexa por rótulo — uma esconderia a outra.
   */
  const escrever = (rotulo: string, col: string, valor: number | null) => {
    if (valor === null) return;
    const nomes = nomesDe(rotulo);
    // Escreve na linha que JÁ EXISTE, sob qualquer um dos nomes. Criar
    // "Entradas Operacionais" ao lado de "Entradas" faria a tela mostrar duas
    // linhas para a mesma coisa e somar uma delas duas vezes.
    let row = nomes.map((n) => porConta.get(chave(n))).find(Boolean);
    if (!row) {
      row = { Conta: rotulo };
      porConta.set(chave(rotulo), row);
      rows.push(row);
    }
    row[col] = cent(valor);
  };

  /** Soma tratando vazio como zero, mas devolve null se TUDO estiver vazio. */
  const somar = (rotulos: string[], col: string): number | null => {
    const vs = rotulos.map((r) => ler(r, col));
    return vs.some((v) => v !== null) ? vs.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  };

  const blocos = blocosDeBaixoParaCima(schema);
  const totais = Object.entries(CASCATA[tipo]);
  const pcts = percentuais(schema);

  for (const col of meses) {
    // 1) Blocos, de baixo para cima: "Pessoal" antes de "(-) SG&A".
    for (const b of blocos) escrever(b.label, col, somar(b.children!.map((c) => c.label), col));

    /* 2) Totais, na ordem da cascata — que é a ordem de leitura da própria
       demonstração, então cada um já encontra o de cima pronto.
       A ÂNCORA é a primeira parcela: sem ela o total não existe. É o que impede
       um mês vazio de ganhar um Lucro Líquido feito só de imposto, e o que
       reproduz a regra do EBITDA Ajustado (sem EBITDA, linha nenhuma). */
    for (const [total, parcelas] of totais) {
      escrever(total, col, ler(parcelas[0], col) === null ? null : somar(parcelas, col));
    }

    // 3) Percentuais, em PONTOS (o tracker grava "73,18"). Denominador zerado
    //    não vira Infinity — vira célula vazia.
    for (const p of pcts) {
      const n = ler(p.src ?? p.label.replace(/^%\s*/, ""), col);
      const d = ler(p.pctOf!, col);
      escrever(p.label, col, n === null || !d ? null : (n / d) * 100);
    }
  }

  /* 4) Cashburn: a queima do MÊS — fluxo livre menos a captação extraordinária.
     Não é soma móvel de 12 meses; a régua e o porquê estão em
     `cashburnDoMes`, no esquema, e é de lá que ela sai para não haver duas. */
  if (tipo === "dfc") {
    for (const col of meses) {
      escrever(CASHBURN, col, cashburnDoMes(ler("Fluxo Livre", col), ler(NOVOS_EMPRESTIMOS, col)));
    }
  }

  /* Linha inteiramente vazia sai do blob — rubrica órfã que já entrou assim.
     Nenhuma linha fica vazia POR CAUSA daqui: derivada nula não apaga nada. */
  const temValor = (row: Record<string, unknown>) =>
    Object.keys(row).some((k) => k !== "Conta" && row[k] !== undefined && row[k] !== null && row[k] !== "");

  return { columns, rows: rows.filter(temValor) };
}
