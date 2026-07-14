import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Send, Ban, Paperclip } from "lucide-react";
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

type Motivo = null | "drive" | "sem_titulo" | "ja_enviado" | "comprovante_invalido";

type Elegivel = {
  achado_id: number;
  origem: "achado" | "cartao";
  titulo: string;
  valor: number;
  data: string | null;
  estabelecimento: string | null;
  ja_enviado_em: string | null;
  match: Match | null;
  bloqueio: Motivo;
  pode_enviar_direto: boolean;
};

const EXPLICA_BLOQUEIO: Record<Exclude<Motivo, null>, string> = {
  drive:
    "O comprovante é um link do Google Drive. O servidor não tem credencial do Google, então não consegue baixar o arquivo — o Drive devolve uma página de login no lugar dele.",
  sem_titulo: "Não achei no Omie um título que corresponda a este lançamento (valor + data).",
  ja_enviado: "Já foi anexado no Omie antes.",
  comprovante_invalido:
    "O registro guarda só o nome do arquivo, não o arquivo em si — não há o que enviar.",
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
  const [anexandoId, setAnexandoId] = useState<number | null>(null);
  const [elegiveis, setElegiveis] = useState<Elegivel[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());

  const carregar = async () => {
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
  };

  useEffect(() => {
    if (open) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const automaticos = elegiveis.filter((e) => e.pode_enviar_direto);
  // Sem bloqueio, mas o casamento não é confiável o bastante para ir sozinho.
  const confirmar = elegiveis.filter((e) => !e.bloqueio && !e.pode_enviar_direto);
  // Bloqueados: a confirmação do usuário não resolve — o arquivo ou o destino não existem.
  const bloqueados = elegiveis.filter((e) => !!e.bloqueio);

  // Agrupa por motivo, para explicar cada um uma vez só em vez de repetir por linha.
  const porMotivo = bloqueados.reduce<Record<string, Elegivel[]>>((acc, e) => {
    (acc[e.bloqueio!] ??= []).push(e);
    return acc;
  }, {});

  const totalEnviar = automaticos.length + marcados.size;

  const toggle = (id: number) =>
    setMarcados((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  /**
   * Saída para o comprovante que está no Drive: o servidor não consegue baixar de lá,
   * mas a pessoa consegue (está logada no Google). Ela escolhe o arquivo e nós mandamos
   * direto para o título do Omie.
   */
  const anexarArquivo = (e: Elegivel) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/jpeg,image/png";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) return toast.error("Arquivo maior que 10 MB.");

      setAnexandoId(e.achado_id);
      try {
        const base64 = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
          fr.onerror = () => rej(new Error("Não consegui ler o arquivo."));
          fr.readAsDataURL(file);
        });

        const { data, error } = await supabase.functions.invoke("omie-anexar-comprovante", {
          body: { action: "anexar_arquivo", id: e.achado_id, nome: file.name, mime: file.type, base64 },
        });
        if (error) throw new Error(error.message);
        if ((data as any)?.error) throw new Error((data as any).error);

        toast.success(`Anexado no título ${(data as any).omie_cod_titulo} do Omie.`);
        await carregar();   // o item sai de "bloqueado" e vira "já enviado"
        onDone();
      } catch (err: any) {
        toast.error("Falha ao anexar: " + err.message, { duration: 10000 });
      } finally {
        setAnexandoId(null);
      }
    };
    input.click();
  };

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
            Nenhum lançamento <b>Aprovado</b> com comprovante anexado.
            <div className="mt-1 text-xs">
              O comprovante que o gestor manda pelo link entra como “Em análise” — aprove-o primeiro para poder mandar ao Omie.
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

            {Object.entries(porMotivo).map(([motivo, itens]) => {
              // O bloqueio "drive" é o único que a pessoa consegue destravar: ela está
              // logada no Google, baixa a nota e sobe aqui. Os outros (sem título, já
              // enviado) não têm o que fazer.
              const temSaida = motivo === "drive" || motivo === "comprovante_invalido";
              return (
                <section key={motivo}>
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                    <Ban className="h-3.5 w-3.5" />
                    {itens.length} não {itens.length === 1 ? "pode" : "podem"} ser enviado{itens.length === 1 ? "" : "s"} automaticamente
                  </div>
                  <p className="mb-2 text-[11.5px] text-muted-foreground">
                    {EXPLICA_BLOQUEIO[motivo as Exclude<Motivo, null>]}
                    {temSaida && (
                      <>
                        {" "}
                        <b className="text-foreground">
                          Baixe a nota e use “Anexar arquivo” — ela vai direto para o título no Omie.
                        </b>
                      </>
                    )}
                  </p>
                  <div className="rounded-lg border border-border divide-y divide-border/60">
                    {itens.map((e) => (
                      <Linha
                        key={e.achado_id}
                        e={e}
                        onAnexar={temSaida && e.match ? () => anexarArquivo(e) : undefined}
                        anexando={anexandoId === e.achado_id}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
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

function Linha({
  e,
  marcado,
  onToggle,
  onAnexar,
  anexando,
}: {
  e: Elegivel;
  marcado?: boolean;
  onToggle?: () => void;
  onAnexar?: () => void;
  anexando?: boolean;
}) {
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
        {onAnexar && (
          <Button
            size="sm"
            variant="outline"
            className="mt-1.5 h-7 text-[11.5px]"
            onClick={onAnexar}
            disabled={anexando}
          >
            {anexando
              ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Anexando…</>
              : <><Paperclip className="mr-1.5 h-3 w-3" /> Anexar arquivo</>}
          </Button>
        )}
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
