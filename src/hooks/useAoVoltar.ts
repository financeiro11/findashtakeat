import { useEffect, useRef } from "react";

/**
 * Roda `acao` quando o app volta a ficar visível depois de um tempo fora.
 *
 * No computador existe F5. No app instalado não existe barra do navegador nenhuma: quem
 * abre o Hub de manhã, deixa o celular no bolso e volta à tarde vê os mesmos números da
 * manhã, sem nenhuma forma de pedir dado novo — e o app "parece travado" quando na verdade
 * só está mostrando o que buscou uma vez, na montagem.
 *
 * `minimoMs` evita a recarga a cada alt-tab curto: trocar de aba para copiar um valor e
 * voltar não deve disparar uma rodada de consultas.
 */
export function useAoVoltar(acao: () => void, minimoMs = 60_000) {
  const acaoRef = useRef(acao);
  acaoRef.current = acao;

  useEffect(() => {
    let saiuEm: number | null = null;

    const aoMudar = () => {
      if (document.visibilityState === "hidden") {
        saiuEm = Date.now();
        return;
      }
      if (saiuEm !== null && Date.now() - saiuEm >= minimoMs) acaoRef.current();
      saiuEm = null;
    };

    document.addEventListener("visibilitychange", aoMudar);
    return () => document.removeEventListener("visibilitychange", aoMudar);
  }, [minimoMs]);
}
