import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Loader2, Pencil, Thermometer, Upload } from "lucide-react";
import { ImportarPainelDialog } from "./cac/ImportarPainelDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { valorExato } from "@/lib/valor";
import * as XLSX from "xlsx";
import {
  MESES, montarMatriz, agruparMatriz, totalGeral, matrizParaAOA,
  ultimoMesFechado, mesesDoPeriodo, desvioVsMedia, seloDaLinha,
  type PainelRow, type LinhaMatriz, type GrupoMatriz, type Linha,
  type Periodo, type Selo, type Desvio,
} from "@/lib/cac";
import { CelulaDialog } from "./cac/CelulaDialog";
import { CadastroCAC } from "./cac/CadastroCAC";
import { SeloRegra } from "./cac/SeloRegra";

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece as tabelas nem as
   RPCs criadas na migration do painel CAC. Mesmo atalho do useApelidos — some
   quando os tipos forem regerados. */
const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => any;
};

const ANO_PADRAO = new Date().getFullYear();

/** A cor do grupo — a mesma tarja que identifica o bloco na matriz. */
const COR_DO_GRUPO: Record<string, string> = {
  Equipes: "hsl(var(--primary))",
  Investimentos: "hsl(var(--warn))",
  "Comissões": "hsl(var(--info))",
};
const corDoGrupo = (g: string) => COR_DO_GRUPO[g] ?? "hsl(var(--neu))";

/** A variante string — para template literal, title= e a planilha. */
function fmtBRLStr(n: number | null | undefined) {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  if (v === 0) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** No ano cheio o valor vai em R$ mil, senão as 14 colunas não cabem na tela. */
function fmtMilStr(n: number | null | undefined) {
  const v = Number(n);
  if (n == null || !isFinite(v) || v === 0) return "—";
  return (v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const pctStr = (v: number) =>
  (v > 0 ? "+" : "") + (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";

const parteStr = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";

/**
 * O fundo da célula no heatmap.
 *
 * Gasto ACIMA da média puxa para o vermelho e abaixo para o verde — não é a
 * convenção de variação (subir = bom), é a convenção de custo. A intensidade
 * satura em 25% de desvio: sem o teto, uma linha que multiplicou por dez
 * pintaria de vermelho-vivo e achataria todas as outras em cinza.
 */
function tintDesvio(d: number | null | undefined, ligado: boolean) {
  if (d == null || !ligado || Math.abs(d) < 0.02) return undefined;
  const a = Math.min(1, Math.abs(d) / 0.25) * 0.3;
  return d > 0
    ? `hsl(var(--neg) / ${a.toFixed(3)})`
    : `hsl(var(--pos) / ${(a * 0.8).toFixed(3)})`;
}

const PERIODOS: { valor: Periodo; label: string }[] = [
  { valor: "12m", label: "12 meses" },
  { valor: "tri", label: "Trimestre" },
  { valor: "mes", label: "Mês" },
];

export default function PainelCAC() {
  const [ano, setAno] = useState(ANO_PADRAO);
  const [periodo, setPeriodo] = useState<Periodo>("12m");
  const [heatmap, setHeatmap] = useState(true);
  const [rows, setRows] = useState<PainelRow[]>([]);
  const [linhasRegra, setLinhasRegra] = useState<Linha[]>([]);
  const [loading, setLoading] = useState(true);
  const [celula, setCelula] = useState<{ linha: LinhaMatriz; mes: number } | null>(null);
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    /* As regras vêm junto com os números: sem elas não dá para dizer se uma
       linha zerada está zerada porque ninguém recebeu ou porque a regra nunca
       foi preenchida — e essa é exatamente a diferença que o selo mostra. */
    const [p, l] = await Promise.all([
      db.rpc("cac_painel", { p_ano: ano }),
      db.from("cac_linhas").select("id, departamentos, categorias"),
    ]);
    if (p.error) {
      toast.error("Não consegui carregar o painel", { description: p.error.message });
      setRows([]);
    } else {
      setRows((p.data ?? []) as PainelRow[]);
    }
    setLinhasRegra(l.error ? [] : ((l.data ?? []) as Linha[]));
    setLoading(false);
  }, [ano]);

  useEffect(() => { void carregar(); }, [carregar]);

  const grupos = useMemo(() => agruparMatriz(montarMatriz(rows)), [rows]);
  const geral = useMemo(() => totalGeral(grupos), [grupos]);

  const fechado = useMemo(() => ultimoMesFechado(ano), [ano]);
  const idx = useMemo(() => mesesDoPeriodo(periodo, fechado), [periodo, fechado]);

  /* Uma linha "tem regra" quando aponta departamento OU categoria. Sem nenhum
     dos dois ela vale zero por construção, e o selo precisa dizer isso. */
  const temRegra = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const l of linhasRegra) m.set(l.id, !!(l.departamentos?.length || l.categorias?.length));
    return m;
  }, [linhasRegra]);

  const selos = useMemo(() => {
    const m = new Map<string, Selo>();
    for (const g of grupos) {
      for (const l of g.linhas) {
        m.set(l.linha_id, seloDaLinha(l.regra_nota, temRegra.get(l.linha_id) ?? true, l.total));
      }
    }
    return m;
  }, [grupos, temRegra]);

  /* O total do que está NA TELA, não do ano — é o divisor da participação e do
     "% do período" do grupo. No recorte de um mês, participação anual não
     responde nada. */
  const totalPeriodo = useMemo(
    () => idx.reduce((s, i) => s + geral.meses[i], 0),
    [idx, geral],
  );

  /* Quantas células vieram de valor digitado. Vale a pena dizer em voz alta:
     um painel meio derivado e meio digitado que não avisa qual é qual é pior
     do que um painel inteiramente manual. */
  const manuais = useMemo(() => rows.filter((r) => r.origem === "manual").length, [rows]);

  const totaisPorLinha = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of grupos) for (const l of g.linhas) m.set(l.linha_id, l.total);
    return m;
  }, [grupos]);

  /* O subtítulo do cabeçalho carrega o fato vivo da tela, como no Caixa: não
     "o que é o painel" — isso o breadcrumb já diz — mas quanto dele dá para
     acreditar hoje. Uma regra a conferir é a diferença entre um número e um
     palpite, e quem abre a tela tem de saber disso antes de rolar. */
  const aConferir = useMemo(
    () => [...selos.values()].filter((s) => s !== "ok").length,
    [selos],
  );
  const totalLinhas = selos.size;
  const subtitulo = !totalLinhas
    ? ""
    : aConferir
      ? ` · ${totalLinhas} linhas, ${aConferir} a conferir`
      : ` · ${totalLinhas} linhas, todas conferidas`;

  const emAndamento = fechado >= 0 && fechado < 11 ? MESES[fechado + 1] : null;
  const compacto = periodo === "12m";
  const fmtStr = compacto ? fmtMilStr : fmtBRLStr;
  const aa = String(ano).slice(2);

  const periodoNota =
    fechado < 0
      ? `Jan–Dez/${aa} · nenhum mês fechado ainda`
      : periodo === "12m"
        ? `Jan–Dez/${aa}${emAndamento ? ` · ${emAndamento} em andamento` : ""}`
        : periodo === "tri"
          ? `${MESES[idx[0]]}–${MESES[idx[idx.length - 1]]}/${aa} · último trimestre fechado`
          : `${MESES[fechado]}/${aa} · último mês fechado`;

  const matrizNota = compacto
    ? `Valores em R$ mil · o valor cheio fica no hover${emAndamento ? ` · ${emAndamento} · está em andamento e fica fora do heatmap` : ""}`
    : "Clique numa célula para ver os lançamentos · valor digitado aparece em vermelho pontilhado";

  function exportar() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrizParaAOA(grupos, ano)), "Painel CAC");
    XLSX.writeFile(wb, `painel-cac-${ano}.xlsx`);
    toast.success("Planilha gerada", { description: `painel-cac-${ano}.xlsx` });
  }

  return (
    /* O `main` do AppLayout não tem padding — cada página põe o seu. Sem isto a
       coluna cola na barra vermelha da sidebar. */
    <div className="space-y-3.5 px-5 pb-7 pt-3.5">
      {/* ---------------- Cabeçalho ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Painel CAC</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Omie
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Folha, verba e comissão de quem traz cliente novo{subtitulo}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:self-start">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-[12px]"
            aria-pressed={heatmap}
            onClick={() => setHeatmap((v) => !v)}
          >
            <Thermometer className={cn("h-3.5 w-3.5", heatmap && "text-primary")} />
            {heatmap ? "Heatmap ligado" : "Heatmap desligado"}
          </Button>
          {manuais > 0 && (
            <Badge variant="outline" className="gap-1 text-[11.5px]">
              <Pencil className="h-3 w-3" />
              {manuais} {manuais === 1 ? "célula digitada" : "células digitadas"}
            </Badge>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setImportando(true)}>
            <Upload className="h-3.5 w-3.5" /> Importar
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={exportar} disabled={loading || !grupos.length}>
            <Download className="h-3.5 w-3.5" /> Exportar
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="num h-8 w-[104px] text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[ANO_PADRAO + 1, ANO_PADRAO, ANO_PADRAO - 1].map((a) => (
                <SelectItem key={a} value={String(a)}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-card p-[3px]">
            {PERIODOS.map((p) => (
              <button
                key={p.valor}
                type="button"
                onClick={() => setPeriodo(p.valor)}
                className={cn(
                  "h-6 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors",
                  periodo === p.valor
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <span className="text-[11.5px] text-muted-foreground">{periodoNota}</span>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      <Tabs defaultValue="painel">
        <TabsList className="h-8">
          <TabsTrigger value="painel" className="text-[12.5px]">Painel</TabsTrigger>
          <TabsTrigger value="cadastro" className="text-[12.5px]">Pessoas e regras</TabsTrigger>
        </TabsList>

        <TabsContent value="painel" className="mt-3.5">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold">Matriz por categoria</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{matrizNota}</p>
              </div>
              {/* A escala não tem número: o heatmap responde "qual célula olhar
                  primeiro", e o desvio exato já está no hover de cada uma. */}
              <div className="hidden items-center gap-2 text-[10.5px] text-muted-foreground md:flex">
                <span>abaixo da média 3m</span>
                <span
                  className="h-2 w-[120px] flex-none rounded-full"
                  style={{ background: "linear-gradient(90deg, hsl(var(--pos) / .28), hsl(var(--muted)), hsl(var(--neg) / .32))" }}
                />
                <span>acima</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-[12.5px]">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-10 w-[208px] bg-muted px-3 py-2 text-left font-semibold">Categoria</th>
                    {idx.map((i) => (
                      <th key={i} className="px-2.5 py-2 text-right font-semibold uppercase">
                        {MESES[i]}{i === fechado + 1 ? " ·" : ""}
                      </th>
                    ))}
                    <th className="px-2.5 py-2 text-right font-semibold" title="Média dos 3 meses anteriores ao último mês fechado">
                      Méd 3m
                    </th>
                    {periodo === "mes" ? (
                      <>
                        <th className="px-2.5 py-2 text-right font-semibold">Desvio</th>
                        <th className="px-2.5 py-2 text-right font-semibold">Part. %</th>
                      </>
                    ) : (
                      <th className="px-2.5 py-2 text-right font-semibold">{periodo === "12m" ? "Ano" : "Tri"}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g) => (
                    <GrupoBloco
                      key={g.grupo}
                      grupo={g}
                      idx={idx}
                      fechado={fechado}
                      periodo={periodo}
                      heatmap={heatmap}
                      fmtStr={fmtStr}
                      compacto={compacto}
                      totalPeriodo={totalPeriodo}
                      selos={selos}
                      onCelula={(linha, mes) => setCelula({ linha, mes })}
                    />
                  ))}

                  <tr className="border-t-2 border-[hsl(var(--line-strong))] bg-muted/70 font-semibold">
                    <td className="sticky left-0 z-10 bg-muted px-3 py-2.5">Total Geral</td>
                    <Numeros
                      valores={idx.map((i) => geral.meses[i])}
                      meses={geral.meses}
                      idx={idx}
                      fechado={fechado}
                      periodo={periodo}
                      total={totalPeriodo}
                      totalPeriodo={totalPeriodo}
                      fmtStr={fmtStr}
                      compacto={compacto}
                    />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {!loading && !grupos.length && (
            <p className="py-8 text-center text-[12.5px] text-muted-foreground">
              Nenhuma linha cadastrada. Configure em “Pessoas e regras”.
            </p>
          )}
        </TabsContent>

        <TabsContent value="cadastro" className="mt-3.5">
          <CadastroCAC onMudou={carregar} totaisPorLinha={totaisPorLinha} />
        </TabsContent>
      </Tabs>

      <CelulaDialog
        ano={ano}
        linha={celula?.linha ?? null}
        mes={celula?.mes ?? null}
        onClose={() => setCelula(null)}
      />

      <ImportarPainelDialog
        aberto={importando}
        ano={ano}
        onClose={() => setImportando(false)}
        onImportou={() => { setImportando(false); void carregar(); }}
      />
    </div>
  );
}

/* ==========================================================================
 * As colunas de fechamento — Méd 3m e, conforme o período, Ano/Tri ou
 * Desvio + Part. %. Grupo e total geral desenham as mesmas, então moram num
 * componente só.
 * ======================================================================== */

function Numeros({
  valores, meses, idx, fechado, periodo, total, totalPeriodo, fmtStr, compacto,
}: {
  valores: number[];
  meses: number[];
  idx: number[];
  fechado: number;
  periodo: Periodo;
  total: number;
  totalPeriodo: number;
  fmtStr: (n: number) => string;
  compacto: boolean;
}) {
  const dv = fechado >= 0 ? desvioVsMedia(meses, fechado) : null;
  const valor = (v: number) => (compacto ? comValorExato(v, fmtStr(v)) : fmtStr(v));

  return (
    <>
      {valores.map((v, k) => (
        <td key={idx[k]} className="num px-2.5 py-2.5 text-right">{valor(v)}</td>
      ))}
      <td className="num px-2.5 py-2.5 text-right text-muted-foreground">{dv ? valor(dv.media) : "—"}</td>
      {periodo === "mes" ? (
        <>
          <td className={cn("num px-2.5 py-2.5 text-right", dv && (dv.desvio > 0 ? "text-neg" : "text-pos"))}>
            {dv ? pctStr(dv.desvio) : "—"}
          </td>
          <td className="num px-2.5 py-2.5 text-right text-muted-foreground">
            {totalPeriodo ? parteStr((total / totalPeriodo) * 100) : "—"}
          </td>
        </>
      ) : (
        <td className="num px-2.5 py-2.5 text-right">{valor(total)}</td>
      )}
    </>
  );
}

function GrupoBloco({
  grupo, idx, fechado, periodo, heatmap, fmtStr, compacto, totalPeriodo, selos, onCelula,
}: {
  grupo: GrupoMatriz;
  idx: number[];
  fechado: number;
  periodo: Periodo;
  heatmap: boolean;
  fmtStr: (n: number) => string;
  compacto: boolean;
  totalPeriodo: number;
  selos: Map<string, Selo>;
  onCelula: (linha: LinhaMatriz, mes: number) => void;
}) {
  const totalGrupo = idx.reduce((s, i) => s + grupo.meses[i], 0);
  const share = totalPeriodo ? Math.round((totalGrupo / totalPeriodo) * 100) : 0;

  return (
    <>
      <tr className="border-t border-[hsl(var(--line-strong))] bg-muted/45 font-semibold">
        <td className="sticky left-0 z-10 bg-muted px-3 py-2.5">
          <span className="flex items-center gap-2">
            <span className="h-3.5 w-1.5 flex-none rounded-sm" style={{ background: corDoGrupo(grupo.grupo) }} />
            <span>{grupo.grupo}</span>
            <span className="num flex-none rounded-[4px] bg-background px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">
              {share}% do período
            </span>
          </span>
        </td>
        <Numeros
          valores={idx.map((i) => grupo.meses[i])}
          meses={grupo.meses}
          idx={idx}
          fechado={fechado}
          periodo={periodo}
          total={totalGrupo}
          totalPeriodo={totalPeriodo}
          fmtStr={fmtStr}
          compacto={compacto}
        />
      </tr>

      {grupo.linhas.map((l) => (
        <LinhaTR
          key={l.linha_id}
          l={l}
          idx={idx}
          fechado={fechado}
          periodo={periodo}
          heatmap={heatmap}
          fmtStr={fmtStr}
          compacto={compacto}
          totalPeriodo={totalPeriodo}
          selo={selos.get(l.linha_id) ?? "ok"}
          onCelula={onCelula}
        />
      ))}
    </>
  );
}

function LinhaTR({
  l, idx, fechado, periodo, heatmap, fmtStr, compacto, totalPeriodo, selo, onCelula,
}: {
  l: LinhaMatriz;
  idx: number[];
  fechado: number;
  periodo: Periodo;
  heatmap: boolean;
  fmtStr: (n: number) => string;
  compacto: boolean;
  totalPeriodo: number;
  selo: Selo;
  onCelula: (linha: LinhaMatriz, mes: number) => void;
}) {
  const total = idx.reduce((s, i) => s + l.meses[i], 0);
  const dvFechado = fechado >= 0 ? desvioVsMedia(l.meses, fechado) : null;
  const valor = (v: number) => (compacto ? comValorExato(v, fmtStr(v)) : fmtStr(v));

  return (
    <tr className="border-t border-border">
      <td className="sticky left-0 z-10 bg-card px-3 py-[7px] pl-6">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{l.rotulo}</span>
          <SeloRegra selo={selo} nota={l.regra_nota} />
        </span>
      </td>

      {idx.map((i) => {
        /* O mês em andamento fica FORA da comparação: metade de agosto contra
           meses inteiros acusaria uma queda de 50% que é só o calendário. */
        const dv: Desvio | null = i > fechado ? null : desvioVsMedia(l.meses, i);
        const v = l.meses[i];
        const titulo = v
          ? `${valorExato(v)} — ${
              i > fechado
                ? "mês em andamento, sem comparação"
                : dv
                  ? `${pctStr(dv.desvio)} vs média 3m (${fmtBRLStr(dv.media)})`
                  : "sem base de comparação"
            } · clique para ver os lançamentos`
          : "Sem lançamentos neste mês";

        return (
          <td key={i} className="p-0 text-right" style={{ background: tintDesvio(dv?.desvio, heatmap) }}>
            <button
              type="button"
              onClick={() => onCelula(l, i + 1)}
              title={titulo}
              className={cn(
                "num w-full px-2.5 py-[7px] text-right transition-colors hover:bg-muted/40",
                l.origens[i] === "manual" && "text-primary underline decoration-dotted underline-offset-2",
                dv && Math.abs(dv.desvio) > 0.15 && "font-semibold",
              )}
            >
              {fmtStr(v)}
            </button>
          </td>
        );
      })}

      <td className="num px-2.5 py-[7px] text-right text-muted-foreground">
        {dvFechado ? valor(dvFechado.media) : "—"}
      </td>
      {periodo === "mes" ? (
        <>
          <td
            className={cn(
              "num px-2.5 py-[7px] text-right font-semibold",
              dvFechado && (dvFechado.desvio > 0 ? "text-neg" : "text-pos"),
            )}
            style={{ background: tintDesvio(dvFechado?.desvio, heatmap) }}
          >
            {dvFechado ? pctStr(dvFechado.desvio) : "—"}
          </td>
          <td className="num px-2.5 py-[7px] text-right text-muted-foreground">
            {total && totalPeriodo ? parteStr((total / totalPeriodo) * 100) : "—"}
          </td>
        </>
      ) : (
        <td className="num px-2.5 py-[7px] text-right font-medium">{valor(total)}</td>
      )}
    </tr>
  );
}
