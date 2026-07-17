import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, ChevronDown, Check, Home, Wrench } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MODULES, type ModuleId, type ModuleAccess } from "@/lib/modules";

const MOD_ICON: Record<ModuleId, any> = { financeiro: Home, facilities: Wrench };

export function ModuleSwitcher({ current, access }: { current: ModuleId; access: ModuleAccess }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const trocar = (id: ModuleId) => {
    setOpen(false);
    if (id !== current) nav(MODULES[id].home);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left text-sidebar-foreground transition-colors hover:bg-sidebar-accent/70">
          <ArrowLeftRight className="h-4 w-4 shrink-0 text-sidebar-foreground/70" />
          <span className="flex-1 truncate text-[12.5px]">
            <span className="text-sidebar-foreground/60">Módulo · </span>
            <span className="font-semibold">{MODULES[current].label}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[224px] p-1.5">
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Alternar módulo
        </div>
        <div className="space-y-0.5">
          {access.modules.map((id) => {
            const Icon = MOD_ICON[id];
            const atual = id === current;
            return (
              <button
                key={id}
                onClick={() => trocar(id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors ${
                  atual ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-muted"
                }`}
              >
                {atual ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="flex-1 truncate text-left">{MODULES[id].label}</span>
                {atual ? (
                  <span className="rounded bg-primary/15 px-1.5 text-[9.5px] font-bold uppercase tracking-wide text-primary">Atual</span>
                ) : (
                  <span className="rounded bg-muted px-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    {id === "financeiro" ? "Admin" : "Ir"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
