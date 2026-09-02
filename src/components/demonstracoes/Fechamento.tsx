import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck, Loader2, CircleOff, Layers, TriangleAlert, Sigma, TrendingUp,
  ArrowRight, RefreshCw, ListChecks, Check,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { mesCurto } from "@/lib/demonstracoes-schema";
import {
  contarPorFrente, montarFechamento, FRENTES,
  type CategoriaOrfa, type ClassificacaoSuspeita, type Frente,
  type Pendencia, type TotalDivergente,
} from "@/lib/fechamento";
import type { Ausencia, Recorde } from "@/lib/justificativas";

/* ---------------------------------------------------------------------------
 * "O que falta fechar" — o painel do mês em curso.
 *
 * A DRE/DFC tinha inteligência para o mês FECHADO (o comentário automático, os
 * drivers, os sinais) e nada para o mês em curso, que é justamente onde o
 * fechamento acontece. Este painel é a outra metade — e é um objeto de contrato
 * diferente, não uma flexibilização daquele:
 *
 *   NADA AQUI É GRAVADO. Sem IA, sem tabela, sem comentário. É uma constatação
 *   recalculada a cada abertura; some sozinha quando o lançamento entra. Por
 *   isso pode existir num mês cujos números ainda vão mudar — não há o que
 *   envelhecer.
 *
 * O PORQUÊ CONTINUA SENDO DO "?" DA CÉLULA. O painel diz o QUE está pendente e
 * leva até a célula; quem explica é a pergunta, um clique depois, quando alguém
 * quer saber de UMA delas. Uma IA que redigisse este painel inteiro gastaria uma
 * chamada por item para dizer o que a régua já disse.
 *
 * Uma pendência resolvida some da lista sozinha — não há "marcar como feito", e
 * é de propósito: um estado que a pessoa marca é um estado que envelhece errado
 * (marca-se "ok", o lançamento muda, e a lista mente). O que sobrevive à sessão
 * é o card "Fechamento" das tarefas, que já existe e é onde o trabalho mora.
 * ------------------------------------------------------------------------- */

const ICONE: Record<Frente, typeof CircleOff> = {
  ausencia: CircleOff,
  sem_de_para: Layers,
  classificacao: TriangleAlert,
  total: Sigma,
  recorde: TrendingUp,
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/* ============================================================
 *  As categorias órfãs — a única checagem que vem do servidor
 * ============================================================
 * As outras quatro a página já tem em memória. Esta desce nos lançamentos do
 * Omie, então mora numa RPC (`demonstracoes_sem_de_para`, migration
 * 20260901234500) e carrega só quando o painel abre: é a diferença entre a
 * página abrir na hora e a página esperar meio segundo por algo que ninguém
 * pediu ainda.
 */
export function useCategoriasOrfas(tipo: "dre" | "dfc", mes: string | null, ativo: boolean) {
  const [orfas, setOrfas] = useState<CategoriaOrfa[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!mes) { setOrfas([]); return; }
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc("demonstracoes_sem_de_para" as never, {
      p_tipo: tipo, p_meses: [mes],
    } as never);
    setCarregando(false);
    if (error) {
      // Acessória como as outras marcas: a lista aparece sem esta frente em vez
      // de o painel inteiro não abrir.
      setOrfas([]);
      setErro(error.message);
      return;
    }
    /* `numeric` e `bigint` chegam como STRING pelo PostgREST (ele não arrisca a
       precisão do JSON), e string entra silenciosamente em `sort` e em `sum`
       como concatenação. Coagir na entrada é mais barato que caçar depois. */
    setOrfas(((data ?? []) as CategoriaOrfa[]).map((o) => ({
      ...o,
      quantidade: Number(o.quantidade) || 0,
      valor: Number(o.valor) || 0,
      meses_antes: Number(o.meses_antes) || 0,
    })));
  }, [tipo, mes]);

  useEffect(() => { if (ativo) carregar(); }, [ativo, carregar]);

  return { orfas, carregandoOrfas: carregando, erroOrfas: erro, recarregarOrfas: carregar };
}

/* ============================================================
 *  O gatilho, na barra de status
 * ============================================================ */

export function BotaoFechamento({
  mes, quantas, onAbrir,
}: { mes: string | null; quantas: number; onAbrir: () => void }) {
  if (!mes) return null;
  return (
    <button
      onClick={onAbrir}
      title={`O que ainda não fecha em ${mesCurto(mes)} — constatações do mês em curso, recalculadas na hora`}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[11.5px] font-medium transition",
        quantas > 0
          ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
          : "border-border bg-card text-foreground hover:bg-secondary",
      )}
    >
      <ClipboardCheck className="h-3 w-3" />
      Fechar {mesCurto(mes)}
      {quantas > 0 && <span className="num font-bold">· {quantas}</span>}
    </button>
  );
}

/* ============================================================
 *  O painel
 * ============================================================ */

export function PainelFechamento({
  aberto, onFechar, tipo, mes, ausencias, orfas, suspeitas, totais, recordes,
  carregandoOrfas, erroOrfas, onRecarregar, onIrParaCelula, onVirarSubtarefa,
}: {
  aberto: boolean;
  onFechar: () => void;
  tipo: "dre" | "dfc";
  mes: string | null;
  ausencias: Ausencia[];
  orfas: CategoriaOrfa[];
  suspeitas: ClassificacaoSuspeita[];
  totais: TotalDivergente[];
  recordes: Recorde[];
  carregandoOrfas: boolean;
  erroOrfas: string | null;
  onRecarregar: () => void;
  /** Leva à célula (abre o drill-down). Nulo em pendência sem célula. */
  onIrParaCelula: (rubrica: string, mes: string) => void;
  /** Manda a pendência para o checklist do card "Fechamento" das tarefas. */
  onVirarSubtarefa: (p: Pendencia) => Promise<void>;
}) {
  const [filtro, setFiltro] = useState<Frente | null>(null);
  const [enfileirando, setEnfileirando] = useState<string | null>(null);
  const [enfileiradas, setEnfileiradas] = useState<Set<string>>(new Set());

  const pendencias = useMemo(
    () => (mes ? montarFechamento({
      mes, rotuloMes: mesCurto, ausencias, orfas, suspeitas, totais, recordes,
    }) : []),
    [mes, ausencias, orfas, suspeitas, totais, recordes],
  );

  const porFrente = useMemo(() => contarPorFrente(pendencias), [pendencias]);
  const visiveis = filtro ? pendencias.filter((p) => p.frente === filtro) : pendencias;
  const graves = pendencias.filter((p) => p.severidade === "alta").length;

  const enfileirar = async (p: Pendencia) => {
    setEnfileirando(p.chave);
    try {
      await onVirarSubtarefa(p);
      setEnfileiradas((s) => new Set(s).add(p.chave));
    } finally {
      setEnfileirando(null);
    }
  };

  return (
    <Sheet open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
        {/* ---- cabeçalho ---- */}
        <div className="border-b border-border px-5 pb-3 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-semibold leading-tight text-foreground">
                O que falta fechar
                <span className="font-normal text-muted-foreground">
                  {" "}· {tipo.toUpperCase()} · {mes ? mesCurto(mes) : "—"}
                </span>
              </div>
              <p className="mt-1 max-w-[420px] text-[11px] leading-relaxed text-muted-foreground">
                Constatações do mês em curso, recalculadas agora. Nada aqui fica gravado — some
                sozinho quando o lançamento entra.
              </p>
            </div>
            <button
              onClick={onRecarregar}
              title="Refazer as checagens"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-secondary"
            >
              {carregandoOrfas ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* ---- as frentes, como filtro ---- */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setFiltro(null)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition",
                filtro == null ? "border-foreground/25 bg-secondary font-medium text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              Tudo <span className="num font-semibold">{pendencias.length}</span>
            </button>
            {porFrente.map(({ frente, quantas, valor }) => {
              const Icone = ICONE[frente];
              return (
                <button
                  key={frente}
                  onClick={() => setFiltro(filtro === frente ? null : frente)}
                  title={`${FRENTES[frente].nota} · ${brl(valor)} em jogo`}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition",
                    filtro === frente ? "border-foreground/25 bg-secondary font-medium text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary",
                  )}
                >
                  <Icone className="h-3 w-3" />
                  {FRENTES[frente].rotulo} <span className="num font-semibold">{quantas}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- a lista ---- */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!pendencias.length ? (
            <div className="px-5 py-12 text-center">
              <Check className="mx-auto h-7 w-7 text-emerald-600" />
              <div className="mt-2 text-[13px] font-medium text-foreground">Nada pendente por aqui.</div>
              <p className="mx-auto mt-1 max-w-[320px] text-[11px] leading-relaxed text-muted-foreground">
                Nenhuma rubrica recorrente faltando, nenhuma categoria nova fora do DE-PARA,
                nenhum total sem fechar. Isso não quer dizer que o mês está certo — quer dizer
                que estas cinco checagens não têm o que apontar.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {visiveis.map((p) => {
                const Icone = ICONE[p.frente];
                const jaFoi = enfileiradas.has(p.chave);
                return (
                  <div key={p.chave} className="px-5 py-3 transition hover:bg-muted/30">
                    <div className="flex items-start gap-2.5">
                      <Icone className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        p.severidade === "alta" ? "text-amber-600" : "text-muted-foreground",
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-[12.5px] font-medium leading-snug text-foreground">
                            {p.titulo}
                          </div>
                          <div className="num shrink-0 text-[12px] font-semibold text-foreground">
                            {brl(p.valor)}
                          </div>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                          {p.detalhe}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {p.rubrica && (
                            <button
                              onClick={() => { onIrParaCelula(p.rubrica!, p.mes); onFechar(); }}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-sky-800 transition hover:bg-sky-50"
                            >
                              Ver na célula <ArrowRight className="h-2.5 w-2.5" />
                            </button>
                          )}
                          <button
                            onClick={() => enfileirar(p)}
                            disabled={enfileirando === p.chave || jaFoi}
                            title="Vira uma linha do checklist do card “Fechamento”, nas Tarefas"
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-60"
                          >
                            {enfileirando === p.chave ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              : jaFoi ? <Check className="h-2.5 w-2.5 text-emerald-600" />
                              : <ListChecks className="h-2.5 w-2.5" />}
                            {jaFoi ? "No checklist" : "Virar tarefa"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- rodapé: a regra, onde ela é lida quando se quer entender ---- */}
        <div className="border-t border-border bg-muted/30 px-5 py-2.5 text-[10px] leading-relaxed text-muted-foreground">
          {erroOrfas
            ? <span className="text-amber-700">
                As categorias fora do DE-PARA não carregaram ({erroOrfas}). O resto da lista vale.
              </span>
            : <>
                {graves > 0 && <><b className="text-foreground">{graves}</b> de {pendencias.length} são quase
                certamente erro; o resto merece um olhar. </>}
                O porquê de cada uma está no “?” da célula, que procura no mês inteiro.
              </>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
