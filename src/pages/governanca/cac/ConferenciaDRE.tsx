import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Check, Lock, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { MESES, conferenciaDoMes, type ConferenciaDre } from "@/lib/cac";

function brl(n: number | null | undefined) {
  if (n == null || !isFinite(Number(n))) return "—";
  if (Math.abs(Number(n)) < 0.005) return "—";
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------------------------------------------------------------------------
 * "Esses números fazem sentido?" — a matriz do CAC contra a DRE.
 *
 * A matriz corta a DRE por PESSOA (quem é de aquisição) e junta rubricas
 * (Eventos = Eventos e Feiras + Viagens Mkt). Olhando só a matriz não dá para
 * saber se um agosto baixo é agosto baixo ou dinheiro que não entrou. Este quadro
 * mostra as três contas lado a lado, rubrica a rubrica:
 *
 *   DRE          o que a demonstração mostra;
 *   Omie         a mesma rubrica refeita da base do CAC — a prova de que as duas
 *                leem o mesmo dado. Só pode divergir onde a DRE tem valor
 *                digitado ou mês travado pelo tracker, e a linha diz qual;
 *   No CAC       quanto dela alguma linha do painel pegou;
 *   Fica fora    o resto, que é folha de quem não é de aquisição (Tecnologia,
 *                Administrativo, Diretoria) — não é dinheiro perdido.
 * ------------------------------------------------------------------------- */
export function ConferenciaDRE({ ano, rows, mesPadrao }: {
  ano: number;
  rows: ConferenciaDre[];
  /** O último mês fechado (1 = janeiro); o quadro abre nele. */
  mesPadrao: number;
}) {
  const mesesComDado = useMemo(
    () => [...new Set(rows.filter((r) => Number(r.dre) || Number(r.omie)).map((r) => r.mes))].sort((a, b) => a - b),
    [rows],
  );
  const [mes, setMes] = useState(mesPadrao);

  useEffect(() => {
    if (!mesesComDado.length) return;
    setMes(mesesComDado.includes(mesPadrao) ? mesPadrao : mesesComDado[mesesComDado.length - 1]);
  }, [mesPadrao, mesesComDado]);

  const resumo = useMemo(() => conferenciaDoMes(rows, mes), [rows, mes]);
  const inexplicadas = resumo.linhas.filter((l) => l.inexplicada).length;
  const aa = String(ano).slice(2);

  if (!rows.length) return null;

  return (
    <Card className="mt-3.5 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Conferência com a DRE</p>
          <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-muted-foreground">
            A base do CAC é a mesma da DRE: título do Omie pela data de registro, pago ou a vencer.
            “Fica fora” é o que nenhuma linha pega — a folha de quem não é de aquisição.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {inexplicadas > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-warn">
              <AlertTriangle className="h-3.5 w-3.5" />
              {inexplicadas} {inexplicadas === 1 ? "rubrica não bate" : "rubricas não batem"}
            </span>
          ) : resumo.linhas.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-pos">
              <Check className="h-3.5 w-3.5" /> Omie e DRE batem
            </span>
          ) : null}
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="num h-8 w-[104px] text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {mesesComDado.map((m) => (
                <SelectItem key={m} value={String(m)}>{MESES[m - 1]}/{aa}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-[12.5px]">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Rubrica da DRE</th>
              <th className="px-3 py-2 text-right font-semibold">DRE</th>
              <th className="px-3 py-2 text-right font-semibold" title="A mesma rubrica refeita da base do CAC">Omie</th>
              <th className="px-3 py-2 text-right font-semibold">No CAC</th>
              <th className="px-3 py-2 text-right font-semibold">Fica fora</th>
              <th className="px-4 py-2 text-right font-semibold">DRE − Omie</th>
            </tr>
          </thead>
          <tbody>
            {resumo.linhas.map((l) => {
              const parte = l.omie ? l.no_cac / l.omie : 0;
              return (
                <tr key={l.rubrica} className="border-t border-border">
                  <td className="px-4 py-2">
                    <span className="block">{l.rubrica}</span>
                    {/* A barra diz de relance quanto da rubrica é CAC: Eventos é
                        inteira, Equipe Comercial é quase inteira, Premiações é metade. */}
                    <span className="mt-1 block h-1 w-40 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.round(parte * 100)}%` }} />
                    </span>
                  </td>
                  <td className="num px-3 py-2 text-right">{brl(l.dre)}</td>
                  <td className="num px-3 py-2 text-right text-muted-foreground">{brl(l.omie)}</td>
                  <td className="num px-3 py-2 text-right font-medium">{brl(l.no_cac)}</td>
                  <td className="num px-3 py-2 text-right text-muted-foreground">{brl(l.fora_do_cac)}</td>
                  <td className="px-4 py-2 text-right">
                    {Math.abs(l.diferenca) <= 1 ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-pos"><Check className="h-3 w-3" /> bate</span>
                    ) : (
                      <span className="flex flex-col items-end">
                        <span className={cn("num", l.inexplicada ? "font-semibold text-warn" : "text-muted-foreground")}>
                          {brl(l.diferenca)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                          {l.valor_manual_na_dre && <><Pencil className="h-2.5 w-2.5" /> valor digitado na DRE</>}
                          {!l.valor_manual_na_dre && l.mes_travado && <><Lock className="h-2.5 w-2.5" /> mês travado pelo tracker</>}
                          {l.inexplicada && "sem explicação na DRE"}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!resumo.linhas.length && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nada nesta competência.</td></tr>
            )}
          </tbody>
          {resumo.linhas.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[hsl(var(--line-strong))] bg-muted/50 font-semibold">
                <td className="px-4 py-2">Total das rubricas</td>
                <td className="num px-3 py-2 text-right">{brl(resumo.dre)}</td>
                <td className="num px-3 py-2 text-right">{brl(resumo.omie)}</td>
                <td className="num px-3 py-2 text-right">{brl(resumo.noCac)}</td>
                <td className="num px-3 py-2 text-right">{brl(resumo.foraDoCac)}</td>
                <td className="num px-4 py-2 text-right">{brl(resumo.dre - resumo.omie)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
