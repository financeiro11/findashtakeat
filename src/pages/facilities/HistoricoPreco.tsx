import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, LineChart, Line, Tooltip, ReferenceLine } from "recharts";
import { Table2, LineChart as LineIcon } from "lucide-react";
import { db, fmtBRL } from "./lib";
import { cn } from "@/lib/utils";

/**
 * A curva de preço de um alvo — a resposta para "esse preço é bom mesmo?".
 *
 * UMA SÉRIE SÓ, e isso é escolha. O menor preço do dia é o que decide a compra;
 * mediana e número de anúncios existem, mas moram no tooltip. Duas linhas
 * obrigariam legenda e roubariam a leitura de um card que vive dentro de uma
 * linha expandida, não numa página de análise.
 *
 * `#3b82f6` nos dois temas: passou nas checagens de faixa de luminosidade,
 * croma e contraste contra as duas superfícies. Azul e não vermelho de propósito
 * — a cor não deve sugerir "ruim" num gráfico onde cair é a boa notícia.
 */
const COR_SERIE = "#3b82f6";

interface Ponto {
  dia: string;
  menor: number;
  mediana: number;
  ofertas: number;
  menor_no_teto: number | null;
}

interface Props {
  alvoId: string;
  precoAlvo: number;
  /** Quantos dias distintos já existem — vem do painel, evita buscar para nada. */
  pontos: number;
}

const DIAS = 90;

export function HistoricoPreco({ alvoId, precoAlvo, pontos }: Props) {
  const [dados, setDados] = useState<Ponto[] | null>(null);
  const [tabela, setTabela] = useState(false);

  useEffect(() => {
    let vivo = true;
    db.rpc("facilities_radar_historico", { p_alvo_id: alvoId, p_dias: DIAS })
      .then(({ data }: any) => { if (vivo) setDados((data as Ponto[]) ?? []); });
    return () => { vivo = false; };
  }, [alvoId]);

  const resumo = useMemo(() => {
    if (!dados?.length) return null;
    const menores = dados.map((d) => Number(d.menor));
    const minimo = Math.min(...menores);
    const hoje = menores[menores.length - 1];
    const primeiro = menores[0];
    return {
      minimo,
      hoje,
      // Variação no período: é o que diz se vale esperar mais.
      variacao: primeiro > 0 ? ((hoje - primeiro) / primeiro) * 100 : 0,
      noMinimo: Math.abs(hoje - minimo) < 0.01,
      dias: dados.length,
    };
  }, [dados]);

  if (pontos === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
        Ainda sem histórico. A curva aparece a partir da segunda varredura — é ela que vai dizer
        se um preço é promoção de verdade ou o de sempre.
      </div>
    );
  }

  if (!dados) return <div className="h-[200px] animate-pulse rounded-md bg-muted/40" />;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[12.5px] font-medium text-foreground">Menor preço por dia</div>
          <div className="text-[11px] text-muted-foreground">
            {resumo?.dias} dia(s) medidos · total com frete, incluindo anúncios acima do teto
          </div>
        </div>
        <div className="flex items-center gap-2">
          {resumo && (
            <span className={cn(
              "num rounded px-1.5 py-0.5 text-[11px] font-medium",
              resumo.noMinimo
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}>
              {resumo.noMinimo ? "está no menor preço já visto" : `mínimo do período: ${fmtBRL(resumo.minimo)}`}
            </span>
          )}
          {/* A tabela não é enfeite de acessibilidade: "conferir" é literalmente
              ler os números, e é para isso que o Facilities abre esta aba. */}
          <button
            type="button"
            onClick={() => setTabela((v) => !v)}
            className="ghost-icone inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {tabela ? <><LineIcon className="h-3 w-3" /> gráfico</> : <><Table2 className="h-3 w-3" /> números</>}
          </button>
        </div>
      </div>

      {tabela ? (
        <div className="max-h-[220px] overflow-y-auto rounded-md border border-border">
          <table className="w-full border-collapse text-[11.5px]">
            <thead className="sticky top-0 bg-muted/50">
              <tr className="text-left uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-1.5 font-semibold">Dia</th>
                <th className="px-3 py-1.5 text-right font-semibold">Menor</th>
                <th className="px-3 py-1.5 text-right font-semibold">Típico</th>
                <th className="px-3 py-1.5 text-right font-semibold">Anúncios</th>
              </tr>
            </thead>
            <tbody>
              {[...dados].reverse().map((d) => (
                <tr key={d.dia} className="border-t border-border/60">
                  <td className="px-3 py-1.5">{new Date(d.dia + "T00:00:00").toLocaleDateString("pt-BR")}</td>
                  <td className="num px-3 py-1.5 text-right font-medium text-foreground">{fmtBRL(Number(d.menor))}</td>
                  <td className="num px-3 py-1.5 text-right text-muted-foreground">{fmtBRL(Number(d.mediana))}</td>
                  <td className="num px-3 py-1.5 text-right text-muted-foreground">{d.ofertas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-[200px]">
          <ResponsiveContainer>
            <LineChart data={dados} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="dia"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => new Date(v + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                minTickGap={28}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                /* Escala pelos dados, não a partir do zero: numa faixa estreita
                   de preço, começar em zero achata a linha e esconde justamente
                   a variação que se quer enxergar. É linha, não barra — barra
                   truncada mentiria sobre a proporção. */
                domain={["dataMin - 150", "dataMax + 150"]}
                tickFormatter={(v) => fmtBRL(Number(v))}
                width={58}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(v) => new Date(String(v) + "T00:00:00").toLocaleDateString("pt-BR")}
                formatter={(valor: any, nome: any, item: any) => {
                  const p = item?.payload as Ponto | undefined;
                  if (!p) return [fmtBRL(Number(valor)), "Menor"];
                  return [
                    `${fmtBRL(Number(p.menor))} · típico ${fmtBRL(Number(p.mediana))} · ${p.ofertas} anúncio(s)` +
                      (p.menor_no_teto == null ? " · nenhum dentro do teto" : ""),
                    "Menor do dia",
                  ];
                }}
              />
              {/* O teto é referência, não série: recessivo e tracejado. */}
              <ReferenceLine
                y={precoAlvo}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
                label={{ value: "teto", position: "insideTopRight", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <Line
                type="monotone"
                dataKey="menor"
                name="Menor do dia"
                stroke={COR_SERIE}
                strokeWidth={2}
                /* Ponto em todo dia vira ruído em 90 dias; só no hover. */
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--background))" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
