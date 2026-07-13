import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { openAIAssistant } from "@/components/AIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { TaskDialog, DEFAULT_COLUMNS, type Tarefa } from "@/components/tarefas/TaskDialog";
import {
  Sparkles, RefreshCw, Loader2, CalendarDays, AlertTriangle, Mail,
  Clock, ArrowRight, Newspaper, CalendarClock, ListChecks, CheckCircle2, Pencil,
} from "lucide-react";

/* ============================================================================
 * A skill de briefing grava o JSONB no SEU próprio formato (agenda por pessoa,
 * emails como array, noticias por tema). A página NÃO assume um formato fixo:
 * um normalizador (buildVM) mapeia tanto esse formato quanto o canônico do seed
 * para um view-model único. Se um dia o JSONB não trouxer nada aproveitável,
 * caímos no render do conteudo_markdown (sempre bem formado pela skill).
 * ========================================================================== */

type Briefing = {
  id: string;
  periodo_inicio: string;
  periodo_fim: string;
  conteudo_markdown: string;
  agenda: any;
  emails: any;
  noticias: any;
  gerado_em: string;
};

const sb = supabase as any;

/* ------------------------------ helpers de data ------------------------------ */
const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const DIAS_ABBR = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const parseLocal = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, (m ?? 1) - 1, d ?? 1); };
const fmtDDMM = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
const fmtDDMMYYYY = (d: Date) => `${fmtDDMM(d)}/${d.getFullYear()}`;
const fmtHoraBRT = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
/** data do dia (YYYY-MM-DD) no fuso BRT — usada p/ casar tarefas.prazo e identificar "hoje". */
const isoDateBRT = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const agoraHHMM_BRT = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "fonte"; } };

/* mesma normalização de responsável usada na página Tarefas (prefixo do nome) */
const normalizeResp = (v?: string | null) => {
  const s = (v || "").trim().toLowerCase();
  if (s.startsWith("henr")) return "Henrique";
  if (s.startsWith("jul") || s.startsWith("júl")) return "Júlia";
  return (v || "").trim() || "—";
};
const iniciais = (nome?: string | null) => {
  if (!nome) return "—";
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase();
};
const PRIO_ORDER: Record<string, number> = { "Urgente": 3, "Alta": 2, "Média": 1, "Baixa": 0 };
const PRIO_DOT_B: Record<string, string> = {
  "Baixa": "bg-muted-foreground", "Média": "bg-amber-500", "Alta": "bg-red-600", "Urgente": "bg-primary",
};

/* --------------------------- cores / estilos --------------------------- */
const CORES_PESSOA: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  blue: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};
const COR_DOT: Record<string, string> = { primary: "bg-primary", blue: "bg-sky-500", green: "bg-emerald-500", amber: "bg-amber-500" };
const DOT_TIMELINE: Record<string, string> = {
  caixa: "bg-primary", conflito: "bg-primary", reuniao: "bg-sky-500",
  conciliacao: "bg-emerald-500", revisao: "bg-muted-foreground/40", outro: "bg-muted-foreground/40",
};
const BARRA_TOM: Record<string, string> = { red: "bg-primary", amber: "bg-amber-500", neutral: "bg-border" };
const BADGE_TOM: Record<string, string> = {
  red: "bg-primary/10 text-primary",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  neutral: "bg-secondary text-muted-foreground",
};

/* metadados de exibição por chave de pessoa (formato da skill: financeiro/henrique/julia) */
const PESSOA_META: Record<string, { nome: string; papel: string; iniciais: string; cor: string }> = {
  financeiro: { nome: "Você", papel: "financeiro@takeat.app", iniciais: "VC", cor: "primary" },
  voce: { nome: "Você", papel: "financeiro@takeat.app", iniciais: "VC", cor: "primary" },
  henrique: { nome: "Henrique", papel: "gerente financeiro", iniciais: "HM", cor: "blue" },
  julia: { nome: "Júlia", papel: "analista financeira", iniciais: "JR", cor: "green" },
};
const TEMA_TITULO: Record<string, string> = {
  macro: "MERCADO FINANCEIRO / MACRO BRASIL",
  tech_saas: "TECNOLOGIA / SAAS", tech: "TECNOLOGIA / SAAS", saas: "TECNOLOGIA / SAAS",
  foodservice: "RESTAURANTES / FOODSERVICE", restaurantes: "RESTAURANTES / FOODSERVICE",
};

/* renderiza markdown inline (negrito + links) dentro de um resumo curto */
const mdComponents = {
  a: (props: any) => <a {...props} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline" />,
  p: (props: any) => <span {...props} />,
  strong: (props: any) => <strong {...props} className="num font-semibold text-foreground" />,
};

/* ============================ NORMALIZADOR ============================ */
type VMEvento = { hora: string; titulo: string; timed: boolean; sortKey: string; conflito?: boolean; com?: string | null };
type VMPessoa = { id: string; nome: string; papel: string; iniciais: string; cor: string; eventos: VMEvento[] };
type VMEmail = { remetente: string; badge: string | null; tom: "red" | "amber" | "neutral"; resumo: string; busca: string; link: string | null };

const IGNORE_AGENDA_KEYS = new Set([
  "conflitos", "bloqueios_compartilhados", "data", "dia_semana", "total_compromissos",
  "total_pessoas", "proximo_evento", "resumo_ia", "resumo_tags", "timeline", "pessoas",
]);

function normEvento(ev: any): VMEvento | null {
  if (ev == null) return null;
  if (typeof ev === "string") return { hora: "—", titulo: ev, timed: false, sortKey: "99:99" };
  const summary = ev.summary ?? ev.titulo ?? ev.title ?? "(sem título)";
  let hora: string = ev.hora ?? "";
  let timed = false;
  const allDay = ev.all_day ?? ev.allDay ?? (!!ev.date && !ev.start && !ev.hora);
  if (!hora) {
    if (allDay) hora = "dia todo";
    else if (ev.start) { const m = /T(\d{2}:\d{2})/.exec(String(ev.start)); if (m) { hora = m[1]; timed = true; } }
  } else if (/^\d{1,2}:\d{2}/.test(hora)) timed = true;
  const note = ev.note ?? ev.nota ?? null;
  const titulo = note ? `${summary} · ${note}` : summary;
  return { hora: hora || "—", titulo, timed, sortKey: timed ? hora : "00:00", conflito: !!ev.conflito, com: ev.com ?? null };
}

function normalizeAgenda(agenda: any) {
  const a = agenda ?? {};
  let pessoas: VMPessoa[] = [];

  if (Array.isArray(a.pessoas) && a.pessoas.length) {
    pessoas = a.pessoas.map((p: any) => {
      const meta = PESSOA_META[p.id] ?? ({} as any);
      return {
        id: p.id ?? p.nome, nome: p.nome ?? meta.nome ?? p.id, papel: p.papel ?? meta.papel ?? "",
        iniciais: p.iniciais ?? meta.iniciais ?? iniciais(p.nome ?? p.id), cor: p.cor ?? meta.cor ?? "primary",
        eventos: (p.eventos ?? []).map(normEvento).filter(Boolean) as VMEvento[],
      };
    });
  } else {
    const order = ["financeiro", "voce", "henrique", "julia"];
    const keys = Object.keys(a).filter((k) => !IGNORE_AGENDA_KEYS.has(k) && Array.isArray(a[k]));
    keys.sort((x, y) => (order.indexOf(x) === -1 ? 99 : order.indexOf(x)) - (order.indexOf(y) === -1 ? 99 : order.indexOf(y)));
    pessoas = keys.map((k) => {
      const meta = PESSOA_META[k] ?? { nome: k.charAt(0).toUpperCase() + k.slice(1), papel: "", iniciais: k.slice(0, 2).toUpperCase(), cor: "primary" };
      return { id: k, ...meta, eventos: (a[k] ?? []).map(normEvento).filter(Boolean) as VMEvento[] };
    });
  }
  pessoas.forEach((p) => p.eventos.sort((e1, e2) => e1.sortKey.localeCompare(e2.sortKey)));

  const conflitos = (a.conflitos ?? []).map((c: any) =>
    typeof c === "string"
      ? { hora: undefined as string | undefined, titulo: c, resumo_curto: undefined as string | undefined }
      : {
          hora: c.hora ?? c.horario,
          titulo: c.titulo ?? c.descricao ?? c.resumo ?? c.summary ?? "Conflito de agenda",
          resumo_curto: c.resumo_curto ?? (Array.isArray(c.pessoas) ? c.pessoas.join(" × ") : undefined),
        },
  );

  let timeline: { hora: string; titulo: string; dot: string }[] = [];
  if (Array.isArray(a.timeline) && a.timeline.length) {
    timeline = a.timeline.map((t: any) => ({ hora: t.hora, titulo: t.titulo, dot: DOT_TIMELINE[t.tipo ?? "outro"] ?? DOT_TIMELINE.outro }));
  } else {
    const items: { hora: string; titulo: string; dot: string }[] = [];
    pessoas.forEach((p) => p.eventos.forEach((e) => { if (e.timed) items.push({ hora: e.hora, titulo: e.titulo, dot: COR_DOT[p.cor] ?? DOT_TIMELINE.outro }); }));
    conflitos.forEach((c) => { if (c.hora) items.push({ hora: c.hora, titulo: c.titulo, dot: "bg-primary" }); });
    items.sort((x, y) => String(x.hora).localeCompare(String(y.hora)));
    timeline = items;
  }

  const nCompromissos = a.total_compromissos ?? pessoas.reduce((s, p) => s + p.eventos.length, 0);
  const nPessoas = a.total_pessoas ?? pessoas.length;
  return { pessoas, conflitos, timeline, nCompromissos, nPessoas, resumoIa: a.resumo_ia ?? null, resumoTags: (a.resumo_tags ?? []) as string[], proximoCanon: a.proximo_evento ?? null };
}

/** tom visual de um e-mail canônico (com tipo/vencimento) */
function tomEmailCanon(item: any): "red" | "amber" | "neutral" {
  if (item.tipo === "aprovacao" || item.tipo === "alerta") return "amber";
  if (item.tipo === "vencimento" && item.vence_em) {
    const dias = Math.round((parseLocal(item.vence_em).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
    return dias <= 5 ? "red" : "neutral";
  }
  return item.tipo === "vencimento" ? "red" : "neutral";
}

function normalizeEmails(emails: any) {
  const arr: any[] = Array.isArray(emails) ? emails : (emails?.itens ?? []);
  const total = (!Array.isArray(emails) && typeof emails?.total === "number") ? emails.total : arr.length;
  const itens: VMEmail[] = arr.map((e: any) => {
    if (e.resumo || e.tipo || e.badge) {
      return { remetente: e.remetente ?? "—", badge: e.badge ?? null, tom: tomEmailCanon(e), resumo: e.resumo ?? "", busca: e.remetente ?? "", link: e.link ?? null };
    }
    // formato da skill: { remetente, assunto, acao, data }
    const resumo = e.assunto ? `**${e.assunto}** — ${e.acao ?? ""}` : (e.acao ?? e.resumo ?? "");
    return { remetente: e.remetente ?? "—", badge: "AÇÃO", tom: "amber", resumo, busca: e.assunto ?? e.remetente ?? "", link: e.link ?? null };
  });
  const vencemSemana = (!Array.isArray(emails) && typeof emails?.vencem_semana === "number")
    ? emails.vencem_semana
    : arr.filter((e: any) => e.vence_em).length;
  return { total, itens, vencemSemana };
}

function normalizeNoticias(noticias: any) {
  const n = noticias ?? {};
  if (Array.isArray(n.temas)) {
    return { janela: n.janela ?? null, temas: n.temas.map((t: any) => ({ titulo: t.titulo ?? "", resumo: t.resumo ?? "" })) };
  }
  const order = ["macro", "tech_saas", "tech", "saas", "foodservice", "restaurantes"];
  const keys = Object.keys(n).filter((k) => k !== "janela" && n[k] && typeof n[k] === "object");
  keys.sort((x, y) => (order.indexOf(x) === -1 ? 99 : order.indexOf(x)) - (order.indexOf(y) === -1 ? 99 : order.indexOf(y)));
  const temas = keys.map((k) => {
    const t = n[k];
    let resumo: string = t.resumo ?? t.texto ?? "";
    const fontes: string[] = Array.isArray(t.fontes) ? t.fontes : (Array.isArray(t.links) ? t.links : []);
    if (fontes.length && !/\]\(/.test(resumo)) resumo += ` (${fontes.map((u) => `[${hostOf(u)}](${u})`).join(", ")})`;
    return { titulo: TEMA_TITULO[k] ?? k.replace(/_/g, " ").toUpperCase(), resumo };
  });
  return { janela: n.janela ?? null, temas };
}

function buildVM(b: Briefing) {
  const diaISO = b.agenda?.data ?? isoDateBRT(b.gerado_em);
  const dataHoje = parseLocal(diaISO);
  const ini = parseLocal(b.periodo_inicio), fim = parseLocal(b.periodo_fim);
  const janelaLabel = b.periodo_inicio === b.periodo_fim
    ? "hoje"
    : `${DIAS_ABBR[ini.getDay()]} ${fmtDDMM(ini)} – ${DIAS_ABBR[fim.getDay()]} ${fmtDDMM(fim)}`;

  const A = normalizeAgenda(b.agenda);
  const E = normalizeEmails(b.emails);
  const N = normalizeNoticias(b.noticias);

  // próximo evento: próximo horário >= agora (se for hoje), senão o 1º do dia
  let proximo = A.proximoCanon as { hora: string; titulo: string } | null;
  const timed = A.timeline.filter((t) => /^\d{1,2}:\d{2}$/.test(String(t.hora)));
  if (!proximo && timed.length) {
    if (diaISO === isoDateBRT(new Date().toISOString())) {
      const now = agoraHHMM_BRT();
      const up = timed.find((t) => String(t.hora).padStart(5, "0") >= now);
      proximo = up ?? timed[timed.length - 1];
    } else proximo = timed[0];
  }

  return {
    diaISO, dataHoje, diaSemana: DIAS_SEMANA[dataHoje.getDay()], janelaLabel, entregueHora: fmtHoraBRT(b.gerado_em),
    nCompromissos: A.nCompromissos, nPessoas: A.nPessoas, conflitos: A.conflitos, timeline: A.timeline,
    pessoas: A.pessoas, resumoIa: A.resumoIa, resumoTags: A.resumoTags, proximo,
    emails: E.itens, nEmails: E.total, vencemSemana: E.vencemSemana,
    temas: N.temas, janelaNoticias: N.janela ?? (b.periodo_inicio === b.periodo_fim ? null : `${fmtDDMM(ini)}–${fmtDDMM(fim)}`),
    temEstruturado: A.pessoas.length > 0 || E.itens.length > 0 || N.temas.length > 0,
  };
}
type VM = ReturnType<typeof buildVM>;

/* ============================================================================ */
export default function Briefing() {
  const { profile } = useAuth();
  const [b, setB] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [editing, setEditing] = useState<Tarefa | null>(null);

  async function carregar(silencioso = false): Promise<Briefing | null> {
    if (!silencioso) setLoading(true);
    const { data, error } = await sb
      .from("briefing_diario")
      .select("id,periodo_inicio,periodo_fim,conteudo_markdown,agenda,emails,noticias,gerado_em")
      .order("gerado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) toast.error("Falha ao carregar o briefing: " + error.message);
    const row = (data as Briefing) ?? null;
    setB(row);
    setLoading(false);
    return row;
  }
  useEffect(() => { carregar(); }, []);

  // Tarefas com prazo para o dia do briefing (busca ao vivo — independe da skill).
  async function carregarTarefas() {
    if (!b) { setTarefas([]); return; }
    const dia = b.agenda?.data ?? isoDateBRT(b.gerado_em);
    const { data } = await sb
      .from("tarefas")
      .select("*")
      .eq("prazo", dia)
      .order("ordem");
    setTarefas(((data as any[]) ?? []).map((r) => ({ ...r, subtarefas: Array.isArray(r.subtarefas) ? r.subtarefas : [] })) as Tarefa[]);
  }
  useEffect(() => { carregarTarefas(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [b]);

  // Edição a partir do briefing: grava a alteração na tabela tarefas (otimista).
  async function salvarTarefa(patch: Partial<Tarefa>) {
    if (!editing) return;
    setTarefas((ts) => ts.map((t) => (t.id === editing.id ? { ...t, ...patch } : t)));
    const { error } = await sb.from("tarefas").update(patch as any).eq("id", editing.id);
    if (error) toast.error("Erro ao salvar tarefa: " + error.message);
  }

  async function regerar() {
    // A geração real roda na tarefa agendada das 09:00 (skill com Gmail/Agenda/WebSearch).
    // Aqui buscamos a última versão publicada no Hub.
    setRefreshing(true);
    const antes = b?.gerado_em;
    const atual = await carregar(true);
    setRefreshing(false);
    if (atual?.gerado_em && atual.gerado_em !== antes) toast.success("Briefing atualizado com a versão mais recente.");
    else toast.message("Você já está na versão mais recente publicada.");
  }

  function aprofundar() {
    openAIAssistant(
      `Com base no meu briefing diário de hoje (agenda, e-mails acionáveis e notícias), me ajude a priorizar as ações do dia e destacar riscos.\n\n${b?.conteudo_markdown ?? ""}`,
    );
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando o briefing…
      </div>
    );
  }

  if (!b) {
    return (
      <div className="card-surface mx-auto mt-10 max-w-md p-8 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-amber-500 text-white">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="mb-1 text-[15px] font-semibold">Nenhum briefing publicado ainda</div>
        <p className="mb-4 text-[12.5px] text-muted-foreground">
          O briefing diário é gerado automaticamente às 09:00 (America/Sao_Paulo) e publicado aqui no Hub.
          Assim que a primeira execução rodar, ele aparece nesta tela.
        </p>
        <button onClick={() => carregar()} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground">
          <RefreshCw className="h-4 w-4" /> Buscar briefing
        </button>
      </div>
    );
  }

  const vm = buildVM(b);
  // garante que o status atual da tarefa esteja entre as opções do seletor
  const editColumns = Array.from(new Set([...DEFAULT_COLUMNS, editing?.status].filter(Boolean))) as string[];
  return (
    <>
      <BriefingView b={b} vm={vm} tarefas={tarefas} meNome={profile?.nome ?? null} onEdit={setEditing} onRegerar={regerar} onAprofundar={aprofundar} refreshing={refreshing} />
      <TaskDialog
        columns={editColumns}
        open={!!editing}
        tarefa={editing ?? undefined}
        onClose={() => { setEditing(null); carregarTarefas(); }}
        onSave={salvarTarefa}
        title="Editar Tarefa"
      />
    </>
  );
}

/* ============================================================================ */
function BriefingView({ b, vm, tarefas, meNome, onEdit, onRegerar, onAprofundar, refreshing }: {
  b: Briefing; vm: VM; tarefas: Tarefa[]; meNome: string | null;
  onEdit: (t: Tarefa) => void;
  onRegerar: () => void; onAprofundar: () => void; refreshing: boolean;
}) {
  /* ---------------- tarefas com prazo hoje (você + Júlia) ---------------- */
  const meNorm = normalizeResp(meNome);
  const alvos = Array.from(new Set([meNorm && meNorm !== "—" ? meNorm : "Henrique", "Júlia"]));
  const tarefasPorPessoa = alvos.map((alvo) => ({
    alvo,
    nome: alvo === meNorm ? (meNome?.split(/\s+/)[0] || alvo) : alvo,
    ehVoce: alvo === meNorm,
    itens: tarefas
      .filter((t) => normalizeResp(t.responsavel) === alvo)
      .sort((a, z) => (PRIO_ORDER[z.prioridade] ?? 0) - (PRIO_ORDER[a.prioridade] ?? 0)),
  }));
  const totalTarefas = tarefasPorPessoa.reduce((s, p) => s + p.itens.length, 0);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* ---------------- Cabeçalho ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-amber-500 text-white shadow-sm">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Briefing Diário</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Entregue {vm.entregueHora}
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px] capitalize text-muted-foreground">
              {vm.diaSemana}, {fmtDDMMYYYY(vm.dataHoje)}
              <span className="lowercase"> · janela {vm.janelaLabel} · fuso America/Sao_Paulo</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={onRegerar}
            disabled={refreshing}
            title="O briefing é gerado automaticamente às 09:00. Clique para buscar a versão publicada mais recente."
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Regerar
          </button>
          <button
            onClick={onAprofundar}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-[12.5px] font-semibold text-primary-foreground shadow-sm transition hover:brightness-95"
          >
            <Sparkles className="h-4 w-4" /> Aprofundar com IA
          </button>
        </div>
      </div>

      {/* ---------------- KPIs ---------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={CalendarDays} eyebrow="Compromissos" value={String(vm.nCompromissos)}
             sub={`entre ${vm.nPessoas} pessoa${vm.nPessoas === 1 ? "" : "s"} hoje`} />
        <Kpi icon={AlertTriangle} eyebrow="Conflitos" value={String(vm.conflitos.length)} tone={vm.conflitos.length ? "neg" : undefined}
             sub={vm.conflitos[0] ? `${vm.conflitos[0].hora ? vm.conflitos[0].hora + " · " : ""}${vm.conflitos[0].resumo_curto ?? vm.conflitos[0].titulo}` : "sem conflitos"} />
        <Kpi icon={Mail} eyebrow="E-mails acionáveis" value={String(vm.nEmails)}
             sub={vm.vencemSemana > 0 ? `${vm.vencemSemana} vence${vm.vencemSemana === 1 ? "" : "m"} esta semana` : "ruído filtrado"} />
        <Kpi icon={Clock} eyebrow="Próximo evento" value={vm.proximo?.hora ?? "—"} mono
             sub={vm.proximo?.titulo ?? "sem horários futuros"} />
      </div>

      {/* ---------------- Agenda + coluna lateral ---------------- */}
      {vm.temEstruturado ? (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {/* Agenda */}
            <div className="lg:col-span-2">
              <SectionCard
                title={<span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" /> Agenda de hoje</span>}
                subtitle={`${vm.nPessoas} pessoas · ${vm.nCompromissos} compromissos`}
                actions={vm.conflitos.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    <AlertTriangle className="h-3 w-3" /> {vm.conflitos.length} conflito{vm.conflitos.length === 1 ? "" : "s"}
                  </span>
                )}
              >
                <div className="space-y-3">
                  {vm.conflitos.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2 text-[12px]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="text-foreground"><span className="font-semibold">Conflito{c.hora ? ` às ${c.hora}` : ""}</span> — {c.titulo}</span>
                    </div>
                  ))}

                  {vm.pessoas.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border/70">
                      <div className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2">
                        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold", CORES_PESSOA[p.cor] ?? CORES_PESSOA.primary)}>
                          {p.iniciais}
                        </span>
                        <span className="text-[13px] font-semibold text-foreground">{p.nome}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{p.papel}</span>
                      </div>
                      {p.eventos.length === 0 ? (
                        <div className="px-3 py-2 text-[12px] text-muted-foreground">Nenhum compromisso hoje.</div>
                      ) : (
                        <ul>
                          {p.eventos.map((e, i) => (
                            <li key={i} className={cn(
                              "flex items-center gap-3 px-3 py-1.5 text-[12.5px]",
                              i > 0 && "border-t border-border/40",
                              e.conflito && "bg-primary/[0.04]",
                            )}>
                              <span className="num w-16 shrink-0 font-semibold text-muted-foreground">{e.hora}</span>
                              <span className="min-w-0 flex-1 truncate text-foreground">{e.titulo}</span>
                              {e.conflito && (
                                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-primary">Conflito</span>
                              )}
                              {e.com && (
                                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">C/ {e.com}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>

            {/* Coluna lateral: resumo IA + timeline */}
            <div className="space-y-3">
              {vm.resumoIa && (
                <SectionCard title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Resumo do dia · IA</span>}>
                  <p className="text-[12.5px] leading-relaxed text-foreground">{vm.resumoIa}</p>
                  {vm.resumoTags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {vm.resumoTags.map((t, i) => (
                        <span key={i} className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  )}
                </SectionCard>
              )}

              {vm.timeline.length > 0 && (
                <SectionCard title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" /> Linha do tempo</span>}>
                  <ul className="space-y-0.5">
                    {vm.timeline.map((t, i) => (
                      <li key={i} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-[12px]">
                        <span className="num w-12 shrink-0 font-semibold text-muted-foreground">{t.hora}</span>
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", t.dot)} />
                        <span className="min-w-0 flex-1 truncate text-foreground">{t.titulo}</span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              )}
            </div>
          </div>

          {/* ---------------- E-mails ---------------- */}
          {vm.emails.length > 0 && (
            <SectionCard
              title={<span className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> E-mails que pedem atenção</span>}
              subtitle={`${vm.nEmails} acionáveis · ruído filtrado`}
            >
              <div className="space-y-2.5">
                {vm.emails.map((it, i) => {
                  const href = it.link || `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(it.busca)}`;
                  return (
                    <div key={i} className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                      <span className={cn("mt-0.5 h-9 w-1 shrink-0 rounded-full", BARRA_TOM[it.tom])} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-foreground">{it.remetente}</span>
                          {it.badge && (
                            <span className={cn("rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider", BADGE_TOM[it.tom])}>{it.badge}</span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                          <ReactMarkdown components={mdComponents}>{it.resumo}</ReactMarkdown>
                        </div>
                      </div>
                      <a href={href} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                        Abrir <ArrowRight className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* ---------------- Notícias ---------------- */}
          {vm.temas.length > 0 && (
            <SectionCard
              title={<span className="flex items-center gap-2"><Newspaper className="h-4 w-4 text-muted-foreground" /> Notícias</span>}
              subtitle={vm.janelaNoticias ? `janela ${vm.janelaNoticias}` : undefined}
            >
              <div className="space-y-4">
                {vm.temas.map((t, i) => (
                  <div key={i} className="border-l-2 border-sky-500/60 pl-3">
                    <div className="mb-0.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground/80">{t.titulo}</div>
                    <div className="text-[12.5px] leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline">
                      <ReactMarkdown components={mdComponents}>{t.resumo}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      ) : (
        /* fallback: só markdown publicado */
        <SectionCard title="Briefing de hoje">
          <div className="prose prose-sm max-w-none prose-headings:tracking-tight prose-a:text-primary">
            <ReactMarkdown>{b.conteudo_markdown}</ReactMarkdown>
          </div>
        </SectionCard>
      )}

      {/* ---------------- Tarefas com prazo para hoje ---------------- */}
      <SectionCard
        title={<span className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-muted-foreground" /> Tarefas com prazo para hoje</span>}
        subtitle={`${totalTarefas} tarefa${totalTarefas === 1 ? "" : "s"} · você e Júlia · vence ${fmtDDMM(vm.dataHoje)}`}
        actions={<Link to="/tarefas" className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">Abrir Tarefas <ArrowRight className="h-3 w-3" /></Link>}
      >
        {totalTarefas === 0 ? (
          <div className="py-4 text-center text-[12.5px] text-muted-foreground">Nenhuma tarefa com prazo para hoje para você ou a Júlia.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {tarefasPorPessoa.map((p) => (
              <div key={p.alvo} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold", p.ehVoce ? "bg-primary/10 text-primary" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")}>
                    {iniciais(p.nome)}
                  </span>
                  <span className="text-[12.5px] font-semibold text-foreground">{p.nome}</span>
                  {p.ehVoce && <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">você</span>}
                  <span className="num text-[11px] text-muted-foreground">· {p.itens.length}</span>
                </div>
                {p.itens.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-2 text-[11.5px] text-muted-foreground">Sem tarefas para hoje.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {p.itens.map((t) => {
                      const done = t.status === "Concluído";
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => onEdit(t)}
                            title="Clique para editar (data, prioridade, responsável…)"
                            className="group flex w-full items-start gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left transition hover:border-primary/40 hover:bg-secondary/40"
                          >
                            <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", PRIO_DOT_B[t.prioridade] ?? "bg-muted-foreground")} />
                            <div className="min-w-0 flex-1">
                              <div className={cn("text-[12.5px] font-medium leading-snug", done ? "text-muted-foreground line-through" : "text-foreground")}>{t.titulo}</div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                                <span>{t.prioridade}</span>
                                <span>·</span>
                                <span>{t.prazo ? fmtDDMM(parseLocal(t.prazo)) : "—"}</span>
                                <span>·</span>
                                <span className="inline-flex items-center gap-1">
                                  {done && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}{t.status}
                                </span>
                              </div>
                            </div>
                            <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-transparent transition group-hover:text-muted-foreground" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="pt-1 text-center text-[11px] text-muted-foreground">
        Gerado automaticamente às {vm.entregueHora} · publicado no Hub (Supabase · <span className="num">briefing_diario</span>)
      </div>
    </div>
  );
}

/* ------------------------------ subcomponentes ------------------------------ */
function Kpi({ icon: Icon, eyebrow, value, sub, tone, mono }: {
  icon: any; eyebrow: string; value: string; sub: string; tone?: "neg" | "pos"; mono?: boolean;
}) {
  return (
    <div className="card-surface flex flex-col gap-2 p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <Icon className="h-3.5 w-3.5" /> {eyebrow}
      </div>
      <div className={cn(
        "num font-semibold leading-none tracking-tight",
        mono ? "text-[24px]" : "text-[26px]",
        tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-foreground",
      )}>
        {value}
      </div>
      <div className="mt-auto truncate text-[11.5px] text-muted-foreground">{sub}</div>
    </div>
  );
}
