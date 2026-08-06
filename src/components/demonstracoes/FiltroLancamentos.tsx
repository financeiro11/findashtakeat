import { Search, X, ListFilter, Check, ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  filtroVazio, filtroInicial,
  type CategoriaNaCelula, type Filtro, type Ordem,
} from "@/lib/filtroLancamentos";

/* ---------------------------------------------------------------------------
 * A barra de filtros do drill-down.
 *
 * Fica ACIMA da lista e ABAIXO dos números do cabeçalho de propósito: os
 * números de cima (na tela × soma dos lançamentos × quantidade) são a prova de
 * que a lista está completa, e é o que confere com a demonstração. Filtro
 * nenhum pode mexer neles — senão o carimbo "a soma bate exatamente" viraria
 * uma comparação entre a célula e um pedaço escolhido a dedo. Por isso o que a
 * busca devolve é contado aqui embaixo, ao lado do filtro que o produziu.
 * ------------------------------------------------------------------------- */

export function BarraFiltros({
  filtro, onFiltro, categorias, total, mostrados, somaMostrada, moeda,
}: {
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
  categorias: CategoriaNaCelula[];
  /** Quantos lançamentos a célula tem ao todo. */
  total: number;
  mostrados: number;
  somaMostrada: number;
  moeda: (n: number) => string;
}) {
  const marcadas = filtro.categorias.size;
  const limpo = filtroVazio(filtro);

  const alternarCategoria = (chave: string) => {
    const c = new Set(filtro.categorias);
    if (c.has(chave)) c.delete(chave); else c.add(chave);
    onFiltro({ ...filtro, categorias: c });
  };

  return (
    <div className="shrink-0 border-b border-border bg-card px-5 py-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filtro.busca}
            onChange={(e) => onFiltro({ ...filtro, busca: e.target.value })}
            placeholder="Buscar fornecedor, título, NF, categoria…"
            className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-7 text-[11.5px] outline-none transition placeholder:text-muted-foreground/70 focus:border-primary/50"
          />
          {!!filtro.busca && (
            <button
              onClick={() => onFiltro({ ...filtro, busca: "" })}
              title="Limpar a busca"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Uma só categoria não é escolha: o botão só aparece quando há o que
            separar dentro da célula. */}
        {categorias.length > 1 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-medium transition",
                  marcadas
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary",
                )}
                title="Separar por categoria do Omie — é ela que decide em que linha da demonstração o valor cai"
              >
                <ListFilter className="h-3.5 w-3.5" />
                {marcadas ? `${marcadas} de ${categorias.length} categorias` : "Categorias"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[340px] p-0">
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                <span className="text-[10px] font-bold tracking-[0.1em] text-muted-foreground">
                  O QUE COMPÕE ESTA LINHA
                </span>
                {!!marcadas && (
                  <button
                    onClick={() => onFiltro({ ...filtro, categorias: new Set() })}
                    className="text-[10.5px] font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
                  >
                    ver todas
                  </button>
                )}
              </div>
              <div className="max-h-[260px] overflow-auto py-1">
                {categorias.map((c) => {
                  const on = filtro.categorias.has(c.chave);
                  return (
                    <button
                      key={c.chave}
                      onClick={() => alternarCategoria(c.chave)}
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition hover:bg-muted/60"
                    >
                      <span className={cn(
                        "mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                      )}>
                        {on && <Check strokeWidth={3} className="h-2.5 w-2.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] text-foreground">{c.descricao}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {c.lancamentos} {c.lancamentos === 1 ? "lançamento" : "lançamentos"} · {moeda(c.total)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Só aparece quando há filtro: sem ele a contagem já está no cabeçalho, e
          repeti-la seria dizer duas vezes o mesmo número. */}
      {!limpo && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
          <span
            className="text-muted-foreground"
            title="Os números do topo continuam sendo os da célula inteira — são eles que conferem com a demonstração."
          >
            {mostrados === 0
              ? "Nenhum lançamento com esses filtros"
              : <>Mostrando <b className="text-foreground">{mostrados} de {total}</b> · soma <b className="num text-foreground">{moeda(somaMostrada)}</b></>}
          </span>
          <button
            onClick={() => onFiltro(filtroInicial())}
            className="shrink-0 font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
          >
            limpar filtros
          </button>
        </div>
      )}
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
