import { Fragment, useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { MESES_CURTO, compacto, contabil, exato, inteiro, moeda, pct, reais, soma } from "./format";
import { coresArea, useTemaEscuro } from "./cores";
import {
  AREAS, AREAS_SEM_QUADRO, BENEFICIO_POR_PESSOA, CONTRATACOES, CUSTO_KIT_ONBOARDING,
  HEADCOUNT_POR_AREA, LINHA_DE_CUSTO, QUADRO, type Area,
} from "./plano2026";
import { Barra, Card, FaixaKpis, Kpi, Ressalva, Td, Th } from "./ui";
import type { PlanoBP } from "./useBpPlano";

const ROTULO_REAJUSTE: Record<string, string> = {
  diretoria: "diretoria",
  key: "key",
  base: "base",
};

/** Linha do quadro na tela — vem da aba Equipe ou, sem ela, da constante. */
type LinhaQuadro = {
  id: string;
  area: Area;
  grupo: string;
  cargo: string;
  remBase: number | null;
  modelo: string;
  reajuste: string;
  entrada: number | null;
  qtdJan: number;
  qtdDez: number;
  /** Só existe com a aba Equipe importada. */
  custoAno: number | null;
};

function TooltipHc({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a: number, p: any) => a + (p.value ?? 0), 0);
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5 shadow-md">
      <div className="text-[10.5px] font-semibold text-foreground">{label}</div>
      {[...payload].reverse().map((p: any) => (
        <div key={p.dataKey} className="mt-0.5 flex items-center gap-1.5 text-[11px]">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: p.fill }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto num font-semibold text-foreground">{p.value}</span>
        </div>
      ))}
      <div className="mt-1 border-t border-border pt-1 flex text-[11px]">
        <span className="text-muted-foreground">Total</span>
        <span className="ml-auto num font-semibold text-foreground">{total}</span>
      </div>
    </div>
  );
}

export default function EquipeTab({ plano, ano }: { plano: PlanoBP; ano: number }) {
  const escuro = useTemaEscuro();
  const cores = coresArea(escuro);
  const equipe = plano.equipe;

  // Com a aba Equipe importada tudo vem da planilha; sem ela, das constantes.
  const headcountPorArea = equipe?.headcountPorArea ?? HEADCOUNT_POR_AREA;
  const porMes = equipe?.contratacoes ?? CONTRATACOES;
  const kitOnboarding = equipe?.custoKitOnboarding ?? CUSTO_KIT_ONBOARDING;
  const beneficio = equipe?.beneficioPorPessoa ?? BENEFICIO_POR_PESSOA;

  const totalMes = useMemo(
    () =>
      equipe?.headcountGeral ??
      MESES_CURTO.map((_, i) => AREAS.reduce((a, ar) => a + headcountPorArea[ar][i], 0)),
    [equipe, headcountPorArea],
  );
  const hcJan = totalMes[0];
  const hcDez = totalMes[11];
  const contratacoes = porMes.reduce((a, b) => a + b, 0);
  const picoMes = porMes.indexOf(Math.max(...porMes));

  const custoPessoal = soma(plano.serie("dre", "Pessoal"));
  const receitaBruta = soma(plano.serie("dre", "Receita"));
  const quadroMedio = totalMes.reduce((a, b) => a + b, 0) / 12;
  const custoMedioPessoa = custoPessoal != null ? Math.abs(custoPessoal) / 12 / quadroMedio : null;
  const receitaPorColaborador = receitaBruta != null ? receitaBruta / quadroMedio : null;

  const dadosHc = useMemo(
    () =>
      MESES_CURTO.map((m, i) => {
        const linha: Record<string, number | string> = { mes: m };
        AREAS.forEach((a) => { linha[a] = headcountPorArea[a][i]; });
        linha.total = AREAS.reduce((acc, a) => acc + headcountPorArea[a][i], 0);
        return linha;
      }),
    [headcountPorArea],
  );

  /** Custo por time: headcount por área × custo real da DRE do plano. */
  const custoPorTime = useMemo(() => {
    const linhas = AREAS.map((area) => {
      const serie = plano.serie("dre", LINHA_DE_CUSTO[area]);
      return {
        area,
        hcJan: headcountPorArea[area][0],
        hcDez: headcountPorArea[area][11],
        custoJan: serie[0],
        custoDez: serie[11],
        total: soma(serie),
      };
    });
    const somaTotal = linhas.reduce((a, l) => a + Math.abs(l.total ?? 0), 0);
    return linhas
      .map((l) => ({ ...l, participacao: somaTotal ? Math.abs(l.total ?? 0) / somaTotal : 0 }))
      .sort((a, b) => Math.abs(b.total ?? 0) - Math.abs(a.total ?? 0));
  }, [plano, headcountPorArea]);

  /** Quadro agrupado por área — a constante não tem custo por cargo, a planilha tem. */
  const quadro: LinhaQuadro[] = useMemo(
    () =>
      equipe
        ? equipe.quadro
        : QUADRO.map((c, i) => ({ ...c, id: `const-${i}`, custoAno: null })),
    [equipe],
  );

  const porArea = useMemo(() => {
    const mapa = new Map<Area, LinhaQuadro[]>();
    quadro.forEach((c) => {
      if (!mapa.has(c.area)) mapa.set(c.area, []);
      mapa.get(c.area)!.push(c);
    });
    return AREAS.filter((a) => mapa.has(a)).map((a) => ({
      area: a,
      cargos: mapa.get(a)!,
      qtdJan: mapa.get(a)!.reduce((acc, c) => acc + c.qtdJan, 0),
      qtdDez: mapa.get(a)!.reduce((acc, c) => acc + c.qtdDez, 0),
      custoAno: soma(mapa.get(a)!.map((c) => c.custoAno)),
    }));
  }, [quadro]);

  const pessoasDez = quadro.reduce((a, c) => a + c.qtdDez, 0);

  return (
    <div className="space-y-4">
      <FaixaKpis colunas={5}>
        <Kpi titulo="HEADCOUNT EM DEZ" valor={inteiro(hcDez)} nota={`${inteiro(hcJan)} em janeiro`} />
        <Kpi
          titulo="CONTRATAÇÕES NO ANO"
          valor={inteiro(contratacoes)}
          nota={`pico de ${CONTRATACOES[picoMes]} em ${MESES_CURTO[picoMes].toLowerCase()}`}
        />
        <Kpi
          titulo="CUSTO DE PESSOAL"
          valor={moeda(custoPessoal)}
          title={exato(custoPessoal)}
          tom="negativo"
          nota={receitaBruta ? `${pct(Math.abs(custoPessoal ?? 0) / receitaBruta, 0)} da receita bruta` : undefined}
        />
        <Kpi
          titulo="CUSTO MÉDIO / PESSOA"
          valor={reais(custoMedioPessoa)}
          nota="média mensal do quadro"
        />
        <Kpi
          titulo="RECEITA POR COLABORADOR"
          valor={reais(receitaPorColaborador)}
          tom="positivo"
          nota={`no ano, quadro médio de ${inteiro(quadroMedio)}`}
        />
      </FaixaKpis>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card titulo="Headcount por área" legenda={`${hcJan} em jan → ${hcDez} em dez`}>
          <div className="h-[280px] px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dadosHc} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={34} />
                <Tooltip content={<TooltipHc />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                {AREAS.map((a, i) => (
                  <Bar
                    key={a}
                    dataKey={a}
                    name={a}
                    stackId="hc"
                    fill={cores[a]}
                    maxBarSize={26}
                    /* 2px de respiro entre segmentos — encoding secundário do stack */
                    stroke="hsl(var(--card))"
                    strokeWidth={1}
                    radius={i === AREAS.length - 1 ? [4, 4, 0, 0] : undefined}
                  >
                    {i === AREAS.length - 1 && (
                      <LabelList
                        dataKey="total"
                        position="top"
                        offset={6}
                        style={{ fontSize: 10, fontWeight: 600, fill: "hsl(var(--foreground))" }}
                      />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          titulo="Plano de contratações"
          legenda={`${contratacoes} no ano · ${MESES_CURTO[picoMes].toLowerCase()} concentra ${porMes[picoMes]}`}
        >
          <div className="grid grid-cols-3 gap-2 px-4 pb-3">
            {porMes.map((n, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md border p-2.5 text-center",
                  n === 0 && "border-border bg-muted/40",
                  n > 0 && n < 10 && "border-border bg-card",
                  n >= 10 && "border-primary/40 bg-primary/5",
                )}
              >
                <div className="text-[9.5px] font-semibold tracking-[0.06em] text-muted-foreground">
                  {MESES_CURTO[i]}
                </div>
                <div
                  className={cn(
                    "mt-0.5 text-[17px] font-bold num",
                    n === 0 ? "text-muted-foreground/50" : n >= 10 ? "text-primary" : "text-foreground",
                  )}
                >
                  {n}
                </div>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Cada contratação carrega {reais(kitOnboarding)} de kit de onboarding e{" "}
            {reais(beneficio)}/mês de benefícios — {MESES_CURTO[picoMes].toLowerCase()} custa{" "}
            <span className="font-semibold text-foreground">
              {compacto(porMes[picoMes] * kitOnboarding)}
            </span>{" "}
            só de kit.
          </p>
        </Card>
      </div>

      <Card titulo="Custo por time" legenda="custo real do plano · headcount do quadro">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-border bg-muted/40">
                <Th alinhar="left" className="pl-4 min-w-[160px]">TIME</Th>
                <Th>HC JAN</Th>
                <Th>HC DEZ</Th>
                <Th>CUSTO JAN</Th>
                <Th>CUSTO DEZ</Th>
                <Th>TOTAL {ano}</Th>
                <Th alinhar="left" className="pl-6 min-w-[200px]">% DO CUSTO DE PESSOAL</Th>
              </tr>
            </thead>
            <tbody>
              {custoPorTime.map((l) => (
                <tr key={l.area} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <Td alinhar="left" className="pl-4">
                    <span className="inline-flex items-center gap-2 text-foreground">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: cores[l.area] }} />
                      {l.area}
                    </span>
                  </Td>
                  <Td>{inteiro(l.hcJan)}</Td>
                  <Td>{inteiro(l.hcDez)}</Td>
                  <Td title={exato(l.custoJan)} className="cursor-help text-primary">{contabil(l.custoJan)}</Td>
                  <Td title={exato(l.custoDez)} className="cursor-help text-primary">{contabil(l.custoDez)}</Td>
                  <Td title={exato(l.total)} className="cursor-help font-semibold text-primary">{contabil(l.total)}</Td>
                  <Td alinhar="left" className="pl-6">
                    <div className="flex items-center gap-2">
                      <Barra valor={l.participacao} className="bg-foreground/70" />
                      <span className="num text-[11.5px] text-muted-foreground">{pct(l.participacao)}</span>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Ressalva>
          {equipe ? (
            <>
              Custos vêm das linhas de equipe da DRE do plano e o headcount por área vem do bloco
              "Headcount Equipes" da aba Equipe — as duas pontas da mesma planilha ({hcJan} → {hcDez}
              ).
            </>
          ) : (
            <>
              Custos vêm das linhas de equipe da DRE do plano; o headcount vem do quadro. O recorte
              por área de Comercial, Operacional, Onboarding e Tecnologia ainda é estimado — só os
              totais mensais ({hcJan} → {hcDez}) são do plano.
            </>
          )}
        </Ressalva>
      </Card>

      <Card
        titulo="Quadro detalhado por cargo"
        legenda={`${quadro.length} cargos · ${pessoasDez} pessoas em dez · remuneração base, modelo, reajuste e mês de entrada`}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-border bg-muted/40">
                <Th alinhar="left" className="pl-4 min-w-[220px]">CARGO</Th>
                <Th alinhar="left" className="min-w-[130px]">GRUPO</Th>
                <Th>REM. BASE</Th>
                <Th alinhar="left" className="pl-6">MODELO</Th>
                <Th alinhar="left">REAJUSTE</Th>
                <Th alinhar="left">ENTRADA</Th>
                <Th>QTD JAN</Th>
                <Th>QTD DEZ</Th>
                <Th className="pr-4">CUSTO {ano}</Th>
              </tr>
            </thead>
            <tbody>
              {porArea.map((bloco) => (
                <Fragment key={bloco.area}>
                  <tr className="bg-muted/25 border-y border-border/60">
                    <td colSpan={6} className="px-4 py-1.5 text-[12px] font-semibold text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-[3px]"
                          style={{ background: cores[bloco.area] }}
                        />
                        {bloco.area}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-[11.5px] num text-muted-foreground">
                      {bloco.qtdJan}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[11.5px] num text-muted-foreground">
                      {bloco.qtdDez}
                    </td>
                    <td
                      className="px-2 pr-4 py-1.5 text-right text-[11.5px] num text-muted-foreground"
                      title={exato(bloco.custoAno)}
                    >
                      {bloco.custoAno == null ? "" : contabil(-bloco.custoAno)}
                    </td>
                  </tr>
                  {bloco.cargos.map((c) => (
                    <tr key={c.id} className="border-b border-border/60 hover:bg-muted/30">
                      <Td alinhar="left" className="pl-4 text-foreground">{c.cargo}</Td>
                      <Td alinhar="left" className="text-muted-foreground">{c.grupo}</Td>
                      <Td className={cn(c.remBase == null && "text-muted-foreground/50")}>
                        {c.remBase == null ? "—" : reais(c.remBase)}
                      </Td>
                      <Td alinhar="left" className="pl-6">
                        <span className="inline-flex items-center rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {c.modelo}
                        </span>
                      </Td>
                      <Td alinhar="left">
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                            c.reajuste === "diretoria" && "bg-primary/10 text-primary",
                            c.reajuste === "key" && "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
                            c.reajuste === "base" && "bg-muted text-muted-foreground",
                          )}
                        >
                          {ROTULO_REAJUSTE[c.reajuste]}
                        </span>
                      </Td>
                      <Td alinhar="left" className={cn(c.entrada == null ? "text-muted-foreground/50" : "text-foreground/85")}>
                        {c.entrada == null
                          ? "—"
                          : MESES_CURTO[c.entrada].charAt(0) + MESES_CURTO[c.entrada].slice(1).toLowerCase()}
                      </Td>
                      <Td>{c.qtdJan}</Td>
                      <Td className={cn(c.qtdDez > c.qtdJan && "text-emerald-600 font-semibold")}>
                        {c.qtdDez}
                      </Td>
                      <Td
                        title={exato(c.custoAno)}
                        className={cn("pr-4", c.custoAno ? "cursor-help text-primary" : "text-muted-foreground/50")}
                      >
                        {c.custoAno == null ? "—" : contabil(-c.custoAno)}
                      </Td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <Ressalva>
          {equipe ? (
            <>
              Direto da aba Equipe da planilha: cargo com quantidade fixa entra no mês da coluna
              "Início", cargo "var." segue a linha "# Quantidade" e cargo zerado no ano (rem. base
              "—") é vaga prevista que o plano não abre. O custo aqui é o da folha-base — a linha da
              DRE fecha acima porque carrega, de julho em diante, os adicionais da revisão (reforço
              comercial e adicional de tecnologia).
            </>
          ) : (
            <>
              Este BP foi importado antes da leitura da aba Equipe, então o quadro cobre só
              Executivos, Backoffice e Marketing ({pessoasDez} pessoas em dez) e faltam{" "}
              {AREAS_SEM_QUADRO.join(", ")}. Reimporte a planilha para trazer o quadro completo.
            </>
          )}
        </Ressalva>
      </Card>
    </div>
  );
}
