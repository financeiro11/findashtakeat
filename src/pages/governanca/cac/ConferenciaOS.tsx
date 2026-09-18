import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { MESES, type PainelRow } from "@/lib/cac";
import { conferirComOS, mesesComCusto, type CustoOSMes } from "@/lib/cac-os";

const sb = supabase as any;

function brl(n: number | null | undefined) {
  if (n == null || !isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------------------------------------------------------------------------
 * "O Takeat OS diz o mesmo?" — este painel (oficial, do Omie) contra a matriz de
 * custos que o time de RPA mantém no Takeat OS. É do OS que sai o CAC da tela
 * Metas & Indicadores; divergência aqui vira CAC diferente lá. O conserto é do
 * lado do OS — este quadro só aponta onde.
 * ------------------------------------------------------------------------- */
export function ConferenciaOS({ ano, rows, mesPadrao }: {
  ano: number;
  rows: PainelRow[];
  /** O último mês fechado (1 = janeiro); o quadro abre nele. */
  mesPadrao: number;
}) {
  const [custos, setCustos] = useState<CustoOSMes[]>([]);
  const [soDivergentes, setSoDivergentes] = useState(true);

  useEffect(() => {
    let vivo = true;
    sb.from("os_custos").select("competencia,grupo,categoria,valor")
      .gte("competencia", `${ano}-01-01`).lte("competencia", `${ano}-12-01`)
      .then(({ data, error }: { data: CustoOSMes[] | null; error: unknown }) => {
        // Acessório: sem o OS, o painel segue sem o quadro.
        if (vivo) setCustos(error ? [] : (data ?? []));
      });
    return () => { vivo = false; };
  }, [ano]);

  const meses = useMemo(() => mesesComCusto(rows, custos, ano).filter((m) =>
    custos.some((c) => Number(c.competencia.slice(5, 7)) === m)), [rows, custos, ano]);
  const [mes, setMes] = useState(mesPadrao);
  useEffect(() => {
    if (!meses.length) return;
    setMes(meses.includes(mesPadrao) ? mesPadrao : meses[meses.length - 1]);
  }, [mesPadrao, meses]);

  const linhas = useMemo(() => conferirComOS(rows, custos, ano, mes), [rows, custos, ano, mes]);
  const divergentes = linhas.filter((l) => !l.bate);
  const visiveis = soDivergentes ? divergentes : linhas;
  const aa = String(ano).slice(2);

  if (!meses.length) return null;

  return (
    <Card className="mt-3.5 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Conferência com o Takeat OS</p>
          <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-muted-foreground">
            Este painel é o oficial. O OS mantém a mesma matriz de custos, e é dela que sai o CAC de
            Metas & Indicadores — linha que diverge aqui deve ser corrigida no OS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {divergentes.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-warn">
              <AlertTriangle className="h-3.5 w-3.5" />
              {divergentes.length} {divergentes.length === 1 ? "linha diverge" : "linhas divergem"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-pos">
              <Check className="h-3.5 w-3.5" /> OS e painel batem
            </span>
          )}
          <button
            type="button"
            onClick={() => setSoDivergentes((v) => !v)}
            className="h-8 rounded-md border border-border px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
          >
            {soDivergentes ? `Ver todas (${linhas.length})` : "Só as que divergem"}
          </button>
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="num h-8 w-[104px] text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {meses.map((m) => <SelectItem key={m} value={String(m)}>{MESES[m - 1]}/{aa}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <p className="px-4 py-5 text-center text-[12.5px] text-muted-foreground">
          Todas as {linhas.length} linhas de {MESES[mes - 1]}/{aa} batem com o OS.
        </p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-1.5 text-left font-medium">Linha</th>
              <th className="px-2 py-1.5 text-right font-medium">Painel (Omie)</th>
              <th className="px-2 py-1.5 text-right font-medium">Takeat OS</th>
              <th className="px-4 py-1.5 text-right font-medium">OS − Painel</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={`${l.grupo}|${l.rotulo}`} className="border-t border-border/40">
                <td className="px-4 py-1.5">
                  <span className="text-muted-foreground">{l.grupo} › </span>{l.rotulo}
                </td>
                <td className="num px-2 py-1.5 text-right">{brl(l.hub)}</td>
                <td className="num px-2 py-1.5 text-right">
                  {l.os == null ? <span className="text-muted-foreground" title="O OS não tem esta categoria no mês">não tem</span> : brl(l.os)}
                </td>
                <td className={cn("num px-4 py-1.5 text-right font-semibold", l.bate ? "text-muted-foreground" : "text-warn")}>
                  {l.bate ? "—" : `${l.diferenca > 0 ? "+" : "−"}${brl(Math.abs(l.diferenca))}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
