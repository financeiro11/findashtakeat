import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import Achados from "./auditoria/Achados";
import BaseCartao from "./auditoria/BaseCartao";
import { AlertTriangle, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "achados" | "base";

export default function Auditoria() {
  const [mode, setMode] = useState<Mode>("achados");

  useEffect(() => {
    document.title = mode === "achados" ? "FinHub · Auditoria" : "FinHub · Base do Cartão";
  }, [mode]);

  return (
    <div className="min-h-screen bg-[hsl(40_30%_97%)]">
      <PageHeader hideToolbar />

      {/* Sub-tabs (mesmo estilo do PlaybookHub) */}
      <div className="flex justify-center pt-3">
        <div className="inline-flex items-center rounded-lg border bg-background/90 backdrop-blur p-0.5 shadow-sm">
          <ModeBtn active={mode === "achados"} onClick={() => setMode("achados")} icon={<AlertTriangle className="h-3 w-3" />}>
            Achados
          </ModeBtn>
          <ModeBtn active={mode === "base"} onClick={() => setMode("base")} icon={<CreditCard className="h-3 w-3" />}>
            Base do Cartão
          </ModeBtn>
        </div>
      </div>

      {mode === "achados" ? <Achados /> : <BaseCartao />}
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
