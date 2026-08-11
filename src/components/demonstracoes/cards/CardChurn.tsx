/* Card de churn para apresentações — autossuficiente (ver `lib/registroCards`).
 *
 * Lê `churn_snapshot` no mês que a apresentação pediu e, quando aquele mês não
 * tem foto (a planilha da diretoria atrasa), cai no mais recente ANTERIOR e diz
 * de que mês veio. Silenciar isso seria mostrar o churn de agosto numa folha de
 * julho — o tipo de erro que ninguém percebe numa reunião. */

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { abreviado } from "@/lib/revisaoMes";
import { competenciaDe } from "@/lib/analisesDre";
import type { ContextoCard } from "@/lib/registroCards";

const sb = supabase as any;

type Ponto = { qtd: number; valor: number; pct: number; mesLabel: string; competencia: string };

export function CardChurn({ ctx }: { ctx: ContextoCard }) {
  const [pontos, setPontos] = useState<Ponto[] | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await sb
        .from("churn_snapshot")
        .select("competencia,mes_label,dados")
        .order("competencia", { ascending: true });
      if (!vivo) return;
      type Linha = {
        competencia: string;
        mes_label: string | null;
        dados: { kpis?: { churn_qtd?: number; churn_valor?: number; pct_receita_geral?: number } } | null;
      };
      setPontos(((data ?? []) as Linha[]).filter((r) => r.dados).map((r) => ({
        competencia: String(r.competencia).slice(0, 7),
        qtd: r.dados!.kpis?.churn_qtd ?? 0,
        valor: r.dados!.kpis?.churn_valor ?? 0,
        pct: r.dados!.kpis?.pct_receita_geral ?? 0,
        mesLabel: r.mes_label ?? "",
      })));
    })();
    return () => { vivo = false; };
  }, []);

  const alvo = competenciaDe(ctx.mes);
  const ate = (c: string | null) =>
    !c || !pontos ? null : [...pontos].reverse().find((p) => p.competencia <= c) ?? null;
  const mes = ate(alvo);
  const anterior = mes ? ate(mesAnterior(mes.competencia)) : null;
  const defasado = !!mes && !!alvo && mes.competencia !== alvo;

  const delta = mes && anterior ? mes.qtd - anterior.qtd : null;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b border-border p-3.5">
        <div>
          <h3 className="text-[13.5px] font-semibold tracking-tight">Churn · {mes?.mesLabel || ctx.rotuloMes}</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Cancelamentos e MRR perdido — base do Asaas.
          </p>
        </div>
      </header>

      {pontos == null ? (
        <p className="p-4 text-[12px] text-muted-foreground">Carregando…</p>
      ) : !mes ? (
        <p className="p-4 text-[12px] text-muted-foreground">
          Não há snapshot de churn até {ctx.rotuloMes}. Ele aparece quando o <b>churn-sheet-sync</b> rodar.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 p-4">
            {[
              { r: "Clientes que saíram", v: Math.round(mes.qtd).toLocaleString("pt-BR"), t: "text-neg" },
              { r: "MRR perdido", v: abreviado(mes.valor), t: "text-neg", cheio: mes.valor },
              { r: "% da receita", v: `${(mes.pct ?? 0).toFixed(2).replace(".", ",")}%`, t: "" },
            ].map((x) => (
              <div key={x.r} className="flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{x.r}</div>
                <div className={cn("num text-[24px] font-semibold leading-none tracking-tight", x.t)}
                     title={x.cheio != null ? valorExato(x.cheio) : undefined}>
                  {x.v}
                </div>
              </div>
            ))}
          </div>

          {delta != null && (
            <p className="border-t border-border/60 px-4 py-2.5 text-[11.5px] text-muted-foreground">
              Contra {anterior!.mesLabel}:{" "}
              {/* Menos gente saindo é melhor — o verde não segue o sinal do número. */}
              <b className={cn("num", delta <= 0 ? "text-pos" : "text-neg")}>
                {delta > 0 ? "+" : ""}{delta}
              </b>{" "}
              cliente(s).
            </p>
          )}

          {defasado && (
            <p className="flex items-start gap-1.5 border-t border-border/60 px-4 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
              <Info className="mt-px h-3 w-3 shrink-0" />
              Não há foto de churn para {ctx.rotuloMes}: os números acima são de <b>{mes.mesLabel}</b>.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** "2026-07" → "2026-06" */
function mesAnterior(c: string): string {
  const [a, m] = c.split("-").map(Number);
  return m > 1 ? `${a}-${String(m - 1).padStart(2, "0")}` : `${a - 1}-12`;
}
