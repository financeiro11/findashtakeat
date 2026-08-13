import { useEffect, useMemo, useRef, useState } from "react";
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
  useJustificativas, MarcaJustificativa, ResumoJustificativas, RegerarJustificativas,
  fundoCelulaJustificativa,
} from "@/components/demonstracoes/Justificativas";
import { BarraStatus, rotuloPeriodo } from "@/components/demonstracoes/BarraStatus";
import {
  useValoresManuais, EditorValorManual, ResumoValoresManuais,
  fundoCelulaManual, tituloValorManual,
} from "@/components/demonstracoes/ValoresManuais";
import {
  usePerguntas, MarcaPerguntas, ResumoPerguntas, tituloPerguntas,
} from "@/components/demonstracoes/Perguntas";
import { gerarJustificativas } from "@/lib/justificativas";
import { montarPergunta } from "@/lib/perguntas";
import { useFormatoNumero, SeletorFormato } from "@/components/demonstracoes/FormatoNumero";
import { MarcaComposicao, tituloComposicao } from "@/components/demonstracoes/ComposicaoCelula";
import {
  composicaoDaCelula, temComposicao, noDaRubrica, type LeitorDaCelula,
} from "@/lib/composicaoCelula";
import { EscopoImportDialog } from "@/components/demonstracoes/EscopoImport";
import {
  lerTracker, corpoDoImport, ptLabelFromKey, sortKey, toNum, resumoMeses,
  type EscopoImport, type TrackerLido,
} from "@/lib/importarTracker";

/* ============================================================
 *  Helpers
 * ============================================================ */

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

/* ============================================================
 *  DFC schema (hierarchy)
 * ============================================================ */

// Esquema e cálculo vivem em lib/demonstracoes-schema — compartilhados com o
// Histórico Multianual, para as três telas não divergirem.
import {
  DFC_SCHEMA, indexarCelulas, mesAtras, rotulosDeDespesa, valorComAlias,
  CASHBURN, NOVOS_EMPRESTIMOS, cashburnDoMes, type Kind, type Node,
} from "@/lib/demonstracoes-schema";

const flattenLabels = (nodes: Node[]): string[] =>
  nodes.flatMap((n) => [n.label, ...(n.children ? flattenLabels(n.children) : [])]);
const DFC_RUBRICAS = flattenLabels(DFC_SCHEMA);

/* Rubricas em que o valor manual entra NEGATIVO. Aqui não basta o "(-)" do
   rótulo, como na DRE: na DFC o bloco de saídas se chama "Saídas Operacionais"
   e nenhum filho dele carrega o sinal — mas tudo ali sai do caixa. */
const DFC_DESPESAS = (() => {
  const marcadas = rotulosDeDespesa(DFC_SCHEMA);
  const saidas = DFC_SCHEMA.find((n) => n.label === "Saídas Operacionais");
  for (const l of flattenLabels(saidas?.children ?? [])) marcadas.add(l);
  return marcadas;
})();

/* ============================================================
 *  Page
 * ============================================================ */

export default function DFC() {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  /* Arquivo lido esperando a pessoa dizer quanto dele entra (ver EscopoImport). */
  const [pendente, setPendente] = useState<TrackerLido | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState<"dfc" | "depara">("dfc");
  const [tab, setTab] = useState<"valores" | "mom" | "acum">("valores");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [travados, setTravados] = useState<Set<string>>(new Set());
  const [travaOcupada, setTravaOcupada] = useState<string | null>(null);
  const [auditando, setAuditando] = useState<AlvoLancamentos | null>(null);
  const { reclassificacoes, recarregarReclassificacoes } = useReclassificacoes("dfc");
  const { justificativas, recarregarJustificativas } = useJustificativas("dfc");
  const { perguntas, recarregarPerguntas } = usePerguntas("dfc");
  const { manuais, recarregarManuais } = useValoresManuais("dfc");
  const [gerandoJust, setGerandoJust] = useState(false);
  const [progressoJust, setProgressoJust] = useState<string | null>(null);
  const [apenasUltimoMes, setApenasUltimoMes] = useState(false);
  /* Reduzido cabe o ano inteiro na tela; completo é o número que se confere
     contra o Omie. Guardado por navegador e compartilhado com a DRE. */
  const { formato, escolher: escolherFormato, fmtNum, largura } = useFormatoNumero();
  const fileRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => { document.title = "Demonstrações Financeiras · DFC"; }, []);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: travasData }] = await Promise.all([
      /* periodo='completo' é O registro da DFC — é nele que o import e o omie-sync
         escrevem (ver _shared/demonstracoes.ts). A mesma tabela guarda backups e
         placeholders sob outros períodos; sem este filtro, a tela pegava "a linha
         mais recente do tipo" e um backup criado depois congelava o painel: o
         import gravava certo em 'completo' e nada mudava. */
      supabase
        .from("demonstracoes_contabeis" as any)
        .select("dados,updated_at")
        .eq("tipo", "dfc")
        .eq("periodo", "completo")
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
        tipo: "dfc",
        schema: DFC_SCHEMA,
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

  /* ----- Lookup map by label ----- */
  /* Soma as duas grafias da mesma rubrica (a do tracker e a do DE_PARA do Omie)
     em vez de deixar uma sobrescrever a outra — ver `indexarCelulas`. Era o que
     escondia "Outras Despesas Adm" de Jul/26, com 54 lançamentos por trás. */
  const valueByLabel = useMemo(() => indexarCelulas(rows, columns), [rows, columns]);

  function valuesFor(label: string): Record<string, number | null> {
    return valueByLabel.get(label.toLowerCase()) ?? Object.fromEntries(columns.map(c => [c, null]));
  }
  function valueAt(label: string, col: string): number | null {
    return valuesFor(label)[col] ?? null;
  }

  /* ----- Import (Tracker template - reaproveita o mesmo fluxo do DRE, salva ambos) -----
   * Duas etapas: ler o arquivo (aqui) e, depois da pessoa escolher o escopo no diálogo,
   * gravar (`gravarImport`). Ler não muda nada — a decisão de quanto do histórico entra
   * é de quem importa. Ver lib/importarTracker.ts. */
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setImporting(true);
    try {
      const lido = await lerTracker(f);
      if (!lido.fechadas.length) {
        toast.error("Nenhum mês do arquivo veio preenchido o bastante para ser importado.");
        return;
      }
      setPendente(lido);
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
      e.target.value = "";
    }
  };

  /* Grava só os meses escolhidos. A edge function mescla célula a célula com o que
     já existe (não substitui o blob inteiro) e TRANCA os meses que recebeu — a partir
     de agora o Sincronizar Omie não sobrescreve mais esses meses, só os abertos. */
  const gravarImport = async (meses: string[], escopo: EscopoImport) => {
    const t = pendente;
    if (!t) return;
    setImporting(true);
    try {
      const { body, meses: gravados, dreColunas } = corpoDoImport(t, meses);
      if (!gravados.length) {
        toast.error("Nada a gravar neste escopo.");
        return;
      }
      const { data: impData, error: impErr } = await supabase.functions.invoke("demonstracoes-import", { body });
      if (impErr) throw impErr;
      if ((impData as any)?.error) throw new Error((impData as any).error);
      setPendente(null);
      const foraDoEscopo = t.fechadas.filter((c) => !gravados.includes(c));
      toast.success(
        `Importado e travado: ${body.dfc ? t.dfcRows.length : 0} linhas DFC` +
        (dreColunas.length ? ` · ${t.dreRows.length} linhas DRE` : "") +
        ` · ${resumoMeses(gravados)}` +
        (escopo !== "todos" && foraDoEscopo.length
          ? ` · ${foraDoEscopo.length} mês(es) do arquivo mantido(s) como estavam`
          : "") +
        (t.ignoradas.length
          ? ` · ${t.ignoradas.length} ignorado(s) por dado incompleto (${t.ignoradas.map(ptLabelFromKey).join(", ")})`
          : ""),
        { duration: 8000 },
      );
      // Planilha nova = números novos: é exatamente aqui que os comentários do
      // tracker eram reescritos à mão. Justifica só os meses que o arquivo gravou
      // — e são justamente os que ele acabou de travar, então entram na lista de
      // travados à mão: o `load()` acima repovoa o estado, mas só no próximo render.
      const base = await load();
      await gerarJust(false, gravados, base, new Set([...travados, ...gravados]));
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally {
      setImporting(false);
    }
  };

  /* ----- KPIs: o último mês com demonstração, contra o anterior -----
   * Ver src/lib/mesReferencia.ts. "Travado" não quer dizer "fechado": o import
   * tranca toda coluna do arquivo, inclusive os meses futuros que chegam quase
   * vazios. Sem o fluxo operacional o mês não tem o que resumir num cartão. */
  const { lastCol, prevCol } = useMemo(
    () => mesesDeReferencia(columns, rows, travados, "dfc"),
    [columns, rows, travados],
  );

  // Default ano = ano mais recente com dados
  useEffect(() => {
    if (yearFilter !== "all") return;
    if (!lastCol) return;
    const m = lastCol.match(/^[A-Za-z]{3}-(\d{2})$/);
    if (m) setYearFilter(m[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  function kpi(label: string): { val: number | null; prev: number | null; delta: number | null } {
    const row = valuesFor(label);
    const v = lastCol ? row[lastCol] : null;
    const p = prevCol ? row[prevCol] : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }

  /* Quanto queimou nos últimos 12 meses — a soma da QUEIMA de cada mês, não do
     fluxo livre. Somar o fluxo livre incluía os empréstimos tomados na janela:
     com os R$ 1,07 M de jan e os R$ 1,67 M de abr, o cartão marcava +309 mil em
     jul/26, como se a empresa tivesse gerado caixa no ano. */
  function cashburnKpi(): { val: number | null; prev: number | null; delta: number | null } {
    if (!lastCol) return { val: null, prev: null, delta: null };
    const idx = columns.indexOf(lastCol);
    if (idx < 0) return { val: null, prev: null, delta: null };
    const window = columns.slice(Math.max(0, idx - 11), idx + 1);
    const prevWindow = columns.slice(Math.max(0, idx - 23), Math.max(0, idx - 11));
    const sum = (cs: string[]) => cs.reduce((acc, c) => acc + (cashburnAt(c) ?? 0), 0);
    const v = sum(window);
    const p = prevWindow.length ? sum(prevWindow) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }

  /* O valor GRAVADO para a rubrica, sob qualquer um dos nomes que ela tenha na
     base. O tracker e o DE_PARA do Omie batizaram várias linhas da DFC
     diferente ("Entradas" × "Entradas Operacionais", "Antecipação" ×
     "Antecipação da Receita") e o que não casava por rótulo sumia da tela. */
  const valorGravado = (node: Node, col: string): number | null =>
    valorComAlias(node, (r) => valueAt(r, col));

  const sumChildren = (node: Node, col: string): number | null => {
    if (!node.children?.length) return valorGravado(node, col);
    let total: number | null = null;
    for (const c of node.children) {
      const v = c.children?.length ? sumChildren(c, col) : valorGravado(c, col);
      if (v != null) total = (total ?? 0) + v;
    }
    return total ?? valorGravado(node, col);
  };

  /* QUALQUER linha com filhos é a soma dos filhos — não só as `header`. O número
     que o blob guarda para "Pessoal" ou "Custos de Operação" só é reescrito no import do
     tracker; o omie-sync mexe nas folhas e deixa o pai para trás, então em mês
     destravado ele é lixo. Ler o pai do blob era o bug — some sempre. */
  const valorDaLinha = (node: Node, col: string): number | null =>
    node.children?.length ? sumChildren(node, col) : getValueForRow(node, col);

  /* O mesmo, mas a partir do RÓTULO — é o que a conferência de célula precisa
     para ler as parcelas com exatamente a regra da grade. Rubrica fora do
     esquema (o blob tem rubricas órfãs do Omie) lê o blob direto. */
  const valorDeRubrica = (rotulo: string, col: string): number | null => {
    const no = noDaRubrica(rotulo, "dfc");
    return no ? valorDaLinha(no, col) : valueAt(rotulo, col);
  };

  /* Leitor da conferência, preso a um mês: `naTela` é o número que a grade
     mostra; `guardado` é o número cru do blob. É a diferença entre os dois que
     denuncia o total que ficou para trás — e no fluxo de caixa esse total é
     justamente o número que diz se o mês queimou ou gerou dinheiro. */
  const lerCelula = (col: string): LeitorDaCelula => ({
    tipo: "dfc",
    naTela: (rotulo) => valorDeRubrica(rotulo, col),
    /* Também pelo apelido: sem isso o Σ do Fluxo Livre ficava MUDO — a linha do
       tracker se chama "Fluxo de Caixa Livre", o `guardado` vinha nulo e a
       conferência não tinha com o que comparar justamente na linha que mais
       importa da demonstração. */
    guardado: (rotulo) => {
      const no = noDaRubrica(rotulo, "dfc");
      return no ? valorGravado(no, col) : valueAt(rotulo, col);
    },
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
      tipo: "dfc",
      schema: DFC_SCHEMA,
      rubrica: node.label,
      mes: col,
      colunas: columns,
      valorDaLinha,
      despesa: DFC_DESPESAS.has(node.label),
      travado: travados.has(col),
      valorNaTela,
    });

  /* A mesma célula um mês atrás, como está NA GRADE — é o que a ponte de
     variação do painel usa para acusar quando a grade e o Omie discordam (mês
     travado vem do tracker). Sai vazio quando o mês anterior não está no blob
     carregado: melhor não confrontar do que confrontar com um nulo. */
  const parAnterior = (label: string, col: string) => {
    const ant = mesAtras(col);
    if (!ant || !columns.includes(ant)) return {};
    return { celulaAnterior: valueAt(label, ant), travadoAnterior: travados.has(ant) };
  };

  /* Derivados: o valor GRAVADO manda (é o que a diretoria assinou) e a soma só
     entra quando não há gravado. O apelido resolve o nome que o tracker usa —
     as três grafias à mão que havia aqui ("Entradas", "Saídas", "Saidas") viraram
     `alias` no esquema. */
  const entradasAt = (col: string): number | null => sumChildren(DFC_SCHEMA[0], col);
  const saidasAt = (col: string): number | null => sumChildren(DFC_SCHEMA[1], col);
  function fluxoOpAt(col: string): number | null {
    const v = valorGravado(DFC_SCHEMA[2], col);
    if (v != null) return v;
    const e = entradasAt(col); const s = saidasAt(col);
    return e != null || s != null ? (e ?? 0) + (s ?? 0) : null;
  }
  function fluxoLivreAt(col: string): number | null {
    const v = valorGravado(DFC_SCHEMA[5], col);
    if (v != null) return v;
    const op = fluxoOpAt(col);
    const inv = sumChildren(DFC_SCHEMA[3], col) ?? 0;
    const fin = sumChildren(DFC_SCHEMA[4], col) ?? 0;
    return op != null ? op + inv + fin : null;
  }
  /* A queima do mês: fluxo livre menos a captação extraordinária. O mês em que
     entrou empréstimo tem fluxo livre positivo e queima de meio milhão — é a
     queima que diz quanto tempo o caixa aguenta. Ver `cashburnDoMes`. */
  function cashburnAt(col: string): number | null {
    const v = valorGravado(DFC_SCHEMA[6], col);
    if (v != null) return v;
    return cashburnDoMes(fluxoLivreAt(col), valueAt(NOVOS_EMPRESTIMOS, col));
  }

  const entradasKpi = useMemo(() => {
    const v = lastCol ? entradasAt(lastCol) : null;
    const p = prevCol ? entradasAt(prevCol) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }, [lastCol, prevCol, valueByLabel]);

  const saidasKpiV = useMemo(() => {
    const v = lastCol ? saidasAt(lastCol) : null;
    const p = prevCol ? saidasAt(prevCol) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }, [lastCol, prevCol, valueByLabel]);

  const fluxoOpKpi = useMemo(() => {
    const v = lastCol ? fluxoOpAt(lastCol) : null;
    const p = prevCol ? fluxoOpAt(prevCol) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }, [lastCol, prevCol, valueByLabel]);

  const fluxoLivreKpi = useMemo(() => {
    const v = lastCol ? fluxoLivreAt(lastCol) : null;
    const p = prevCol ? fluxoLivreAt(prevCol) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }, [lastCol, prevCol, valueByLabel]);

  const cashburn = useMemo(() => cashburnKpi(), [lastCol, prevCol, valueByLabel, columns]);

  const kpis: Array<{ key: string; title: string; val: number | null; prev: number | null; delta: number | null; pos: boolean }> = [
    { key: "entradas", title: "ENTRADAS", ...entradasKpi, pos: true },
    { key: "saidas", title: "SAÍDAS", ...saidasKpiV, pos: false },
    { key: "fop", title: "FLUXO OPERACIONAL", ...fluxoOpKpi, pos: true },
    { key: "fl", title: "FLUXO LIVRE", ...fluxoLivreKpi, pos: true },
    { key: "cb", title: "CASHBURN 12M", ...cashburn, pos: true },
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
    walk(DFC_SCHEMA, 0, false);
    return out;
  }, [collapsed]);

  const filtered = useMemo(() => {
    if (!search.trim()) return flat;
    const q = search.toLowerCase();
    return flat.filter(f => f.node.label.toLowerCase().includes(q));
  }, [flat, search]);

  function getValueForRow(node: Node, col: string): number | null {
    if (node.label === "Fluxo de Caixa Operacional") return fluxoOpAt(col);
    if (node.label === "Fluxo Livre") return fluxoLivreAt(col);
    if (node.label === CASHBURN) return cashburnAt(col);
    return valorGravado(node, col);
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
    walk(DFC_SCHEMA);
    setCollapsed(all);
  }
  function expandAll() { setCollapsed(new Set()); }
  const allCollapsed = collapsed.size > 0;

  const monthsCount = columns.length;
  const lastLabel = lastCol ? ptLabelFromKey(lastCol) : "—";
  const prevLabel = prevCol ? ptLabelFromKey(prevCol) : "—";

  /* ============================================================
   *  UI
   * ============================================================ */

  return (
    <div className="min-h-full bg-background">
      {/* header */}
      <div className="px-6 pt-5 pb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center gap-2">
            Demonstração de Fluxo de Caixa
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-primary">DFC</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Demonstrativo do fluxo de caixa · {lastLabel} · {prevLabel} · {monthsCount} meses · método direto
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
              onClick={() => setView("dfc")}
              className={cn("h-7 rounded px-2.5 text-[12px] font-medium transition-colors", view === "dfc" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              DFC
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
          <EscopoImportDialog
            tracker={pendente}
            travados={travados}
            gravando={importing}
            onCancelar={() => setPendente(null)}
            onConfirmar={gravarImport}
          />
        </div>
      </div>

      {view === "depara" ? (
        <OmieDeParaPanel demonstrativo="dfc" rubricas={DFC_RUBRICAS} />
      ) : (
        <>
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 px-6 md:grid-cols-3 lg:grid-cols-5">
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
                  title={tituloValor(k.val, false)}
                >
                  {isNeg ? `(${fmtMoney(Math.abs(k.val ?? 0))})` : fmtMoney(k.val)}
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
            { id: "valores", label: "Método direto" },
            { id: "mom", label: "Método indireto" },
            { id: "acum", label: "Caixa acumulado" },
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
        <div className="flex items-center gap-2 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar rubrica…"
              className="h-8 w-[200px] pl-7 text-[12px]"
            />
          </div>
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
          <SeletorFormato formato={formato} onChange={escolherFormato} />
          <Button variant="ghost" size="sm" className="h-8 text-[12px] text-muted-foreground" onClick={() => allCollapsed ? expandAll() : collapseAll()}>
            {allCollapsed ? "Expandir tudo" : "Colapsar tudo"}
          </Button>
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
        ) : (
          <>
          {/* Só na aba "Método direto": é onde as células estão marcadas.
              Mesma barra da DRE: os avisos que eram blocos empilhados viram
              segmentos de uma linha, cada um sumindo sozinho quando zerado. */}
          {tab === "valores" && (
            <BarraStatus
              periodo={rotuloPeriodo(displayColumns)}
              acoes={
                <RegerarJustificativas
                  gerando={gerandoJust}
                  progresso={progressoJust}
                  onGerar={(force) => gerarJust(force, displayColumns)}
                />
              }
            >
              <ResumoReclassificacoes mapa={reclassificacoes} />
              <ResumoValoresManuais mapa={manuais} colunas={displayColumns} />
              <ResumoJustificativas
                mapa={justificativas}
                colunas={displayColumns}
                gerando={gerandoJust}
                progresso={progressoJust}
                onGerar={(force) => gerarJust(force, displayColumns)}
                apenasUltimoMes={apenasUltimoMes}
                onApenasUltimoMesChange={setApenasUltimoMes}
              />
              <ResumoPerguntas mapa={perguntas} colunas={displayColumns} />
            </BarraStatus>
          )}
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
                  const isChild = node.kind === "child";
                  const isLeaf = node.kind === "leaf";
                  const hasChildren = !!node.children?.length;
                  const isCol = collapsed.has(node.label);

                  const rowCls = cn(
                    "border-b border-border/60 transition-colors",
                    isTotal && "bg-emerald-50/40 font-semibold",
                    isHeader && "font-semibold",
                    !isHeader && !isTotal && "hover:bg-muted/30",
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
                          // Caixa acumulado: soma do fluxo livre até a coluna
                          const idx = columns.indexOf(c);
                          if (idx < 0) v = null;
                          else {
                            const w = columns.slice(0, idx + 1);
                            v = w.reduce<number | null>((acc, cc) => {
                              const x = valorDaLinha(node, cc);
                              return x == null ? acc : (acc ?? 0) + x;
                            }, null);
                          }
                        }

                        const isNeg = (v ?? 0) < 0;
                        const display =
                          tab === "mom"
                            ? fmtPct(v)
                            : (isNeg ? `(${fmtNum(Math.abs(v ?? 0))})` : fmtNum(v));
                        /* A conferência da célula de resultado — o bloco e os
                           dois fluxos. Fora da aba "Método direto" o número é
                           derivado (Δ, acumulado) e não corresponde à conta do
                           esquema, então a marca sairia mentindo. */
                        const comp = tab === "valores" && temComposicao(node.label, "dfc")
                          ? composicaoDaCelula(node.label, lerCelula(c))
                          : null;
                        /* Só folha abre auditoria: linha com filhos é soma, e total
                           e percentual são calculados — nenhuma delas vem de
                           lançamento, então não haveria o que listar. Fora da aba
                           "Método direto" o número é derivado (variação ou
                           acumulado) e não casaria com a soma do mês. */
                        /* Marca só onde a célula é auditável: nas outras abas o
                           número é derivado e o clique não abre nada, então o
                           aviso seria um beco sem saída. */
                        const podeAuditar = tab === "valores" && !isTotal && !hasChildren;
                        const alerta = podeAuditar ? reclassificacoes.get(chaveCelula(node.label, c)) : undefined;
                        /* A justificativa vale para QUALQUER linha da aba Valores,
                           inclusive header e total: no tracker os comentários mais
                           frequentes estão justamente em linhas somadas ("Entradas",
                           "Pessoal"). Descartada continua aparecendo, só que apagada
                           — senão não haveria como restaurar. */
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
                           auditoria: linha com filhos é a soma dos filhos e total
                           é calculado — o número digitado neles morreria no
                           próximo recálculo. */
                        const editavel = podeAuditar;
                        const manual = editavel ? manuais.get(chaveCelula(node.label, c)) : undefined;
                        /* Célula vazia COM alerta continua clicável: existe
                           lançamento no Omie e a demonstração não mostra nada —
                           esconder a marca esconderia justamente esse buraco. */
                        const auditavel = podeAuditar && (v != null || !!alerta);
                        return (
                          <td
                            key={c}
                            onClick={auditavel ? () => setAuditando({
                              tipo: "dfc", rubrica: node.label, mes: c,
                              mesLabel: ptLabelFromKey(c).replace("/", " "),
                              celula: v, travado: travados.has(c),
                              ...parAnterior(node.label, c),
                            }) : undefined}
                            title={[
                              tituloValor(v, tab === "mom"),
                              tituloComposicao(comp),
                              manual ? tituloValorManual(manual) : null,
                              alerta ? tituloReclassificacao(alerta) : null,
                              tituloPerguntas(perguntasDaCelula),
                              auditavel ? "clique para ver os lançamentos" : null,
                            ].filter(Boolean).join(" · ") || undefined}
                            className={cn(
                              "px-1.5 py-1.5 text-right text-[12px] num whitespace-nowrap",
                              largura,
                              v != null && "cursor-help",
                              isNeg ? "text-primary" : isTotal ? "text-emerald-800" : "text-foreground/90",
                              v == null && "text-muted-foreground/40",
                              auditavel && "cursor-pointer hover:bg-primary/10 hover:underline hover:decoration-dotted hover:underline-offset-2",
                              // Excludentes de propósito: dois `bg-*` na mesma célula
                              // dependeriam da ordem no CSS gerado, não da ordem aqui.
                              // O alerta de classificação errada tem prioridade; o
                              // valor manual vem antes do comentário porque muda o
                              // número, não só o entendimento dele.
                              alerta ? fundoCelulaReclassificacao(alerta)
                                : manual ? fundoCelulaManual()
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
                                  tipo="dfc"
                                  rubrica={node.label}
                                  col={c}
                                  valorCelula={v}
                                  manual={manual}
                                  despesa={DFC_DESPESAS.has(node.label)}
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
        /* Trocar a categoria muda o Omie e o cache; a DFC só reflete depois de
           recalcular — o mesmo recálculo local do botão de sincronizar. */
        onCategoriaTrocada={async () => {
          await sincronizarOmie(false);
          await recarregarReclassificacoes();
        }}
      />
    </div>
  );
}
