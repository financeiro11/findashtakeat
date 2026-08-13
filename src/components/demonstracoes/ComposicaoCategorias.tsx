import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { mesCurto } from "@/lib/demonstracoes-schema";
import { ChipSituacao } from "@/components/demonstracoes/ChipSituacao";
import {
  alternarCategoriaNoFiltro, categoriaMarcada, explicarCategoria,
  resumoComposicao, rotuloCategoria,
  type Categoria, type Composicao,
} from "@/lib/composicaoCategorias";

/* ---------------------------------------------------------------------------
 * "De que essa linha é feita?" — dentro do próprio painel da célula.
 *
 * A rubrica da DRE/DFC não é uma categoria do Omie: é o balde em que o DE-PARA
 * jogou várias. Conferir uma célula é, antes de tudo, saber quais categorias
 * caíram ali e quanto cada uma pesou — e isso não estava à vista: estava
 * escondido dentro do menu de filtro, que ninguém abre para LER.
 *
 * Detalhe de um chip, e não coluna nova na lista: a lista é conferida linha a
 * linha contra o Omie, na ordem de data, e agrupá-la por categoria tiraria dela
 * exatamente o que a torna conferível. A composição é outra leitura, e ganha
 * espaço próprio logo acima — sob demanda, atrás do chip CATEGORIAS.
 * ------------------------------------------------------------------------- */

/** Fatia pequena arredondada para "0%" pareceria zero; ela existe, só é miúda. */
const pctCurto = (p: number): string => {
  const v = p * 100;
  if (v > 0 && v < 0.1) return "<0,1%";
  return `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")}%`;
};

function LinhaCategoria({
  c, comp, marcada, onClicar, moeda, moedaSemCentavos,
}: {
  c: Categoria;
  comp: Composicao;
  marcada: boolean;
  onClicar: (() => void) | null;
  moeda: (n: number) => string;
  moedaSemCentavos: (n: number) => string;
}) {
  const celula = (v: number, tem: boolean) =>
    tem ? <span title={moeda(v)}>{moedaSemCentavos(v)}</span> : <span className="text-muted-foreground/50">—</span>;

  const sumiu = c.situacao === "sumiu";
  const explicacao = explicarCategoria(c, comp, moeda);

  return (
    <tr
      onClick={onClicar ?? undefined}
      className={cn(
        "border-b border-border/50 last:border-0",
        marcada && "bg-primary/[0.07]",
        onClicar && "cursor-pointer hover:bg-muted/60",
      )}
      title={onClicar
        ? `${explicacao}\n\nClique para ver só esta categoria na lista abaixo.`
        : explicacao}
    >
      {/* O corte vai no div, não no td: em tabela de layout automático o
          `max-width` da célula é só uma sugestão, e a descrição comprida
          empurraria as colunas de valor para fora do painel. */}
      <td className="px-5 py-1.5">
        <div className="flex max-w-[250px] items-center gap-1.5">
          {marcada && <Filter className="h-3 w-3 shrink-0 text-primary" />}
          <span className={cn("truncate text-[11px]", sumiu ? "text-muted-foreground" : "text-foreground")}>
            {c.descricao}
          </span>
        </div>
        {/* A barra é a leitura de um relance: qual categoria é a linha. O código
            do Omie fica no hover — ele importa na hora de corrigir, não na de ler. */}
        <div className="mt-1 flex items-center gap-1.5">
          <span className="h-1 w-[76px] shrink-0 overflow-hidden rounded-full bg-border">
            <span
              className={cn("block h-full rounded-full", sumiu ? "bg-transparent" : "bg-primary/70")}
              style={{ width: `${Math.max(c.peso * 100, c.peso > 0 ? 2 : 0)}%` }}
            />
          </span>
          <span
            className="truncate text-[9.5px] text-muted-foreground"
            title={c.codigos.length ? `Categoria no Omie: ${c.codigos.join(", ")}` : undefined}
          >
            {sumiu
              ? "sem lançamento neste mês"
              : `${pctCurto(c.peso)} · ${c.lancamentos} ${c.lancamentos === 1 ? "lançamento" : "lançamentos"}`}
          </span>
        </div>
      </td>
      {comp.temHistorico && (
        <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] num text-muted-foreground">
          {celula(c.valorAnterior, c.situacao !== "novo" && c.situacao !== "voltou")}
        </td>
      )}
      <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] num font-medium text-foreground">
        {celula(c.valor, !sumiu)}
      </td>
      {comp.temHistorico && (
        <td className="px-5 py-1.5 text-right">
          <ChipSituacao
            situacao={c.situacao}
            favoravel={c.favoravel}
            rotulo={rotuloCategoria(c)}
            titulo={explicacao}
          />
        </td>
      )}
    </tr>
  );
}

/**
 * O rótulo do chip CATEGORIAS da linha RESUMO — sem valores, que quem formata
 * dinheiro é a tela. Fica junto da tabela para os dois dizerem a mesma coisa.
 */
export function resumoDaComposicao(comp: Composicao, marcadas: Set<string>): string {
  const filtrando = comp.categorias.filter((c) => categoriaMarcada(c, marcadas)).length;
  return filtrando > 0 ? `${filtrando} de ${comp.quantas}` : String(comp.quantas);
}

/**
 * O detalhe do chip CATEGORIAS: de que a linha é feita.
 *
 * O cabeçalho recolhível saiu — quem abre e fecha é o chip da linha RESUMO, e
 * só um detalhe fica aberto por vez. O teto de altura é o que impede esta
 * tabela de empurrar a lista de lançamentos para fora da tela.
 *
 * A TABELA NÃO OBEDECE AO FILTRO. Ela descreve a célula inteira — é isso que a
 * torna uma conferência. Filtrar a composição pelo filtro da lista faria as
 * fatias somarem 100% de um pedaço escolhido a dedo.
 */
export function ComposicaoCategorias({
  comp, marcadas, onMarcadas, moeda, moedaSemCentavos,
}: {
  comp: Composicao;
  /** As chaves de categoria marcadas no filtro da lista. */
  marcadas: Set<string>;
  onMarcadas: (s: Set<string>) => void;
  moeda: (n: number) => string;
  /** Sem centavos, para a tabela caber. O valor cheio vai no hover. */
  moedaSemCentavos: (n: number) => string;
}) {
  const maior = comp.categorias.find((c) => c.situacao !== "sumiu");
  const filtrando = comp.categorias.filter((c) => categoriaMarcada(c, marcadas)).length;

  return (
    <div className="flex max-h-[min(32%,260px)] shrink-0 flex-col overflow-hidden border-b border-border bg-muted/30">
      <div className="shrink-0 bg-card px-5 py-2 text-[11.5px] text-muted-foreground">
        <b className="text-foreground">{resumoComposicao(comp)}</b>
        {/* Uma categoria sozinha não tem "maior": a linha É ela. */}
        {maior && comp.quantas > 1 && <> · {pctCurto(maior.peso)} em {maior.descricao}</>}
        {filtrando > 0 && (
          <span className="ml-1.5 text-primary">
            · filtrando {filtrando === 1 ? "1 categoria" : `${filtrando} categorias`}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-border">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-muted/95 backdrop-blur">
            <tr className="border-b border-border text-[9px] font-semibold tracking-[0.06em] text-muted-foreground">
              <th className="px-5 py-1.5 text-left">CATEGORIA NO OMIE</th>
              {comp.temHistorico && (
                <th className="px-2 py-1.5 text-right uppercase">{mesCurto(comp.mesAnterior)}</th>
              )}
              <th className="px-2 py-1.5 text-right uppercase">{mesCurto(comp.mes)}</th>
              {comp.temHistorico && <th className="px-5 py-1.5 text-right">VARIAÇÃO</th>}
            </tr>
          </thead>
          <tbody>
            {comp.categorias.map((c) => (
              <LinhaCategoria
                key={c.descricao}
                c={c}
                comp={comp}
                marcada={categoriaMarcada(c, marcadas)}
                /* Quem sumiu não tem o que filtrar neste mês: clicar
                   esvaziaria a lista sem dizer por quê. */
                onClicar={c.chaves.length ? () => onMarcadas(alternarCategoriaNoFiltro(c, marcadas)) : null}
                moeda={moeda}
                moedaSemCentavos={moedaSemCentavos}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border bg-muted/40 px-5 py-1.5 text-[10px] text-muted-foreground">
        <span>
          {comp.temHistorico
            ? `Percentuais sobre o movimento da célula inteira; comparação com os ${comp.janela.length - 1} meses anteriores no Omie.`
            : "Percentuais sobre o movimento da célula inteira. Sem mês anterior no cache do Omie para comparar."}
        </span>
        {filtrando > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onMarcadas(new Set()); }}
            className="shrink-0 font-medium underline-offset-2 transition hover:text-foreground hover:underline"
          >
            ver todas na lista
          </button>
        )}
      </div>
    </div>
  );
}
