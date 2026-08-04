import { cn } from "@/lib/utils";
import { MESES_CURTO, contabil, exato, soma } from "./format";
import { Card } from "./ui";
import type { PlanoBP, SecaoBP } from "./useBpPlano";

type LinhaCurada = {
  /** Rótulo como está na planilha. */
  chave: string;
  /** Rótulo exibido, quando diferir do da planilha. */
  exibir?: string;
  depth: number;
  forte?: boolean;
};

const BALANCO: LinhaCurada[] = [
  { chave: "Ativo Total", depth: 0, forte: true },
  { chave: "Ativo Circulante", depth: 1 },
  { chave: "Caixa", depth: 2 },
  { chave: "Contas a Receber", depth: 2 },
  { chave: "Ativo Não Circulante", depth: 1 },
  { chave: "Imobilizado", exibir: "Imobilizado líquido", depth: 2 },
  { chave: "Passivo Total", depth: 0, forte: true },
  { chave: "Passivo Circulante", depth: 1 },
  { chave: "Passivo Não Circulante", depth: 1 },
  { chave: "Patrimônio Líquido", depth: 0, forte: true },
];

const DFC: LinhaCurada[] = [
  { chave: "Fluxo de Caixa Operacional", depth: 0, forte: true },
  { chave: "(+) Entradas", depth: 1 },
  { chave: "(-) Saídas", depth: 1 },
  { chave: "Fluxo de Caixa de Investimentos", depth: 0, forte: true },
  { chave: "(-) Compra de Equipamentos", depth: 1 },
  { chave: "(-) Investimentos em Estrutura", depth: 1 },
  { chave: "Recebimento de Juros", exibir: "(+) Recebimento de Juros", depth: 1 },
  { chave: "Fluxo de Financiamento", depth: 0, forte: true },
  { chave: "(-) Rodada de Investimentos", depth: 1 },
  { chave: "Fluxo de Caixa Livre", depth: 0, forte: true },
  { chave: "Saldo Final", exibir: "Saldo Final de Caixa", depth: 0, forte: true },
];

function Tabela({
  plano,
  secao,
  linhas,
  ano,
}: {
  plano: PlanoBP;
  secao: SecaoBP;
  linhas: LinhaCurada[];
  ano: number;
}) {
  // Linhas ausentes na planilha simplesmente não aparecem.
  const presentes = linhas
    .map((l) => ({ ...l, dados: plano.buscar(secao, l.chave) }))
    .filter((l) => l.dados);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-border bg-muted/40">
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left text-[10px] font-semibold tracking-[0.08em] text-muted-foreground w-[260px] min-w-[260px] shadow-[1px_0_0_0_hsl(var(--border))]">
              CONTA
            </th>
            {MESES_CURTO.map((m) => (
              <th
                key={m}
                className="px-2 py-2 text-right text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap min-w-[82px]"
              >
                {m}
              </th>
            ))}
            <th className="sticky right-0 z-10 bg-muted px-2 py-2 text-right text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap min-w-[100px] shadow-[-1px_0_0_0_hsl(var(--border))]">
              {secao === "balanco" ? "DEZ" : `TOTAL ${ano}`}
            </th>
          </tr>
        </thead>
        <tbody>
          {presentes.map((l) => {
            const meses = l.dados!.meses;
            // Balanço é posição (saldo de dezembro); DFC é fluxo (soma do ano).
            const fecho = secao === "balanco" ? meses[11] : soma(meses);
            return (
              <tr
                key={l.chave}
                className={cn(
                  "border-b border-border/60 last:border-0",
                  l.forte ? "bg-emerald-50/40 dark:bg-emerald-500/5 font-semibold" : "hover:bg-muted/30",
                )}
              >
                <td
                  className={cn(
                    "sticky left-0 z-[1] px-3 py-1.5 text-[12.5px] w-[260px] min-w-[260px] shadow-[1px_0_0_0_hsl(var(--border))]",
                    l.forte ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400" : "bg-card text-foreground/85",
                  )}
                  style={{ paddingLeft: 12 + l.depth * 16 }}
                >
                  {l.exibir ?? l.chave}
                </td>
                {meses.map((v, i) => (
                  <td
                    key={i}
                    title={exato(v)}
                    className={cn(
                      "px-2 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[82px]",
                      v != null && "cursor-help",
                      v == null
                        ? "text-muted-foreground/40"
                        : v < 0
                          ? "text-primary"
                          : l.forte
                            ? "text-emerald-800 dark:text-emerald-400"
                            : "text-foreground/90",
                    )}
                  >
                    {contabil(v)}
                  </td>
                ))}
                <td
                  title={exato(fecho)}
                  className={cn(
                    "sticky right-0 z-[1] px-2 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[100px] font-semibold shadow-[-1px_0_0_0_hsl(var(--border))]",
                    fecho != null && "cursor-help",
                    l.forte ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-card",
                    (fecho ?? 0) < 0
                      ? "text-primary"
                      : l.forte
                        ? "text-emerald-800 dark:text-emerald-400"
                        : "text-foreground",
                  )}
                >
                  {contabil(fecho)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function BalancoDfcTab({ plano, ano }: { plano: PlanoBP; ano: number }) {
  return (
    <div className="space-y-4">
      <Card titulo="Balanço Patrimonial projetado" legenda="aba Consolidado · R$">
        <Tabela plano={plano} secao="balanco" linhas={BALANCO} ano={ano} />
      </Card>
      <Card titulo="Demonstração do Fluxo de Caixa projetada" legenda="aba Consolidado · R$">
        <Tabela plano={plano} secao="dfc" linhas={DFC} ano={ano} />
      </Card>
      <p className="text-[11px] text-muted-foreground">
        No Balanço a última coluna é a posição de dezembro; na DFC é a soma do ano.
      </p>
    </div>
  );
}
