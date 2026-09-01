import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { corDaArea } from "@/lib/tarefas/classificacao";
import { Cadencia, deIso, descreverCadenciaLonga, lerCadencia } from "@/lib/tarefas/rotina";

/**
 * O painel de rotinas: uma linha por rotina, não por tarefa.
 *
 * A pergunta que nenhuma tela respondia era "quais rotinas existem e quando cada
 * uma volta?" — no quadro só se vê a ocorrência aberta AGORA, então uma rotina
 * mensal fica invisível 29 dias por mês, e uma rotina que parou de ser gerada
 * (porque alguém pausou, ou porque a cadência ficou sem dia nenhum) some sem
 * nunca dar sinal. Aqui ela aparece mesmo sem tarefa aberta.
 *
 * A fonte é a view `tarefas_rotinas` (migration 20260831140000), que colapsa a
 * série na ocorrência mais recente — a mesma que o gerador usa como modelo. Ler
 * daqui em vez de reagrupar no cliente é o que garante que o painel mostre a
 * rotina que o cron vai de fato executar.
 */

type LinhaRotina = {
  serie_id: string;
  tarefa_modelo_id: string;
  titulo: string;
  responsavel: string | null;
  prioridade: string;
  cat_area: string | null;
  cadencia: unknown;
  ativa: boolean;
  antecedencia_dias: number;
  subtarefas_fonte: string | null;
  proxima_itens: number;
  ocorrencias: number;
  concluidas: number;
  ultima_conclusao: string | null;
  aberta_id: string | null;
  aberta_prazo: string | null;
  proxima_data: string | null;
};

function fmtData(s: string | null): string {
  if (!s) return "—";
  const d = s.length > 10 ? new Date(s) : deIso(s);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** "em 3 dias" / "hoje" / "amanhã" — a distância é o que se lê primeiro. */
function distancia(iso: string | null): string {
  if (!iso) return "";
  const hoje = new Date();
  const alvo = deIso(iso);
  const dias = Math.round(
    (new Date(alvo.getFullYear(), alvo.getMonth(), alvo.getDate()).getTime()
      - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) / 86400000,
  );
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  if (dias < 0) return `há ${-dias} d`;
  return `em ${dias} d`;
}

export function RotinasPanel({ onAbrirTarefa }: { onAbrirTarefa?: (id: string) => void }) {
  const [linhas, setLinhas] = useState<LinhaRotina[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from("tarefas_rotinas")
      .select("*")
      .order("proxima_data", { nullsFirst: false });
    setCarregando(false);
    if (error) { toast.error(error.message); return; }
    setLinhas((data || []) as unknown as LinhaRotina[]);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /* O cron roda às 6h10. Quem acabou de cadastrar uma rotina que cai hoje não
     pode ter de esperar até amanhã para saber se acertou a configuração — e é
     esse tipo de espera que faz a pessoa concluir que "não funciona". Chamar a
     MESMA função do cron (e não uma cópia) é o que mantém as duas leituras
     iguais: se o botão criou, o cron criaria. */
  const gerarAgora = async () => {
    setGerando(true);
    const { data, error } = await supabase.rpc("tarefas_rotinas_gerar");
    setGerando(false);
    if (error) { toast.error(error.message); return; }
    const n = Number(data) || 0;
    toast.success(n === 0
      ? "Nada a criar agora — nenhuma rotina cai na janela de hoje"
      : `${n} tarefa${n === 1 ? "" : "s"} criada${n === 1 ? "" : "s"} no Backlog`);
    carregar();
  };

  const alternarPausa = async (l: LinhaRotina) => {
    /* Grava na ocorrência mais recente porque é ela o modelo da próxima: pausar
       numa ocorrência antiga não seria lido pelo gerador. */
    const { error } = await supabase
      .from("tarefas").update({ rotina_ativa: !l.ativa }).eq("id", l.tarefa_modelo_id);
    if (error) { toast.error(error.message); return; }
    setLinhas(ls => ls.map(x => x.serie_id === l.serie_id ? { ...x, ativa: !l.ativa } : x));
    toast.success(l.ativa ? "Rotina pausada" : "Rotina retomada");
  };

  const ativas = useMemo(() => linhas.filter(l => l.ativa).length, [linhas]);

  return (
    <Card className="overflow-hidden border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-semibold">Rotinas com agenda</div>
            <div className="text-[11px] text-muted-foreground">
              {carregando ? "carregando…" : `${linhas.length} rotina${linhas.length === 1 ? "" : "s"} · ${ativas} gerando · o Hub cria a ocorrência às 6h10`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={carregando} className="h-8 gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", carregando && "animate-spin")} /> Atualizar
          </Button>
          <Button size="sm" onClick={gerarAgora} disabled={gerando} className="h-8 gap-1.5">
            {gerando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
            Gerar agora
          </Button>
        </div>
      </div>

      {!carregando && linhas.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma rotina com agenda ainda.<br />
          <span className="text-xs">
            Abra uma tarefa, marque <span className="font-medium text-foreground">É rotina</span> e escolha
            quando ela volta — a partir daí o Hub cria a próxima sozinho.
          </span>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rotina</TableHead>
              <TableHead>Quando volta</TableHead>
              <TableHead>Próxima</TableHead>
              <TableHead>Checklist</TableHead>
              <TableHead>Aberta agora</TableHead>
              <TableHead>Última conclusão</TableHead>
              <TableHead className="text-right">Histórico</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map(l => {
              const cad = lerCadencia(l.cadencia) as Cadencia | null;
              return (
                <TableRow
                  key={l.serie_id}
                  className={cn("cursor-pointer", !l.ativa && "opacity-55")}
                  onClick={() => onAbrirTarefa?.(l.aberta_id || l.tarefa_modelo_id)}
                >
                  <TableCell className="max-w-[280px]">
                    <div className="truncate text-sm font-medium">{l.titulo}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {l.cat_area && (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: corDaArea(l.cat_area) }} />
                          <span>{l.cat_area}</span>
                          <span>·</span>
                        </>
                      )}
                      <span>{l.responsavel || "sem responsável"}</span>
                      {l.antecedencia_dias > 0 && (
                        <>
                          <span>·</span>
                          <span title="A tarefa nasce com esta folga antes do prazo">
                            criada {l.antecedencia_dias}d antes
                          </span>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {cad ? descreverCadenciaLonga(cad) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="num text-xs">
                    {l.ativa ? (
                      <>
                        {fmtData(l.proxima_data)}
                        <span className="ml-1.5 text-[10px] text-muted-foreground">{distancia(l.proxima_data)}</span>
                      </>
                    ) : (
                      <span className="text-[11px] font-medium text-warning">pausada</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {l.subtarefas_fonte === "agenda" ? (
                      /* Um zero aqui numa rotina de agenda é sinal, não enfeite:
                         ou o dia não tem pagamento marcado, ou o espelho do
                         calendário não rodou — e nos dois casos a ocorrência
                         nasceria com a lista vazia. */
                      <span
                        className={cn("inline-flex items-center gap-1",
                          l.proxima_itens > 0 ? "text-foreground" : "text-warning")}
                        title="Uma subtarefa por pagamento de dia inteiro marcado no Google Calendar naquele dia"
                      >
                        <CalendarClock className="h-3 w-3" />
                        {l.proxima_itens > 0
                          ? `${l.proxima_itens} da agenda`
                          : "agenda sem pagamento"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">repete o anterior</span>
                    )}
                  </TableCell>
                  <TableCell className="num text-xs">
                    {l.aberta_id
                      ? <span className="text-foreground">{fmtData(l.aberta_prazo)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="num text-xs text-muted-foreground">{fmtData(l.ultima_conclusao)}</TableCell>
                  <TableCell className="num text-right text-xs text-muted-foreground">
                    {l.concluidas}/{l.ocorrencias}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={(e) => { e.stopPropagation(); alternarPausa(l); }}
                      className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      title={l.ativa ? "Pausar: para de criar novas ocorrências" : "Retomar a geração"}
                      aria-label={l.ativa ? "Pausar rotina" : "Retomar rotina"}
                    >
                      {l.ativa ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
