/* Card de carteira por porte para apresentações — autossuficiente.
 *
 * Carteira é ESTOQUE, não fluxo: num trimestre ela vale no ÚLTIMO mês da janela,
 * e não somada. Somar três meses contaria o mesmo cliente três vezes e devolveria
 * uma base três vezes maior que a real — o erro mais fácil de cometer e o mais
 * difícil de notar num slide.
 *
 * Sem foto para o mês de fechamento, cai na mais recente anterior e avisa. */

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { valorExato } from "@/lib/valor";
import { abreviado } from "@/lib/revisaoMes";
import { competenciaDe } from "@/lib/analisesDre";
import type { ContextoCard } from "@/lib/registroCards";

const sb = supabase as any;

type Nivel = { nivel: string; clientes: number; mrr: number; tm: number };
type Foto = { competencia: string; mesLabel: string; mix: Nivel[]; clientes: number; mrr: number; ticket: number };

export function CardCarteira({ ctx }: { ctx: ContextoCard }) {
  const [fotos, setFotos] = useState<Foto[] | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await sb
        .from("assinaturas_snapshot")
        .select("competencia,mes_label,dados")
        .order("competencia", { ascending: true });
      if (!vivo) return;
      type Linha = {
        competencia: string;
        mes_label: string | null;
        dados: {
          mix_nivel?: Nivel[];
          kpis?: { clientes_ativos?: number; mrr_core?: number; ticket_medio?: number };
        } | null;
      };
      setFotos(((data ?? []) as Linha[]).filter((r) => r.dados).map((r) => ({
        competencia: String(r.competencia).slice(0, 7),
        mesLabel: r.mes_label ?? "",
        mix: r.dados!.mix_nivel ?? [],
        clientes: r.dados!.kpis?.clientes_ativos ?? 0,
        mrr: r.dados!.kpis?.mrr_core ?? 0,
        ticket: r.dados!.kpis?.ticket_medio ?? 0,
      })));
    })();
    return () => { vivo = false; };
  }, []);

  const alvo = competenciaDe(ctx.mes);
  const foto = !alvo || !fotos ? null : [...fotos].reverse().find((f) => f.competencia <= alvo) ?? null;
  const defasada = !!foto && !!alvo && foto.competencia !== alvo;
  const totalClientes = foto?.mix.reduce((s, n) => s + (n.clientes ?? 0), 0) ?? 0;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b border-border p-3.5">
        <div>
          <h3 className="text-[13.5px] font-semibold tracking-tight">Carteira por porte</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Base do Asaas · {foto?.mesLabel || ctx.rotuloMes}
            {ctx.periodo.meses.length > 1 && " · foto do fechamento, não somada no período"}
          </p>
        </div>
        {foto && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {Math.round(foto.clientes).toLocaleString("pt-BR")} ativos · MRR{" "}
            <b className="num text-foreground" title={valorExato(foto.mrr)}>{abreviado(foto.mrr)}</b> · ticket{" "}
            <b className="num text-foreground" title={valorExato(foto.ticket)}>{abreviado(foto.ticket)}</b>
          </span>
        )}
      </header>

      {fotos == null ? (
        <p className="p-4 text-[12px] text-muted-foreground">Carregando…</p>
      ) : !foto || foto.mix.length === 0 ? (
        <p className="p-4 text-[12px] text-muted-foreground">
          Sem snapshot de assinaturas até {ctx.rotuloMes}. Ele aparece quando o{" "}
          <b>assinaturas-sheet-sync</b> rodar.
        </p>
      ) : (
        <>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {["PORTE", "CLIENTES", "MIX", "MRR", "TICKET"].map((h, i) => (
                  <th key={h} className={`px-4 py-2 text-[10px] font-bold tracking-wider text-muted-foreground ${i === 0 || i === 2 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {foto.mix.map((n) => (
                <tr key={n.nivel} className="border-b border-border/50">
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">
                      {n.nivel}
                    </span>
                  </td>
                  <td className="num px-4 py-2 text-right text-[12px]">
                    {Math.round(n.clientes ?? 0).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: `${totalClientes ? ((n.clientes ?? 0) / totalClientes) * 100 : 0}%` }}
                      />
                    </div>
                  </td>
                  <td className="num px-4 py-2 text-right text-[12px]" title={valorExato(n.mrr)}>
                    {abreviado(n.mrr)}
                  </td>
                  <td className="num px-4 py-2 text-right text-[12px] text-muted-foreground" title={valorExato(n.tm)}>
                    {abreviado(n.tm)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {defasada && (
            <p className="flex items-start gap-1.5 border-t border-border/60 px-4 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
              <Info className="mt-px h-3 w-3 shrink-0" />
              Não há snapshot de assinaturas para {ctx.rotuloMes}: a carteira acima é de{" "}
              <b>{foto.mesLabel}</b>.
            </p>
          )}
        </>
      )}
    </section>
  );
}
