import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";

/**
 * Convite discreto para instalar na tela inicial. Dispensável, e a dispensa é lembrada —
 * um banner que volta toda sessão vira ruído e some junto com o resto da tela.
 *
 * Dois caminhos porque as plataformas são diferentes: o Android dispara
 * `beforeinstallprompt` e a instalação é um clique; o iOS nunca dispara nada e a única
 * saída é ensinar o caminho (Compartilhar → Adicionar à Tela de Início).
 */

type PromptInstalacao = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const CHAVE = "hub:instalar:dispensado";

const ehIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPad moderno se anuncia como Mac; o toque é o que o denuncia.
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const jaInstalado = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export function InstalarBanner() {
  const [prompt, setPrompt] = useState<PromptInstalacao | null>(null);
  const [dicaIOS, setDicaIOS] = useState(false);
  const [dispensado, setDispensado] = useState(() => localStorage.getItem(CHAVE) === "1");

  useEffect(() => {
    if (dispensado || jaInstalado()) return;

    const aoPoderInstalar = (e: Event) => {
      e.preventDefault(); // sem isto o Chrome mostra a barra dele por cima
      setPrompt(e as PromptInstalacao);
    };
    window.addEventListener("beforeinstallprompt", aoPoderInstalar);
    if (ehIOS()) setDicaIOS(true);

    return () => window.removeEventListener("beforeinstallprompt", aoPoderInstalar);
  }, [dispensado]);

  const dispensar = () => {
    localStorage.setItem(CHAVE, "1");
    setDispensado(true);
  };

  const instalar = async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
    dispensar();
  };

  if (dispensado || (!prompt && !dicaIOS)) return null;

  return (
    <div className="flex items-start gap-2.5 border-b border-border bg-secondary/60 px-4 py-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {prompt ? <Download className="h-4 w-4" /> : <Share className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-foreground">Instalar na tela inicial</div>
        {prompt ? (
          <button onClick={instalar} className="mt-1 text-[12px] font-medium text-primary underline-offset-2 hover:underline">
            Instalar agora
          </button>
        ) : (
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            Toque em <span className="font-medium text-foreground">Compartilhar</span> e depois em{" "}
            <span className="font-medium text-foreground">Adicionar à Tela de Início</span>.
          </p>
        )}
      </div>
      <button
        onClick={dispensar}
        aria-label="Dispensar"
        className="-m-2 flex h-11 w-11 items-center justify-center text-muted-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
