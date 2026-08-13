import { Search, X, ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { filtroVazio, filtroInicial, type Filtro, type Ordem } from "@/lib/filtroLancamentos";

/* ---------------------------------------------------------------------------
 * A busca e o rodapé da lista do drill-down.
 *
 * A busca subiu para a linha RESUMO — uma faixa a menos entre o cabeçalho e a
 * lista — e a contagem desceu para um rodapé FIXO. Antes ela morava numa
 * terceira linha que aparecia e sumia conforme o filtro, empurrando a lista para
 * cima e para baixo no meio da leitura.
 *
 * O que não mudou é a regra que importa: os números do cabeçalho (na tela ×
 * soma dos lançamentos) são a prova de que a lista está completa, e filtro
 * nenhum mexe neles — senão o carimbo "confere" viraria uma comparação entre a
 * célula e um pedaço escolhido a dedo. Por isso o resultado do filtro é contado
 * aqui embaixo, longe deles.
 * ------------------------------------------------------------------------- */

/** A busca da linha RESUMO. Pílula, para casar com os chips ao lado. */
export function BuscaLancamentos({
  filtro, onFiltro, className,
}: {
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={filtro.busca}
        onChange={(e) => onFiltro({ ...filtro, busca: e.target.value })}
        placeholder="Buscar…"
        title="Busca fornecedor, lojista do cartão, título, NF e categoria"
        className="h-[26px] w-full rounded-full border border-border bg-background pl-7 pr-7 text-[11.5px] outline-none transition placeholder:text-muted-foreground/70 focus:border-primary/50"
      />
      {!!filtro.busca && (
        <button
          onClick={() => onFiltro({ ...filtro, busca: "" })}
          title="Limpar a busca"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/**
 * O rodapé fixo da lista: quantos lançamentos e em que ordem.
 *
 * Fixo é o ponto. Com filtro em pé ele diz o recorte e oferece a volta; sem
 * filtro ele diz o total e a ordenação. Nos dois casos ocupa a MESMA altura, e
 * a lista não pula de tamanho a cada tecla digitada na busca.
 */
export function RodapeLista({
  filtro, onFiltro, total, mostrados, somaMostrada, moeda,
}: {
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
  /** Quantos lançamentos a célula tem ao todo. */
  total: number;
  mostrados: number;
  somaMostrada: number;
  moeda: (n: number) => string;
}) {
  const limpo = filtroVazio(filtro);
  const ordem = filtro.ordem === "maior" ? "Maior valor primeiro"
    : filtro.ordem === "menor" ? "Menor valor primeiro"
    : "Ordenado por data";

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-1.5 text-[11px] text-muted-foreground">
      <span className="min-w-0 truncate">
        {limpo ? (
          <>{total} {total === 1 ? "lançamento" : "lançamentos"} · nenhum filtro</>
        ) : mostrados === 0 ? (
          "Nenhum lançamento com esses filtros"
        ) : (
          <span title="Os números do topo continuam sendo os da célula inteira — são eles que conferem com a demonstração.">
            Mostrando <b className="text-foreground">{mostrados} de {total}</b>
            {" · soma "}<b className="num text-foreground">{moeda(somaMostrada)}</b>
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {!limpo && (
          <button
            onClick={() => onFiltro(filtroInicial())}
            className="font-medium underline-offset-2 transition hover:text-foreground hover:underline"
          >
            limpar filtros
          </button>
        )}
        <span>{ordem}</span>
      </span>
    </div>
  );
}

/**
 * O cabeçalho da coluna VALOR, que ordena.
 *
 * Cicla data → maior → menor → data. A volta para "data" não é enfeite: é a
 * ordem em que o extrato do Omie é conferido linha a linha, e sair dela é uma
 * escolha que precisa ser desfeita com um clique, não recarregando o painel.
 */
export function CabecalhoValor({ ordem, onOrdem }: { ordem: Ordem; onOrdem: (o: Ordem) => void }) {
  const proxima: Record<Ordem, Ordem> = { data: "maior", maior: "menor", menor: "data" };
  const Icone = ordem === "maior" ? ArrowDownWideNarrow : ordem === "menor" ? ArrowUpNarrowWide : ChevronsUpDown;

  return (
    <button
      onClick={() => onOrdem(proxima[ordem])}
      title={
        ordem === "maior" ? "Maior primeiro (por tamanho, ignorando o sinal) — clique para inverter"
        : ordem === "menor" ? "Menor primeiro — clique para voltar à ordem de data"
        : "Ordenado por data. Clique para pôr o maior valor primeiro"
      }
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-background/60 hover:text-foreground",
        ordem !== "data" && "text-foreground",
      )}
    >
      VALOR
      <Icone className={cn("h-3 w-3", ordem === "data" && "opacity-40")} />
    </button>
  );
}
