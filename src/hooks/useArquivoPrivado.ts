import { useEffect, useState } from "react";
import { assinarConteudo, assinarUrl } from "@/lib/arquivoPrivado";

/**
 * Os dois ganchos de exibição dos buckets privados. A regra e o porquê estão em
 * [src/lib/arquivoPrivado.ts](../lib/arquivoPrivado.ts) — aqui é só a ponte para
 * o React.
 *
 * Os dois começam devolvendo o valor CRU em vez de `null`. Numa `<img>` isso
 * significa um piscar de imagem quebrada até a assinatura chegar, o que é feio
 * — mas devolver vazio faz a página saltar quando a altura da imagem entra
 * depois. Entre piscar e saltar, piscar incomoda menos.
 */

/** Uma URL de bucket privado, assinada. URL de fora passa direto. */
export function useUrlAssinada(url: string | null | undefined): string {
  const [assinada, setAssinada] = useState(url ?? "");

  useEffect(() => {
    let vivo = true;
    if (!url) { setAssinada(""); return; }
    setAssinada(url);
    assinarUrl(url).then((u) => { if (vivo) setAssinada(u); });
    return () => { vivo = false; };
  }, [url]);

  return assinada;
}

/**
 * O JSON do TipTap com as imagens exibíveis.
 *
 * `pronto` existe por causa do editor: montar o TipTap com o conteúdo cru e
 * trocar depois faz ele registrar a troca como EDIÇÃO da pessoa, e a página
 * fica suja sem ninguém ter digitado. Quem monta editor espera `pronto`.
 */
export function useConteudoAssinado<T>(doc: T): { conteudo: T; pronto: boolean } {
  const [conteudo, setConteudo] = useState<T>(doc);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let vivo = true;
    setPronto(false);
    assinarConteudo(doc).then((d) => {
      if (!vivo) return;
      setConteudo(d);
      setPronto(true);
    });
    return () => { vivo = false; };
  }, [doc]);

  return { conteudo, pronto };
}
