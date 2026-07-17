import { useMemo, useState } from "react";
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, LineChart, Line, Legend, Tooltip } from "recharts";
import { BarChart3, ChevronDown } from "lucide-react";
import { fmtBRL } from "./utils";
import type { BalanceteAccount } from "./types";

// Paleta categórica cíclica pras barras de composição — mesma lógica de "gasto por
// categoria" já usada noutras telas do Hub (cor fixa por posição, não por conta).
const PALETTE = ["#3b82f6", "#14b8a6", "#8b5cf6", "#22c55e", "#f59e0b", "#f43f5e", "#64748b"];

interface Props {
  accounts: BalanceteAccount[];
  history: { periodo: string; ativo: number; passivo: number; pl: number }[];
  /** Ex.: "últimos 6 meses" (Balancete) ou "últimos trimestres" (Balanço). */
  histLabel?: string;
}

function topByGroup(accounts: BalanceteAccount[], group: string, level = 2, limit = 8) {
  return accounts
    .filter((a) => a.group === group && a.level === level)
    .map((a) => ({ name: a.name, value: Math.abs(a.saldo_atual) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

const tooltipFmt = (v: any) => fmtBRL(Number(v));
const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

function BarList({ items }: { items: { name: string; value: number }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (items.length === 0) {
    return <div className="py-8 text-center text-[12.5px] text-muted-foreground">Sem dados para exibir.</div>;
  }
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={it.name}>
          <div className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="truncate text-foreground">{it.name}</span>
            <span className="num shrink-0 font-medium text-foreground">{fmtBRL(it.value, { compact: true })}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${(it.value / max) * 100}%`, background: PALETTE[i % PALETTE.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BalanceteCharts({ accounts, history, histLabel = "últimos 6 meses" }: Props) {
  const [show, setShow] = useState(true);
  const ativo = useMemo(() => topByGroup(accounts, "ativo"), [accounts]);
  const passivoPl = useMemo(
    () => [...topByGroup(accounts, "passivo"), ...topByGroup(accounts, "pl")],
    [accounts],
  );

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span className="text-[13.5px] font-semibold text-foreground">Gráficos e composição patrimonial</span>
        </div>
        <button
          onClick={() => setShow((s) => !s)}
          className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          {show ? "Ocultar" : "Mostrar"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${show ? "" : "-rotate-90"}`} />
        </button>
      </div>

      {show && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <div className="eyebrow mb-3">Composição do Ativo</div>
              <BarList items={ativo} />
            </div>
            <div>
              <div className="eyebrow mb-3">Passivo + Patrimônio Líquido</div>
              <BarList items={passivoPl} />
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2">Evolução patrimonial · {histLabel}</div>
            <div className="h-[260px]">
              {history.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[12.5px] text-muted-foreground">
                  Importe outros períodos para ver a evolução.
                </div>
              ) : (
                <ResponsiveContainer>
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="periodo" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmtBRL(v, { compact: true })} />
                    <Tooltip formatter={tooltipFmt} contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="ativo" name="Ativo" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="passivo" name="Passivo" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="pl" name="PL" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
