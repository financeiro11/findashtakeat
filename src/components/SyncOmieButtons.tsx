import { RefreshCw, CloudDownload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// Par de botões padrão das telas que puxam do Omie:
//   • Recalcular      → usa o cache compartilhado (rápido, sem consumir a API do Omie)
//   • Atualizar do Omie → força buscar do Omie agora (mais lento, consome a API)
// Cada botão tem um tooltip explicando exatamente o que faz.
export function SyncOmieButtons({
  onRecalcular,
  onAtualizar,
  syncing,
  recalcularHint = "Recalcula com os dados que já foram baixados do Omie (cache das últimas horas). É instantâneo e não consome a API do Omie.",
  atualizarHint = "Busca os lançamentos direto do Omie agora, ignorando o cache, e recalcula. Mais lento (~1–2 min) e consome a API do Omie. Use quando mudou algo no Omie e quer refletir na hora.",
  className = "",
}: {
  onRecalcular: () => void;
  onAtualizar: () => void;
  syncing: boolean;
  recalcularHint?: string;
  atualizarHint?: string;
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            onClick={onRecalcular}
            disabled={syncing}
            className="h-8 text-[12px] bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Recalcular
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px] text-[12px] leading-snug">{recalcularHint}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onAtualizar}
            disabled={syncing}
            className="h-8 text-[12px]"
          >
            {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="mr-1.5 h-3.5 w-3.5" />}
            Atualizar do Omie
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px] text-[12px] leading-snug">{atualizarHint}</TooltipContent>
      </Tooltip>
    </div>
  );
}
