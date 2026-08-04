import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Area, Legend, Line,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList,
} from "recharts";
import { MESES_CURTO, TRIMESTRES, contabil, exato, inteiro, moeda, pct, soma } from "./format";
import { COR_CAIXA, COR_EBITDA, COR_NEGATIVO, COR_POSITIVO, COR_RECEITA } from "./cores";
import { CONTRATACOES, HEADCOUNT_POR_AREA } from "./plano2026";
import { Alerta, Card, FaixaKpis, Kpi, Td, Th } from "./ui";
import type { PlanoBP } from "./useBpPlano";
import { cn } from "@/lib/utils";

const RUBRICAS_TRIMESTRE = [
  { rotulo: "Receita bruta", chave: "Receita", forte: true },
  { rotulo: "Receita líquida", chave: "Receita Líquida" },
  { rotulo: "Custo operacional", chave: "Custo Operacional" },
  { rotulo: "SG&A", chave: "SG&A" },
  { rotulo: "EBITDA", chave: "EBITDA", forte: true },
  { rotulo: "Lucro líquido", chave: "Lucro Líquido", forte: true },
];

function TooltipBox({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5 shadow-md">
      <div className="text-[10.5px] font-semibold text-foreground">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="mt-0.5 flex items-center gap-1.5 text-[11px]">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color ?? p.fill }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto num font-semibold text-foreground">{moeda(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ResumoTab({ plano, ano }: { plano: PlanoBP; ano: number }) {
  const receita = plano.serie("dre", "Receita");
  const receitaLiq = plano.serie("dre", "Receita Líquida");
  const margem = plano.serie("dre", "Margem de contribuição");
  const ebitda = plano.serie("dre", "EBITDA");
  const lucro = plano.serie("dre", "Lucro Líquido");
  const custoOp = plano.serie("dre", "Custo Operacional");
  const pessoal = plano.serie("dre", "Pessoal");
  const despAdm = plano.serie("dre", "Despesas Administrativas");
  const mktVendas = plano.serie("dre", "Despesas Marketing & Vendas");
  const saldoCaixa = plano.serie("dfc", "Saldo Final");

  const totRecBruta = soma(receita);
  const totRecLiq = soma(receitaLiq);
  const totMargem = soma(margem);
  const totEbitda = soma(ebitda);
  const totLucro = soma(lucro);
  const caixaFim = [...saldoCaixa].reverse().find((v) => v != null) ?? null;

  const hcJan = Object.values(HEADCOUNT_POR_AREA).reduce((a, s) => a + s[0], 0);
  const hcDez = Object.values(HEADCOUNT_POR_AREA).reduce((a, s) => a + s[11], 0);
  const contratacoes = CONTRATACOES.reduce((a, b) => a + b, 0);

  const crescimento =
    receita[0] && receita[11] ? receita[11] / receita[0] - 1 : null;

  const dadosMensais = useMemo(
    () =>
      MESES_CURTO.map((m, i) => ({
        mes: m,
        receita: receita[i],
        ebitda: ebitda[i],
        caixa: saldoCaixa[i],
      })),
    [receita, ebitda, saldoCaixa],
  );

  /**
   * Ponte da receita líquida até o EBITDA.
   *
   * Cada barra é uma **faixa** [início, fim] em vez de base transparente +
   * altura empilhada: num stack o recharts acumula positivo pra cima e negativo
   * pra baixo em separado, então a barra do EBITDA (base negativa, altura
   * positiva) renderizaria invertida.
   */
  const cascata = useMemo(() => {
    const etapas = [
      { nome: "Receita\nlíquida", valor: totRecLiq ?? 0, total: true },
      { nome: "Custo\noperacional", valor: soma(custoOp) ?? 0, total: false },
      { nome: "Pessoal", valor: soma(pessoal) ?? 0, total: false },
      { nome: "Desp.\nadministrativas", valor: soma(despAdm) ?? 0, total: false },
      { nome: "Marketing\n& Vendas", valor: soma(mktVendas) ?? 0, total: false },
      { nome: "EBITDA", valor: totEbitda ?? 0, total: true },
    ];
    let acumulado = 0;
    return etapas.map((e) => {
      // Total ancora no zero e redefine o acumulado; delta flutua sobre o anterior.
      const inicio = e.total ? 0 : acumulado;
      const fim = e.total ? e.valor : acumulado + e.valor;
      acumulado = fim;
      return { ...e, faixa: [Math.min(inicio, fim), Math.max(inicio, fim)] as [number, number] };
    });
  }, [totRecLiq, custoOp, pessoal, despAdm, mktVendas, totEbitda]);

  const trimestres = useMemo(
    () =>
      RUBRICAS_TRIMESTRE.map((r) => {
        const serie = plano.serie("dre", r.chave);
        const porTri = [0, 1, 2, 3].map((t) => soma(serie.slice(t * 3, t * 3 + 3)));
        return { ...r, porTri, ano: soma(serie) };
      }),
    [plano],
  );

  const mesFunding = useMemo(() => {
    const idx = saldoCaixa.findIndex((v) => v != null && v <= -2_100_000);
    return idx >= 0 ? MESES_CURTO[idx] : null;
  }, [saldoCaixa]);

  const picoContratacao = CONTRATACOES.indexOf(Math.max(...CONTRATACOES));

  return (
    <div className="space-y-4">
      <FaixaKpis>
        <Kpi
          titulo="RECEITA BRUTA"
          valor={moeda(totRecBruta)}
          title={exato(totRecBruta)}
          nota={crescimento != null ? `${pct(crescimento, 0)} jan → dez` : undefined}
        />
        <Kpi
          titulo="MARGEM DE CONTRIBUIÇÃO"
          valor={moeda(totMargem)}
          title={exato(totMargem)}
          tom="positivo"
          nota={totRecLiq ? `${pct((totMargem ?? 0) / totRecLiq, 0)} da receita líquida` : undefined}
        />
        <Kpi
          titulo="EBITDA"
          valor={moeda(totEbitda)}
          title={exato(totEbitda)}
          tom={(totEbitda ?? 0) < 0 ? "negativo" : "positivo"}
          nota={totRecLiq ? `margem ${pct((totEbitda ?? 0) / totRecLiq, 0)}` : undefined}
        />
        <Kpi
          titulo="LUCRO LÍQUIDO"
          valor={moeda(totLucro)}
          title={exato(totLucro)}
          tom={(totLucro ?? 0) < 0 ? "negativo" : "positivo"}
          nota={(totLucro ?? 0) < 0 ? `prejuízo fiscal em ${ano}` : `lucro no ano`}
        />
        <Kpi
          titulo={`CAIXA FIM DE ${ano}`}
          valor={moeda(caixaFim)}
          title={exato(caixaFim)}
          tom={(caixaFim ?? 0) < 0 ? "negativo" : "positivo"}
          nota={(caixaFim ?? 0) < 0 ? "queima acumulada no ano" : "saldo projetado"}
        />
        <Kpi
          titulo="HEADCOUNT"
          valor={`${inteiro(hcJan)} → ${inteiro(hcDez)}`}
          nota={`${contratacoes} contratações no ano`}
        />
      </FaixaKpis>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card titulo={`Receita bruta × EBITDA`} legenda="mensal · eixo único em R$">
          <div className="h-[240px] px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dadosMensais} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v) => contabil(v)}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Tooltip content={<TooltipBox />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                <Bar dataKey="receita" name="Receita bruta" fill={COR_RECEITA} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Line dataKey="ebitda" name="EBITDA" stroke={COR_EBITDA} strokeWidth={2} dot={{ r: 2.5 }} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card titulo="Curva de caixa acumulada" legenda="saldo final do mês">
          <div className="h-[240px] px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dadosMensais} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v) => contabil(v)}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Tooltip content={<TooltipBox />} />
                <Area
                  dataKey="caixa"
                  name="Saldo de caixa"
                  stroke={COR_CAIXA}
                  strokeWidth={2}
                  fill={COR_CAIXA}
                  fillOpacity={0.1}
                  type="monotone"
                  dot={{ r: 2.5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card
        titulo="O que consome a margem — Receita líquida → EBITDA"
        legenda={`acumulado ${ano} · R$`}
      >
        <div className="h-[260px] px-2 pb-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cascata} margin={{ top: 24, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="nome"
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                tickLine={false}
                axisLine={false}
                interval={0}
                height={40}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v) => contabil(v)}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="faixa" radius={4} maxBarSize={54}>
                {cascata.map((e, i) => (
                  <Cell key={i} fill={e.valor < 0 ? COR_NEGATIVO : COR_POSITIVO} fillOpacity={e.total ? 1 : 0.75} />
                ))}
                <LabelList
                  dataKey="valor"
                  position="top"
                  offset={8}
                  formatter={(v: number) => contabil(v)}
                  style={{ fontSize: 11, fontWeight: 600, fill: "hsl(var(--foreground))" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Alerta tom="critico" titulo={`Breakeven não ocorre em ${ano}`}>
          O EBITDA sai de {contabil(ebitda[0])} em janeiro para {contabil(ebitda[11])} em dezembro.
          {(ebitda[11] ?? 0) < 0
            ? " Mantido esse ritmo de melhora, o cruzamento do zero fica para depois do fim do plano."
            : " O plano cruza o zero dentro do ano, no último trimestre."}
        </Alerta>
        <Alerta tom="atencao" titulo={`Necessidade de caixa de ${moeda(Math.abs(caixaFim ?? 0))}`}>
          O plano parte de saldo zero. Pela curva projetada, o funding precisa estar disponível
          {mesFunding ? ` até ${mesFunding.toLowerCase()}` : " ao longo do ano"}, quando o acumulado
          passa de R$ 2,1 M.
        </Alerta>
        <Alerta tom="info" titulo={`${MESES_CURTO[picoContratacao]} concentra ${pct(CONTRATACOES[picoContratacao] / contratacoes, 0)} das contratações`}>
          {CONTRATACOES[picoContratacao]} das {contratacoes} entradas do ano caem em{" "}
          {MESES_CURTO[picoContratacao].toLowerCase()} — mais kit de onboarding e um degrau
          permanente na folha.
        </Alerta>
      </div>

      <Card titulo="Resumo por trimestre">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-border bg-muted/40">
                <Th alinhar="left" className="pl-4 min-w-[180px]">RUBRICA</Th>
                {TRIMESTRES.map((t) => <Th key={t}>{t}</Th>)}
                <Th className="pr-4">ANO</Th>
              </tr>
            </thead>
            <tbody>
              {trimestres.map((r) => (
                <tr key={r.rotulo} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <Td alinhar="left" className={cn("pl-4", r.forte && "font-semibold text-foreground")}>
                    {r.rotulo}
                  </Td>
                  {r.porTri.map((v, i) => (
                    <Td key={i} title={exato(v)} className={cn("cursor-help", (v ?? 0) < 0 ? "text-primary" : "text-foreground/90")}>
                      {contabil(v)}
                    </Td>
                  ))}
                  <Td title={exato(r.ano)} className={cn("pr-4 font-semibold cursor-help", (r.ano ?? 0) < 0 ? "text-primary" : "text-foreground")}>
                    {contabil(r.ano)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
