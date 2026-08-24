import { useEffect, useState } from "react";
import Achados from "./auditoria/Achados";
import BaseCartao from "./auditoria/BaseCartao";
import BasePix from "./auditoria/BasePix";
import { AlertTriangle, CreditCard, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "achados" | "base" | "pix";

const TITLES: Record<Mode, string> = {
  achados: "FinHub · Auditoria",
  base: "FinHub · Base do Cartão",
  pix: "FinHub · PIX Sicoob",
};

export default function Auditoria() {
  const [mode, setMode] = useState<Mode>("achados");

  useEffect(() => {
    document.title = TITLES[mode];
  }, [mode]);

  /* As três visões deixaram de flutuar centralizadas acima da página: agora são
     um seletor no canto do cabeçalho, ao lado das ações da tela — cada página
     encaixa este nó no lugar onde o resto dos botões já mora. */
  const abas = (
    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
      <ModeBtn active={mode === "achados"} onClick={() => setMode("achados")} icon={<AlertTriangle className="h-3 w-3" />}>
        Achados
      </ModeBtn>
      <ModeBtn active={mode === "base"} onClick={() => setMode("base")} icon={<CreditCard className="h-3 w-3" />}>
        Base do Cartão
      </ModeBtn>
      <ModeBtn active={mode === "pix"} onClick={() => setMode("pix")} icon={<Zap className="h-3 w-3" />}>
        PIX
      </ModeBtn>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {mode === "achados" ? <Achados abas={abas} /> : mode === "base" ? <BaseCartao abas={abas} /> : <BasePix abas={abas} />}
    </div>
  );
}

function ModeBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 h-7 rounded-md text-xs font-medium transition-all",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}{children}
    </button>
  );
}
