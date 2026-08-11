/* Card de churn para apresentações — autossuficiente (ver `lib/registroCards`).
 *
 * Churn é FLUXO: soma a janela inteira do período. Num trimestre, os clientes
 * que saíram são os dos três meses, e o MRR perdido é a soma — não a foto do
 * último mês, que responderia outra pergunta.
 *
 * Mês da janela sem foto (a planilha da diretoria atrasa) fica FORA da soma e é
 * declarado no rodapé. Emendar com o mês anterior inflaria o trimestre contando
 * o mesmo mês duas vezes; silenciar daria um trimestre pequeno com cara de bom. */

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

  const { periodo } = ctx;
  const porMes = new Map((pontos ?? []).map((p) => [p.competencia, p]));
  const naJanela = periodo.meses
    .map((m) => { const c = competenciaDe(m); return c ? porMes.get(c) ?? null : null; });
  const achados = naJanela.filter((p): p is Ponto => p != null);
  const semFoto = periodo.meses.filter((_, i) => naJanela[i] == null);

  const qtd = achados.reduce((s, p) => s + (p.qtd ?? 0), 0);
  const valor = achados.reduce((s, p) => s + (p.valor ?? 0), 0);
  const media = achados.length ? qtd / achados.length : null;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b border-border p-3.5">
        <div>
          <h3 className="text-[13.5px] font-semibold tracking-tight">Churn · {periodo.rotulo}</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Cancelamentos e MRR perdido, base do Asaas
            {achados.length > 1 && ` — somados nos ${achados.length} meses da janela`}.
          </p>
        </div>
      </header>

      {pontos == null ? (
        <p className="p-4 text-[12px] text-muted-foreground">Carregando…</p>
      ) : achados.length === 0 ? (
        <p className="p-4 text-[12px] text-muted-foreground">
          Não há snapshot de churn em {periodo.rotulo}. Ele aparece quando o{" "}
          <b>churn-sheet-sync</b> rodar.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 p-4">
            {[
              { r: "Clientes que saíram", v: Math.round(qtd).toLocaleString("pt-BR"), t: "text-neg" },
              { r: "MRR perdido", v: abreviado(valor), t: "text-neg", cheio: valor },
              {
                r: achados.length > 1 ? "Média por mês" : "% da receita",
                v: achados.length > 1
                  ? `${(media ?? 0).toFixed(1).replace(".", ",")}`
                  : `${(achados[0].pct ?? 0).toFixed(2).replace(".", ",")}%`,
                t: "",
              },
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

          {achados.length > 1 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border/60 px-4 py-2.5 text-[11.5px] text-muted-foreground">
              {achados.map((p) => (
                <span key={p.competencia}>
                  {p.mesLabel || p.competencia}{" "}
                  <b className="num text-foreground">{Math.round(p.qtd)}</b>
                </span>
              ))}
            </div>
          )}

          {semFoto.length > 0 && (
            <p className="flex items-start gap-1.5 border-t border-border/60 px-4 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
              <Info className="mt-px h-3 w-3 shrink-0" />
              {semFoto.length} mês(es) da janela ainda não têm foto de churn e ficaram{" "}
              <b>fora da soma</b>: {semFoto.join(", ")}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
