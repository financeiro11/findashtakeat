import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Loader2, AlertTriangle, Search, RefreshCw } from "lucide-react";

/* Extrato de conta corrente de um banco (Sicoob / Asaas), na página própria aberta
   pelo seletor do Caixa. Cada fonte tem duas tabelas de mesmo formato, populadas por
   uma automação externa (n8n) ou por Edge Function (Asaas) — o frontend apenas LÊ. */

export const FONTES_CC = [
  { key: "sicoob", nome: "Sicoob", tabelaSaldo: "sicoob_saldo", tabelaExtrato: "sicoob_extrato", sync: null as string | null },
  { key: "asaas", nome: "Asaas", tabelaSaldo: "asaas_saldo", tabelaExtrato: "asaas_extrato", sync: "asaas-extrato-sync" as string | null },
] as const;
export type FonteCCKey = (typeof FONTES_CC)[number]["key"];

/* ------------------------------ formatters ------------------------------ */
const fmtBRL = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (d?: string | null) => {
  if (!d) return "—";
  const [ano, mes, dia] = d.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
};
const fmtDataHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

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
type Periodo = "tudo" | "hoje" | "7d" | "30d" | "mes";

const sb = supabase as any;
const eCredito = (t: string | null) => (t ?? "").toLowerCase().startsWith("cred");

// Categoria do lançamento (usada no ponto colorido e no acumulado de taxas).
type CatKey = "cobranca" | "mensageria" | "pix" | "nf" | "outros";
function categoria(h?: string | null): CatKey {
  const s = (h ?? "").toLowerCase();
  if (s.includes("mensageria")) return "mensageria";
  if (s.includes("pix")) return "pix";
  if (s.includes("nf") || s.includes("nota fiscal") || s.includes("serviço") || s.includes("servico")) return "nf";
  if (s.includes("cobran") || s.includes("recebid")) return "cobranca";
  return "outros";
}
const DOT: Record<CatKey, string> = {
  cobranca: "bg-pos",
  mensageria: "bg-amber-500",
  pix: "bg-sky-500",
  nf: "bg-violet-500",
  outros: "bg-muted-foreground/50",
};

const hojeISO = () => new Date().toLocaleDateString("en-CA");
function menosDias(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
}

const PAGINA = 30;

export default function ContaCorrenteBancaria({ banco }: { banco: FonteCCKey }) {
  const [saldo, setSaldo] = useState<Saldo | null>(null);
  const [extrato, setExtrato] = useState<Lancamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>("tudo");
  const [tipo, setTipo] = useState<FiltroTipo>("todos");
  const [busca, setBusca] = useState("");
  const [visiveis, setVisiveis] = useState(PAGINA);

  const fonte = FONTES_CC.find((f) => f.key === banco) ?? FONTES_CC[0];

  async function carregar(silencioso = false) {
    if (!silencioso) setLoading(true);
    const [saldoRes, extratoRes] = await Promise.all([
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
    if (saldoRes.error) toast.error(`Falha ao carregar o saldo ${fonte.nome}: ` + saldoRes.error.message);
    if (extratoRes.error) toast.error(`Falha ao carregar o extrato ${fonte.nome}: ` + extratoRes.error.message);
    setSaldo((saldoRes.data as Saldo) ?? null);
    setExtrato((extratoRes.data as Lancamento[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    setSaldo(null);
    setExtrato([]);
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonte.tabelaSaldo, fonte.tabelaExtrato]);

  useEffect(() => setVisiveis(PAGINA), [periodo, tipo, busca, banco]);

  async function sincronizar() {
    if (!fonte.sync) return;
    setSyncing(true);
    toast.message(`Buscando novos lançamentos no ${fonte.nome}…`);
    try {
      const { data, error } = await supabase.functions.invoke(fonte.sync, { body: { action: "sync" } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const novos = (data as any)?.novos_gravados ?? 0;
      toast.success(novos > 0 ? `${novos} novo(s) lançamento(s) do ${fonte.nome}.` : `Base do ${fonte.nome} já estava em dia.`);
      await carregar(true);
    } catch (e: any) {
      toast.error(`Erro ao sincronizar o ${fonte.nome}: ` + (e?.message ?? String(e)));
    } finally {
      setSyncing(false);
    }
  }

  const desatualizado = useMemo(() => {
    if (!saldo?.atualizado_em) return false;
    return Date.now() - new Date(saldo.atualizado_em).getTime() > 24 * 60 * 60 * 1000;
  }, [saldo]);

  // Saldo corrido: o mais recente carrega o saldo atual da conta; os anteriores
  // são reconstruídos desfazendo cada lançamento.
  const comSaldo = useMemo(() => {
    let corrente = saldo?.saldo ?? 0;
    return extrato.map((m) => {
      const linha = { ...m, saldoApos: corrente };
      corrente -= (eCredito(m.tipo) ? 1 : -1) * (m.valor ?? 0);
      return linha;
    });
  }, [extrato, saldo]);

  const filtrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const de =
      periodo === "hoje" ? hojeISO()
      : periodo === "7d" ? menosDias(7)
      : periodo === "30d" ? menosDias(30)
      : periodo === "mes" ? hojeISO().slice(0, 7) + "-01"
      : "";
    return comSaldo.filter((m) => {
      const dm = m.data_movimento?.slice(0, 10) ?? "";
      if (de && dm < de) return false;
      if (tipo === "credito" && !eCredito(m.tipo)) return false;
      if (tipo === "debito" && eCredito(m.tipo)) return false;
      if (q && !`${m.historico ?? ""} ${m.contraparte_nome ?? ""} ${m.numero_documento ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [comSaldo, periodo, tipo, busca]);

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

  // Acumulado por tipo de taxa (segue os filtros da tabela).
  const taxas = useMemo(() => {
    const base = { mensageria: { v: 0, q: 0 }, pix: { v: 0, q: 0 }, nf: { v: 0, q: 0 }, recebido: { v: 0, q: 0 } };
    for (const m of filtrado) {
      const cat = categoria(m.historico);
      const v = m.valor ?? 0;
      if (eCredito(m.tipo)) {
        if (cat === "cobranca") { base.recebido.v += v; base.recebido.q++; }
      } else if (cat === "mensageria" || cat === "pix" || cat === "nf") {
        base[cat].v += v; base[cat].q++;
      }
    }
    const totalTaxas = base.mensageria.v + base.pix.v + base.nf.v;
    const qtdTaxas = base.mensageria.q + base.pix.q + base.nf.q;
    return { ...base, totalTaxas, qtdTaxas, custoPct: base.recebido.v > 0 ? (totalTaxas / base.recebido.v) * 100 : 0 };
  }, [filtrado]);

  const pagina = filtrado.slice(0, visiveis);

  function exportarCSV() {
    const linhas = [
      ["Data", "Lançamento", "Contraparte", "Documento", "Tipo", "Valor", "Saldo após"],
      ...filtrado.map((m) => [
        fmtData(m.data_movimento), m.historico ?? "", m.contraparte_nome ?? "", m.numero_documento ?? "",
        eCredito(m.tipo) ? "Crédito" : "Débito", String(m.valor ?? 0), String(m.saldoApos ?? ""),
      ]),
    ];
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `extrato-${fonte.key}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const mostraTaxas = fonte.key === "asaas";

  return (
    <div className="card-surface overflow-hidden">
      {/* Barra superior: sync */}
      {fonte.sync && (
        <div className="flex items-center justify-end gap-3 border-b border-border/60 px-4 py-2">
          <span className="text-[11px] text-muted-foreground">
            sync 1×/dia{saldo?.atualizado_em ? ` · ${fmtHora(saldo.atualizado_em)}` : ""}
          </span>
          <button
            onClick={sincronizar}
            disabled={syncing}
            className="ghost-btn flex items-center gap-1.5 px-2.5 text-[12px] disabled:opacity-60"
            title="Buscar lançamentos novos na API do Asaas (incremental)"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sincronizar
          </button>
        </div>
      )}

      {/* Topo: saldo + acumulado */}
      <div className="grid grid-cols-1 border-b border-border lg:grid-cols-[300px_1fr]">
        {/* Saldo */}
        <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
          <div className="eyebrow">Saldo em conta · {fonte.nome}</div>
          {loading ? (
            <div className="flex h-20 items-center text-[12.5px] text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : !saldo ? (
            <div className="py-6 text-[12.5px] text-muted-foreground">Nenhum saldo {fonte.nome} sincronizado ainda.</div>
          ) : (
            <>
              <div className={cn("num mt-1 text-[34px] font-semibold leading-none tracking-tight", (saldo.saldo ?? 0) >= 0 ? "text-pos" : "text-neg")}>
                {fmtBRL(saldo.saldo ?? 0)}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 text-[11.5px] text-muted-foreground">
                <span>Disponível <b className="num text-foreground">{fmtNum(saldo.saldo_disponivel ?? 0)}</b></span>
                <span>Bloqueado <b className="num text-foreground">{fmtNum(saldo.saldo_bloqueado ?? 0)}</b></span>
              </div>
              <div className={cn(
                "mt-1 flex items-start gap-1.5 text-[10.5px]",
                desatualizado ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/70",
              )}>
                {desatualizado && <AlertTriangle className="mt-px h-3 w-3 shrink-0" />}
                <span>
                  Atualizado em {fmtDataHora(saldo.atualizado_em)}
                  {desatualizado && " · desatualizado (há mais de 24h)"}
                </span>
              </div>
            </>
          )}

          <div className="mt-4 border-t border-dashed border-border pt-3">
            <div className="eyebrow">No período filtrado</div>
            <dl className="mt-1.5 space-y-1 text-[12.5px]">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Entradas</dt>
                <dd className="num font-medium text-pos">+{fmtBRL(totais.entradas)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Saídas</dt>
                <dd className="num font-medium text-neg">−{fmtBRL(totais.saidas)}</dd>
              </div>
              <div className="flex items-center justify-between border-t border-border/60 pt-1">
                <dt className="font-semibold text-foreground">Líquido</dt>
                <dd className={cn("num font-semibold", liquido >= 0 ? "text-pos" : "text-neg")}>
                  {liquido >= 0 ? "+" : "−"}{fmtBRL(Math.abs(liquido))}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Acumulado por tipo de taxa */}
        <div className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="eyebrow">{mostraTaxas ? "Acumulado por tipo de taxa" : "Resumo do período"}</div>
            <span className="text-[11px] text-muted-foreground">
              {filtrado.length} lançamento{filtrado.length === 1 ? "" : "s"} · segue os filtros da tabela
            </span>
          </div>

          {mostraTaxas ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {([
                  ["Taxa de mensageria", taxas.mensageria],
                  ["Taxa do Pix", taxas.pix],
                  ["Emissão de NF de serviço", taxas.nf],
                  ["Total de taxas", { v: taxas.totalTaxas, q: taxas.qtdTaxas }],
                ] as const).map(([rot, d]) => {
                  const share = taxas.totalTaxas > 0 ? Math.max(4, (d.v / taxas.totalTaxas) * 100) : 0;
                  return (
                    <div key={rot} className="rounded-md border border-border px-3 py-2.5">
                      <div className="truncate text-[11.5px] text-muted-foreground" title={rot}>{rot}</div>
                      <div className="num mt-1 text-[20px] font-semibold leading-none text-neg">−{fmtNum(d.v)}</div>
                      <div className="mt-2 h-[3px] w-full rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-neg" style={{ width: `${share}%` }} />
                      </div>
                      <div className="num mt-1.5 text-[10.5px] text-muted-foreground">{d.q} cobranças</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-pos-soft px-3 py-2 text-[12.5px]">
                <span className="text-muted-foreground">Cobranças recebidas</span>
                <b className="num text-[15px] text-pos">+{fmtBRL(taxas.recebido.v)}</b>
                <span className="ml-auto text-muted-foreground">Custo total das taxas sobre o recebido</span>
                <b className="num text-neg">{taxas.custoPct.toFixed(2).replace(".", ",")}%</b>
              </div>
            </>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border px-3 py-2.5">
                <div className="text-[11.5px] text-muted-foreground">Total de entradas</div>
                <div className="num text-[20px] font-semibold text-pos">+{fmtBRL(totais.entradas)}</div>
              </div>
              <div className="rounded-md border border-border px-3 py-2.5">
                <div className="text-[11.5px] text-muted-foreground">Total de saídas</div>
                <div className="num text-[20px] font-semibold text-neg">−{fmtBRL(totais.saidas)}</div>
              </div>
              <div className="rounded-md border border-border px-3 py-2.5">
                <div className="text-[11.5px] text-muted-foreground">Resultado líquido</div>
                <div className={cn("num text-[20px] font-semibold", liquido >= 0 ? "text-pos" : "text-neg")}>
                  {liquido >= 0 ? "+" : "−"}{fmtBRL(Math.abs(liquido))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Barra de filtros do extrato */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[14px] font-semibold tracking-tight text-foreground">Extrato</h3>
          <span className="text-[11.5px] text-muted-foreground">crédito em verde, débito em vermelho</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar histórico, cliente ou fatura"
              className="h-8 w-60 rounded-md border border-border bg-background pl-8 pr-2 text-[12px] outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex rounded-md border border-border bg-card p-0.5">
            {([["hoje", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"], ["mes", "Mês atual"], ["tudo", "Tudo"]] as const).map(([k, rot]) => (
              <button
                key={k}
                onClick={() => setPeriodo(k)}
                className={cn(
                  "rounded px-2.5 py-1 text-[11.5px] font-medium transition",
                  periodo === k ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {rot}
              </button>
            ))}
          </div>
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
        </div>
      </div>

      {/* Feed de lançamentos */}
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="w-[120px] px-4 py-2 font-medium">Data</th>
              <th className="px-2 py-2 font-medium">Lançamento</th>
              <th className="px-4 py-2 text-right font-medium">Valor · Saldo</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Carregando extrato…
              </td></tr>
            )}
            {!loading && pagina.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">Nenhum lançamento no período/filtro.</td></tr>
            )}
            {!loading && pagina.map((m, i) => {
              const credito = eCredito(m.tipo);
              const cat = categoria(m.historico);
              const novaData = i === 0 || pagina[i - 1].data_movimento !== m.data_movimento;
              return (
                <tr key={m.id} className={cn("border-b border-border/50 hover:bg-secondary/40", novaData && i > 0 && "border-t border-border")}>
                  <td className="whitespace-nowrap px-4 py-2 align-top">
                    {novaData && <div className="num text-[12.5px] font-semibold text-foreground">{fmtData(m.data_movimento)}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[cat])} />
                      <span className="truncate font-medium text-foreground">{m.historico || "Lançamento"}</span>
                    </div>
                    <div className="truncate pl-3.5 text-[11.5px] text-muted-foreground">
                      {m.contraparte_nome || "—"}
                      {m.numero_documento ? ` · fatura nr. ${m.numero_documento}` : ""}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <div className={cn("num font-semibold", credito ? "text-pos" : "text-neg")}>
                      {credito ? "+" : "−"}{fmtBRL(m.valor ?? 0)}
                    </div>
                    <div className="num text-[11px] text-muted-foreground/70">saldo {fmtNum(m.saldoApos ?? 0)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Rodapé */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
        <span>
          Mostrando <b className="num text-foreground">{pagina.length}</b> de{" "}
          <span className="num">{filtrado.length.toLocaleString("pt-BR")}</span> lançamentos
        </span>
        <div className="flex items-center gap-4">
          <button onClick={exportarCSV} className="hover:text-foreground">Exportar CSV</button>
          {visiveis < filtrado.length && (
            <button onClick={() => setVisiveis((v) => v + PAGINA)} className="font-medium text-foreground hover:underline">
              Carregar mais
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
