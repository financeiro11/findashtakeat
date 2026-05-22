import { useState } from "react";
import Playbook from "./Playbook";
import Workspace from "./workspace/Workspace";
import Flows from "./flows/Flows";
import { BookOpenCheck, NotebookPen, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "playbooks" | "workspace" | "flows";

export default function PlaybookHub() {
  const [mode, setMode] = useState<Mode>("playbooks");

  return (
    <div className="relative flex flex-col h-[calc(100vh-49px)]">
      <div className="pointer-events-none absolute top-2 right-4 z-30">
        <div className="pointer-events-auto inline-flex items-center rounded-lg border bg-background/90 backdrop-blur p-0.5 shadow-sm">
          <ModeBtn active={mode === "playbooks"} onClick={() => setMode("playbooks")} icon={<BookOpenCheck className="h-3 w-3"/>}>
            Playbooks
          </ModeBtn>
          <ModeBtn active={mode === "workspace"} onClick={() => setMode("workspace")} icon={<NotebookPen className="h-3 w-3"/>}>
            Workspace
          </ModeBtn>
          <ModeBtn active={mode === "flows"} onClick={() => setMode("flows")} icon={<Workflow className="h-3 w-3"/>}>
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
