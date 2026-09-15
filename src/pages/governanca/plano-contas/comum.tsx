import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { pctStr } from "@/pages/cartao/fmt";

/**
 * A variação colorida pelo CAIXA, não pelo sinal: despesa que sobe é vermelho,
 * receita que sobe é verde. `null` é "sem base" — nunca "novo" nem "+∞%".
 */
export function Variacao({ v, despesa, className }: { v: number | null; despesa: boolean; className?: string }) {
  if (v === null) {
    return <span className={cn("num text-muted-foreground", className)} title="Sem base de comparação">—</span>;
  }
  const neutro = Math.abs(v) < 0.005;
  const favoravel = despesa ? v < 0 : v > 0;
  return (
    <span className={cn("num", neutro ? "text-muted-foreground" : favoravel ? "text-pos" : "text-neg", className)}>
      {pctStr(v)}
    </span>
  );
}

type Tom = "neutro" | "atencao" | "destaque" | "pos" | "neg";

const TOM: Record<Tom, string> = {
  neutro: "border-border text-muted-foreground",
  atencao: "border-warn/40 bg-warn/5 text-warn",
  destaque: "border-primary/30 bg-primary/5 text-primary",
  pos: "border-pos/30 text-pos",
  neg: "border-neg/30 text-neg",
};

export function Chip({ children, tom = "neutro", title, className }: {
  children: ReactNode; tom?: Tom; title?: string; className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
        TOM[tom],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Secao({ titulo, nota, children, acao, id }: {
  titulo: string; nota?: ReactNode; children: ReactNode; acao?: ReactNode; id?: string;
}) {
  return (
    <section id={id} className="card-surface p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-tight text-foreground">{titulo}</h2>
          {nota && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{nota}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}
