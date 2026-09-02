import { useMemo } from "react";
import { CircleOff } from "lucide-react";
import { chaveCelula } from "@/components/demonstracoes/Reclassificacoes";
import { DetalheStatus, SegmentoStatus } from "@/components/demonstracoes/BarraStatus";
import { fraseDaAusencia, type Ausencia } from "@/lib/justificativas";
import { mesCurto } from "@/lib/demonstracoes-schema";

/* ---------------------------------------------------------------------------
 * A rubrica que vinha todo mês e este mês não veio.
 *
 * É a única leitura da DRE/DFC que roda em MÊS ABERTO — e é de propósito. Todo
 * o resto da inteligência da tela (o comentário automático, os drivers, os
 * sinais) só liga quando a coluna é travada, porque texto escrito sobre um mês
 * pela metade envelhece congelado. Só que o fechamento acontece justamente no
 * mês aberto: é ali que se descobre que a receita financeira não entrou, e ali
 * não havia nada olhando.
 *
 * O que torna isso seguro no mês em curso é que aqui NADA é escrito: não há IA,
 * não há gravação, não há comentário para envelhecer. É uma constatação
 * recalculada a cada abertura da página — se o lançamento entrar amanhã, o aviso
 * some sozinho.
 *
 * E NÃO É UMA MARCA NOVA NA GRADE. A célula da DRE/DFC tem uma marca só para
 * "conversa sobre este número": onde há comentário é o balão, onde não há é o
 * "?". A ausência não ganha um ícone ao lado — ela ACENDE o "?" que já estava
 * ali (invisível até o hover) e põe dentro dele o fato e o botão que manda a IA
 * procurar. Duas marcas lado a lado alargariam a grade inteira para dizer a
 * mesma coisa duas vezes.
 * ------------------------------------------------------------------------- */

export type { Ausencia } from "@/lib/justificativas";

export const rotuloMesAusencia = (k: string) => mesCurto(k);

/** Indexado como as outras marcas da célula, para a grade consultar em O(1). */
export function mapaDeAusencias(lista: Ausencia[]): Map<string, Ausencia> {
  const m = new Map<string, Ausencia>();
  for (const a of lista) m.set(chaveCelula(a.rubrica, a.mes), a);
  return m;
}

export const tituloAusencia = (a: Ausencia): string =>
  fraseDaAusencia(a, rotuloMesAusencia);

/**
 * A pergunta que o botão manda.
 *
 * Escrita como PERGUNTA e não como ordem: quem responde é a mesma função do
 * "?", cuja triagem decide entre explicar e propor correção. Pedir "conserte"
 * aqui faria a IA propor troca de categoria antes de saber se há o que trocar —
 * e o caminho da correção continua a um repique de distância, com o fio inteiro
 * já no prompt.
 */
export const perguntaSugerida = (a: Ausencia): string =>
  `${fraseDaAusencia(a, rotuloMesAusencia)} `
  + `Procure no mês inteiro se esse valor caiu em outra rubrica, se ficou sem DE-PARA, `
  + `ou se realmente não houve movimento. Diga o que encontrou.`;

/* ============================================================
 *  Resumo acima da tabela
 * ============================================================ */

export function ResumoAusencias({
  lista, colunas,
}: { lista: Ausencia[]; colunas: string[] }) {
  const visiveis = useMemo(() => {
    const cols = new Set(colunas);
    const ordem = new Map(colunas.map((c, i) => [c, i]));
    return lista
      .filter((a) => cols.has(a.mes))
      .sort((a, b) => (ordem.get(b.mes)! - ordem.get(a.mes)!)   // mês mais recente primeiro
        || Math.abs(b.serie.mediana) - Math.abs(a.serie.mediana));
  }, [lista, colunas]);

  if (!visiveis.length) return null;

  /* O que costuma entrar e não entrou. É a régua do segmento: "4 rubricas" não
     diz nada sozinho, "4 rubricas · R$ 61 mil" diz se vale parar o que se está
     fazendo. */
  const total = visiveis.reduce((s, a) => s + Math.abs(a.serie.mediana), 0);
  const brl = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  return (
    <SegmentoStatus
      icone={<CircleOff strokeWidth={2.2} className="h-[13px] w-[13px] text-amber-600" />}
      valor={visiveis.length}
      rotulo={visiveis.length === 1 ? "rubrica não veio" : "rubricas não vieram"}
      /* Em `sufixo` e não em selo de pendência: o segmento só existe quando há
         ocorrência, e o ícone já é âmbar — um selo forte por cima seria o mesmo
         aviso dado duas vezes. O número em R$ está aqui porque "4 rubricas" não
         diz se vale parar o que se está fazendo; "~R$ 61 mil" diz. */
      sufixo={`~${brl(total)}`}
      titulo="Rubricas com valor em quase todo mês que neste mês estão zeradas ou sem linha. O valor é a soma das medianas — a ordem de grandeza do que não entrou."
      larguraDetalhe={440}
      detalhe={
        <DetalheStatus
          titulo="Rubricas recorrentes que não vieram"
          nota="Vale para mês aberto também — é a única leitura que roda no mês em curso, porque não escreve nada: se o lançamento entrar, o aviso some sozinho. Para mandar a IA procurar onde o valor foi parar, clique no “?” âmbar dentro da célula."
        >
          <div className="max-h-[320px] overflow-y-auto py-1">
            {visiveis.map((a) => (
              <div key={chaveCelula(a.rubrica, a.mes)} className="px-3 py-1.5 hover:bg-secondary/60">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[11.5px] font-medium text-foreground">
                    {a.rubrica}
                    <span className="text-muted-foreground"> · {rotuloMesAusencia(a.mes)}</span>
                  </div>
                  <div className="num shrink-0 text-[11px] text-muted-foreground">
                    costuma trazer {brl(Math.abs(a.serie.mediana))}
                  </div>
                </div>
                <div className="text-[10.5px] leading-snug text-muted-foreground">
                  {a.serie.meses >= a.serie.janela
                    ? `Veio nos ${a.serie.janela} meses anteriores`
                    : `Veio em ${a.serie.meses} dos ${a.serie.janela} meses anteriores`}
                  {a.serie.ultimoMes && a.serie.ultimoValor != null
                    && ` · último ${brl(Math.abs(a.serie.ultimoValor))} em ${rotuloMesAusencia(a.serie.ultimoMes)}`}
                  {` · agora ${a.serie.zerada ? "zerada" : "sem linha"}`}
                </div>
              </div>
            ))}
          </div>
        </DetalheStatus>
      }
    />
  );
}
