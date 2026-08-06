// Aba Início — o briefing do dia e os KPIs, só leitura.
//
// Regra da aba: NENHUM número é calculado aqui. Todos vêm de snapshot já fechado
// (omie_caixa_snapshot, assinaturas_snapshot, churn_snapshot) ou de tabela de saldo. Somar
// linha no celular criaria um segundo número para a mesma pergunta — e o do celular seria
// o errado, porque não conhece as regras de exclusão que as syncs aplicam.

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, CalendarClock, Mail, Newspaper, Sparkles, Landmark, CreditCard, Wallet, Repeat, TrendingDown, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmtDataHora, desatualizado } from "@/lib/mobile/formato";
import { montarKpis, type CartaoKpi, type ChaveKpi } from "@/lib/mobile/kpis";
import { lerAgenda, lerEmails, lerNoticias, type ItemAgenda, type ItemEmail, type ItemNoticia } from "@/lib/mobile/briefing";

const sb = supabase as any;

type Briefing = {
  id: string; periodo_inicio: string; periodo_fim: string;
  conteudo_markdown: string; agenda: any; emails: any; noticias: any; gerado_em: string;
};

const ICONE_KPI: Record<ChaveKpi, typeof Landmark> = {
  sicoob: Landmark,
  asaas: CreditCard,
  caixa: Wallet,
  assinaturas: Repeat,
  churn: TrendingDown,
};

/* --------------------------------- dados --------------------------------- */
async function carregarTudo() {
  const [briefing, sicoob, asaas, caixa, assinaturas, churn] = await Promise.all([
    sb.from("briefing_diario")
      .select("id,periodo_inicio,periodo_fim,conteudo_markdown,agenda,emails,noticias,gerado_em")
      .order("gerado_em", { ascending: false }).limit(1).maybeSingle(),
    sb.from("sicoob_saldo").select("conta,saldo,atualizado_em")
      .order("atualizado_em", { ascending: false }).limit(1).maybeSingle(),
    sb.from("asaas_saldo").select("conta,saldo,atualizado_em")
      .order("atualizado_em", { ascending: false }).limit(1).maybeSingle(),
    sb.from("omie_caixa_snapshot").select("dados,gerado_em")
      .order("gerado_em", { ascending: false }).limit(1).maybeSingle(),
    sb.from("assinaturas_snapshot").select("competencia,mes_label,dados,insights,gerado_em")
      .order("competencia", { ascending: false }).limit(1).maybeSingle(),
    sb.from("churn_snapshot").select("competencia,mes_label,dados,gerado_em")
      .order("competencia", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    briefing: (briefing.data as Briefing) ?? null,
    kpis: montarKpis({
      sicoob: sicoob.data, asaas: asaas.data, caixa: caixa.data,
      assinaturas: assinaturas.data, churn: churn.data,
    }),
  };
}

/* -------------------------------- página -------------------------------- */
export default function MobileInicio() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [kpis, setKpis] = useState<CartaoKpi[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    carregarTudo()
      .then((r) => { if (vivo) { setBriefing(r.briefing); setKpis(r.kpis); } })
      .catch((e) => { if (vivo) setErro(e?.message ?? "Falha ao carregar"); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  const agenda = briefing ? lerAgenda(briefing.agenda) : [];
  const emails = briefing ? lerEmails(briefing.emails) : [];
  const noticias = briefing ? lerNoticias(briefing.noticias) : [];

  return (
    <div className="pb-8">
      <CarrosselKpis kpis={kpis} carregando={carregando} />

      <div className="px-4">
        {erro && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {carregando ? (
          <div className="space-y-3">
            <div className="h-4 w-2/3 animate-pulse rounded bg-secondary" />
            <div className="h-4 w-full animate-pulse rounded bg-secondary" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-secondary" />
          </div>
        ) : !briefing ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="text-[15px] font-semibold">Briefing ainda não gerado hoje</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              Ele é publicado automaticamente às 09:00 e aparece aqui assim que sai.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3 text-primary" />
              Atualizado em {fmtDataHora(briefing.gerado_em)}
            </div>

            {/* 16px de base: abaixo disso o iOS dá zoom sozinho ao focar um campo.
                `break-words`: o briefing traz URL e código do Omie sem espaço, e uma
                palavra longa demais empurraria a página inteira para o lado. */}
            <article className="prose prose-sm max-w-none break-words text-[16px] leading-relaxed prose-headings:text-[17px] prose-headings:font-semibold prose-p:my-2.5 prose-li:my-1 prose-strong:text-foreground dark:prose-invert">
              <ReactMarkdown
                components={{
                  a: (props) => <a {...props} target="_blank" rel="noreferrer" className="text-primary" />,
                  table: (props) => <div className="overflow-x-auto"><table {...props} /></div>,
                }}
              >
                {briefing.conteudo_markdown}
              </ReactMarkdown>
            </article>

            <div className="mt-5 space-y-2.5">
              <Secao titulo="Agenda" icone={CalendarClock} quantidade={agenda.length}>
                {agenda.map((item, i) => <LinhaAgenda key={i} item={item} />)}
              </Secao>
              <Secao titulo="E-mails" icone={Mail} quantidade={emails.length}>
                {emails.map((item, i) => <LinhaEmail key={i} item={item} />)}
              </Secao>
              <Secao titulo="Notícias" icone={Newspaper} quantidade={noticias.length}>
                {noticias.map((item, i) => <LinhaNoticia key={i} item={item} />)}
              </Secao>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- KPIs ------------------------------- */
function CarrosselKpis({ kpis, carregando }: { kpis: CartaoKpi[]; carregando: boolean }) {
  if (carregando) {
    return (
      <div className="flex gap-3 overflow-x-hidden px-4 py-4">
        {[0, 1].map((i) => <div key={i} className="h-[104px] w-[78%] shrink-0 animate-pulse rounded-xl bg-secondary" />)}
      </div>
    );
  }
  if (!kpis.length) return null;

  return (
    <div
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="list"
      aria-label="Indicadores"
    >
      {kpis.map((kpi) => {
        const velho = desatualizado(kpi.quando, kpi.janelaHoras);
        const Icone = ICONE_KPI[kpi.chave];
        return (
          <div
            key={kpi.chave}
            role="listitem"
            // 78% deixa a borda do próximo card à mostra — é o que sinaliza que a lista rola.
            className="w-[78%] shrink-0 snap-start rounded-xl border border-border bg-card p-3.5 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icone className="h-4 w-4" />
              </div>
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {kpi.rotulo}
              </span>
            </div>
            <div className="num mt-2 text-[22px] font-bold leading-none tracking-tight">{kpi.valor}</div>
            <div className="mt-1.5 truncate text-[11.5px] text-muted-foreground">{kpi.detalhe}</div>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="num text-[10.5px] text-muted-foreground">{fmtDataHora(kpi.quando)}</span>
              {velho && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  desatualizado
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- seções ------------------------------- */
function Secao({
  titulo, icone: Icone, quantidade, children,
}: {
  titulo: string;
  icone: typeof Mail;
  quantidade: number;
  children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        disabled={!quantidade}
        className="flex min-h-[48px] w-full items-center gap-2.5 px-3.5 py-3 text-left disabled:opacity-60"
      >
        <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[14px] font-semibold">{titulo}</span>
        <span className="num rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{quantidade}</span>
        {!!quantidade && (
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberta && "rotate-180")} />
        )}
      </button>
      {aberta && quantidade > 0 && (
        <ul className="divide-y divide-border border-t border-border">{children}</ul>
      )}
    </div>
  );
}

const mdInline = {
  p: (props: any) => <span {...props} />,
  a: (props: any) => <a {...props} target="_blank" rel="noreferrer" className="text-primary underline-offset-2" />,
  strong: (props: any) => <strong {...props} className="font-semibold text-foreground" />,
};

function LinhaAgenda({ item }: { item: ItemAgenda }) {
  return (
    <li className="flex gap-3 px-3.5 py-2.5">
      <span className="num w-[68px] shrink-0 text-[12px] font-semibold text-primary">{item.hora || "—"}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] leading-snug text-foreground">{item.titulo}</div>
        {item.quem.length > 0 && (
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">{item.quem.join(" · ")}</div>
        )}
      </div>
    </li>
  );
}

function LinhaEmail({ item }: { item: ItemEmail }) {
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{item.remetente}</span>
        {item.badge && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            {item.badge}
          </span>
        )}
      </div>
      {item.resumo && (
        <div className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
          <ReactMarkdown components={mdInline}>{item.resumo}</ReactMarkdown>
        </div>
      )}
      {item.link && (
        <a href={item.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-primary">
          Abrir e-mail
        </a>
      )}
    </li>
  );
}

function LinhaNoticia({ item }: { item: ItemNoticia }) {
  return (
    <li className="px-3.5 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.titulo}</div>
      <div className="mt-1 text-[13px] leading-snug text-foreground">
        <ReactMarkdown components={mdInline}>{item.resumo}</ReactMarkdown>
      </div>
    </li>
  );
}
