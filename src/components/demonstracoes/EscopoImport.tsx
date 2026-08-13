import { useEffect, useState } from "react";
import { Loader2, Lock, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  opcoesDeEscopo, ptLabelFromKey, resumoMeses,
  type EscopoImport, type TrackerLido,
} from "@/lib/importarTracker";

/* ---------------------------------------------------------------------------
 * Entre escolher o arquivo e gravar, uma pergunta: quanto dele entra.
 *
 * O tracker traz o histórico inteiro. Quem importa quase sempre quer só o mês
 * que acabou de fechar — reescrever o resto desfaz correção feita na tela em mês
 * antigo, e isso acontecia calado. Aqui a escolha é explícita, e cada opção diz
 * quais meses vai gravar, pelo nome. Ver `lib/importarTracker.ts`.
 * ------------------------------------------------------------------------- */

export function EscopoImportDialog({
  tracker, travados, gravando, onCancelar, onConfirmar,
}: {
  /** null = nenhum arquivo esperando decisão (diálogo fechado). */
  tracker: TrackerLido | null;
  travados: Set<string>;
  gravando: boolean;
  onCancelar: () => void;
  onConfirmar: (meses: string[], escopo: EscopoImport) => void;
}) {
  const { opcoes, padrao } = tracker
    ? opcoesDeEscopo(tracker.fechadas, travados)
    : { opcoes: [], padrao: "todos" as EscopoImport };
  const [escopo, setEscopo] = useState<EscopoImport>(padrao);

  // Arquivo novo, escolha nova: o padrão depende do que ESTE arquivo trouxe.
  useEffect(() => { setEscopo(padrao); }, [tracker, padrao]);

  const escolhida = opcoes.find((o) => o.escopo === escopo) ?? opcoes[0];
  // Mês já fechado que esta escolha vai reescrever — o único efeito difícil de desfazer.
  const reescreveTravados = (escolhida?.meses ?? []).filter((m) => travados.has(m));

  return (
    <Dialog open={!!tracker} onOpenChange={(o) => { if (!o && !gravando) onCancelar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">O que este arquivo deve atualizar?</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {tracker?.arquivo ? <span className="font-medium text-foreground">{tracker.arquivo}</span> : null}
            {tracker?.fechadas.length
              ? <> · {tracker.fechadas.length} mês(es) preenchido(s): {resumoMeses(tracker.fechadas)}</>
              : null}
          </DialogDescription>
        </DialogHeader>

        {opcoes.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Nenhum mês do arquivo veio preenchido o bastante para ser gravado. Confira se a planilha
            é o tracker e se os meses fechados estão com valor.
          </p>
        ) : (
          <RadioGroup value={escopo} onValueChange={(v) => setEscopo(v as EscopoImport)} className="gap-2">
            {opcoes.map((o) => (
              <label
                key={o.escopo}
                htmlFor={`escopo-${o.escopo}`}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                  escopo === o.escopo ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                )}
              >
                <RadioGroupItem value={o.escopo} id={`escopo-${o.escopo}`} className="mt-0.5" />
                <span className="space-y-1">
                  <span className="block text-[13px] font-medium leading-none">{o.titulo}</span>
                  <span className="block text-[12px] leading-snug text-muted-foreground">{o.descricao}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        )}

        {reescreveTravados.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11.5px] leading-snug text-amber-800">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {reescreveTravados.length === 1
                ? <>O mês <b>{ptLabelFromKey(reescreveTravados[0])}</b> já estava fechado e será reescrito pelo arquivo</>
                : <><b>{reescreveTravados.length} meses</b> já fechados serão reescritos pelo arquivo ({resumoMeses(reescreveTravados)})</>}
              {" "}— o que foi ajustado na tela nesses meses volta ao que está na planilha.
            </span>
          </p>
        )}

        {(tracker?.ignoradas.length ?? 0) > 0 && (
          <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
            <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {tracker!.ignoradas.length} mês(es) do cabeçalho ficaram de fora por dado incompleto
              ({tracker!.ignoradas.map(ptLabelFromKey).join(", ")}) — seguem calculados pelo Sincronizar Omie.
            </span>
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={onCancelar} disabled={gravando}>
            Cancelar
          </Button>
          <Button
            size="sm"
            className="h-8 text-[12px]"
            disabled={gravando || !escolhida?.meses.length}
            onClick={() => escolhida && onConfirmar(escolhida.meses, escolhida.escopo)}
          >
            {gravando
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            {escolhida?.meses.length ? `Importar ${resumoMeses(escolhida.meses)}` : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
