import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { SALDO_ATENCAO_RASPAGEM, SALDO_MINIMO_RASPAGEM } from "@/lib/radarPrecos";

/**
 * Quanto ainda dá para o radar procurar.
 *
 * POR QUE ISTO PRECISA ESTAR NA TELA. O radar lê as lojas por um serviço de
 * raspagem que trabalha por crédito, e o plano é mensal e compartilhado com o
 * radar de editais. Quando o crédito acaba, nada quebra com estrondo: a
 * varredura simplesmente devolve zero anúncio, e a tela diz "não achei
 * promoção" — indistinguível de um mercado sem promoção. Foi para não passar
 * semanas nesse engano que o saldo virou parte da página.
 *
 * A consulta NÃO gasta crédito (é o endpoint de saldo, não de raspagem), e por
 * isso pode rodar a cada abertura em vez de depender do que a última rodada
 * gravou — número de saldo velho é pior que nenhum, porque parece atual.
 */
interface Saldo {
  restantes: number | null;
  plano: number | null;
  ate: string | null;
  erro: string | null;
}

export function SaldoRaspagem() {
  const [s, setS] = useState<Saldo | null>(null);

  useEffect(() => {
    let vivo = true;
    supabase.functions
      .invoke("facilities-radar", { body: { action: "saldo" } })
      .then(({ data }) => { if (vivo) setS((data as Saldo) ?? null); })
      .catch(() => { if (vivo) setS({ restantes: null, plano: null, ate: null, erro: "não deu para ler" }); });
    return () => { vivo = false; };
  }, []);

  if (!s) return null;

  /* FALHA NÃO SOME CALADA — mas também não grita. Não saber o saldo é diferente
     de estar sem saldo, e a frase diz qual dos dois é. */
  if (s.restantes == null) {
    return (
      <span className="text-[12px] text-muted-foreground/70" title={s.erro ?? undefined}>
        · saldo de raspagem não lido
      </span>
    );
  }

  const freado = s.restantes < SALDO_MINIMO_RASPAGEM;
  const atencao = s.restantes < SALDO_ATENCAO_RASPAGEM;
  const renova = s.ate ? new Date(s.ate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px]",
        freado ? "font-medium text-destructive" : atencao ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
      title={
        freado
          ? "Abaixo do mínimo: a varredura fica suspensa para não zerar o crédito (a conferência dos achados na tela continua)."
          : "Créditos de raspagem do mês, compartilhados com o radar de editais."
      }
    >
      <Gauge className="h-3.5 w-3.5" />
      <span className="num">{s.restantes.toLocaleString("pt-BR")}</span>
      {s.plano ? <span className="text-muted-foreground/70">/{s.plano.toLocaleString("pt-BR")}</span> : null}
      <span>{freado ? "— varredura suspensa" : "buscas restantes"}</span>
      {renova && <span className="text-muted-foreground/70">· renova em {renova}</span>}
    </span>
  );
}
