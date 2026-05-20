import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  Wallet, CreditCard, Users, Handshake, Smartphone, Plane, Percent, BookOpen, FolderKanban,
  FileBarChart, FileText, Scale, TrendingUp, Brain, Target, Home, ListTree, UserCog,
} from "lucide-react";

const ITEMS: { group: string; items: { title: string; url: string; icon: any }[] }[] = [
  { group: "Início", items: [{ title: "Dashboard", url: "/", icon: Home }] },
  { group: "Operacional", items: [
    { title: "Conta Corrente", url: "/planilhamento/conta-corrente", icon: Wallet },
    { title: "Cartão de Crédito", url: "/planilhamento/cartao-credito", icon: CreditCard },
    { title: "Comissões — Time", url: "/planilhamento/comissoes-time", icon: Users },
    { title: "Comissões — Parceiros", url: "/planilhamento/comissoes-parceiros", icon: Handshake },
  ]},
  { group: "Recargas", items: [
    { title: "Celulares", url: "/recargas/celulares", icon: Smartphone },
    { title: "Viagens", url: "/recargas/viagens", icon: Plane },
  ]},
  { group: "Automações", items: [
    { title: "Proporcionais", url: "/automacoes/proporcionais", icon: Percent },
    { title: "Catálogo", url: "/automacoes/catalogo", icon: BookOpen },
    { title: "Projetos", url: "/automacoes/projetos", icon: FolderKanban },
  ]},
  { group: "Demonstrações", items: [
    { title: "DRE", url: "/demonstracoes/dre", icon: FileBarChart },
    { title: "DFC", url: "/demonstracoes/dfc", icon: TrendingUp },
    { title: "Balancete", url: "/demonstracoes/balancete", icon: FileText },
    { title: "Balanço", url: "/demonstracoes/balanco", icon: Scale },
  ]},
  { group: "Análise Preditiva", items: [
    { title: "Cenários", url: "/analise/cenarios", icon: Target },
    { title: "BP Anual", url: "/analise/bp", icon: FileBarChart },
    { title: "Biblioteca", url: "/analise/conhecimento", icon: Brain },
  ]},
  { group: "Configurações", items: [
    { title: "DE_PARA", url: "/de-para", icon: ListTree },
    { title: "Usuários", url: "/usuarios", icon: UserCog },
  ]},
];

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();

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
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar ou ir para…" />
      <CommandList>
        <CommandEmpty>Nada encontrado.</CommandEmpty>
        {ITEMS.map((g, i) => (
          <div key={g.group}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={g.group}>
              {g.items.map((it) => (
                <CommandItem
                  key={it.url}
                  value={`${g.group} ${it.title}`}
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
