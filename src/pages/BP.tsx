import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { ChevronRight, GitBranch, Loader2, Lock, Sparkles, SlidersHorizontal, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import BalancoDfcTab from "./bp/BalancoDfcTab";
import EquipeTab from "./bp/EquipeTab";
import OperacaoTab from "./bp/OperacaoTab";
import PLTab from "./bp/PLTab";
import PremissasTab from "./bp/PremissasTab";
import ResumoTab from "./bp/ResumoTab";
import { parsearEquipe, recortar, type Celula } from "./bp/equipe";
import { VERSAO_VIGENTE } from "./bp/plano2026";
import { useBpPlano } from "./bp/useBpPlano";

const ABAS = [
  { id: "resumo", rotulo: "Resumo", contexto: "Visão geral do plano" },
  { id: "pl", rotulo: "P&L", contexto: "DRE projetada · realizado vs orçado" },
  { id: "operacao", rotulo: "Operação", contexto: "Funil, CAC por canal e base de clientes" },
  { id: "equipe", rotulo: "Equipe", contexto: "Headcount, custo por time e plano de contratações" },
  { id: "premissas", rotulo: "Premissas", contexto: "Indexadores, gatilhos de custo e tributos" },
  { id: "balanco", rotulo: "Balanço & DFC", contexto: "Posição patrimonial e fluxo de caixa projetados" },
] as const;

type AbaId = (typeof ABAS)[number]["id"];

const TITULOS: Record<AbaId, string> = {
  resumo: "Resumo",
  pl: "P&L do Plano",
  operacao: "Operação",
  equipe: "Equipe",
  premissas: "Premissas",
  balanco: "Balanço & DFC",
};

const SUBTITULOS: Record<AbaId, string> = {
  resumo: "Plano financeiro consolidado — receita, margem, caixa e headcount. Base das análises preditivas e do tracker de orçamento.",
  pl: "DRE completa do plano, mês a mês. Conforme cada mês fecha, a coluna passa a puxar o realizado das Demonstrações.",
  operacao: "Como o plano gera receita: leads, conversão, CAC por canal, base por porte de cliente e churn.",
  equipe: "O maior bloco de custo do BP — headcount, custo por time e o calendário de contratações.",
  premissas: "Toda linha de custo do BP é dirigida por um indexador. Aqui ficam as regras que o modelo aplica.",
  balanco: "Balanço patrimonial e fluxo de caixa projetados, direto da aba Consolidado.",
};

export default function BP() {
  const { ano: anoParam } = useParams();
  const ano = Number(anoParam) || new Date().getFullYear();
  const [aba, setAba] = useState<AbaId>("resumo");
  const [modo, setModo] = useState<"oficial" | "simulacao">("oficial");
  const [importando, setImportando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const plano = useBpPlano(ano);

  useEffect(() => {
    document.title = `BP ${ano} · ${TITULOS[aba]}`;
    const meta = ABAS.find((a) => a.id === aba)!;
    window.dispatchEvent(
      new CustomEvent("header:breadcrumb", {
        detail: { crumbs: ["BP", TITULOS[aba]], context: `${meta.contexto} ${ano}` },
      }),
    );
  }, [ano, aba]);

  const importar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setImportando(true);
    try {
      const buffer = await arquivo.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
        defval: "",
      });
      if (!json.length) throw new Error("A primeira aba da planilha está vazia");
      // `dados` é a Consolidado no formato antigo (uma linha por objeto); `abas`
      // guarda a planilha inteira como matriz crua — é de lá que sai o quadro de
      // cargos da aba Equipe.
      const abas = Object.fromEntries(
        wb.SheetNames.map((nome) => [
          nome,
          recortar(XLSX.utils.sheet_to_json<Celula[]>(wb.Sheets[nome], { header: 1, defval: null })),
        ]),
      );
      const { error } = await supabase
        .from("bp_anual" as any)
        .upsert({ ano, dados: json, abas } as any, { onConflict: "ano" });
      if (error) throw error;
      const equipe = parsearEquipe(abas["Equipe"]);
      toast.success(
        `${json.length} linha(s) importada(s) no BP ${ano}` +
          (equipe ? ` · ${equipe.quadro.length} cargos da aba Equipe` : ""),
      );
      await plano.recarregar();
    } catch (err: any) {
      toast.error("Falha na importação: " + err.message);
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  };

  const conteudo = useMemo(() => {
    if (plano.carregando) {
      return <div className="py-20 text-center text-sm text-muted-foreground">Carregando o plano…</div>;
    }
    if (!plano.existe) {
      return (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum BP importado para {ano}.
          </p>
          <Button
            size="sm"
            className="mt-3 h-8 text-[12px]"
            onClick={() => arquivoRef.current?.click()}
            disabled={importando}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Importar planilha
          </Button>
        </div>
      );
    }
    switch (aba) {
      case "resumo": return <ResumoTab plano={plano} ano={ano} />;
      case "pl": return <PLTab plano={plano} ano={ano} />;
      case "operacao": return <OperacaoTab ano={ano} />;
      case "equipe": return <EquipeTab plano={plano} ano={ano} />;
      case "premissas": return <PremissasTab ano={ano} />;
      case "balanco": return <BalancoDfcTab plano={plano} ano={ano} />;
    }
  }, [aba, plano, ano, importando]);

  return (
    <div className="min-h-full bg-background">
      <div className="px-6 pt-5 pb-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center gap-2">
            {TITULOS[aba]}
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-primary">{ano}</span>
          </h1>
          <p className="mt-1 max-w-3xl text-[12.5px] text-muted-foreground">{SUBTITULOS[aba]}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Oficial vs Simulação: hoje só alterna a leitura da tela — a persistência
              de cenários entra junto com o versionamento no banco. */}
          <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5">
            <button
              onClick={() => setModo("oficial")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 h-7 text-[12px] font-medium transition-colors",
                modo === "oficial"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Lock className="h-3.5 w-3.5" /> Oficial
            </button>
            <button
              onClick={() => setModo("simulacao")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 h-7 text-[12px] font-medium transition-colors",
                modo === "simulacao"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Simulação
            </button>
          </div>

          <span
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 h-8 text-[11.5px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
            title={VERSAO_VIGENTE.descricao}
          >
            <GitBranch className="h-3.5 w-3.5" />
            {VERSAO_VIGENTE.rotulo} · vigente
          </span>

          <Button
            size="sm"
            onClick={() => arquivoRef.current?.click()}
            disabled={importando}
            className="h-8 text-[12px] bg-foreground text-background hover:bg-foreground/90"
          >
            {importando ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            Importar planilha
          </Button>
          <input ref={arquivoRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={importar} />
        </div>
      </div>

      {modo === "simulacao" && (
        <div className="mx-6 mb-3 flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
          <p className="text-[11.5px] leading-relaxed text-amber-800 dark:text-amber-300">
            Modo simulação ainda não altera premissas — os números seguem os do plano oficial. Os
            controles de cenário entram junto com o versionamento no banco.
          </p>
        </div>
      )}

      <div className="px-6 border-b border-border">
        <div className="flex items-center gap-1 overflow-x-auto">
          {ABAS.map((t) => (
            <button
              key={t.id}
              onClick={() => setAba(t.id)}
              className={cn(
                "h-9 px-3 text-[12.5px] font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                aba === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-4 pb-10">{conteudo}</div>
    </div>
  );
}
