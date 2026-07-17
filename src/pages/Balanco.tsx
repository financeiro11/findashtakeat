import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Sparkles } from "lucide-react";
import { BalanceteHeader } from "./balancete/BalanceteHeader";
import { BalanceteKpis } from "./balancete/BalanceteKpis";
import { BalanceteTable } from "./balancete/BalanceteTable";
import { BalanceteCharts } from "./balancete/BalanceteCharts";
import { PdfOriginalDialog } from "./balancete/PdfOriginalDialog";
import type { BalanceteData } from "./balancete/types";
import { isV2, previousPeriodoTrimestre, sortKeyTrimestre } from "./balancete/utils";
import { aguardarExtracao } from "@/lib/parseDemonstracao";
import { buscarPeriodoMaisRecenteComDados } from "@/lib/ultimoPeriodoSalvo";

type Status = "idle" | "processing" | "ready" | "error" | "empty";

function periodoTriAtual(d: Date) {
  return `${Math.floor(d.getMonth() / 3) + 1}T${String(d.getFullYear()).slice(-2)}`;
}

export default function Balanco() {
  const today = new Date();
  const [periodo, setPeriodo] = useState<string>(periodoTriAtual(today));
  const [data, setData] = useState<BalanceteData | null>(null);
  const [prevData, setPrevData] = useState<BalanceteData | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<{ periodo: string; ativo: number; passivo: number; pl: number }[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    document.title = "FinHub · Balanço";
  }, []);

  // Ao abrir a tela, mostra direto o ÚLTIMO arquivo salvo (mais recentemente importado
  // com dados de verdade) em vez do trimestre atual — que normalmente ainda está vazio.
  useEffect(() => {
    (async () => {
      const ultimo = await buscarPeriodoMaisRecenteComDados("balanco");
      if (ultimo) setPeriodo(ultimo);
      setInitialized(true);
    })();
  }, []);

  const loadHistory = useCallback(async () => {
    const { data: rows } = await supabase
      .from("demonstracoes_contabeis")
      .select("periodo, dados")
      .eq("tipo", "balanco");
    const hist = (rows || [])
      .map((r: any) => {
        if (!isV2(r.dados)) return null;
        const t = (r.dados as BalanceteData).totals;
        return {
          periodo: r.periodo as string,
          ativo: t.ativo_total || 0,
          passivo: t.passivo_total || 0,
          pl: t.patrimonio_liquido || 0,
        };
      })
      .filter(Boolean) as { periodo: string; ativo: number; passivo: number; pl: number }[];
    // "qTyy" não é ordenável como string (1T26 vem antes de 4T25 alfabeticamente, mas
    // depois cronologicamente) — ordena pela chave numérica e pega os 6 mais recentes.
    hist.sort((a, b) => sortKeyTrimestre(a.periodo) - sortKeyTrimestre(b.periodo));
    setHistory(hist.slice(-6));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data: row, error } = await supabase
        .from("demonstracoes_contabeis")
        .select("dados, pdf_path")
        .eq("tipo", "balanco")
        .eq("periodo", periodo)
        .maybeSingle();
      if (error && (error as any).code !== "PGRST116") throw error;

      const dados = (row as any)?.dados;
      const path = (row as any)?.pdf_path ?? null;
      setPdfPath(path);

      if (path) {
        const { data: signed } = await supabase.storage.from("demonstracoes-pdf").createSignedUrl(path, 3600);
        setPdfUrl(signed?.signedUrl ?? null);
      } else {
        setPdfUrl(null);
      }

      if (isV2(dados)) {
        setData(dados as BalanceteData);
        setStatus("ready");
      } else {
        setData(null);
        setStatus("empty");
      }

      // trimestre anterior
      const prev = previousPeriodoTrimestre(periodo);
      const { data: prevRow } = await supabase
        .from("demonstracoes_contabeis")
        .select("dados")
        .eq("tipo", "balanco")
        .eq("periodo", prev)
        .maybeSingle();
      const prevDados = (prevRow as any)?.dados;
      setPrevData(isV2(prevDados) ? (prevDados as BalanceteData) : null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao carregar");
      setStatus("error");
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
    loadHistory();
  }, [periodo, loadHistory]);

  useEffect(() => {
    if (!initialized) return; // aguarda resolver o período do último arquivo salvo
    load();
  }, [load, initialized]);

  const reprocess = useCallback(
    async (path?: string) => {
      const usePath = path || pdfPath;
      if (!usePath) {
        toast.error("Importe um PDF primeiro");
        return;
      }
      setStatus("processing");
      setErrorMsg(null);
      try {
        const { data: res, error } = await supabase.functions.invoke("parse-balancete-pdf", {
          body: { periodo, pdf_path: usePath, tipo: "balanco" },
        });
        if (error) throw new Error(error.message);
        if ((res as any)?.error) throw new Error((res as any).error);
        // Processamento é assíncrono no servidor — aguarda o resultado.
        toast.message("Lendo o PDF com IA… isso pode levar até 2 minutos para documentos escaneados.");
        const r = await aguardarExtracao("balanco", periodo);
        if (!r.ok) throw new Error(r.error);
        toast.success(`Balanço processado (${r.contas} contas)`);
        await load();
      } catch (err: any) {
        setStatus("error");
        setErrorMsg(err.message);
        toast.error("Falha no processamento: " + err.message);
      }
    },
    [pdfPath, periodo, load],
  );

  const importPdf = useCallback(
    async (file: File) => {
      try {
        const path = `balanco/${periodo}-${Date.now()}.pdf`;
        const { error: upErr } = await supabase.storage
          .from("demonstracoes-pdf")
          .upload(path, file, { contentType: "application/pdf", upsert: true });
        if (upErr) throw upErr;

        if (pdfPath && pdfPath !== path) {
          await supabase.storage.from("demonstracoes-pdf").remove([pdfPath]);
        }

        // grava o pdf_path antes de processar
        const { error } = await supabase.from("demonstracoes_contabeis").upsert(
          {
            tipo: "balanco",
            periodo,
            pdf_path: path,
            dados: (data as any) ?? { version: 2, kind: "balanco", accounts: [], totals: {}, source: "pdf", imported_at: new Date().toISOString() },
          } as any,
          { onConflict: "tipo,periodo" },
        );
        if (error) throw error;
        setPdfPath(path);
        toast.success("PDF enviado, processando com IA...");
        await reprocess(path);
      } catch (err: any) {
        toast.error("Falha no upload: " + err.message);
      }
    },
    [periodo, pdfPath, data, reprocess],
  );

  const clear = useCallback(async () => {
    if (!confirm(`Excluir balanço de ${periodo}?`)) return;
    try {
      if (pdfPath) await supabase.storage.from("demonstracoes-pdf").remove([pdfPath]);
      const { error } = await supabase
        .from("demonstracoes_contabeis")
        .delete()
        .eq("tipo", "balanco")
        .eq("periodo", periodo);
      if (error) throw error;
      toast.success("Excluído");
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [pdfPath, periodo, load]);

  const totals = data?.totals ?? null;
  const accounts = data?.accounts ?? [];
  const prevAccounts = prevData?.accounts ?? [];

  const hasContent = accounts.length > 0;

  return (
    <div className="space-y-4 p-5">
      <BalanceteHeader
        periodo={periodo}
        onPeriodoChange={setPeriodo}
        importedAt={data?.imported_at ?? null}
        status={status}
        errorMsg={errorMsg}
        hasPdf={!!pdfPath}
        onImportPdf={importPdf}
        onReprocess={() => reprocess()}
        onViewPdf={() => setPdfOpen(true)}
        onClear={clear}
        modo="trimestre"
        eyebrow="Hub Financeiro · Balanço"
      />

      {loading ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[124px] rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-[500px] rounded-lg" />
        </>
      ) : !hasContent ? (
        <EmptyState hasPdf={!!pdfPath} processing={status === "processing"} />
      ) : (
        <>
          <BalanceteKpis totals={totals} prevTotals={prevData?.totals ?? null} loading={false} deltaLabel="vs trim. ant." />
          <BalanceteTable accounts={accounts} prevAccounts={prevAccounts} prevColLabel="Trim. ant." />
          <BalanceteCharts accounts={accounts} history={history} histLabel="últimos trimestres" />
        </>
      )}

      <PdfOriginalDialog open={pdfOpen} onOpenChange={setPdfOpen} url={pdfUrl} />
    </div>
  );
}

function EmptyState({ hasPdf, processing }: { hasPdf: boolean; processing: boolean }) {
  return (
    <div className="card-surface p-12 flex flex-col items-center justify-center gap-3 text-center">
      <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary">
        {processing ? <Sparkles className="h-6 w-6 animate-pulse" /> : <FileText className="h-6 w-6" />}
      </div>
      <div className="text-lg font-semibold text-foreground">
        {processing
          ? "Processando o balanço com IA..."
          : hasPdf
          ? "PDF anexado, mas ainda não processado"
          : "Nenhum balanço importado neste trimestre"}
      </div>
      <div className="text-sm text-muted-foreground max-w-md">
        {processing
          ? "A IA está lendo o PDF e estruturando as contas. Isso leva alguns segundos."
          : "Envie o PDF do balanço patrimonial enviado pela contabilidade. O sistema lê automaticamente e converte em uma análise financeira interativa."}
      </div>
    </div>
  );
}
