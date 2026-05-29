import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  HFRow, Periodo, listarPeriodosDisponiveis, calcMetricas, cmpPeriodo, subMeses,
} from "./metrics";

export type BpAnualRow = { metrica: string; ano: number; mes: number; valor: number };

const SALDO_INICIAL_KEY = "dashboard:saldoInicial";
const PERIODO_KEY = "dashboard:periodo";

// "Apr-26" -> { ano: 2026, mes: 4 }
const EN_MONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function parseMonthKey(k: string): { ano: number; mes: number } | null {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const idx = EN_MONTH.indexOf(m[1]);
  if (idx < 0) return null;
  return { ano: 2000 + Number(m[2]), mes: idx + 1 };
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * Achata os jsonb de DRE/DFC ({ columns, rows: [{Conta, "Apr-26": ...}] }) numa lista
 * de HFRow {metrica, ano, mes, valor}. DRE entra primeiro (regime competência) e tem
 * precedência sobre DFC quando o mesmo (metrica, ano, mes) aparece nos dois.
 */
function flattenDemonstracoes(payload: any): HFRow[] {
  const out: HFRow[] = [];
  const rows: any[] = Array.isArray(payload) ? payload : Array.isArray(payload?.rows) ? payload.rows : [];
  for (const r of rows) {
    const labelKey = Object.keys(r).find((k) => !/^[A-Za-z]{3}-\d{2}$/.test(k));
    const label = labelKey ? String(r[labelKey] ?? "").trim() : "";
    if (!label) continue;
    // ignora linhas de percentual já calculadas
    if (label.startsWith("%")) continue;
    for (const k of Object.keys(r)) {
      const per = parseMonthKey(k);
      if (!per) continue;
      const n = toNum(r[k]);
      if (n === null || n === 0) continue;
      out.push({ metrica: label, ano: per.ano, mes: per.mes, valor: n });
    }
  }
  return out;
}

export function useFinanceData() {
  const [rows, setRows] = useState<HFRow[]>([]);
  const [bp, setBp] = useState<BpAnualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [saldoInicial, setSaldoInicial] = useState<number>(() => {
    const raw = localStorage.getItem(SALDO_INICIAL_KEY);
    return raw ? Number(raw) : 0;
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Fonte canônica = mesmas tabelas que DRE/DFC consomem.
      // Mantemos também historico_financeiro como fallback para meses que
      // não estejam na planilha consolidada.
      const [demRes, hfRes, bpRes] = await Promise.all([
        supabase
          .from("demonstracoes_contabeis" as any)
          .select("tipo,periodo,dados,updated_at")
          .in("tipo", ["dre", "dfc"])
          .order("updated_at", { ascending: false }),
        supabase
          .from("historico_financeiro")
          .select("metrica,ano,mes,valor")
          .order("ano", { ascending: false })
          .order("mes", { ascending: false })
          .limit(20000),
        supabase.from("bp_anual").select("ano,dados").order("ano"),
      ]);

      // 1) Demonstrativos (preferir "periodo=completo"; cair p/ mais recente por tipo).
      const dem = ((demRes.data ?? []) as unknown) as Array<{ tipo: string; periodo: string; dados: any; updated_at: string }>;
      const pickLatest = (tipo: string) => {
        const completo = dem.find((d) => d.tipo === tipo && d.periodo === "completo");
        if (completo) return completo;
        return dem.find((d) => d.tipo === tipo) ?? null;
      };
      const dre = pickLatest("dre");
      const dfc = pickLatest("dfc");

      const combined: HFRow[] = [];
      const seen = new Set<string>(); // "metrica|ano|mes"
      const pushRows = (src: HFRow[]) => {
        for (const r of src) {
          const k = `${r.metrica.toLowerCase()}|${r.ano}|${r.mes}`;
          if (seen.has(k)) continue;
          seen.add(k);
          combined.push(r);
        }
      };

      if (dre) pushRows(flattenDemonstracoes(dre.dados));
      if (dfc) pushRows(flattenDemonstracoes(dfc.dados));

      // 2) Fallback: historico_financeiro só para metric+periodo ausentes nos demonstrativos.
      if (hfRes.error) throw hfRes.error;
      pushRows((hfRes.data ?? []).map((r) => ({
        metrica: r.metrica,
        ano: Number(r.ano),
        mes: Number(r.mes),
        valor: Number(r.valor),
      })));

      setRows(combined);

      // 3) BP Anual — usa o mesmo esquema da página BP Anual:
      //    a linha "Mês Calendário" mapeia colunas (1..12 -> jan..dez).
      const flat: BpAnualRow[] = [];
      const normLab = (s: string) => String(s ?? "")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/^[\d\.\)\s\-\+\(]+/, "")
        .replace(/^[\(\)\+\-\s]+/, "")
        .replace(/\s+/g, " ")
        .trim();
      for (const row of (bpRes.data ?? []) as Array<{ ano: number; dados: any }>) {
        const arr = Array.isArray(row.dados) ? row.dados : [];
        if (!arr.length) continue;
        const keys = Object.keys(arr[0] || {});
        const labelKey = keys[0];
        // linha "Mês Calendário" → identifica colunas dos 12 meses
        const monthRow = arr.find((r: any) => normLab(String(r[labelKey] ?? "")).startsWith("mes calendario"));
        const monthCols: string[] = [];
        if (monthRow) {
          for (const k of keys) {
            const v = monthRow[k];
            const n = typeof v === "number" ? v : Number(v);
            if (Number.isInteger(n) && n >= 1 && n <= 12) monthCols[n - 1] = k;
          }
        }
        // fallback: primeiras 12 colunas numéricas após o label
        if (monthCols.filter(Boolean).length < 12) {
          const nums = keys.slice(1).filter((k) => arr.some((r: any) => typeof r[k] === "number"));
          for (let i = 0; i < 12 && i < nums.length; i++) if (!monthCols[i]) monthCols[i] = nums[i];
        }
        for (const r of arr) {
          const lab = String(r[labelKey] ?? "").trim();
          if (!lab) continue;
          const norm = normLab(lab);
          if (!norm || norm.startsWith("mes ") || norm.startsWith("ano ") || norm === "imagem" || norm.startsWith("projec")) continue;
          monthCols.forEach((k, i) => {
            if (!k) return;
            const v = r[k];
            const n = toNum(v);
            if (n == null || n === 0) return;
            flat.push({ metrica: lab, ano: row.ano, mes: i + 1, valor: n });
          });
        }
      }
      setBp(flat);
      setLastUpdate(new Date());

    } catch (e: any) {
      setError(e?.message ?? "Erro ao carregar dados financeiros");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const periodosDisponiveis = useMemo(() => listarPeriodosDisponiveis(rows), [rows]);
  const ultimoPeriodo = periodosDisponiveis[periodosDisponiveis.length - 1] ?? { ano: new Date().getFullYear(), mes: new Date().getMonth() + 1 };

  const dateToPeriodo = (d: Date): Periodo => ({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  const periodoToDate = (p: Periodo) => new Date(p.ano, p.mes - 1, 1);

  const [periodo, setPeriodoState] = useState<Periodo>(() => {
    const rawHeader = localStorage.getItem("header:period");
    if (rawHeader) {
      try { return dateToPeriodo(new Date(rawHeader)); } catch {}
    }
    const raw = localStorage.getItem(PERIODO_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p?.ano && p?.mes) return p;
      } catch {}
    }
    return ultimoPeriodo;
  });

  const [periodoCompare, setPeriodoCompareState] = useState<Periodo>(() => {
    const rawHeader = localStorage.getItem("header:compare");
    if (rawHeader) {
      try { return dateToPeriodo(new Date(rawHeader)); } catch {}
    }
    return subMeses(periodo, 1);
  });

  // Helpers para clampar a um período existente nos dados.
  const findNearest = (p: Periodo): Periodo => {
    if (!periodosDisponiveis.length) return p;
    let best: Periodo | null = null;
    for (const x of periodosDisponiveis) {
      if (cmpPeriodo(x, p) <= 0) best = x;
    }
    return best ?? periodosDisponiveis[0];
  };
  const findPrev = (p: Periodo): Periodo => {
    if (!periodosDisponiveis.length) return subMeses(p, 1);
    let best: Periodo | null = null;
    for (const x of periodosDisponiveis) {
      if (cmpPeriodo(x, p) < 0) best = x;
    }
    return best ?? subMeses(p, 1);
  };

  // Sempre que os períodos disponíveis mudarem, clampa período/compare para meses
  // que realmente existem (e garante compare != período para os deltas funcionarem).
  useEffect(() => {
    if (!periodosDisponiveis.length) return;
    const existsPer = periodosDisponiveis.some((p) => p.ano === periodo.ano && p.mes === periodo.mes);
    const novoPer = existsPer ? periodo : findNearest(periodo);
    const existsCmp = periodosDisponiveis.some((p) => p.ano === periodoCompare.ano && p.mes === periodoCompare.mes);
    let novoCmp = existsCmp ? periodoCompare : findPrev(novoPer);
    if (cmpPeriodo(novoCmp, novoPer) === 0) novoCmp = findPrev(novoPer);
    if (novoPer.ano !== periodo.ano || novoPer.mes !== periodo.mes) {
      setPeriodoState(novoPer);
      const d = periodoToDate(novoPer);
      localStorage.setItem("header:period", d.toISOString());
      window.dispatchEvent(new CustomEvent("header:period-change", { detail: { period: d } }));
    }
    if (novoCmp.ano !== periodoCompare.ano || novoCmp.mes !== periodoCompare.mes) {
      setPeriodoCompareState(novoCmp);
      const d = periodoToDate(novoCmp);
      localStorage.setItem("header:compare", d.toISOString());
      window.dispatchEvent(new CustomEvent("header:compare-change", { detail: { compare: d } }));
    }
  }, [periodosDisponiveis.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Garante que o compare seja sempre um mês existente diferente do período atual.
  useEffect(() => {
    if (!periodosDisponiveis.length) return;
    if (cmpPeriodo(periodoCompare, periodo) === 0) {
      setPeriodoCompareState(findPrev(periodo));
    }
  }, [periodo.ano, periodo.mes, periodosDisponiveis.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sincroniza com a toolbar (PageHeader), clampando ao que existe nos dados.
  useEffect(() => {
    const onPeriod = (e: Event) => {
      const d = (e as CustomEvent).detail?.period as Date | undefined;
      if (!d) return;
      const p = dateToPeriodo(new Date(d));
      setPeriodoState(periodosDisponiveis.length ? findNearest(p) : p);
    };
    const onCompare = (e: Event) => {
      const d = (e as CustomEvent).detail?.compare as Date | undefined;
      if (!d) return;
      const p = dateToPeriodo(new Date(d));
      setPeriodoCompareState(periodosDisponiveis.length ? findNearest(p) : p);
    };
    window.addEventListener("header:period-change", onPeriod);
    window.addEventListener("header:compare-change", onCompare);
    return () => {
      window.removeEventListener("header:period-change", onPeriod);
      window.removeEventListener("header:compare-change", onCompare);
    };
  }, [periodosDisponiveis]);

  const setPeriodo = (p: Periodo) => {
    setPeriodoState(p);
    localStorage.setItem(PERIODO_KEY, JSON.stringify(p));
    const d = periodoToDate(p);
    localStorage.setItem("header:period", d.toISOString());
    window.dispatchEvent(new CustomEvent("header:period-change", { detail: { period: d } }));
  };
  const updateSaldoInicial = (n: number) => {
    setSaldoInicial(n);
    localStorage.setItem(SALDO_INICIAL_KEY, String(n));
  };

  const metricas = useMemo(
    () => (rows.length ? calcMetricas(rows, periodo, saldoInicial) : null),
    [rows, periodo, saldoInicial],
  );
  const metricasAnt = useMemo(
    () => (rows.length ? calcMetricas(rows, periodoCompare, saldoInicial) : null),
    [rows, periodoCompare, saldoInicial],
  );
  const metricas12m = useMemo(
    () => (rows.length ? calcMetricas(rows, subMeses(periodo, 12), saldoInicial) : null),
    [rows, periodo, saldoInicial],
  );

  // Janela visível (últimos 12 meses até o período)
  const periodos12m = useMemo(() => {
    const out: Periodo[] = [];
    for (let i = 11; i >= 0; i--) out.push(subMeses(periodo, i));
    return out;
  }, [periodo]);

  // Lookup de orçado (BP Anual) para uma métrica num período.
  // Tolera variações de label (Receita Bruta, EBITDA, etc.) via normalização.
  const normMetric = (s: string) => String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^[\d\.\)\s\-\+\(]+/, "")
    .replace(/^[\(\)\+\-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Aliases: rubricas do DRE/historico_financeiro ↔ rubricas do BP Anual.
  // O BP usa rótulos numerados ("5.4.Viagens & Transportes") e agrega contas
  // que aparecem separadas no realizado. Mapeamos manualmente para que o
  // "vs orçado" funcione para todas as rubricas, não só "Equipe Comercial".
  const ORC_ALIASES: Record<string, string[]> = {
    "equipe administrativa": ["4.1.Equipe Administrativa"],
    "equipe marketing": ["4.2.Equipe Marketing"],
    "equipe comercial": ["4.3.Equipe Comercial"],
    "equipe onboarding": ["4.4.Equipe Onboarding"],
    "equipe tecnologia": ["4.5.Equipe Tecnologia"],
    "equipe operacional": ["3.1.Equipe Operacional"],
    "beneficios": ["4.6.Benefícios"],
    "premiacoes operacionais": ["3.2.Premiação Operacional"],
    "premiacoes": ["3.2.Premiação Operacional"],
    "meios de pagamento": ["3.3.Meios de Pagamento"],
    "servidor": ["3.4.Infraestrutura"],
    "softwares operacionais": ["3.5.Softwares Operacionais"],
    "outros custos": ["3.6.Outros Custos"],
    "cmv materiais": ["3.6.Outros Custos"],
    "ocupacao & escritorio": ["5.1.Ocupação & Escritório"],
    "assessorias & consultorias": ["5.2.Assessorias & Consultorias"],
    "agencias & consultorias": ["5.2.Assessorias & Consultorias"],
    "softwares administrativos": ["5.3.Softwares Administrativos"],
    "viagens & transportes adm": ["5.4.Viagens & Transportes"],
    "viagens & transportes mkt": ["5.4.Viagens & Transportes"],
    "outras despesas adm": ["5.5.Outras Despesas Adm"],
    "campanhas de midia paga": ["6.1.Aquisição de Clientes"],
    "campanhas de outros canais": ["6.1.Aquisição de Clientes"],
    "comissoes consultores / parceiros": ["6.2.Comissões"],
    "mgm": ["6.3.Outras Despesas M&V"],
    "eventos e feiras": ["6.3.Outras Despesas M&V"],
    "outras despesas mkt": ["6.3.Outras Despesas M&V"],
    "softwares marketing & vendas": ["6.3.Outras Despesas M&V"],
    "(+) receita financeira": ["9.1.Recebimento de Juros"],
    "(-) juros": ["9.2.Pagamento de Juros"],
    "pis": ["2.1.PIS"],
    "cofins": ["2.2.COFINS"],
    "iss": ["2.3.ISS"],
    "receita liquida": ["Receita Líquida"],
    "ebitda": ["EBITDA"],
  };

  const orcado = useMemo(() => {
    const idx = new Map<string, number>();
    for (const r of bp) {
      const k = `${normMetric(r.metrica)}|${r.ano}|${r.mes}`;
      idx.set(k, (idx.get(k) ?? 0) + Number(r.valor ?? 0));
    }
    return (metricas: string | string[], p: Periodo): number | null => {
      const nomes = Array.isArray(metricas) ? metricas : [metricas];
      const candidatos: string[] = [];
      for (const nome of nomes) {
        candidatos.push(nome);
        const alias = ORC_ALIASES[normMetric(nome)];
        if (alias) candidatos.push(...alias);
      }
      for (const nome of candidatos) {
        const v = idx.get(`${normMetric(nome)}|${p.ano}|${p.mes}`);
        if (v != null) return v;
      }
      return null;
    };
  }, [bp]);

  return {
    rows, bp, loading, error, lastUpdate, reload: load,
    periodosDisponiveis, periodo, periodoCompare, setPeriodo, ultimoPeriodo,
    saldoInicial, setSaldoInicial: updateSaldoInicial,
    metricas, metricasAnt, metricas12m, periodos12m,
    orcado,
  };
}

