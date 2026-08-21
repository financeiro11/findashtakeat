import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { definirModoCelular, superficieAtual, type Superficie } from "@/hooks/use-mobile";

const CHAVE_DISPENSADA = "mobile:oferta-dispensada";

/**
 * A saída manual de quando o Hub abre num celular.
 *
 * Reconhecer "isto é um telefone" já falhou três vezes por três motivos diferentes (ver
 * use-mobile), e cada erro custou uma volta inteira: descobrir, arrumar, publicar, esperar
 * o aparelho pegar a versão nova. Enquanto isso, quem está com o telefone na mão fica com
 * um Hub de 1200px espremido em 380 — inutilizável.
 *
 * Então a regra automática deixa de ser a única chance: quando o Hub montou numa janela
 * estreita COM toque — a exata combinação que costuma ser um celular mal reconhecido —,
 * esta barra oferece a troca, e a escolha fica gravada no aparelho.
 *
 * Ela OFERECE, não troca sozinha: no note de tela dividida com tela de toque a mesma
 * combinação aparece, e trocar o app inteiro por baixo de quem está trabalhando é
 * justamente o estrago que se está tentando evitar. Oferta se ignora; troca, não.
 *
 * A linha de números embaixo é de propósito: é o que o aparelho respondeu quando foi
 * medido. Num print, ela diz por que a conta deu computador.
 */
export function AbrirNoCelular() {
  const [superficie, setSuperficie] = useState<Superficie | null>(null);
  const [dispensada, setDispensada] = useState(() => {
    try { return localStorage.getItem(CHAVE_DISPENSADA) === "1"; } catch { return false; }
  });

  useEffect(() => {
    const medir = () => setSuperficie(superficieAtual());
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
    };
  }, []);

  if (dispensada || !superficie) return null;
  const { telaLargura, telaAltura, janelaLargura, janelaAltura, dpr, toque, semHover } = superficie;
  if (!toque || Math.min(janelaLargura, janelaAltura) >= 768) return null;

  const trocar = () => {
    definirModoCelular(true);
    // Recarregar em vez de reagir a um estado: quem escolhe a árvore de telas é o topo do
    // App, e voltar do zero garante que nada do Hub sobre montado por baixo do app novo.
    window.location.reload();
  };

  const dispensar = () => {
    setDispensada(true);
    try { localStorage.setItem(CHAVE_DISPENSADA, "1"); } catch { /* armazenamento bloqueado */ }
  };

  return (
    <div
      data-chrome="oferta-celular"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/98 px-4 pt-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.45)] backdrop-blur"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-md items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <Smartphone className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-snug text-foreground">
            Isto parece um celular
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            O que abriu foi o Hub de computador. O app do celular cabe na tela.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <Button onClick={trocar} className="h-10 flex-1 text-[13px]">
              Abrir o app do celular
            </Button>
            <Button variant="ghost" onClick={dispensar} className="h-10 px-3 text-[13px] text-muted-foreground">
              Agora não
            </Button>
          </div>
          <p className="num mt-2 text-[10.5px] leading-snug text-muted-foreground/80">
            tela {telaLargura}×{telaAltura} · janela {janelaLargura}×{janelaAltura} ·
            {" "}dpr {dpr.toFixed(2).replace(".", ",")} · toque sim · hover {semHover ? "não" : "sim"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default AbrirNoCelular;
