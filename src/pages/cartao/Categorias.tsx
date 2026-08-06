/**
 * "Categorias · trajetória no período" — a faixa de sparklines.
 *
 * Cada curva está na PRÓPRIA escala, de propósito: aqui a pergunta é a forma
 * (subiu sempre? deu um pico e voltou? é uma reta?), não a comparação entre
 * categorias — essa está na matriz, onde os números dividem o mesmo eixo. Numa
 * escala comum, Taxas e tarifas viraria uma linha reta colada no chão e não
 * diria nada.
 */

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { Analise, LinhaMatriz } from "./analise";
import { pctStr } from "./fmt";
import { abrev, deltaMil } from "./valores";

/** Mesma escolha do BalanceteCharts: paleta categórica local, fora dos tokens
 *  semânticos (que carregam significado — positivo, negativo, alerta). */
const PALETA = ["#e11d48", "#3b82f6", "#8b5cf6", "#14b8a6", "#f59e0b", "#06b6d4", "#ec4899", "#64748b", "#94a3b8"];

function Trajetoria({ linha, cor, meses }: { linha: LinhaMatriz; cor: string; meses: number }) {
  const dados = linha.porMes.map((v, i) => ({ i, v }));
  const min = Math.min(...linha.porMes);
  const max = Math.max(...linha.porMes);
  // Uma categoria constante (Zig, R$ 1,3k todo mês) desenharia uma linha colada
  // na borda do gráfico; a folga faz ela sair no meio, como reta mesmo.
  const folga = max === min ? Math.max(1, max * 0.2) : (max - min) * 0.15;

  // Largura fixa, não `w-full`: ao lado de um `flex-1` (base 0) o `width:100%`
  // vira base do flex, estoura a linha e o nome da categoria fica com 0px.
  if (meses < 2) return <div className="h-8 w-[104px] shrink-0" />;

  return (
    <div className="h-8 w-[104px] shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={[min - folga, max + folga]} />
          <Line type="monotone" dataKey="v" stroke={cor} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Categorias({ analise }: { analise: Analise }) {
  const { categorias, totalPeriodo, meses } = analise;
  if (!categorias.length) return null;

  return (
    <div className="card-surface p-4 sm:p-5">
      <div className="mb-0.5 text-[15px] font-bold tracking-tight">Categorias · trajetória no período</div>
      <p className="mb-4 text-[12px] text-muted-foreground">
        {meses[0]?.label} → {meses[meses.length - 1]?.label} · cada curva na própria escala; valor e variação são da
        última fatura
      </p>

      <div className="grid gap-x-6 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
        {categorias.map((c, i) => {
          const cor = PALETA[i % PALETA.length];
          const ultimo = c.porMes[c.porMes.length - 1] ?? 0;
          const semBase = c.pctPenultimo === null && c.deltaPenultimo > 0;
          return (
            <div
              key={c.chave}
              className="flex items-center gap-3 border-b border-border/40 py-2.5 last:border-b-0 md:last:border-b"
            >
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: cor }} />

              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold">{c.chave}</div>
                <div className="num truncate text-[11px] text-muted-foreground">
                  {pctStr(totalPeriodo > 0 ? c.total / totalPeriodo : null, { sinal: false })} do período
                </div>
              </div>

              <Trajetoria linha={c} cor={cor} meses={meses.length} />

              <div className="w-[92px] shrink-0 text-right">
                <div className="num text-[12.5px] font-semibold">{abrev(ultimo)}</div>
                <div
                  className={cn(
                    "num text-[11px]",
                    c.deltaPenultimo > 0 ? "text-neg" : c.deltaPenultimo < 0 ? "text-pos" : "text-muted-foreground",
                  )}
                >
                  {deltaMil(c.deltaPenultimo)} · {semBase ? "novo" : pctStr(c.pctPenultimo)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
