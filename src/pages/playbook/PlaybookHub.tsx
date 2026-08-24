import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Playbook from "./Playbook";
import Workspace from "./workspace/Workspace";
import Flows from "./flows/Flows";
import { BookOpenCheck, NotebookPen, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "playbooks" | "workspace" | "flows";

/**
 * As três abas de Anotações. Qual está aberta é a URL, não estado de tela — porque uma
 * anotação precisa ter endereço próprio para ser compartilhada, e endereço que só existe
 * na memória do componente não vai em mensagem nenhuma.
 *
 *   /playbook          → Playbooks
 *   /playbook?aba=fluxos → Fluxos
 *   /notas             → Workspace
 *   /notas/<id>        → Workspace com aquela nota aberta  ← o link que se compartilha
 *
 * `/notas/<id>` é o MESMO endereço do celular (lá o App.tsx monta MobileNota). Não existe
 * "link do computador" e "link do celular" para alguém escolher errado.
 */
export default function PlaybookHub() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const mode: Mode = pathname.startsWith("/notas")
    ? "workspace"
    : params.get("aba") === "fluxos"
      ? "flows"
      : "playbooks";

  const irPara = (m: Mode) => {
    if (m === "workspace") navigate("/notas");
    else if (m === "flows") navigate("/playbook?aba=fluxos");
    else navigate("/playbook");
  };

  return (
    <div className="relative flex flex-col h-[calc(100vh-49px)]">
      <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-30">
        <div className="pointer-events-auto inline-flex items-center rounded-lg border bg-background/90 backdrop-blur p-0.5 shadow-sm">
          <ModeBtn active={mode === "playbooks"} onClick={() => irPara("playbooks")} icon={<BookOpenCheck className="h-3 w-3"/>}>
            Playbooks
          </ModeBtn>
          <ModeBtn active={mode === "workspace"} onClick={() => irPara("workspace")} icon={<NotebookPen className="h-3 w-3"/>}>
            Workspace
          </ModeBtn>
          <ModeBtn active={mode === "flows"} onClick={() => irPara("flows")} icon={<Workflow className="h-3 w-3"/>}>
            Fluxos
          </ModeBtn>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {mode === "playbooks" ? <Playbook /> : mode === "workspace" ? <Workspace /> : <Flows />}
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 h-6 rounded-md text-[11.5px] font-medium transition-all",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}{children}
    </button>
  );
}
