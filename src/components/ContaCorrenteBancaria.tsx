import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { Landmark, Loader2, AlertTriangle, Search } from "lucide-react";

/* Seção "Conta Corrente" da aba Caixa: alterna entre bancos (Sicoob / Asaas) num
   seletor de abas. Cada fonte tem duas tabelas de mesmo formato, populadas por uma
   automação externa (n8n) — o frontend apenas LÊ (nunca chama a API do banco). */

// Fontes disponíveis no seletor. Extrato e saldo têm o MESMO schema em todas.
const FONTES = [
  { key: "sicoob", nome: "Sicoob", tabelaSaldo: "sicoob_saldo", tabelaExtrato: "sicoob_extrato" },
  { key: "asaas", nome: "Asaas", tabelaSaldo: "asaas_saldo", tabelaExtrato: "asaas_extrato" },
] as const;
type FonteKey = (typeof FONTES)[number]["key"];

/* ------------------------------ formatters ------------------------------ */
// Formato BR com centavos: R$ 1.234,56.
const fmtBRL = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
// data_movimento chega como "AAAA-MM-DD" (date do Postgres) → "DD/MM/AAAA".
const fmtData = (d?: string | null) => {
  if (!d) return "—";
  const [ano, mes, dia] = d.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
};
const fmtDataHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/* ------------------------------ types (loose) ------------------------------ */
type Saldo = {
  conta: string | null;
  saldo: number | null;
  saldo_disponivel: number | null;
  saldo_bloqueado: number | null;
  atualizado_em: string | null;
};
type Lancamento = {
  id: string;
  id_transacao: string;
  data_movimento: string | null;
  tipo: string | null; // 'credito' | 'debito'
  valor: number | null; // sempre positivo
  historico: string | null;
  contraparte_nome: string | null;
  contraparte_documento: string | null;
  numero_documento: string | null;
};

type FiltroTipo = "todos" | "credito" | "debito";

const sb = supabase as any;
const eCredito = (t: string | null) => (t ?? "").toLowerCase().startsWith("cred");

export default function ContaCorrenteBancaria() {
  const [fonteKey, setFonteKey] = useState<FonteKey>("sicoob");
  const [saldo, setSaldo] = useState<Saldo | null>(null);
  const [extrato, setExtrato] = useState<Lancamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [de, setDe] = useState("");   // AAAA-MM-DD
  const [ate, setAte] = useState(""); // AAAA-MM-DD
  const [tipo, setTipo] = useState<FiltroTipo>("todos");
  const [busca, setBusca] = useState("");

  const fonte = FONTES.find((f) => f.key === fonteKey)!;

  // Recarrega ao trocar de banco. `cancelado` evita aplicar resposta de uma fonte antiga.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoading(true);
      setSaldo(null);
      setExtrato([]);
      const [saldoRes, extratoRes] = await Promise.all([
        // Saldo atual = linha com maior atualizado_em (a automação só insere snapshots).
        sb.from(fonte.tabelaSaldo)
          .select("conta,saldo,saldo_disponivel,saldo_bloqueado,atualizado_em")
          .order("atualizado_em", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb.from(fonte.tabelaExtrato)
          .select("id,id_transacao,data_movimento,tipo,valor,historico,contraparte_nome,contraparte_documento,numero_documento")
          .order("data_movimento", { ascending: false })
          .limit(2000),
      ]);
      if (cancelado) return;
      if (saldoRes.error) toast.error(`Falha ao carregar o saldo ${fonte.nome}: ` + saldoRes.error.message);
      if (extratoRes.error) toast.error(`Falha ao carregar o extrato ${fonte.nome}: ` + extratoRes.error.message);
      setSaldo((saldoRes.data as Saldo) ?? null);
      setExtrato((extratoRes.data as Lancamento[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelado = true; };
  }, [fonte.tabelaSaldo, fonte.tabelaExtrato, fonte.nome]);

  // "dado desatualizado" quando o último snapshot tem mais de 24h.
  const desatualizado = useMemo(() => {
    if (!saldo?.atualizado_em) return false;
    return Date.now() - new Date(saldo.atualizado_em).getTime() > 24 * 60 * 60 * 1000;
  }, [saldo]);

  const filtrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return extrato.filter((m) => {
      const dm = m.data_movimento?.slice(0, 10) ?? "";
      if (de && dm < de) return false;
      if (ate && dm > ate) return false;
      if (tipo === "credito" && !eCredito(m.tipo)) return false;
      if (tipo === "debito" && eCredito(m.tipo)) return false;
      if (q && !`${m.historico ?? ""} ${m.contraparte_nome ?? ""} ${m.numero_documento ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [extrato, de, ate, tipo, busca]);

  const totais = useMemo(
    () =>
      filtrado.reduce(
        (a, m) => {
          const v = m.valor ?? 0;
          if (eCredito(m.tipo)) a.entradas += v; else a.saidas += v;
          return a;
        },
        { entradas: 0, saidas: 0 },
      ),
    [filtrado],
  );
  const liquido = totais.entradas - totais.saidas;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-primary" />
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Conta Corrente</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> {fonte.nome}
          </span>
        </div>
        {/* Seletor de banco (Sicoob / Asaas) — mesmo estilo das abas do Caixa */}
        <div className="flex rounded-md border border-border bg-card p-0.5">
          {FONTES.map((f) => (
            <button
              key={f.key}
              onClick={() => setFonteKey(f.key)}
              className={cn(
                "rounded px-3 py-1 text-[12px] font-medium transition",
                fonteKey === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.nome}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Card de saldo */}
        <SectionCard title="Saldo em conta corrente" subtitle={saldo?.conta ? `Conta ${saldo.conta}` : "Sincronizado via automação"}>
          {loading ? (
            <div className="flex h-24 items-center text-[12.5px] text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : !saldo ? (
            <div className="py-6 text-center text-[12.5px] text-muted-foreground">Nenhum saldo {fonte.nome} sincronizado ainda.</div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="eyebrow">Saldo</div>
                <div className={cn("num text-[26px] font-semibold leading-none tracking-tight", (saldo.saldo ?? 0) >= 0 ? "text-pos" : "text-neg")}>
                  {fmtBRL(saldo.saldo ?? 0)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Disponível</span>
                  <span className="num text-[13px] font-semibold text-foreground">{fmtBRL(saldo.saldo_disponivel ?? 0)}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Bloqueado</span>
                  <span className="num text-[13px] font-semibold text-foreground">{fmtBRL(saldo.saldo_bloqueado ?? 0)}</span>
                </div>
              </div>
              <div className={cn(
                "mt-1 flex items-start gap-1.5 border-t border-border/40 pt-2 text-[10.5px]",
                desatualizado ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/80",
              )}>
                {desatualizado && <AlertTriangle className="mt-px h-3 w-3 shrink-0" />}
                <span>
                  Última atualização: {fmtDataHora(saldo.atualizado_em)}
                  {desatualizado && " · dado desatualizado (há mais de 24h)"}
                </span>
              </div>
            </div>
          )}
        </SectionCard>

        {/* Totalizadores do período filtrado */}
        <SectionCard className="lg:col-span-2" title="Resumo do período filtrado" subtitle={`${filtrado.length} lançamento${filtrado.length === 1 ? "" : "s"} · aplica os filtros da tabela abaixo`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-secondary/30 px-3 py-2.5">
              <div className="eyebrow">Total de entradas</div>
              <div className="num text-[20px] font-semibold text-pos">+{fmtBRL(totais.entradas)}</div>
            </div>
            <div className="rounded-md bg-secondary/30 px-3 py-2.5">
              <div className="eyebrow">Total de saídas</div>
              <div className="num text-[20px] font-semibold text-neg">-{fmtBRL(totais.saidas)}</div>
            </div>
            <div className="rounded-md bg-secondary/60 px-3 py-2.5">
              <div className="eyebrow">Resultado líquido</div>
              <div className={cn("num text-[20px] font-semibold", liquido >= 0 ? "text-pos" : "text-neg")}>
                {liquido >= 0 ? "+" : "-"}{fmtBRL(Math.abs(liquido))}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Extrato */}
      <SectionCard
        title="Extrato da conta corrente"
        subtitle={`Lançamentos do ${fonte.nome} · crédito em verde, débito em vermelho`}
        padded={false}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar histórico ou contraparte…"
                className="h-8 w-52 rounded-md border border-border bg-background pl-8 pr-2 text-[12px] outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <input
              type="date" value={de} onChange={(e) => setDe(e.target.value)}
              title="Data inicial"
              className="h-8 rounded-md border border-border bg-background px-2 text-[12px] outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-[11px] text-muted-foreground">até</span>
            <input
              type="date" value={ate} onChange={(e) => setAte(e.target.value)}
              title="Data final"
              className="h-8 rounded-md border border-border bg-background px-2 text-[12px] outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex rounded-md border border-border bg-card p-0.5">
              {([["todos", "Todos"], ["credito", "Crédito"], ["debito", "Débito"]] as const).map(([k, rot]) => (
                <button
                  key={k}
                  onClick={() => setTipo(k)}
                  className={cn(
                    "rounded px-2.5 py-1 text-[11.5px] font-medium transition",
                    tipo === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {rot}
                </button>
              ))}
            </div>
            {(de || ate || tipo !== "todos" || busca) && (
              <button
                onClick={() => { setDe(""); setAte(""); setTipo("todos"); setBusca(""); }}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Limpar
              </button>
            )}
          </div>
        }
      >
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Data</th>
                <th className="px-2 py-2 font-medium">Histórico</th>
                <th className="px-2 py-2 font-medium">Contraparte</th>
                <th className="px-2 py-2 font-medium">Documento</th>
                <th className="px-4 py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Carregando extrato…
                </td></tr>
              )}
              {!loading && filtrado.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Nenhum lançamento no período/filtro.</td></tr>
              )}
              {!loading && filtrado.map((m) => {
                const credito = eCredito(m.tipo);
                return (
                  <tr key={m.id} className="border-b border-border/50 hover:bg-secondary/40">
                    <td className="num whitespace-nowrap px-4 py-1.5 text-muted-foreground">{fmtData(m.data_movimento)}</td>
                    <td className="max-w-[220px] truncate px-2 py-1.5 text-foreground" title={m.historico ?? ""}>{m.historico || "—"}</td>
                    <td className="max-w-[180px] truncate px-2 py-1.5 text-muted-foreground" title={m.contraparte_nome ?? ""}>
                      {m.contraparte_nome || "—"}
                      {m.contraparte_documento ? <span className="text-muted-foreground/60"> · {m.contraparte_documento}</span> : null}
                    </td>
                    <td className="max-w-[120px] truncate px-2 py-1.5 text-muted-foreground">{m.numero_documento || "—"}</td>
                    <td className={cn("num whitespace-nowrap px-4 py-1.5 text-right font-medium", credito ? "text-pos" : "text-neg")}>
                      {credito ? "+" : "-"}{fmtBRL(m.valor ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
