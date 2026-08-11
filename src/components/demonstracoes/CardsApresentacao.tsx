/* ============================================================================
 * As duas peças que a apresentação cria do nada.
 *
 * Todo o resto de uma folha vem do Hub — KPI, cascata, tabela — e a folha só
 * escolhe quais entram. Estas duas não: elas existem porque a reunião pede algo
 * que a DRE não tem como calcular.
 *
 *   · CardTexto  → o recado, o contexto, o "o que fizemos desde a última".
 *                  Escrito por gente (ou rascunhado pela IA e corrigido).
 *   · CardSerie  → a TENDÊNCIA. A tela da revisão é toda sobre um mês contra o
 *                  plano; quando o CEO pergunta "e vindo de onde?", não havia o
 *                  que mostrar. O desenho é de barras/linha em div, como a
 *                  cascata do bloco 2, e não em SVG de biblioteca: é isso que
 *                  deixa o exportador clonar a peça e o PNG sair igual à tela.
 * ========================================================================== */

import { Pencil, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { abreviado } from "@/lib/revisaoMes";
import type { PontoSerie } from "@/lib/apresentacao";

/* ------------------------------------------------------------------ texto -- */

export function CardTexto({
  titulo, corpo, onEditar,
}: {
  titulo: string;
  corpo: string;
  /** Ausente quando a apresentação está publicada (a ata não se edita). */
  onEditar?: () => void;
}) {
  return (
    <section className="card-surface relative p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold tracking-tight">{titulo || "Sem título"}</h3>
        {onEditar && (
          <button
            data-chrome="card-texto"
            onClick={onEditar}
            title="Escrever este card"
            className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
      {/* `whitespace-pre-line`: quem escreve o recado quebra linha de propósito,
          e um parágrafo colado numa massa só perde a lista que a pessoa fez. */}
      <p className="mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-foreground/85">
        {corpo || <span className="text-muted-foreground/60">Card de texto vazio — clique no lápis para escrever.</span>}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ série -- */

export function CardSerie({
  titulo, rubrica, pontos, formato,
}: {
  titulo: string;
  rubrica: string;
  pontos: PontoSerie[];
  formato: "barra" | "linha";
}) {
  const valores = pontos.map((p) => p.valor).filter((v): v is number => v != null && isFinite(v));
  const temDado = valores.length > 0;

  /* A escala INCLUI O ZERO de propósito, como a cascata: uma série de EBITDA
     negativo desenhada só sobre o módulo mostraria a barra mais funda como a
     mais alta, e ninguém veria que aquilo é prejuízo. */
  const topo = Math.max(...valores, 0);
  const fundo = Math.min(...valores, 0);
  const amplitude = topo - fundo || 1;
  const y = (v: number) => ((v - fundo) / amplitude) * 100;
  const zero = y(0);

  const ultimo = pontos.at(-1)?.valor ?? null;
  const primeiro = pontos.find((p) => p.valor != null)?.valor ?? null;
  const variacao = primeiro != null && ultimo != null && primeiro !== 0
    ? (ultimo - primeiro) / Math.abs(primeiro)
    : null;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b border-border p-3.5">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold tracking-tight">{titulo}</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {rubrica} · {pontos.length} meses
            {pontos.length > 0 && <> · de {pontos[0].rotulo} a {pontos.at(-1)!.rotulo}</>}
          </p>
        </div>
        {variacao != null && (
          <span className={cn(
            "inline-flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold",
            variacao >= 0 ? "text-pos" : "text-neg",
          )}>
            <TrendingUp className={cn("h-3.5 w-3.5", variacao < 0 && "rotate-180")} />
            {variacao >= 0 ? "+" : ""}{(variacao * 100).toFixed(1).replace(".", ",")}% no período
          </span>
        )}
      </header>

      {!temDado ? (
        <p className="p-4 text-[12px] text-muted-foreground">
          Não achei <b>{rubrica}</b> na DRE destes meses. Confira o nome da rubrica — ele tem de ser
          o rótulo da linha, como aparece na grade.
        </p>
      ) : (
        <>
          <div className="relative flex items-end gap-1.5 px-4 pt-4" style={{ height: 168 }}>
            <span
              className="pointer-events-none absolute left-4 right-4 h-px bg-border"
              style={{ bottom: `calc(${zero}% + 16px)` }}
            />
            {pontos.map((p) => {
              const v = p.valor;
              const alto = v == null ? 0 : Math.abs(y(v) - zero);
              const positivo = (v ?? 0) >= 0;
              return (
                <div key={p.col} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="num text-[9.5px] text-muted-foreground" title={valorExato(v)}>
                    {v == null ? "—" : abreviado(v)}
                  </span>
                  <div className="relative w-full flex-1">
                    {v != null && (formato === "barra" ? (
                      <div
                        className={cn(
                          "absolute w-full rounded-sm",
                          positivo ? "bg-[hsl(var(--info))]" : "bg-primary",
                        )}
                        style={{
                          bottom: `${positivo ? zero : zero - alto}%`,
                          height: `${Math.max(alto, 1.5)}%`,
                        }}
                      />
                    ) : (
                      /* "Linha" sem SVG: um ponto grosso na altura do valor e um
                         talo fino até o zero. Mantém o card clonável pelo
                         exportador e legível em PNG, que é o que importa. */
                      <>
                        <div
                          className="absolute left-1/2 w-px -translate-x-1/2 bg-border"
                          style={{ bottom: `${positivo ? zero : zero - alto}%`, height: `${Math.max(alto, 1)}%` }}
                        />
                        <div
                          className={cn(
                            "absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full",
                            positivo ? "bg-[hsl(var(--info))]" : "bg-primary",
                          )}
                          style={{ bottom: `calc(${y(v)}% - 4px)` }}
                        />
                      </>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-1.5 px-4 pb-3.5 pt-2 text-center text-[10px] text-muted-foreground">
            {pontos.map((p) => (
              <span key={p.col} className="min-w-0 flex-1 truncate">{p.rotulo}</span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
