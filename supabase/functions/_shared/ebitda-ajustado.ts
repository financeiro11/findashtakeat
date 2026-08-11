/* ============================================================================
 * As duas linhas do EBITDA Ajustado dentro do blob da DRE.
 *
 * POR QUE NO BLOB, E NÃO CALCULADO NA TELA. `demonstracoes_contabeis` é o que
 * todo mundo lê: a DRE, o Histórico Multianual, o BP e as funções de IA (o
 * ai-chat despeja o blob inteiro no contexto). Uma linha que só existisse dentro
 * do React seria invisível justamente para quem precisa dela — a IA continuaria
 * explicando um tombo de EBITDA que foi uma rescisão.
 *
 * POR QUE RECALCULA DO ZERO. Diferente do valor manual, que precisa de
 * `valor_base`/`valor_aplicado` para não dobrar, aqui não há delta a preservar:
 * as duas linhas são DERIVADAS (EBITDA do mês + soma dos ajustes aceitos) e são
 * reescritas inteiras a cada passada. Rodar duas vezes dá o mesmo resultado.
 *
 * ORDEM IMPORTA: isto roda DEPOIS de `aplicarValoresManuais`. A depreciação
 * digitada à mão derruba o EBITDA, e o EBITDA Ajustado tem que partir do EBITDA
 * já corrigido — na ordem inversa a linha ajustada ficaria um mês atrasada.
 *
 * MÊS TRAVADO TAMBÉM RECEBE. É o caso NORMAL, não a exceção: ajuste de EBITDA se
 * faz no mês fechado, olhando para trás. A trava existe para o Omie não
 * sobrescrever o tracker; ela não vale para uma linha que nenhum dos dois
 * escreve.
 * ========================================================================== */

export type Dados = { columns: string[]; rows: Record<string, unknown>[] };

/** Rótulos das linhas — os mesmos do esquema da tela (demonstracoes-schema.ts). */
export const LINHA_AJUSTES = "(+) Ajustes de EBITDA";
export const LINHA_EBITDA_AJUSTADO = "EBITDA Ajustado";
const LINHA_EBITDA = "EBITDA";

export type AjusteAceito = { col_key: string; valor: number };

const chave = (s: string) => String(s ?? "").trim().toLowerCase();
const cent = (n: number) => Math.round(n * 100) / 100;

/* ============================================================================
 *  Ajuste PARCIAL — quanto de um lançamento é one-off
 *
 *  Nem toda fatura fora do padrão é fora do padrão inteira. A do Datadog em
 *  Jul-26 veio R$ 40 mil porque trazia meses atrasados; a competência de julho
 *  ali dentro era R$ 6,5 mil, e esses R$ 6,5 mil são gasto de TODO mês. Devolver
 *  os R$ 40 mil ao EBITDA apagaria um custo que a operação tem — o EBITDA
 *  Ajustado ficaria melhor que a realidade, o oposto do que a linha faz.
 *
 *  ESTAS DUAS FUNÇÕES SÃO ESPELHO de `src/lib/ebitdaAjustado.ts`, pelo mesmo
 *  motivo do `normalize.ts`: o cliente precisa delas para desabilitar o botão e
 *  mostrar o erro enquanto se digita, e o servidor precisa delas porque
 *  validação que só existe no cliente não existe. Um teste em
 *  `src/lib/ebitdaAjustado.test.ts` compara as duas cópias.
 * ========================================================================== */

/**
 * Reparte um lançamento entre o que volta para o EBITDA e o que fica no mês.
 * `parteDevolvida` chega em MÓDULO — o sinal sai daqui, e o teto é o próprio
 * lançamento (devolver mais do que ele tem seria inventar dinheiro).
 */
export function repartirAjuste(
  valorNoBlob: number,
  parteDevolvida: number,
): { valor: number; fica: number } {
  const cheio = -valorNoBlob;
  const sinal = cheio < 0 ? -1 : 1;
  const parte = Math.min(Math.abs(parteDevolvida), Math.abs(cheio));
  const valor = cent(sinal * parte);
  return { valor, fica: cent(valorNoBlob + valor) };
}

/** O que impede um ajuste de virar número solto, em português. `null` = de pé. */
export function erroDoAjuste(valorNoBlob: number | null, valor: number): string | null {
  if (!Number.isFinite(valor) || cent(valor) === 0) {
    return 'O ajuste não pode ser zero — use "Não é" para marcar o lançamento como recorrente.';
  }
  // Ajuste avulso (provisão, estorno) não tem lançamento no Omie para comparar.
  if (valorNoBlob == null || !Number.isFinite(valorNoBlob) || valorNoBlob === 0) return null;

  const cheio = -valorNoBlob;
  if (Math.sign(valor) !== Math.sign(cheio)) {
    return cheio > 0
      ? "Este lançamento é despesa: o ajuste devolve valor ao EBITDA, então tem que ser positivo."
      : "Este lançamento é receita: o ajuste tira valor do EBITDA, então tem que ser negativo.";
  }
  if (Math.abs(valor) - Math.abs(cheio) > 0.01) {
    const teto = Math.abs(cheio).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return `O ajuste não pode passar de ${teto} — é o valor do lançamento inteiro.`;
  }
  return null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Reescreve "(+) Ajustes de EBITDA" e "EBITDA Ajustado" a partir do EBITDA que
 * está no blob e dos ajustes aceitos. PURA.
 *
 * Um mês sem EBITDA no blob não ganha nenhuma das duas linhas: EBITDA Ajustado
 * sem EBITDA seria um número feito só de ajuste, que é pior que célula vazia.
 * Um mês com EBITDA e sem ajuste nenhum ganha "EBITDA Ajustado" igual ao EBITDA
 * (a linha não pode ficar furada no meio da série) e deixa a linha de ajustes
 * VAZIA — "—" diz "não houve", e um R$ 0,00 diria "alguém conferiu e deu zero".
 */
export function aplicarAjustesNoBlob(dados: Dados, ajustes: AjusteAceito[]): Dados {
  const rows = (dados.rows ?? []).map((r) => ({ ...r }));
  const columns = [...(dados.columns ?? [])];

  const porConta = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const conta = String(r["Conta"] ?? "").trim();
    if (conta) porConta.set(chave(conta), r);
  }

  const somaPorMes = new Map<string, number>();
  for (const a of ajustes) {
    const v = Number(a.valor);
    if (!Number.isFinite(v)) continue;
    somaPorMes.set(a.col_key, (somaPorMes.get(a.col_key) ?? 0) + v);
  }

  const ebitda = porConta.get(chave(LINHA_EBITDA));
  const meses = columns.filter((c) => c !== "Conta");

  /* Reescreve as duas linhas do zero. Criar a linha já vazia (e não só quando há
     valor) é o que garante que um ajuste REMOVIDO limpe a célula: a passada
     seguinte simplesmente não escreve nada naquele mês. */
  const linhaAjustes: Record<string, unknown> = { Conta: LINHA_AJUSTES };
  const linhaAjustado: Record<string, unknown> = { Conta: LINHA_EBITDA_AJUSTADO };

  for (const col of meses) {
    const eb = ebitda ? num(ebitda[col]) : null;
    if (eb === null) continue; // mês sem EBITDA: nada a ajustar
    const soma = cent(somaPorMes.get(col) ?? 0);
    if (soma !== 0) linhaAjustes[col] = soma;
    linhaAjustado[col] = cent(eb + soma);
  }

  const temValor = (row: Record<string, unknown>) =>
    Object.keys(row).some((k) => k !== "Conta" && row[k] !== undefined && row[k] !== null && row[k] !== "");

  const outras = rows.filter((r) => {
    const k = chave(String(r["Conta"] ?? ""));
    return k !== chave(LINHA_AJUSTES) && k !== chave(LINHA_EBITDA_AJUSTADO);
  });

  const novas = [linhaAjustes, linhaAjustado].filter(temValor);
  return { columns, rows: [...outras, ...novas] };
}

/**
 * Lê os ajustes aceitos e reescreve as duas linhas. Só DRE — EBITDA não existe
 * na DFC.
 *
 * Falha de leitura não derruba a escrita, pela mesma razão dos valores manuais:
 * demonstração sem a linha ajustada é melhor que demonstração nenhuma. Mas o
 * erro vai para o log — linha derivada que some calada é o que ninguém percebe.
 */
export async function aplicarEbitdaAjustado(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tipo: "dre" | "dfc",
  dados: Dados,
): Promise<Dados> {
  if (tipo !== "dre") return dados;

  const { data, error } = await supabase
    .from("demonstracoes_ebitda_ajuste")
    .select("col_key,valor")
    .eq("status", "aceito");
  if (error) {
    console.error("ebitda-ajustado: não consegui ler os ajustes:", error.message);
    return dados;
  }

  const ajustes: AjusteAceito[] = (data ?? []).map((r: Record<string, unknown>) => ({
    col_key: String(r.col_key ?? ""),
    valor: Number(r.valor ?? 0),
  }));

  return aplicarAjustesNoBlob(dados, ajustes);
}

/**
 * Bloco de contexto para as funções de IA.
 *
 * O blob já leva o NÚMERO da linha ajustada, mas não o porquê — e é o porquê que
 * muda a resposta. Sem isto a IA olha um EBITDA que despencou em junho e escreve
 * "queda relevante de rentabilidade"; com isto ela sabe que foram R$ 60 mil de
 * rescisão que não se repetem, que é o que alguém do financeiro diria.
 */
export async function contextoAjustesEbitda(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<string> {
  const { data, error } = await supabase
    .from("demonstracoes_ebitda_ajuste")
    .select("col_key,valor,valor_lancamento,descricao,rubrica,contraparte,cods")
    .eq("status", "aceito")
    .order("col_key", { ascending: true })
    .limit(200);
  if (error || !data?.length) return "";

  const brl = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

  /** Quantos lançamentos o ajuste consolida, ou 0 quando é um título só. */
  const grupoDe = (r: Record<string, unknown>) => (Array.isArray(r.cods) ? r.cods.length : 0);

  const linhas = (data as Record<string, unknown>[]).map((r) => {
    const v = Number(r.valor ?? 0);
    const onde = [r.contraparte, r.rubrica].filter(Boolean).join(" · ");
    /* O ajuste parcial precisa aparecer como parcial: sem isto a IA lê "+33,5k
       de Datadog" e conclui que o Datadog não é despesa do mês, quando na
       verdade R$ 6,5 mil dele CONTINUAM no EBITDA e são recorrentes. */
    const cheio = r.valor_lancamento == null ? null : Number(r.valor_lancamento);
    const resto = cheio == null ? null : Math.abs(cheio + v);
    const parcial = cheio != null && resto != null && Math.abs(Math.abs(v) - Math.abs(cheio)) > 0.01
      ? ` [parcial: ${grupoDe(r) ? "as cobranças somaram" : "o lançamento foi"} ${brl(Math.abs(cheio))} e ${brl(resto)} continuam no EBITDA como gasto normal do mês]`
      : "";
    /* O ajuste consolidado precisa se anunciar como consolidado: sem isto a IA
       lê "+49,4k de Datadog" e procura UMA fatura de R$ 49 mil que não existe —
       foram seis cobranças do mesmo fornecedor caindo no mesmo mês. */
    const juntos = grupoDe(r) ? ` [${grupoDe(r)} lançamentos do mesmo fornecedor, somados]` : "";
    return `- ${r.col_key} · ${v > 0 ? "+" : ""}${brl(v)} · ${r.descricao}${onde ? ` (${onde})` : ""}${juntos}${parcial}`;
  });

  return [
    "### Ajustes de EBITDA (eventos não recorrentes)",
    'A linha "EBITDA Ajustado" da DRE é o EBITDA somado aos itens abaixo — eventos que não se repetem,',
    "cada um conferido e aceito por alguém do financeiro. Valor positivo devolve ao EBITDA (era despesa",
    "extraordinária); negativo tira (era receita extraordinária). O EBITDA contábil e o Lucro Líquido NÃO",
    "são afetados. Ao explicar variação de EBITDA, verifique aqui antes de atribuí-la à operação.",
    ...linhas,
  ].join("\n");
}
