import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus, Trash2, ChevronDown, ChevronRight, Filter, X, LayoutGrid,
  Table as TableIcon, AlertTriangle, MoreHorizontal,
  Search, GripVertical, Pencil, Palette, Check, CheckCircle2, Clock, ListChecks, Target, BarChart3, History, Pause, Zap, Tags, CalendarClock,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  TaskDialog, DEFAULT_COLUMNS, PRIO_OPTS, progressBarColor,
  type Subtarefa, type Tarefa,
} from "@/components/tarefas/TaskDialog";
import { AnaliseSemanal } from "@/components/tarefas/AnaliseSemanal";
import { HistoricoTarefas } from "@/components/tarefas/HistoricoTarefas";
import { calcIdade, explicaIdade } from "@/lib/tarefas/idade";
import { comparaPrioridade } from "@/lib/tarefas/prioridade";
import { AREAS, AREA_NAO_CLASSIFICADA, corDaArea, rotuloClassificacao } from "@/lib/tarefas/classificacao";
import { RevisaoClassificacao } from "@/components/tarefas/RevisaoClassificacao";
import { RotinasPanel } from "@/components/tarefas/RotinasPanel";
import { descreverCadencia, descreverCadenciaLonga, iso, lerCadencia, proximaData } from "@/lib/tarefas/rotina";

export type { Subtarefa } from "@/components/tarefas/TaskDialog";
const COLUMNS_CFG_KEY = "tarefas.columns.cfg.v1";
const LEGACY_EXTRA_KEY = "tarefas.columns.extra.v1";
const FILTROS_KEY = "tarefas.filtros.v1";

/* O que a pessoa escolheu na barra de filtros sobrevive a sair da página e
   voltar — inclusive a um F5. É escolha de quem olha, não estado da tela:
   quem trabalha filtrado por "Henrique / atrasadas" perde o recorte a cada ida
   ao DRE e refaz os quatro cliques.
   Fica de fora a BUSCA por texto: ela é pergunta de um momento ("cadê a
   fatura?"), e voltar dias depois com a lista cortada por uma palavra
   esquecida esconde tarefa sem dizer por quê.
   Os valores voltam validados contra as opções que existem hoje — período
   inventado ou responsável que saiu do time viraria um filtro que não casa com
   nada, e o quadro abriria vazio sem nenhum jeito de descobrir o motivo. */
type FiltrosSalvos = {
  view: "kanban" | "tabela" | "rotinas" | "analise" | "historico";
  periodo: string;
  prio: string;
  area: string;
  resp: string;
  atrasadas: boolean;
  fStatus: string[];
  fPrioridade: string[];
  fResponsavel: string[];
};

const FILTROS_PADRAO: FiltrosSalvos = {
  view: "kanban",
  periodo: "mes",
  prio: "",
  area: "",
  resp: "",
  atrasadas: false,
  fStatus: [],
  fPrioridade: [],
  fResponsavel: [],
};

const VIEWS_VALIDAS = ["kanban", "tabela", "rotinas", "analise", "historico"];
const PERIODOS_VALIDOS = ["", "mes", "3m", "ano"];
const RESPONSAVEIS = ["Henrique", "Júlia"];

function loadFiltros(): FiltrosSalvos {
  try {
    const raw = localStorage.getItem(FILTROS_KEY);
    if (!raw) return FILTROS_PADRAO;
    const p = JSON.parse(raw) as Partial<FiltrosSalvos>;
    const lista = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
    return {
      view: VIEWS_VALIDAS.includes(p.view as string) ? (p.view as FiltrosSalvos["view"]) : FILTROS_PADRAO.view,
      periodo: PERIODOS_VALIDOS.includes(p.periodo as string) ? (p.periodo as string) : FILTROS_PADRAO.periodo,
      prio: PRIO_OPTS.includes(p.prio as string) ? (p.prio as string) : "",
      area: (AREAS as readonly string[]).includes(p.area as string) ? (p.area as string) : "",
      resp: RESPONSAVEIS.includes(p.resp as string) ? (p.resp as string) : "",
      atrasadas: p.atrasadas === true,
      fStatus: lista(p.fStatus),
      fPrioridade: lista(p.fPrioridade),
      fResponsavel: lista(p.fResponsavel),
    };
  } catch {
    return FILTROS_PADRAO;
  }
}

type ColorId = "muted" | "warning" | "orange" | "blue" | "success" | "purple" | "pink" | "destructive";

const COLOR_PRESETS: { id: ColorId; label: string; dot: string; bar: string; ring: string }[] = [
  { id: "muted",       label: "Cinza",    dot: "bg-muted-foreground",    bar: "bg-muted-foreground/40", ring: "ring-muted-foreground/40" },
  { id: "warning",     label: "Amarelo",  dot: "bg-warning",             bar: "bg-warning",             ring: "ring-warning/40" },
  { id: "orange",      label: "Laranja",  dot: "bg-orange-500",          bar: "bg-orange-500",          ring: "ring-orange-500/40" },
  { id: "blue",        label: "Azul",     dot: "bg-blue-500",            bar: "bg-blue-500",            ring: "ring-blue-500/40" },
  { id: "success",     label: "Verde",    dot: "bg-success",             bar: "bg-success",             ring: "ring-success/40" },
  { id: "purple",      label: "Roxo",     dot: "bg-purple-500",          bar: "bg-purple-500",          ring: "ring-purple-500/40" },
  { id: "pink",        label: "Rosa",     dot: "bg-pink-500",            bar: "bg-pink-500",            ring: "ring-pink-500/40" },
  { id: "destructive", label: "Vermelho", dot: "bg-destructive",         bar: "bg-destructive",         ring: "ring-destructive/40" },
];

const DEFAULT_COLOR_BY_NAME: Record<string, ColorId> = {
  "Backlog": "muted",
  "Em andamento": "warning",
  "Acompanhamento": "orange",
  "Revisão": "blue",
  "Concluído": "success",
  "Tasks - RPA": "purple",
};

type ColumnsCfg = {
  order: string[];
  meta: Record<string, { color: ColorId }>;
};

/* Colunas aposentadas: saem da configuração salva na primeira vez que a página
   abre. A "automações" foi esvaziada no banco (migration 20260824120000) — as
   tarefas dela voltaram para o Backlog e passaram a se identificar pelo carimbo.
   Sem esta limpeza a coluna continuaria no quadro de quem a criou, agora vazia
   para sempre, sugerindo um lugar onde nada mais chega. */
const COLUNAS_APOSENTADAS = ["automações"];

/* Colunas que o SISTEMA escreve, e por isso não se apagam.
   Não é "coluna padrão" — "Em andamento" e "Tasks - RPA" também são padrão e
   podem sumir sem consequência, porque ninguém grava nelas por código.
   Estas duas são outra coisa:
     Backlog  — é o default da coluna no Postgres e o destino de todo insert
                automático (RPC do cartão, RPC das automações, gatilho do
                Facilities, app do celular, planilha de viagens). Sem ela, tarefa
                nova nasceria num lugar que não existe no quadro.
     Concluído — não é coluna, é estado: `isAtrasada` a ignora, o contador de
                concluídas a procura pelo nome, e a RPC das automações só
                reabre tarefa que não esteja nela.
   Apagar qualquer uma das duas não esconderia uma coluna — quebraria a regra. */
const COLUNAS_ESTRUTURAIS = ["Backlog", "Concluído"];

function loadColumnsCfg(): ColumnsCfg {
  try {
    const raw = localStorage.getItem(COLUMNS_CFG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ColumnsCfg;
      if (Array.isArray(parsed.order) && parsed.order.length) {
        const order = parsed.order.filter(c => !COLUNAS_APOSENTADAS.includes(c));
        if (order.length !== parsed.order.length) {
          const limpo = { order, meta: parsed.meta || {} };
          COLUNAS_APOSENTADAS.forEach(c => delete limpo.meta[c]);
          try { localStorage.setItem(COLUMNS_CFG_KEY, JSON.stringify(limpo)); } catch { /* modo privado */ }
          return limpo;
        }
        return parsed;
      }
    }
  } catch {}
  // migrate from legacy extras
  let extra: string[] = [];
  try { extra = JSON.parse(localStorage.getItem(LEGACY_EXTRA_KEY) || "[]"); } catch {}
  const order = [...DEFAULT_COLUMNS, ...extra];
  const meta: Record<string, { color: ColorId }> = {};
  order.forEach(c => { meta[c] = { color: DEFAULT_COLOR_BY_NAME[c] || "muted" }; });
  return { order, meta };
}

function colorOf(col: string, meta: ColumnsCfg["meta"]) {
  const id: ColorId = meta[col]?.color || DEFAULT_COLOR_BY_NAME[col] || "muted";
  return COLOR_PRESETS.find(p => p.id === id) || COLOR_PRESETS[0];
}

/* Regra de idade por coluna, compartilhada pelo time (ver a migração tarefas_idade_pausada).
   A tabela é nova e o types.ts gerado ainda não a conhece — o cast fica só aqui, e o resto
   do arquivo trabalha com ColunaCfg de verdade. */
type ColunaCfg = { nome: string; pausa_idade: boolean };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabelaColunas = () => (supabase as any).from("tarefas_colunas");

const PRIO_DOT: Record<string, string> = {
  "Baixa": "bg-muted-foreground",
  "Média": "bg-yellow-500",
  "Alta": "bg-red-600",
  "Urgente": "bg-[#7f1d1d]",
};
const PRIO_TEXT: Record<string, string> = {
  "Baixa": "text-muted-foreground",
  "Média": "text-yellow-600 dark:text-yellow-400",
  "Alta": "text-red-600 dark:text-red-500",
  "Urgente": "text-[#7f1d1d] dark:text-[#b91c1c]",
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function isAtrasada(t: Tarefa) {
  if (!t.prazo || t.status === "Concluído") return false;
  return new Date(t.prazo) < new Date(new Date().toDateString());
}

// Descreve, em texto legível, o que mudou de `old` para `patch` — usado no log de histórico.
function describeChanges(old: Tarefa, patch: Partial<Tarefa>): string {
  const parts: string[] = [];
  if ("status" in patch && patch.status !== old.status)
    parts.push(`moveu de "${old.status}" para "${patch.status}"`);
  if ("prioridade" in patch && patch.prioridade !== old.prioridade)
    parts.push(`prioridade: ${old.prioridade} → ${patch.prioridade}`);
  if ("responsavel" in patch && (patch.responsavel ?? "") !== (old.responsavel ?? ""))
    parts.push(`responsável: ${old.responsavel || "—"} → ${patch.responsavel || "—"}`);
  if ("prazo" in patch && (patch.prazo ?? null) !== (old.prazo ?? null))
    parts.push(`prazo: ${fmtDate(old.prazo)} → ${fmtDate(patch.prazo ?? null)}`);
  if ("titulo" in patch && patch.titulo !== old.titulo)
    parts.push(`título: "${old.titulo}" → "${patch.titulo}"`);
  if ("observacao" in patch && (patch.observacao ?? "") !== (old.observacao ?? ""))
    parts.push("editou a observação");
  if ("cat_area" in patch && (patch.cat_area ?? "") !== (old.cat_area ?? ""))
    parts.push(`área: ${old.cat_area || "—"} → ${patch.cat_area || "—"}`);
  if ("cat_natureza" in patch && (patch.cat_natureza ?? "") !== (old.cat_natureza ?? ""))
    parts.push(`natureza: ${old.cat_natureza || "—"} → ${patch.cat_natureza || "—"}`);
  if ("rotina" in patch && !!patch.rotina !== !!old.rotina)
    parts.push(patch.rotina ? "marcou como rotina" : "deixou de ser rotina");
  if ("subtarefas" in patch) {
    const oldSubs = old.subtarefas || [];
    const newSubs = (patch.subtarefas as Subtarefa[]) || [];
    const oldDone = oldSubs.filter((s) => s.done).length;
    const newDone = newSubs.filter((s) => s.done).length;
    if (oldSubs.length !== newSubs.length) parts.push(`checklist: ${oldSubs.length} → ${newSubs.length} itens`);
    else if (oldDone !== newDone) parts.push(`checklist: ${newDone}/${newSubs.length} concluídos`);
    // mesmos itens em outra ordem: sem isso, arrastar para reordenar não deixava rastro nenhum
    else if (oldSubs.some((s, i) => s.id !== newSubs[i]?.id)) parts.push("reordenou o checklist");
  }
  return parts.join(" · ");
}
function initials(name: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}
// Hash determinístico p/ derivar progresso por id (sem alterar schema)
// Progresso: somente baseado em subtarefas. Sem subtarefas = sem barra.
function progressFor(t: Tarefa): number {
  const subs = t.subtarefas || [];
  if (subs.length === 0) return 0;
  const done = subs.filter(s => s.done).length;
  return Math.round((done / subs.length) * 100);
}
// Tags derivadas (TASK / RPA quando coluna RPA, ou primeira palavra do responsável como "cliente")
/* Construir automação é trabalho de outra natureza — vale ver de longe numa
   coluna cheia. A marca é o carimbo `cat_natureza`, e não a coluna: a coluna
   "automações" que existia era do localStorage de um navegador só, e as tarefas
   paradas nela eram invisíveis para todo mundo (ver a migration 20260824120000).

   Faixa na borda em vez de chip: o card do quadro já gasta uma linha com os
   chips TASK/RPA, e mais um rótulo estático empurraria prioridade e prazo para
   fora do campo de visão numa coluna longa. */
function ehAutomacao(t: Tarefa): boolean {
  return (t as { cat_natureza?: string | null }).cat_natureza === "Automação";
}

function tagsFor(t: Tarefa): { label: string; cls: string }[] {
  const tags: { label: string; cls: string }[] = [];
  if (t.status === "Tasks - RPA") {
    tags.push({ label: "TASK", cls: "bg-foreground text-background" });
    tags.push({ label: "RPA", cls: "bg-destructive/15 text-destructive" });
  }
  return tags;
}

/* A área vai como um ponto colorido + texto miúdo no rodapé do card, e não como
   mais um chip lá em cima: os chips já ocupam uma linha inteira, e a área não é
   urgente de ler — ela existe para dar o mesmo nome à coisa no card e no gráfico
   da aba Análise. "Outros" não aparece: nomear o que não foi classificado só
   gasta pixel. */
function areaVisivel(t: Tarefa): string | null {
  const a = t.cat_area;
  return a && a !== AREA_NAO_CLASSIFICADA ? a : null;
}

// Extrai "evento" da observação ("Evento: XXX") ou do título "Recarga de viagem - {evento}"
function eventoFor(t: Tarefa): string {
  const obs = (t as any).observacao as string | null | undefined;
  if (obs) {
    const m = /^\s*Evento:\s*(.+?)\s*$/im.exec(obs);
    if (m) {
      const ev = m[1].trim();
      if (ev && ev !== "—" && ev !== "-") return ev;
    }
  }
  const mt = /^\s*Recarga de viagem\s*[-–]\s*(.+?)\s*$/i.exec(t.titulo || "");
  if (mt) return mt[1].trim();
  return "";
}
function groupByEvento(items: Tarefa[]): { evento: string; items: Tarefa[] }[] {
  const map = new Map<string, Tarefa[]>();
  for (const t of items) {
    const ev = eventoFor(t);
    if (!map.has(ev)) map.set(ev, []);
    map.get(ev)!.push(t);
  }
  // sem-evento primeiro (sem header), depois eventos em ordem alfabética
  const groups: { evento: string; items: Tarefa[] }[] = [];
  if (map.has("")) groups.push({ evento: "", items: map.get("")! });
  [...map.keys()]
    .filter(k => k !== "")
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .forEach(k => groups.push({ evento: k, items: map.get(k)! }));
  return groups;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 80, h = 28;
  const step = w / (data.length - 1);
  const path = data
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} fill="none" stroke={`hsl(var(--${color}))`} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Tarefas() {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Tarefa[]>([]);
  const [filtrosIniciais] = useState(loadFiltros); // lê o localStorage uma vez, na montagem
  const [view, setView] = useState<"kanban" | "tabela" | "rotinas" | "analise" | "historico">(filtrosIniciais.view);

  // Registra uma ação num card no histórico (tarefas_log). Best-effort: nunca quebra a
  // ação principal — se a tabela ainda não existir, o erro é ignorado silenciosamente.
  const logTarefa = async (e: { tarefa_id: string | null; tarefa_titulo: string; acao: string; descricao: string }) => {
    if (!e.descricao) return;
    await supabase.from("tarefas_log" as any).insert({
      tarefa_id: e.tarefa_id,
      tarefa_titulo: e.tarefa_titulo,
      acao: e.acao,
      descricao: e.descricao,
      usuario: profile?.nome ?? null,
      usuario_id: user?.id ?? null,
    });
  };
  const [search, setSearch] = useState("");
  const [concluidoCollapsed, setConcluidoCollapsed] = useState(true);
  const [editing, setEditing] = useState<Tarefa | null>(null);
  const [creating, setCreating] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [creatingStatus, setCreatingStatus] = useState<string>("Backlog");
  const [colsCfg, setColsCfg] = useState<ColumnsCfg>(() => loadColumnsCfg());
  const COLUMNS = colsCfg.order;

  /* /tarefas?tarefa=<id> abre a tarefa direto.
     É como a Linha de Produção volta para cá ("já está no quadro — ver a
     tarefa"): cair no quadro com 26 cards no Backlog e ter que caçar o certo
     não é ver a tarefa. O parâmetro se apaga depois de usado, senão um F5
     reabriria o diálogo que a pessoa acabou de fechar. */
  const [searchParams, setSearchParams] = useSearchParams();
  const alvoUrl = searchParams.get("tarefa");
  useEffect(() => {
    if (!alvoUrl || !rows.length) return;
    const achada = rows.find(r => r.id === alvoUrl);
    if (achada) setEditing(achada);
    else toast.error("Essa tarefa não está no quadro — pode ter sido concluída ou arquivada.");
    searchParams.delete("tarefa");
    setSearchParams(searchParams, { replace: true });
  }, [alvoUrl, rows, searchParams, setSearchParams]);

  /* Colunas que pausam o relógio da idade.
     Ordem e cor são gosto de cada um e ficam no localStorage; isto aqui é regra do time e
     mora no banco (`tarefas_colunas`) — todo mundo tem que ver o mesmo número, e o gatilho
     que fecha a conta da pausa a cada movimentação precisa ler daí. */
  const [pausaCols, setPausaCols] = useState<Set<string>>(new Set());
  const pausaIdade = (col: string) => pausaCols.has(col);

  const loadPausaCols = async () => {
    const { data } = await tabelaColunas().select("nome, pausa_idade");
    if (!data) return;
    const linhas = data as ColunaCfg[];
    setPausaCols(new Set(linhas.filter(l => l.pausa_idade).map(l => l.nome)));
  };

  const gravaPausa = (col: string, pausa_idade: boolean) =>
    tabelaColunas().upsert(
      { nome: col, pausa_idade, atualizado_em: new Date().toISOString() },
      { onConflict: "nome" },
    );

  const togglePausaIdade = async (col: string) => {
    const proximo = !pausaCols.has(col);
    setPausaCols(s => {
      const n = new Set(s);
      if (proximo) n.add(col); else n.delete(col);
      return n;
    });
    const { error } = await gravaPausa(col, proximo);
    if (error) { toast.error(error.message); loadPausaCols(); return; }
    /* Só o trecho aberto muda de lado na hora: o que já foi bancado em `pausado_ms` continua
       como estava. Ligar a chave hoje não reescreve o histórico de quem passou pela coluna. */
    toast.success(proximo
      ? `"${col}" não conta mais idade`
      : `"${col}" voltou a contar idade`);
  };

  const persistCfg = (next: ColumnsCfg) => {
    setColsCfg(next);
    localStorage.setItem(COLUMNS_CFG_KEY, JSON.stringify(next));
  };
  const addColumn = () => {
    const name = window.prompt("Nome da nova coluna:");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (COLUMNS.includes(trimmed)) { toast.error("Já existe uma coluna com esse nome"); return; }
    persistCfg({
      order: [...colsCfg.order, trimmed],
      meta: { ...colsCfg.meta, [trimmed]: { color: "muted" } },
    });
  };
  const removeColumn = async (col: string) => {
    if (COLUNAS_ESTRUTURAIS.includes(col)) {
      toast.error(`"${col}" não pode ser excluída — o sistema grava nela.`);
      return;
    }

    /* As tarefas que estavam ali vão para o Backlog ANTES de a coluna sumir.
       Deixá-las com o status antigo seria pior do que apagá-las: continuam no
       banco e nos relatórios, mas o quadro só desenha as colunas configuradas —
       somem da tela sem erro nenhum. Foi exatamente o que aconteceu com a coluna
       "automações" (ver a migration 20260824120000).

       Sem filtrar por `arquivada_em`, de propósito: tarefa arquivada não aparece
       no quadro hoje, mas pode ser restaurada — e voltaria para uma coluna que
       não existe mais, órfã do mesmo jeito. Por isso o número aqui vem do que o
       banco REALMENTE mudou, e não de `rows`, que já exclui as arquivadas e
       contaria menos do que aconteceu. */
    const { data: movidas, error } = await supabase
      .from("tarefas").update({ status: "Backlog" }).eq("status", col).select("id, titulo");
    if (error) { toast.error(error.message); return; }

    const n = movidas?.length ?? 0;
    if (n) {
      setRows(rs => rs.map(r => r.status === col ? { ...r, status: "Backlog" } : r));
      // Uma linha por tarefa no histórico: amanhã ninguém lembra por que o card mudou de lugar.
      await Promise.all((movidas ?? []).map(t => logTarefa({
        tarefa_id: t.id, tarefa_titulo: t.titulo, acao: "movida",
        descricao: `Movida para "Backlog": a coluna "${col}" foi excluída`,
      })));
    }

    const meta = { ...colsCfg.meta };
    delete meta[col];
    persistCfg({ order: colsCfg.order.filter(c => c !== col), meta });
    await tabelaColunas().delete().eq("nome", col);
    setPausaCols(s => { const n2 = new Set(s); n2.delete(col); return n2; });

    toast.success(
      n ? `Coluna "${col}" excluída — ${n} tarefa${n > 1 ? "s foram" : " foi"} para o Backlog.`
        : `Coluna "${col}" excluída.`,
    );
  };
  const renameColumn = async (col: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === col) return;
    if (COLUMNS.includes(trimmed)) { toast.error("Já existe uma coluna com esse nome"); return; }
    // Atualiza tarefas que usam esta coluna como status
    const affected = rows.filter(r => r.status === col);
    if (affected.length) {
      const { error } = await supabase.from("tarefas").update({ status: trimmed }).eq("status", col);
      if (error) { toast.error(error.message); return; }
      setRows(rs => rs.map(r => r.status === col ? { ...r, status: trimmed } : r));
    }
    const order = colsCfg.order.map(c => c === col ? trimmed : c);
    const meta = { ...colsCfg.meta };
    meta[trimmed] = meta[col] || { color: "muted" };
    delete meta[col];
    persistCfg({ order, meta });
    // A regra da idade segue o nome, senão a coluna renomeada volta a contar sem ninguém pedir.
    if (pausaCols.has(col)) {
      await tabelaColunas().delete().eq("nome", col);
      await gravaPausa(trimmed, true);
      setPausaCols(s => { const n = new Set(s); n.delete(col); n.add(trimmed); return n; });
    }
    toast.success("Coluna renomeada");
  };
  const recolorColumn = (col: string, color: ColorId) => {
    persistCfg({
      order: colsCfg.order,
      meta: { ...colsCfg.meta, [col]: { color } },
    });
  };
  const moveColumn = (from: string, to: string) => {
    if (from === to) return;
    const order = [...colsCfg.order];
    const i = order.indexOf(from);
    const j = order.indexOf(to);
    if (i === -1 || j === -1) return;
    order.splice(i, 1);
    order.splice(j, 0, from);
    persistCfg({ order, meta: colsCfg.meta });
  };

  // Filtros chips topo
  const [chipPrio, setChipPrio] = useState<string>(filtrosIniciais.prio);
  const [chipArea, setChipArea] = useState<string>(filtrosIniciais.area);
  const [chipResp, setChipResp] = useState<string>(filtrosIniciais.resp);
  const [chipAtrasadas, setChipAtrasadas] = useState(filtrosIniciais.atrasadas);
  const [chipPeriodo, setChipPeriodo] = useState<string>(filtrosIniciais.periodo); // "", "mes", "3m", "ano"

  // Filtros tabela (header)
  const [fStatus, setFStatus] = useState<string[]>(filtrosIniciais.fStatus);
  const [fPrioridade, setFPrioridade] = useState<string[]>(filtrosIniciais.fPrioridade);
  const [fResponsavel, setFResponsavel] = useState<string[]>(filtrosIniciais.fResponsavel);

  /* Grava a cada mudança, e não ao sair: a saída daqui costuma ser um clique na
     sidebar, que desmonta a página sem passar por lugar nenhum onde dê para
     salvar com garantia. */
  useEffect(() => {
    try {
      localStorage.setItem(FILTROS_KEY, JSON.stringify({
        view, periodo: chipPeriodo, prio: chipPrio, area: chipArea, resp: chipResp,
        atrasadas: chipAtrasadas, fStatus, fPrioridade, fResponsavel,
      } satisfies FiltrosSalvos));
    } catch { /* modo privado */ }
  }, [view, chipPeriodo, chipPrio, chipArea, chipResp, chipAtrasadas, fStatus, fPrioridade, fResponsavel]);

  const load = async () => {
    // Arquivada continua no banco (o histórico aponta para ela), mas fora do Kanban.
    // Mesmo filtro da aba do celular — as duas telas mostram a mesma lista.
    const { data, error } = await supabase
      .from("tarefas").select("*").is("arquivada_em", null).order("ordem");
    if (error) toast.error(error.message);
    else {
      const mapped: Tarefa[] = ((data as any[]) || []).map(r => ({
        ...r,
        subtarefas: Array.isArray(r.subtarefas) ? (r.subtarefas as Subtarefa[]) : [],
      }));
      setRows(mapped);
    }
  };
  useEffect(() => { load(); loadPausaCols(); }, []);

  const normalizeResp = (v: string | null | undefined) => {
    const s = (v || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (s.startsWith("henr")) return "Henrique";
    if (s.startsWith("juli")) return "Júlia";
    return v?.trim() || "—";
  };

  const responsaveis = useMemo(() => RESPONSAVEIS, []);

  const periodoMatch = (r: Tarefa) => {
    if (!chipPeriodo) return true;
    const ref = r.prazo ? new Date(r.prazo) : new Date(r.created_at);
    const now = new Date();
    if (chipPeriodo === "mes") {
      return ref.getMonth() === now.getMonth() && ref.getFullYear() === now.getFullYear();
    }
    if (chipPeriodo === "3m") {
      const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 3);
      return ref >= cutoff;
    }
    if (chipPeriodo === "ano") {
      return ref.getFullYear() === now.getFullYear();
    }
    return true;
  };

  const filteredBase = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      /* A classificação entra no que a busca varre porque ela está ESCRITA no
         card: procurar por "Tesouraria" e não achar a linha que exibe a palavra
         "Tesouraria" é a busca contradizendo a tela. */
      if (q
        && !r.titulo.toLowerCase().includes(q)
        && !(r.responsavel || "").toLowerCase().includes(q)
        && !rotuloClassificacao(r).toLowerCase().includes(q)) return false;
      if (chipPrio && r.prioridade !== chipPrio) return false;
      if (chipArea && (r.cat_area || AREA_NAO_CLASSIFICADA) !== chipArea) return false;
      if (chipResp && normalizeResp(r.responsavel) !== chipResp) return false;
      if (chipAtrasadas && !isAtrasada(r)) return false;
      if (!periodoMatch(r)) return false;
      return true;
    /* Ordena aqui, e não em `grouped`, porque a Tabela também sai desta lista:
       ordenado só no Kanban, o mesmo card apareceria em posições diferentes nas
       duas abas da mesma página. `filter` já devolveu um array novo, então o
       `sort` não mexe em `rows`. */
    }).sort(comparaPrioridade);
  }, [rows, search, chipPrio, chipArea, chipResp, chipAtrasadas, chipPeriodo]);

  const filteredTable = useMemo(() => filteredBase.filter(r => {
    if (fStatus.length && !fStatus.includes(r.status)) return false;
    if (fPrioridade.length && !fPrioridade.includes(r.prioridade)) return false;
    if (fResponsavel.length && !fResponsavel.includes(normalizeResp(r.responsavel))) return false;
    return true;
  }), [filteredBase, fStatus, fPrioridade, fResponsavel]);

  // Counts respect prioridade/responsável/busca, mas ignoram o chip "atrasadas"
  // (para que o próprio chip mostre o total filtrado de atrasadas)
  const baseForCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      /* A classificação entra no que a busca varre porque ela está ESCRITA no
         card: procurar por "Tesouraria" e não achar a linha que exibe a palavra
         "Tesouraria" é a busca contradizendo a tela. */
      if (q
        && !r.titulo.toLowerCase().includes(q)
        && !(r.responsavel || "").toLowerCase().includes(q)
        && !rotuloClassificacao(r).toLowerCase().includes(q)) return false;
      if (chipPrio && r.prioridade !== chipPrio) return false;
      if (chipArea && (r.cat_area || AREA_NAO_CLASSIFICADA) !== chipArea) return false;
      if (chipResp && normalizeResp(r.responsavel) !== chipResp) return false;
      if (!periodoMatch(r)) return false;
      return true;
    });
  }, [rows, search, chipPrio, chipArea, chipResp, chipPeriodo]);

  /* Quantas ainda esperam classificação — a fila que o botão "sem área" abre. */
  const semArea = useMemo(
    () => rows.filter(r => (r.cat_origem ?? "auto") !== "manual"
      && (!r.cat_area || r.cat_area === AREA_NAO_CLASSIFICADA)).length,
    [rows],
  );

  const total = baseForCounts.length;
  const emAnd = baseForCounts.filter(r => ["Em andamento", "Acompanhamento", "Revisão", "Tasks - RPA"].includes(r.status)).length;
  const concl = baseForCounts.filter(r => r.status === "Concluído").length;
  // Conta apenas tarefas atrasadas cujo status está visível nas colunas (evita contar registros de status legados/órfãos que não aparecem na UI)
  const atras = baseForCounts.filter(r => isAtrasada(r) && COLUMNS.includes(r.status)).length;
  const pctEm = total ? Math.round((emAnd / total) * 100) : 0;
  const META_CONCLUIDAS = 22;

  const grouped = useMemo(() => {
    const g: Record<string, Tarefa[]> = {};
    COLUMNS.forEach(c => g[c] = []);
    filteredBase.forEach(r => { (g[r.status] ||= []).push(r); });
    return g;
  }, [filteredBase]);

  /* Devolve se gravou. Quem abriu um diálogo precisa saber: fechar depois de uma
     falha esconderia o erro e faria a edição sumir. */
  const update = async (id: string, patch: Partial<Tarefa>, skipLog = false): Promise<boolean> => {
    const old = rows.find(r => r.id === id);
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
    /* Quem fecha a conta da pausa é o gatilho no banco, então a resposta do update traz de
       volta o que ele decidiu — sem isso a Idade ficaria com o valor velho até dar F5. */
    const { data: gravada, error } = await supabase
      .from("tarefas").update(patch as any).eq("id", id)
      .select("status_desde, pausado_ms")
      .maybeSingle<Pick<Tarefa, "status_desde" | "pausado_ms">>();
    if (error) {
      toast.error(error.message);
      load();   // desfaz o otimismo: a tela volta para o que o banco realmente tem
      return false;
    }
    if (gravada) {
      setRows(rs => rs.map(r => r.id === id ? { ...r, ...gravada } : r));
    }
    if (old && !skipLog) {
      const descricao = describeChanges(old, patch);
      const soMoveu = Object.keys(patch).length === 1 && "status" in patch;
      logTarefa({
        tarefa_id: id,
        tarefa_titulo: (patch.titulo ?? old.titulo) as string,
        acao: soMoveu ? "movida" : "editada",
        descricao,
      });
    }
    return true;
  };

  /**
   * Arquiva em vez de apagar.
   *
   * Antes era `delete`: a linha sumia do banco e o registro em `tarefas_log` ficava
   * apontando para um id que não existia mais. Agora a tarefa só sai das listas — das duas
   * telas, porque o celular filtra igual — e dá para desfazer pelo aviso.
   */
  const remove = async (id: string) => {
    const alvo = rows.find(r => r.id === id);
    const { error } = await supabase
      .from("tarefas").update({ arquivada_em: new Date().toISOString() } as any).eq("id", id);
    if (error) { toast.error(error.message); return; }
    if (alvo) logTarefa({ tarefa_id: id, tarefa_titulo: alvo.titulo, acao: "arquivada", descricao: `Arquivada (estava em "${alvo.status}")` });
    load();
    toast.success("Tarefa arquivada", {
      action: {
        label: "Desfazer",
        onClick: async () => {
          const { error: err } = await supabase
            .from("tarefas").update({ arquivada_em: null } as any).eq("id", id);
          if (err) { toast.error(err.message); return; }
          if (alvo) logTarefa({ tarefa_id: id, tarefa_titulo: alvo.titulo, acao: "editada", descricao: "Arquivamento desfeito" });
          load();
          toast.success("Tarefa restaurada");
        },
      },
    });
  };

  const create = async (t: Partial<Tarefa>) => {
    if (!t.titulo?.trim()) { toast.error("Título é obrigatório"); return; }
    if (!t.responsavel) { toast.error("Responsável é obrigatório"); return; }
    /* Rotina não precisa de prazo digitado: a cadência já disse quando ela cai,
       e a próxima data é a resposta. A regra vale aqui, e não só no diálogo,
       porque este é o ponto por onde TODA tarefa nova passa. */
    const cadNova = lerCadencia(t.rotina_cadencia);
    const prazoNovo = t.prazo || (cadNova ? (proximaData(cadNova) ? iso(proximaData(cadNova)!) : null) : null);
    if (!prazoNovo) { toast.error("Prazo é obrigatório"); return; }
    const ordem = rows.length ? Math.max(...rows.map(r => r.ordem)) + 1 : 1;
    const status = t.status || creatingStatus;
    const { data: inserida, error } = await supabase.from("tarefas").insert({
      ordem, titulo: t.titulo, responsavel: t.responsavel,
      status, prioridade: t.prioridade || "Média",
      prazo: prazoNovo, observacao: t.observacao || null,
      subtarefas: (t.subtarefas || []) as any,
      /* A agenda da rotina não passa pelo gatilho de classificação: quem escreve
         `rotina_cadencia` é sempre a pessoa. O gatilho `fn_tarefa_rotina_serie`
         se encarrega de abrir a série (uuid) e de marcar `rotina = true`. */
      rotina_cadencia: (t.rotina_cadencia ?? null) as unknown as Json,
      rotina_ativa: t.rotina_ativa ?? true,
      rotina_antecedencia_dias: t.rotina_antecedencia_dias ?? 0,
      rotina_subtarefas_fonte: t.rotina_subtarefas_fonte ?? null,
      /* Só vai o que a pessoa escolheu no diálogo. Omitir os campos é o que deixa
         o gatilho `fn_tarefa_autoclassifica` carimbar pelo título — mandar
         `cat_area: null` explicitamente daria no mesmo, mas mandar "" não: o
         gatilho só preenche o que está NULO. */
      ...(t.cat_origem === "manual"
        ? {
            cat_natureza: t.cat_natureza || null,
            cat_area: t.cat_area || null,
            rotina: !!t.rotina,
            cat_origem: "manual",
          }
        : {}),
    }).select("id").single();
    if (error) toast.error(error.message);
    else {
      logTarefa({ tarefa_id: (inserida as any)?.id ?? null, tarefa_titulo: t.titulo, acao: "criada", descricao: `Criada em "${status}"` });
      toast.success("Tarefa criada"); load(); setCreating(false);
    }
  };

  const openCreate = (status?: string) => {
    setCreatingStatus(status || "Backlog");
    setCreating(true);
  };

  // ---------- Header com KPIs + chips ----------
  return (
    <div className="space-y-4 p-5">
      <div className="sticky top-0 z-30 -mx-5 -mt-5 px-5 pt-5 pb-4 bg-background border-b shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Tarefas</h2>
          <p className="text-xs text-muted-foreground">Acompanhamento de demandas do time financeiro</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => openCreate()} className="h-8 gap-1.5 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" /> Nova Tarefa
          </Button>
          {view === "kanban" && (
            <Button
              variant="outline"
              onClick={addColumn}
              className="h-8 gap-1.5 px-3 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Nova Coluna
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      {(view === "kanban" || view === "tabela") && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPI label="Total" value={total} hint={`${total} no escopo atual`} tone="foreground" icon={ListChecks} />
          <KPI label="Em andamento" value={emAnd} hint={`${pctEm}% do total`} tone="warning" icon={Clock} progress={pctEm} />
          <KPI label="Concluídas" value={concl} hint={`meta ${META_CONCLUIDAS}`} tone="success" icon={CheckCircle2} progress={META_CONCLUIDAS ? Math.min(100, Math.round((concl / META_CONCLUIDAS) * 100)) : 0} />
          <KPI label="Atrasadas" value={atras} hint={atras ? "requerem ação" : "tudo em dia"} tone="destructive" icon={AlertTriangle} progress={total ? Math.round((atras / total) * 100) : 0} />
        </div>
      )}

      {/* Toolbar de chips */}
      <div className="flex flex-wrap items-center gap-2">
        {(view === "kanban" || view === "tabela") && (
          <>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por título, tag ou responsável..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-72 pl-7 text-xs"
              />
            </div>
            <Select value={chipPeriodo || "all"} onValueChange={(v) => setChipPeriodo(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 w-[170px] text-xs">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo o período</SelectItem>
                <SelectItem value="mes">Mês corrente</SelectItem>
                <SelectItem value="3m">Últimos 3 meses</SelectItem>
                <SelectItem value="ano">Ano corrente</SelectItem>
              </SelectContent>
            </Select>
            <ChipSelect
              label="Todas prioridades"
              value={chipPrio}
              options={PRIO_OPTS}
              onChange={setChipPrio}
            />
            <ChipSelect
              label="Todas as áreas"
              value={chipArea}
              options={AREAS as unknown as string[]}
              onChange={setChipArea}
            />
            <ChipSelect
              label="Todos responsáveis"
              value={chipResp}
              options={responsaveis}
              onChange={setChipResp}
            />
            <button
              onClick={() => setChipAtrasadas(v => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                chipAtrasadas
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              Atrasadas ({atras})
            </button>
            {/* Só aparece quando há o que revisar. Um botão permanente dizendo
                "0 sem área" seria ruído fixo; assim, o botão sumir É o sinal de
                que o quadro está classificado. Conta sobre `rows` (o quadro
                inteiro), e não sobre o filtrado: a fila de revisão não muda
                porque alguém filtrou por responsável. */}
            {semArea > 0 && (
              <button
                onClick={() => setRevisando(true)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                title="Classificar as tarefas que o carimbo automático não conseguiu ler pelo título"
              >
                <Tags className="h-3 w-3" />
                {semArea} sem área
              </button>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-0.5 rounded-md border-2 border-destructive bg-destructive p-0.5 shadow-sm">
          <button
            onClick={() => setView("kanban")}
            className={cn("flex items-center gap-1.5 rounded px-3 py-1 text-xs font-bold transition-colors",
              view === "kanban" ? "bg-white text-destructive" : "text-white hover:bg-white/10")}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Kanban
          </button>
          <button
            onClick={() => setView("tabela")}
            className={cn("flex items-center gap-1.5 rounded px-3 py-1 text-xs font-bold transition-colors",
              view === "tabela" ? "bg-white text-destructive" : "text-white hover:bg-white/10")}
          >
            <TableIcon className="h-3.5 w-3.5" /> Tabela
          </button>
          <button
            onClick={() => setView("rotinas")}
            className={cn("flex items-center gap-1.5 rounded px-3 py-1 text-xs font-bold transition-colors",
              view === "rotinas" ? "bg-white text-destructive" : "text-white hover:bg-white/10")}
          >
            <CalendarClock className="h-3.5 w-3.5" /> Rotinas
          </button>
          <button
            onClick={() => setView("analise")}
            className={cn("flex items-center gap-1.5 rounded px-3 py-1 text-xs font-bold transition-colors",
              view === "analise" ? "bg-white text-destructive" : "text-white hover:bg-white/10")}
          >
            <BarChart3 className="h-3.5 w-3.5" /> Análise
          </button>
          <button
            onClick={() => setView("historico")}
            className={cn("flex items-center gap-1.5 rounded px-3 py-1 text-xs font-bold transition-colors",
              view === "historico" ? "bg-white text-destructive" : "text-white hover:bg-white/10")}
          >
            <History className="h-3.5 w-3.5" /> Histórico
          </button>
        </div>
      </div>
      </div>

      {view === "kanban" ? (
        <KanbanView
          columns={COLUMNS}
          colsMeta={colsCfg.meta}
          grouped={grouped}
          collapsed={concluidoCollapsed}
          onToggleConcluido={() => setConcluidoCollapsed(v => !v)}
          onOpen={setEditing}
          onAdd={openCreate}
          onMove={(id, status) => update(id, { status })}
          onRemove={remove}
          onAddColumn={addColumn}
          onRemoveColumn={removeColumn}
          onRenameColumn={renameColumn}
          onRecolorColumn={recolorColumn}
          onMoveColumn={moveColumn}
          podeExcluirColuna={(c) => !COLUNAS_ESTRUTURAIS.includes(c)}
          pausaIdade={pausaIdade}
          onTogglePausaIdade={togglePausaIdade}
        />
      ) : view === "tabela" ? (
        <TableView
          columns={COLUMNS}
          colsMeta={colsCfg.meta}
          rows={filteredTable}
          fStatus={fStatus} setFStatus={setFStatus}
          fPrioridade={fPrioridade} setFPrioridade={setFPrioridade}
          fResponsavel={fResponsavel} setFResponsavel={setFResponsavel}
          responsaveis={responsaveis}
          onOpen={setEditing}
          onRemove={remove}
          pausaIdade={pausaIdade}
        />
      ) : view === "rotinas" ? (
        /* Abre a ocorrência aberta (ou a última) no MESMO diálogo do quadro: a
           rotina se edita editando a tarefa, então não há uma segunda tela de
           cadastro para divergir da primeira. */
        <RotinasPanel onAbrirTarefa={(id) => {
          const t = rows.find(r => r.id === id);
          if (t) setEditing(t);
          else toast.info("A ocorrência dessa rotina não está no quadro (concluída ou arquivada).");
        }} />
      ) : view === "analise" ? (
        <AnaliseSemanal />
      ) : (
        <HistoricoTarefas />
      )}

      <RevisaoClassificacao
        open={revisando}
        tarefas={rows}
        onClose={() => setRevisando(false)}
        onAplicado={load}
      />

      <TaskDialog
        columns={COLUMNS}
        open={creating}
        defaultStatus={creatingStatus}
        onClose={() => setCreating(false)}
        onSave={create}
        title="Nova Tarefa"
      />
      <TaskDialog
        columns={COLUMNS}
        open={!!editing}
        tarefa={editing || undefined}
        onClose={() => setEditing(null)}
        /* Salvar gravava e parava por aí: o diálogo continuava aberto e não vinha
           confirmação nenhuma, então a edição parecia não ter pegado (e o pessoal
           clicava de novo). O toast fica aqui, e não dentro de `update`, porque
           `update` também é chamado ao arrastar card no kanban — ali avisar a cada
           arraste seria barulho. */
        onSave={async (patch) => {
          if (!editing) return;
          if (await update(editing.id, patch)) {
            toast.success("Tarefa salva");
            setEditing(null);
          }
        }}
        title="Editar Tarefa"
      />
    </div>
  );
}

/* --------------------------- KPI --------------------------- */
function KPI({ label, value, hint, tone, icon: Icon, progress }: {
  label: string; value: number; hint: string;
  tone: "foreground" | "warning" | "success" | "destructive";
  icon: React.ComponentType<{ className?: string }>;
  progress?: number;
}) {
  const toneCls: Record<string, { bg: string; fg: string; bar: string }> = {
    foreground:  { bg: "bg-muted",            fg: "text-foreground",       bar: "bg-foreground/60" },
    warning:     { bg: "bg-warning/15",       fg: "text-warning",          bar: "bg-warning" },
    success:     { bg: "bg-success/15",       fg: "text-success",          bar: "bg-success" },
    destructive: { bg: "bg-destructive/15",   fg: "text-destructive",      bar: "bg-destructive" },
  };
  const t = toneCls[tone];
  return (
    <Card className="flex items-center gap-3 border-border p-3">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", t.bg, t.fg)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="num mt-0.5 text-2xl font-bold leading-none">{value}</div>
        {hint && (
          <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>
        )}
        {typeof progress === "number" && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full transition-all", t.bar)} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
        )}
      </div>
    </Card>
  );
}

/* --------------------------- Chip Select --------------------------- */
function ChipSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <Select value={value || "__all__"} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
      <SelectTrigger className="h-8 w-auto gap-1 border-border bg-card px-2.5 text-xs text-muted-foreground">
        <SelectValue placeholder={label}>{value || label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{label}</SelectItem>
        {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/* --------------------------- KANBAN --------------------------- */
function KanbanView({
  columns, colsMeta, grouped, collapsed, onToggleConcluido, onOpen, onAdd, onMove, onRemove,
  onAddColumn, onRemoveColumn, onRenameColumn, onRecolorColumn, onMoveColumn, podeExcluirColuna,
  pausaIdade, onTogglePausaIdade,
}: {
  columns: string[];
  colsMeta: ColumnsCfg["meta"];
  grouped: Record<string, Tarefa[]>;
  collapsed: boolean;
  onToggleConcluido: () => void;
  onOpen: (t: Tarefa) => void;
  onAdd: (status: string) => void;
  onMove: (id: string, status: string) => void;
  onRemove: (id: string) => void;
  onAddColumn: () => void;
  onRemoveColumn: (col: string) => void;
  onRenameColumn: (col: string, newName: string) => void;
  onRecolorColumn: (col: string, color: ColorId) => void;
  onMoveColumn: (from: string, to: string) => void;
  podeExcluirColuna: (col: string) => boolean;
  pausaIdade: (col: string) => boolean;
  onTogglePausaIdade: (col: string) => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [colDragOver, setColDragOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setRenameValue(renaming);
      setTimeout(() => renameInputRef.current?.select(), 10);
    }
  }, [renaming]);

  const COL_DRAG_TYPE = "application/x-tarefas-col";

  const handleDrop = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    setDragOver(null);
    setColDragOver(null);
    const fromCol = e.dataTransfer.getData(COL_DRAG_TYPE);
    if (fromCol) {
      if (fromCol !== col) onMoveColumn(fromCol, col);
      return;
    }
    const id = e.dataTransfer.getData("text/plain");
    if (id) onMove(id, col);
  };

  const handleDragOver = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes(COL_DRAG_TYPE)) {
      setColDragOver(col);
    } else {
      setDragOver(col);
    }
  };

  const submitRename = () => {
    if (renaming && renameValue.trim() && renameValue.trim() !== renaming) {
      onRenameColumn(renaming, renameValue.trim());
    }
    setRenaming(null);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map(col => {
        const items = grouped[col] || [];
        const overdue = items.filter(isAtrasada).length;
        const isConcluido = col === "Concluído";
        const color = colorOf(col, colsMeta);

        if (isConcluido && collapsed) {
          return (
            <button
              key={col}
              onClick={onToggleConcluido}
              onDragOver={(e) => handleDragOver(e, col)}
              onDragLeave={() => { setDragOver(null); setColDragOver(null); }}
              onDrop={(e) => handleDrop(e, col)}
              className={cn(
                "flex w-12 shrink-0 flex-col items-center justify-between rounded-lg border border-border bg-card py-3 hover:border-success",
                dragOver === col && "border-success ring-2 ring-success/30",
                colDragOver === col && "border-primary ring-2 ring-primary/30",
              )}
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <div
                className="flex flex-1 items-center justify-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
              >
                Concluído
              </div>
              <span className="num rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                {items.length}
              </span>
            </button>
          );
        }

        return (
          <div
            key={col}
            onDragOver={(e) => handleDragOver(e, col)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOver(null);
                setColDragOver(null);
              }
            }}
            onDrop={(e) => handleDrop(e, col)}
            className={cn(
              "flex max-h-[calc(100vh-320px)] min-h-[220px] w-[280px] shrink-0 flex-col rounded-lg border border-border bg-card transition-colors",
              dragOver === col && "border-primary ring-2 ring-primary/30 bg-primary/5",
              colDragOver === col && "border-primary ring-2 ring-primary/40 bg-primary/5",
            )}
          >
            <div
              className="flex items-center justify-between gap-2 border-b border-border px-2 py-2"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(COL_DRAG_TYPE, col);
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground" />
                <span className={cn("h-2 w-2 shrink-0 rounded-full", color.dot)} />
                {renaming === col ? (
                  <input
                    ref={renameInputRef}
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={submitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                    draggable={false}
                    className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1 text-[11px] font-bold uppercase tracking-wider outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <span
                    className="truncate text-[10px] font-bold uppercase tracking-wider cursor-text"
                    onDoubleClick={() => setRenaming(col)}
                    title="Duplo clique para renomear"
                  >
                    {col}
                  </span>
                )}
                <span className="num rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{items.length}</span>
                {pausaIdade(col) && (
                  <span
                    className="shrink-0 text-muted-foreground"
                    title="Card parado aqui não envelhece: a idade só volta a contar quando ele sair"
                  >
                    <Pause className="h-2.5 w-2.5" />
                  </span>
                )}
                {overdue > 0 && (
                  <span className="num flex items-center gap-0.5 text-[10px] font-semibold text-destructive">
                    <AlertTriangle className="h-2.5 w-2.5" />{overdue}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                {isConcluido && (
                  <button onClick={onToggleConcluido} className="rounded p-1 text-muted-foreground hover:bg-secondary">
                    <ChevronDown className="h-3 w-3" />
                  </button>
                )}
                <ColumnMenu
                  col={col}
                  currentColor={colorOf(col, colsMeta).id}
                  podeExcluir={podeExcluirColuna(col)}
                  pausaIdade={pausaIdade(col)}
                  onTogglePausaIdade={() => onTogglePausaIdade(col)}
                  onRename={() => setRenaming(col)}
                  onRecolor={(c) => onRecolorColumn(col, c)}
                  onAddTask={() => onAdd(col)}
                  onRemove={() => {
                    // O aviso diz o destino das tarefas: "excluir" numa coluna cheia
                    // parece que apaga o que está dentro, e não é isso que acontece.
                    // Sem número: `items` só tem as visíveis, e as arquivadas desta
                    // coluna também vão junto — prometer "3" e mexer em 10 seria mentir.
                    const aviso = items.length
                      ? `Excluir a coluna "${col}"?\n\nAs tarefas dela vão para o Backlog — nada é apagado.`
                      : `Excluir a coluna "${col}"?`;
                    if (confirm(aviso)) onRemoveColumn(col);
                  }}
                />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
              <div className="scroll-thin -mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {groupByEvento(items).map(g => (
                  <div key={g.evento || "__none__"} className="space-y-1.5">
                    {g.evento && (
                      <div className="flex items-center gap-1.5 px-0.5 pt-1">
                        <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                        <span className="truncate text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                          {g.evento}
                        </span>
                        <span className="num rounded bg-secondary px-1 py-px text-[9px] text-muted-foreground">
                          {g.items.length}
                        </span>
                        <div className="h-px flex-1 bg-border/60" />
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      {g.items.map(t => (
                        <KanbanCard
                          key={t.id}
                          t={t}
                          bar={colorOf(t.status, colsMeta).bar}
                          onClick={() => onOpen(t)}
                          onRemove={() => onRemove(t.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => onAdd(col)}
                className="flex items-center justify-center gap-1 rounded border border-dashed border-border py-1.5 text-[10px] font-medium text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-3 w-3" /> Adicionar tarefa
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ t, bar, onClick, onRemove }: { t: Tarefa; bar: string; onClick: () => void; onRemove: () => void }) {
  const tags = tagsFor(t);
  const progress = progressFor(t);
  const overdue = isAtrasada(t);
  const subsTotal = t.subtarefas?.length || 0;
  const subsDone = t.subtarefas?.filter(s => s.done).length || 0;
  const showProgress = subsTotal > 0;
  const auto = ehAutomacao(t);
  const area = areaVisivel(t);
  const cadenciaDoCard = lerCadencia(t.rotina_cadencia);

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "group relative cursor-grab active:cursor-grabbing space-y-2 rounded-md border border-border bg-background p-2.5 shadow-sm transition-all hover:border-primary/40 hover:shadow",
        auto && "border-l-[3px] border-l-purple-500",
      )}
    >
      <button
        onClick={(e) => { e.stopPropagation(); if (confirm("Arquivar esta tarefa? Ela sai do quadro, mas dá para restaurar.")) onRemove(); }}
        className="absolute right-1 top-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        aria-label="Arquivar tarefa"
      >
        <Trash2 className="h-3 w-3" />
      </button>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(tg => (
            <span key={tg.label} className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider", tg.cls)}>
              {tg.label}
            </span>
          ))}
        </div>
      )}
      <div className="pr-5 text-xs font-semibold leading-snug text-foreground">
        {auto && (
          <Zap
            className="mr-1 inline-block h-3 w-3 shrink-0 -translate-y-px fill-purple-500 text-purple-500"
            aria-label="Automação"
          />
        )}
        {t.titulo}
      </div>

      {showProgress && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-muted-foreground">
            <span>{`Checklist ${subsDone}/${subsTotal}`}</span>
            <span className="num font-semibold">{progress}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full transition-all", progressBarColor(progress))} style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* A linha existe se houver área OU rotina: antes ela dependia só da área,
          e uma rotina ainda não classificada escondia a própria cadência. */}
      {(area || t.rotina) && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {area && (
            <>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: corDaArea(area) }} />
              <span className="truncate">{area}</span>
            </>
          )}
          {t.rotina && (
            /* O selo mostra a CADÊNCIA, não a palavra "rotina": quem olha o card
               quer saber quando ela volta, e "rotina" nunca respondeu isso. Sem
               agenda cadastrada, cai no rótulo antigo — que agora significa
               exatamente o que diz: repetição observada, sem geração. */
            <span
              className={cn(
                "ml-auto shrink-0 rounded px-1 py-px text-[9px] font-semibold tracking-wider",
                cadenciaDoCard
                  ? "bg-primary/10 text-primary"
                  : "bg-secondary uppercase text-muted-foreground",
              )}
              title={
                cadenciaDoCard
                  ? `Rotina · ${descreverCadenciaLonga(cadenciaDoCard)}${t.rotina_ativa === false ? " — PAUSADA" : ""}`
                  : "Rotina sem agenda: entra na conta da Análise, mas não é criada sozinha"
              }
            >
              {cadenciaDoCard
                ? `↻ ${descreverCadencia(cadenciaDoCard)}${t.rotina_ativa === false ? " (pausada)" : ""}`
                : "rotina"}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className={cn("flex items-center gap-1 text-[10px] font-medium", PRIO_TEXT[t.prioridade])}>
          <span className={cn("h-1.5 w-1.5 rounded-full", PRIO_DOT[t.prioridade])} />
          {t.prioridade}
        </div>
        <div className={cn("num flex items-center gap-1 text-[10px]",
          overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {overdue && <AlertTriangle className="h-2.5 w-2.5" />}
          {fmtDate(t.prazo)}
        </div>
        <Avatar name={t.responsavel} />
      </div>
    </div>
  );
}

function Avatar({ name, size = "xs" }: { name: string | null; size?: "xs" | "sm" }) {
  const cls = size === "xs" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]";
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-bold text-primary", cls)}>
      {initials(name)}
    </span>
  );
}

/* --------------------------- TABELA --------------------------- */
function TableView({
  columns, colsMeta,
  rows, fStatus, setFStatus, fPrioridade, setFPrioridade, fResponsavel, setFResponsavel,
  responsaveis, onOpen, onRemove, pausaIdade,
}: {
  columns: string[];
  colsMeta: ColumnsCfg["meta"];
  rows: Tarefa[];
  fStatus: string[]; setFStatus: (v: string[]) => void;
  fPrioridade: string[]; setFPrioridade: (v: string[]) => void;
  fResponsavel: string[]; setFResponsavel: (v: string[]) => void;
  responsaveis: string[];
  onOpen: (t: Tarefa) => void;
  onRemove: (id: string) => void;
  pausaIdade: (col: string) => boolean;
}) {
  // Agrupa por status
  const groups = useMemo(() => {
    const visibleStatuses = fStatus.length ? fStatus : columns;
    return visibleStatuses.map(s => ({
      status: s,
      items: rows.filter(r => r.status === s),
    })).filter(g => g.items.length > 0);
  }, [rows, fStatus, columns]);

  return (
    <Card className="overflow-hidden border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary/50 hover:bg-secondary/50">
            <TableHead className="w-8" />
            <TableHead className="text-[10px] font-bold uppercase tracking-wider">Tarefa</TableHead>
            <TableHead className="w-[150px]">
              <ColumnFilter label="Resp." options={responsaveis} value={fResponsavel} onChange={setFResponsavel} />
            </TableHead>
            <TableHead className="w-[140px]">
              <ColumnFilter label="Prioridade" options={PRIO_OPTS} value={fPrioridade} onChange={setFPrioridade} />
            </TableHead>
            <TableHead className="w-[110px] text-[10px] font-bold uppercase tracking-wider">Prazo</TableHead>
            <TableHead className="w-[110px] text-[10px] font-bold uppercase tracking-wider">Criada</TableHead>
            <TableHead
              className="w-[80px] text-[10px] font-bold uppercase tracking-wider"
              title="Dias desde a criação, sem contar o tempo em colunas marcadas como 'não conta idade'"
            >
              Idade
            </TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                Nenhuma tarefa.
              </TableCell>
            </TableRow>
          ) : groups.map(g => {
            const overdue = g.items.filter(isAtrasada).length;
            return (
              <>
                <TableRow key={`grp-${g.status}`} className="border-b-0 bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={8} className="py-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", colorOf(g.status, colsMeta).dot)} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">{g.status}</span>
                        <span className="num text-[10px] text-muted-foreground">· {g.items.length}</span>
                      </div>
                      {overdue > 0 && (
                        <div className="num flex items-center gap-1 text-[10px] font-semibold text-destructive">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {overdue} atrasada{overdue > 1 ? "s" : ""}
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {g.items.map(t => {
                  const tags = tagsFor(t);
                  const overdueRow = isAtrasada(t);
                  const idade = calcIdade(t, pausaIdade);
                  return (
                    <TableRow key={t.id} className="cursor-pointer text-xs" onClick={() => onOpen(t)}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox />
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2">
                          {tags.map(tg => (
                            <span key={tg.label} className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider", tg.cls)}>
                              {tg.label}
                            </span>
                          ))}
                          <span className="font-medium">{t.titulo}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Avatar name={t.responsavel} />
                          <span className="truncate text-xs">{(t.responsavel || "—").split(" ")[0]}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                          t.prioridade === "Urgente" && "bg-[#7f1d1d]/15",
                          t.prioridade === "Alta" && "bg-red-600/15",
                          t.prioridade === "Média" && "bg-yellow-500/15",
                          t.prioridade === "Baixa" && "bg-muted",
                        )}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", PRIO_DOT[t.prioridade])} />
                          <span className={PRIO_TEXT[t.prioridade]}>{t.prioridade}</span>
                        </div>
                      </TableCell>
                      <TableCell className={cn("num text-xs", overdueRow && "font-semibold text-destructive")}>
                        <span className="inline-flex items-center gap-1">
                          {overdueRow && <AlertTriangle className="h-2.5 w-2.5" />}
                          {fmtDate(t.prazo)}
                        </span>
                      </TableCell>
                      <TableCell className="num text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className={cn("num text-xs",
                        idade.pausada ? "text-muted-foreground"
                          : idade.dias > 7 ? "text-destructive font-semibold"
                          : idade.dias > 3 ? "text-warning-foreground"
                          : "text-muted-foreground"
                      )}>
                        <span className="inline-flex items-center gap-1" title={explicaIdade(t, idade)}>
                          {idade.pausada && <Pause className="h-2.5 w-2.5 shrink-0" />}
                          {idade.dias}d
                        </span>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { if (confirm("Arquivar esta tarefa? Ela sai do quadro, mas dá para restaurar.")) onRemove(t.id); }} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function ColumnFilter({ label, options, value, onChange }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (o: string) => {
    onChange(value.includes(o) ? value.filter(v => v !== o) : [...value, o]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">
          <Filter className="h-2.5 w-2.5" />
          {label}
          {value.length > 0 && <span className="num rounded bg-primary/15 px-1 text-[9px] text-primary">{value.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold">{label}</span>
          {value.length > 0 && (
            <button onClick={() => onChange([])} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /> Limpar
            </button>
          )}
        </div>
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {options.map(o => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-secondary">
              <Checkbox checked={value.includes(o)} onCheckedChange={() => toggle(o)} />
              <span className="flex-1 truncate">{o}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* --------------------------- Column Menu --------------------------- */
function ColumnMenu({
  col, currentColor, podeExcluir, pausaIdade, onTogglePausaIdade, onRename, onRecolor, onAddTask, onRemove,
}: {
  col: string;
  currentColor: ColorId;
  /* Falso só nas colunas que o sistema escreve (Backlog, Concluído) — ver
     COLUNAS_ESTRUTURAIS. Ser "coluna padrão" não impede mais: "Tasks - RPA" e
     "Revisão" nasceram com o quadro, mas ninguém grava nelas por código. */
  podeExcluir: boolean;
  pausaIdade: boolean;
  onTogglePausaIdade: () => void;
  onRename: () => void;
  onRecolor: (c: ColorId) => void;
  onAddTask: () => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Opções da coluna"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {col}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={onRename} className="text-xs">
          <Pencil className="mr-2 h-3.5 w-3.5" /> Renomear
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddTask} className="text-xs">
          <Plus className="mr-2 h-3.5 w-3.5" /> Adicionar tarefa
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Vale para todo mundo, não só para quem clicou: a idade é número de acompanhamento
            do time e não pode mudar dependendo de quem abre a tela. */}
        <DropdownMenuItem onClick={onTogglePausaIdade} className="text-xs">
          <Pause className="mr-2 h-3.5 w-3.5" />
          <span className="flex-1">Não contar idade</span>
          {pausaIdade && <Check className="ml-2 h-3.5 w-3.5" />}
        </DropdownMenuItem>
        <p className="px-2 pb-1.5 text-[10px] leading-snug text-muted-foreground">
          {pausaIdade
            ? "Card parado aqui não envelhece."
            : "Card parado aqui envelhece normalmente."}
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Palette className="h-3 w-3" /> Cor
        </DropdownMenuLabel>
        <div className="grid grid-cols-4 gap-1 px-2 pb-2">
          {COLOR_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => onRecolor(p.id)}
              className={cn(
                "relative grid h-7 place-items-center rounded-md transition-transform hover:scale-110",
                p.dot,
                currentColor === p.id && "ring-2 ring-offset-1 ring-offset-popover ring-foreground"
              )}
              title={p.label}
              aria-label={`Cor ${p.label}`}
            >
              {currentColor === p.id && <Check className="h-3.5 w-3.5 text-background" />}
            </button>
          ))}
        </div>
        {podeExcluir && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onRemove}
              className="text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir coluna
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
