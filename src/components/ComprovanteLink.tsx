import { forwardRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { podeAbrirComprovante, resolverComprovante } from "@/lib/comprovante";

type Props = {
  valor: string | null | undefined;
  className?: string;
  title?: string;
  children: React.ReactNode;
};

/**
 * Abre um comprovante da auditoria, seja ele uma URL http ou um caminho no bucket
 * privado (que exige signed URL — por isso a resolução é assíncrona e não dá para
 * usar um <a href> simples).
 *
 * Não renderiza nada quando o valor não é abrível (ex.: só o nome do arquivo).
 * É forwardRef porque costuma ir dentro de um <TooltipTrigger asChild>, que passa ref.
 */
export const ComprovanteLink = forwardRef<HTMLAnchorElement, Props>(
  ({ valor, className, title, children, ...rest }, ref) => {
    const [carregando, setCarregando] = useState(false);
    if (!podeAbrirComprovante(valor)) return null;

    const abrir = async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // a linha do achado é clicável (abre o drawer)
      if (carregando) return;
      setCarregando(true);

      // A aba precisa ser aberta AGORA, dentro do gesto do usuário: se abrirmos depois
      // do await da signed URL, o bloqueador de pop-up mata.
      const aba = window.open("", "_blank", "noopener,noreferrer");
      try {
        const url = await resolverComprovante(valor as string);
        if (aba) aba.location.href = url;
        else window.location.href = url; // pop-up bloqueado → navega na própria aba
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
