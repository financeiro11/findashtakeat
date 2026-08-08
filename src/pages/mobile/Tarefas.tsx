// Aba Tarefas — a mesma tabela `tarefas` do Kanban do desktop, em lista.
//
// O que muda no celular: não existe arrastar card entre colunas, então mudar de status é
// um botão dentro da folha de detalhe. E "Concluído" (160 das 196 linhas hoje) não é
// carregado junto: vem paginado de 20 em 20, só quando a pessoa abre a seção.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, AlertTriangle, ChevronDown, ListChecks, Loader2, CalendarDays, Check, X,
  Pencil, Archive, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useAoVoltar } from "@/hooks/useAoVoltar";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { emDias, fmtData, hojeISO } from "@/lib/mobile/formato";
import { iniciais, mesmaPessoa, pessoasConhecidas, rotuloResponsavel, type Pessoa } from "@/lib/mobile/responsavel";
import {
  agrupar, aplicarFiltro, estaAtrasada, statusDisponiveis,
  adicionarSubtarefa, alternarSubtarefa, removerSubtarefa, descreverChecklist,
  PRIORIDADES, STATUS_CONCLUIDO,
  type FiltroTarefas, type TarefaMin, type Subtarefa,
} from "@/lib/mobile/tarefas";

const sb = supabase as any;

type Tarefa = TarefaMin & {
  ordem: number;
  observacao: string | null;
  subtarefas: Subtarefa[];
  created_at: string;
  arquivada_em?: string | null;
};

const PAGINA_CONCLUIDAS = 20;

const CORES_PRIORIDADE: Record<string, string> = {
  Urgente: "bg-destructive/15 text-destructive",
  Alta: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  Média: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  Baixa: "bg-secondary text-muted-foreground",
};

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

  // `.is("arquivada_em", null)` nas duas: tarefa arquivada continua no banco (dá para
  // desfazer e o histórico segue apontando para ela), mas não pode aparecer em lista.
  const carregarAbertas = useCallback(async () => {
    const { data, error } = await sb
      .from("tarefas").select("*")
      .is("arquivada_em", null)
      .neq("status", STATUS_CONCLUIDO)
      .order("ordem");
    if (error) { toast.error(error.message); return; }
    setAbertas(((data as any[]) ?? []).map(comSubtarefas));
  }, []);

  const carregarConcluidas = useCallback(async (limite: number) => {
    const { data, error, count } = await sb
      .from("tarefas")
      .select("*", { count: "exact" })
      .is("arquivada_em", null)
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

  // Quem mexe no Kanban é o time inteiro: voltar ao app depois de um tempo tem que trazer
  // a lista de agora, não a de quando o celular foi para o bolso.
  useAoVoltar(() => {
    carregarAbertas();
    carregarConcluidas(limiteConcluidas);
  });

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
    if (!(await salvar(alvo, patch, `moveu de "${alvo.status}" para "${status}"`))) return;

    if (status === STATUS_CONCLUIDO) {
      toast.success("Tarefa concluída");
      setAberta(null);
      return;
    }
    // O card muda de bloco, mas o bloco de destino pode estar fora da tela — e a folha de
    // detalhe segue aberta por cima da lista. Sem este aviso a ação fica sem resposta.
    toast.success(`Movida para "${status}"`);
  }

  async function trocarPrioridade(alvo: Tarefa, prioridade: string) {
    if (prioridade === alvo.prioridade) return;
    await salvar(alvo, { prioridade }, `prioridade: ${alvo.prioridade} → ${prioridade}`);
  }

  async function trocarPrazo(alvo: Tarefa, prazo: string | null) {
    if ((prazo ?? null) === (alvo.prazo ?? null)) return;
    // Mesma frase do histórico do desktop (describeChanges em pages/Tarefas.tsx): a aba
    // "Histórico" mistura as duas origens e não pode ficar com dois dialetos.
    if (await salvar(alvo, { prazo }, `prazo: ${fmtData(alvo.prazo)} → ${fmtData(prazo)}`)) {
      toast.success(prazo ? `Prazo: ${fmtData(prazo)}` : "Prazo removido");
    }
  }

  async function trocarResponsavel(alvo: Tarefa, responsavel: string | null) {
    if ((responsavel ?? "") === (alvo.responsavel ?? "")) return;
    if (!(await salvar(alvo, { responsavel }, `responsável: ${alvo.responsavel || "—"} → ${responsavel || "—"}`))) return;
    // Passar a tarefa para outra pessoa com o filtro em "Minhas" faz o card sumir da lista.
    // É o certo — ela não é mais sua —, mas sumir sem explicação parece falha.
    toast.success(responsavel ? `Agora é de ${rotuloResponsavel(responsavel)}` : "Responsável removido");
  }

  /* Uma porta só para as três operações de checklist: todas gravam o jsonb inteiro e
     descrevem a mudança com a mesma frase do desktop. */
  async function mudarChecklist(alvo: Tarefa, subtarefas: Subtarefa[]) {
    if (subtarefas === alvo.subtarefas) return;
    await salvar(alvo, { subtarefas }, descreverChecklist(alvo.subtarefas, subtarefas));
  }

  async function renomear(alvo: Tarefa, titulo: string) {
    const limpo = titulo.trim();
    if (!limpo || limpo === alvo.titulo) return;
    if (await salvar(alvo, { titulo: limpo }, `título: "${alvo.titulo}" → "${limpo}"`)) {
      toast.success("Título atualizado");
    }
  }

  async function trocarObservacao(alvo: Tarefa, observacao: string) {
    const valor = observacao.trim() || null;
    if ((valor ?? "") === (alvo.observacao ?? "")) return;
    if (await salvar(alvo, { observacao: valor }, "editou a observação")) {
      toast.success(valor ? "Observação salva" : "Observação removida");
    }
  }

  /**
   * Arquivar substitui o excluir.
   *
   * A linha continua no banco: o histórico em `tarefas_log` aponta para ela por id, e um
   * toque errado no celular não pode destruir tarefa do time. O desfazer fica no próprio
   * toast porque é ali que a pessoa ainda está olhando — depois que a folha fecha e o card
   * some da lista, não há mais nenhum caminho de volta pelo celular.
   */
  async function arquivar(alvo: Tarefa) {
    setAbertas((ts) => ts.filter((t) => t.id !== alvo.id));
    setConcluidas((ts) => ts.filter((t) => t.id !== alvo.id));
    setAberta(null);

    const { error } = await sb
      .from("tarefas").update({ arquivada_em: new Date().toISOString() }).eq("id", alvo.id);
    if (error) {
      toast.error(error.message);
      await Promise.all([carregarAbertas(), carregarConcluidas(limiteConcluidas)]);
      return;
    }
    registrar({ id: alvo.id, titulo: alvo.titulo, acao: "arquivada", descricao: `Arquivada (estava em "${alvo.status}")` });

    toast.success("Tarefa arquivada", {
      action: {
        label: "Desfazer",
        onClick: async () => {
          const { error: err } = await sb.from("tarefas").update({ arquivada_em: null }).eq("id", alvo.id);
          if (err) { toast.error(err.message); return; }
          registrar({ id: alvo.id, titulo: alvo.titulo, acao: "editada", descricao: "Arquivamento desfeito" });
          await Promise.all([carregarAbertas(), carregarConcluidas(limiteConcluidas)]);
          toast.success("Tarefa restaurada");
        },
      },
    });
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
    // Criada para outra pessoa com o filtro em "Minhas", ela nasceria invisível: a tela
    // diria "criada" e a lista continuaria igual. Mostra onde ela caiu.
    if (filtro !== "todas" && !mesmaPessoa(novo.responsavel, profile?.nome)) setFiltro("todas");
    await carregarAbertas();
    return true;
  }

  /* ------------------------------ listas ------------------------------ */
  const filtradas = useMemo(
    () => aplicarFiltro(abertas, filtro, profile?.nome, hoje) as Tarefa[],
    [abertas, filtro, profile?.nome, hoje],
  );
  const grupos = useMemo(() => agrupar(filtradas, hoje), [filtradas, hoje]);
  // Sem reordenar: o banco já devolve da mais recente para a mais antiga, que é a ordem
  // que "Carregar mais" continua. Reordenar por prioridade aqui embaralhava a paginação.
  const concluidasFiltradas = useMemo(
    () => aplicarFiltro(concluidas, filtro === "atrasadas" ? "todas" : filtro, profile?.nome, hoje) as Tarefa[],
    [concluidas, filtro, profile?.nome, hoje],
  );
  const nAtrasadas = useMemo(() => abertas.filter((t) => estaAtrasada(t, hoje)).length, [abertas, hoje]);
  // Os destinos saem do que existe hoje no banco (ver statusDisponiveis), não de uma
  // lista fixa — inclui as colunas criadas no Kanban do desktop.
  const statusPossiveis = useMemo(
    () => statusDisponiveis([...abertas, ...concluidas], aberta?.status),
    [abertas, concluidas, aberta?.status],
  );
  // Idem para as pessoas: quem já tem tarefa, mais quem está logado (que pode ainda não
  // ter nenhuma e mesmo assim precisa poder pegar uma para si).
  const pessoas = useMemo(
    () => pessoasConhecidas([
      ...[...abertas, ...concluidas].map((t) => t.responsavel),
      profile?.nome?.split(" ")[0],
    ]),
    [abertas, concluidas, profile?.nome],
  );

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
                : filtro === "atrasadas"
                  ? "Nenhuma tarefa com prazo vencido."
                  : "Nenhuma tarefa em aberto."}
            </div>
          )}

          {grupos.map((g) => (
            <section key={g.chave}>
              <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {g.titulo}
                <span className="num rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {g.itens.length}
                </span>
                {/* O bloco deixou de ser "Precisa de atenção"; o alerta virou este contador,
                    e a ordem interna (ver `ordenar`) já põe urgente e vencida no topo. */}
                {g.nAtencao > 0 && (
                  <span className="num flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {g.nAtencao}
                  </span>
                )}
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
              {/* Conta o que está NA TELA, não o que existe no banco: a lista vem paginada
                  de 20 em 20 e ainda passa pelo filtro do topo. Mostrar 160 ao lado de três
                  cards (ou de nenhum) fazia a seção parecer quebrada. O total vai no rodapé,
                  junto do botão que carrega o resto. */}
              <span className="num rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {concluidasFiltradas.length}
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", mostrarConcluidas && "rotate-180")} />
            </button>

            {mostrarConcluidas && (
              <>
                {concluidasFiltradas.length === 0 ? (
                  <div className="mt-2 rounded-xl border border-border bg-card px-4 py-6 text-center text-[12.5px] leading-relaxed text-muted-foreground">
                    {filtro === "minhas" && concluidas.length > 0
                      ? `Nenhuma sua entre as ${concluidas.length} concluídas mais recentes.`
                      : "Nenhuma tarefa concluída."}
                  </div>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {concluidasFiltradas.map((t) => (
                      <CardTarefa key={t.id} t={t} hoje={hoje} onAbrir={() => setAberta(t)} />
                    ))}
                  </ul>
                )}
                {concluidas.length < totalConcluidas && (
                  <button
                    onClick={() => {
                      const proximo = limiteConcluidas + PAGINA_CONCLUIDAS;
                      setLimiteConcluidas(proximo);
                      carregarConcluidas(proximo);
                    }}
                    className="mt-2 min-h-[44px] w-full rounded-xl border border-dashed border-border text-[13px] font-medium text-muted-foreground"
                  >
                    Carregar mais ({concluidas.length} de {totalConcluidas} carregadas)
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
        status={statusPossiveis}
        pessoas={pessoas}
        onFechar={() => setAberta(null)}
        onStatus={trocarStatus}
        onPrioridade={trocarPrioridade}
        onChecklist={mudarChecklist}
        onPrazo={trocarPrazo}
        onResponsavel={trocarResponsavel}
        onRenomear={renomear}
        onObservacao={trocarObservacao}
        onArquivar={arquivar}
      />
      <FolhaCriar
        aberta={criando}
        pessoas={pessoas}
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

/**
 * Escolha de responsável em chips.
 *
 * Não é um `<select>` porque a lista de gente do financeiro cabe na tela e um toque é mais
 * rápido que abrir a roda nativa do iOS. "Outra…" existe para quem ainda não tem nenhuma
 * tarefa: sem ele, a única saída seria o computador. E se a tarefa já estiver com alguém
 * que não está na lista, essa pessoa vira um chip próprio — nunca se perde de vista quem é
 * o dono atual.
 */
function SeletorResponsavel({
  pessoas, valor, permitirVazio, onEscolher,
}: {
  pessoas: Pessoa[];
  valor: string | null;
  permitirVazio?: boolean;
  onEscolher: (valor: string | null) => void;
}) {
  const [digitando, setDigitando] = useState(false);
  const [texto, setTexto] = useState("");

  const atual = (valor ?? "").trim();
  const conhecida = !atual || pessoas.some((p) => mesmaPessoa(p.valor, atual));
  const lista = conhecida ? pessoas : [...pessoas, { chave: atual, rotulo: rotuloResponsavel(atual), valor: atual }];

  const confirmar = () => {
    const novo = texto.trim();
    if (novo) onEscolher(novo);
    setTexto("");
    setDigitando(false);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {lista.map((p) => (
        <button
          key={p.chave}
          onClick={() => onEscolher(p.valor)}
          className={cn(
            "flex min-h-[38px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium",
            mesmaPessoa(p.valor, atual)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-foreground",
          )}
        >
          <span className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold",
            mesmaPessoa(p.valor, atual) ? "bg-primary-foreground/20" : "bg-primary/15 text-primary",
          )}>
            {iniciais(p.valor)}
          </span>
          {p.rotulo}
        </button>
      ))}

      {permitirVazio && (
        <button
          onClick={() => onEscolher(null)}
          className={cn(
            "min-h-[38px] rounded-full border px-3.5 text-[12.5px] font-medium",
            !atual ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
          )}
        >
          Sem responsável
        </button>
      )}

      {digitando ? (
        <div className="flex w-full items-center gap-2">
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } }}
            placeholder="Nome da pessoa"
            className="h-11 flex-1 text-base"
            autoFocus
          />
          <Button onClick={confirmar} disabled={!texto.trim()} className="h-11 px-4">OK</Button>
          <Button variant="ghost" onClick={() => { setTexto(""); setDigitando(false); }} className="h-11 px-3">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setDigitando(true)}
          className="min-h-[38px] rounded-full border border-dashed border-border px-3.5 text-[12.5px] font-medium text-muted-foreground"
        >
          Outra…
        </button>
      )}
    </div>
  );
}

function FolhaDetalhe({
  tarefa, status, pessoas, onFechar, onStatus, onPrioridade, onChecklist, onPrazo, onResponsavel,
  onRenomear, onObservacao, onArquivar,
}: {
  tarefa: Tarefa | null;
  status: string[];
  pessoas: Pessoa[];
  onFechar: () => void;
  onStatus: (t: Tarefa, s: string) => void;
  onPrioridade: (t: Tarefa, p: string) => void;
  onChecklist: (t: Tarefa, subtarefas: Subtarefa[]) => void;
  onPrazo: (t: Tarefa, prazo: string | null) => void;
  onResponsavel: (t: Tarefa, responsavel: string | null) => void;
  onRenomear: (t: Tarefa, titulo: string) => void;
  onObservacao: (t: Tarefa, observacao: string) => void;
  onArquivar: (t: Tarefa) => void;
}) {
  return (
    <Drawer open={!!tarefa} onOpenChange={(v) => !v && onFechar()}>
      <DrawerContent className="max-h-[88dvh]">
        {tarefa && (
          <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            {/* `key` remonta os campos quando a folha troca de tarefa: sem isso o rascunho
                de uma tarefa vazaria para a próxima que fosse aberta. */}
            <CampoTitulo key={`t-${tarefa.id}`} tarefa={tarefa} onSalvar={onRenomear} />

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              <span>{rotuloResponsavel(tarefa.responsavel)}</span>
              <span className="num flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> {fmtData(tarefa.prazo)}
              </span>
            </div>

            <CampoObservacao key={`o-${tarefa.id}`} tarefa={tarefa} onSalvar={onObservacao} />

            <Checklist key={`c-${tarefa.id}`} tarefa={tarefa} onMudar={onChecklist} />

            <div className="mt-5">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Status</div>
              <div className="flex flex-wrap gap-2">
                {status.map((s) => (
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

            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Responsável</div>
              <SeletorResponsavel
                pessoas={pessoas}
                valor={tarefa.responsavel}
                permitirVazio
                onEscolher={(v) => onResponsavel(tarefa, v)}
              />
            </div>

            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Prazo</div>
              <div className="flex items-center gap-2">
                {/* `prazo` é DATE: corta em 10 caracteres para o input não receber hora e
                    devolver o dia anterior por fuso. text-base evita o zoom do Safari. */}
                <Input
                  type="date"
                  value={tarefa.prazo?.slice(0, 10) ?? ""}
                  onChange={(e) => onPrazo(tarefa, e.target.value || null)}
                  className="h-11 flex-1 text-base"
                />
                {tarefa.prazo && (
                  <Button variant="outline" onClick={() => onPrazo(tarefa, null)} className="h-11 px-3 text-[12.5px]">
                    Limpar
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {/* Adiar é a ação mais comum no celular: quem abre a tarefa no corredor
                    quer empurrar o prazo, não digitar uma data no teclado numérico. */}
                <BotaoAdiar rotulo="Hoje" dias={0} onEscolher={(d) => onPrazo(tarefa, d)} />
                <BotaoAdiar rotulo="Amanhã" dias={1} onEscolher={(d) => onPrazo(tarefa, d)} />
                <BotaoAdiar rotulo="+1 semana" dias={7} onEscolher={(d) => onPrazo(tarefa, d)} />
              </div>
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <Button
                variant="outline"
                onClick={() => onArquivar(tarefa)}
                className="h-11 w-full border-destructive/30 text-destructive active:bg-destructive/10"
              >
                <Archive className="mr-2 h-4 w-4" /> Arquivar tarefa
              </Button>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Sai das listas do celular e do computador, mas não é apagada — dá para
                desfazer no aviso que aparece logo depois.
              </p>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Título editável.
 *
 * Rascunho local com Salvar/Cancelar explícitos, e não gravação a cada tecla: no celular a
 * folha fica aberta enquanto se digita e um `onChange` direto no banco mandaria um UPDATE
 * por caractere. Confirmar com Enter porque o teclado do celular mostra "ir" e é o gesto
 * que a pessoa já espera.
 */
function CampoTitulo({ tarefa, onSalvar }: { tarefa: Tarefa; onSalvar: (t: Tarefa, titulo: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(tarefa.titulo);

  if (!editando) {
    return (
      <button
        onClick={() => { setTexto(tarefa.titulo); setEditando(true); }}
        className="flex w-full items-start gap-2 text-left active:opacity-60"
      >
        <DrawerTitle className="min-w-0 flex-1 break-words text-[16px] leading-snug">{tarefa.titulo}</DrawerTitle>
        <Pencil className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  const confirmar = () => { onSalvar(tarefa, texto); setEditando(false); };

  return (
    <div>
      <DrawerTitle className="sr-only">{tarefa.titulo}</DrawerTitle>
      <Input
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
        className="h-11 text-base"
      />
      <div className="mt-2 flex gap-2">
        <Button onClick={confirmar} className="h-10 flex-1 text-[13px]">
          <Check className="mr-1.5 h-4 w-4" /> Salvar
        </Button>
        <Button variant="outline" onClick={() => setEditando(false)} className="h-10 text-[13px]">
          <X className="mr-1.5 h-4 w-4" /> Cancelar
        </Button>
      </div>
    </div>
  );
}

function CampoObservacao({ tarefa, onSalvar }: { tarefa: Tarefa; onSalvar: (t: Tarefa, observacao: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(tarefa.observacao ?? "");

  if (editando) {
    return (
      <div className="mt-4">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Observação</div>
        <Textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={5}
          className="text-base"
          placeholder="Contexto, link, o que ficou combinado…"
        />
        <div className="mt-2 flex gap-2">
          <Button onClick={() => { onSalvar(tarefa, texto); setEditando(false); }} className="h-10 flex-1 text-[13px]">
            <Check className="mr-1.5 h-4 w-4" /> Salvar
          </Button>
          <Button variant="outline" onClick={() => setEditando(false)} className="h-10 text-[13px]">
            <X className="mr-1.5 h-4 w-4" /> Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Observação</span>
        <button
          onClick={() => { setTexto(tarefa.observacao ?? ""); setEditando(true); }}
          className="flex h-8 items-center gap-1 px-1 text-[12px] text-muted-foreground active:opacity-60"
        >
          <Pencil className="h-3.5 w-3.5" /> {tarefa.observacao ? "Editar" : "Adicionar"}
        </button>
      </div>
      {tarefa.observacao ? (
        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">{tarefa.observacao}</p>
      ) : (
        <p className="text-[13px] text-muted-foreground">Sem observação.</p>
      )}
    </div>
  );
}

function Checklist({ tarefa, onMudar }: { tarefa: Tarefa; onMudar: (t: Tarefa, s: Subtarefa[]) => void }) {
  const [novo, setNovo] = useState("");
  const feitas = tarefa.subtarefas.filter((s) => s.done).length;

  const acrescentar = () => {
    if (!novo.trim()) return;
    onMudar(tarefa, adicionarSubtarefa(tarefa.subtarefas, novo));
    setNovo("");
  };

  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Checklist{tarefa.subtarefas.length > 0 && ` · ${feitas}/${tarefa.subtarefas.length}`}
      </div>

      {tarefa.subtarefas.length > 0 && (
        <ul className="space-y-1">
          {tarefa.subtarefas.map((s) => (
            <li key={s.id} className="flex items-center gap-1">
              <button
                onClick={() => onMudar(tarefa, alternarSubtarefa(tarefa.subtarefas, s.id))}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left active:bg-secondary"
              >
                <span className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                  s.done ? "border-primary bg-primary text-primary-foreground" : "border-input",
                )}>
                  {s.done && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className={cn("min-w-0 text-[13.5px] leading-snug", s.done && "text-muted-foreground line-through")}>
                  {s.titulo}
                </span>
              </button>
              <button
                onClick={() => onMudar(tarefa, removerSubtarefa(tarefa.subtarefas, s.id))}
                aria-label={`Remover "${s.titulo}"`}
                className="flex h-11 w-9 shrink-0 items-center justify-center text-muted-foreground active:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1.5 flex gap-2">
        <Input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") acrescentar(); }}
          placeholder="Novo item…"
          className="h-11 flex-1 text-base"
        />
        <Button variant="outline" onClick={acrescentar} disabled={!novo.trim()} className="h-11 px-3">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function BotaoAdiar({ rotulo, dias, onEscolher }: { rotulo: string; dias: number; onEscolher: (d: string) => void }) {
  return (
    <button
      onClick={() => onEscolher(emDias(dias))}
      className="min-h-[36px] rounded-full border border-dashed border-border bg-card px-3 text-[12px] font-medium text-muted-foreground"
    >
      {rotulo}
    </button>
  );
}

function FolhaCriar({
  aberta, pessoas, responsavelPadrao, onFechar, onCriar,
}: {
  aberta: boolean;
  pessoas: Pessoa[];
  responsavelPadrao: string;
  onFechar: () => void;
  onCriar: (t: { titulo: string; responsavel: string; prioridade: string; prazo: string }) => Promise<boolean>;
}) {
  const [titulo, setTitulo] = useState("");
  const [responsavel, setResponsavel] = useState(responsavelPadrao);
  const [prioridade, setPrioridade] = useState("Média");
  const [prazo, setPrazo] = useState(hojeISO());
  const [salvando, setSalvando] = useState(false);

  // Lido por ref, não por dependência: `pessoas` é um array novo a cada recarga da lista
  // (e o app recarrega sozinho ao voltar do bolso), e como dependência isso limparia o
  // formulário no meio da digitação.
  const pessoasRef = useRef(pessoas);
  pessoasRef.current = pessoas;

  useEffect(() => {
    if (!aberta) return;
    setTitulo("");
    // Já existe grafia gravada para quem está logado? Usa ELA. Escrever "Júlia" onde a
    // base inteira diz "Julia" só acrescentaria mais uma variante.
    const conhecida = pessoasRef.current.find((p) => mesmaPessoa(p.valor, responsavelPadrao));
    setResponsavel(conhecida?.valor ?? responsavelPadrao);
    setPrioridade("Média");
    setPrazo(hojeISO());
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
              {/* Antes era um campo livre, que é como a coluna acabou com cinco grafias
                  para duas pessoas. Aqui a escolha padrão é reaproveitar quem já existe. */}
              <SeletorResponsavel pessoas={pessoas} valor={responsavel} onEscolher={(v) => setResponsavel(v ?? "")} />
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
              <div className="flex flex-wrap gap-2 pt-0.5">
                <BotaoAdiar rotulo="Hoje" dias={0} onEscolher={setPrazo} />
                <BotaoAdiar rotulo="Amanhã" dias={1} onEscolher={setPrazo} />
                <BotaoAdiar rotulo="+1 semana" dias={7} onEscolher={setPrazo} />
              </div>
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
