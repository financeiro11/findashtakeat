import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { compacto, pct, reais } from "./format";
import {
  GATILHOS, INDICES_REAJUSTE, MODELOS_CONTRATACAO, MUDANCAS_REVISAO, REGIME_TRIBUTARIO,
  VERSAO_VIGENTE,
} from "./plano2026";
import { Card, Td, Th } from "./ui";

export default function PremissasTab({ ano }: { ano: number }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card titulo="Modelos de contratação">
          <div className="space-y-2 px-4 pb-3">
            {MODELOS_CONTRATACAO.map((m) => (
              <div
                key={m.modelo}
                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
              >
                <span className="text-[12.5px] text-foreground">{m.modelo}</span>
                <span className="num text-[12.5px] font-semibold text-foreground">
                  {m.multiplicador.toFixed(2).replace(".", ",")}×
                </span>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Multiplicador aplicado sobre a remuneração base para chegar no custo total. Hoje 100% do
            quadro do BP é PJ.
          </p>
        </Card>

        <Card titulo="Índices de reajuste real">
          <div className="space-y-2 px-4 pb-3">
            {INDICES_REAJUSTE.map((r) => (
              <div
                key={r.grupo}
                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
              >
                <span className="text-[12.5px] text-foreground">{r.grupo}</span>
                <span className="num text-[12.5px] font-semibold text-primary">{pct(r.indice)}</span>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Aplicados na virada de cada ano de projeção. Em {ano} os índices ainda não incidem (ano 1).
          </p>
        </Card>

        <Card
          titulo="Regime tributário"
          legenda={
            <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {REGIME_TRIBUTARIO.regime}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2 px-4 pb-3">
            {REGIME_TRIBUTARIO.tributos.map((t) => (
              <div key={t.sigla} className="rounded-md border border-border px-2.5 py-2">
                <div className="text-[9.5px] font-semibold tracking-[0.06em] text-muted-foreground">
                  {t.sigla}
                </div>
                <div className="mt-0.5 num text-[13px] font-semibold text-foreground">{t.valor}</div>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {REGIME_TRIBUTARIO.nota}
          </p>
        </Card>
      </div>

      <Card
        titulo="Gatilhos de custo — o que faz cada linha crescer"
        legenda="aba Geral + Operação do BP"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-border bg-muted/40">
                <Th alinhar="left" className="pl-4 min-w-[220px]">RUBRICA</Th>
                <Th alinhar="left" className="min-w-[140px]">INDEXADOR</Th>
                <Th>REGRA</Th>
                <Th>MÍN. FIXO</Th>
                <Th className="pr-4">TETO</Th>
              </tr>
            </thead>
            <tbody>
              {GATILHOS.map((g) => (
                <tr key={g.rubrica} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <Td alinhar="left" className="pl-4 text-foreground">{g.rubrica}</Td>
                  <Td alinhar="left">
                    <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
                      {g.indexador}
                    </span>
                  </Td>
                  <Td className="font-semibold text-foreground">{g.regra}</Td>
                  <Td className={cn(g.minimoFixo == null ? "text-muted-foreground/50" : "text-muted-foreground")}>
                    {g.minimoFixo == null ? "—" : reais(g.minimoFixo)}
                  </Td>
                  <Td className={cn("pr-4", g.teto == null ? "text-muted-foreground/50" : "text-muted-foreground")}>
                    {g.teto == null ? "sem teto" : `R$ ${compacto(g.teto)}`}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
          <GitBranch className="h-4 w-4 text-primary" />
          O que mudou na {VERSAO_VIGENTE.rotulo.replace("v", "").toLowerCase()}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MUDANCAS_REVISAO.map((m) => (
            <div key={m.titulo} className="rounded-md border border-border bg-card p-3">
              <div className="text-[12px] font-semibold text-foreground">{m.titulo}</div>
              <div className="mt-1 num text-[15px] font-bold text-primary">{m.valor}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{m.detalhe}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
