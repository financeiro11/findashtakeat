// Aba Perfil — quem está logado, tema e sair.

import { useState } from "react";
import { LogOut, Sun, Moon, Smartphone, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { aplicarTema, lerTema, salvarTema, type Tema } from "@/lib/tema";

const OPCOES: { id: Tema; rotulo: string; icone: typeof Sun }[] = [
  { id: "claro", rotulo: "Claro", icone: Sun },
  { id: "escuro", rotulo: "Escuro", icone: Moon },
  { id: "sistema", rotulo: "Do aparelho", icone: Smartphone },
];

export default function MobilePerfil() {
  const { profile, user, signOut } = useAuth();
  const [tema, setTema] = useState<Tema>(() => lerTema());

  const escolher = (t: Tema) => {
    setTema(t);
    salvarTema(t);
    aplicarTema(t);
  };

  const iniciais = (profile?.nome ?? user?.email ?? "?")
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="space-y-6 px-4 py-5 pb-10">
      <section className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-[17px] font-bold text-primary-foreground">
          {iniciais}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold">{profile?.nome ?? "—"}</div>
          <div className="truncate text-[12.5px] text-muted-foreground">{profile?.cargo || "Sem cargo"}</div>
          <div className="truncate text-[12px] text-muted-foreground">{profile?.email ?? user?.email}</div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tema</h2>
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {OPCOES.map((o) => (
            <li key={o.id} className="border-b border-border last:border-0">
              <button
                onClick={() => escolher(o.id)}
                className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left active:bg-secondary"
              >
                <o.icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-[14px]">{o.rotulo}</span>
                {tema === o.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
          A escolha vale só neste aparelho.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sessão</h2>
        <Button variant="outline" onClick={signOut} className="h-12 w-full justify-start gap-3 text-[14px]">
          <LogOut className="h-4 w-4" /> Sair da conta
        </Button>
      </section>

      <p className="pt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
        Hub Financeiro Takeat · app do celular
        <br />
        As telas de demonstrações, auditorias e orçamento ficam no computador.
      </p>
    </div>
  );
}
