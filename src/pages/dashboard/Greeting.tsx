import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sparkles, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Periodo, periodoLabel, subMeses, cmpPeriodo } from "./metrics";

interface Props {
  periodo: Periodo;
  periodosDisponiveis: Periodo[];
  onPeriodoChange: (p: Periodo) => void;
  onNovaAnalise: () => void;
  onPerguntarIA: () => void;
}

export function Greeting({ periodo, periodosDisponiveis, onPeriodoChange, onNovaAnalise, onPerguntarIA }: Props) {
  const { profile } = useAuth();
  const now = new Date();
  const hora = now.getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const nome = (profile?.nome?.split(" ")[0]) || "time";
  const dataFmt = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });

  const janelaIni = subMeses(periodo, 11);
  const idx = periodosDisponiveis.findIndex(p => p.ano === periodo.ano && p.mes === periodo.mes);
  const podeVoltar = idx > 0;
  const podeAvancar = idx >= 0 && idx < periodosDisponiveis.length - 1;

  return (
    <header className="flex items-end justify-between gap-4 pb-4 border-b border-border">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          {saudacao}, {nome}
        </h1>
        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="capitalize">{dataFmt}</span>
          <span>·</span>
          <button
            onClick={() => podeVoltar && onPeriodoChange(periodosDisponiveis[idx - 1])}
            disabled={!podeVoltar}
            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted disabled:opacity-30"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="font-medium text-foreground">Fechamento {periodoLabel(periodo)}</span>
          <button
            onClick={() => podeAvancar && onPeriodoChange(periodosDisponiveis[idx + 1])}
            disabled={!podeAvancar}
            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted disabled:opacity-30"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <span>·</span>
          <span>12 meses · janela {periodoLabel(janelaIni)} – {periodoLabel(periodo)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onNovaAnalise} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Nova análise
        </Button>
      </div>
    </header>
  );
}
