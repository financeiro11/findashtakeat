import { Fragment, useEffect, useMemo, useState } from "react";
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
const diaSemana = (d?: string | null) => {
  if (!d) return "";
  const dt = new Date(d.slice(0, 10) + "T12:00:00");
  return dt.toLocaleDateString("pt-BR", { weekday: "long" });
};

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

/* --------- Classificação Sicoob (chips do topo + selo da tabela) --------- */
type SicKey = "pix_in" | "ted_in" | "pix_out" | "boleto" | "folha" | "imposto" | "tarifa" | "outros_in" | "outros_out";
const SIC_META: Record<SicKey, { rot: string; selo: string; dot: string; chip: string }> = {
  pix_in:    { rot: "Pix recebido",       selo: "Pix recebido",  dot: "bg-emerald-500", chip: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" },
  ted_in:    { rot: "TED recebida",       selo: "TED recebida",  dot: "bg-teal-500",    chip: "border-teal-500/40 text-teal-700 dark:text-teal-400" },
  pix_out:   { rot: "Pix enviado",        selo: "Pix enviado",   dot: "bg-sky-500",     chip: "border-sky-500/40 text-sky-700 dark:text-sky-400" },
  boleto:    { rot: "Boletos pagos",      selo: "Boleto pago",   dot: "bg-violet-500",  chip: "border-violet-500/40 text-violet-700 dark:text-violet-400" },
  folha:     { rot: "Folha e benefícios", selo: "Folha",         dot: "bg-amber-500",   chip: "border-amber-500/40 text-amber-700 dark:text-amber-400" },
  imposto:   { rot: "Impostos",           selo: "Imposto",       dot: "bg-red-500",     chip: "border-red-500/40 text-red-700 dark:text-red-400" },
  tarifa:    { rot: "Tarifas bancárias",  selo: "Tarifa banc.",  dot: "bg-zinc-500",    chip: "border-zinc-400/50 text-muted-foreground" },
  outros_in: { rot: "Outras entradas",    selo: "Entrada",       dot: "bg-emerald-400", chip: "border-emerald-400/40 text-emerald-700 dark:text-emerald-400" },
  outros_out:{ rot: "Outras saídas",      selo: "Saída",         dot: "bg-muted-foreground/60", chip: "border-border text-muted-foreground" },
};
const ORDEM_SIC: SicKey[] = ["pix_in", "ted_in", "pix_out", "boleto", "folha", "imposto", "tarifa", "outros_in", "outros_out"];

function classificaSicoob(h: string | null, credito: boolean): SicKey {
  const s = (h ?? "").toLowerCase();
  const tem = (...t: string[]) => t.some((x) => s.includes(x));
  if (tem("tarifa", "pacote de serv", "cesta", "manutenção de conta", "manutencao de conta")) return "tarifa";
  if (tem("imposto", "darf", "das ", "fgts", "inss", "iss", "tribut", "gps", "gare")) return "imposto";
  if (tem("folha", "salário", "salario", "sal.", "vale", "benefíc", "benefic", "rescis", "13º", "adiantamento")) return "folha";
  if (tem("boleto", "titulo", "título", "fatura", "cobrança bancária", "cobranca bancaria")) return "boleto";
  if (tem("pix")) return credito ? "pix_in" : "pix_out";
  if (tem("ted", "doc ", "transf")) return credito ? "ted_in" : "outros_out";
  return credito ? "outros_in" : "outros_out";
}

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
  const [porPagina, setPorPagina] = useState(PAGINA);
  const [paginaAtual, setPaginaAtual] = useState(1);

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

  useEffect(() => setPaginaAtual(1), [periodo, tipo, busca, banco, porPagina]);

  async function sincronizar() {
    if (!fonte.sync) {
      // Sicoob é alimentado por automação externa (n8n): recarrega do banco.
      toast.message("Recarregando extrato do Sicoob…");
      await carregar(true);
      toast.success("Extrato atualizado.");
      return;
    }
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
  const qtdCreditos = useMemo(() => filtrado.filter((m) => eCredito(m.tipo)).length, [filtrado]);
  const qtdDebitos = filtrado.length - qtdCreditos;

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

  // Chips do Sicoob: acumulado por natureza do lançamento (segue os filtros).
  const chipsSicoob = useMemo(() => {
    const acc = new Map<SicKey, { v: number; q: number; credito: boolean }>();
    for (const m of filtrado) {
      const credito = eCredito(m.tipo);
      const k = classificaSicoob(m.historico, credito);
      const cur = acc.get(k) ?? { v: 0, q: 0, credito };
      cur.v += m.valor ?? 0;
      cur.q += 1;
      acc.set(k, cur);
    }
    return ORDEM_SIC.filter((k) => acc.has(k)).map((k) => ({ key: k, ...acc.get(k)!, ...SIC_META[k] }));
  }, [filtrado]);

  // Totais por dia (linha separadora do feed).
  const totaisDia = useMemo(() => {
    const map = new Map<string, { c: number; d: number }>();
    for (const m of filtrado) {
      const dia = m.data_movimento?.slice(0, 10) ?? "";
      const cur = map.get(dia) ?? { c: 0, d: 0 };
      if (eCredito(m.tipo)) cur.c += m.valor ?? 0; else cur.d += m.valor ?? 0;
      map.set(dia, cur);
    }
    return map;
  }, [filtrado]);

  const totalPaginas = Math.max(1, Math.ceil(filtrado.length / porPagina));
  const pagAtual = Math.min(paginaAtual, totalPaginas);
  const inicio = (pagAtual - 1) * porPagina;
  const pagina = filtrado.slice(inicio, inicio + porPagina);
  // Saldo inicial do período = saldo após o lançamento mais antigo, desfeito.
  const saldoInicial = useMemo(() => {
    const ultimo = filtrado[filtrado.length - 1];
    if (!ultimo) return saldo?.saldo ?? 0;
    return (ultimo.saldoApos ?? 0) - (eCredito(ultimo.tipo) ? 1 : -1) * (ultimo.valor ?? 0);
  }, [filtrado, saldo]);

  function baixar(nome: string, conteudo: string, mime: string) {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + conteudo], { type: mime }));
    const a = document.createElement("a");
    a.href = url; a.download = nome; a.click();
    URL.revokeObjectURL(url);
  }

  function exportarCSV() {
    const linhas = [
      ["Data", "Lançamento", "Contraparte", "Documento", "Tipo", "Valor", "Saldo após"],
      ...filtrado.map((m) => [
        fmtData(m.data_movimento), m.historico ?? "", m.contraparte_nome ?? "", m.numero_documento ?? "",
        eCredito(m.tipo) ? "Crédito" : "Débito", String(m.valor ?? 0), String(m.saldoApos ?? ""),
      ]),
    ];
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    baixar(`extrato-${fonte.key}.csv`, csv, "text/csv;charset=utf-8");
  }

  // OFX 1.0 (SGML) simples — aceito por contabilidade/ERP.
  function exportarOFX() {
    const dt = (d?: string | null) => (d ? d.slice(0, 10).replace(/-/g, "") : "");
    const escapa = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const trans = filtrado.map((m) => {
      const credito = eCredito(m.tipo);
      return [
        "<STMTTRN>",
        `<TRNTYPE>${credito ? "CREDIT" : "DEBIT"}`,
        `<DTPOSTED>${dt(m.data_movimento)}`,
        `<TRNAMT>${(credito ? 1 : -1) * (m.valor ?? 0)}`,
        `<FITID>${escapa(String(m.id_transacao ?? m.id))}`,
        `<MEMO>${escapa(`${m.historico ?? ""}${m.contraparte_nome ? " · " + m.contraparte_nome : ""}`)}`,
        "</STMTTRN>",
      ].join("\n");
    }).join("\n");
    const ofx = [
      "OFXHEADER:100", "DATA:OFXSGML", "VERSION:102", "SECURITY:NONE", "ENCODING:UTF-8",
      "CHARSET:NONE", "COMPRESSION:NONE", "OLDFILEUID:NONE", "NEWFILEUID:NONE", "",
      "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL",
      `<BANKACCTFROM><ACCTID>${fonte.nome}</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>`,
      "<BANKTRANLIST>", trans, "</BANKTRANLIST>",
      `<LEDGERBAL><BALAMT>${saldo?.saldo ?? 0}<DTASOF>${dt(hojeISO())}</LEDGERBAL>`,
      "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
    ].join("\n");
    baixar(`extrato-${fonte.key}.ofx`, ofx, "application/x-ofx");
  }

  const mostraTaxas = fonte.key === "asaas";
  const sicoob = fonte.key === "sicoob";

  /* ------------------------------ barra de filtros (compartilhada) ------------------------------ */
  const barraFiltros = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar histórico, cliente ou fatura"
          className="h-8 w-72 rounded-md border border-border bg-background pl-8 pr-2 text-[12px] outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
  );

  /* ============================== LAYOUT SICOOB ============================== */
  if (sicoob) {
    return (
      <div className="card-surface overflow-hidden">
        {/* Faixa de KPIs */}
        <div className="grid grid-cols-1 divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
          <div className="px-5 py-4">
            <div className="eyebrow">Saldo em conta · {fonte.nome}</div>
            {loading ? (
              <div className="mt-2 flex h-9 items-center text-[12.5px] text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : (
              <>
                <div className={cn("num mt-1.5 text-[28px] font-semibold leading-none tracking-tight", (saldo?.saldo ?? 0) >= 0 ? "text-pos" : "text-neg")}>
                  {fmtBRL(saldo?.saldo ?? 0)}
                </div>
                <div className={cn("mt-2 flex items-center gap-1.5 text-[10.5px]", desatualizado ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                  {desatualizado && <AlertTriangle className="h-3 w-3 shrink-0" />}
                  <span>
                    saldo bloqueado {fmtNum(saldo?.saldo_bloqueado ?? 0)} · atualizado {fmtDataHora(saldo?.atualizado_em)}
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="px-5 py-4">
            <div className="eyebrow">Entradas</div>
            <div className="num mt-1.5 text-[24px] font-semibold leading-none text-pos">+{fmtBRL(totais.entradas)}</div>
            <div className="mt-2 text-[10.5px] text-muted-foreground">{qtdCreditos} crédito{qtdCreditos === 1 ? "" : "s"} no período</div>
          </div>
          <div className="px-5 py-4">
            <div className="eyebrow">Saídas</div>
            <div className="num mt-1.5 text-[24px] font-semibold leading-none text-neg">−{fmtBRL(totais.saidas)}</div>
            <div className="mt-2 text-[10.5px] text-muted-foreground">{qtdDebitos} débito{qtdDebitos === 1 ? "" : "s"} no período</div>
          </div>
          <div className="px-5 py-4">
            <div className="eyebrow">Resultado do período</div>
            <div className={cn("num mt-1.5 text-[24px] font-semibold leading-none", liquido >= 0 ? "text-pos" : "text-neg")}>
              {liquido >= 0 ? "+" : "−"}{fmtBRL(Math.abs(liquido))}
            </div>
            <div className="mt-2 text-[10.5px] text-muted-foreground">{filtrado.length} lançamentos filtrados</div>
          </div>
        </div>

        {/* Chips por natureza */}
        {chipsSicoob.length > 0 && (
          <div className="grid grid-cols-2 gap-3 border-b border-border px-4 py-3 sm:grid-cols-3 lg:grid-cols-7">
            {chipsSicoob.map((c) => (
              <div key={c.key} className="rounded-md border border-border px-3 py-2 text-left">
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.dot)} />
                  <span className="truncate text-[11px] text-muted-foreground" title={c.rot}>{c.rot}</span>
                </div>
                <div className={cn("num mt-1 text-[15px] font-semibold leading-none", c.credito ? "text-pos" : "text-neg")}>
                  {c.credito ? "+" : "−"}{fmtBRL(c.v)}
                </div>
                <div className="mt-1.5 text-[10px] text-muted-foreground">{c.q} lançamento{c.q === 1 ? "" : "s"}</div>
              </div>
            ))}
          </div>
        )}

        {barraFiltros}

        {/* Feed */}
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-[128px] px-4 py-2 font-medium">Tipo</th>
                <th className="px-2 py-2 font-medium">Histórico</th>
                <th className="w-[150px] px-2 py-2 font-medium">Documento</th>
                <th className="w-[130px] px-2 py-2 text-right font-medium">Valor</th>
                <th className="w-[130px] px-4 py-2 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Carregando extrato…
                </td></tr>
              )}
              {!loading && pagina.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nenhum lançamento no período/filtro.</td></tr>
              )}
              {!loading && pagina.map((m, i) => {
                const credito = eCredito(m.tipo);
                const meta = SIC_META[classificaSicoob(m.historico, credito)];
                const dia = m.data_movimento?.slice(0, 10) ?? "";
                const novaData = i === 0 || (pagina[i - 1].data_movimento?.slice(0, 10) ?? "") !== dia;
                const tot = totaisDia.get(dia);
                return (
                  <Fragment key={m.id}>
                    {novaData && (
                      <tr className="bg-secondary/50">
                        <td colSpan={2} className="px-4 py-1.5 text-[11.5px]">
                          <span className="num font-semibold text-foreground">{fmtData(m.data_movimento)}</span>
                          <span className="ml-2 text-muted-foreground">· {diaSemana(m.data_movimento)}</span>
                        </td>
                        <td className="num px-2 py-1.5 text-right text-[11px] text-pos">{tot?.c ? `+${fmtNum(tot.c)}` : ""}</td>
                        <td className="num px-2 py-1.5 text-right text-[11px] text-neg">{tot?.d ? `−${fmtNum(tot.d)}` : ""}</td>
                        <td className="num px-4 py-1.5 text-right text-[11px] text-muted-foreground">
                          saldo do dia <b className="text-foreground">{fmtNum(m.saldoApos ?? 0)}</b>
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-border/50 hover:bg-secondary/40">
                      <td className="px-4 py-2 align-middle">
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium", meta.chip)}>
                          {meta.selo}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="truncate font-medium text-foreground">{m.contraparte_nome || m.historico || "Lançamento"}</div>
                        {m.contraparte_nome && m.historico && (
                          <div className="truncate text-[11.5px] text-muted-foreground">{m.historico}</div>
                        )}
                      </td>
                      <td className="num whitespace-nowrap px-2 py-2 text-[11.5px] text-muted-foreground">{m.numero_documento || "—"}</td>
                      <td className={cn("num whitespace-nowrap px-2 py-2 text-right font-semibold", credito ? "text-pos" : "text-neg")}>
                        {credito ? "+" : "−"}{fmtBRL(m.valor ?? 0)}
                      </td>
                      <td className="num whitespace-nowrap px-4 py-2 text-right text-[11.5px] text-muted-foreground">{fmtNum(m.saldoApos ?? 0)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Rodapé */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
          <span>
            Mostrando <b className="num text-foreground">{pagina.length}</b> de{" "}
            <span className="num">{filtrado.length.toLocaleString("pt-BR")}</span> lançamentos · saldo inicial do período{" "}
            <b className="num text-foreground">{fmtBRL(saldoInicial)}</b>
          </span>
          <div className="flex items-center gap-4">
            <button onClick={() => carregar()} className="flex items-center gap-1.5 hover:text-foreground">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Sincronizar
            </button>
            <button onClick={exportarOFX} className="hover:text-foreground">Exportar OFX</button>
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

  /* ============================== LAYOUT ASAAS ============================== */
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
        </div>
      </div>

      {barraFiltros}

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
          Mostrando{" "}
          <b className="num text-foreground">{filtrado.length ? inicio + 1 : 0}–{inicio + pagina.length}</b> de{" "}
          <span className="num">{filtrado.length.toLocaleString("pt-BR")}</span> lançamentos
        </span>
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={exportarOFX} className="hover:text-foreground">Exportar OFX</button>
          <button onClick={exportarCSV} className="hover:text-foreground">Exportar CSV</button>
          <Paginador
            pagina={pagAtual}
            totalPaginas={totalPaginas}
            porPagina={porPagina}
            onPagina={setPaginaAtual}
            onPorPagina={setPorPagina}
          />
        </div>
      </div>
    </div>
  );
}
