import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Aviso de que o app na tela está rodando código velho.
 *
 * O service worker é gerado com `skipWaiting` + `clientsClaim` (registerType "autoUpdate",
 * ver vite.config.ts): depois de um deploy ele ativa sozinho e assume o controle. O que
 * ele NÃO faz é trocar o JavaScript que já está na memória da aba. No app instalado isso
 * é crônico — o iOS e o Android suspendem o app em vez de fechá-lo, então quem instalou em
 * julho pode continuar em julho. E no desktop acontece o mesmo com a aba que fica aberta a
 * semana inteira: o Hub é uma tela de trabalho, não uma página que se recarrega o tempo
 * todo. Nos dois casos é um jeito eficiente de o app "estar bugado" com o bug já corrigido
 * — e sem este aviso não há como distinguir "a tela está errada" de "esta aba está velha",
 * que é a primeira pergunta a fazer quando alguém relata um bug que não reproduz. Por isso
 * o aviso vale nas duas molduras: MobileShell e AppLayout.
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

    // E a aba que NUNCA é escondida? O navegador só relê o `sw.js` sozinho na navegação
    // (ou depois de ~24h), então o Hub aberto a semana inteira na segunda tela ficava no
    // código de segunda-feira sem nada acusar — voltar para ele não é "voltar para a
    // tela" nenhuma, porque ele nunca saiu. Uma pergunta a cada quinze minutos custa
    // alguns kB e fecha esse buraco.
    procurar();
    const relogio = window.setInterval(procurar, 15 * 60 * 1000);

    return () => {
      sw.removeEventListener("controllerchange", aoTrocar);
      document.removeEventListener("visibilitychange", procurar);
      window.clearInterval(relogio);
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
