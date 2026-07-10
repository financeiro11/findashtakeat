import { useEffect, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KpiCard } from "@/components/ui/kpi-card";

const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlFull = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(1).replace(".", ",")}%`);
const int = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("pt-BR"));

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const mesAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const mesLabel = (ref: string) => { const [y, m] = ref.split("-"); return `${MESES[Number(m) - 1] ?? m} ${y}`; };
function ultimosMeses(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); d.setMonth(d.getMonth() - 1); }
  return out;
}

export default function Asaas() {
  const [ref, setRef] = useState(mesAtual());
  const [dados, setDados] = useState<any>(null);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { document.title = "Asaas · Receita"; }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("asaas_snapshots" as any).select("dados,gerado_em").eq("referencia", ref).maybeSingle();
    setDados((data as any)?.dados ?? null);
    setGeradoEm((data as any)?.gerado_em ?? null);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ref]);

  const sync = async () => {
    setSyncing(true);
    toast.message(`Sincronizando ${mesLabel(ref)} com o Asaas…`);
    try {
      const { data, error } = await supabase.functions.invoke("asaas-sync", { body: { action: "sync", referencia: ref } });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Asaas sincronizado.");
      await load();
    } catch (e: any) {
      toast.error("Falha ao sincronizar com o Asaas: " + e.message);
    } finally { setSyncing(false); }
  };

  const r = dados?.recebimentos, a = dados?.assinaturas, n = dados?.nfe;

  return (
    <div className="space-y-6 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Asaas</h2>
          <p className="text-sm text-muted-foreground">
            Recebimentos, assinaturas (MRR/ARR) e NF-e direto da API do Asaas.
            {geradoEm && <span className="num"> · atualizado em {new Date(geradoEm).toLocaleString("pt-BR")}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {ultimosMeses(12).map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
          </select>
          <button className="ghost-btn h-9" onClick={sync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sincronizar
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card-surface flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : !dados ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          Sem dados para {mesLabel(ref)}. Clique em <b>Sincronizar</b> para puxar do Asaas.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Recebimentos */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground/90">Recebimentos</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label="Recebido no mês" value={brl(r?.recebido_valor)} valueTone="pos" subline={`${int(r?.recebido_qtd)} cobranças · líq. ${brl(r?.recebido_liquido)}`} />
              <KpiCard label="A receber" value={brl(r?.a_receber_valor)} subline="pendentes que vencem no mês" />
              <KpiCard label="Conversão" value={pct(r?.conversao)} subline={`${int(r?.venc_pagos)}/${int(r?.venc_total)} vencidas → pagas`} />
              <KpiCard label="Dias até receber" value={r?.dias_ate_recebimento == null ? "—" : `${Math.round(r.dias_ate_recebimento)}d`} subline="ciclo médio (pagto − venc.)" />
              <KpiCard label="Estornos" value={brl(r?.estornos_valor)} valueTone="neg" subline={`${int(r?.estornos_qtd)} no mês`} />
            </div>
          </section>

          {/* Assinaturas */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground/90">Assinaturas · Recorrência</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="MRR" value={brl(a?.mrr)} valueTone="pos" subline="receita recorrente / mês" />
              <KpiCard label="ARR" value={brl(a?.arr)} subline="projeção anual (MRR × 12)" />
              <KpiCard label="Assinaturas ativas" value={int(a?.ativas)} subline="clientes recorrentes" />
              <KpiCard label="ARPU" value={brlFull(a?.arpu)} subline="ticket médio por assinatura" />
            </div>
          </section>

          {/* NF-e */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground/90">NF-e · Fiscal</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Taxa de sucesso" value={pct(n?.taxa_sucesso)} valueTone={n?.taxa_sucesso != null && n.taxa_sucesso < 0.9 ? "neg" : "pos"} subline="emitidas / (emitidas + erro)" />
              <KpiCard label="Emitidas" value={int(n?.emitidas)} valueTone="pos" subline={`${brl(n?.valor_emitido)} emitido`} />
              <KpiCard label="Com erro" value={int(n?.erro)} valueTone="neg" subline={`${brl(n?.valor_erro)} · corrigir cadastro`} />
              <KpiCard label="Pendentes" value={int(n?.pendentes)} subline="na fila (não é erro)" />
            </div>
          </section>

          <p className="text-[11px] text-muted-foreground">
            MVP · próximas fases: churn / NRR, receita por dia/semana, riscos (múltiplas rejeições) e gráficos de tendência (MRR, churn, receita acumulada).
          </p>
        </div>
      )}
    </div>
  );
}
