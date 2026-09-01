import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  AjusteFds, Cadencia, DIAS_SEMANA, DiaSemana, SIGLAS_DIA, TipoCadencia,
  cadenciaValida, datasDaCadencia, deIso, descreverCadenciaLonga, iso,
} from "@/lib/tarefas/rotina";

/**
 * Onde se diz QUANDO a rotina volta.
 *
 * O checkbox "É rotina" respondia "esta tarefa se repete?" e parava aí — quem
 * lia o card ficava sem saber se era toda segunda ou todo dia 31, e nada era
 * criado. Este bloco é a metade que faltava: a cadência vira dado, e o cron
 * `tarefas_rotinas_gerar` cria a ocorrência quando bate o dia.
 *
 * A prévia embaixo não é enfeite: mostra as três próximas datas calculadas pela
 * MESMA conta que o banco usa. É como se confere, sem esperar até o dia 5, que
 * "dia 31 antecipando o fim de semana" faz o que a pessoa achava que fazia.
 */

const TIPOS: { valor: TipoCadencia; rotulo: string }[] = [
  { valor: "diaria", rotulo: "Todo dia" },
  { valor: "semanal", rotulo: "Por dia da semana" },
  { valor: "mensal", rotulo: "Por dia do mês" },
];

const AJUSTES: { valor: AjusteFds | ""; rotulo: string }[] = [
  { valor: "", rotulo: "mantém a data" },
  { valor: "antecipar", rotulo: "antecipa p/ sexta" },
  { valor: "adiar", rotulo: "adia p/ segunda" },
];

function Chip({ ativo, onClick, children, title, largura }: {
  ativo: boolean; onClick: () => void; children: React.ReactNode; title?: string; largura?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "rounded border px-1.5 py-1 text-[11px] font-medium transition-colors",
        largura || "min-w-[30px]",
        ativo
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Formata para a prévia: "sáb, 05/09". O ano só aparece quando não é o ano corrente. */
function fmtPrevia(d: Date): string {
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const data = d.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
  return `${dia}, ${data}`;
}

export type PagamentoDoDia = { rotulo: string; valor: number | null };

/**
 * Os pagamentos de um dia, lidos de `agenda_eventos` (o espelho do Google
 * Calendar mantido pela `agenda-sync`).
 */
function usePagamentosDoDia(chave: string | null) {
  const [itens, setItens] = useState<PagamentoDoDia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!chave) { setItens(null); setErro(null); return; }
    let vivo = true;
    setItens(null);
    (async () => {
      const { data, error } = await supabase
        .from("agenda_eventos")
        .select("rotulo, valor")
        .eq("dia", chave)
        .eq("eh_pagamento", true)
        .order("valor", { ascending: false, nullsFirst: false });
      if (!vivo) return;
      if (error) { setErro(error.message); setItens([]); return; }
      setErro(null);
      setItens((data ?? []) as PagamentoDoDia[]);
    })();
    return () => { vivo = false; };
  }, [chave]);

  return { itens, erro };
}

/**
 * Os pagamentos da agenda, e o botão que os traz para o checklist DE VERDADE.
 *
 * A primeira versão disto era só prévia, e estava errada: a pessoa marcava
 * "pagamentos da agenda do dia", salvava, e a tarefa nascia com checklist VAZIO
 * — porque o preenchimento automático só acontece na PRÓXIMA ocorrência, criada
 * pelo cron. Quem configurou a rotina hoje ficava exatamente sem o que pediu.
 * Agora a lista entra como subtarefa marcável na hora, e o carimbo `fonte =
 * agenda` continua valendo para as ocorrências futuras.
 *
 * O dia lido é o PRAZO da tarefa (é ele que diz de quando é esta ocorrência),
 * caindo para a próxima data da cadência quando ainda não há prazo.
 */
function BlocoDaAgenda({
  dia, jaNoChecklist, onTrazer,
}: {
  dia: Date | null;
  jaNoChecklist: Set<string>;
  onTrazer: (itens: PagamentoDoDia[]) => void;
}) {
  const chave = dia ? iso(dia) : null;
  const { itens, erro } = usePagamentosDoDia(chave);

  if (!chave) return null;
  const dataBR = dia!.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const total = (itens ?? []).reduce((s, i) => s + (i.valor ?? 0), 0);
  const faltando = (itens ?? []).filter(i => !jaNoChecklist.has(i.rotulo));

  return (
    <div className="space-y-1.5 rounded border border-dashed border-border bg-muted/30 px-2.5 py-2 text-[11px]">
      {erro ? (
        <span className="text-warning">Não deu para ler a agenda ({erro}).</span>
      ) : itens === null ? (
        <span className="text-muted-foreground">Lendo a agenda de {dataBR}…</span>
      ) : itens.length === 0 ? (
        <span className="text-warning">
          A agenda de {dataBR} não tem pagamento marcado. Confira se a sincronização já rodou —
          em Configurações › Integrações.
        </span>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {dataBR}: {itens.length} pagamento{itens.length === 1 ? "" : "s"}
              {total > 0 && ` · ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
            </span>
            <button
              type="button"
              onClick={() => onTrazer(itens)}
              disabled={faltando.length === 0}
              className={cn(
                "rounded border px-2 py-1 text-[11px] font-medium transition-colors",
                faltando.length === 0
                  ? "cursor-default border-border text-muted-foreground"
                  : "border-primary bg-primary text-primary-foreground hover:opacity-90",
              )}
              title={faltando.length === 0
                ? "Todos já estão no checklist abaixo"
                : "Cria uma subtarefa marcável para cada pagamento, no checklist abaixo"}
            >
              {faltando.length === 0
                ? "já estão no checklist"
                : `Trazer ${faltando.length} para o checklist`}
            </button>
          </div>
          <div className="space-y-0.5 text-muted-foreground">
            {itens.slice(0, 4).map((i, n) => (
              <div key={n} className="truncate">
                {jaNoChecklist.has(i.rotulo) ? "✓" : "·"} {i.rotulo}
              </div>
            ))}
            {itens.length > 4 && <div>· e mais {itens.length - 4}</div>}
          </div>
        </>
      )}
    </div>
  );
}

export function CadenciaEditor({
  cadencia, onCadencia, antecedencia, onAntecedencia, ativa, onAtiva, fonte, onFonte,
  prazo, jaNoChecklist, onTrazerDaAgenda,
}: {
  cadencia: Cadencia | null;
  onCadencia: (c: Cadencia | null) => void;
  antecedencia: number;
  onAntecedencia: (n: number) => void;
  ativa: boolean;
  onAtiva: (v: boolean) => void;
  fonte: string | null;
  onFonte: (f: string | null) => void;
  /** O prazo da tarefa (YYYY-MM-DD). É ele que diz de QUE dia é esta ocorrência. */
  prazo: string;
  /** Rótulos que já estão no checklist — para não trazer o mesmo pagamento duas vezes. */
  jaNoChecklist: Set<string>;
  onTrazerDaAgenda: (itens: PagamentoDoDia[]) => void;
}) {
  /* `null` é um estado de verdade, não um "ainda não escolhi": é a rotina SEM
     agenda — a marcação que já existia antes deste bloco, que só diz à Análise
     Semanal "isto é repetição" e não cria nada. Mantê-la explícita na mesma
     fileira de botões é o que faz a diferença entre as duas ficar visível. */
  const tipo: TipoCadencia | null = cadencia?.tipo ?? null;

  const trocaTipo = (t: TipoCadencia | null) => {
    if (t === tipo) return;
    /* Cada tipo tem um formato próprio — trocar preservando `dias` faria "dias 20
       e 31" virar "toda 20ª e 31ª feira", que a validação recusa em silêncio. */
    if (t === null) onCadencia(null);
    else if (t === "diaria") onCadencia({ tipo: "diaria", somente_uteis: false });
    else if (t === "semanal") onCadencia({ tipo: "semanal", dias: [1] });
    else onCadencia({ tipo: "mensal", dias: [5], ultimo_dia: false, ajuste_fds: null });
  };

  const alternaDiaSemana = (d: DiaSemana) => {
    if (cadencia?.tipo !== "semanal") return;
    const dias = cadencia.dias.includes(d)
      ? cadencia.dias.filter(x => x !== d)
      : [...cadencia.dias, d].sort((a, b) => a - b);
    onCadencia({ tipo: "semanal", dias });
  };

  const alternaDiaMes = (d: number) => {
    if (cadencia?.tipo !== "mensal") return;
    const dias = cadencia.dias.includes(d)
      ? cadencia.dias.filter(x => x !== d)
      : [...cadencia.dias, d].sort((a, b) => a - b);
    onCadencia({ ...cadencia, dias });
  };

  const hoje = new Date();
  const proximas = datasDaCadencia(cadencia, hoje, new Date(hoje.getFullYear() + 1, hoje.getMonth(), hoje.getDate())).slice(0, 3);
  const valida = cadenciaValida(cadencia);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1">
        {TIPOS.map(t => (
          <Chip key={t.valor} ativo={tipo === t.valor} onClick={() => trocaTipo(t.valor)} largura="px-2.5">
            {t.rotulo}
          </Chip>
        ))}
        <Chip
          ativo={tipo === null}
          onClick={() => trocaTipo(null)}
          largura="px-2.5"
          title="Marca como repetição para a Análise Semanal, mas não cria nada — era o único comportamento possível antes."
        >
          Sem agenda
        </Chip>
      </div>

      {tipo === "diaria" && cadencia?.tipo === "diaria" && (
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={!!cadencia.somente_uteis}
            onCheckedChange={(c) => onCadencia({ tipo: "diaria", somente_uteis: c === true })}
          />
          <span className="text-xs text-muted-foreground">Só dias úteis (pula sábado e domingo)</span>
        </label>
      )}

      {tipo === "semanal" && cadencia?.tipo === "semanal" && (
        <div className="flex flex-wrap gap-1">
          {DIAS_SEMANA.map(d => (
            <Chip key={d} ativo={cadencia.dias.includes(d)} onClick={() => alternaDiaSemana(d)} largura="w-11">
              {SIGLAS_DIA[d]}
            </Chip>
          ))}
        </div>
      )}

      {tipo === "mensal" && cadencia?.tipo === "mensal" && (
        <div className="space-y-2">
          <div className="grid grid-cols-[repeat(11,minmax(0,1fr))] gap-1">
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
              <Chip
                key={d}
                ativo={cadencia.dias.includes(d)}
                onClick={() => alternaDiaMes(d)}
                largura="w-full"
                title={d > 28 ? `Dia ${d} literal — nos meses sem dia ${d} a rotina não acontece. Para "fim do mês", use o botão ao lado.` : undefined}
              >
                {d}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              ativo={!!cadencia.ultimo_dia}
              onClick={() => onCadencia({ ...cadencia, ultimo_dia: !cadencia.ultimo_dia })}
              largura="px-2.5"
              title="28, 29, 30 ou 31 conforme o mês — diferente de marcar o dia 31, que simplesmente não acontece em fevereiro"
            >
              Último dia do mês
            </Chip>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Fim de semana:</span>
              {AJUSTES.map(a => (
                <Chip
                  key={a.valor || "nenhum"}
                  ativo={(cadencia.ajuste_fds ?? "") === a.valor}
                  onClick={() => onCadencia({ ...cadencia, ajuste_fds: a.valor || null })}
                  largura="px-2"
                >
                  {a.rotulo}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      )}

      {tipo === null ? (
        <div className="rounded border border-dashed border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
          Sem agenda: a tarefa <span className="font-medium text-foreground">não é criada sozinha</span>. A marcação
          serve só para a Análise Semanal contar esta tarefa como repetição na fila de automação.
        </div>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5">
        <div className="flex items-center gap-2">
          <Label className="text-[11px] text-muted-foreground">Criar</Label>
          <Input
            type="number" min={0} max={30}
            value={antecedencia}
            onChange={(e) => onAntecedencia(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
            className="h-7 w-16 text-xs"
          />
          <span className="text-[11px] text-muted-foreground">dia(s) antes do prazo</span>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={ativa} onCheckedChange={(c) => onAtiva(c === true)} />
          <span className="text-[11px] text-muted-foreground">
            Gerando {ativa ? "" : "— pausada, nada novo é criado"}
          </span>
        </label>
      </div>

      {/* De onde vem o checklist. É a metade que faltava para a rotina de
          pagamentos servir: a rotina volta nos dias 5, 10, 15, 20 e 25, mas o
          QUE se paga muda todo dia — clonar o checklist da ocorrência anterior
          entrega no dia 20 a lista do dia 15. */}
      <div className="space-y-1.5 pt-0.5">
        <div className="text-[11px] text-muted-foreground">Checklist da próxima ocorrência:</div>
        <div className="flex flex-wrap gap-1">
          <Chip ativo={fonte !== "agenda"} onClick={() => onFonte(null)} largura="px-2.5"
                title="Copia o checklist da ocorrência anterior, com tudo desmarcado.">
            Repete o da anterior
          </Chip>
          <Chip ativo={fonte === "agenda"} onClick={() => onFonte("agenda")} largura="px-2.5"
                title="Uma subtarefa por pagamento marcado no Google Calendar naquele dia (eventos de dia inteiro).">
            Pagamentos da agenda do dia
          </Chip>
        </div>
        {fonte === "agenda" && (
          <BlocoDaAgenda
            dia={prazo ? deIso(prazo) : (proximas[0] ?? null)}
            jaNoChecklist={jaNoChecklist}
            onTrazer={onTrazerDaAgenda}
          />
        )}
      </div>

      <div className="rounded border border-dashed border-border bg-muted/30 px-2.5 py-2 text-[11px]">
        {!valida ? (
          <span className="text-warning">
            Escolha ao menos um dia — sem isso a rotina não gera nada.
          </span>
        ) : (
          <>
            <span className="font-medium text-foreground">{descreverCadenciaLonga(cadencia)}</span>
            <span className="text-muted-foreground">
              {" · próximas: "}
              {proximas.length ? proximas.map(fmtPrevia).join(" · ") : "nenhuma no próximo ano"}
            </span>
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
}
