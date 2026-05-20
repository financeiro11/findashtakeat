import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

interface Props {
  onAsk: (prompt: string) => void;
}

const EXAMPLES = [
  "Por que a margem caiu em maio?",
  "Qual rubrica mais cresceu nos últimos 3 meses?",
  "Como está o runway no cenário atual?",
  "O que explica a variação do EBITDA vs mês anterior?",
  "Quais despesas estão acima da média de 6 meses?",
  "Onde estamos queimando mais caixa?",
  "Qual o impacto de Pessoal na DRE deste mês?",
  "Receita está acelerando ou desacelerando?",
  "Quais anomalias surgiram no fechamento?",
  "Como está a eficiência de Mkt & Vendas?",
];

export function AskAIBar({ onAsk }: Props) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * EXAMPLES.length));
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % EXAMPLES.length);
        setFade(true);
      }, 220);
    }, 4500);
    return () => clearInterval(id);
  }, []);

  const example = EXAMPLES[idx];

  return (
    <div className="card-surface flex items-center gap-3 px-3 py-2">
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{ background: "linear-gradient(135deg, #FDE68A 0%, #F87171 60%, hsl(var(--primary)) 100%)" }}
        aria-hidden
      >
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </div>
      <button
        onClick={() => onAsk(example)}
        className="flex-1 text-left text-[12px] text-muted-foreground hover:text-foreground transition-colors truncate"
      >
        <span className="font-medium text-foreground">Pergunte à IA:</span>{" "}
        <span
          className="italic transition-opacity duration-200"
          style={{ opacity: fade ? 1 : 0 }}
        >
          "{example}"
        </span>
      </button>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onAsk("Mostre as anomalias detectadas no período.")}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-[11.5px] text-foreground hover:border-primary/30 transition-colors"
        >
          Anomalias
        </button>
        <button
          onClick={() => onAsk("Faça um forecast dos próximos 3 meses.")}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-[11.5px] text-foreground hover:border-primary/30 transition-colors"
        >
          Forecast
        </button>
        <button
          onClick={() => onAsk("Faça um drill-down da DRE deste mês.")}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-[11.5px] text-foreground hover:border-primary/30 transition-colors"
        >
          Drill-down DRE
        </button>
      </div>
    </div>
  );
}
