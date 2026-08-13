// Escrita de DRE/DFC (`demonstracoes_contabeis`) que RESPEITA meses travados
// (`demonstracoes_mes_trancado`) — usado tanto pelo import de Excel (tracker fechado)
// quanto pelo omie-sync, para que nenhum dos dois pise no mês fechado pelo outro.
//
// Duas fontes escrevem a mesma tabela, com prioridades DIFERENTES:
//   • Import de Excel  → é a fonte de VERDADE manual. Sempre grava os meses que traz,
//     mesmo que já estejam travados (é assim que se CORRIGE um mês já fechado — reimporta).
//     Ao final, tranca (ou re-tranca) exatamente os meses que vieram no arquivo.
//   • omie-sync        → é o dado "vivo"/provisório. NUNCA sobrescreve um mês travado —
//     só atualiza meses ainda abertos (o mês corrente e os futuros).
//
// O merge é por CÉLULA (rubrica × mês), não por linha nem por blob inteiro: uma rubrica
// que só existia nos dados antigos (e não veio nesta chamada) é preservada; uma rubrica
// nova é criada; dentro de uma rubrica já existente, só as colunas relevantes mudam.
//
// Depois do merge — e ANTES de gravar — os valores manuais são reaplicados por cima
// (ver valores-manuais.ts). É o que faz a depreciação digitada à mão sobreviver ao
// próximo sync, que reescreve a coluna inteira sem saber que ela existe.

import { aplicarValoresManuais } from "./valores-manuais.ts";
import { aplicarEbitdaAjustado } from "./ebitda-ajustado.ts";
import { recalcularDerivadas, chaveCelula } from "./derivadas.ts";
import { CASHBURN } from "./demonstracoes-schema.ts";

const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sortKey(k: string): number {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return -1;
  const i = EN.indexOf(m[1]);
  return i < 0 ? -1 : (2000 + parseInt(m[2], 10)) * 12 + i;
}

export type Dados = { columns: string[]; rows: Record<string, unknown>[] };

/**
 * Mescla `novo` nos dados já salvos para `tipo` ("dre"|"dfc") e grava.
 *
 * @param opts.travar Quando true: ESTA chamada é a fonte de verdade (import) — grava
 *   tudo que trouxe, ignorando travas existentes, e tranca os meses que trouxe ao final.
 *   Quando false/omitido: chamada "sync" — pula qualquer coluna já travada (preserva o
 *   valor salvo) e NUNCA tranca nada.
 */
export async function salvarDemonstracao(
  supabase: any,
  tipo: "dre" | "dfc",
  novo: Dados,
  opts: { travar?: boolean } = {},
): Promise<Dados> {
  const { data: existenteRow, error: selErr } = await supabase
    .from("demonstracoes_contabeis")
    .select("dados")
    .eq("tipo", tipo)
    .eq("periodo", "completo")
    .maybeSingle();
  if (selErr) throw selErr;
  const existente: Dados = (existenteRow?.dados as Dados) ?? { columns: [], rows: [] };

  let travadas = new Set<string>();
  if (!opts.travar) {
    const { data: travasRows, error: travaSelErr } = await supabase
      .from("demonstracoes_mes_trancado").select("col_key");
    if (travaSelErr) throw travaSelErr;
    travadas = new Set<string>((travasRows ?? []).map((t: any) => String(t.col_key)));
  }

  const mesesNovos = (novo.columns ?? []).filter((c) => c !== "Conta");
  const mesesExistentes = (existente.columns ?? []).filter((c) => c !== "Conta");
  const colSet = new Set<string>([...mesesExistentes, ...mesesNovos]);
  const columns = ["Conta", ...[...colSet].sort((a, b) => sortKey(a) - sortKey(b))];

  const porConta = new Map<string, Record<string, unknown>>();
  for (const r of existente.rows ?? []) {
    const conta = String((r as any)?.Conta ?? "").trim();
    if (conta) porConta.set(conta, { ...r });
  }

  // IMPORT (travar): o arquivo importado é a ÚNICA fonte para os meses que ele traz.
  // Antes de aplicar, ZERA esses meses em TODAS as linhas já salvas. Sem isto, rubricas
  // que só vieram do Omie (ex.: "Entrada de Receita") continuavam com valor no mesmo mês
  // e eram somadas junto com as do tracker sob o mesmo cabeçalho — o "somatório" errado
  // que aparecia no mês fechado. (No path sync, `travar` é falso e nada é zerado aqui.)
  if (opts.travar) {
    for (const base of porConta.values()) {
      for (const col of mesesNovos) delete (base as any)[col];
    }
  }

  for (const r of novo.rows ?? []) {
    const conta = String((r as any)?.Conta ?? "").trim();
    if (!conta) continue;
    const base = porConta.get(conta) ?? { Conta: conta };
    for (const col of mesesNovos) {
      if (travadas.has(col)) continue; // mês fechado (só no path sync): preserva o salvo
      base[col] = (r as any)[col];
    }
    porConta.set(conta, base);
  }

  // Remove linhas que ficaram SEM nenhum valor (só a coluna "Conta") — evita que rubricas
  // órfãs do Omie, cujos únicos meses foram substituídos por um import de tracker, fiquem
  // acumuladas no blob como linhas vazias.
  const temValor = (row: Record<string, unknown>) =>
    Object.keys(row).some(
      (k) => k !== "Conta" && row[k] !== undefined && row[k] !== null && row[k] !== "",
    );

  const bruto: Dados = { columns, rows: [...porConta.values()].filter(temValor) };

  // Colunas que ESTA escrita refez do zero: no import são todas as que o arquivo
  // trouxe; no sync, as que não estavam travadas (as travadas o loop acima pulou).
  // É por esta lista que o manual sabe se a célula voltou a ser automática.
  const colunasAtualizadas = new Set(
    mesesNovos.filter((c) => opts.travar || !travadas.has(c)),
  );
  /* No import, o bloco acima apagou CÉLULA A CÉLULA e regravou do arquivo — não
     existe célula que o escritor tenha pulado. O manual precisa saber disso: sem
     essa distinção ele reconhecia a célula recém-importada como "intocada" e
     ressomava aos totais a diferença contra um `valor_base` velho do Omie. Ver o
     item 3 do cabeçalho de valores-manuais.ts. */
  const colunasReescritas = new Set(opts.travar ? mesesNovos : []);

  /* IMPORT: o total que o arquivo trouxe É o total. O tracker é a demonstração
     que a diretoria fecha; quando ele escreve "Cashburn" ou "Fluxo de Caixa
     Livre" naquele mês, é esse número que vai à reunião — e recalcular por cima
     trocava o número sem avisar (as fórmulas do arquivo pulam parcela em vários
     meses: Fev/26 "Saídas" sem "Retenção de Contribuição", Jun/26 "Entradas"
     sem "Receita Markup"). Continuam derivadas as linhas que o arquivo NÃO tem —
     os blocos do esquema ("Pessoal", "Custos de Operação"…) e o EBITDA Ajustado.
     No sync o conjunto é vazio: lá não existe total de fora, o Omie só dá folha. */
  const totaisDoArquivo = new Set<string>();
  if (opts.travar) {
    for (const r of novo.rows ?? []) {
      const conta = String((r as any)?.Conta ?? "").trim();
      if (!conta) continue;
      /* A ÚNICA exceção é o Cashburn, e é o próprio arquivo que a justifica: a
         régua dele muda de ano para ano na planilha. Em 2024 a célula não
         desconta a captação — Set/24 fica com "queima" de +1.316.290 no mês em
         que entrou R$ 1,4 M de empréstimo, que é o oposto do que a linha diz. De
         2026 a planilha desconta, e aí a nossa conta (fluxo livre do ARQUIVO
         menos empréstimo novo) devolve exatamente o número dela, mês a mês. Uma
         régua só, e ela bate com o tracker onde o tracker é coerente. */
      if (conta.trim().toLowerCase() === CASHBURN.toLowerCase()) continue;
      for (const col of mesesNovos) {
        const v = (r as any)[col];
        if (v !== undefined && v !== null && v !== "") totaisDoArquivo.add(chaveCelula(conta, col));
      }
    }
  }

  const comManuais = await aplicarValoresManuais(
    supabase, tipo, bruto, colunasAtualizadas, [], colunasReescritas,
  );
  // Depois dos manuais, nunca antes: o EBITDA Ajustado parte do EBITDA já
  // corrigido pela depreciação digitada à mão. Ver ebitda-ajustado.ts.
  const comAjustado = await aplicarEbitdaAjustado(supabase, tipo, comManuais);
  /* Por último, sempre: linha de cálculo é calculada. Quem escreveu antes —
     o arquivo do tracker, o Omie, o manual, o ajuste — mexeu nas FOLHAS; daqui
     para a frente bloco, total e margem são a soma delas, e o que a base guarda
     é o mesmo número que a tela mostra.
     SÓ nas colunas desta escrita: no import são os meses do arquivo (reimportar
     um mês fechado é o jeito de corrigi-lo, e é decisão de pessoa); no sync são
     os meses abertos. Mês travado que ninguém mandou reescrever não se toca.
     Ver derivadas.ts. */
  const dados = recalcularDerivadas(tipo, comAjustado, colunasAtualizadas, totaisDoArquivo);

  const { error: upErr } = await supabase.from("demonstracoes_contabeis").upsert(
    { tipo, periodo: "completo", dados, pdf_path: null },
    { onConflict: "tipo,periodo" },
  );
  if (upErr) throw upErr;

  if (opts.travar && mesesNovos.length) {
    const { error: travaErr } = await supabase.from("demonstracoes_mes_trancado")
      .upsert(mesesNovos.map((col_key) => ({ col_key, trancado_em: new Date().toISOString() })), { onConflict: "col_key" });
    if (travaErr) throw travaErr;
  }

  return dados;
}
