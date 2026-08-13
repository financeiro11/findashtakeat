import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";
import { mesCurto } from "@/lib/demonstracoes-schema";

/* ---------------------------------------------------------------------------
 * A faixa de avisos da DRE/DFC, em UMA linha.
 *
 * Eram quatro blocos empilhados acima da grade — valores manuais, não
 * recorrentes, comentários, perguntas —, cada um com sua cor de fundo, seu
 * parágrafo explicando a regra e seus botões. Somados passavam de 200px: a
 * tabela, que é a página, começava abaixo da dobra.
 *
 * Três regras desenham a barra:
 *
 * 1. ÍCONE, NÚMERO, SUBSTANTIVO. Nada de parágrafo. A frase que explicava a
 *    regra ("só mês travado ganha comentário…") não sumiu — desceu para o
 *    rodapé do detalhe, que é onde ela é lida quando se quer entender, e não
 *    toda vez que se abre a página.
 *
 * 2. COR FORTE SÓ ONDE HÁ TRABALHO PENDENTE. O ícone mantém a cor que a célula
 *    já usa (o lápis roxo do valor manual é o mesmo da grade), mas o texto fica
 *    em cinza. O único selo colorido é o de pendência — "131 a conferir".
 *
 * 3. SEGMENTO SEM OCORRÊNCIA NÃO APARECE, e a barra some junto quando não
 *    sobra nenhum. Quem decide isso é cada segmento, devolvendo `null` — por
 *    isso o container se esconde por CSS (`:has`) em vez de exigir que a página
 *    recontasse tudo só para saber se vale desenhar a moldura.
 * ------------------------------------------------------------------------- */

/** A classe que marca um segmento de verdade — é ela que o `:has` procura. */
export const CLASSE_SEGMENTO = "seg-status";

/**
 * O recorte de que a barra fala: "JAN–JUL 26".
 *
 * Sem ele todo número da barra ficaria sem denominador — "10 valores manuais"
 * em quê? O ano só se repete quando o intervalo cruza a virada.
 */
export function rotuloPeriodo(colunas: string[]): string | null {
  if (!colunas.length) return null;
  const curto = (c: string) => mesCurto(c).toUpperCase();
  const primeiro = curto(colunas[0]);
  const ultimo = curto(colunas[colunas.length - 1]);
  if (primeiro === ultimo) return primeiro;

  const [mesA, anoA] = primeiro.split(" ");
  const [mesB, anoB] = ultimo.split(" ");
  return anoA === anoB ? `${mesA}–${mesB} ${anoB}` : `${primeiro}–${ultimo}`;
}

export function BarraStatus({
  periodo, acoes, children,
}: {
  /** "JAN–JUL 26" — o recorte de que a barra fala. */
  periodo: string | null;
  /** Regerar e o "⋯", à direita. Não contam como segmento. */
  acoes?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-3 flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-border bg-card pl-3.5 pr-1.5",
        // Sem nenhum segmento não há o que dizer: a moldura sumiria sozinha se
        // pudesse se contar, e é exatamente isso que o `:has` faz.
        "[&:not(:has(.seg-status))]:hidden",
      )}
    >
      {/* O tracinho entre segmentos é `::before` de todo segmento que TEM um
          irmão segmento antes — e não um elemento avulso. Como o segmento
          zerado não desenha nada, um separador de verdade ficaria órfão no
          começo, no fim ou dobrado no meio; a regra de irmão adjacente acerta
          sozinha em todos esses casos. */}
      <div className={cn(
        "flex min-w-0 items-center overflow-x-auto",
        "[&>.seg-status+.seg-status]:before:-ml-1.5 [&>.seg-status+.seg-status]:before:mr-1",
        "[&>.seg-status+.seg-status]:before:h-4",
        "[&>.seg-status+.seg-status]:before:w-px [&>.seg-status+.seg-status]:before:bg-border",
        "[&>.seg-status+.seg-status]:before:content-['']",
      )}>
        {periodo && (
          <span className="shrink-0 whitespace-nowrap pr-3 text-[10px] font-bold tracking-[0.1em] text-muted-foreground/70">
            {periodo}
          </span>
        )}
        {children}
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-1.5">{acoes}</div>}
    </div>
  );
}

/**
 * Um segmento da barra: ícone colorido, número, substantivo — e o detalhe atrás
 * de um clique.
 *
 * `detalhe` ausente = segmento que só informa (não abre popover e não ganha
 * seta), porque um clique que não leva a lugar nenhum é pior do que nenhum.
 */
export function SegmentoStatus({
  icone, valor, rotulo, sufixo, selo, titulo, detalhe, larguraDetalhe = 380,
}: {
  icone: React.ReactNode;
  /** O número, em fonte tabular. */
  valor: React.ReactNode;
  /** "valores manuais", "comentários" — sempre no plural certo. */
  rotulo: string;
  /** Complemento discreto depois do substantivo, tipo o total em reais. */
  sufixo?: React.ReactNode;
  /** O selo de pendência — o único lugar com cor forte na barra. */
  selo?: React.ReactNode;
  titulo?: string;
  detalhe?: React.ReactNode;
  larguraDetalhe?: number;
}) {
  const conteudo = (
    <>
      <span className="shrink-0">{icone}</span>
      <span className="num font-semibold text-foreground">{valor}</span>
      <span>{rotulo}</span>
      {sufixo && <span className="text-muted-foreground">{sufixo}</span>}
      {selo}
      {detalhe && <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />}
    </>
  );

  const classe = cn(
    CLASSE_SEGMENTO,
    "inline-flex h-7 shrink-0 items-center gap-[7px] whitespace-nowrap rounded-md px-2.5 text-[12px] text-foreground/85",
  );

  if (!detalhe) {
    return <span className={classe} title={titulo}>{conteudo}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title={titulo} className={cn(classe, "transition hover:bg-secondary")}>
          {conteudo}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0" style={{ width: larguraDetalhe }}>
        {detalhe}
      </PopoverContent>
    </Popover>
  );
}

/** O selo de pendência — vermelho, e só ele. */
export function SeloPendencia({ children, titulo }: { children: React.ReactNode; titulo?: string }) {
  return (
    <span
      title={titulo}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-px text-[11px] font-semibold text-primary"
    >
      <span className="h-[5px] w-[5px] rounded-full bg-primary" />
      {children}
    </span>
  );
}

/** Cabeçalho e rodapé do detalhe — a regra que saiu da barra mora no rodapé. */
export function DetalheStatus({
  titulo, nota, children,
}: {
  titulo: string;
  nota?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="border-b border-border px-3 py-2 text-[12px] font-semibold text-foreground">{titulo}</div>
      {children}
      {nota && (
        <div className="border-t border-border px-3 py-2 text-[10.5px] leading-snug text-muted-foreground">
          {nota}
        </div>
      )}
    </>
  );
}
