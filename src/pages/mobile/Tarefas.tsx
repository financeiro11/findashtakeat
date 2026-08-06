// Aba Tarefas — a mesma tabela `tarefas` do Kanban do desktop, em lista.
//
// O que muda no celular: não existe arrastar card entre colunas, então mudar de status é
// um botão dentro da folha de detalhe. E "Concluído" (160 das 196 linhas hoje) não é
// carregado junto: vem paginado de 20 em 20, só quando a pessoa abre a seção.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, AlertTriangle, ChevronDown, ListChecks, Loader2, CalendarDays, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmtData, hojeISO } from "@/lib/mobile/formato";
import { iniciais, rotuloResponsavel } from "@/lib/mobile/responsavel";
import {
  agrupar, aplicarFiltro, estaAtrasada, ordenar,
  ORDEM_STATUS, PRIORIDADES, STATUS_CONCLUIDO,
  type FiltroTarefas, type TarefaMin,
} from "@/lib/mobile/tarefas";

const sb = supabase as any;

type Subtarefa = { id: string; titulo: string; responsavel: string | null; done: boolean };
type Tarefa = TarefaMin & {
  ordem: number;
  observacao: string | null;
  subtarefas: Subtarefa[];
  created_at: string;
};

const PAGINA_CONCLUIDAS = 20;

const CORES_PRIORIDADE: Record<string, string> = {
  Urgente: "bg-destructive/15 text-destructive",
  Alta: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  Média: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  Baixa: "bg-secondary text-muted-foreground",
};

/** Todos os status que a folha de detalhe oferece — os da lista mais "Concluído". */
const STATUS_DISPONIVEIS = [...ORDEM_STATUS, STATUS_CONCLUIDO];

const comSubtarefas = (r: any): Tarefa => ({
  ...r,
  subtarefas: Array.isArray(r.subtarefas) ? r.subtarefas : [],
});

export default function MobileTarefas() {
  const { user, profile } = useAuth();
  const [abertas, setAbertas] = useState<Tarefa[]>([]);
  const [concluidas, setConcluidas] = useState<Tarefa[]>([]);
  const [totalConcluidas, setTotalConcluidas] = useState(0);
  const [limiteConcluidas, setLimiteConcluidas] = useState(PAGINA_CONCLUIDAS);
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<FiltroTarefas>("minhas");
  const [aberta, setAberta] = useState<Tarefa | null>(null);
  const [criando, setCriando] = useState(false);

  const hoje = hojeISO();

  /* Best-effort, igual ao desktop: o histórico nunca pode derrubar a ação principal. */
  const registrar = useCallback(
    async (t: { id: string | null; titulo: string; acao: string; descricao: string }) => {
      if (!t.descricao) return;
      await sb.from("tarefas_log").insert({
        tarefa_id: t.id, tarefa_titulo: t.titulo, acao: t.acao, descricao: t.descricao,
        usuario: profile?.nome ?? null, usuario_id: user?.id ?? null,
      });
    },
    [profile?.nome, user?.id],
  );

  const carregarAbertas = useCallback(async () => {
    const { data, error } = await sb.from("tarefas").select("*").neq("status", STATUS_CONCLUIDO).order("ordem");
    if (error) { toast.error(error.message); return; }
    setAbertas(((data as any[]) ?? []).map(comSubtarefas));
  }, []);

  const carregarConcluidas = useCallback(async (limite: number) => {
    const { data, error, count } = await sb
      .from("tarefas")
      .select("*", { count: "exact" })
      .eq("status", STATUS_CONCLUIDO)
      .order("concluido_em", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(limite);
    if (error) { toast.error(error.message); return; }
    setConcluidas(((data as any[]) ?? []).map(comSubtarefas));
    if (typeof count === "number") setTotalConcluidas(count);
  }, []);

  useEffect(() => {
    Promise.all([carregarAbertas(), carregarConcluidas(PAGINA_CONCLUIDAS)]).finally(() => setCarregando(false));
  }, [carregarAbertas, carregarConcluidas]);

  /* ------------------------------ escrita ------------------------------ */
  async function salvar(alvo: Tarefa, patch: Partial<Tarefa>, descricao: string) {
    const atualizada = { ...alvo, ...patch };
    // Otimista: no 3G a confirmação demora, e a lista tem que responder ao toque.
    setAbertas((ts) => ts.map((t) => (t.id === alvo.id ? atualizada : t)));
    setConcluidas((ts) => ts.map((t) => (t.id === alvo.id ? atualizada : t)));
    setAberta((t) => (t && t.id === alvo.id ? atualizada : t));

    const { error } = await sb.from("tarefas").update(patch).eq("id", alvo.id);
    if (error) {
      toast.error(error.message);
      await Promise.all([carregarAbertas(), carregarConcluidas(limiteConcluidas)]);
      return false;
    }
    registrar({ id: alvo.id, titulo: atualizada.titulo, acao: "editada", descricao });

    // Mudou de/para "Concluído": a linha troca de lista, então as duas recarregam.
    if (patch.status && (patch.status === STATUS_CONCLUIDO) !== (alvo.status === STATUS_CONCLUIDO)) {
      await Promise.all([carregarAbertas(), carregarConcluidas(limiteConcluidas)]);
    }
    return true;
  }

  async function trocarStatus(alvo: Tarefa, status: string) {
    if (status === alvo.status) return;
    const patch: Partial<Tarefa> = { status };
    // `concluido_em` é o carimbo de quando saiu da fila. Reabrir limpa: um carimbo velho
    // numa tarefa aberta bagunça a ordenação da lista de concluídas.
    if (status === STATUS_CONCLUIDO) patch.concluido_em = new Date().toISOString();
    else if (alvo.status === STATUS_CONCLUIDO) patch.concluido_em = null;
    if (await salvar(alvo, patch, `moveu de "${alvo.status}" para "${status}"`)) {
      if (status === STATUS_CONCLUIDO) { toast.success("Tarefa concluída"); setAberta(null); }
    }
  }

  async function trocarPrioridade(alvo: Tarefa, prioridade: string) {
    if (prioridade === alvo.prioridade) return;
    await salvar(alvo, { prioridade }, `prioridade: ${alvo.prioridade} → ${prioridade}`);
  }

  async function alternarSubtarefa(alvo: Tarefa, id: string) {
    const subtarefas = alvo.subtarefas.map((s) => (s.id === id ? { ...s, done: !s.done } : s));
    const feitas = subtarefas.filter((s) => s.done).length;
    await salvar(alvo, { subtarefas }, `checklist: ${feitas}/${subtarefas.length} concluídos`);
  }

  async function criar(novo: { titulo: string; responsavel: string; prioridade: string; prazo: string }) {
    const ordem = abertas.length ? Math.max(...abertas.map((t) => t.ordem ?? 0)) + 1 : 1;
    const { data, error } = await sb.from("tarefas").insert({
      ordem, titulo: novo.titulo, responsavel: novo.responsavel,
      status: "Backlog", prioridade: novo.prioridade, prazo: novo.prazo, subtarefas: [],
    }).select("id").single();
    if (error) { toast.error(error.message); return false; }
    registrar({ id: (data as any)?.id ?? null, titulo: novo.titulo, acao: "criada", descricao: 'Criada em "Backlog" pelo celular' });
    toast.success("Tarefa criada");
    await carregarAbertas();
    return true;
  }

  /* ------------------------------ listas ------------------------------ */
  const filtradas = useMemo(
    () => aplicarFiltro(abertas, filtro, profile?.nome, hoje) as Tarefa[],
    [abertas, filtro, profile?.nome, hoje],
  );
  const grupos = useMemo(() => agrupar(filtradas, hoje), [filtradas, hoje]);
  const concluidasFiltradas = useMemo(
    () => ordenar(aplicarFiltro(concluidas, filtro === "atrasadas" ? "todas" : filtro, profile?.nome, hoje)) as Tarefa[],
    [concluidas, filtro, profile?.nome, hoje],
  );
  const nAtrasadas = useMemo(() => abertas.filter((t) => estaAtrasada(t, hoje)).length, [abertas, hoje]);

  return (
    <div className="relative pb-24">
      <div className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-border bg-background px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip ativo={filtro === "minhas"} onClick={() => setFiltro("minhas")}>Minhas</Chip>
        <Chip ativo={filtro === "todas"} onClick={() => setFiltro("todas")}>Todas</Chip>
        <Chip ativo={filtro === "atrasadas"} onClick={() => setFiltro("atrasadas")}>
          Atrasadas{nAtrasadas > 0 && ` (${nAtrasadas})`}
        </Chip>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando tarefas…
        </div>
      ) : (
        <div className="space-y-5 px-4 pt-4">
          {grupos.length === 0 && (
            <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
              {filtro === "minhas"
                ? `Nada em aberto para ${profile?.nome?.split(" ")[0] ?? "você"}.`
                : "Nenhuma tarefa em aberto."}
            </div>
          )}

          {grupos.map((g) => (
            <section key={g.chave}>
              <h2 className={cn(
                "mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider",
                g.atencao ? "text-destructive" : "text-muted-foreground",
              )}>
                {g.atencao && <AlertTriangle className="h-3 w-3" />}
                {g.titulo}
                <span className="num rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {g.itens.length}
                </span>
              </h2>
              <ul className="space-y-2">
                {g.itens.map((t) => (
                  <CardTarefa key={t.id} t={t as Tarefa} hoje={hoje} onAbrir={() => setAberta(t as Tarefa)} />
                ))}
              </ul>
            </section>
          ))}

          <section>
            <button
              onClick={() => setMostrarConcluidas((v) => !v)}
              aria-expanded={mostrarConcluidas}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left"
            >
              <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="flex-1 text-[13.5px] font-semibold">Concluídas</span>
              <span className="num rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {totalConcluidas || concluidas.length}
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", mostrarConcluidas && "rotate-180")} />
            </button>

            {mostrarConcluidas && (
              <>
                <ul className="mt-2 space-y-2">
                  {concluidasFiltradas.map((t) => (
                    <CardTarefa key={t.id} t={t} hoje={hoje} onAbrir={() => setAberta(t)} />
                  ))}
                </ul>
                {concluidas.length < totalConcluidas && (
                  <button
                    onClick={() => {
                      const proximo = limiteConcluidas + PAGINA_CONCLUIDAS;
                      setLimiteConcluidas(proximo);
                      carregarConcluidas(proximo);
                    }}
                    className="mt-2 min-h-[44px] w-full rounded-xl border border-dashed border-border text-[13px] font-medium text-muted-foreground"
                  >
                    Carregar mais ({totalConcluidas - concluidas.length} restantes)
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      )}

      <button
        onClick={() => setCriando(true)}
        aria-label="Nova tarefa"
        className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
      >
        <Plus className="h-6 w-6" />
      </button>

      <FolhaDetalhe
        tarefa={aberta}
        onFechar={() => setAberta(null)}
        onStatus={trocarStatus}
        onPrioridade={trocarPrioridade}
        onSubtarefa={alternarSubtarefa}
      />
      <FolhaCriar
        aberta={criando}
        responsavelPadrao={profile?.nome?.split(" ")[0] ?? ""}
        onFechar={() => setCriando(false)}
        onCriar={criar}
      />
    </div>
  );
}

/* ------------------------------ componentes ------------------------------ */
function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-[36px] shrink-0 rounded-full border px-4 text-[13px] font-medium transition-colors",
        ativo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function CardTarefa({ t, hoje, onAbrir }: { t: Tarefa; hoje: string; onAbrir: () => void }) {
  const atrasada = estaAtrasada(t, hoje);
  const total = t.subtarefas?.length ?? 0;
  const feitas = t.subtarefas?.filter((s) => s.done).length ?? 0;

  return (
    <li>
      <button
        onClick={onAbrir}
        className="w-full rounded-xl border border-border bg-card p-3.5 text-left active:bg-secondary/50"
      >
        <div className={cn("break-words text-[14px] font-medium leading-snug", t.status === STATUS_CONCLUIDO && "text-muted-foreground line-through")}>
          {t.titulo}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", CORES_PRIORIDADE[t.prioridade] ?? CORES_PRIORIDADE.Baixa)}>
            {t.prioridade}
          </span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary">
              {iniciais(t.responsavel)}
            </span>
            {rotuloResponsavel(t.responsavel)}
          </span>
          <span className={cn("num flex items-center gap-1 text-[11.5px]", atrasada ? "font-semibold text-destructive" : "text-muted-foreground")}>
            {atrasada && <AlertTriangle className="h-3 w-3" />}
            {fmtData(t.prazo)}
          </span>
          {total > 0 && (
            <span className="num flex items-center gap-1 text-[11.5px] text-muted-foreground">
              <ListChecks className="h-3 w-3" />
              {feitas}/{total}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function FolhaDetalhe({
  tarefa, onFechar, onStatus, onPrioridade, onSubtarefa,
}: {
  tarefa: Tarefa | null;
  onFechar: () => void;
  onStatus: (t: Tarefa, s: string) => void;
  onPrioridade: (t: Tarefa, p: string) => void;
  onSubtarefa: (t: Tarefa, id: string) => void;
}) {
  return (
    <Drawer open={!!tarefa} onOpenChange={(v) => !v && onFechar()}>
      <DrawerContent className="max-h-[88dvh]">
        {tarefa && (
          <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <DrawerTitle className="break-words text-[16px] leading-snug">{tarefa.titulo}</DrawerTitle>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              <span>{rotuloResponsavel(tarefa.responsavel)}</span>
              <span className="num flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> {fmtData(tarefa.prazo)}
              </span>
            </div>

            {tarefa.observacao && (
              <div className="mt-4">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Observação</div>
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">{tarefa.observacao}</p>
              </div>
            )}

            {tarefa.subtarefas.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Checklist · {tarefa.subtarefas.filter((s) => s.done).length}/{tarefa.subtarefas.length}
                </div>
                <ul className="space-y-1">
                  {tarefa.subtarefas.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => onSubtarefa(tarefa, s.id)}
                        className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-1 text-left active:bg-secondary"
                      >
                        <span className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                          s.done ? "border-primary bg-primary text-primary-foreground" : "border-input",
                        )}>
                          {s.done && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className={cn("text-[13.5px] leading-snug", s.done && "text-muted-foreground line-through")}>
                          {s.titulo}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Status</div>
              <div className="flex flex-wrap gap-2">
                {STATUS_DISPONIVEIS.map((s) => (
                  <button
                    key={s}
                    onClick={() => onStatus(tarefa, s)}
                    className={cn(
                      "min-h-[38px] rounded-full border px-3.5 text-[12.5px] font-medium",
                      s === tarefa.status ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Prioridade</div>
              <div className="flex flex-wrap gap-2">
                {PRIORIDADES.map((p) => (
                  <button
                    key={p}
                    onClick={() => onPrioridade(tarefa, p)}
                    className={cn(
                      "min-h-[38px] rounded-full border px-3.5 text-[12.5px] font-medium",
                      p === tarefa.prioridade ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-5 text-[11.5px] leading-relaxed text-muted-foreground">
              Título, observação e checklist são editados no computador — aqui ficam as ações
              rápidas do dia a dia.
            </p>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function FolhaCriar({
  aberta, responsavelPadrao, onFechar, onCriar,
}: {
  aberta: boolean;
  responsavelPadrao: string;
  onFechar: () => void;
  onCriar: (t: { titulo: string; responsavel: string; prioridade: string; prazo: string }) => Promise<boolean>;
}) {
  const [titulo, setTitulo] = useState("");
  const [responsavel, setResponsavel] = useState(responsavelPadrao);
  const [prioridade, setPrioridade] = useState("Média");
  const [prazo, setPrazo] = useState(hojeISO());
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (aberta) {
      setTitulo(""); setResponsavel(responsavelPadrao); setPrioridade("Média"); setPrazo(hojeISO());
    }
  }, [aberta, responsavelPadrao]);

  const enviar = async () => {
    if (!titulo.trim()) { toast.error("Dê um título à tarefa"); return; }
    if (!responsavel.trim()) { toast.error("Informe o responsável"); return; }
    if (!prazo) { toast.error("Informe o prazo"); return; }
    setSalvando(true);
    const ok = await onCriar({ titulo: titulo.trim(), responsavel: responsavel.trim(), prioridade, prazo });
    setSalvando(false);
    if (ok) onFechar();
  };

  return (
    <Drawer open={aberta} onOpenChange={(v) => !v && onFechar()}>
      <DrawerContent className="max-h-[88dvh]">
        <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
          <DrawerTitle className="text-[16px]">Nova tarefa</DrawerTitle>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Título</Label>
              {/* text-base (16px) evita o zoom automático do Safari ao focar o campo. */}
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="h-11 text-base" placeholder="O que precisa ser feito?" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Responsável</Label>
              <Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="h-11 text-base" placeholder="Henrique, Júlia…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Prioridade</Label>
              <div className="flex flex-wrap gap-2">
                {PRIORIDADES.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPrioridade(p)}
                    className={cn(
                      "min-h-[40px] rounded-full border px-3.5 text-[12.5px] font-medium",
                      p === prioridade ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Prazo</Label>
              <Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className="h-11 text-base" />
            </div>

            <Button onClick={enviar} disabled={salvando} className="h-12 w-full text-[14px] font-semibold">
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar tarefa
            </Button>
            <p className="text-center text-[11.5px] text-muted-foreground">
              Entra em <span className="font-medium">Backlog</span>. Observação e checklist ficam para o computador.
            </p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
