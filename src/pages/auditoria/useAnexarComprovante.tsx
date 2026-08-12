import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ANEXO_ACCEPT, anexarComprovante, lerBase64, validarArquivo,
  type OrigemAnexo, type RespostaAnexo,
} from "@/lib/anexarComprovante";

export type AlvoAnexo = {
  origem: OrigemAnexo;
  id_unico: string;
  /** aparece nos toasts ("Enviando comprovante de …") */
  rotulo?: string;
};

/**
 * Anexar comprovante pelo Hub — o seletor de arquivo, o envio e o diálogo de
 * "já existe anexo no Omie" em um lugar só, porque Achados e Base do Cartão usam
 * exatamente o mesmo fluxo.
 *
 * Uso:
 *   const anexo = useAnexarComprovante(({ id_unico, storage_path }) => { … });
 *   <button onClick={() => anexo.abrirSeletor({ origem: "achado", id_unico })} />
 *   {anexo.elementos}
 *
 * `enviando` é o id_unico em voo (para o spinner da linha certa).
 */
export function useAnexarComprovante(
  onOk: (r: { alvo: AlvoAnexo; storage_path: string; anexado_omie: boolean; arquivo: string }) => void,
) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [perguntar, setPerguntar] = useState<{ alvo: AlvoAnexo; base64: string; nome: string; nomes: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const alvoPendente = useRef<AlvoAnexo | null>(null);

  const abrirSeletor = (alvo: AlvoAnexo) => {
    alvoPendente.current = alvo;
    fileRef.current?.click();
  };

  const enviar = async (alvo: AlvoAnexo, nome: string, base64: string, modo?: "acrescentar" | "substituir") => {
    setEnviando(alvo.id_unico);
    try {
      const r: RespostaAnexo = await anexarComprovante({ origem: alvo.origem, id_unico: alvo.id_unico, nome, base64, modo });
      if (r.ja_tem_anexo) {
        setPerguntar({ alvo, base64, nome, nomes: r.nomes ?? [] });
        return;
      }
      if (r.anexado_omie) toast.success("Comprovante anexado e enviado ao Omie.");
      else toast.success("Comprovante anexado.");
      if (r.aviso && !r.anexado_omie) toast.message(r.aviso, { duration: 9000 });
      onOk({ alvo, storage_path: r.storage_path ?? "", anexado_omie: !!r.anexado_omie, arquivo: r.arquivo ?? nome });
    } catch (e: any) {
      toast.error("Falha ao anexar: " + (e?.message ?? String(e)), { duration: 9000 });
    } finally {
      setEnviando(null);
    }
  };

  const onArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reescolher o MESMO arquivo depois de um erro
    const alvo = alvoPendente.current;
    alvoPendente.current = null;
    if (!file || !alvo) return;

    const erro = validarArquivo(file);
    if (erro) return void toast.error(erro);

    toast.message(`Enviando comprovante${alvo.rotulo ? ` de ${alvo.rotulo}` : ""}…`);
    try {
      const base64 = await lerBase64(file);
      await enviar(alvo, file.name, base64);
    } catch (err: any) {
      toast.error("Falha ao ler o arquivo: " + (err?.message ?? String(err)));
      setEnviando(null);
    }
  };

  const confirmarModo = (modo: "acrescentar" | "substituir") => {
    const p = perguntar;
    if (!p) return;
    setPerguntar(null);
    void enviar(p.alvo, p.nome, p.base64, modo);
  };

  const elementos = (
    <>
      <input ref={fileRef} type="file" accept={ANEXO_ACCEPT} hidden onChange={onArquivo} />
      <Dialog open={!!perguntar} onOpenChange={(o) => { if (!o) setPerguntar(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Este título já tem comprovante no Omie</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Já existe {perguntar?.nomes.length ?? 0} anexo(s) neste título
            {perguntar?.nomes.length ? `: ${perguntar.nomes.join(", ")}` : ""}.
            {" "}O que deseja fazer com <b>{perguntar?.nome}</b>?
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => confirmarModo("acrescentar")}>Acrescentar</Button>
            <Button onClick={() => confirmarModo("substituir")}>Substituir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  // `perguntando` deixa quem abre um drawer por cima saber que há um diálogo nosso
  // na frente — senão o clique nele conta como "interação fora" e fecha o drawer.
  return { abrirSeletor, enviando, elementos, perguntando: !!perguntar };
}
