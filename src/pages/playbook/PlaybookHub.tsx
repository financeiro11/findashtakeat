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
    <div className="flex flex-col h-[calc(100vh-49px)]">
      <div className="flex items-center justify-center border-b bg-background/80 backdrop-blur-sm px-6 py-2.5">
        <div className="inline-flex items-center rounded-xl border bg-muted/40 p-1 shadow-sm">
          <ModeBtn active={mode === "playbooks"} onClick={() => setMode("playbooks")} icon={<BookOpenCheck className="h-3.5 w-3.5"/>}>
            Playbooks
          </ModeBtn>
          <ModeBtn active={mode === "workspace"} onClick={() => setMode("workspace")} icon={<NotebookPen className="h-3.5 w-3.5"/>}>
            Workspace
          </ModeBtn>
          <ModeBtn active={mode === "flows"} onClick={() => setMode("flows")} icon={<Workflow className="h-3.5 w-3.5"/>}>
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
        "inline-flex items-center gap-1.5 px-4 h-8 rounded-lg text-[13px] font-medium transition-all",
        active
          ? "bg-background shadow-sm text-foreground ring-1 ring-border"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}{children}
    </button>
  );
}
