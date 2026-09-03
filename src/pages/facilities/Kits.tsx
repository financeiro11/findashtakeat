import { useCallback, useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, LineChart, Line, Tooltip, ReferenceLine } from "recharts";
import { Boxes, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { CatDot } from "./components";
import { db, fmtBRL as fmtBRLStr, fmtData } from "./lib";
import { KitDialog, type AlvoEscolhivel, type KitRow } from "./KitDialog";

/* Valor arredondado na tela, número cheio no hover — convenção do Hub. Onde
   precisa ser string mesmo (SVG do gráfico, title, template), use fmtBRLStr. */
const fmtBRL = (v: number | null | undefined) => comValorExato(v, fmtBRLStr(v));

/** Azul, o mesmo da curva do alvo: cair é a boa notícia, e vermelho diria o contrário. */
const COR_SERIE = "#3b82f6";
const DIAS = 180;

interface ItemKit {
  alvo_id: string;
  titulo: string;
  quantidade: number;
  modo: string;
  categoria: string | null;
  alvo_ativo: boolean;
  teto: number;
  menor: number | null;
  estourou: boolean;
  ultima_varredura: string | null;
}

interface LinhaKit {
  kit: KitRow & { ativo: boolean; created_at: string };
  itens: ItemKit[];
  total: number;
  teto_total: number;
  medidos: number;
  itens_total: number;
}

interface Ponto { dia: string; total: number; itens: number }

interface Props {
  /** Os alvos que a caixa de edição oferece — vêm do painel que a página já leu. */
  alvos: AlvoEscolhivel[];
  /** Muda quando a página recarrega o painel; refaz a leitura dos kits junto. */
  versao: number;
}

/**
 * Os kits — o conjunto que se compra junto, com preço e curva próprios.
 *
 * POR QUE ISTO É UM BLOCO E NÃO UMA PÁGINA. A pergunta do kit ("quanto custa
 * montar uma estação hoje?") só tem sentido em cima da lista de alvos que está
 * logo abaixo: o total é a soma do que está escrito lá, e quem desconfia do
 * número desce dois centímetros e confere item por item. Numa página separada,
 * conferir viraria navegar, e um total que não se confere não se usa.
 */
export function Kits({ alvos, versao }: Props) {
  const [linhas, setLinhas] = useState<LinhaKit[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [curvas, setCurvas] = useState<Record<string, Ponto[]>>({});
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<LinhaKit | null>(null);
  const [apagando, setApagando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await db.rpc("facilities_radar_kits_painel");
    setLinhas((data as LinhaKit[]) ?? []);
  }, []);
  useEffect(() => { carregar(); }, [carregar, versao]);

  async function abrir(id: string) {
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    if (curvas[id]) return;
    const { data } = await db.rpc("facilities_radar_kit_curva", { p_kit_id: id, p_dias: DIAS });
    setCurvas((p) => ({ ...p, [id]: (data as Ponto[]) ?? [] }));
  }

  async function apagar(l: LinhaKit) {
    if (!confirm(`Apagar o kit "${l.kit.nome}"? Os alvos e as curvas deles continuam — só o agrupamento some.`)) return;
    setApagando(l.kit.id);
    const { error } = await db.from("facilities_radar_kits").delete().eq("id", l.kit.id);
    setApagando(null);
    if (error) { toast.error(`Não deu para apagar: ${error.message}`); return; }
    toast.success("Kit apagado. Os alvos continuam sendo vigiados.");
    setCurvas((p) => { const n = { ...p }; delete n[l.kit.id]; return n; });
    carregar();
  }

  const itensIniciais = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of editando?.itens ?? []) m[i.alvo_id] = i.quantidade;
    return m;
  }, [editando]);

  if (!linhas) return null;
  /* Sem alvo e sem kit não há nada a agrupar, e o convite a criar um kit
     competiria com o estado vazio da lista logo abaixo — que é onde a primeira
     ação de verdade mora. */
  if (!linhas.length && !alvos.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 pt-1">
        <h2 className="text-[15px] font-semibold text-foreground">O que custa montar junto</h2>
        <span className="flex-1 text-[12px] text-muted-foreground">
          {linhas.length === 0
            ? "Agrupe os alvos que se compram no mesmo pedido e veja o total andar."
            : `${linhas.length} kit(s)`}
        </span>
        <Button
          variant="outline" size="sm" className="h-7 text-[12px]"
          onClick={() => { setEditando(null); setDialogAberto(true); }}
          disabled={alvos.length === 0}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Novo kit
        </Button>
      </div>

      {linhas.length === 0 ? (
        <div className="card-surface flex items-center gap-3 py-4 text-[12.5px] text-muted-foreground">
          <Boxes className="h-5 w-5 shrink-0 text-muted-foreground/40" />
          <span>
            Ninguém compra um monitor — compra-se uma estação. Um kit soma os alvos que vão no mesmo
            pedido e responde "quanto custa montar hoje, e isso subiu?".
          </span>
        </div>
      ) : linhas.map((l) => {
        const expandido = aberto === l.kit.id;
        const curva = curvas[l.kit.id];
        const incompleto = l.medidos < l.itens_total;
        const folga = l.teto_total > 0 ? (l.teto_total - l.total) / l.teto_total : null;
        const estourados = l.itens.filter((i) => i.estourou).length;
        /* Só em vigia = nenhum preço passou pela conferência de estoque. É a
           mesma ressalva do card do alvo, e no kit ela pesa mais: o total tem
           cara de orçamento, e orçamento se leva para uma reunião. */
        const soVigia = l.itens.length > 0 && l.itens.every((i) => i.modo === "vigia");
        const variacao = curva && curva.length > 1
          ? ((Number(curva[curva.length - 1].total) - Number(curva[0].total)) / Number(curva[0].total)) * 100
          : null;

        return (
          <div key={l.kit.id} className="card-surface">
            <div className="flex items-start gap-3 px-3 py-2.5">
              <button
                type="button" onClick={() => abrir(l.kit.id)}
                className="ghost-icone mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={expandido ? "Fechar a curva" : "Ver a curva"}
              >
                {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[14px] font-semibold text-foreground">{l.kit.nome}</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {l.itens_total} item(ns) · {l.itens.reduce((s, i) => s + i.quantidade, 0)} peça(s)
                  </span>
                  {soVigia && (
                    <span
                      className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground"
                      title="Todos os itens estão em vigia: o preço não passou pela conferência de estoque. Serve para medir o mercado, não para fechar a compra."
                    >
                      preço não conferido
                    </span>
                  )}
                </div>
                {l.kit.descricao && (
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">{l.kit.descricao}</div>
                )}
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  {incompleto ? "Parcial" : "Custa hoje"}
                </div>
                <div className="num text-[15px] font-semibold text-emerald-700 dark:text-emerald-400">
                  {fmtBRL(l.total)}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Teto somado</div>
                <div className="num text-[13px] font-medium text-foreground">
                  {fmtBRL(l.teto_total)}
                  {folga != null && !incompleto && (
                    <span className={cn("ml-1 text-[11px] font-normal",
                      folga >= 0 ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
                      {folga >= 0 ? "−" : "+"}{Math.abs(Math.round(folga * 100))}%
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button" className="ghost-icone rounded p-1 text-muted-foreground hover:text-foreground"
                  onClick={() => { setEditando(l); setDialogAberto(true); }} aria-label="Editar o kit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" className="ghost-icone rounded p-1 text-muted-foreground hover:text-destructive"
                  onClick={() => apagar(l)} disabled={apagando === l.kit.id} aria-label="Apagar o kit"
                >
                  {apagando === l.kit.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* O TOTAL QUE NÃO SOMA TUDO TEM DE SE DENUNCIAR. Um kit de quatro
                itens com três medidos mostra um número menor que o real, e é
                exatamente a direção que agrada — parece que ficou barato. */}
            {(incompleto || estourados > 0) && (
              <div className="border-t border-border/60 px-3 py-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">
                {incompleto && (
                  <span>
                    {l.medidos} de {l.itens_total} itens com preço — o total é parcial até o radar medir o resto.
                  </span>
                )}
                {incompleto && estourados > 0 && " · "}
                {estourados > 0 && (
                  <span>
                    {estourados} item(ns) sem nada dentro do teto: o menor preço visto deles entra no total mesmo assim.
                  </span>
                )}
              </div>
            )}

            {expandido && (
              <div className="space-y-3 border-t border-border px-3 py-3">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="text-left uppercase tracking-wide text-[10.5px] text-muted-foreground">
                        <th className="pb-1 font-semibold">Item</th>
                        <th className="pb-1 text-right font-semibold">Qtd</th>
                        <th className="pb-1 text-right font-semibold">Menor visto</th>
                        <th className="pb-1 text-right font-semibold">Teto</th>
                        <th className="pb-1 text-right font-semibold">Subtotal</th>
                        <th className="pb-1 text-right font-semibold">Medido em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.itens.map((i) => (
                        <tr key={i.alvo_id} className="border-t border-border/60">
                          <td className="py-1.5">
                            <span className="inline-flex items-center gap-1.5">
                              <CatDot cat={i.categoria} />
                              <span className={cn("text-foreground", !i.alvo_ativo && "text-muted-foreground line-through")}>
                                {i.titulo}
                              </span>
                            </span>
                          </td>
                          <td className="num py-1.5 text-right text-muted-foreground">{i.quantidade}×</td>
                          <td className={cn("num py-1.5 text-right font-medium",
                            i.menor == null ? "text-muted-foreground"
                              : i.estourou ? "text-amber-700 dark:text-amber-400"
                              : "text-emerald-700 dark:text-emerald-400")}>
                            {i.menor == null ? "sem preço" : fmtBRL(Number(i.menor))}
                          </td>
                          <td className="num py-1.5 text-right text-muted-foreground">{fmtBRL(Number(i.teto))}</td>
                          <td className="num py-1.5 text-right text-foreground">
                            {i.menor == null ? "—" : fmtBRL(Number(i.menor) * i.quantidade)}
                          </td>
                          <td className="py-1.5 text-right text-[11px] text-muted-foreground">
                            {i.ultima_varredura ? fmtData(i.ultima_varredura) : "nunca"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!curva ? (
                  <div className="h-[180px] animate-pulse rounded-md bg-muted/40" />
                ) : curva.length < 2 ? (
                  /* A curva do kit só ganha ponto no dia em que TODOS os itens
                     têm preço — dizer isso evita o diagnóstico errado de que o
                     gráfico quebrou quando o que falta é medição. */
                  <div className="rounded-md border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
                    {curva.length === 0
                      ? "Ainda sem curva: ela começa no dia em que o último item do kit ganhar preço."
                      : "Um ponto só até agora. A partir da próxima varredura de todos os itens a linha aparece."}
                  </div>
                ) : (
                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[12px] text-muted-foreground">
                        Custo do kit por dia medido · {curva.length} ponto(s)
                      </div>
                      {variacao != null && (
                        <span className={cn("num rounded px-1.5 py-0.5 text-[11px] font-medium",
                          variacao <= 0
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400")}>
                          {variacao > 0 ? "+" : ""}{variacao.toFixed(1).replace(".", ",")}% no período
                        </span>
                      )}
                    </div>
                    <div className="h-[200px]">
                      <ResponsiveContainer>
                        <LineChart data={curva} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis
                            dataKey="dia"
                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                            tickFormatter={(v) => new Date(v + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                            minTickGap={28}
                          />
                          <YAxis
                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                            domain={["dataMin - 200", "dataMax + 200"]}
                            /* String pura: dentro do SVG do Recharts o ReactNode
                               do hover viraria "[object Object]". */
                            tickFormatter={(v) => fmtBRLStr(Number(v))}
                            width={64}
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
                            /* O tooltip já flutua: mostra o valor cheio direto,
                               sem o compacto e sem hover dentro de hover. */
                            formatter={(valor: any) => [fmtBRLStr(Number(valor), true), "Custo do kit"]}
                          />
                          <ReferenceLine
                            y={Number(l.teto_total)}
                            stroke="hsl(var(--muted-foreground))"
                            strokeDasharray="4 4"
                            strokeOpacity={0.6}
                            label={{ value: "teto somado", position: "insideTopRight", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          />
                          <Line
                            type="monotone" dataKey="total" name="Custo do kit"
                            stroke={COR_SERIE} strokeWidth={2} dot={false}
                            activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--background))" }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <KitDialog
        aberto={dialogAberto}
        onFechar={() => setDialogAberto(false)}
        onSalvo={() => { setCurvas({}); carregar(); }}
        kit={editando?.kit ?? null}
        itensIniciais={itensIniciais}
        alvos={alvos}
      />
    </div>
  );
}
