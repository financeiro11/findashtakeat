import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload, ChevronDown, ChevronRight, Search, Sparkles, Loader2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mesesDeReferencia } from "@/lib/mesReferencia";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { OmieDeParaPanel } from "@/components/OmieDeParaPanel";
import { runOmieSync } from "@/lib/omieSync";
import { SyncOmieButtons } from "@/components/SyncOmieButtons";
import { MesesTravadosChip, CadeadoColuna, alternarTrava } from "@/components/demonstracoes/MesesTravados";
import { LancamentosSheet, type AlvoLancamentos } from "@/components/demonstracoes/LancamentosSheet";
import {
  useReclassificacoes, chaveCelula, tituloReclassificacao,
  MarcaReclassificacao, ResumoReclassificacoes, fundoCelulaReclassificacao,
} from "@/components/demonstracoes/Reclassificacoes";
import {
  useJustificativas, MarcaJustificativa, ResumoJustificativas, fundoCelulaJustificativa,
} from "@/components/demonstracoes/Justificativas";
import {
  usePerguntas, MarcaPerguntas, ResumoPerguntas, tituloPerguntas,
} from "@/components/demonstracoes/Perguntas";
import { montarPergunta } from "@/lib/perguntas";
import {
  useValoresManuais, EditorValorManual, ResumoValoresManuais,
  fundoCelulaManual, tituloValorManual,
} from "@/components/demonstracoes/ValoresManuais";
import {
  useAjustesEbitda, PainelAjustesEbitda, ResumoAjustesEbitda,
  fundoCelulaAjuste, tituloAjustes, aceitos, type AlvoAjustes,
} from "@/components/demonstracoes/AjustesEbitda";
import {
  LINHAS_DO_AJUSTE, LINHA_AJUSTES, LINHA_EBITDA_AJUSTADO, precisaRecalcular,
} from "@/lib/ebitdaAjustado";
import { gerarJustificativas } from "@/lib/justificativas";
import Analises from "@/components/demonstracoes/Analises";
import { MarcaComposicao, tituloComposicao } from "@/components/demonstracoes/ComposicaoCelula";
import {
  composicaoDaCelula, temComposicao, noDaRubrica, type LeitorDaCelula,
} from "@/lib/composicaoCelula";
import { useFormatoNumero, SeletorFormato } from "@/components/demonstracoes/FormatoNumero";

/* ============================================================
 *  Helpers
 * ============================================================ */

const MES_PT_TO_EN: Record<string, string> = {
  jan: "Jan", fev: "Feb", mar: "Mar", abr: "Apr", mai: "May", jun: "Jun",
  jul: "Jul", ago: "Aug", set: "Sep", out: "Oct", nov: "Nov", dez: "Dec",
};
const MES_PT_FULL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EN_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function colKey(ptLabel: string): string | null {
  // "jan/24" => "Jan-24"
  const m = ptLabel?.toString().toLowerCase().trim().match(/^([a-zçãéê]{3,})[\s\/\-]+(\d{2,4})$/);
  if (!m) return null;
  const en = MES_PT_TO_EN[m[1].slice(0, 3)];
  if (!en) return null;
  const yy = m[2].length === 4 ? m[2].slice(-2) : m[2];
  return `${en}-${yy}`;
}
function ptLabelFromKey(k: string): string {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return k;
  const idx = EN_ORDER.indexOf(m[1]);
  return idx >= 0 ? `${MES_PT_FULL[idx]}/${m[2]}` : k;
}
function sortKey(k: string): number {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return -1;
  const i = EN_ORDER.indexOf(m[1]);
  if (i < 0) return -1;
  return (2000 + parseInt(m[2], 10)) * 12 + i;
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  s = s.replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}
function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v as number)) return "—";
  const abs = Math.abs(v);
  let str: string;
  if (abs >= 1_000_000) str = `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")} M`;
  else if (abs >= 1_000) str = `R$ ${(v / 1_000).toFixed(1).replace(".", ",")} K`;
  else str = `R$ ${v.toFixed(0)}`;
  return str;
}
function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v as number)) return "—";
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}
/** Valor cheio pro tooltip — o número na tela é sempre abreviado (M/K) ou
 * arredondado, e às vezes é preciso conferir o centavo. */
function tituloValor(v: number | null | undefined, pct: boolean): string | undefined {
  if (v === null || v === undefined || isNaN(v as number)) return undefined;
  return pct
    ? `${valorExato(v * 100, { moeda: false, casas: 4 })}%`
    : valorExato(v);
}

// Corta as colunas do import nas que têm dado real e substancial — planilhas de tracker
// costumam ter o ano inteiro (ou vários anos) de cabeçalho, mas só os meses já FECHADOS
// vêm de fato preenchidos; os meses futuros ficam em branco ou com lixo esporádico
// (ex.: uma fórmula do template deixando "1" numa célula). Sem esse corte, o import travava
// e sobrescrevia meses que nem estavam fechados ainda — inclusive apagando o que o Omie já
// tinha calculado pra eles. Mesmo critério do heurístico de lastCol/prevCol (linha populada
// em pelo menos 25% do máximo, piso de 3), parando no primeiro mês que não bate o critério.
function colunasFechadas(rows: Record<string, any>[], colsOrdenadas: string[]): string[] {
  const counts = colsOrdenadas.map((col) => rows.reduce((acc, row) => (typeof row[col] === "number" ? acc + 1 : acc), 0));
  const maxCount = Math.max(...counts, 0);
  if (maxCount === 0) return [];
  const minCount = Math.max(3, Math.ceil(maxCount * 0.25));
  let ultimoIdx = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] >= minCount) ultimoIdx = i;
    else break;
  }
  return colsOrdenadas.slice(0, ultimoIdx + 1);
}

/* ============================================================
 *  DRE schema (hierarchy)
 * ============================================================ */

// Esquema e cálculo vivem em lib/demonstracoes-schema — compartilhados com o
// Histórico Multianual, para as três telas não divergirem.
import { DRE_SCHEMA, indexarCelulas, rotulosDeDespesa, type Kind, type Node } from "@/lib/demonstracoes-schema";

const flattenLabels = (nodes: Node[]): string[] =>
  nodes.flatMap((n) => [n.label, ...(n.children ? flattenLabels(n.children) : [])]);
const DRE_RUBRICAS = flattenLabels(DRE_SCHEMA);
// Rubricas que descem de um bloco "(-)": o valor manual delas entra negativo.
const DRE_DESPESAS = rotulosDeDespesa(DRE_SCHEMA);

/* ============================================================
 *  Page
 * ============================================================ */

export default function DRE() {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState<"dre" | "depara">("dre");
  const [tab, setTab] = useState<"valores" | "mom" | "pct" | "analises">("valores");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [travados, setTravados] = useState<Set<string>>(new Set());
  const [travaOcupada, setTravaOcupada] = useState<string | null>(null);
  const [auditando, setAuditando] = useState<AlvoLancamentos | null>(null);
  const { reclassificacoes, recarregarReclassificacoes } = useReclassificacoes("dre");
  const { justificativas, recarregarJustificativas } = useJustificativas("dre");
  const { perguntas, recarregarPerguntas } = usePerguntas("dre");
  const { manuais, recarregarManuais } = useValoresManuais("dre");
  const { ajustes, ajustesCarregados, recarregarAjustes } = useAjustesEbitda();
  const [ajustando, setAjustando] = useState<AlvoAjustes | null>(null);
  const conferiuAjustes = useRef(false);
  const [gerandoJust, setGerandoJust] = useState(false);
  const [progressoJust, setProgressoJust] = useState<string | null>(null);
  const [apenasUltimoMes, setApenasUltimoMes] = useState(false);
  /* Reduzido cabe o ano inteiro na tela; completo é o número que se confere
     contra o Omie. Guardado por navegador e compartilhado com a DFC. */
  const { formato, escolher: escolherFormato, fmtNum, largura } = useFormatoNumero();
  const fileRef = useRef<HTMLInputElement>(null);

  // Anos disponíveis a partir das colunas
  const availableYears = useMemo(() => {
    const ys = new Set<string>();
    for (const c of columns) {
      const m = c.match(/^[A-Za-z]{3}-(\d{2})$/);
      if (m) ys.add(m[1]);
    }
    return Array.from(ys).sort();
  }, [columns]);

  /* Colunas visíveis após filtro de ano.
     Meses futuros ainda não fechados vêm no cabeçalho da planilha mas sem nenhum
     valor — apareciam como uma coluna zerada/em branco no fim da tabela. Cortamos
     essas colunas vazias do FIM (as do meio ficam, pois indicam buraco real). */
  const displayColumns = useMemo(() => {
    let cols = yearFilter === "all" ? columns : columns.filter(c => c.endsWith(`-${yearFilter}`));
    const temDado = (c: string) => rows.some((r) => {
      const n = toNum(r[c]);
      return n !== null && n !== 0;
    });
    let fim = cols.length;
    while (fim > 0 && !temDado(cols[fim - 1])) fim--;
    if (fim > 0) cols = cols.slice(0, fim);
    return cols;
  }, [columns, yearFilter, rows]);


  useEffect(() => { document.title = "Demonstrações Financeiras · DRE"; }, []);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: travasData }] = await Promise.all([
      supabase
        .from("demonstracoes_contabeis" as any)
        .select("dados,updated_at")
        .eq("tipo", "dre")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("demonstracoes_mes_trancado" as any).select("col_key"),
    ]);
    const raw: any = (data as any)?.dados;
    let r: any[] = [];
    let cols: string[] = [];
    if (raw) {
      if (Array.isArray(raw)) { r = raw; cols = r[0] ? Object.keys(r[0]) : []; }
      else if (Array.isArray(raw.rows)) { r = raw.rows; cols = raw.columns || (r[0] ? Object.keys(r[0]) : []); }
    }
    const monthCols = cols.filter(c => /^[A-Za-z]{3}-\d{2}$/.test(c)).sort((a, b) => sortKey(a) - sortKey(b));
    setColumns(monthCols);
    setRows(r);
    setTravados(new Set(((travasData as any[]) ?? []).map((t) => String(t.col_key))));
    setLoading(false);
    // Devolve o que acabou de ler: quem dispara a geração de justificativas logo
    // depois de um import precisa dos dados NOVOS, e o estado do React só estará
    // atualizado no próximo render.
    return { rows: r, columns: monthCols };
  };
  useEffect(() => { load(); }, []);

  /* ----- Justificativas de variação -------------------------------------
   * O comentário que antes era escrito à mão em cima da célula do tracker.
   * Roda quando o mês FECHA (import do tracker, trava da coluna) e sob demanda
   * pelo botão do resumo. Mês aberto não entra: o número ainda vai mudar, e o
   * comentário congelado sobreviveria ao fechamento descrevendo um mês pela
   * metade. Um mês por chamada — ver lib/justificativas.ts. */
  const gerarJust = async (
    force: boolean,
    meses: string[],
    base?: { rows: Record<string, unknown>[]; columns: string[] },
    /* Quem acabou de travar a coluna não pode esperar o estado do React: o mês
       recém-fechado ainda não está em `travados` e a geração o descartaria. */
    travadosAgora?: Set<string>,
  ) => {
    const cols = base?.columns ?? columns;
    const alvo = meses.filter((m) => cols.indexOf(m) > 0);
    if (!alvo.length) return;
    setGerandoJust(true);
    setProgressoJust(`0/${alvo.length}`);
    try {
      const r = await gerarJustificativas({
        tipo: "dre",
        schema: DRE_SCHEMA,
        columns: cols,
        rows: base?.rows ?? rows,
        meses: alvo,
        travados: travadosAgora ?? travados,
        force,
        onProgress: (p) => setProgressoJust(`${p.indice}/${p.total}`),
      });
      if (r.erros.length) toast.error("Justificativas: " + r.erros[0]);
      else if (r.geradas) {
        toast.success(
          `${r.geradas} justificativa(s) de variação gerada(s).`
          + (r.semLastro ? ` ${r.semLastro} célula(s) variaram sem lançamento no Omie que explicasse — sem comentário.` : ""),
        );
      }
      else if (r.puladas) toast.message("Nenhuma variação nova para justificar.");
      else if (r.ignorados.length && !r.meses) {
        toast.message("Justificativa só sai em mês travado — é o mês fechado, com os números que não mudam mais.");
      }
      await recarregarJustificativas();
    } catch (e) {
      toast.error("Falha ao gerar justificativas: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGerandoJust(false);
      setProgressoJust(null);
    }
  };

  const sincronizarOmie = async (forcar: boolean) => {
    setSyncing(true);
    toast.message(forcar
      ? "Buscando dados do Omie (pode levar ~1–2 min)…"
      : "Recalculando com o cache do Omie…");
    try {
      const r = await runOmieSync({ forcar });
      if (r.status === "ok") {
        toast.success(
          `Omie sincronizado · ${r.movimentos ?? 0} lançamentos` +
          (r.nao_mapeadas ? ` · ${r.nao_mapeadas} categoria(s) sem DE_PARA` : ""),
        );
        const base = await load();
        // O sync só mexe em mês ABERTO — e mês aberto não ganha comentário. Isto
        // aqui só apanha o caso em que um mês travado foi corrigido por fora (o
        // valor manual, por exemplo): a função compara os números e, se não
        // mudou nada, não gasta uma ida à IA.
        await gerarJust(false, base.columns.slice(-3), base);
      } else if (r.status === "erro") {
        toast.error("Falha na sincronização: " + (r.erro || "erro desconhecido"));
      } else {
        toast.message("A sincronização continua rodando em segundo plano. Recarregando o que já temos…");
        await load();
      }
    } catch (e: any) {
      toast.error("Falha ao sincronizar com o Omie: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  /* Destravar sozinho não muda nada na tela: a coluna continua exibindo o valor
     congelado até alguém recalcular. Como o cache do Omie já está no Supabase, o
     recálculo é instantâneo e não consome a API — então destravar já emenda nele
     e o mês aparece preenchido no mesmo clique. Travar é só congelar o que está
     na tela, não precisa recalcular. */
  const alterarTrava = async (col: string, travar: boolean) => {
    setTravaOcupada(col);
    try {
      if (!(await alternarTrava(col, travar))) return;
      if (travar) {
        const base = await load();
        toast.success(`${ptLabelFromKey(col)} travado — o Omie não sobrescreve mais esse mês.`);
        // Travar É fechar o mês: é aqui que o comentário do tracker era escrito,
        // e é o único momento em que os números já são os definitivos.
        await gerarJust(false, [col], base, new Set([...travados, col]));
      } else {
        toast.message(`${ptLabelFromKey(col)} destravado. Preenchendo com o que já veio do Omie…`);
        await sincronizarOmie(false);
      }
    } finally {
      setTravaOcupada(null);
    }
  };

  // Default: ao carregar, seleciona o ano mais recente com dados
  useEffect(() => {
    if (yearFilter !== "all") return;
    if (!lastCol) return;
    const m = lastCol.match(/^[A-Za-z]{3}-(\d{2})$/);
    if (m) setYearFilter(m[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  /* ----- Lookup map by label -----
   * Soma as duas grafias da mesma rubrica (a do tracker e a do DE_PARA do Omie)
   * em vez de deixar uma sobrescrever a outra — ver `indexarCelulas`. */
  const valueByLabel = useMemo(() => indexarCelulas(rows, columns), [rows, columns]);

  function valuesFor(label: string): Record<string, number | null> {
    return valueByLabel.get(label.toLowerCase()) ?? Object.fromEntries(columns.map(c => [c, null]));
  }
  function valueAt(label: string, col: string): number | null {
    return valuesFor(label)[col] ?? null;
  }

  /* ----- A linha ajustada ficou para trás? -----------------------------
   * "EBITDA Ajustado" é derivada, e quem escreve o blob é que a refaz. Um
   * escritor que ainda não conhece a regra — o omie-sync do cron, por exemplo —
   * mexe no EBITDA de um mês aberto e deixa a linha atrás. Em vez de exigir que
   * todo escritor saiba, a tela confere e manda recalcular SÓ quando divergiu.
   * Uma vez por sessão: se depois do recálculo ainda divergir, é bug de cálculo
   * e ficar chamando em círculo só esconderia isso. */
  useEffect(() => {
    if (!ajustesCarregados || !rows.length || !columns.length) return;
    if (conferiuAjustes.current) return;
    const atrasada = precisaRecalcular(
      columns,
      (c) => valueAt("EBITDA", c),
      (c) => valueAt(LINHA_EBITDA_AJUSTADO, c),
      (c) => aceitos(ajustes.get(c)),
    );
    if (!atrasada) return;
    conferiuAjustes.current = true;
    supabase.functions
      .invoke("demonstracoes-ebitda-ajuste", { body: { acao: "recalcular" } })
      .then(() => load())
      .catch(() => { /* acessório: a DRE segue com o resto na tela */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ajustesCarregados, rows, columns, ajustes]);

  /* ----- Import (Tracker template) ----- */
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
      toast.error("Formato não suportado. Envie um arquivo .xlsx, .xls ou .csv.");
      e.target.value = "";
      return;
    }
    setImporting(true);
    try {
      let matrix: any[][] = [];
      if (ext === "csv") {
        // Detecta encoding e parseia manualmente (separador ; com vírgula decimal BR)
        const buf = await f.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { text = new TextDecoder("windows-1252").decode(bytes); }
        // Detecta delimitador
        const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
        const delim = (firstLines.match(/;/g)?.length ?? 0) > (firstLines.match(/,/g)?.length ?? 0) ? ";" : ",";
        // Parser CSV simples com aspas
        const parseCsv = (src: string, d: string): string[][] => {
          const out: string[][] = [];
          let row: string[] = [], cur = "", inQ = false;
          for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            if (inQ) {
              if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
              else if (ch === '"') inQ = false;
              else cur += ch;
            } else {
              if (ch === '"') inQ = true;
              else if (ch === d) { row.push(cur); cur = ""; }
              else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
              else if (ch === "\r") { /* skip */ }
              else cur += ch;
            }
          }
          if (cur.length || row.length) { row.push(cur); out.push(row); }
          return out;
        };
        matrix = parseCsv(text, delim);
      } else {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as any[][];
      }

      // Encontra a linha de cabeçalho (contém "jan/24" ou similar) e a coluna do rótulo
      let headerRowIdx = -1;
      let labelColIdx = 1;
      for (let i = 0; i < Math.min(matrix.length, 20); i++) {
        const row = matrix[i] || [];
        if (row.some((c: any) => colKey(String(c ?? "")))) {
          headerRowIdx = i;
          // a coluna do rótulo costuma ser a que tem "Data"
          const dataCol = row.findIndex((c: any) => String(c ?? "").trim().toLowerCase() === "data");
          if (dataCol >= 0) labelColIdx = dataCol;
          break;
        }
      }
      if (headerRowIdx < 0) {
        toast.error("Não consegui identificar o cabeçalho de meses");
        return;
      }

      const headerRow = matrix[headerRowIdx];
      const monthMap: { idx: number; key: string }[] = [];
      headerRow.forEach((cell: any, idx: number) => {
        const k = colKey(String(cell ?? ""));
        if (k) monthMap.push({ idx, key: k });
      });
      // Ordena cronologicamente e dedupa
      const seenKeys = new Set<string>();
      const monthCols = monthMap
        .sort((a, b) => sortKey(a.key) - sortKey(b.key))
        .filter(m => { if (seenKeys.has(m.key)) return false; seenKeys.add(m.key); return true; });
      const cols = monthCols.map(m => m.key);

      // Localiza separadores das seções
      let dreStart = -1, dfcStart = -1;
      for (let i = headerRowIdx + 1; i < matrix.length; i++) {
        const lab = String(matrix[i]?.[labelColIdx] ?? "").trim().toLowerCase();
        if (!lab) continue;
        if (dreStart < 0 && lab.includes("demonstrativo de resultado")) dreStart = i;
        else if (dfcStart < 0 && (lab.includes("fluxo de caixa") || lab === "dfc")) { dfcStart = i; break; }
      }
      if (dreStart < 0) dreStart = headerRowIdx;
      const dreEnd = dfcStart > 0 ? dfcStart : matrix.length;
      const dfcEnd = matrix.length;

      const buildRows = (from: number, to: number): Record<string, any>[] => {
        const out: Record<string, any>[] = [];
        for (let i = from + 1; i < to; i++) {
          const row = matrix[i] || [];
          const lab = String(row[labelColIdx] ?? "").trim();
          if (!lab) continue;
          const rec: Record<string, any> = { Conta: lab };
          for (const m of monthCols) {
            const v = toNum(row[m.idx]);
            rec[m.key] = v === null ? "" : v;
          }
          out.push(rec);
        }
        return out;
      };

      const dreRows = buildRows(dreStart, dreEnd);
      const dfcRows = dfcStart > 0 ? buildRows(dfcStart, dfcEnd) : [];

      // Só considera "fechado" (grava + tranca) até o último mês com dado substancial em
      // cada demonstrativo — meses além disso (template ainda não preenchido) ficam de fora
      // e continuam sendo calculados normalmente pelo Sincronizar Omie.
      const dreColsFechadas = colunasFechadas(dreRows, cols);
      const dfcColsFechadas = colunasFechadas(dfcRows, cols);
      const mesesTrancados = new Set([...dreColsFechadas, ...dfcColsFechadas]);
      const colsIgnoradas = cols.filter((c) => !mesesTrancados.has(c));

      // Grava via edge function: mescla célula a célula com o que já existe (não substitui
      // o blob inteiro) e TRANCA os meses fechados deste arquivo — a partir de agora o
      // Sincronizar Omie não sobrescreve mais esses meses, só os que ainda estiverem abertos.
      const { data: impData, error: impErr } = await supabase.functions.invoke("demonstracoes-import", {
        body: {
          dre: dreColsFechadas.length ? { columns: ["Conta", ...dreColsFechadas], rows: dreRows } : undefined,
          dfc: dfcRows.length && dfcColsFechadas.length ? { columns: ["Conta", ...dfcColsFechadas], rows: dfcRows } : undefined,
        },
      });
      if (impErr) throw impErr;
      if ((impData as any)?.error) throw new Error((impData as any).error);
      toast.success(
        `Importado e travado: ${dreRows.length} linhas DRE` + (dfcRows.length ? ` · ${dfcRows.length} linhas DFC` : "") +
        ` · ${mesesTrancados.size} mês(es) trancado(s)` +
        (colsIgnoradas.length ? ` · ${colsIgnoradas.length} ignorado(s) por dado incompleto (${colsIgnoradas.map(ptLabelFromKey).join(", ")})` : ""),
        { duration: 8000 },
      );
      // Planilha nova = números novos: é exatamente aqui que os comentários do
      // tracker eram reescritos à mão. Justifica só os meses que o arquivo trouxe
      // — e são justamente os que ele acabou de travar, então entram na lista de
      // travados à mão: o `load()` acima repovoa o estado, mas só no próximo render.
      const base = await load();
      await gerarJust(false, [...mesesTrancados], base, new Set([...travados, ...mesesTrancados]));
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
      e.target.value = "";
    }
  };

  /* ----- KPIs: o último mês com demonstração, contra o anterior -----
   * Ver src/lib/mesReferencia.ts. Em resumo: "travado" NÃO quer dizer "fechado"
   * — o import tranca toda coluna do arquivo, inclusive as futuras, e Ago/26
   * chegou com 19 células e sem Receita Líquida. Sem âncora não há o que
   * resumir num cartão. */
  const { lastCol, prevCol } = useMemo(
    () => mesesDeReferencia(columns, rows, travados, "dre"),
    [columns, rows, travados],
  );

  function kpi(label: string): { val: number | null; prev: number | null; delta: number | null } {
    const row = valuesFor(label);
    const v = lastCol ? row[lastCol] : null;
    const p = prevCol ? row[prevCol] : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }
  function pctKpi(num: string, den: string): { val: number | null; prev: number | null; delta: number | null } {
    const n = valuesFor(num); const d = valuesFor(den);
    const v = lastCol && d[lastCol] ? (n[lastCol]! / d[lastCol]!) : null;
    const p = prevCol && d[prevCol] ? (n[prevCol]! / d[prevCol]!) : null;
    const dd = v != null && p != null ? v - p : null;
    return { val: v, prev: p, delta: dd };
  }

  const kpis: Array<{ key: string; title: string; val: number | null; prev: number | null; delta: number | null; pos: boolean; isPct?: boolean }> = [
    { key: "receita", title: "RECEITA LÍQUIDA", ...kpi("Receita Líquida"), pos: true },
    { key: "ebitda", title: "EBITDA", ...kpi("EBITDA"), pos: true },
    /* Ao lado do EBITDA de propósito: os dois juntos é que contam a história —
       um mês que desabou por causa de uma rescisão mostra a diferença aqui, sem
       ninguém precisar abrir a grade. */
    { key: "ebitdaAj", title: "EBITDA AJUSTADO", ...kpi(LINHA_EBITDA_AJUSTADO), pos: true },
    { key: "margem", title: "MARGEM EBITDA", ...pctKpi("EBITDA", "Receita Líquida"), pos: true, isPct: true },
    { key: "lucro", title: "LUCRO LÍQUIDO", ...kpi("Lucro Líquido"), pos: true },
    { key: "sga", title: "SG&A", ...kpi("(-) SG&A"), pos: false },
  ];

  /* ----- Render rows from schema ----- */
  type Flat = { node: Node; depth: number; hidden?: boolean };
  const flat: Flat[] = useMemo(() => {
    const out: Flat[] = [];
    const walk = (nodes: Node[], depth: number, parentCollapsed: boolean) => {
      for (const n of nodes) {
        out.push({ node: n, depth, hidden: parentCollapsed });
        if (n.children?.length) {
          const isCol = collapsed.has(n.label);
          walk(n.children, depth + 1, parentCollapsed || isCol);
        }
      }
    };
    walk(DRE_SCHEMA, 0, false);
    return out;
  }, [collapsed]);

  const filtered = useMemo(() => {
    if (!search.trim()) return flat;
    const q = search.toLowerCase();
    return flat.filter(f => f.node.label.toLowerCase().includes(q));
  }, [flat, search]);

  /* O numerador vem do `src` do esquema, não de adivinhação pelo rótulo. A régua
     antiga testava `label.includes("EBITDA")` primeiro, e "% Margem EBITDA
     Ajustado" caía nesse ramo: a linha mostrava a margem do EBITDA CONTÁBIL, com
     o nome do ajustado em cima. E os dois lados são lidos com `valorDaLinha`,
     que é o que a grade mostra — a margem passa a ser a divisão dos dois números
     que estão à vista, não de outros dois parecidos. */
  function getValueForRow(node: Node, col: string): number | null {
    if (node.kind === "percent" && node.pctOf) {
      // O `?? sem o "%"` nunca devolve o próprio rótulo — se devolvesse, ler o
      // numerador chamaria esta função de novo e a pilha estouraria.
      const numerador = valorDeRubrica(node.src ?? node.label.replace(/^%\s*/, ""), col);
      const den = valorDeRubrica(node.pctOf, col);
      if (numerador == null || den == null || den === 0) return null;
      return numerador / den;
    }
    return valueAt(node.label, col);
  }

  function toggle(label: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  function collapseAll() {
    const all = new Set<string>();
    const walk = (n: Node[]) => n.forEach(x => { if (x.children?.length) { all.add(x.label); walk(x.children); } });
    walk(DRE_SCHEMA);
    setCollapsed(all);
  }
  function expandAll() { setCollapsed(new Set()); }
  const allCollapsed = collapsed.size > 0;

  const monthsCount = columns.length;
  const lastLabel = lastCol ? ptLabelFromKey(lastCol) : "—";
  const prevLabel = prevCol ? ptLabelFromKey(prevCol) : "—";

  const sumChildren = (node: Node, col: string): number | null => {
    if (!node.children?.length) return valueAt(node.label, col);
    let total: number | null = null;
    for (const c of node.children) {
      const v = c.children?.length ? sumChildren(c, col) : valueAt(c.label, col);
      if (v != null) total = (total ?? 0) + v;
    }
    return total ?? valueAt(node.label, col);
  };

  /* QUALQUER linha com filhos é a soma dos filhos — não só as `header`. O número
     que o blob guarda para "Pessoal" ou "Receita Recorrente" só é reescrito no
     import do tracker; o omie-sync mexe nas folhas e deixa o pai para trás, então
     em mês destravado ele é lixo (Jul-26: Pessoal guardado -69.054 contra -557.477
     somando as equipes). Ler o pai do blob era o bug — some sempre. */
  const valorDaLinha = (node: Node, col: string): number | null =>
    node.children?.length ? sumChildren(node, col) : getValueForRow(node, col);

  /* O mesmo, mas a partir do RÓTULO — é o que a conferência de célula precisa
     para ler as parcelas com exatamente a regra da grade. Rubrica fora do
     esquema (o blob tem rubricas órfãs do Omie) lê o blob direto. */
  const valorDeRubrica = (rotulo: string, col: string): number | null => {
    const no = noDaRubrica(rotulo, "dre");
    return no ? valorDaLinha(no, col) : valueAt(rotulo, col);
  };

  /* Leitor da conferência, preso a um mês: `naTela` é o número que a grade
     mostra; `guardado` é o número cru do blob. É a diferença entre os dois que
     denuncia o total que ficou para trás. */
  const lerCelula = (col: string): LeitorDaCelula => ({
    tipo: "dre",
    naTela: (rotulo) => valorDeRubrica(rotulo, col),
    guardado: (rotulo) => valueAt(rotulo, col),
  });

  /* Perguntar e promover mexem em DUAS tabelas: o fio da célula e — quando a
     resposta vira o comentário oficial — a justificativa. Recarregar só o fio
     deixaria o balão exibindo o texto velho até a próxima visita à página. */
  const aposPergunta = async () => {
    await recarregarPerguntas();
    await recarregarJustificativas();
  };

  /* O dossiê que acompanha a pergunta, montado no instante do envio com a MESMA
     função que pintou a célula (`valorDaLinha`) — é o que garante que a resposta
     fale do número que está à vista. */
  const dossieDaCelula = (node: Node, col: string, valorNaTela: number | null) => () =>
    montarPergunta({
      tipo: "dre",
      schema: DRE_SCHEMA,
      rubrica: node.label,
      mes: col,
      colunas: columns,
      valorDaLinha,
      despesa: DRE_DESPESAS.has(node.label),
      travado: travados.has(col),
      valorNaTela,
    });

  /* ============================================================
   *  UI
   * ============================================================ */

  return (
    <div className="min-h-full bg-background">
      {/* header */}
      <div className="px-6 pt-5 pb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center gap-2">
            Demonstração do Resultado do Exercício
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-primary">DRE</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Demonstrativo de resultado · {lastLabel} · {prevLabel} · {monthsCount} meses · {rows.length} contas detectadas
            {columns.length > 0 && (
              <MesesTravadosChip
                columns={columns}
                travados={travados}
                label={ptLabelFromKey}
                ocupado={!!travaOcupada || syncing}
                onAlterar={alterarTrava}
              />
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-border p-0.5">
            <button
              onClick={() => setView("dre")}
              className={cn("h-7 rounded px-2.5 text-[12px] font-medium transition-colors", view === "dre" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              DRE
            </button>
            <button
              onClick={() => setView("depara")}
              className={cn("h-7 rounded px-2.5 text-[12px] font-medium transition-colors", view === "depara" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              DE-PARA
            </button>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 h-8 text-[11.5px] font-medium text-emerald-700">
            <Sparkles className="h-3.5 w-3.5" />
            Tracker vOMIE ativo · sincronizado
          </span>
          <Button variant="outline" size="sm" className="h-8 text-[12px]">Exportar</Button>
          <SyncOmieButtons
            syncing={syncing}
            onRecalcular={() => sincronizarOmie(false)}
            onAtualizar={() => sincronizarOmie(true)}
            recalcularHint="Recalcula a DRE/DFC com os dados já baixados do Omie (cache das últimas horas). Instantâneo e sem consumir a API do Omie. Use para refletir mudanças de DE_PARA ou de meses travados."
            atualizarHint="Busca os lançamentos direto do Omie agora, ignorando o cache, e recalcula. Mais lento (~1–2 min) e consome a API do Omie. Use quando lançou/alterou algo no Omie e quer refletir na hora."
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="h-8 text-[12px]"
          >
            {importing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Importar Excel/CSV
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onImport} />
        </div>
      </div>

      {view === "depara" ? (
        <OmieDeParaPanel demonstrativo="dre" rubricas={DRE_RUBRICAS} />
      ) : (
      <>
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 px-6 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map(k => {
          const isNeg = (k.val ?? 0) < 0;
          const deltaPos = (k.delta ?? 0) > 0;
          const goodDelta = k.pos ? deltaPos : !deltaPos;
          return (
            <div key={k.key} className="rounded-lg border border-border bg-card p-3.5">
              <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">{k.title}</div>
              <div className="mt-2 flex items-baseline justify-between">
                <div
                  className={cn("text-[19px] font-bold tracking-tight num cursor-help", isNeg ? "text-primary" : "text-foreground")}
                  title={tituloValor(k.val, !!k.isPct)}
                >
                  {k.isPct ? fmtPct(k.val) : (isNeg ? `(${fmtMoney(Math.abs(k.val ?? 0)).replace("R$ ", "R$ ")})` : fmtMoney(k.val))}
                </div>
                {k.delta != null && (
                  <span className={cn(
                    "text-[10.5px] font-semibold px-1.5 py-0.5 rounded num",
                    goodDelta ? "text-emerald-700 bg-emerald-50" : "text-primary bg-primary/10",
                  )}>
                    {deltaPos ? "▲" : "▼"} {Math.abs((k.delta ?? 0) * 100).toFixed(1).replace(".", ",")}%
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10.5px] font-medium text-foreground num">
                {lastLabel}
              </div>
              <div className="text-[10.5px] text-muted-foreground num">
                vs {prevLabel}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabs + search */}
      <div className="mt-4 px-6 flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex items-center gap-1">
          {[
            { id: "valores", label: "Valores" },
            { id: "mom", label: "Variação MoM" },
            { id: "pct", label: "% sobre receita" },
            { id: "analises", label: "Análises" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={cn(
                "h-9 px-3 text-[12.5px] font-medium border-b-2 -mb-px transition-colors",
                tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Buscar conta e colapsar são da grade; a aba Análises não tem grade.
            O filtro de ano fica: é ele que define a janela dos gráficos. */}
        <div className="flex items-center gap-2 pb-2">
          {tab !== "analises" && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar conta…"
                className="h-8 w-[200px] pl-7 text-[12px]"
              />
            </div>
          )}
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">Todos os anos</option>
            {availableYears.map(y => (
              <option key={y} value={y}>20{y}</option>
            ))}
          </select>
          {/* Reduzido para ler a série; completo para conferir o número contra o
              Omie. O hover com centavos continua nos dois. */}
          {tab !== "analises" && (
            <SeletorFormato formato={formato} onChange={escolherFormato} />
          )}
          {tab !== "analises" && (
            <Button variant="ghost" size="sm" className="h-8 text-[12px] text-muted-foreground" onClick={() => allCollapsed ? expandAll() : collapseAll()}>
              {allCollapsed ? "Expandir tudo" : "Colapsar tudo"}
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="px-6 pb-8">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : !rows.length ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Nenhum dado importado. Clique em <b>Importar Excel/CSV</b> para enviar o Tracker.
          </div>
        ) : tab === "analises" ? (
          /* A aba Análises não desenha a grade: recebe o mesmo blob que ela e
             monta as leituras que não cabem em linha e coluna. */
          <Analises rows={rows} columns={displayColumns} travados={travados} />
        ) : (
          <>
          {/* Só na aba "Valores": é onde as células estão marcadas. */}
          {tab === "valores" && <ResumoReclassificacoes mapa={reclassificacoes} />}
          {tab === "valores" && <ResumoValoresManuais mapa={manuais} colunas={displayColumns} />}
          {tab === "valores" && (
            <ResumoAjustesEbitda
              mapa={ajustes}
              colunas={displayColumns}
              onAbrir={(col) => setAjustando({
                col,
                colLabel: ptLabelFromKey(col).replace("/", " "),
                ebitda: valueAt("EBITDA", col),
              })}
            />
          )}
          {tab === "valores" && (
            <ResumoJustificativas
              mapa={justificativas}
              colunas={displayColumns}
              gerando={gerandoJust}
              progresso={progressoJust}
              onGerar={(force) => gerarJust(force, displayColumns)}
              apenasUltimoMes={apenasUltimoMes}
              onApenasUltimoMesChange={setApenasUltimoMes}
            />
          )}
          {tab === "valores" && <ResumoPerguntas mapa={perguntas} colunas={displayColumns} />}
          {/* A altura máxima é o que faz o cabeçalho grudar: `position: sticky`
              se prende ao container que ROLA, e um container que só rola na
              horizontal deixa o cabeçalho subir junto com a página. Com o teto,
              a grade rola por dentro e o mês fica sempre à vista — junto com a
              coluna de rubrica, que já era fixa. */}
          <div className="mt-3 max-h-[calc(100vh-190px)] overflow-auto rounded-lg border border-border bg-card">
            <table className="border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky left-0 top-0 z-30 bg-muted px-3 py-2 text-left text-[10px] font-semibold tracking-[0.08em] text-muted-foreground w-[220px] min-w-[220px] shadow-[1px_0_0_0_hsl(var(--border)),0_1px_0_0_hsl(var(--border))]">
                    RUBRICA
                  </th>
                  {displayColumns.map(c => (
                    <th
                      key={c}
                      className={cn(
                        "group/col sticky top-0 z-20 bg-muted px-1.5 py-2 text-right text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap num shadow-[0_1px_0_0_hsl(var(--border))]",
                        largura,
                      )}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        <CadeadoColuna
                          col={c}
                          travado={travados.has(c)}
                          label={ptLabelFromKey(c).replace("/", " ")}
                          ocupado={!!travaOcupada || syncing}
                          onAlterar={alterarTrava}
                        />
                        {ptLabelFromKey(c).replace("/", " ")}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ node, depth, hidden }) => {
                  if (hidden) return null;
                  const isHeader = node.kind === "header";
                  const isTotal = node.kind === "total";
                  const isPercent = node.kind === "percent";
                  const isChild = node.kind === "child";
                  const isLeaf = node.kind === "leaf";
                  const hasChildren = !!node.children?.length;
                  const isCol = collapsed.has(node.label);

                  // Row classes
                  const rowCls = cn(
                    "border-b border-border/60 transition-colors",
                    isTotal && "bg-emerald-50/40 font-semibold",
                    isPercent && "text-muted-foreground italic text-[11.5px]",
                    isHeader && "font-semibold",
                    !isHeader && !isTotal && !isPercent && "hover:bg-muted/30",
                  );

                  return (
                    // group/linha: o lápis de valor manual só aparece no hover da
                    // linha — um lápis em cada célula competiria com os números.
                    <tr key={node.label + depth} className={cn("group/linha", rowCls)}>
                      <td
                        className={cn(
                          "sticky left-0 z-[2] px-3 py-1.5 text-[12.5px] w-[220px] min-w-[220px] shadow-[1px_0_0_0_hsl(var(--border))]",
                          isTotal ? "bg-emerald-50" : "bg-card",
                        )}
                        style={{ paddingLeft: 12 + depth * 18 }}
                      >
                        <div className="flex items-center gap-1.5">
                          {hasChildren ? (
                            <button
                              onClick={() => toggle(node.label)}
                              className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                            >
                              {isCol ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          ) : (
                            <span className="inline-block w-4" />
                          )}
                          <span className={cn(
                            isTotal && "text-emerald-800",
                            isHeader && !isTotal && "text-foreground",
                            isChild && "text-foreground/85",
                            isLeaf && "text-muted-foreground",
                          )}>
                            {node.label}
                          </span>
                        </div>
                      </td>
                      {displayColumns.map((c, idx) => {
                        const ehUltimoMes = idx === displayColumns.length - 1;
                        let v: number | null = null;
                        if (tab === "valores") {
                          v = valorDaLinha(node, c);
                        } else if (tab === "mom") {
                          const idx = columns.indexOf(c);
                          const prev = idx > 0 ? columns[idx - 1] : null;
                          const cur = valorDaLinha(node, c);
                          const pre = prev ? valorDaLinha(node, prev) : null;
                          v = (cur != null && pre != null && pre !== 0) ? (cur - pre) / Math.abs(pre) : null;
                        } else {
                          // % sobre receita
                          const cur = valorDaLinha(node, c);
                          const rec = valueAt("Receita Líquida", c);
                          v = (cur != null && rec && rec !== 0) ? cur / rec : null;
                        }

                        const isNeg = (v ?? 0) < 0;
                        const display =
                          isPercent || tab === "mom" || tab === "pct"
                            ? fmtPct(v)
                            : (isNeg ? `(${fmtNum(Math.abs(v ?? 0))})` : fmtNum(v));
                        /* A conferência da célula de resultado — total, bloco e
                           margem. Fora da aba "Valores" o número é derivado (Δ,
                           % sobre receita) e não corresponde à conta do esquema,
                           então a marca sairia mentindo. */
                        const comp = tab === "valores" && temComposicao(node.label, "dre")
                          ? composicaoDaCelula(node.label, lerCelula(c))
                          : null;
                        /* Só folha abre auditoria: linha com filhos é soma, e total
                           e percentual são calculados — nenhuma delas vem de
                           lançamento, então não haveria o que listar. Fora da aba
                           "Valores" o número é derivado e não casaria com a soma. */
                        /* Marca só onde a célula é auditável: fora da aba "Valores"
                           o número é derivado e o clique não abre nada, então o
                           aviso seria um beco sem saída. */
                        /* As linhas do EBITDA Ajustado são DERIVADAS (a soma dos
                           ajustes aceitos e o EBITDA + ela): não vêm de
                           lançamento, não se digitam à mão e não se comentam.
                           Clicar nelas abre a curadoria, que é o único lugar
                           onde o número delas se mexe. */
                        const ehLinhaAjuste = LINHAS_DO_AJUSTE.has(node.label);
                        const podeAuditar = tab === "valores" && !isTotal && !isPercent && !hasChildren && !ehLinhaAjuste;
                        const alerta = podeAuditar ? reclassificacoes.get(chaveCelula(node.label, c)) : undefined;
                        /* A justificativa vale para QUALQUER linha da aba Valores,
                           inclusive header e total: no tracker os comentários mais
                           frequentes estão justamente em linhas somadas ("Receita
                           Bruta", "Pessoal"). Descartada continua aparecendo, só que
                           apagada — senão não haveria como restaurar. */
                        const just = tab === "valores"
                          ? justificativas.get(chaveCelula(node.label, c))
                          : undefined;
                        /* Uma marca só para "conversa sobre esta célula": onde há
                           comentário, o fio de perguntas mora dentro do balão;
                           onde não há, o "?" ocupa o MESMO lugar. Duas marcas
                           lado a lado alargariam a grade inteira para dizer a
                           mesma coisa duas vezes. */
                        const mostraJust = !!just && travados.has(c) && (!apenasUltimoMes || ehUltimoMes);
                        const perguntasDaCelula = tab === "valores"
                          ? perguntas.get(chaveCelula(node.label, c)) ?? []
                          : [];
                        /* Digitar valor vale nas MESMAS células que abrem
                           auditoria, e pelo mesmo motivo: linha com filhos é a
                           soma dos filhos, total e percentual são calculados —
                           o número digitado neles morreria no próximo recálculo. */
                        const editavel = podeAuditar;
                        const manual = editavel ? manuais.get(chaveCelula(node.label, c)) : undefined;
                        /* Célula vazia COM alerta continua clicável: existe
                           lançamento no Omie e a demonstração não mostra nada —
                           esconder a marca esconderia justamente esse buraco. */
                        const auditavel = podeAuditar && (v != null || !!alerta);
                        /* A célula de ajuste é clicável mesmo VAZIA: o mês sem
                           nenhum ajuste é justamente o que ainda não foi
                           garimpado, e esconder a porta esconderia o trabalho
                           que falta fazer. A linha de % fica de fora — é
                           consequência, não tem o que decidir nela. */
                        const curavel = tab === "valores"
                          && (node.label === LINHA_AJUSTES || node.label === LINHA_EBITDA_AJUSTADO);
                        const ajustesDoMes = curavel ? ajustes.get(c) : undefined;
                        const temAjuste = !!aceitos(ajustesDoMes).length;
                        return (
                          <td
                            key={c}
                            onClick={
                              auditavel ? () => setAuditando({
                                tipo: "dre", rubrica: node.label, mes: c,
                                mesLabel: ptLabelFromKey(c).replace("/", " "),
                                celula: v, travado: travados.has(c),
                              })
                              : curavel ? () => setAjustando({
                                col: c,
                                colLabel: ptLabelFromKey(c).replace("/", " "),
                                ebitda: valueAt("EBITDA", c),
                              })
                              : undefined
                            }
                            title={[
                              tituloValor(v, isPercent || tab === "mom" || tab === "pct"),
                              tituloComposicao(comp),
                              manual ? tituloValorManual(manual) : null,
                              alerta ? tituloReclassificacao(alerta) : null,
                              tituloPerguntas(perguntasDaCelula),
                              auditavel ? "clique para ver os lançamentos" : null,
                              curavel ? tituloAjustes(ajustesDoMes ?? []) : null,
                            ].filter(Boolean).join(" · ") || undefined}
                            className={cn(
                              "px-1.5 py-1.5 text-right text-[12px] num whitespace-nowrap",
                              largura,
                              v != null && "cursor-help",
                              isNeg && !isPercent ? "text-primary" : isTotal ? "text-emerald-800" : "text-foreground/90",
                              v == null && "text-muted-foreground/40",
                              auditavel && "cursor-pointer hover:bg-primary/10 hover:underline hover:decoration-dotted hover:underline-offset-2",
                              curavel && "cursor-pointer hover:bg-teal-100/60 hover:underline hover:decoration-dotted hover:underline-offset-2",
                              // Excludentes de propósito: dois `bg-*` na mesma célula
                              // dependeriam da ordem no CSS gerado, não da ordem aqui.
                              // O alerta de classificação errada tem prioridade; o
                              // valor manual vem antes do comentário porque muda o
                              // número, não só o entendimento dele.
                              alerta ? fundoCelulaReclassificacao(alerta)
                                : manual ? fundoCelulaManual()
                                : temAjuste ? fundoCelulaAjuste()
                                : comp?.divergente ? "bg-amber-100/70"
                                : just && fundoCelulaJustificativa(just),
                            )}
                          >
                            {/* Marcas em FILA à esquerda do número, cada uma na sua
                                caixa: antes o lápis era absoluto e pousava em cima
                                do triângulo e do balão. */}
                            <span className="inline-flex items-center justify-end gap-1">
                              {comp && v != null && (
                                <MarcaComposicao
                                  rubrica={node.label}
                                  mesLabel={ptLabelFromKey(c).replace("/", " ")}
                                  ler={lerCelula(c)}
                                  divergente={comp.divergente}
                                />
                              )}
                              {editavel && (
                                <EditorValorManual
                                  tipo="dre"
                                  rubrica={node.label}
                                  col={c}
                                  valorCelula={v}
                                  manual={manual}
                                  despesa={DRE_DESPESAS.has(node.label)}
                                  onSalvo={async () => { await load(); await recarregarManuais(); }}
                                />
                              )}
                              {alerta && <MarcaReclassificacao alerta={alerta} />}
                              {mostraJust ? (
                                <MarcaJustificativa
                                  justificativa={just!}
                                  onMudou={recarregarJustificativas}
                                  valorCelula={v}
                                  perguntas={perguntasDaCelula}
                                  montarPayload={dossieDaCelula(node, c, v)}
                                  onPerguntaMudou={aposPergunta}
                                />
                              ) : tab === "valores" ? (
                                <MarcaPerguntas
                                  rubrica={node.label}
                                  mes={c}
                                  valorCelula={v}
                                  perguntas={perguntasDaCelula}
                                  montarPayload={dossieDaCelula(node, c, v)}
                                  onMudou={aposPergunta}
                                />
                              ) : null}
                              {display}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <div>Valores em <b>R$</b>. Negativos entre parênteses · arredondamento na unidade.</div>
          <div>Importado de Tracker_vOMIE_Realizado.xlsx · sincronizado há 12 min</div>
        </div>
      </div>
      </>
      )}

      {/* Fechar o drill-down recarrega as marcas: quem ignorou um alerta lá
          dentro tem que ver a célula limpar aqui fora. */}
      <LancamentosSheet
        alvo={auditando}
        onClose={() => { setAuditando(null); recarregarReclassificacoes(); }}
        /* Trocar a categoria muda o Omie e o cache; a DRE só reflete depois de
           recalcular — o mesmo recálculo local do botão de sincronizar. */
        onCategoriaTrocada={async () => {
          await sincronizarOmie(false);
          await recarregarReclassificacoes();
        }}
      />

      {/* Decidir um ajuste reescreve a linha do EBITDA Ajustado dentro do blob —
          o `load()` é o que traz o número novo para a grade e para o KPI. */}
      <PainelAjustesEbitda
        alvo={ajustando}
        onClose={() => setAjustando(null)}
        onMudou={async () => { await load(); await recarregarAjustes(); }}
      />
    </div>
  );
}
