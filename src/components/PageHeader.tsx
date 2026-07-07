import { Calendar as CalIcon, GitCompare, SlidersHorizontal, Download, RefreshCw, ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const ROUTE_MAP: Record<string, { crumbs: string[]; context?: string }> = {
  "/": { crumbs: ["Início", "Dashboard"], context: "Visão consolidada · DRE + DFC" },
  "/design-system": { crumbs: ["Início", "Design System"] },
  "/de-para": { crumbs: ["Configurações", "DE_PARA"], context: "Mapeamento de classificações" },
  "/usuarios": { crumbs: ["Configurações", "Usuários"] },
  "/configuracoes/uso-ia": { crumbs: ["Configurações", "Uso IA"], context: "Custo estimado das chamadas à IA" },
  "/automacoes/proporcionais": { crumbs: ["Automações", "Proporcionais"] },
  "/automacoes/catalogo": { crumbs: ["Automações", "Catálogo"] },
  "/automacoes/projetos": { crumbs: ["Automações", "Projetos"] },
  "/recargas/celulares": { crumbs: ["Recargas", "Celulares"] },
  "/recargas/viagens": { crumbs: ["Recargas", "Viagens"] },
  "/tarefas": { crumbs: ["Início", "Tarefas"], context: "Gestão de tarefas do time" },
  "/editais": { crumbs: ["Radar de Editais", "Dashboard"], context: "Radar inteligente de editais" },
  "/editais/radar": { crumbs: ["Radar de Editais", "Radar"] },
  "/editais/triagem": { crumbs: ["Radar de Editais", "Triagem"] },
  "/editais/pipeline": { crumbs: ["Radar de Editais", "Pipeline"] },
  "/editais/calendario": { crumbs: ["Radar de Editais", "Calendário"] },
  "/editais/historico": { crumbs: ["Radar de Editais", "Histórico"] },
  "/editais/monitor": { crumbs: ["Radar de Editais", "Monitor"] },
  "/editais/configuracoes": { crumbs: ["Radar de Editais", "Configurações"] },
  "/editais/projetos-aprovados": { crumbs: ["Radar de Editais", "Projetos Aprovados"], context: "Executivo" },
  "/editais/projetos-aprovados/projetos": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Projetos"] },
  "/editais/projetos-aprovados/ia": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Inteligência IA"] },
  "/editais/projetos-aprovados/alertas": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Alertas"] },
  "/editais/projetos-aprovados/prestacao": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Prestação"] },
  "/editais/projetos-aprovados/config": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Configurações"] },
  "/demonstracoes/dre": { crumbs: ["Demonstrações", "DRE"], context: "Demonstrativo de Resultado" },
  "/demonstracoes/dfc": { crumbs: ["Demonstrações", "DFC"], context: "Fluxo de Caixa" },
  "/demonstracoes/balancete": { crumbs: ["Demonstrações", "Balancete"] },
  "/demonstracoes/balanco": { crumbs: ["Demonstrações", "Balanço"] },
  "/analise/cenarios": { crumbs: ["Análise Preditiva", "Cenários"] },
  "/analise/bp": { crumbs: ["Análise Preditiva", "BP Anual"] },
  "/analise/historico": { crumbs: ["Análise Preditiva", "Histórico Multianual"] },
  "/analise/conhecimento": { crumbs: ["Análise Preditiva", "Biblioteca"] },
  "/planilhamento/conta-corrente": { crumbs: ["Operacional", "Conta Corrente"] },
  "/planilhamento/cartao-credito": { crumbs: ["Operacional", "Cartão de Crédito"] },
  "/planilhamento/comissoes-time": { crumbs: ["Operacional", "Comissões — Time"] },
  "/planilhamento/comissoes-parceiros": { crumbs: ["Operacional", "Comissões — Parceiros"] },
};

interface PageHeaderProps {
  breadcrumbs?: string[];
  context?: string;
  hideToolbar?: boolean;
}

const MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function fmtMonth(d: Date) {
  return `${MONTHS_PT[d.getMonth()]} ${d.getFullYear()}`;
}

const PERIOD_KEY = "header:period";
const COMPARE_KEY = "header:compare";

export function PageHeader({ breadcrumbs, context, hideToolbar }: PageHeaderProps) {
  const { pathname } = useLocation();
  const fallback = ROUTE_MAP[pathname] ?? { crumbs: [pathname] };
  const crumbs = breadcrumbs ?? fallback.crumbs;
  const ctx = context ?? fallback.context;

  const [period, setPeriod] = useState<Date>(() => {
    const raw = localStorage.getItem(PERIOD_KEY);
    return raw ? new Date(raw) : new Date();
  });
  const [compare, setCompare] = useState<Date>(() => {
    const raw = localStorage.getItem(COMPARE_KEY);
    if (raw) return new Date(raw);
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });

  useEffect(() => {
    localStorage.setItem(PERIOD_KEY, period.toISOString());
    window.dispatchEvent(new CustomEvent("header:period-change", { detail: { period } }));
  }, [period]);
  useEffect(() => {
    localStorage.setItem(COMPARE_KEY, compare.toISOString());
    window.dispatchEvent(new CustomEvent("header:compare-change", { detail: { compare } }));
  }, [compare]);

  const handleDownload = () => {
    toast.success("Abrindo diálogo de impressão para salvar como PDF…");
    setTimeout(() => window.print(), 200);
  };
  const handleRefresh = () => {
    toast.message("Recarregando dados…");
    window.location.reload();
  };
  const handleAssistant = () => {
    // Abre o assistente IA com contexto do período atual da toolbar.
    window.dispatchEvent(new CustomEvent("ai:open", {
      detail: { prompt: `Considerando o período ${fmtMonth(period)} (comparando com ${fmtMonth(compare)}), `},
    }));
  };

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5">
      <nav className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
        {crumbs.map((b, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className={i === crumbs.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"}>
              {b}
            </span>
            {i < crumbs.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
          </span>
        ))}
        {ctx && <span className="ml-2 truncate text-[12px] text-muted-foreground">· {ctx}</span>}
      </nav>

      {!hideToolbar && pathname !== "/operacional/parceiros" && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <button className="ghost-btn"><CalIcon className="h-3.5 w-3.5" /> {fmtMonth(period)}</button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={period} onSelect={(d) => d && setPeriod(d)} className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <button className="ghost-btn"><GitCompare className="h-3.5 w-3.5" /> vs {fmtMonth(compare)}</button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={compare} onSelect={(d) => d && setCompare(d)} className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>

          <button onClick={handleAssistant} className="ghost-btn px-2" title="Assistente IA"><SlidersHorizontal className="h-3.5 w-3.5" /></button>
          <button onClick={handleDownload} className="ghost-btn px-2" title="Exportar (PDF)"><Download className="h-3.5 w-3.5" /></button>
          <button onClick={handleRefresh} className="ghost-btn px-2" title="Atualizar"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  );
}
