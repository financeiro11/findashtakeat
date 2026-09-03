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
 *
 * E LER O AGENDADOR NÃO BASTA — É PRECISO SABER SOBRE QUEM O CRON AGE. São dois
 * regimes e duas filas: o cron diário só enxerga alvo em modo compra, o semanal
 * só enxerga alvo em vigia. Em 03/09/2026, com os quatro alvos do kit de estação
 * em vigia e nenhum em compra, esta linha dizia "Próxima varredura em 1h48min ·
 * 16:45" — hora certa de um trabalho que passaria pela fila vazia e não tocaria
 * em nada. A verdadeira próxima varredura era na segunda seguinte.
 *
 * Daí as contagens: o componente mostra o cron de cada regime SÓ quando existe
 * alvo naquele regime. Contagem regressiva para trabalho que não vai acontecer é
 * a mesma mentira do horário escrito à mão, só que mais difícil de flagrar.
 */
interface Item {
  job: string;
  acao: "varrer" | "confirmar" | "vigia";
  proxima: string;
}

interface Props {
  /** Quantos alvos em modo compra — quem o cron diário varre. */
  emCompra: number;
  /** Quantos em vigia permanente — quem o cron de segunda varre. */
  emVigia: number;
}

/** "3d 19h" · "3h 12min" · "48min" — sem segundos acima de um minuto, que só piscam. */
function faltando(ms: number): string {
  if (ms <= 0) return "a qualquer momento";
  const min = Math.floor(ms / 60000);
  if (min < 1) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  const h = Math.floor(min / 60);
  /* Acima de dois dias, "91h 12min" é um número que ninguém converte de cabeça —
     e a espera da vigia é sempre dessa ordem. */
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${min % 60}min` : `${min}min`;
}

export function ProximaVarredura({ emCompra, emVigia }: Props) {
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
  const vigia = agenda.find((a) => a.acao === "vigia");

  const hora = (iso: string) =>
    new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const diaDaSemana = (iso: string) =>
    new Date(iso).toLocaleDateString("pt-BR", { weekday: "long" }).replace("-feira", "");
  const falta = (iso: string) => faltando(new Date(iso).getTime() - Date.now());

  /* A varredura de compra só é notícia se houver alvo em compra; a de vigia, se
     houver alvo em vigia. Sem nenhum dos dois não há o que contar — e a tela já
     está mostrando o estado vazio logo abaixo. */
  const mostraCompra = emCompra > 0 && !!varrer;
  const mostraVigia = emVigia > 0 && !!vigia;
  if (!mostraCompra && !mostraVigia) return null;

  const num = "num font-semibold text-foreground";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />

      {mostraCompra && (
        <span>
          Próxima varredura em <span className={num}>{falta(varrer!.proxima)}</span>
          <span className="text-muted-foreground/80"> · {hora(varrer!.proxima)}</span>
        </span>
      )}

      {mostraCompra && confirmar && (
        /* A confirmação é a metade que tira o achado da quarentena. Sem ela na
           tela, "varreu e não apareceu nada" pareceria bug — quando é só o
           anúncio ainda não ter sido aberto e conferido.
           Só acompanha a compra: em vigia não há conferência nenhuma, e
           anunciá-la seria prometer um trabalho que ninguém vai fazer. */
        <span className="text-muted-foreground/80">
          · conferência dos achados às {hora(confirmar.proxima)}
        </span>
      )}

      {mostraVigia && (
        /* Quando não há nada em compra, esta É a próxima varredura — e a frase
           tem de dizer isso com todas as letras, senão a linha vira um detalhe
           de rodapé sobre a única coisa que o radar vai fazer na semana. */
        <span>
          {mostraCompra ? "· vigia semanal " : "Próxima varredura em "}
          {!mostraCompra && <span className={num}>{falta(vigia!.proxima)}</span>}
          {!mostraCompra && " · a vigia semanal, "}
          <span className={mostraCompra ? "text-muted-foreground/80" : undefined}>
            {diaDaSemana(vigia!.proxima)} {hora(vigia!.proxima)}
          </span>
          {mostraCompra && <span className="text-muted-foreground/80"> (em {falta(vigia!.proxima)})</span>}
        </span>
      )}
    </div>
  );
}
