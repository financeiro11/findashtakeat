import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { MESES, parsePainelAOA, planoDeImportacao, type Linha, type LinhaImportada } from "@/lib/cac";

const db = supabase as unknown as { from: (t: string) => any };

function brl(n: number) {
  return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ImportarPainelDialog({ aberto, ano, onClose, onImportou }: {
  aberto: boolean; ano: number; onClose: () => void; onImportou: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [lidas, setLidas] = useState<LinhaImportada[] | null>(null);
  const [arquivo, setArquivo] = useState("");
  /* Jan–Mar por padrão: é o trecho que o cache do Omie não alcança. Marcar um
     mês que o Omie já calcula CONGELA aquela célula no valor digitado — daí o
     aviso, e não só o checkbox. */
  const [meses, setMeses] = useState<number[]>([1, 2, 3]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) { setLidas(null); setArquivo(""); setMeses([1, 2, 3]); return; }
    void (async () => {
      const { data } = await db.from("cac_linhas").select("*").order("ordem");
      setLinhas((data ?? []) as Linha[]);
    })();
  }, [aberto]);

  const plano = useMemo(
    () => (lidas ? planoDeImportacao(lidas, linhas, meses) : null),
    [lidas, linhas, meses],
  );

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setArquivo(f.name);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as unknown[][];
      const parsed = parsePainelAOA(aoa);
      if (!parsed.length) {
        toast.error("Não achei linhas nessa planilha", {
          description: "Esperava a primeira coluna com Equipes/Investimentos/Comissões e as 12 colunas de mês.",
        });
      }
      setLidas(parsed);
    } catch (err) {
      toast.error("Não consegui ler o arquivo", { description: String(err) });
      setLidas(null);
    }
  }

  async function importar() {
    if (!plano?.casadas.length) return;
    setSalvando(true);

    const { data: sessao } = await supabase.auth.getUser();
    const linhasParaGravar = plano.casadas.map((c) => ({
      ano, mes: c.mes, linha_id: c.linha_id, valor: c.valor,
      nota: `Importado do painel antigo (${arquivo || "planilha"})`,
      autor: sessao?.user?.id ?? null,
      autor_nome: sessao?.user?.email ?? null,
      atualizado_em: new Date().toISOString(),
    }));

    const { error } = await db.from("cac_valores_manuais")
      .upsert(linhasParaGravar, { onConflict: "ano,mes,linha_id" });
    setSalvando(false);

    if (error) toast.error("Não consegui gravar", { description: error.message });
    else {
      toast.success(`${linhasParaGravar.length} células importadas`);
      onImportou();
    }
  }

  const alternaMes = (m: number) =>
    setMeses((ms) => (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m].sort((a, b) => a - b)));

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Importar o painel de {ano}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            Exporte o painel do sistema atual e escolha o arquivo aqui. O valor importado
            <strong> vence</strong> o cálculo do Omie naquela célula — por isso o padrão é
            só Jan–Mar, que é o trecho fora do alcance do cache.
          </p>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-6 text-[12.5px] text-muted-foreground hover:bg-muted/30">
            <Upload className="h-4 w-4" />
            {arquivo || "Escolher planilha (.xlsx)"}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={escolher} />
          </label>

          <div>
            <p className="mb-1.5 text-[12px] font-medium">Meses a importar</p>
            <div className="flex flex-wrap gap-1.5">
              {MESES.map((m, i) => (
                <button key={m} type="button" onClick={() => alternaMes(i + 1)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                    meses.includes(i + 1)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50",
                  )}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {plano && (
            <div className="space-y-2">
              {plano.semCasar.length > 0 && (
                <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[12px]">
                  <p className="flex items-center gap-1.5 font-medium text-warn">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {plano.semCasar.length} linha(s) da planilha sem correspondência
                  </p>
                  <p className="mt-1 text-muted-foreground">{plano.semCasar.join(" · ")}</p>
                  <p className="mt-1 text-muted-foreground">
                    Crie ou renomeie em “Pessoas e regras” para que passem a casar.
                  </p>
                </div>
              )}

              <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-2.5 py-1.5 text-left font-semibold">Linha</th>
                      <th className="px-2.5 py-1.5 text-left font-semibold">Mês</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plano.casadas.map((c) => (
                      <tr key={`${c.linha_id}-${c.mes}`} className="border-t border-border/50">
                        <td className="px-2.5 py-1">{c.rotulo}</td>
                        <td className="px-2.5 py-1 text-muted-foreground">{MESES[c.mes - 1]}</td>
                        <td className="px-2.5 py-1 text-right num">{brl(c.valor)}</td>
                      </tr>
                    ))}
                    {!plano.casadas.length && (
                      <tr><td colSpan={3} className="px-2.5 py-6 text-center text-muted-foreground">
                        Nada a importar com os meses escolhidos.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <Badge variant="outline" className="text-[11.5px]">
                {plano.casadas.length} célula(s) · {lidas?.length ?? 0} linha(s) lida(s)
              </Badge>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={importar} disabled={salvando || !plano?.casadas.length}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Importar {plano?.casadas.length ? `${plano.casadas.length} células` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
