/* ============================================================================
 * Resultado do período — o card que um material de Conselho abre.
 *
 * Receita, EBITDA e margem SOMADOS na janela da apresentação: num mês é o mês,
 * num trimestre é o trimestre, em "últimos 12" é o ano móvel. É o card que prova
 * o contrato de período (`lib/periodo.ts`) — todo o resto da tela continua sendo
 * de um mês só, e este atravessa.
 *
 * A MARGEM É RECALCULADA sobre os totais, nunca é média das margens mensais: um
 * mês pequeno com margem boa puxaria a média para cima e diria que o trimestre
 * foi melhor do que foi.
 *
 * Autossuficiente: busca o próprio blob da DRE (ver `lib/registroCards`). Custa
 * uma consulta a mais que ler da página anfitriã, e é o preço de o card poder
 * entrar numa folha sem que a página saiba o que ele é.
 * ========================================================================== */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { abreviado, fracPct, RECEITA_BRUTA } from "@/lib/revisaoMes";
import { lerBlobMensal, lerDre, rotuloMes, EBITDA, RL, type Leitor } from "@/lib/analisesDre";
import { somarNoPeriodo } from "@/lib/periodo";
import type { ContextoCard } from "@/lib/registroCards";

const sb = supabase as any;

export function CardResultadoPeriodo({ ctx }: { ctx: ContextoCard }) {
  const [leitor, setLeitor] = useState<Leitor | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await sb
        // periodo='completo': o registro em que o import/omie-sync escrevem — a tabela
        // também guarda backups, e "o mais recente do tipo" pegava o backup.
        .from("demonstracoes_contabeis").select("dados")
        .eq("tipo", "dre").eq("periodo", "completo").maybeSingle();
      if (!vivo) return;
      const blob = lerBlobMensal(data?.dados);
      setLeitor(lerDre(blob.rows, blob.columns));
    })();
    return () => { vivo = false; };
  }, []);

  const { periodo } = ctx;
  const receita = leitor && somarNoPeriodo(periodo, (m) => leitor.receita(RECEITA_BRUTA, m));
  const liquida = leitor && somarNoPeriodo(periodo, (m) => leitor.receita(RL, m));
  const ebitda = leitor && somarNoPeriodo(periodo, (m) => leitor.bruto(EBITDA, m));
  const margem = ebitda != null && liquida ? ebitda / liquida : null;

  const KPIS = [
    { r: "Receita bruta", v: receita, tom: "" },
    { r: "Receita líquida", v: liquida, tom: "" },
    { r: "EBITDA", v: ebitda, tom: (ebitda ?? 0) >= 0 ? "text-pos" : "text-neg" },
  ];

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b border-border p-3.5">
        <div>
          <h3 className="text-[13.5px] font-semibold tracking-tight">Resultado · {periodo.rotulo}</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {periodo.meses.length === 1
              ? "Um mês fechado da DRE."
              : `Somado nos ${periodo.meses.length} meses da janela — ${rotuloMes(periodo.meses[0])} a ${rotuloMes(periodo.mesFoco)}.`}
            {periodo.parcial && " Período ainda incompleto."}
          </p>
        </div>
        {margem != null && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Margem EBITDA</div>
            <div className={cn("num text-[20px] font-semibold leading-none", margem >= 0 ? "text-pos" : "text-neg")}>
              {fracPct(margem)}
            </div>
          </div>
        )}
      </header>

      {!leitor ? (
        <p className="p-4 text-[12px] text-muted-foreground">Carregando a DRE…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 p-4">
            {KPIS.map((k) => (
              <div key={k.r} className="flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.r}</div>
                <div className={cn("num text-[24px] font-semibold leading-none tracking-tight", k.tom)}
                     title={k.v == null ? undefined : valorExato(k.v)}>
                  {k.v == null ? "—" : abreviado(k.v)}
                </div>
              </div>
            ))}
          </div>

          {periodo.meses.length > 1 && (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-secondary/40">
                  {["MÊS", "RECEITA BRUTA", "RECEITA LÍQUIDA", "EBITDA", "MARGEM"].map((h, i) => (
                    <th key={h} className={cn(
                      "px-4 py-2 text-[10px] font-bold tracking-wider text-muted-foreground",
                      i === 0 ? "text-left" : "text-right",
                    )}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodo.meses.map((m) => {
                  const rb = leitor.receita(RECEITA_BRUTA, m);
                  const rl = leitor.receita(RL, m);
                  const eb = leitor.bruto(EBITDA, m);
                  const mg = eb != null && rl ? eb / rl : null;
                  return (
                    <tr key={m} className="border-b border-border/50">
                      <td className="px-4 py-2 text-[12px]">{rotuloMes(m)}</td>
                      <td className="num px-4 py-2 text-right text-[12px]" title={valorExato(rb)}>
                        {rb == null ? "—" : abreviado(rb)}
                      </td>
                      <td className="num px-4 py-2 text-right text-[12px] text-muted-foreground" title={valorExato(rl)}>
                        {rl == null ? "—" : abreviado(rl)}
                      </td>
                      <td className={cn("num px-4 py-2 text-right text-[12px] font-semibold", (eb ?? 0) < 0 && "text-neg")}
                          title={valorExato(eb)}>
                        {eb == null ? "—" : abreviado(eb)}
                      </td>
                      <td className={cn("num px-4 py-2 text-right text-[12px]", (mg ?? 0) < 0 && "text-neg")}>
                        {fracPct(mg)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p className="border-t border-border/60 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            A margem do período é <b>EBITDA ÷ receita líquida do período</b>, e não a média das
            margens mensais — um mês pequeno com margem boa puxaria a média para cima e diria que
            o trimestre foi melhor do que foi.
          </p>
        </>
      )}
    </section>
  );
}
