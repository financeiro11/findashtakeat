import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { openAIAssistant } from "@/components/AIAssistant";
import {
  Sparkles, RefreshCw, Loader2, CalendarDays, AlertTriangle, Mail,
  Clock, ArrowRight, Newspaper, CalendarClock,
} from "lucide-react";

/* ------------------------------ tipos (JSONB) ------------------------------ */
type Evento = { hora: string; titulo: string; conflito?: boolean; com?: string | null };
type Pessoa = { id: string; nome: string; papel: string; iniciais: string; cor?: string; eventos: Evento[] };
type Conflito = { hora: string; titulo: string; pessoas?: string[]; resumo_curto?: string };
type TimelineItem = { hora: string; titulo: string; tipo?: string };
type Agenda = {
  data?: string; dia_semana?: string; total_compromissos?: number; total_pessoas?: number;
  proximo_evento?: { hora: string; titulo: string } | null;
  resumo_ia?: string | null; resumo_tags?: string[];
  conflitos?: Conflito[]; pessoas?: Pessoa[]; timeline?: TimelineItem[];
};
type EmailItem = {
  remetente: string; tipo?: string; badge?: string; resumo: string;
  valor?: number | null; vence_em?: string | null; link?: string | null;
};
type Emails = { total?: number; vencem_semana?: number; itens?: EmailItem[] };
type TemaNoticia = { chave?: string; titulo: string; resumo: string };
type Noticias = { janela?: string; temas?: TemaNoticia[] };

type Briefing = {
  id: string;
  periodo_inicio: string;
  periodo_fim: string;
  conteudo_markdown: string;
  agenda: Agenda | null;
  emails: Emails | null;
  noticias: Noticias | null;
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

/* --------------------------- cores / estilos por tipo --------------------------- */
const CORES_PESSOA: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  blue: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};
const DOT_TIMELINE: Record<string, string> = {
  caixa: "bg-primary",
  conflito: "bg-primary",
  reuniao: "bg-sky-500",
  conciliacao: "bg-emerald-500",
  revisao: "bg-muted-foreground/40",
  outro: "bg-muted-foreground/40",
};

/** tom visual de um e-mail: urgente (vermelho) / atenção (âmbar) / neutro. */
function tomEmail(item: EmailItem): "red" | "amber" | "neutral" {
  if (item.tipo === "aprovacao" || item.tipo === "alerta") return "amber";
  if (item.tipo === "vencimento" && item.vence_em) {
    const dias = Math.round((parseLocal(item.vence_em).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
    return dias <= 5 ? "red" : "neutral";
  }
  return item.tipo === "vencimento" ? "red" : "neutral";
}
const BARRA_TOM: Record<string, string> = { red: "bg-primary", amber: "bg-amber-500", neutral: "bg-border" };
const BADGE_TOM: Record<string, string> = {
  red: "bg-primary/10 text-primary",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  neutral: "bg-secondary text-muted-foreground",
};

/* renderiza markdown inline (negrito + links) dentro de um resumo curto */
const mdComponents = {
  a: (props: any) => <a {...props} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline" />,
  p: (props: any) => <span {...props} />,
  strong: (props: any) => <strong {...props} className="num font-semibold text-foreground" />,
};

export default function Briefing() {
  const [b, setB] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  async function regerar() {
    // A geração real roda na tarefa agendada das 09:00 (skill com Gmail/Agenda/WebSearch).
    // Aqui buscamos a última versão publicada no Hub.
    setRefreshing(true);
    const antes = b?.gerado_em;
    const atual = await carregar(true);
    setRefreshing(false);
    if (atual?.gerado_em && atual.gerado_em !== antes) toast.success("Briefing atualizado com a versão mais recente.");
    else toast.message("Você já está na versão mais recente publicada (gerada às 09:00).");
  }

  function aprofundar() {
    const resumo = b?.agenda?.resumo_ia ? `\n\nResumo do dia: ${b.agenda.resumo_ia}` : "";
    openAIAssistant(
      `Com base no meu briefing diário de hoje (agenda, e-mails acionáveis e notícias), me ajude a priorizar as ações do dia e destacar riscos.${resumo}`,
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
        <button
          onClick={() => carregar()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
        >
          <RefreshCw className="h-4 w-4" /> Buscar briefing
        </button>
      </div>
    );
  }

  return <BriefingView b={b} onRegerar={regerar} onAprofundar={aprofundar} refreshing={refreshing} />;
}

/* ============================================================================ */
function BriefingView({ b, onRegerar, onAprofundar, refreshing }: {
  b: Briefing; onRegerar: () => void; onAprofundar: () => void; refreshing: boolean;
}) {
  const ag = b.agenda ?? {};
  const em = b.emails ?? {};
  const nw = b.noticias ?? {};
  const temEstruturado = !!(b.agenda || b.emails || b.noticias);

  /* ---------------- cabeçalho: data + janela ---------------- */
  const dataHoje = ag.data ? parseLocal(ag.data) : parseLocal(b.periodo_fim);
  const diaSemana = ag.dia_semana ?? DIAS_SEMANA[dataHoje.getDay()];
  const ini = parseLocal(b.periodo_inicio), fim = parseLocal(b.periodo_fim);
  const janelaLabel = b.periodo_inicio === b.periodo_fim
    ? "hoje"
    : `${DIAS_ABBR[ini.getDay()]} ${fmtDDMM(ini)} – ${DIAS_ABBR[fim.getDay()]} ${fmtDDMM(fim)}`;

  /* ---------------- KPIs derivados ---------------- */
  const conflitos = ag.conflitos ?? [];
  const nCompromissos = ag.total_compromissos ?? (ag.pessoas ?? []).reduce((s, p) => s + (p.eventos?.length ?? 0), 0);
  const nPessoas = ag.total_pessoas ?? (ag.pessoas ?? []).length;
  const emailItens = em.itens ?? [];
  const vencemSemana = em.vencem_semana ?? emailItens.filter((i) => i.vence_em).length;
  const prox = ag.proximo_evento;

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
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Entregue {fmtHoraBRT(b.gerado_em)}
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px] capitalize text-muted-foreground">
              {diaSemana}, {fmtDDMMYYYY(dataHoje)}
              <span className="lowercase"> · janela {janelaLabel} · fuso America/Sao_Paulo</span>
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
        <Kpi icon={CalendarDays} eyebrow="Compromissos" value={String(nCompromissos)}
             sub={`entre ${nPessoas} pessoa${nPessoas === 1 ? "" : "s"} hoje`} />
        <Kpi icon={AlertTriangle} eyebrow="Conflitos" value={String(conflitos.length)} tone={conflitos.length ? "neg" : undefined}
             sub={conflitos[0] ? `${conflitos[0].hora} · ${conflitos[0].resumo_curto ?? (conflitos[0].pessoas ?? []).join(" × ")}` : "sem conflitos"} />
        <Kpi icon={Mail} eyebrow="E-mails acionáveis" value={String(em.total ?? emailItens.length)}
             sub={`${vencemSemana} vence${vencemSemana === 1 ? "" : "m"} esta semana`} />
        <Kpi icon={Clock} eyebrow="Próximo evento" value={prox?.hora ?? "—"} mono
             sub={prox?.titulo ?? "sem eventos futuros"} />
      </div>

      {/* ---------------- Agenda + coluna lateral ---------------- */}
      {temEstruturado ? (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {/* Agenda */}
            <div className="lg:col-span-2">
              <SectionCard
                title={<span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" /> Agenda de hoje</span>}
                subtitle={`${nPessoas} pessoas · ${nCompromissos} compromissos`}
                actions={conflitos.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    <AlertTriangle className="h-3 w-3" /> {conflitos.length} conflito{conflitos.length === 1 ? "" : "s"}
                  </span>
                )}
              >
                <div className="space-y-3">
                  {conflitos.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2 text-[12px]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="text-foreground"><span className="font-semibold">Conflito às {c.hora}</span> — {c.titulo}</span>
                    </div>
                  ))}

                  {(ag.pessoas ?? []).map((p) => (
                    <div key={p.id} className="rounded-lg border border-border/70">
                      <div className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2">
                        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold", CORES_PESSOA[p.cor ?? "primary"] ?? CORES_PESSOA.primary)}>
                          {p.iniciais}
                        </span>
                        <span className="text-[13px] font-semibold text-foreground">{p.nome}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{p.papel}</span>
                      </div>
                      <ul>
                        {(p.eventos ?? []).map((e, i) => (
                          <li key={i} className={cn(
                            "flex items-center gap-3 px-3 py-1.5 text-[12.5px]",
                            i > 0 && "border-t border-border/40",
                            e.conflito && "bg-primary/[0.04]",
                          )}>
                            <span className="num w-11 shrink-0 font-semibold text-muted-foreground">{e.hora}</span>
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
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>

            {/* Coluna lateral: resumo IA + timeline */}
            <div className="space-y-3">
              {ag.resumo_ia && (
                <SectionCard title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Resumo do dia · IA</span>}>
                  <p className="text-[12.5px] leading-relaxed text-foreground">{ag.resumo_ia}</p>
                  {(ag.resumo_tags ?? []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(ag.resumo_tags ?? []).map((t, i) => (
                        <span key={i} className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  )}
                </SectionCard>
              )}

              {(ag.timeline ?? []).length > 0 && (
                <SectionCard title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" /> Linha do tempo</span>}>
                  <ul className="space-y-0.5">
                    {(ag.timeline ?? []).map((t, i) => (
                      <li key={i} className={cn(
                        "flex items-center gap-3 rounded-md px-2 py-1.5 text-[12px]",
                        t.tipo === "conflito" && "bg-primary/[0.05]",
                      )}>
                        <span className="num w-10 shrink-0 font-semibold text-muted-foreground">{t.hora}</span>
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT_TIMELINE[t.tipo ?? "outro"] ?? DOT_TIMELINE.outro)} />
                        <span className={cn("min-w-0 flex-1 truncate", t.tipo === "conflito" ? "font-medium text-primary" : "text-foreground")}>{t.titulo}</span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              )}
            </div>
          </div>

          {/* ---------------- E-mails ---------------- */}
          {emailItens.length > 0 && (
            <SectionCard
              title={<span className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> E-mails que pedem atenção</span>}
              subtitle={`${em.total ?? emailItens.length} acionáveis · ruído filtrado`}
            >
              <div className="space-y-2.5">
                {emailItens.map((it, i) => {
                  const tom = tomEmail(it);
                  const href = it.link || `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(it.remetente)}`;
                  return (
                    <div key={i} className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                      <span className={cn("mt-0.5 h-9 w-1 shrink-0 rounded-full", BARRA_TOM[tom])} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-foreground">{it.remetente}</span>
                          {it.badge && (
                            <span className={cn("rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider", BADGE_TOM[tom])}>{it.badge}</span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                          <ReactMarkdown components={mdComponents}>{it.resumo}</ReactMarkdown>
                        </div>
                      </div>
                      <a
                        href={href} target="_blank" rel="noreferrer"
                        className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                      >
                        Abrir <ArrowRight className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* ---------------- Notícias ---------------- */}
          {(nw.temas ?? []).length > 0 && (
            <SectionCard
              title={<span className="flex items-center gap-2"><Newspaper className="h-4 w-4 text-muted-foreground" /> Notícias</span>}
              subtitle={nw.janela ? `janela ${nw.janela}` : undefined}
            >
              <div className="space-y-4">
                {(nw.temas ?? []).map((t, i) => (
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

      <div className="pt-1 text-center text-[11px] text-muted-foreground">
        Gerado automaticamente às {fmtHoraBRT(b.gerado_em)} · publicado no Hub (Supabase · <span className="num">briefing_diario</span>)
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
