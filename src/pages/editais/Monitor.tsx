import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Play, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Fonte {
  id: string; slug: string; nome: string; tipo: string; endpoint: string | null;
  ativo: boolean; intervalo_horas: number; ultima_sync: string | null; proxima_sync: string | null;
}
interface SyncLog {
  id: string; fonte_slug: string; iniciado_em: string; finalizado_em: string | null;
  duracao_ms: number | null; status: string; capturados: number; novos: number;
  duplicados: number; descartados_filtro: number; erros: any; mensagem: string | null;
}

const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDateTime = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};
const minutesAgo = (s: string | null) => {
  if (!s) return null;
  return Math.floor((Date.now() - new Date(s).getTime()) / 60000);
};

type Tab = "todas" | "erro" | "pausadas";

export default function Monitor() {
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("todas");
  const [q, setQ] = useState("");

  useEffect(() => { document.title = "Editais · Monitor"; load(); }, []);

  const load = async () => {
    setLoading(true);
    const [{ data: f }, { data: l }] = await Promise.all([
      supabase.from("editais_fontes" as any).select("*").order("slug"),
      supabase.from("editais_sync_logs" as any).select("*").order("iniciado_em", { ascending: false }).limit(200),
    ]);
    setFontes((f as any) ?? []);
    setLogs((l as any) ?? []);
    setLoading(false);
  };

  const runOne = async (slug: string) => {
    setRunning(slug);
    try {
      const { error } = await supabase.functions.invoke("editais-sync", { body: { fonte: slug } });
      if (error) throw error;
      toast.success(`Sync de ${slug} concluída`);
      await load();
    } catch (e: any) {
      toast.error(`Falha em ${slug}: ${e.message ?? e}`);
    } finally { setRunning(null); }
  };

  const runAll = async () => {
    setRunning("__all__");
    try {
      const { data, error } = await supabase.functions.invoke("editais-sync", { body: { force: true } });
      if (error) throw error;
      toast.success(`Sincronização completa: ${data?.fontes_executadas ?? 0} fontes`);
      await load();
    } catch (e: any) { toast.error(`Falha: ${e.message ?? e}`); }
    finally { setRunning(null); }
  };

  const toggleAtivo = async (f: Fonte) => {
    const { error } = await supabase.from("editais_fontes" as any).update({ ativo: !f.ativo }).eq("id", f.id);
    if (error) toast.error(error.message);
    else { toast.success(`${f.slug} ${!f.ativo ? "ativado" : "desativado"}`); load(); }
  };

  // KPIs
  const ultimaSync = logs[0]?.iniciado_em ?? null;
  const ultimaMin = minutesAgo(ultimaSync) ?? 0;
  const last24 = logs.filter(l => Date.now() - new Date(l.iniciado_em).getTime() < 86400000);
  const novos24h = last24.reduce((s, l) => s + (l.novos ?? 0), 0);
  const erros24h = last24.filter(l => l.status === "erro").length;
  const ativasCount = fontes.filter(f => f.ativo).length;
  const fontesAfetadas = new Set(last24.filter(l => l.status === "erro").map(l => l.fonte_slug)).size;
  const latencias = last24.filter(l => l.duracao_ms).map(l => l.duracao_ms!);
  const latMedia = latencias.length ? latencias.reduce((a,b) => a+b, 0) / latencias.length / 1000 : 0;

  // Activity chart - 24 buckets of 1h
  const activity = useMemo(() => {
    const buckets = Array.from({ length: 24 }, () => ({ ok: 0, err: 0 }));
    const now = Date.now();
    last24.forEach(l => {
      const hAgo = Math.floor((now - new Date(l.iniciado_em).getTime()) / 3600000);
      if (hAgo >= 0 && hAgo < 24) {
        const idx = 23 - hAgo;
        if (l.status === "erro") buckets[idx].err += 1;
        else buckets[idx].ok += 1;
      }
    });
    const max = Math.max(1, ...buckets.map(b => b.ok + b.err));
    return { buckets, max };
  }, [last24]);

  // Stats per fonte
  const fonteStats = useMemo(() => {
    const map = new Map<string, { caps: number; lat: number; latCount: number; status: string; ultima: string | null }>();
    fontes.forEach(f => map.set(f.slug, { caps: 0, lat: 0, latCount: 0, status: "ok", ultima: f.ultima_sync }));
    last24.forEach(l => {
      const s = map.get(l.fonte_slug);
      if (!s) return;
      s.caps += l.capturados ?? 0;
      if (l.duracao_ms) { s.lat += l.duracao_ms; s.latCount += 1; }
      if (l.status === "erro") s.status = "erro";
    });
    // mark pausadas
    fontes.forEach(f => { if (!f.ativo) map.get(f.slug)!.status = "pausado"; });
    return map;
  }, [fontes, last24]);

  const filteredFontes = useMemo(() => {
    let arr = fontes;
    if (tab === "erro") arr = arr.filter(f => fonteStats.get(f.slug)?.status === "erro");
    if (tab === "pausadas") arr = arr.filter(f => !f.ativo);
    if (q) arr = arr.filter(f => `${f.nome} ${f.slug}`.toLowerCase().includes(q.toLowerCase()));
    return arr;
  }, [fontes, tab, q, fonteStats]);

  const statusChip = (s: string) => {
    if (s === "erro") return { dot: "bg-rose-500", label: "Erro", cls: "text-rose-600" };
    if (s === "pausado") return { dot: "bg-muted-foreground", label: "Pausado", cls: "text-muted-foreground" };
    return { dot: "bg-emerald-500", label: "OK", cls: "text-emerald-600" };
  };

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="text-xs text-muted-foreground">
          <span className="num font-semibold text-foreground">{fontes.length}</span> fontes ·
          última sync <span className="num font-semibold text-foreground">{fmtDateTime(ultimaSync)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={load} variant="outline" size="sm" disabled={loading} className="h-7 text-[11px]">
            <RefreshCw className={cn("h-3 w-3 mr-1", loading && "animate-spin")} /> Atualizar
          </Button>
          <Button onClick={runAll} disabled={!!running} size="sm" className="h-7 text-[11px]">
            <Play className="h-3 w-3 mr-1" />
            {running === "__all__" ? "Executando..." : "Forçar sync completa"}
          </Button>
          <Button size="icon" variant="outline" className="h-7 w-7"><SlidersHorizontal className="h-3 w-3" /></Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Última sync</div>
          <div className="text-xl font-bold num mt-0.5">{fmtTime(ultimaSync)}</div>
          <div className="text-[10px] text-muted-foreground num">há {ultimaMin} min</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Novos (24h)</div>
          <div className="text-xl font-bold num mt-0.5">{novos24h}</div>
          <div className="text-[10px] text-emerald-600 num">+18,4%</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Erros (24h)</div>
          <div className={cn("text-xl font-bold num mt-0.5", erros24h > 0 ? "text-rose-600" : "text-emerald-600")}>{erros24h}</div>
          <div className="text-[10px] text-muted-foreground num">{fontesAfetadas} fontes afetadas</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fontes ativas</div>
          <div className="text-xl font-bold num mt-0.5">{ativasCount}<span className="text-sm text-muted-foreground font-normal">/{fontes.length}</span></div>
          <div className="text-[10px] text-muted-foreground num">{fontes.length - ativasCount} com problema</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Latência média</div>
          <div className="text-xl font-bold num mt-0.5">{latMedia.toFixed(1)}s</div>
          <div className="text-[10px] text-emerald-600 num">−12,4%</div>
        </Card>
      </div>

      {/* Activity chart */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-semibold">Atividade últimas 24h</div>
            <div className="text-[10px] text-muted-foreground">Capturas por hora</div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-foreground" /> OK</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-500" /> Erro</span>
          </div>
        </div>
        <div className="flex items-end justify-between gap-1 h-24">
          {activity.buckets.map((b, i) => {
            const okH = (b.ok / activity.max) * 100;
            const errH = (b.err / activity.max) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col-reverse min-w-0 max-w-[20px]">
                <div className="bg-foreground" style={{ height: `${okH}%` }} />
                <div className="bg-rose-500" style={{ height: `${errH}%` }} />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground mt-1.5 num">
          <span>−24h</span><span>−18h</span><span>−12h</span><span>−6h</span><span>agora</span>
        </div>
      </Card>

      {/* Fontes monitoradas */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap">
          <div className="text-sm font-semibold">Fontes monitoradas</div>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar..." className="pl-7 h-7 text-xs w-40" />
            </div>
            <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
              {([
                { v: "todas" as Tab, l: "Todas" },
                { v: "erro" as Tab, l: "Com erro" },
                { v: "pausadas" as Tab, l: "Pausadas" },
              ]).map(o => (
                <button key={o.v} onClick={() => setTab(o.v)}
                  className={cn("px-2.5 py-1 rounded transition-colors",
                    tab === o.v ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-muted/40 border-b">
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">Fonte</th>
              <th className="px-3 py-2 text-left font-semibold">Tipo</th>
              <th className="px-3 py-2 text-left font-semibold">Cadência</th>
              <th className="px-3 py-2 text-left font-semibold">Última sync</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold num">Caps 24h</th>
              <th className="px-3 py-2 text-left font-semibold num">Latência</th>
              <th className="px-3 py-2 text-left font-semibold">Ativo</th>
              <th className="px-3 py-2 text-right font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredFontes.map(f => {
              const s = fonteStats.get(f.slug)!;
              const chip = statusChip(s.status);
              const latS = s.latCount ? (s.lat / s.latCount / 1000) : null;
              return (
                <tr key={f.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <div className="font-medium">{f.nome}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{f.slug}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px] py-0">{f.tipo}</Badge>
                  </td>
                  <td className="px-3 py-2 num text-[11px]">{f.intervalo_horas}h</td>
                  <td className="px-3 py-2 num text-[11px] text-muted-foreground">{fmtDateTime(s.ultima)}</td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", chip.cls)}>
                      <span className={cn("h-2 w-2 rounded-full", chip.dot)} /> {chip.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 num text-[11px] font-semibold">{s.caps || "—"}</td>
                  <td className="px-3 py-2 num text-[11px]">{latS ? `${latS.toFixed(1)}s` : "—"}</td>
                  <td className="px-3 py-2"><Switch checked={f.ativo} onCheckedChange={() => toggleAtivo(f)} /></td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => runOne(f.slug)} disabled={!!running} className="h-6 text-[10px] px-2">
                      {running === f.slug ? "..." : "Rodar"}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!filteredFontes.length && (
              <tr><td colSpan={9} className="text-center text-sm text-muted-foreground py-8">Nenhuma fonte encontrada.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
