import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { MESES_CURTO, compacto, exato, inteiro, pct, reais } from "./format";
import {
  BASE_INICIAL, CAC_TOTAL, CANAIS, FUNIL, MARGEM_CONTRIBUICAO_LTV, PORTES, TICKET_MEDIO,
} from "./plano2026";
import { Barra, Card, FaixaKpis, Kpi, Ressalva, Td, Th } from "./ui";

/** CAC saudável abaixo de R$ 500; acima de R$ 2 mil pede revisão do canal. */
function tomCac(cac: number): string {
  if (cac <= 500) return "text-emerald-600";
  if (cac >= 2_000) return "text-primary";
  return "text-foreground";
}

function tomLtvCac(r: number): string {
  if (r < 3) return "text-primary";
  if (r < 5) return "text-amber-600";
  return "text-emerald-600";
}

export default function OperacaoTab({ ano }: { ano: number }) {
  const totalNovas = FUNIL.novasContas.reduce((a, b) => a + b, 0);
  const totalPerdidas = FUNIL.contasPerdidas.reduce((a, b) => a + b, 0);
  const clientesDez = FUNIL.baseFimMes[11];
  const investimentoTotal = CANAIS.reduce((a, c) => a + c.investimento, 0);
  const clientesCanais = CANAIS.reduce((a, c) => a + c.clientes, 0);
  const cacMedia = investimentoTotal / clientesCanais;

  const churnMedio = useMemo(() => {
    const taxas = FUNIL.contasPerdidas.map((p, i) => {
      const baseInicio = i === 0 ? BASE_INICIAL : FUNIL.baseFimMes[i - 1];
      return baseInicio ? p / baseInicio : 0;
    });
    return taxas.reduce((a, b) => a + b, 0) / taxas.length;
  }, []);

  const canais = useMemo(
    () =>
      [...CANAIS]
        .map((c) => ({
          ...c,
          cac: c.investimento / c.clientes,
          participacao: c.clientes / clientesCanais,
        }))
        .sort((a, b) => b.investimento - a.investimento),
    [clientesCanais],
  );

  const portes = useMemo(
    () =>
      PORTES.map((p) => {
        const ltv = (p.ticket * MARGEM_CONTRIBUICAO_LTV) / p.churn;
        return {
          ...p,
          ltv,
          ltvCac: ltv / CAC_TOTAL,
          payback: CAC_TOTAL / (p.ticket * MARGEM_CONTRIBUICAO_LTV),
        };
      }),
    [],
  );

  const linhasFunil = useMemo(() => {
    const conversao = FUNIL.novasContas.map((n, i) => (FUNIL.leads[i] ? n / FUNIL.leads[i] : null));
    const churn = FUNIL.contasPerdidas.map((p, i) => {
      const baseInicio = i === 0 ? BASE_INICIAL : FUNIL.baseFimMes[i - 1];
      return baseInicio ? p / baseInicio : null;
    });
    return [
      { rotulo: "Leads gerados", valores: FUNIL.leads, fmt: inteiro },
      { rotulo: "Novas contas", valores: FUNIL.novasContas, fmt: inteiro, forte: true, tom: "text-emerald-600" },
      { rotulo: "Contas perdidas", valores: FUNIL.contasPerdidas.map((v) => -v), fmt: inteiro, tom: "text-primary" },
      { rotulo: "Base ao fim do mês", valores: FUNIL.baseFimMes, fmt: inteiro, forte: true },
      { rotulo: "Novo MRR", valores: FUNIL.novoMrr, fmt: compacto, tom: "text-emerald-600" },
      { rotulo: "Conversão lead → conta", valores: conversao, fmt: (v: number) => pct(v) },
      { rotulo: "Churn de base", valores: churn, fmt: (v: number) => pct(v) },
    ];
  }, []);

  return (
    <div className="space-y-4">
      <FaixaKpis>
        <Kpi
          titulo="CLIENTES EM DEZ"
          valor={inteiro(clientesDez)}
          nota={`de ${inteiro(BASE_INICIAL)} em janeiro · ${pct(clientesDez / BASE_INICIAL - 1, 0)}`}
        />
        <Kpi
          titulo="NOVAS CONTAS"
          valor={inteiro(totalNovas)}
          tom="positivo"
          nota={`média de ${inteiro(totalNovas / 12)}/mês`}
        />
        <Kpi
          titulo="CONTAS PERDIDAS"
          valor={inteiro(totalPerdidas)}
          tom="negativo"
          nota={`churn médio de ${pct(churnMedio)} a.m.`}
        />
        <Kpi titulo="CAC MÉDIA" valor={reais(cacMedia)} nota="só investimento de canal" />
        <Kpi titulo="CAC TOTAL" valor={reais(CAC_TOTAL)} tom="negativo" nota="com comissão comercial" />
        <Kpi
          titulo="TICKET MÉDIO"
          valor={reais(TICKET_MEDIO.fim)}
          nota={`${reais(TICKET_MEDIO.inicio)} → ${reais(TICKET_MEDIO.fim)}`}
        />
      </FaixaKpis>

      <Card
        titulo={`Aquisição por canal — ${ano}`}
        legenda="investimento, clientes gerados e CAC do canal"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-border bg-muted/40">
                <Th alinhar="left" className="pl-4 min-w-[240px]">CANAL</Th>
                <Th>INVESTIMENTO</Th>
                <Th>CLIENTES</Th>
                <Th>CAC CANAL</Th>
                <Th alinhar="left" className="pl-6 min-w-[220px]">PARTICIPAÇÃO NAS NOVAS CONTAS</Th>
              </tr>
            </thead>
            <tbody>
              {canais.map((c) => (
                <tr key={c.canal} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <Td alinhar="left" className="pl-4 text-foreground">{c.canal}</Td>
                  <Td title={exato(c.investimento)} className="cursor-help">{compacto(c.investimento)}</Td>
                  <Td>{inteiro(c.clientes)}</Td>
                  <Td className={cn("font-semibold", tomCac(c.cac))}>{reais(c.cac)}</Td>
                  <Td alinhar="left" className="pl-6">
                    <div className="flex items-center gap-2">
                      <Barra valor={c.participacao} />
                      <span className="num text-[11.5px] text-muted-foreground">{pct(c.participacao)}</span>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        titulo="Unit economics por porte de cliente"
        legenda={`LTV = ticket × margem de contribuição ÷ churn · CAC total = ${reais(CAC_TOTAL)}`}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-border bg-muted/40">
                <Th alinhar="left" className="pl-4 min-w-[160px]">PORTE</Th>
                <Th>CLIENTES DEZ</Th>
                <Th>MRR DEZ</Th>
                <Th>TICKET</Th>
                <Th>CHURN</Th>
                <Th>LTV</Th>
                <Th>LTV / CAC</Th>
                <Th className="pr-4">PAYBACK</Th>
              </tr>
            </thead>
            <tbody>
              {portes.map((p) => (
                <tr key={p.porte} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <Td alinhar="left" className="pl-4 font-semibold text-foreground">{p.porte}</Td>
                  <Td>{inteiro(p.clientesDez)}</Td>
                  <Td title={exato(p.mrrDez)} className="cursor-help">{compacto(p.mrrDez)}</Td>
                  <Td>{reais(p.ticket)}</Td>
                  <Td>{pct(p.churn)}</Td>
                  <Td>{reais(p.ltv)}</Td>
                  <Td className={cn("font-semibold", tomLtvCac(p.ltvCac))}>
                    {p.ltvCac.toFixed(1).replace(".", ",")}×
                  </Td>
                  <Td className="pr-4">{p.payback.toFixed(1).replace(".", ",")} meses</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card titulo="Funil e base de clientes — mês a mês">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-border bg-muted/40">
                <Th alinhar="left" className="sticky left-0 z-10 bg-muted pl-4 min-w-[200px] shadow-[1px_0_0_0_hsl(var(--border))]">
                  INDICADOR
                </Th>
                {MESES_CURTO.map((m) => <Th key={m} className="min-w-[72px]">{m}</Th>)}
              </tr>
            </thead>
            <tbody>
              {linhasFunil.map((l) => (
                <tr key={l.rotulo} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <Td
                    alinhar="left"
                    className={cn(
                      "sticky left-0 z-[1] bg-card pl-4 shadow-[1px_0_0_0_hsl(var(--border))]",
                      l.forte ? "font-semibold text-foreground" : "text-foreground/85",
                    )}
                  >
                    {l.rotulo}
                  </Td>
                  {l.valores.map((v, i) => (
                    <td
                      key={i}
                      className={cn(
                        "px-2 py-1.5 text-right text-[12px] num whitespace-nowrap",
                        l.tom ?? "text-foreground/90",
                        l.forte && "font-semibold",
                      )}
                    >
                      {v == null ? "—" : (l.fmt as (n: number) => string)(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Ressalva>
          Dezembro foi reconstruído a partir dos totais do ano — a coluna estava cortada na planilha
          de origem. Conversão e churn são calculados sobre leads e base do mês anterior.
        </Ressalva>
      </Card>
    </div>
  );
}
