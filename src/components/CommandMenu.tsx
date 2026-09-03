import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { useAuth } from "@/hooks/useAuth";
import { moduleAccess, currentModule } from "@/lib/modules";
import { GRUPO_BUSCA_EXTRA, gruposVisiveis, pontuarBusca, termosDeBusca } from "@/lib/navegacao";

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { profile } = useAuth();

  const grupos = useMemo(() => {
    const access = moduleAccess(profile?.cargo);
    const mod = access.facilitiesOnly ? "facilities" : currentModule(pathname);
    const doMenu = gruposVisiveis(access, mod);
    // As telas sem item de menu só fazem sentido para quem enxerga o Hub inteiro.
    return access.parceriasOnly || access.facilitiesOnly ? doMenu : [...doMenu, GRUPO_BUSCA_EXTRA];
  }, [profile?.cargo, pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} filter={pontuarBusca}>
      <CommandInput placeholder="Buscar ou ir para…" />
      <CommandList>
        <CommandEmpty>Nada encontrado.</CommandEmpty>
        {grupos.map((g, i) => (
          <div key={g.label}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={g.label}>
              {g.items.map((it) => (
                <CommandItem
                  key={it.url}
                  value={`${g.label} ${it.title}`}
                  keywords={termosDeBusca(g.label, it)}
                  onSelect={() => { onOpenChange(false); nav(it.url); }}
                >
                  <it.icon className="mr-2 h-4 w-4" />
                  <span>{it.title}</span>
                  <span className="ml-auto text-[10.5px] text-muted-foreground">{it.url}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
