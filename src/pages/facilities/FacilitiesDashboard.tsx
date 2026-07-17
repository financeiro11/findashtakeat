import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { FacToolbar } from "./NovaSolicitacaoDialog";
import { CatDot } from "./components";
import {
  db, fmtBRL, fmtK, catColor, MESES_PT, LIMITE_APROVACAO,
  type Solicitacao, type Compra, type Cotacao,
} from "./lib";

function diasAtras(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d <= 0) return "hoje";
  if (d === 1) return "há 1 dia";
  return `há ${d} dias`;
}

export default function FacilitiesDashboard() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, c, q] = await Promise.all([
      db.from("facilities_solicitacoes").select("*").order("created_at", { ascending: false }),
      db.from("facilities_compras").select("*").order("data", { ascending: false }),
      db.from("facilities_cotacoes").select("*"),
    ]);
    setSolicitacoes((s.data as Solicitacao[]) ?? []);
    setCompras((c.data as Compra[]) ?? []);
    setCotacoes((q.data as Cotacao[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const now = new Date();
  const mesAtual = now.getMonth();
  const anoAtual = now.getFullYear();
  const nomeMes = MESES_PT[mesAtual];

  const comprasMes = useMemo(
    () => compras.filter((c) => {
      const d = new Date(c.data + "T00:00:00");
      return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    }),
    [compras, mesAtual, anoAtual],
  );

  const gastoMes = comprasMes.reduce((s, c) => s + Number(c.valor || 0), 0);

  const pendentes = useMemo(
    () => solicitacoes.filter((s) => s.status === "aguardando_aprovacao"),
    [solicitacoes],
  );
  const valorPendente = pendentes.reduce((s, p) => s + Number(p.valor || 0), 0);

  const cotacoesPorSolic = useMemo(() => {
    const m = new Map<string, Cotacao[]>();
    for (const q of cotacoes) {
      const arr = m.get(q.solicitacao_id) ?? [];
      arr.push(q);
      m.set(q.solicitacao_id, arr);
    }
    return m;
  }, [cotacoes]);

  // Economia = soma de (2ª menor − menor) nas solicitações com >= 2 cotações.
  const economia = useMemo(() => {
    let total = 0;
    for (const arr of cotacoesPorSolic.values()) {
      if (arr.length < 2) continue;
      const vals = arr.map((q) => Number(q.valor)).sort((a, b) => a - b);
      total += vals[1] - vals[0];
    }
    return total;
  }, [cotacoesPorSolic]);

  // Gasto por categoria (mês)
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comprasMes) {
      const k = c.categoria || "Sem categoria";
      m.set(k, (m.get(k) ?? 0) + Number(c.valor || 0));
    }
    return [...m.entries()].map(([cat, val]) => ({ cat, val })).sort((a, b) => b.val - a.val);
  }, [comprasMes]);
  const maxCategoria = Math.max(1, ...porCategoria.map((x) => x.val));

  // Gasto mensal — últimos 6 meses
  const mensal = useMemo(() => {
    const out: { label: string; val: number; atual: boolean }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(anoAtual, mesAtual - i, 1);
      const val = compras
        .filter((c) => {
          const cd = new Date(c.data + "T00:00:00");
          return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
        })
        .reduce((s, c) => s + Number(c.valor || 0), 0);
      out.push({ label: MESES_PT[d.getMonth()], val, atual: i === 0 });
    }
    return out;
  }, [compras, mesAtual, anoAtual]);
  const maxMensal = Math.max(1, ...mensal.map((x) => x.val));

  const atividade = useMemo(() => {
    const evs: { quando: string; texto: string }[] = [];
    for (const s of solicitacoes.slice(0, 6)) {
      evs.push({ quando: s.created_at, texto: `Solicitação criada — "${s.titulo}"` });
    }
    for (const c of compras.slice(0, 6)) {
      evs.push({ quando: c.created_at, texto: `Compra registrada — "${c.item}"${c.fornecedor_nome ? ` (${c.fornecedor_nome})` : ""}` });
    }
    return evs.sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, 8);
  }, [solicitacoes, compras]);

  const decidir = async (id: string, aprovar: boolean) => {
    const { error } = await db.from("facilities_solicitacoes").update({
      status: aprovar ? "aprovado" : "recusado",
      decidido_por: profile?.nome ?? null,
      decidido_em: new Date().toISOString(),
    }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(aprovar ? "Aprovado" : "Recusado");
    load();
  };

  const compradasMes = comprasMes.length;
  const aguardandoEntrega = solicitacoes.filter((s) => s.status === "aprovado").length;

  return (
    <div className="space-y-4 p-5">
      <FacToolbar context={`Visão consolidada · compras e fornecedores · ${nomeMes} ${anoAtual}`} onChanged={load} />

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={`Gasto do mês · ${nomeMes}`}
          value={fmtBRL(gastoMes)}
          hint="compras avulsas + contratos recorrentes"
          loading={loading}
        />
        <Kpi
          label="Pendentes de aprovação"
          value={String(pendentes.length)}
          hint={valorPendente > 0 ? `${fmtBRL(valorPendente)} aguardando seu OK` : "nada aguardando aprovação"}
          accent="amber"
          loading={loading}
        />
        <Kpi
          label="Economia em cotações"
          value={fmtBRL(economia)}
          hint="diferença para a 2ª melhor proposta"
          accent="emerald"
          loading={loading}
        />
        <Kpi
          label="Compras no mês"
          value={String(compradasMes)}
          hint={aguardandoEntrega > 0 ? `${aguardandoEntrega} aprovada(s) aguardando` : "—"}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Fila de aprovações */}
        <div className="card-surface p-5">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">Fila de aprovações</h3>
              <p className="text-[12px] text-muted-foreground">Compras acima de {fmtBRL(LIMITE_APROVACAO)} exigem aprovação do admin</p>
            </div>
            {pendentes.length > 0 && (
              <span className="rounded-md bg-amber-50 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700">
                {pendentes.length} pendentes
              </span>
            )}
          </div>
          {loading ? (
            <Skeleton className="h-40 rounded" />
          ) : pendentes.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-muted-foreground">Nenhuma aprovação pendente.</div>
          ) : (
            <div className="space-y-2">
              {pendentes.map((p) => {
                const nCot = cotacoesPorSolic.get(p.id)?.length ?? 0;
                return (
                  <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5">
                    <CatDot cat={p.categoria} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-foreground">{p.titulo}</div>
                      <div className="truncate text-[11.5px] text-muted-foreground">
                        {p.categoria ?? "—"} · {nCot} cotaç{nCot === 1 ? "ão" : "ões"} · solicitado {diasAtras(p.created_at)}
                      </div>
                    </div>
                    <div className="num shrink-0 text-[13px] font-semibold text-foreground">{fmtBRL(p.valor)}</div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" className="h-7 gap-1 bg-emerald-600 px-2 text-white hover:bg-emerald-700" onClick={() => decidir(p.id, true)}>
                        <Check className="h-3.5 w-3.5" /> Aprovar
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-muted-foreground" onClick={() => decidir(p.id, false)}>
                        <X className="h-3.5 w-3.5" /> Recusar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Gasto por categoria */}
        <div className="card-surface p-5">
          <h3 className="mb-3 text-[15px] font-semibold text-foreground">Gasto por categoria — {nomeMes}</h3>
          {loading ? (
            <Skeleton className="h-40 rounded" />
          ) : porCategoria.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-muted-foreground">Sem compras neste mês.</div>
          ) : (
            <div className="space-y-2.5">
              {porCategoria.map(({ cat, val }) => (
                <div key={cat} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 truncate text-[12.5px] text-foreground">{cat}</div>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${(val / maxCategoria) * 100}%`, background: catColor(cat) }} />
                  </div>
                  <div className="num w-20 shrink-0 text-right text-[12.5px] font-medium text-foreground">{fmtBRL(val)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Atividade recente */}
        <div className="card-surface p-5">
          <h3 className="mb-3 text-[15px] font-semibold text-foreground">Atividade recente</h3>
          {loading ? (
            <Skeleton className="h-32 rounded" />
          ) : atividade.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-muted-foreground">Nada por aqui ainda.</div>
          ) : (
            <div className="space-y-2.5">
              {atividade.map((e, i) => (
                <div key={i} className="flex items-start gap-3 text-[12.5px]">
                  <span className="num shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                    {new Date(e.quando).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </span>
                  <span className="text-foreground/90">{e.texto}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Gasto mensal */}
        <div className="card-surface p-5">
          <h3 className="mb-4 text-[15px] font-semibold text-foreground">Gasto mensal — últimos 6 meses</h3>
          {loading ? (
            <Skeleton className="h-40 rounded" />
          ) : (
            <div className="flex h-44 items-end justify-between gap-3 px-1">
              {mensal.map((m, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="num text-[11px] text-muted-foreground">{m.val > 0 ? fmtK(m.val) : ""}</span>
                  <div
                    className={`w-full rounded-t ${m.atual ? "bg-primary" : "bg-muted-foreground/20"}`}
                    style={{ height: `${Math.max(4, (m.val / maxMensal) * 130)}px` }}
                  />
                  <span className="text-[11px] text-muted-foreground">{m.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, accent, loading }: {
  label: string; value: string; hint: string; accent?: "amber" | "emerald"; loading: boolean;
}) {
  const valColor = accent === "amber" ? "text-amber-600" : accent === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <div className={`num mt-1 text-[28px] font-bold leading-tight ${valColor}`}>{value}</div>
      )}
      <div className="mt-1 text-[11.5px] text-muted-foreground">{hint}</div>
    </div>
  );
}
