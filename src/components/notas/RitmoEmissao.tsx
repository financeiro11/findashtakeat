import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, LineChart, Line, Tooltip, Legend } from "recharts";
import { Table2, TrendingUp, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * RITMO DE EMISSÃO — este mês contra o passado, sempre no acumulado.
 *
 * POR QUE ESTE GRÁFICO EXISTE. Em 09/09/2026 a pergunta foi "senti que poucas
 * notas saíram hoje". As 147 daquele dia eram MAIS que as 130 da véspera e um
 * quarto das 540 do dia 3 — e as duas comparações estavam erradas, porque a
 * emissão é sazonal dentro do mês: o vencimento se concentra nos dias 1 a 5 e a
 * emissão o segue. A única comparação que responde é o dia 9 contra o dia 9.
 *
 * ACUMULADO, E NÃO DIÁRIO, por decisão do financeiro. Duas séries diárias sobem
 * e descem por fim de semana e feriado e a leitura vira adivinhação; no
 * acumulado a DISTÂNCIA entre as linhas é a resposta, e o tamanho do vão é de
 * quantas notas.
 *
 * DUAS MÉTRICAS E UM SELETOR, porque são duas perguntas:
 *   • Cobertura — que fração do que já entrou já tem nota, de qualquer origem.
 *     É a que corrige volume de venda, e por isso é o padrão.
 *   • Notas emitidas — a produção da nossa esteira. Sobe quando emitimos e cai
 *     quando ela trava, mas confunde "vendemos menos" com "emitimos menos".
 *
 * Um seletor e não dois gráficos lado a lado: eles têm escalas diferentes (% e
 * contagem) e o mesmo eixo x, que é exatamente a armadilha do eixo duplo.
 *
 * As cores passaram no validador nas duas superfícies (clara #fcfcfd e escura
 * #181b21): faixa de luminosidade, croma, separação para daltonismo (ΔE 18,4
 * protan) e contraste. O mês anterior vai TRACEJADO — reforço além da cor, que
 * é o que a régua pede quando o par tem tritan baixo.
 */
const COR_ATUAL = "#3b82f6";
const COR_ANTERIOR = "#0d9488";

interface Ponto {
  dia: number;
  emitidas_atual: number | null;
  emitidas_ant: number | null;
  cobertura_atual: number | null;
  cobertura_ant: number | null;
}

interface Placar {
  dia: number;
  emitidas_atual: number; emitidas_ant: number;
  exigem_atual: number; exigem_ant: number;
  com_nota_atual: number; com_nota_ant: number;
  cobertura_atual: number | null; cobertura_ant: number | null;
}

interface Ritmo {
  mes_atual: string;
  mes_anterior: string;
  dia_corte: number;
  esteira_desde: string | null;
  emitidas_ant_dias: number;
  emitidas_ant_confiavel: boolean;
  serie: Ponto[];
  hoje: Placar | null;
}

const sb = supabase as any;

/** "2026-09" → "setembro". O mês por extenso porque o rótulo é lido em frase
 *  ("setembro, no dia 9"), e "09" ali obrigaria a pessoa a traduzir. */
function nomeDoMes(iso: string): string {
  const [a, m] = iso.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
}

type Metrica = "cobertura" | "emitidas";

export function RitmoEmissao({ mes }: { mes?: string }) {
  const [dados, setDados] = useState<Ritmo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [metrica, setMetrica] = useState<Metrica>("cobertura");
  const [tabela, setTabela] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await sb.rpc("notas_fiscais_ritmo", { p_mes: mes ?? null });
      if (!vivo) return;
      if (error) { setErro(error.message); return; }
      setDados(data as Ritmo);
    })();
    return () => { vivo = false; };
  }, [mes]);

  const nomeAtual = dados ? nomeDoMes(dados.mes_atual) : "";
  const nomeAnterior = dados ? nomeDoMes(dados.mes_anterior) : "";

  /* A série cortada onde os dois meses têm dia. Fevereiro contra março
     desenharia dois pontos órfãos no fim; cortar no menor dos dois é o que faz
     as duas linhas terminarem juntas. */
  const serie = useMemo(() => (dados?.serie ?? []).filter((p) => p.dia <= 31), [dados]);

  const chaveAtual = metrica === "cobertura" ? "cobertura_atual" : "emitidas_atual";
  const chaveAnt = metrica === "cobertura" ? "cobertura_ant" : "emitidas_ant";
  const fmt = (v: number | null) =>
    v == null ? "—" : metrica === "cobertura" ? `${v.toString().replace(".", ",")}%` : String(v);

  if (erro) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-xs text-destructive">
        Não deu para ler o ritmo de emissão: {erro}
      </div>
    );
  }
  if (!dados) {
    return <div className="h-[260px] animate-pulse rounded-lg border border-border bg-card" />;
  }

  const h = dados.hoje;
  /* A comparação da métrica escolhida, em pontos percentuais ou em notas. O
     sinal decide a cor, e "igual" não é verde nem vermelho. */
  const delta = h
    ? metrica === "cobertura"
      ? (h.cobertura_atual ?? 0) - (h.cobertura_ant ?? 0)
      : h.emitidas_atual - h.emitidas_ant
    : 0;

  /* A esteira do Omie não emitia no mês passado dentro desta janela — comparar
     com zero e chamar de alta seria inventar uma notícia. O aviso vale só para
     a métrica de produção; a cobertura conta nota do Asaas também e por isso
     compara os dois meses de verdade. */
  const semBase = metrica === "emitidas" && !dados.emitidas_ant_confiavel;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-foreground">
          Ritmo de emissão · acumulado até o dia {dados.dia_corte}
        </h3>
        <div className="ml-auto flex items-center gap-1">
          {(["cobertura", "emitidas"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetrica(m)}
              className={cn(
                "rounded border px-2 py-1 text-[11px] transition-colors",
                metrica === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
              )}
              title={m === "cobertura"
                ? "Das cobranças que já entraram e exigem nota, quantas já têm uma — de qualquer origem. Corrige variação de venda."
                : "Quantas NFS-e a nossa esteira autorizou. Mede a produção do motor, não a cobertura."}
            >
              {m === "cobertura" ? "Cobertura" : "Notas emitidas"}
            </button>
          ))}
          <button
            onClick={() => setTabela((v) => !v)}
            className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            title={tabela ? "Ver o gráfico" : "Ver os números"}
          >
            <Table2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* O PLACAR ANTES DO GRÁFICO: é ele que responde à pergunta. Quem quiser
          saber "por quê" desce para a curva; quem quiser só saber "estamos bem?"
          não precisa ler eixo nenhum. */}
      {h && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div>
            <span className="num text-2xl font-semibold text-foreground">
              {fmt(metrica === "cobertura" ? h.cobertura_atual : h.emitidas_atual)}
            </span>
            <span className="ml-1.5 text-[11px] text-muted-foreground">{nomeAtual}, no dia {h.dia}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            <span className="num">{fmt(metrica === "cobertura" ? h.cobertura_ant : h.emitidas_ant)}</span>
            {" "}em {nomeAnterior} no mesmo dia
          </div>
          {!semBase && (
            <span className={cn(
              "num rounded border px-1.5 py-0.5 text-[11px] font-medium",
              delta > 0 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : delta < 0 ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border text-muted-foreground",
            )}>
              {delta > 0 ? "+" : ""}
              {metrica === "cobertura"
                ? `${delta.toFixed(1).replace(".", ",")} p.p.`
                : `${delta} notas`}
            </span>
          )}
          {metrica === "cobertura" && h && (
            <span className="text-[11px] text-muted-foreground">
              <span className="num">{h.com_nota_atual}</span> de <span className="num">{h.exigem_atual}</span> cobranças
            </span>
          )}
        </div>
      )}

      {semBase && (
        <div className="mb-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            A esteira do Omie não autorizou nenhuma nota em {nomeAnterior} até o dia {dados.dia_corte}
            {dados.esteira_desde ? ` (ela emite desde ${new Date(dados.esteira_desde + "T00:00:00").toLocaleDateString("pt-BR")}, com pausas)` : ""}
            {" "}— então não há com o que comparar a produção. Use <strong>Cobertura</strong>, que conta a nota do Asaas também.
          </span>
        </div>
      )}

      {tabela ? (
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-1 font-medium">Dia</th>
                <th className="p-1 text-right font-medium capitalize">{nomeAtual}</th>
                <th className="p-1 text-right font-medium capitalize">{nomeAnterior}</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((p) => (
                <tr key={p.dia} className="border-b border-border/50 last:border-0">
                  <td className="num p-1">{p.dia}</td>
                  <td className="num p-1 text-right">{fmt(p[chaveAtual] as number | null)}</td>
                  <td className="num p-1 text-right">{fmt(p[chaveAnt] as number | null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={serie} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="dia"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              minTickGap={16}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              /* Cobertura de 0 a 100 SEMPRE: é uma fração, e deixar a escala
                 flutuar faria 48% e 61% parecerem o fundo e o topo do mundo.
                 Contagem começa no zero porque acumulado começa no zero. */
              domain={metrica === "cobertura" ? [0, 100] : [0, "auto"]}
              tickFormatter={(v) => (metrica === "cobertura" ? `${v}%` : String(v))}
              width={40}
            />
            <Tooltip
              cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(v) => `Dia ${v} — acumulado`}
              formatter={(valor: any, nome: any) => [fmt(valor == null ? null : Number(valor)), nome]}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={20}
              iconType="plainline"
              wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}
            />
            <Line
              type="monotone"
              dataKey={chaveAtual}
              name={nomeAtual}
              stroke={COR_ATUAL}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {/* Tracejado: o reforço além da cor. O par passa na régua de
                daltonismo em protan/deutan, e o traço cobre o tritan. */}
            <Line
              type="monotone"
              dataKey={chaveAnt}
              name={nomeAnterior}
              stroke={COR_ANTERIOR}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
