import { forwardRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ehUrl, podeAbrirComprovante, resolverComprovante } from "@/lib/comprovante";

type Props = {
  valor: string | null | undefined;
  className?: string;
  title?: string;
  children: React.ReactNode;
};

/**
 * Abre um comprovante da auditoria.
 *
 * Dois casos, e é importante NÃO tratar os dois do mesmo jeito:
 *   • URL http (Drive) → <a href> normal. O navegador abre. Sem JS no meio.
 *   • caminho no bucket privado → precisa gerar uma signed URL, o que é assíncrono;
 *     só aí entra o onClick.
 *
 * Não renderiza nada quando o valor não é abrível (ex.: só o nome do arquivo).
 * É forwardRef porque costuma ir dentro de um <TooltipTrigger asChild>, que passa ref.
 */
export const ComprovanteLink = forwardRef<HTMLAnchorElement, Props>(
  ({ valor, className, title, children, ...rest }, ref) => {
    const [carregando, setCarregando] = useState(false);
    if (!podeAbrirComprovante(valor)) return null;

    // Caso simples: já é uma URL. Link de verdade — nada de window.open.
    if (ehUrl(valor)) {
      return (
        <a
          ref={ref}
          href={(valor as string).trim()}
          target="_blank"
          rel="noopener noreferrer"
          title={title}
          onClick={(e) => e.stopPropagation()} // a linha do achado é clicável (abre o drawer)
          className={className}
          {...rest}
        >
          {children}
        </a>
      );
    }

    // Caso do bucket privado: resolve a signed URL e só então navega.
    const abrir = async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (carregando) return;
      setCarregando(true);

      // A aba tem que ser aberta AGORA, dentro do gesto do usuário — se abrirmos depois
      // do await, o bloqueador de pop-up mata. E sem passar "noopener" nas features:
      // com noopener o window.open retorna null e a referência se perde.
      const aba = window.open("", "_blank");
      if (aba) aba.opener = null; // o noopener que a gente queria, sem perder a referência

      try {
        const url = await resolverComprovante(valor as string);
        if (aba) aba.location.href = url;
        else window.location.href = url; // pop-up bloqueado → abre na própria aba
      } catch (err: any) {
        aba?.close();
        toast.error("Não consegui abrir o comprovante: " + (err?.message ?? "erro desconhecido"));
      } finally {
        setCarregando(false);
      }
    };

    return (
      <a
        ref={ref}
        href="#"
        onClick={abrir}
        title={title}
        className={cn(className, carregando && "pointer-events-none opacity-60")}
        {...rest}
      >
        {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
      </a>
    );
  },
);
ComprovanteLink.displayName = "ComprovanteLink";
