import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Send, Ban } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { brl, fmtDateBR } from "./utils";

type Match = {
  codigo: string;
  descricao: string;
  codTitulo: string;
  fornecedor: string;
  dataLabel: string;
  conf: "alta" | "media" | "baixa";
  dias: number;
  sim: number;
};

type Elegivel = {
  achado_id: number;
  titulo: string;
  valor: number;
  data: string | null;
  estabelecimento: string | null;
  ja_enviado_em: string | null;
  match: Match | null;
  pode_enviar_direto: boolean;
};

/**
 * Envia ao Omie os comprovantes dos achados Aprovados, anexando-os no título
 * correspondente.
 *
 * O casamento cartão↔Omie é heurístico (valor + data + semelhança), então:
 *   • confiança ALTA → vai direto;
 *   • média/baixa → a pessoa marca uma a uma, vendo o título que foi encontrado.
 * É por isso que este diálogo existe em vez de o botão simplesmente disparar.
 */
export default function EnviarOmieDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [elegiveis, setElegiveis] = useState<Elegivel[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    (async () => {
      setCarregando(true);
      setMarcados(new Set());
      try {
        const { data, error } = await supabase.functions.invoke("omie-anexar-comprovante", {
          body: { action: "preview" },
        });
        if (error) throw new Error(error.message);
        if ((data as any)?.error) throw new Error((data as any).error);
        setElegiveis(((data as any)?.elegiveis ?? []) as Elegivel[]);
      } catch (e: any) {
        toast.error("Não consegui consultar o Omie: " + e.message, { duration: 8000 });
        setElegiveis([]);
      } finally {
        setCarregando(false);
      }
    })();
  }, [open]);

  const automaticos = elegiveis.filter((e) => e.pode_enviar_direto);
  // Tem título no Omie, mas o casamento não é confiável o bastante para ir sozinho.
  const confirmar = elegiveis.filter((e) => !e.pode_enviar_direto && e.match && !e.ja_enviado_em);
  const jaEnviados = elegiveis.filter((e) => e.ja_enviado_em);
  const semTitulo = elegiveis.filter((e) => !e.match && !e.ja_enviado_em);

  const totalEnviar = automaticos.length + marcados.size;

  const toggle = (id: number) =>
    setMarcados((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const enviar = async () => {
    if (!totalEnviar) return;
    setEnviando(true);
    try {
      const ids = [...automaticos.map((e) => e.achado_id), ...marcados];
      const { data, error } = await supabase.functions.invoke("omie-anexar-comprovante", {
        body: { action: "enviar", ids },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);

      const d = data as any;
      if (d.enviados) toast.success(`${d.enviados} comprovante(s) anexado(s) no Omie.`);
      if (d.falhas) {
        toast.error(
          `${d.falhas} falha(s): ` +
            (d.detalhe_falhas ?? []).map((f: any) => `${f.titulo} (${f.erro})`).join(" · "),
          { duration: 12000 },
        );
      }
      if (!d.enviados && !d.falhas) toast.message("Nada foi enviado.");
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Falha ao enviar: " + e.message, { duration: 10000 });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Enviar comprovantes ao Omie</DialogTitle>
        </DialogHeader>

        {carregando ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
            Buscando os títulos no Omie…
          </div>
        ) : !elegiveis.length ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhum achado <b>Aprovado</b> com comprovante anexado.
            <div className="mt-1 text-xs">
              O comprovante enviado pelo gestor entra como “Em análise” — aprove-o primeiro para poder mandar ao Omie.
            </div>
          </div>
        ) : (
          <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
            {automaticos.length > 0 && (
              <section>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {automaticos.length} com casamento de confiança alta — vão direto
                </div>
                <div className="rounded-lg border border-border divide-y divide-border/60">
                  {automaticos.map((e) => <Linha key={e.achado_id} e={e} />)}
                </div>
              </section>
            )}

            {confirmar.length > 0 && (
              <section>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {confirmar.length} precisam da sua confirmação
                </div>
                <p className="mb-2 text-[11.5px] text-muted-foreground">
                  O casamento com o Omie foi só pelo valor, com a data distante ou a descrição divergente.
                  Confira o título antes de marcar — o anexo é gravado no Omie.
                </p>
                <div className="rounded-lg border border-amber-200 divide-y divide-border/60">
                  {confirmar.map((e) => (
                    <Linha
                      key={e.achado_id}
                      e={e}
                      marcado={marcados.has(e.achado_id)}
                      onToggle={() => toggle(e.achado_id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {semTitulo.length > 0 && (
              <section>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                  <Ban className="h-3.5 w-3.5" />
                  {semTitulo.length} sem título correspondente no Omie — não dá para anexar
                </div>
                <div className="rounded-lg border border-border divide-y divide-border/60">
                  {semTitulo.map((e) => <Linha key={e.achado_id} e={e} />)}
                </div>
              </section>
            )}

            {jaEnviados.length > 0 && (
              <section>
                <div className="mb-2 text-[12px] font-semibold text-muted-foreground">
                  {jaEnviados.length} já enviados antes — serão ignorados
                </div>
                <div className="rounded-lg border border-border divide-y divide-border/60 opacity-60">
                  {jaEnviados.map((e) => <Linha key={e.achado_id} e={e} />)}
                </div>
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={enviando || carregando || !totalEnviar}>
            {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Enviar {totalEnviar || ""} ao Omie
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Linha({ e, marcado, onToggle }: { e: Elegivel; marcado?: boolean; onToggle?: () => void }) {
  const m = e.match;
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 text-sm">
      {onToggle && (
        <Checkbox checked={!!marcado} onCheckedChange={onToggle} className="mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{e.estabelecimento || e.titulo}</div>
        <div className="text-[11.5px] text-muted-foreground">
          {fmtDateBR(e.data)} · {brl(Number(e.valor || 0))}
        </div>
      </div>
      <div className="min-w-0 flex-1 text-right">
        {m ? (
          <>
            <div className="truncate text-[12px]">
              {m.fornecedor || "(fornecedor não informado)"}{" "}
              <span className="text-muted-foreground">· título {m.codTitulo}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {m.dataLabel} · {m.descricao}
            </div>
            <span
              className={cn(
                "mt-0.5 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                m.conf === "alta"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : m.conf === "media"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-red-200 bg-red-50 text-red-700",
              )}
            >
              {m.conf} · {m.dias}d de diferença
            </span>
          </>
        ) : (
          <span className="text-[12px] text-muted-foreground">sem correspondência</span>
        )}
      </div>
    </div>
  );
}
