import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { fmtBRL } from "./utils";
import type { BalanceteAccount } from "./types";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--pos))",
  "hsl(var(--neg))",
  "hsl(var(--warn))",
  "hsl(var(--accent))",
  "hsl(var(--muted-foreground))",
];

interface Props {
  accounts: BalanceteAccount[];
  history: { periodo: string; ativo: number; passivo: number; pl: number }[];
}

function topByGroup(accounts: BalanceteAccount[], group: string, level = 2, limit = 6) {
  return accounts
    .filter((a) => a.group === group && a.level === level)
    .map((a) => ({ name: a.name, value: Math.abs(a.saldo_atual) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

const tooltipFmt = (v: any) => fmtBRL(Number(v));

export function BalanceteCharts({ accounts, history }: Props) {
  const ativo = useMemo(() => topByGroup(accounts, "ativo"), [accounts]);
  const passivoPl = useMemo(
    () => [...topByGroup(accounts, "passivo"), ...topByGroup(accounts, "pl")],
    [accounts],
  );
  const despesas = useMemo(() => topByGroup(accounts, "despesa", 2, 8), [accounts]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="card-surface p-4">
        <div className="eyebrow mb-2">Composição do Ativo</div>
        <div className="h-[240px]">
          {ativo.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer>
              <PieChart>
                <Pie data={ativo} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} strokeWidth={1}>
                  {ativo.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={tooltipFmt} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card-surface p-4">
        <div className="eyebrow mb-2">Passivo + Patrimônio Líquido</div>
        <div className="h-[240px]">
          {passivoPl.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer>
              <PieChart>
                <Pie data={passivoPl} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} strokeWidth={1}>
                  {passivoPl.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={tooltipFmt} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card-surface p-4 lg:col-span-2">
        <div className="eyebrow mb-2">Evolução patrimonial (últimos meses)</div>
        <div className="h-[260px]">
          {history.length === 0 ? (
            <Empty msg="Importe outros meses para ver a evolução." />
          ) : (
            <ResponsiveContainer>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="periodo" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmtBRL(v, { compact: true })} />
                <Tooltip formatter={tooltipFmt} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="ativo" name="Ativo" stroke={COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="passivo" name="Passivo" stroke={COLORS[2]} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="pl" name="PL" stroke={COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card-surface p-4 lg:col-span-2">
        <div className="eyebrow mb-2">Distribuição de despesas / obrigações</div>
        <div className="h-[260px]">
          {despesas.length === 0 ? (
            <Empty msg="Nenhuma despesa identificada neste período." />
          ) : (
            <ResponsiveContainer>
              <BarChart data={despesas} layout="vertical" margin={{ left: 16, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmtBRL(v, { compact: true })} />
                <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip formatter={tooltipFmt} contentStyle={tooltipStyle} />
                <Bar dataKey="value" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

function Empty({ msg = "Sem dados para exibir." }: { msg?: string }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
      {msg}
    </div>
  );
}
