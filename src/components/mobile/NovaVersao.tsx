import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Aviso de que o app na tela está rodando código velho.
 *
 * O service worker é gerado com `skipWaiting` + `clientsClaim` (registerType "autoUpdate",
 * ver vite.config.ts): depois de um deploy ele ativa sozinho e assume o controle. O que
 * ele NÃO faz é trocar o JavaScript que já está na memória da aba. No navegador isso se
 * resolve sozinho, porque a pessoa recarrega a página o tempo todo; no app instalado, não
 * — o iOS e o Android suspendem o app em vez de fechá-lo, então quem instalou em julho
 * pode continuar em julho, e as correções simplesmente não chegam. É um jeito eficiente de
 * o app "estar bugado" mesmo com o bug já corrigido em produção.
 *
 * Aqui o aviso é explícito em vez de recarregar sozinho: recarga surpresa no meio de uma
 * pergunta ao assistente ou de uma nota aberta perde o que estava escrito.
 */
export function NovaVersao() {
  const [pronta, setPronta] = useState(false);

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return; // http sem TLS, ou navegador sem suporte

    // Na primeiríssima visita a página é adotada por um SW que acabou de instalar. Isso
    // dispara `controllerchange` sem que exista versão nova nenhuma — anunciar ali seria
    // pedir para recarregar um app que acabou de abrir.
    const jaControlado = !!sw.controller;
    const aoTrocar = () => { if (jaControlado) setPronta(true); };
    sw.addEventListener("controllerchange", aoTrocar);

    // O app suspenso não dispara `load` de novo, e é o `load` que procura versão nova.
    // Sem esta busca ao voltar para a tela, o aparelho só descobriria o deploy quando o
    // sistema matasse o processo — dias depois, ou nunca.
    const procurar = () => {
      if (document.visibilityState !== "visible") return;
      sw.getRegistration().then((r) => r?.update()).catch(() => { /* offline */ });
    };
    document.addEventListener("visibilitychange", procurar);

    return () => {
      sw.removeEventListener("controllerchange", aoTrocar);
      document.removeEventListener("visibilitychange", procurar);
    };
  }, []);

  if (!pronta) return null;

  return (
    <button
      onClick={() => window.location.reload()}
      className="flex min-h-[40px] w-full shrink-0 items-center justify-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2 text-[12.5px] font-medium text-primary"
    >
      <RefreshCw className="h-3.5 w-3.5 shrink-0" />
      Nova versão disponível — toque para atualizar
    </button>
  );
}
