import { Link } from "react-router-dom";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { useNovidades } from "@/hooks/useNovidades";
import { ehBastidor, metaDoTipo, rotuloDoDia } from "@/lib/novidades";
import { Rocket, ArrowRight, CheckCheck } from "lucide-react";

/**
 * "O que mudou no Hub" dentro do Briefing.
 *
 * O briefing responde "como é o meu dia"; esta faixa responde a outra pergunta
 * da mesma manhã — "e a ferramenta, mudou o quê ontem?". Fica aqui porque é o
 * mesmo minuto de leitura: quem abre o briefing às 9h não vai a uma terceira
 * tela procurar changelog.
 *
 * Mostra o TOPO (os dias mais recentes com novidade, até 4 itens) e manda o
 * resto para /briefing/novidades. Bastidor não entra: aqui é o resumo.
 */
export function NovidadesResumo({ limite = 4 }: { limite?: number }) {
  const { dias, vistoAte, loading, naoLidos, marcarLido } = useNovidades(14);

  const comItens = dias
    .map((d) => ({ ...d, itens: d.itens.filter((i) => !ehBastidor(i)) }))
    .filter((d) => d.itens.length > 0);

  // achata mantendo a ordem (dia mais novo primeiro) e guarda de que dia é cada item
  const linhas = comItens
    .flatMap((d) => d.itens.map((i) => ({ item: i, dia: d.dia })))
    .slice(0, limite);
  const totalItens = comItens.reduce((s, d) => s + d.itens.length, 0);

  if (loading || linhas.length === 0) return null;

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-muted-foreground" /> O que mudou no Hub
          {naoLidos > 0 && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-primary">
              {naoLidos} nova{naoLidos === 1 ? "" : "s"}
            </span>
          )}
        </span>
      }
      subtitle={
        comItens[0]
          ? `última publicação ${rotuloDoDia(comItens[0].dia)} · ${totalItens} mudança${totalItens === 1 ? "" : "s"} nos últimos 14 dias`
          : undefined
      }
      actions={
        <div className="flex items-center gap-2">
          {naoLidos > 0 && (
            <button
              onClick={() => marcarLido()}
              title="Marcar as novidades como lidas"
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-secondary"
            >
              <CheckCheck className="h-3 w-3" /> li tudo
            </button>
          )}
          <Link to="/briefing/novidades" className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
            Ver todas <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <ul className="space-y-1.5">
        {linhas.map(({ item, dia }, i) => {
          const meta = metaDoTipo(item.tipo);
          const novo = !vistoAte || dia > vistoAte;
          const conteudo = (
            <>
              <span className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", meta.ponto)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-medium leading-snug text-foreground">{item.titulo}</span>
                  {item.area && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground">{item.area}</span>
                  )}
                  {novo && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">novo</span>
                  )}
                </div>
                {item.o_que_muda && (
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">{item.o_que_muda}</p>
                )}
              </div>
              <span className="num shrink-0 text-[10.5px] text-muted-foreground/80">{rotuloDoDia(dia)}</span>
            </>
          );
          return (
            <li key={i}>
              {item.rota ? (
                <Link
                  to={item.rota}
                  className="flex items-start gap-2.5 rounded-md border border-border bg-card px-2.5 py-2 transition hover:border-primary/40 hover:bg-secondary/40"
                >
                  {conteudo}
                </Link>
              ) : (
                <div className="flex items-start gap-2.5 rounded-md border border-border bg-card px-2.5 py-2">{conteudo}</div>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
