/* ============================================================================
 * Exportar a Revisão do Mês — a caixa de diálogo.
 *
 * Só a conversa com a pessoa: quais blocos entram e em que formato saem. Medir,
 * quebrar em folhas e gerar o arquivo é `lib/folhaRevisao.ts`; a aritmética da
 * quebra é `lib/exportarRevisao.ts`.
 *
 * A pergunta existe porque a reunião não é sempre a mesma: numa o assunto é o
 * caixa e levar as cinco folhas só faz o CEO passar slide. Escolher aqui é mais
 * barato que apagar página depois.
 * ========================================================================== */

import { useState } from "react";
import { FileDown, Loader2, Monitor, Presentation, Printer } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  capturar, gerarPdf, gerarPptx, imprimirDocumento, montarDocumento,
  type Documento, type FormatoExport,
} from "@/lib/folhaRevisao";

type Props = {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  /** Rótulos dos blocos, na ordem em que estão na tela. */
  blocos: readonly string[];
  /** "Julho/26" — vai no cabeçalho de cada folha. */
  rotulo: string;
  /** Base do nome do arquivo, sem extensão. */
  arquivo: string;
};

const ACOES: { formato: FormatoExport; rotulo: string; dica: string; Icone: typeof FileDown }[] = [
  { formato: "pdf", rotulo: "Baixar PDF", dica: "A4 paisagem, no formato de relatório", Icone: FileDown },
  { formato: "pptx", rotulo: "Baixar PowerPoint", dica: "16:9, um slide por folha", Icone: Presentation },
  { formato: "imprimir", rotulo: "Imprimir", dica: "Mesma paginação, com texto selecionável", Icone: Printer },
];

export function ExportarRevisao({ aberto, onOpenChange, blocos, rotulo, arquivo }: Props) {
  /* A seleção guarda quem FICOU DE FORA, não quem está dentro: assim um bloco
     novo na tela já nasce marcado e nenhuma lista precisa ser sincronizada. */
  const [fora, setFora] = useState<Set<string>>(() => new Set());
  const [ocupado, setOcupado] = useState<FormatoExport | null>(null);
  const [passo, setPasso] = useState("");

  const escolhidos = blocos.map((b) => !fora.has(b));
  const nenhum = escolhidos.every((v) => !v);

  const exportar = async (formato: FormatoExport) => {
    if (nenhum || ocupado) return;
    /* Os blocos vêm do DOM, não de props: o relatório tem de sair com a tela que
       a pessoa acabou de conferir — a leitura da IA, as reescritas dela e o
       corte do Pareto onde ela deixou. */
    const todos = [...document.querySelectorAll<HTMLElement>("[data-revisao-bloco]")];
    const alvos = todos.filter((_, i) => escolhidos[i]);
    const rotulos = blocos.filter((_, i) => escolhidos[i]);
    if (!alvos.length) { toast.error("Não encontrei os blocos na tela."); return; }

    setOcupado(formato);
    setPasso("Medindo o conteúdo…");
    let doc: Documento | null = null;
    try {
      // Um quadro para o diálogo repintar antes de o trabalho pesado travar a thread.
      await new Promise((r) => requestAnimationFrame(r));
      doc = montarDocumento(alvos, rotulos, formato, `Revisão do Mês · ${rotulo}`);
      if (!doc.folhas.length) { toast.error("Nada para exportar nos blocos escolhidos."); return; }

      if (formato === "imprimir") {
        setPasso(`${doc.folhas.length} folha(s) — abrindo a impressão…`);
        await new Promise((r) => requestAnimationFrame(r));
        await imprimirDocumento();
        toast.success(`${doc.folhas.length} folha(s) enviadas para a impressão.`);
      } else {
        const pngs = await capturar(doc.folhas, formato, (feito, total) => {
          setPasso(`Desenhando ${formato === "pptx" ? "slide" : "folha"} ${Math.min(feito + 1, total)} de ${total}…`);
        });
        setPasso("Fechando o arquivo…");
        if (formato === "pdf") await gerarPdf(pngs, arquivo);
        else await gerarPptx(pngs, arquivo, `Revisão do Mês · ${rotulo}`);
        toast.success(
          formato === "pdf"
            ? `PDF com ${pngs.length} página(s) baixado.`
            : `PowerPoint com ${pngs.length} slide(s) baixado.`,
        );
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(`Não consegui exportar: ${(e as Error).message}`);
    } finally {
      doc?.raiz.remove();
      setOcupado(null);
      setPasso("");
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!ocupado) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Exportar a revisão · {rotulo}</DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            Escolha os blocos. A quebra das páginas é montada na hora: nenhum card sai
            cortado nem dividido entre duas folhas, e o que não couber inteiro vai para a
            folha seguinte.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          {blocos.map((b, i) => (
            <label
              key={b}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[12.5px] transition",
                escolhidos[i] ? "border-primary/40 bg-accent/60" : "border-border hover:bg-secondary/60",
              )}
            >
              <input
                type="checkbox"
                checked={escolhidos[i]}
                onChange={(e) => setFora((f) => {
                  const novo = new Set(f);
                  if (e.target.checked) novo.delete(b); else novo.add(b);
                  return novo;
                })}
                className="h-3.5 w-3.5 accent-primary"
                disabled={ocupado != null}
              />
              <span className="num text-[11px] text-muted-foreground">0{i + 1}</span>
              <span className="font-medium">{b}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          {ACOES.map(({ formato, rotulo: r, dica, Icone }) => (
            <button
              key={formato}
              onClick={() => exportar(formato)}
              disabled={nenhum || ocupado != null}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition disabled:opacity-50",
                formato === "pdf"
                  ? "border-transparent bg-primary text-primary-foreground hover:opacity-90"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              {ocupado === formato
                ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                : <Icone className="h-4 w-4 shrink-0" />}
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium">{r}</span>
                <span className={cn(
                  "block text-[11px]",
                  formato === "pdf" ? "text-primary-foreground/75" : "text-muted-foreground",
                )}>
                  {ocupado === formato && passo ? passo : dica}
                </span>
              </span>
            </button>
          ))}
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Monitor className="mt-0.5 h-3 w-3 shrink-0" />
          A folha sai com o que está na tela agora — a leitura escrita, as suas reescritas
          e o corte do Pareto onde você deixou. Os controles (slider, alternador, lápis)
          não vão para o papel.
        </p>
      </DialogContent>
    </Dialog>
  );
}
