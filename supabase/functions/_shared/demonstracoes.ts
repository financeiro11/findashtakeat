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
  for (const r of novo.rows ?? []) {
    const conta = String((r as any)?.Conta ?? "").trim();
    if (!conta) continue;
    const base = porConta.get(conta) ?? { Conta: conta };
    for (const col of mesesNovos) {
      if (travadas.has(col)) continue; // mês fechado: preserva o que já está salvo
      base[col] = (r as any)[col];
    }
    porConta.set(conta, base);
  }

  const dados: Dados = { columns, rows: [...porConta.values()] };

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
