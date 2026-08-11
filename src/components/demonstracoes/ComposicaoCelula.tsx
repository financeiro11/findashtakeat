import { useState } from "react";
import { Sigma, TriangleAlert, ChevronRight, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import {
  composicaoDaCelula, temComposicao, type Composicao, type LeitorDaCelula,
} from "@/lib/composicaoCelula";

/* ---------------------------------------------------------------------------
 * A conta por trás da célula de resultado — vale na DRE e na DFC.
 *
 * A folha sempre pôde ser conferida: clica e vêm os lançamentos do Omie. As
 * linhas que se lê PRIMEIRO — Receita Líquida, Margem de contribuição, EBITDA,
 * Lucro Líquido e as margens na DRE; Fluxo de Caixa Operacional e Fluxo Livre na
 * DFC — não podiam: mostravam um número gravado no blob sem dizer de onde ele
 * saiu, e quando o gravado descolava das rubricas acima dele ninguém tinha como
 * perceber.
 *
 * Aqui a célula abre a conta: as parcelas com o valor que estão mostrando na
 * grade, a soma delas e o número gravado, lado a lado. Quando os dois não
 * batem, isso é dito com todas as letras e a marca fica ACESA na grade, fora do
 * hover — divergência que só aparece quando se passa o mouse é divergência que
 * ninguém encontra.
 *
 * Descer um nível troca o foco do painel em vez de abrir outro: conferir a
 * margem é quase sempre descer até a rubrica que a moveu, e reabrir popover a
 * cada passo perderia o caminho percorrido.
 * ------------------------------------------------------------------------- */

const fmt = (v: number | null | undefined): string =>
  v == null ? "—" : valorExato(v, { moeda: false, casas: 0 });

const fmtPct = (v: number | null | undefined): string =>
  v == null ? "—" : `${(v * 100).toFixed(2).replace(".", ",")}%`;

const moedaCheia = (v: number | null | undefined): string =>
  v == null ? "—" : valorExato(v);

/** Frase curta para o `title` da célula — a conferência sem precisar abrir nada. */
export function tituloComposicao(c: Composicao | null): string | null {
  if (!c) return null;
  if (c.tipo === "percentual") {
    const n = c.numerador?.rotulo ?? "";
    const d = c.denominador?.rotulo ?? "";
    return c.divergente
      ? `${n} ÷ ${d} = ${fmtPct(c.calculado)}, mas a base guarda ${fmtPct(c.guardado)}`
      : `${n} ÷ ${d}`;
  }
  const conta = c.parcelas.map((p) => p.rotulo).join(" + ");
  return c.divergente
    ? `⚠ ${conta} somam ${moedaCheia(c.calculado)}, mas a base guarda ${moedaCheia(c.guardado)}`
    : `= ${conta}`;
}

function Linha({
  rotulo, valor, operador, onAbrir, percentual,
}: {
  rotulo: string;
  valor: number | null;
  operador: string;
  onAbrir: (() => void) | null;
  percentual?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={!onAbrir}
      onClick={onAbrir ?? undefined}
      className={cn(
        "flex w-full items-baseline gap-2 px-4 py-1.5 text-left",
        onAbrir ? "cursor-pointer hover:bg-muted/60" : "cursor-default",
      )}
      title={valor == null ? undefined : moedaCheia(valor)}
    >
      <span className="w-3 shrink-0 text-[12px] text-muted-foreground num">{operador}</span>
      <span className="flex-1 truncate text-[12px] text-foreground/90">{rotulo}</span>
      {onAbrir && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
      <span className={cn("shrink-0 text-[12px] num tabular-nums", (valor ?? 0) < 0 && "text-primary")}>
        {percentual ? fmtPct(valor) : fmt(valor)}
      </span>
    </button>
  );
}

function Painel({
  rotulo, mesLabel, ler,
}: {
  rotulo: string;
  mesLabel: string;
  ler: LeitorDaCelula;
}) {
  const [trilha, setTrilha] = useState<string[]>([rotulo]);
  const foco = trilha[trilha.length - 1];
  const c = composicaoDaCelula(foco, ler);

  if (!c) return <div className="px-4 py-3 text-[12px] text-muted-foreground">Sem conta para mostrar.</div>;

  const percentual = c.tipo === "percentual";
  const abrir = (r: string) => (temComposicao(r, ler.tipo) ? () => setTrilha((t) => [...t, r]) : null);

  return (
    <>
      <div className="border-b border-border px-4 pb-2.5 pt-3">
        <div className="text-[13px] font-semibold leading-tight text-foreground">
          {c.rotulo}
          <span className="font-normal text-muted-foreground"> · {mesLabel}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {percentual
            ? "Esta linha é uma divisão — não há número gravado que ela deva obedecer."
            : c.tipo === "filhos"
              ? "Soma das rubricas que descem dela."
              : `Cascata da ${ler.tipo.toUpperCase()}: soma das linhas acima.`}
        </div>
        {trilha.length > 1 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
            {trilha.map((r, i) => (
              <span key={r + i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <button
                  type="button"
                  onClick={() => setTrilha((t) => t.slice(0, i + 1))}
                  className={cn(
                    i === trilha.length - 1
                      ? "font-medium text-foreground"
                      : "text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground",
                  )}
                >
                  {r}
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="max-h-[280px] overflow-y-auto py-1">
        {percentual ? (
          <>
            <Linha rotulo={c.numerador!.rotulo} valor={c.numerador!.valor} operador=""
                   onAbrir={abrir(c.numerador!.rotulo)} />
            <Linha rotulo={c.denominador!.rotulo} valor={c.denominador!.valor} operador="÷"
                   onAbrir={abrir(c.denominador!.rotulo)} />
          </>
        ) : (
          c.parcelas.map((p, i) => (
            <Linha key={p.rotulo} rotulo={p.rotulo} valor={p.valor} operador={i === 0 ? "" : "+"}
                   onAbrir={abrir(p.rotulo)} />
          ))
        )}
      </div>

      <div className="border-t border-border px-4 py-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] font-medium text-foreground">
            {percentual ? "Divisão" : "Soma das parcelas"}
          </span>
          <span
            className={cn("text-[12.5px] font-semibold num tabular-nums", (c.calculado ?? 0) < 0 && "text-primary")}
            title={percentual ? undefined : moedaCheia(c.calculado)}
          >
            {percentual ? fmtPct(c.calculado) : fmt(c.calculado)}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3">
          <span className="text-[11.5px] text-muted-foreground">Gravado na base</span>
          <span className="text-[11.5px] text-muted-foreground num tabular-nums"
                title={percentual ? undefined : moedaCheia(c.guardado)}>
            {percentual ? fmtPct(c.guardado) : fmt(c.guardado)}
          </span>
        </div>
      </div>

      {c.divergente ? (
        <div className="flex items-start gap-2 border-t border-amber-300 bg-amber-50 px-4 py-2.5 text-[11.5px] text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <b>
              {percentual
                ? `Diferença de ${((c.diferenca ?? 0) * 100).toFixed(2).replace(".", ",")} p.p.`
                : `Diferença de ${moedaCheia(Math.abs(c.diferenca ?? 0))}`}
            </b>{" "}
            entre o que está gravado e o que as parcelas somam. O número na grade é o gravado — quem
            escreveu esta coluna (tracker, Omie ou valor manual) deixou o total para trás. Reimportar
            o mês ou recalcular com o Omie realinha.
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-border bg-emerald-50/60 px-4 py-2 text-[11.5px] text-emerald-800">
          <Check className="h-3.5 w-3.5 shrink-0" />
          {percentual
            ? "A margem corresponde aos dois números acima."
            : "O valor gravado é a soma das parcelas."}
        </div>
      )}
    </>
  );
}

/**
 * A marca na célula. Só aparece onde há conta a mostrar; fica visível no hover da
 * linha, como o lápis do valor manual — SALVO quando diverge, e aí fica acesa
 * sempre, porque é exatamente o que ninguém pode deixar de ver.
 */
export function MarcaComposicao({
  rubrica, mesLabel, ler, divergente,
}: {
  rubrica: string;
  mesLabel: string;
  ler: LeitorDaCelula;
  divergente: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  /* Só monta o painel no primeiro clique: com "Todos os anos" a grade passa de
     mil células, e mil árvores de componente para abrir uma seria desperdício. */
  const [montado, setMontado] = useState(false);

  const gatilho = (
    <button
      type="button"
      /* A célula pode ter clique próprio (curadoria do EBITDA Ajustado): sem o
         stopPropagation, abrir a conta abriria a gaveta por baixo. */
      onClick={(e) => { e.stopPropagation(); if (!montado) { setMontado(true); setAberto(true); } }}
      title={divergente
        ? "Este total não bate com as parcelas — clique para ver a conta"
        : "Ver de que esta célula é feita"}
      /* `invisible` e não `hidden`: fora do hover o Σ some da vista e do clique,
         mas segue ocupando o espaço — o número não dança quando o mouse entra e
         sai da linha. Divergente fica aceso sempre: aviso escondido no hover é
         aviso que ninguém encontra. */
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition hover:bg-black/10",
        divergente
          ? "text-amber-600"
          : "invisible text-muted-foreground/70 group-hover/linha:visible",
      )}
    >
      {divergente ? <TriangleAlert className="h-3 w-3" /> : <Sigma className="h-3 w-3" />}
    </button>
  );

  if (!montado) return gatilho;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>{gatilho}</PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] p-0 text-left" onClick={(e) => e.stopPropagation()}>
        <Painel rotulo={rubrica} mesLabel={mesLabel} ler={ler} />
      </PopoverContent>
    </Popover>
  );
}
