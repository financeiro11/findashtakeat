import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { useNovidades } from "@/hooks/useNovidades";
import {
  ehBastidor, metaDoTipo, parseDia, rotuloDoDia, hojeBRT,
  type DiaNovidades, type ItemNovidade,
} from "@/lib/novidades";
import { normalize } from "@/lib/normalize";
import {
  Rocket, RefreshCw, Loader2, ArrowRight, CheckCheck, Search, GitCommit, Wrench,
} from "lucide-react";

/* ============================================================================
 * Novidades do Hub — o diário de bordo da própria ferramenta.
 *
 * O Hub muda quase todo dia e quem usa descobria por acidente: abria a DRE e a
 * célula fazia outra coisa. Aqui a mudança de ontem está escrita, com o link
 * para a tela onde ela aparece e o commit que a fez (para quem quiser conferir).
 *
 * A página só LÊ `hub_novidades`. Quem escreve é a Edge Function
 * `hub-novidades-sync`, que lê os commits do GitHub no cron das 08:35 — meia
 * hora antes do briefing, porque é junto com o briefing que isso se lê.
 * ========================================================================== */

const fmtDDMM = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

export default function NovidadesHub() {
  const { dias, vistoAte, loading, atualizando, erro, naoLidos, atualizar, marcarLido } = useNovidades(30);
  const [busca, setBusca] = useState("");
  const [verBastidor, setVerBastidor] = useState(false);
  const hoje = hojeBRT();

  const nBastidor = useMemo(
    () => dias.reduce((s, d) => s + d.itens.filter(ehBastidor).length, 0),
    [dias],
  );

  /** Filtra por texto e por bastidor. Dia que ficou sem item some da lista —
   *  uma tela cheia de cabeçalhos vazios não ajuda ninguém a achar nada. */
  const visiveis = useMemo(() => {
    const q = normalize(busca.trim());
    return dias
      .map((d) => ({
        ...d,
        itens: d.itens.filter((i) => {
          if (!verBastidor && ehBastidor(i)) return false;
          if (!q) return true;
          return normalize(`${i.titulo} ${i.o_que_muda} ${i.area}`).includes(q);
        }),
      }))
      .filter((d) => d.itens.length > 0);
  }, [dias, busca, verBastidor]);

  const totalVisivel = visiveis.reduce((s, d) => s + d.itens.length, 0);

  async function onAtualizar() {
    const r = await atualizar(2);
    if (!r.ok) toast.error("Não deu para ler as mudanças agora: " + r.erro);
    else toast.success("Novidades atualizadas com o que já está publicado.");
  }

  async function onMarcarLido() {
    await marcarLido();
    toast.success("Marcado como lido — o selo volta quando sair coisa nova.");
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando as novidades…
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* ---------------- Cabeçalho ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-amber-500 text-white shadow-sm">
            <Rocket className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Novidades do Hub</h1>
              {naoLidos > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {naoLidos} nova{naoLidos === 1 ? "" : "s"} {vistoAte ? "desde sua última visita" : "para você"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              O que mudou na ferramenta, dia a dia · lido dos commits publicados e atualizado junto com o briefing
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {naoLidos > 0 && (
            <button
              onClick={onMarcarLido}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] font-medium text-foreground transition hover:bg-secondary"
            >
              <CheckCheck className="h-4 w-4" /> Marcar como lido
            </button>
          )}
          <button
            onClick={onAtualizar}
            disabled={atualizando}
            title="Lê agora os commits de hoje e de ontem. O normal é o cron das 08:35 já ter feito isso."
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-[12.5px] font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
          >
            {atualizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {atualizando ? "lendo…" : "Atualizar"}
          </button>
        </div>
      </div>

      {erro && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          {erro}
        </div>
      )}

      {/* ---------------- Filtros ---------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar na novidade — tela, palavra do texto…"
            className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-3 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>
        <button
          onClick={() => setVerBastidor((v) => !v)}
          title="Migração, cron, teste, organização do código — aconteceu, mas não muda nada na tela."
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-[12px] font-medium transition",
            verBastidor ? "border-primary/40 bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground hover:bg-secondary",
          )}
        >
          <Wrench className="h-3.5 w-3.5" />
          {verBastidor ? "esconder bastidor" : `mostrar bastidor (${nBastidor})`}
        </button>
      </div>

      {/* ---------------- Dias ---------------- */}
      {visiveis.length === 0 ? (
        <SectionCard title="Nada por aqui ainda">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {dias.length === 0 ? (
              <>
                As novidades são lidas dos commits publicados e gravadas todo dia às 08:35 (America/Sao_Paulo),
                meia hora antes do briefing. Clique em <span className="font-medium text-foreground">Atualizar</span> para
                ler agora o que já foi publicado hoje e ontem.
              </>
            ) : (
              <>Nenhuma mudança bate com esse filtro. {!verBastidor && nBastidor > 0 && <>Há {nBastidor} de bastidor escondidas.</>}</>
            )}
          </p>
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {visiveis.map((d) => (
            <DiaCard key={d.dia} dia={d} hoje={hoje} novo={!vistoAte || d.dia > vistoAte} />
          ))}
        </div>
      )}

      <div className="pt-1 text-center text-[11px] text-muted-foreground">
        {totalVisivel} mudança{totalVisivel === 1 ? "" : "s"} nos últimos 30 dias · lido do repositório e redigido no Hub
        (Supabase · <span className="num">hub_novidades</span>)
      </div>
    </div>
  );
}

/* ============================================================================ */
function DiaCard({ dia, hoje, novo }: { dia: DiaNovidades; hoje: string; novo: boolean }) {
  const d = parseDia(dia.dia);
  const rotulo = rotuloDoDia(dia.dia, hoje);
  const n = dia.itens.length;

  return (
    <SectionCard
      className={cn(novo && "ring-1 ring-primary/20")}
      title={
        <span className="flex items-center gap-2">
          <span className="capitalize">{rotulo}</span>
          <span className="num text-[11.5px] font-normal text-muted-foreground">{fmtDDMM(d)}</span>
          {novo && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-primary">novo</span>
          )}
        </span>
      }
      subtitle={dia.resumo || `${n} mudança${n === 1 ? "" : "s"} publicada${n === 1 ? "" : "s"}`}
      actions={
        <span className="num text-[11px] text-muted-foreground" title={`${dia.n_commits} commits no dia`}>
          {n} item{n === 1 ? "" : "ns"}
        </span>
      }
    >
      <ul className="space-y-2">
        {dia.itens.map((it, i) => (
          <ItemLinha key={i} item={it} commits={dia.commits} />
        ))}
      </ul>
    </SectionCard>
  );
}

function ItemLinha({ item, commits }: { item: ItemNovidade; commits: DiaNovidades["commits"] }) {
  const meta = metaDoTipo(item.tipo);
  // Os commits que compõem este item — é o que permite conferir a mudança na
  // fonte quando a redação ficou vaga demais.
  const doItem = commits.filter((c) => item.commits?.includes(c.sha));

  return (
    <li className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-start gap-3">
        <span className={cn("mt-[7px] h-2 w-2 shrink-0 rounded-full", meta.ponto)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider", meta.chip)}>
              {meta.rotulo}
            </span>
            <span className="text-[13px] font-semibold leading-snug text-foreground">{item.titulo}</span>
            {item.area && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{item.area}</span>
            )}
            {item.hora && <span className="num text-[10.5px] text-muted-foreground/80">{item.hora}</span>}
          </div>

          {item.o_que_muda && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{item.o_que_muda}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {item.rota && (
              <Link to={item.rota} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                Abrir {item.area || "a tela"} <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            {doItem.length > 0 && (
              <details className="group text-[11px]">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground marker:content-none hover:text-foreground">
                  <GitCommit className="h-3 w-3" />
                  {doItem.length} commit{doItem.length === 1 ? "" : "s"}
                </summary>
                <div className="mt-1.5 space-y-1 border-l border-border pl-2">
                  {doItem.map((c) => (
                    <div key={c.sha} className="flex items-baseline gap-2">
                      <a
                        href={c.url} target="_blank" rel="noreferrer"
                        className="num shrink-0 text-primary hover:underline"
                      >
                        {c.sha.slice(0, 7)}
                      </a>
                      <span className="min-w-0 truncate text-muted-foreground" title={c.assunto}>{c.assunto}</span>
                      <span className="shrink-0 text-muted-foreground/70">{c.autor}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
