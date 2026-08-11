/* ============================================================================
 * Valor manual na célula da DRE/DFC.
 *
 * Nem tudo que entra na demonstração vem do Omie ou do tracker: depreciação,
 * provisão, imposto ainda não lançado. Isso sempre foi digitado à mão na
 * planilha — e, no Hub, digitar direto no blob não funcionaria: o omie-sync
 * reescreve todo mês aberto e o import de tracker zera o mês que traz. O valor
 * durava até a próxima sincronização.
 *
 * Por isso o valor manual mora na TABELA `demonstracoes_valor_manual` (a fonte
 * de verdade) e é REAPLICADO no blob no fim de toda escrita — sync, import ou
 * edição pela tela. O blob continua sendo o que todo mundo lê (as três telas de
 * demonstração e as funções de IA), agora já com o manual dentro.
 *
 * Duas coisas que este arquivo não podia errar:
 *
 *  1. TOTAL. Digitar "(-) Depreciação & Amortização" tem que derrubar o EBITDA e
 *     o Lucro Líquido — senão a tela mostra a rubrica nova e o resultado velho.
 *     O ajuste vai por DELTA (quanto o manual mudou), nunca recalculando o total
 *     pela soma das seções: o blob guarda linhas de SUBTOTAL do tracker
 *     ("Receita Spot", "Pessoal", "Receita Recorrente") junto com as folhas, e
 *     somar tudo contaria a mesma receita duas vezes.
 *
 *  2. REAPLICAR NÃO PODE ACUMULAR. A mesma reaplicação roda a cada sync. Num mês
 *     DESTRAVADO o sync reescreveu a coluna do zero, então o delta entra limpo;
 *     num mês TRAVADO ele nem tocou na coluna, e o delta da vez passada ainda
 *     está lá — some de novo e o valor dobra a cada clique. Daí `valor_base` e
 *     `valor_aplicado` guardados por célula e o parâmetro `colunasAtualizadas`:
 *     quem escreveu sabe dizer quais colunas voltaram a ser automáticas.
 *
 *  3. IMPORT DE TRACKER NÃO TEM CÉLULA INTOCADA. `colunasAtualizadas` diz "a
 *     coluna foi recalculada"; `colunasReescritas` diz algo mais forte — "toda
 *     célula desta coluna foi apagada e regravada a partir do arquivo". Só o
 *     import faz isso, e nele a heurística `intocada` (ver abaixo) tem que ficar
 *     desligada: o tracker JÁ traz o valor digitado à mão, a célula bate com o
 *     `valor_aplicado` por coincidência, e o código concluía "o sync não passou
 *     aqui" e ressomava aos totais um delta contra um `valor_base` velho do
 *     Omie. Era isso que fazia a Margem de contribuição de um mês recém-importado
 *     nascer errada mesmo com todas as rubricas certas.
 * ========================================================================== */

import { alvosDoAjuste, CASHBURN } from "./demonstracoes-schema.ts";

export type Dados = { columns: string[]; rows: Record<string, unknown>[] };

export type ValorManual = {
  id: string;
  tipo: "dre" | "dfc";
  rubrica: string;
  col_key: string;
  modo: "substitui" | "soma";
  valor: number;
  /** valor automático que a célula tinha antes do manual (null = célula não existia) */
  valor_base: number | null;
  /** último valor que o manual gravou no blob (null = nunca aplicado) */
  valor_aplicado: number | null;
};

const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sortKey(k: string): number {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return -1;
  const i = EN.indexOf(m[1]);
  return i < 0 ? -1 : (2000 + parseInt(m[2], 10)) * 12 + i;
}

/** Célula vazia é null, não 0: "não existe" e "é zero" são coisas diferentes aqui. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
const cent = (n: number) => Math.round(n * 100) / 100;

/** Mesma chave que a tela usa para achar a linha: rótulo sem caixa. */
const chave = (s: string) => String(s ?? "").trim().toLowerCase();

/**
 * Aplica os valores manuais no blob. PURA — recebe as linhas da tabela e devolve
 * o blob novo mais o que precisa ser gravado de volta em cada linha manual.
 *
 * @param colunasAtualizadas colunas que a escrita em curso acabou de refazer do
 *   zero (sync/import). Nelas o blob está automático: a base é o que está lá e
 *   não há delta anterior para descontar. Fora delas, vale o `valor_base`
 *   guardado — é o que impede o valor de dobrar em mês travado.
 * @param removidos manuais que acabaram de ser apagados: desfaz a célula e o
 *   total antes de aplicar o resto.
 * @param colunasReescritas colunas em que TODA célula foi apagada e regravada da
 *   fonte (import de tracker). Nelas não existe célula intocada: a base é o que
 *   o arquivo trouxe, sempre. Ver o item 3 do cabeçalho.
 */
export function aplicarManuaisNoBlob(
  tipo: "dre" | "dfc",
  dados: Dados,
  manuais: ValorManual[],
  colunasAtualizadas: Set<string>,
  removidos: ValorManual[] = [],
  colunasReescritas: Set<string> = new Set(),
): { dados: Dados; updates: { id: string; valor_base: number | null; valor_aplicado: number }[] } {
  const rows = (dados.rows ?? []).map((r) => ({ ...r }));
  const columns = [...(dados.columns ?? [])];

  const porConta = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const conta = String(r["Conta"] ?? "").trim();
    if (conta) porConta.set(chave(conta), r);
  }

  const ler = (conta: string, col: string): number | null => num(porConta.get(chave(conta))?.[col]);

  /** Escreve preservando a grafia que já está na base ("Encargos sociais" vs
   *  "Encargos Sociais"): criar a variante faria duas linhas para a mesma
   *  rubrica, e a tela indexa por rótulo — uma esconderia a outra. */
  const escrever = (conta: string, col: string, valor: number | null) => {
    let row = porConta.get(chave(conta));
    if (!row) {
      if (valor === null) return;
      row = { Conta: conta };
      porConta.set(chave(conta), row);
      rows.push(row);
    }
    if (valor === null) delete row[col];
    else row[col] = cent(valor);
    // Mês que ainda não existia no blob (ex.: provisão lançada antes do
    // fechamento). "Conta" tem sortKey -1 e continua na frente.
    if (!columns.includes(col)) {
      columns.push(col);
      columns.sort((a, b) => sortKey(a) - sortKey(b));
    }
  };

  // coluna → alvo (bloco pai ou total) → quanto somar
  const ajustes = new Map<string, Map<string, number>>();
  const acumular = (col: string, alvo: string, delta: number) => {
    if (!delta) return;
    let m = ajustes.get(col);
    if (!m) { m = new Map(); ajustes.set(col, m); }
    m.set(alvo, (m.get(alvo) ?? 0) + delta);
  };
  const repercutir = (rubrica: string, col: string, delta: number) => {
    if (!delta) return;
    const { ancestrais, totais } = alvosDoAjuste(tipo, rubrica);
    for (const alvo of [...ancestrais, ...totais]) acumular(col, alvo, delta);
  };

  // 1) desfaz os apagados — devolve a célula ao automático e tira o delta do total
  for (const m of removidos) {
    if (colunasAtualizadas.has(m.col_key)) continue; // já voltou ao automático sozinho
    escrever(m.rubrica, m.col_key, m.valor_base);
    if (m.valor_aplicado != null) repercutir(m.rubrica, m.col_key, -(m.valor_aplicado - (m.valor_base ?? 0)));
  }

  // 2) aplica os vigentes
  const updates: { id: string; valor_base: number | null; valor_aplicado: number }[] = [];
  for (const m of manuais) {
    const refrescada = colunasAtualizadas.has(m.col_key);
    const naTela = ler(m.rubrica, m.col_key);

    /* `refrescada` diz que a escrita refez a COLUNA, mas o merge é por CÉLULA:
       numa rubrica que o Omie não tem — justamente o caso que faz alguém digitar
       à mão — o sync não escreve nada e o número da vez passada continua lá.
       Ler a célula devolveria o próprio manual como se fosse a base automática,
       o delta sairia zero e o total, que o sync RECALCULOU sem o manual, ficaria
       sem o ajuste para sempre. Se a célula é exatamente o que gravamos, o sync
       não passou por ela: a base é a de antes, não ela mesma.

       Salvo no IMPORT, onde a coluna inteira foi apagada e regravada do arquivo:
       ali "a célula bate com o valor_aplicado" não é sinal de que ninguém passou
       por ela — é o esperado, porque o tracker traz o mesmo número que se
       digitou. Tratar isso como intocada ressomaria o delta contra um
       `valor_base` velho e envenenaria todos os totais do mês. */
    const reescrita = colunasReescritas.has(m.col_key);
    const intocada = !reescrita && refrescada && m.valor_aplicado != null && naTela != null
      && cent(naTela) === cent(m.valor_aplicado);

    // Nunca aplicado ⇒ a célula ainda é automática, mesmo em coluna travada.
    const base = intocada || (!refrescada && m.valor_aplicado != null)
      ? m.valor_base
      : naTela;
    const baseNum = base ?? 0;
    const resultado = cent(m.modo === "soma" ? baseNum + Number(m.valor) : Number(m.valor));

    const deltaAntigo = !refrescada && m.valor_aplicado != null
      ? m.valor_aplicado - (m.valor_base ?? 0)
      : 0;

    escrever(m.rubrica, m.col_key, resultado);
    repercutir(m.rubrica, m.col_key, cent(resultado - baseNum - deltaAntigo));

    if (base !== m.valor_base || resultado !== m.valor_aplicado) {
      updates.push({ id: m.id, valor_base: base, valor_aplicado: resultado });
    }
  }

  // 3) repercute nos blocos e totais — só onde a linha JÁ existe naquele mês.
  //    Somar delta em cima do nada viraria um "Lucro Líquido" feito só do ajuste.
  for (const [col, alvos] of ajustes) {
    for (const [alvo, delta] of alvos) {
      const atual = ler(alvo, col);
      if (atual == null) continue;
      escrever(alvo, col, atual + delta);

      /* Cashburn é o fluxo livre DO MÊS menos a captação extraordinária, então
         um ajuste em maio pesa só em maio. Enquanto ele foi soma móvel de 12
         meses, este delta cascateava por onze meses à frente. */
      if (tipo === "dfc" && alvo === "Fluxo Livre") {
        const cb = ler(CASHBURN, col);
        if (cb != null) escrever(CASHBURN, col, cb + delta);
      }
    }
  }

  const temValor = (row: Record<string, unknown>) =>
    Object.keys(row).some((k) => k !== "Conta" && row[k] !== undefined && row[k] !== null && row[k] !== "");

  return { dados: { columns, rows: rows.filter(temValor) }, updates };
}

/**
 * Lê os manuais do banco, aplica no blob e devolve o blob pronto para gravar.
 * Falha de leitura NÃO derruba a escrita: a demonstração automática é melhor que
 * demonstração nenhuma — mas o erro vai para o log, porque um manual que sumiu
 * em silêncio é justamente o que ninguém percebe.
 */
export async function aplicarValoresManuais(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tipo: "dre" | "dfc",
  dados: Dados,
  colunasAtualizadas: Set<string>,
  removidos: ValorManual[] = [],
  colunasReescritas: Set<string> = new Set(),
): Promise<Dados> {
  const { data, error } = await supabase
    .from("demonstracoes_valor_manual")
    .select("id,tipo,rubrica,col_key,modo,valor,valor_base,valor_aplicado")
    .eq("tipo", tipo);
  if (error) {
    console.error("valores-manuais: não consegui ler os manuais:", error.message);
    return dados;
  }

  const manuais: ValorManual[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    tipo,
    rubrica: String(r.rubrica ?? ""),
    col_key: String(r.col_key ?? ""),
    modo: r.modo === "soma" ? "soma" : "substitui",
    valor: Number(r.valor ?? 0),
    valor_base: r.valor_base == null ? null : Number(r.valor_base),
    valor_aplicado: r.valor_aplicado == null ? null : Number(r.valor_aplicado),
  }));
  if (!manuais.length && !removidos.length) return dados;

  const r = aplicarManuaisNoBlob(tipo, dados, manuais, colunasAtualizadas, removidos, colunasReescritas);

  for (const u of r.updates) {
    const { error: upErr } = await supabase
      .from("demonstracoes_valor_manual")
      .update({ valor_base: u.valor_base, valor_aplicado: u.valor_aplicado })
      .eq("id", u.id);
    if (upErr) console.error("valores-manuais: não consegui atualizar a base da célula:", upErr.message);
  }

  return r.dados;
}
