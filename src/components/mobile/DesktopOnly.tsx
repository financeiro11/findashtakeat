import { Link } from "react-router-dom";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Tela para as rotas que ficaram de fora do app: DRE/DFC, balanço, auditorias, extratos,
 * orçamento, editais, parceiros, facilities, recargas, playbooks e admin.
 *
 * Não é uma limitação temporária a ser contornada com scroll horizontal: essas telas são
 * grades de dezenas de colunas com edição célula a célula. Espremer isso em 375px produz
 * um número que a pessoa não consegue conferir — e conferir é o ponto.
 */
export function DesktopOnly({ titulo, mostrarVoltar = true }: { titulo?: string; mostrarVoltar?: boolean } = {}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Monitor className="h-7 w-7" />
      </div>
      <h2 className="text-[17px] font-semibold text-foreground">Disponível no computador</h2>
      <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
        {titulo ? <><span className="font-medium text-foreground">{titulo}</span> usa </> : "Esta tela usa "}
        tabelas grandes, feitas para telas maiores — no celular os números ficariam
        ilegíveis.
      </p>
      {mostrarVoltar && (
        <Button asChild className="mt-6 h-11 px-6">
          <Link to="/">Voltar ao início</Link>
        </Button>
      )}
    </div>
  );
}

export default DesktopOnly;
