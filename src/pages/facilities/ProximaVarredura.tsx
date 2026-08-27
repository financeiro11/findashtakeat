import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { db } from "./lib";

/**
 * Quanto falta para a próxima varredura.
 *
 * O HORÁRIO VEM DO CRON, NÃO DAQUI. A tentação é escrever "08:45 e 16:45" no
 * componente e fazer a conta — e foi assim que o radar passou dias varrendo às
 * 5h45 da manhã sem ninguém notar: o pg_cron lê a agenda em UTC, o comentário
 * dizia 08:45, e não havia nada na tela para desmentir. Uma contagem regressiva
 * que não lê do agendador é capaz de contar para uma hora que não existe, com
 * toda a cara de certeza.
 */
interface Item {
  job: string;
  acao: "varrer" | "confirmar";
  proxima: string;
}

/** "3h 12min" · "48min" · "agora" — sem segundos acima de um minuto, que só piscam. */
function faltando(ms: number): string {
  if (ms <= 0) return "a qualquer momento";
  const min = Math.floor(ms / 60000);
  if (min < 1) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${min % 60}min` : `${min}min`;
}

export function ProximaVarredura() {
  const [agenda, setAgenda] = useState<Item[] | null>(null);
  const [, forcar] = useState(0);

  useEffect(() => {
    db.rpc("facilities_radar_agenda").then(({ data }: any) => setAgenda((data as Item[]) ?? []));
  }, []);

  /* Um tique por minuto basta e é de propósito: a contagem é em horas e
     minutos, então acordar a cada segundo redesenharia a tela 60 vezes para
     mudar nada. Quando falta menos de dois minutos, aí sim conta segundo. */
  useEffect(() => {
    const prox = agenda?.[0] ? new Date(agenda[0].proxima).getTime() - Date.now() : Infinity;
    const passo = prox < 120_000 ? 1000 : 30_000;
    const t = setInterval(() => forcar((n) => n + 1), passo);
    return () => clearInterval(t);
  }, [agenda]);

  if (!agenda?.length) return null;

  const varrer = agenda.find((a) => a.acao === "varrer");
  const confirmar = agenda.find((a) => a.acao === "confirmar");
  if (!varrer) return null;

  const falta = new Date(varrer.proxima).getTime() - Date.now();
  const hora = (iso: string) =>
    new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      <span>
        Próxima varredura em <span className="num font-semibold text-foreground">{faltando(falta)}</span>
        <span className="text-muted-foreground/80"> · {hora(varrer.proxima)}</span>
      </span>
      {confirmar && (
        /* A confirmação é a metade que tira o achado da quarentena. Sem ela na
           tela, "varreu e não apareceu nada" pareceria bug — quando é só o
           anúncio ainda não ter sido aberto e conferido. */
        <span className="text-muted-foreground/80">
          · conferência dos achados às {hora(confirmar.proxima)}
        </span>
      )}
    </div>
  );
}
