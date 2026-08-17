import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Loader2, Info, Pencil, Upload } from "lucide-react";
import { ImportarPainelDialog } from "./cac/ImportarPainelDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { valorExato } from "@/lib/valor";
import * as XLSX from "xlsx";
import {
  MESES, montarMatriz, agruparMatriz, totalGeral, matrizParaAOA,
  type PainelRow, type LinhaMatriz, type GrupoMatriz,
} from "@/lib/cac";
import { CelulaDialog } from "./cac/CelulaDialog";
import { CadastroCAC } from "./cac/CadastroCAC";

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece as tabelas nem as
   RPCs criadas na migration do painel CAC. Mesmo atalho do useApelidos — some
   quando os tipos forem regerados. */
const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => any;
};

const ANO_PADRAO = new Date().getFullYear();

/** Compacto na grade; o valor cheio fica no hover. */
function fmtBRL(n: number | null | undefined) {
  return comValorExato(n, fmtBRLStr(n));
}

/** A variante string — para template literal, title= e a planilha. */
function fmtBRLStr(n: number | null | undefined) {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  if (v === 0) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PainelCAC() {
  const [ano, setAno] = useState(ANO_PADRAO);
  const [rows, setRows] = useState<PainelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [celula, setCelula] = useState<{ linha: LinhaMatriz; mes: number } | null>(null);
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.rpc("cac_painel", { p_ano: ano });
    if (error) {
      toast.error("Não consegui carregar o painel", { description: error.message });
      setRows([]);
    } else {
      setRows((data ?? []) as PainelRow[]);
    }
    setLoading(false);
  }, [ano]);

  useEffect(() => { void carregar(); }, [carregar]);

  const grupos = useMemo(() => agruparMatriz(montarMatriz(rows)), [rows]);
  const geral = useMemo(() => totalGeral(grupos), [grupos]);

  /* Quantas células vieram de valor digitado. Vale a pena dizer em voz alta:
     um painel meio derivado e meio digitado que não avisa qual é qual é pior
     do que um painel inteiramente manual. */
  const manuais = useMemo(() => rows.filter((r) => r.origem === "manual").length, [rows]);

  function exportar() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrizParaAOA(grupos, ano)), "Painel CAC");
    XLSX.writeFile(wb, `painel-cac-${ano}.xlsx`);
    toast.success("Planilha gerada", { description: `painel-cac-${ano}.xlsx` });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="h-8 w-[104px] text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[ANO_PADRAO + 1, ANO_PADRAO, ANO_PADRAO - 1].map((a) => (
                <SelectItem key={a} value={String(a)}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex items-center gap-2">
          {manuais > 0 && (
            <Badge variant="outline" className="gap-1 text-[11.5px]">
              <Pencil className="h-3 w-3" />
              {manuais} {manuais === 1 ? "célula digitada" : "células digitadas"}
            </Badge>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setImportando(true)}>
            <Upload className="h-3.5 w-3.5" /> Importar
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" onClick={exportar} disabled={loading || !grupos.length}>
            <Download className="h-3.5 w-3.5" /> Exportar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="painel">
        <TabsList className="h-8">
          <TabsTrigger value="painel" className="text-[12.5px]">Painel</TabsTrigger>
          <TabsTrigger value="cadastro" className="text-[12.5px]">Pessoas e regras</TabsTrigger>
        </TabsList>

        <TabsContent value="painel" className="mt-3">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-[12.5px]">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted/60 px-3 py-2 text-left font-semibold">Categoria</th>
                    {MESES.map((m) => (
                      <th key={m} className="px-3 py-2 text-right font-semibold uppercase">{m}</th>
                    ))}
                    <th className="px-3 py-2 text-right font-semibold">Total Ano</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g) => (
                    <GrupoBloco key={g.grupo} grupo={g} onCelula={(linha, mes) => setCelula({ linha, mes })} />
                  ))}

                  <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                    <td className="sticky left-0 z-10 bg-muted/60 px-3 py-2">Total Geral</td>
                    {geral.meses.map((v, i) => (
                      <td key={i} className="px-3 py-2 text-right num">{fmtBRL(v)}</td>
                    ))}
                    <td className="px-3 py-2 text-right num">{fmtBRL(geral.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {!loading && !grupos.length && (
            <p className="py-8 text-center text-[12.5px] text-muted-foreground">
              Nenhuma linha cadastrada. Configure em “Pessoas e regras”.
            </p>
          )}
        </TabsContent>

        <TabsContent value="cadastro" className="mt-3">
          <CadastroCAC onMudou={carregar} />
        </TabsContent>
      </Tabs>

      <CelulaDialog
        ano={ano}
        linha={celula?.linha ?? null}
        mes={celula?.mes ?? null}
        onClose={() => setCelula(null)}
      />

      <ImportarPainelDialog
        aberto={importando}
        ano={ano}
        onClose={() => setImportando(false)}
        onImportou={() => { setImportando(false); void carregar(); }}
      />
    </div>
  );
}

function GrupoBloco({
  grupo, onCelula,
}: {
  grupo: GrupoMatriz;
  onCelula: (linha: LinhaMatriz, mes: number) => void;
}) {
  return (
    <>
      <tr className="border-t border-border bg-muted/30 font-semibold">
        <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2">{grupo.grupo}</td>
        {grupo.meses.map((v, i) => (
          <td key={i} className="px-3 py-2 text-right num text-muted-foreground">{fmtBRL(v)}</td>
        ))}
        <td className="px-3 py-2 text-right num">{fmtBRL(grupo.total)}</td>
      </tr>

      {grupo.linhas.map((l) => (
        <tr key={l.linha_id} className="border-t border-border hover:bg-muted/20">
          <td className="sticky left-0 z-10 bg-background px-3 py-2 pl-6">
            <span className="inline-flex items-center gap-1.5">
              {l.rotulo}
              {/* A nota da regra é onde mora o "CONFERIR": uma linha cuja regra
                  ainda não foi validada precisa dizer isso na cara de quem lê,
                  não num comentário de migration. */}
              {l.regra_nota && (
                <span title={l.regra_nota} className="cursor-help text-muted-foreground">
                  <Info className={cn("h-3 w-3", l.regra_nota.startsWith("CONFERIR") && "text-warn")} />
                </span>
              )}
            </span>
          </td>
          {l.meses.map((v, i) => (
            <td key={i} className="px-0 py-0 text-right">
              <button
                type="button"
                onClick={() => onCelula(l, i + 1)}
                title={v ? `${valorExato(v)} — clique para ver os lançamentos` : "Sem lançamentos neste mês"}
                className={cn(
                  "num w-full px-3 py-2 text-right transition-colors hover:bg-muted/60",
                  l.origens[i] === "manual" && "text-primary underline decoration-dotted underline-offset-2",
                )}
              >
                {fmtBRLStr(v)}
              </button>
            </td>
          ))}
          <td className="px-3 py-2 text-right num font-medium">{fmtBRL(l.total)}</td>
        </tr>
      ))}
    </>
  );
}
