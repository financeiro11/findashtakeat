import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  excluirComprovante, previaExclusao,
  type OrigemExclusao, type PreviaExclusao, type ResultadoExclusao,
} from "@/lib/excluirComprovante";

export type AlvoExclusao = {
  origem: OrigemExclusao;
  id_unico: string;
  /** aparece no título do diálogo ("Excluir comprovante de …") */
  rotulo?: string;
};

/**
 * Excluir comprovante enviado errado — o par do `useAnexarComprovante`, e usado
 * pelas mesmas telas (Achados, Base do Cartão) e pelo PIX.
 *
 * Abre um diálogo que primeiro LÊ o que existe: o arquivo guardado no Hub (que
 * sempre sai) e os anexos do título no Omie, com o que o Hub mandou já marcado.
 * Nota posta à mão no ERP aparece desmarcada — "o comprovante está errado" não
 * quer dizer "tudo que está no título está errado".
 *
 * Uso:
 *   const exclusao = useExcluirComprovante(({ alvo, resultado }) => { … });
 *   <button onClick={() => exclusao.abrir({ origem: "achado", id_unico })} />
 *   {exclusao.elementos}
 *
 * `aberto` serve ao drawer por baixo, como o `perguntando` do anexar: sem ele o
 * clique no diálogo conta como "interação fora" e fecha o drawer.
 */
export function useExcluirComprovante(
  onOk: (r: { alvo: AlvoExclusao; resultado: ResultadoExclusao }) => void,
) {
  const [alvo, setAlvo] = useState<AlvoExclusao | null>(null);
  const [previa, setPrevia] = useState<PreviaExclusao | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [excluindo, setExcluindo] = useState<string | null>(null);
  // Qual abertura é a atual: a prévia que chega depois de fechar (ou de abrir
  // outra linha) não pode pintar o diálogo errado.
  const pedido = useRef(0);

  const abrir = async (a: AlvoExclusao) => {
    const meu = ++pedido.current;
    setAlvo(a);
    setPrevia(null);
    setErroPrevia(null);
    setMarcados(new Set());
    try {
      const p = await previaExclusao(a.origem, a.id_unico);
      if (pedido.current !== meu) return;
      setPrevia(p);
      setMarcados(new Set(
        (p.omie?.anexos ?? []).filter(x => x.do_hub && !x.repetido && !x.sem_id).map(x => x.nome),
      ));
    } catch (e) {
      if (pedido.current !== meu) return;
      setErroPrevia(e instanceof Error ? e.message : String(e));
    }
  };

  const fechar = () => {
    if (excluindo) return;
    pedido.current++;
    setAlvo(null);
  };

  const marcar = (nome: string, sim: boolean) =>
    setMarcados(m => {
      const n = new Set(m);
      if (sim) n.add(nome); else n.delete(nome);
      return n;
    });

  const confirmar = async () => {
    if (!alvo || !previa) return;
    const a = alvo;
    setExcluindo(a.id_unico);
    try {
      const r = await excluirComprovante(a.origem, a.id_unico, [...marcados]);
      const partes: string[] = [];
      if (r.hub_removido) partes.push("comprovante excluído do Hub");
      if (r.omie.removidos.length) {
        partes.push(`${r.omie.removidos.length} anexo${r.omie.removidos.length > 1 ? "s" : ""} removido${r.omie.removidos.length > 1 ? "s" : ""} do Omie`);
      }
      const frase = partes.join(" · ");
      toast.success(
        frase.charAt(0).toUpperCase() + frase.slice(1) +
        (r.status_novo ? " · de volta a SEM NF e Pendente" : "") + ".",
      );
      if (r.omie.falhas.length) toast.error(`Não saiu do Omie: ${r.omie.falhas.join("; ")}`, { duration: 12000 });
      if (r.aviso) toast.message(r.aviso, { duration: 9000 });
      pedido.current++;
      setAlvo(null);
      onOk({ alvo: a, resultado: r });
    } catch (e) {
      toast.error("Falha ao excluir: " + (e instanceof Error ? e.message : String(e)), { duration: 9000 });
    } finally {
      setExcluindo(null);
    }
  };

  const nadaMarcado = !previa?.hub && marcados.size === 0;

  const elementos = (
    <Dialog open={!!alvo} onOpenChange={(o) => { if (!o) fechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir comprovante{alvo?.rotulo ? ` de ${alvo.rotulo}` : ""}</DialogTitle>
        </DialogHeader>

        {erroPrevia ? (
          <p className="text-sm text-destructive">{erroPrevia}</p>
        ) : !previa ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lendo o que está anexado…
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {alvo?.origem !== "pix" && (
              <section>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">No Hub</div>
                {previa.hub ? (
                  <p className="mt-1">
                    <b className="break-all">{previa.hub.arquivo ?? "arquivo sem nome"}</b> sai do lançamento
                    {previa.hub.no_bucket
                      ? " e é apagado do armazenamento."
                      : " (o link do Drive é desvinculado; o arquivo continua lá)."}
                  </p>
                ) : (
                  <p className="mt-1 text-muted-foreground">Nenhum comprovante guardado no Hub.</p>
                )}
              </section>
            )}

            <section>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                No Omie{previa.omie ? ` · título ${previa.omie.cod_titulo}` : ""}
              </div>
              {!previa.omie ? (
                <p className="mt-1 text-muted-foreground">Sem título casado no Omie — nada a remover lá.</p>
              ) : !previa.omie.lido ? (
                <p className="mt-1 text-amber-700 dark:text-amber-400">
                  Não consegui ler os anexos do título ({previa.omie.erro}).
                  {previa.hub ? " Dá para excluir só do Hub agora e voltar depois para o Omie." : " Tente de novo em instantes."}
                </p>
              ) : previa.omie.anexos.length === 0 ? (
                <p className="mt-1 text-muted-foreground">O título não tem anexo.</p>
              ) : (
                <>
                  <ul className="mt-1.5 space-y-1.5">
                    {previa.omie.anexos.map((x, i) => {
                      const travado = x.repetido || x.sem_id;
                      return (
                        <li key={`${x.nome}-${i}`}>
                          <label className="flex items-start gap-2 cursor-pointer">
                            <Checkbox
                              checked={marcados.has(x.nome)}
                              disabled={travado || !!excluindo}
                              onCheckedChange={(v) => marcar(x.nome, v === true)}
                              className="mt-0.5"
                            />
                            <span className="min-w-0">
                              <span className="break-all">{x.nome || "(sem nome)"}</span>
                              {x.do_hub && (
                                <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border bg-muted text-muted-foreground border-border">
                                  enviado pelo Hub
                                </span>
                              )}
                              {travado && (
                                <span className="block text-[11px] text-muted-foreground">
                                  {x.repetido
                                    ? "Há mais de um arquivo com este nome — remova direto no Omie."
                                    : "O Omie não informou o id deste anexo."}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Marque só o que está errado. Apagar no Omie não tem desfazer.
                  </p>
                </>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={fechar} disabled={!!excluindo}>Cancelar</Button>
          <Button variant="destructive" onClick={confirmar} disabled={!previa || nadaMarcado || !!excluindo}>
            {excluindo
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Excluindo…</>
              : <><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Excluir</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { abrir, excluindo, elementos, aberto: !!alvo };
}
