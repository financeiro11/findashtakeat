/* /automacoes/painel — "o que roda sozinho, está rodando?"
 *
 * A FAIXA DO TOPO NÃO BASTAVA, e o motivo é honesto: ela cabe no canto do olho e
 * por isso mostra três coisas. Quem quer conferir a esteira das notas precisa de
 * mais do que "faltam 4 minutos" — precisa saber QUAL cron, o que ele faz, o que
 * ele respondeu da última vez e, principalmente, quanto ficou parado esperando a
 * vez dele. Isso é uma tela, não um chip.
 *
 * A ESTEIRA DAS NOTAS VEM PRIMEIRO e vem como corrente, não como lista. Uma nota
 * de fornecedor passa por cinco etapas até estar dentro do Omie, e cada etapa tem
 * fila própria. É a fila que denuncia o entupimento: o cron da etapa 4 pode estar
 * disparando de oito em oito minutos, redondo, enquanto a etapa 2 acumula 300
 * arquivos por ler — e o número de "notas no ERP" não anda. Ler os dois lado a
 * lado é o ponto desta tela.
 *
 * VERDE É A FUNÇÃO TER RESPONDIDO 2xx, não o cron ter disparado. O
 * `cron.job_run_details` diz `succeeded` quando o `net.http_post` foi enfileirado
 * — mesmo que a Edge Function devolva 500. Ver `lib/automacoes.ts` e a migration
 * `20260827220000`.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { desde, faltam, proximoDisparo } from "@/lib/cronProximo";
import { useAutomacoes } from "@/hooks/useAutomacoes";
import {
  DA_ESTEIRA, ESTEIRA_NOTAS, O_QUE_FAZ, falhou, situacao,
  type Automacao, type Situacao,
} from "@/lib/automacoes";
import { normalize } from "@/lib/normalize";
import {
  AlertTriangle, ArrowRight, Check, Clock, HelpCircle, Loader2, MinusCircle, Paperclip,
  RefreshCw, Search, Sparkles, Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/* -------------------------------------------------------------------------
 * Pecinhas
 * ---------------------------------------------------------------------- */

const CORES: Record<Situacao, string> = {
  falha: "text-red-600 dark:text-red-400",
  esperando: "text-amber-600 dark:text-amber-400",
  /* Cinza, não âmbar: "não sei" não é aviso. Trinta e três automações ainda sem
     desfecho colhido pintadas de amarelo viram um painel que grita sem motivo —
     e um painel que grita sempre deixa de ser lido. */
  sem_resposta: "text-muted-foreground",
  ok: "text-emerald-600 dark:text-emerald-400",
  sem_registro: "text-muted-foreground/60",
  desligada: "text-muted-foreground/60",
};

const DIZERES: Record<Situacao, string> = {
  falha: "a última resposta não foi 2xx",
  esperando: "disparou e a resposta ainda não foi colhida",
  sem_resposta: "disparou, mas o desfecho não foi lido — some daqui na próxima vez que ela rodar",
  ok: "a função respondeu que deu certo",
  sem_registro: "sem execução guardada — o histórico dura 7 dias",
  desligada: "desligada no agendador",
};

const ICONES: Record<Situacao, typeof Check> = {
  falha: AlertTriangle,
  esperando: Clock,
  sem_resposta: HelpCircle,
  ok: Check,
  sem_registro: MinusCircle,
  desligada: MinusCircle,
};

function Selo({ s }: { s: Situacao }) {
  const Icone = ICONES[s];
  return <Icone className={cn("h-3.5 w-3.5 shrink-0", CORES[s])} aria-label={DIZERES[s]} />;
}

/** O resumo de uma automação numa linha — usado na esteira e na lista de baixo. */
function Linha({ a, agora, compacto }: { a: Automacao; agora: Date; compacto?: boolean }) {
  const s = situacao(a);
  const quando = proximoDisparo(a.schedule, agora);
  return (
    <div className="flex items-start gap-2 py-1" title={`${a.schedule} (UTC) · ${DIZERES[s]}`}>
      <span className="mt-0.5"><Selo s={s} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12px] font-medium">{a.jobname}</span>
          <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
            {faltam(quando, agora)}
          </span>
        </div>
        {!compacto && O_QUE_FAZ[a.jobname] && (
          <p className="text-[11.5px] leading-snug text-muted-foreground">{O_QUE_FAZ[a.jobname]}</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          última {desde(a.ultimo_em, agora)}
          {a.status_http != null && ` · HTTP ${a.status_http}`}
          {a.falhas_24h > 0 && ` · ${a.falhas_24h} falha${a.falhas_24h > 1 ? "s" : ""} em 24h`}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * A tela
 * ---------------------------------------------------------------------- */

type Corte = "todas" | "esteira" | "problema";

/** O que a IA entendeu de cada falha (`automacao_diagnosticos_abertos`). */
type Diagnostico = {
  jobname: string;
  resumo: string;
  causa: string | null;
  o_que_fazer: string | null;
  gravidade: string | null;
  ocorrencias: number;
};

export default function PainelAutomacoes() {
  const { estado, erro, agora, lendo, ler } = useAutomacoes();
  const [corte, setCorte] = useState<Corte>("todas");
  const [busca, setBusca] = useState("");
  const [diagnosticos, setDiagnosticos] = useState<Record<string, Diagnostico>>({});

  /* ACESSÓRIO POR CONSTRUÇÃO: a leitura do diagnóstico é uma chamada própria e,
     se falhar, a tela mostra a falha crua como sempre mostrou. O diagnóstico
     ajuda a entender o erro; ele não pode ser mais uma coisa capaz de esconder o
     erro. Só uma vez por montagem — a lista muda a cada 60s, o diagnóstico não. */
  useEffect(() => {
    let vivo = true;
    (supabase as any).rpc("automacao_diagnosticos_abertos").then(
      ({ data }: { data: Diagnostico[] | null }) => {
        if (!vivo || !data) return;
        setDiagnosticos(Object.fromEntries(data.map((d) => [d.jobname, d])));
      },
    );
    return () => { vivo = false; };
  }, []);

  // Memorizado porque o relógio repinta esta tela de segundo em segundo: um `[]`
  // novo a cada render invalidaria todos os `useMemo` abaixo, inclusive a
  // ordenação das 46 automações.
  const autos = useMemo(() => estado?.automacoes ?? [], [estado]);
  const porNome = useMemo(() => new Map(autos.map((a) => [a.jobname, a])), [autos]);
  const filaDe = useMemo(
    () => new Map((estado?.filas ?? []).map((f) => [f.chave, f])),
    [estado],
  );

  const ruins = useMemo(() => autos.filter((a) => a.ativo && falhou(a)), [autos]);
  const naFila = useMemo(
    () => (estado?.filas ?? []).reduce((s, f) => s + f.quantos, 0),
    [estado],
  );

  const lista = useMemo(() => {
    const termo = normalize(busca).toLowerCase().trim();
    return autos
      .filter((a) => {
        if (corte === "esteira" && !DA_ESTEIRA.has(a.jobname)) return false;
        if (corte === "problema" && !falhou(a)) return false;
        if (!termo) return true;
        const varre = [a.jobname, a.alvo ?? "", O_QUE_FAZ[a.jobname] ?? "", a.schedule];
        return varre.some((t) => normalize(t).toLowerCase().includes(termo));
      })
      .map((a) => ({ a, quando: proximoDisparo(a.schedule, agora) }))
      .sort((x, y) => {
        // Sem próximo disparo (expressão que não se lê) desce para o fim.
        if (!x.quando) return 1;
        if (!y.quando) return -1;
        return x.quando.getTime() - y.quando.getTime();
      });
  }, [autos, corte, busca, agora]);

  return (
    /* O `main` do AppLayout não tem padding — cada página põe o seu. */
    <div className="space-y-3.5 px-5 pb-7 pt-3.5">
      {/* ---------------- Cabeçalho ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Automações</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <Zap className="h-3 w-3" /> cron
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">
            O que o Hub faz sozinho: quando roda de novo, o que a função respondeu da última vez e
            quanto trabalho está esperando em cada fila. É a mesma leitura da faixa do topo, aberta.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11.5px] text-muted-foreground">
            lido {desde(estado?.gerado_em ?? null, agora)}
          </span>
          <button className="ghost-btn px-2" onClick={ler} disabled={lendo} title="Reler agora">
            {lendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Sem `card-surface` nos cartões vermelhos, de propósito: ela mora no
          `@layer utilities` e escreve `background`/`border` em forma curta, que
          vencem o `bg-red-500/10` da marcação — o cartão sairia cinza. */}
      {erro && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-[12.5px] text-red-700 dark:text-red-400">
          Não deu para ler o estado das automações: {erro}
        </div>
      )}

      {!estado && !erro && (
        <div className="card-surface flex items-center gap-2 p-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> lendo o agendador…
        </div>
      )}

      {/* ---------------- O que está quebrado ----------------
          Vem antes de tudo: quem abriu esta tela com a faixa vermelha veio por
          causa disto, e falha de automação não avisa sozinha. */}
      {!!ruins.length && (
        <div className="rounded-lg border border-red-500/40 bg-card p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-red-700 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
            {ruins.length} automação{ruins.length > 1 ? "ões" : ""} falhando
          </p>
          <ul className="mt-2 space-y-2">
            {ruins.map((a) => (
              <li key={a.jobname} className="text-[12.5px]">
                <span className="font-medium">{a.jobname}</span>
                <span className="text-muted-foreground">
                  {" "}· {a.schedule} · última {desde(a.ultimo_em, agora)}
                </span>
                {O_QUE_FAZ[a.jobname] && (
                  <p className="text-[11.5px] text-muted-foreground">{O_QUE_FAZ[a.jobname]}</p>
                )}
                <p className="mt-0.5 break-words rounded bg-red-500/10 px-2 py-1 text-[11.5px] text-red-700 dark:text-red-400">
                  {a.status_http ? `HTTP ${a.status_http} · ` : ""}
                  {a.erro_sql || a.resposta || "sem detalhe da resposta"}
                </p>
                {/* A CAUSA, quando a IA já leu esta falha.
                    O erro cru fica ACIMA e continua sendo a fonte: o diagnóstico
                    é leitura sobre ele, não substituto dele. Quem for consertar
                    precisa ver a resposta original — foi ela que provou, no dia
                    dos 13 crons sem token, que o problema era o cabeçalho e não
                    a chave da API. */}
                {diagnosticos[a.jobname] && (
                  <div className="mt-1 rounded border border-border bg-muted/40 px-2 py-1.5 text-[11.5px]">
                    <p className="flex items-center gap-1.5 font-medium">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      {diagnosticos[a.jobname].resumo}
                      {diagnosticos[a.jobname].ocorrencias > 1 && (
                        <span className="text-muted-foreground">
                          · {diagnosticos[a.jobname].ocorrencias}ª vez
                        </span>
                      )}
                    </p>
                    {diagnosticos[a.jobname].causa && (
                      <p className="mt-0.5 text-muted-foreground">
                        {diagnosticos[a.jobname].causa}
                      </p>
                    )}
                    {diagnosticos[a.jobname].o_que_fazer && (
                      <p className="mt-0.5">
                        <span className="font-medium">O que fazer: </span>
                        {diagnosticos[a.jobname].o_que_fazer}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------------- A esteira das notas ---------------- */}
      <div className="card-surface p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-[14px] font-semibold">Notas fiscais → Omie</h2>
          </div>
          <Link to="/governanca/notas-erp" className="text-[11.5px] text-muted-foreground underline-offset-2 hover:underline">
            ver a cobertura em Notas no ERP →
          </Link>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          A corrente que leva a nota do fornecedor até dentro do ERP. O número em cada etapa é o que
          está <strong className="font-medium text-foreground">esperando</strong> ali —
          {" "}fila parada com o cron rodando quer dizer trabalho chegando mais rápido do que sai.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {ESTEIRA_NOTAS.map((etapa, i) => {
            const filas = etapa.filas.map((c) => filaDe.get(c)).filter(Boolean) as {
              chave: string; rotulo: string; quantos: number;
            }[];
            const jobs = etapa.jobs.map((j) => porNome.get(j)).filter(Boolean) as Automacao[];
            const temFalha = jobs.some(falhou);
            return (
              <div
                key={etapa.chave}
                className={cn(
                  "relative rounded-lg border p-2.5",
                  temFalha ? "border-red-500/40 bg-red-500/5" : "border-border bg-muted/20",
                )}
              >
                {/* A seta entre etapas só existe onde há espaço para ela — em
                    coluna única a ordem já está nos números. */}
                {i < ESTEIRA_NOTAS.length - 1 && (
                  <ArrowRight className="absolute -right-[13px] top-3 hidden h-3.5 w-3.5 text-muted-foreground/50 xl:block" />
                )}
                <p className="text-[12px] font-semibold">{etapa.titulo}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{etapa.explica}</p>

                {filas.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {filas.map((f) => (
                      <div key={f.chave} className="flex items-baseline gap-1.5">
                        <span className={cn(
                          "text-[18px] font-semibold leading-none tabular-nums",
                          f.quantos > 0 ? "text-foreground" : "text-muted-foreground",
                        )}>
                          {f.quantos}
                        </span>
                        <span className="text-[11px] leading-tight text-muted-foreground">{f.rotulo}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">sem fila própria</p>
                )}

                <div className="mt-2 divide-y divide-border/60 border-t border-border/60 pt-1">
                  {jobs.length
                    ? jobs.map((a) => <Linha key={a.jobname} a={a} agora={agora} compacto />)
                    : <p className="py-1 text-[11px] text-muted-foreground">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------- Todas ---------------- */}
      <div className="card-surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <h2 className="mr-auto text-[14px] font-semibold">
            Todas as automações
            <span className="ml-2 text-[11.5px] font-normal text-muted-foreground">
              {autos.length} agendadas · {naFila} itens em fila
            </span>
          </h2>
          <div className="flex items-center gap-1">
            {([
              ["todas", "Todas"],
              ["esteira", "Esteira de notas"],
              ["problema", `Falhando${ruins.length ? ` (${ruins.length})` : ""}`],
            ] as [Corte, string][]).map(([c, rotulo]) => (
              <button
                key={c}
                onClick={() => setCorte(c)}
                className={cn(
                  "rounded border px-2 py-1 text-[11.5px]",
                  corte === c
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="nome, função, horário…"
              className="h-7 w-56 pl-7 text-[12px]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Automação</th>
                <th className="px-3 py-2 text-left font-semibold">Agenda (UTC)</th>
                <th className="px-3 py-2 text-right font-semibold">Próxima</th>
                <th className="px-3 py-2 text-left font-semibold">Última</th>
                <th className="px-3 py-2 text-right font-semibold">24h</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(({ a, quando }) => {
                const s = situacao(a);
                return (
                  <tr key={a.jobname} className="border-t border-border/60 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5"><Selo s={s} /></span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{a.jobname}</span>
                            {DA_ESTEIRA.has(a.jobname) && (
                              <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">
                                notas
                              </span>
                            )}
                            {!a.ativo && (
                              <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">
                                desligada
                              </span>
                            )}
                          </div>
                          <p className="text-[11.5px] text-muted-foreground">
                            {O_QUE_FAZ[a.jobname] ?? (a.alvo ? `chama ${a.alvo}` : "—")}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">{a.schedule}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{faltam(quando, agora)}</td>
                    <td className="px-3 py-2">
                      <span className="text-muted-foreground">{desde(a.ultimo_em, agora)}</span>
                      {(a.erro_sql || a.resposta) && (
                        <p
                          className={cn(
                            "max-w-[28rem] truncate text-[11px]",
                            s === "falha" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                          )}
                          title={a.erro_sql || a.resposta}
                        >
                          {a.status_http != null && `HTTP ${a.status_http} · `}
                          {a.erro_sql || a.resposta}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={cn(a.falhas_24h > 0 && "text-red-600 dark:text-red-400")}>
                        {a.falhas_24h}
                      </span>
                      <span className="text-muted-foreground">/{a.execucoes_24h}</span>
                    </td>
                  </tr>
                );
              })}
              {!lista.length && estado && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
                    nada com esse corte.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-1.5 border-t border-border p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {(["ok", "falha", "esperando", "sem_resposta", "sem_registro"] as Situacao[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <Selo s={s} /> {DIZERES[s]}
              </span>
            ))}
          </div>
          <p>
            O agendador do Supabase trabalha em <strong className="font-medium">UTC</strong> — a coluna
            "Agenda" é literal, e a contagem já está no seu fuso. Em "24h", o primeiro número são as
            falhas e o segundo, as execuções. Verde quer dizer que a <em>função</em> respondeu 2xx: o
            `job_run_details` do Postgres considera sucesso o simples disparo, mesmo quando a função
            devolve 500 — é por isso que "sem desfecho lido" tem cor própria em vez de virar verde.
          </p>
        </div>
      </div>
    </div>
  );
}
