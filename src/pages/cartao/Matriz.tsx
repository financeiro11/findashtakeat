/**
 * A matriz eixo × mês — o coração da tela.
 *
 * Serve tanto para estabelecimento quanto para categoria porque a leitura é a
 * mesma: uma linha por item, uma coluna por fatura, e à direita as duas
 * variações que interessam no fechamento — contra o PRIMEIRO mês (a tendência
 * longa) e contra o mês ANTERIOR (o que mudou agora).
 *
 * Valores em milhares e com uma casa: com 7+ colunas o número cheio não cabe, e
 * o que se procura aqui é a forma da linha, não o centavo. O centavo está no
 * hover (ver ./valores) e na aba de detalhe.
 */

import { Fragment, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Flag } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Analise, LinhaMatriz, Marcacao } from "./analise";
import { deltaMilStr, milStr, pctStr } from "./fmt";
import { abrev, deltaMil, mil } from "./valores";

export type Realce = "primeiro" | "penultimo";

/**
 * Ordem das linhas. O padrão é o tamanho do gasto, mas no fechamento a pergunta
 * costuma ser outra — "o que se mexeu?" —, e aí o que interessa é a variação da
 * coluna Δ realçada, seja para cima, para baixo ou nos dois sentidos.
 */
export type Ordem = "total" | "alta" | "queda" | "variacao";

export const ORDENS: { valor: Ordem; rotulo: string }[] = [
  { valor: "total", rotulo: "Maior gasto" },
  { valor: "variacao", rotulo: "Maior variação" },
  { valor: "alta", rotulo: "Maiores altas" },
  { valor: "queda", rotulo: "Maiores quedas" },
];

/** A variação usada na ordenação é a da coluna realçada. */
function deltaDe(l: LinhaMatriz, realce: Realce): number {
  return realce === "primeiro" ? l.deltaPrimeiro : l.deltaPenultimo;
}

/** Setinha no cabeçalho da coluna que está mandando na ordem. */
function SetaOrdem({ ordem }: { ordem: Ordem }) {
  if (ordem === "total") return null;
  const Icon = ordem === "alta" ? ArrowUp : ordem === "queda" ? ArrowDown : ArrowUpDown;
  return <Icon className="ml-1 inline-block h-3 w-3 align-[-1px] text-foreground" />;
}

function ordenar(linhas: LinhaMatriz[], ordem: Ordem, realce: Realce): LinhaMatriz[] {
  if (ordem === "total") return linhas; // já vem ordenado por total em analise.ts
  const d = (l: LinhaMatriz) => deltaDe(l, realce);
  const arr = [...linhas];
  if (ordem === "alta") return arr.sort((a, b) => d(b) - d(a));
  if (ordem === "queda") return arr.sort((a, b) => d(a) - d(b));
  return arr.sort((a, b) => Math.abs(d(b)) - Math.abs(d(a)));
}

/** Em despesa, subir é ruim: vermelho sobe, verde cai. */
function corDelta(n: number): string {
  if (n > 0) return "text-neg";
  if (n < 0) return "text-pos";
  return "text-muted-foreground";
}

function CelulasDelta({
  delta, pct, realcado,
}: { delta: number; pct: number | null; realcado: boolean }) {
  const semBase = pct === null && delta > 0; // não havia gasto antes → "novo"
  return (
    <td
      className={cn(
        "px-3 py-2.5 text-right align-middle whitespace-nowrap",
        realcado && (delta > 0 ? "bg-neg-soft" : delta < 0 ? "bg-pos-soft" : "bg-muted/30"),
      )}
    >
      <div className={cn("num text-[12.5px] font-semibold leading-tight", corDelta(delta))}>
        {deltaMil(delta)}
      </div>
      <div className={cn("num text-[11px] leading-tight", semBase ? "text-muted-foreground" : corDelta(delta))}>
        {semBase ? "novo" : pctStr(pct)}
      </div>
    </td>
  );
}

/** Bandeirinha da coluna REV. — marcar o gasto que precisa de explicação. */
function BotaoMarcar({
  chave, marcacao, onMarcar,
}: {
  chave: string;
  marcacao: Marcacao | undefined;
  onMarcar: (chave: string, marcado: boolean, nota: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState(marcacao?.nota ?? "");
  const marcado = !!marcacao;

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (o) setNota(marcacao?.nota ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={marcado ? marcacao?.nota || "Marcado para revisão" : "Marcar para revisão"}
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded border transition-colors",
            marcado
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border text-muted-foreground/50 hover:border-destructive/40 hover:text-destructive",
          )}
        >
          <Flag className={cn("h-3.5 w-3.5", marcado && "fill-current")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[12.5px] font-semibold">{chave}</div>
        <p className="mb-2 text-[11.5px] leading-relaxed text-muted-foreground">
          Marque quando o gasto estiver crescendo demais ou você não reconhecer o estabelecimento. O
          marcado sobe para os destaques e continua marcado na próxima fatura.
        </p>
        <Textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Por que marcou? (opcional)"
          className="min-h-[64px] text-[12.5px]"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {marcado ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px] text-muted-foreground"
              onClick={() => { onMarcar(chave, false, ""); setAberto(false); }}
            >
              Desmarcar
            </Button>
          ) : <span />}
          <Button
            size="sm"
            className="h-7 px-3 text-[12px]"
            onClick={() => { onMarcar(chave, true, nota); setAberto(false); }}
          >
            {marcado ? "Salvar" : "Marcar"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Linha({
  linha, meses, maxTotal, realce, marcacao, onMarcar, filha, expandivel, aberta, onToggle, pctDoTotal,
}: {
  linha: LinhaMatriz;
  meses: number;
  maxTotal: number;
  realce: Realce;
  marcacao?: Marcacao;
  onMarcar?: (chave: string, marcado: boolean, nota: string) => void;
  filha?: boolean;
  expandivel?: boolean;
  aberta?: boolean;
  onToggle?: () => void;
  pctDoTotal?: number;
}) {
  const larguraBarra = maxTotal > 0 ? Math.max(2, (linha.total / maxTotal) * 100) : 0;

  return (
    <tr
      className={cn(
        "border-b border-border/60 transition-colors",
        filha ? "bg-muted/20" : "hover:bg-muted/30",
        expandivel && "cursor-pointer",
        marcacao && !filha && "bg-destructive/[0.04]",
      )}
      onClick={expandivel ? onToggle : undefined}
    >
      <td className={cn("px-3 py-2.5", filha && "pl-9")}>
        <div className="flex items-center gap-1.5">
          {expandivel && (
            <ChevronRight
              className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform", aberta && "rotate-90")}
            />
          )}
          <div className="min-w-0">
            <div className={cn("truncate text-[12.5px] font-semibold", filha && "font-medium")}>
              {linha.chave}
              {linha.novo && (
                <span className="ml-1.5 rounded bg-warn-soft px-1 py-px text-[9px] font-bold tracking-wider text-warn align-middle">
                  NOVO
                </span>
              )}
            </div>
            {linha.sub && <div className="truncate text-[11px] text-muted-foreground">{linha.sub}</div>}
          </div>
        </div>
      </td>

      {linha.porMes.map((v, i) => (
        <td key={i} className="num px-2 py-2.5 text-right text-[12.5px] tabular-nums">
          {v === 0 ? <span className="text-muted-foreground/40">—</span> : mil(v)}
        </td>
      ))}

      <td className="px-3 py-2.5 text-right">
        <div className="num text-[12.5px] font-semibold">{abrev(linha.total)}</div>
        <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary/60" style={{ width: `${larguraBarra}%` }} />
        </div>
        {pctDoTotal != null && (
          <div className="num mt-0.5 text-[10.5px] text-muted-foreground">
            {pctStr(pctDoTotal, { sinal: false })} do total
          </div>
        )}
      </td>

      <CelulasDelta delta={linha.deltaPrimeiro} pct={linha.pctPrimeiro} realcado={realce === "primeiro"} />
      {meses >= 2 && (
        <CelulasDelta delta={linha.deltaPenultimo} pct={linha.pctPenultimo} realcado={realce === "penultimo"} />
      )}

      <td className="px-3 py-2.5 text-right">
        {onMarcar && !filha && (
          <BotaoMarcar chave={linha.chave} marcacao={marcacao} onMarcar={onMarcar} />
        )}
      </td>
    </tr>
  );
}

export function Matriz({
  analise, modo, realce, ordem = "total", marcacoes, onMarcar,
}: {
  analise: Analise;
  modo: "estabelecimento" | "categoria";
  realce: Realce;
  ordem?: Ordem;
  marcacoes: Map<string, Marcacao>;
  onMarcar: (chave: string, marcado: boolean, nota: string) => void;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const base = modo === "estabelecimento" ? analise.estabelecimentos : analise.categorias;
  const nMeses = analise.meses.length;
  const linhas = ordenar(base, ordem, realce);
  const maxTotal = Math.max(0, ...linhas.map((l) => l.total));
  const totalGeral = analise.totalPeriodo;

  const rotuloEixo = modo === "estabelecimento" ? "Estabelecimento" : "Categoria";

  if (!linhas.length) {
    return (
      <div className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
        Nenhum gasto no período selecionado.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2.5 text-left font-semibold">{rotuloEixo}</th>
            {analise.meses.map((m) => (
              <th key={m.competencia} className="px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                {m.label}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Total período</th>
            <th
              className={cn(
                "px-3 py-2.5 text-right font-semibold whitespace-nowrap",
                realce === "primeiro" && "bg-muted/40",
              )}
              title="Última fatura contra a primeira do período"
            >
              Δ últ−1º
              {realce === "primeiro" && <SetaOrdem ordem={ordem} />}
            </th>
            {nMeses >= 2 && (
              <th
                className={cn(
                  "px-3 py-2.5 text-right font-semibold whitespace-nowrap",
                  realce === "penultimo" && "bg-muted/40",
                )}
                title="Última fatura contra a anterior"
              >
                Δ últ−pen
                {realce === "penultimo" && <SetaOrdem ordem={ordem} />}
              </th>
            )}
            <th className="px-3 py-2.5 text-right font-semibold">Rev.</th>
          </tr>
        </thead>

        <tbody>
          {linhas.map((linha) => {
            const aberta = abertas.has(linha.chave);
            // Na matriz de categoria, cada linha abre nos estabelecimentos que a
            // compõem — é a pergunta imediata depois de ver a categoria subir.
            const filhas =
              modo === "categoria" && aberta
                ? ordenar(analise.estabelecimentos.filter((e) => e.sub === linha.chave), ordem, realce)
                : [];
            return (
              <Fragment key={linha.chave}>
                <Linha
                  linha={linha}
                  meses={nMeses}
                  maxTotal={maxTotal}
                  realce={realce}
                  marcacao={marcacoes.get(linha.chave)}
                  onMarcar={modo === "estabelecimento" ? onMarcar : undefined}
                  expandivel={modo === "categoria"}
                  aberta={aberta}
                  pctDoTotal={modo === "categoria" && totalGeral > 0 ? linha.total / totalGeral : undefined}
                  onToggle={() =>
                    setAbertas((prev) => {
                      const next = new Set(prev);
                      if (next.has(linha.chave)) next.delete(linha.chave);
                      else next.add(linha.chave);
                      return next;
                    })
                  }
                />
                {filhas.map((f) => (
                  <Linha
                    key={`${linha.chave}::${f.chave}`}
                    linha={{ ...f, sub: null }}
                    meses={nMeses}
                    maxTotal={maxTotal}
                    realce={realce}
                    filha
                  />
                ))}
              </Fragment>
            );
          })}
        </tbody>

        <tfoot>
          <tr className="border-t-2 border-border bg-muted/30 text-[12.5px] font-bold">
            <td className="px-3 py-3">Total geral</td>
            {analise.kpis.map((k) => (
              <td key={k.competencia} className="num px-2 py-3 text-right tabular-nums">
                {milStr(k.gastos)}
              </td>
            ))}
            <td className="num px-3 py-3 text-right">{abrev(totalGeral)}</td>
            <td className={cn("num px-3 py-3 text-right", realce === "primeiro" && "bg-muted/40", corDelta(diffPrimeiro(analise)))}>
              {deltaMilStr(diffPrimeiro(analise))}
            </td>
            {nMeses >= 2 && (
              <td className={cn("num px-3 py-3 text-right", realce === "penultimo" && "bg-muted/40", corDelta(analise.deltaUltimo))}>
                {deltaMilStr(analise.deltaUltimo)}
              </td>
            )}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function diffPrimeiro(a: Analise): number {
  if (!a.ultimo || !a.kpis.length) return 0;
  return a.ultimo.gastos - a.kpis[0].gastos;
}
