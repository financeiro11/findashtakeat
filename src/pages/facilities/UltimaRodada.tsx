import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ChevronDown, ChevronRight, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { lerFontes } from "@/lib/radarRodada";
import { db } from "./lib";

interface Execucao {
  iniciado_em: string;
  terminado_em: string | null;
  alvos: number;
  ofertas: number;
  detalhe: { modo?: string; quem?: string | null; creditos?: number | null; por_alvo?: unknown } | null;
}

/**
 * A ÚLTIMA RODADA, FIXA NA TELA. Antes o relatório só existia num toast de 10
 * segundos depois do clique manual — e as rodadas do cron, que são quase todas,
 * não deixavam rastro nenhum visível. "A Americanas falhou" precisa estar lá
 * quando alguém abrir a página à tarde, não só para quem clicou de manhã.
 */
export function UltimaRodada({ versao }: { versao: number }) {
  const [e, setE] = useState<Execucao | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    let vivo = true;
    db.from("facilities_radar_execucoes")
      .select("iniciado_em, terminado_em, alvos, ofertas, detalhe")
      .gt("alvos", 0)
      .order("iniciado_em", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: Execucao | null }) => { if (vivo) setE(data ?? null); });
    return () => { vivo = false; };
  }, [versao]);

  if (!e) return null;

  const { falhas, foraDoAssunto } = lerFontes(e.detalhe?.por_alvo);
  const quando = formatDistanceToNowStrict(new Date(e.iniciado_em), { locale: ptBR, addSuffix: true });
  const quem = e.detalhe?.quem ? `por ${e.detalhe.quem.split("@")[0]}` : "automática";
  const modo = e.detalhe?.modo === "vigia" ? "vigia" : "compra";
  /* Sem `terminado_em` a rodada foi derrubada no meio (o worker morre aos ~150s
     sem aviso) — é diferente de "terminou sem achar nada", e a linha diz. */
  const interrompida = !e.terminado_em;
  const temDetalhe = falhas.length > 0 || foraDoAssunto.length > 0;

  return (
    <div className="mt-1.5 text-[12px] text-muted-foreground">
      <button
        type="button"
        onClick={() => temDetalhe && setAberto((v) => !v)}
        className={cn("inline-flex flex-wrap items-center gap-x-1.5 text-left", temDetalhe && "hover:text-foreground")}
        title={new Date(e.iniciado_em).toLocaleString("pt-BR")}
      >
        <History className="h-3.5 w-3.5" />
        <span>
          Última rodada {quando} ({quem}, {modo}) · {e.alvos} alvo(s) · {e.ofertas} anúncio(s)
          {e.detalhe?.creditos != null && ` · ${e.detalhe.creditos} crédito(s)`}
        </span>
        {interrompida && <span className="font-medium text-amber-700 dark:text-amber-400">· interrompida no meio</span>}
        {falhas.length > 0 && (
          <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> {falhas.length} fonte(s) com problema
          </span>
        )}
        {temDetalhe && (aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
      </button>

      {aberto && temDetalhe && (
        <div className="mt-1.5 max-w-2xl space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11.5px]">
          {falhas.map((f) => (
            <div key={f} className="text-amber-800 dark:text-amber-300">{f}</div>
          ))}
          {foraDoAssunto.length > 0 && (
            <div>
              {foraDoAssunto.join(", ")} ficaram de fora: nas últimas leituras nenhum anúncio delas era o produto.
              Voltam a ser consultadas em uma semana.
            </div>
          )}
          {falhas.length > 0 && (
            <div className="pt-1 text-muted-foreground">
              Loja com "nada foi extraído" costuma ser bloqueio anti-robô do dia — o radar segue com as outras e tenta de novo na próxima rodada.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
