/* /governanca/vigilancia — o que a internet diz sobre quem transaciona conosco.
 *
 * DUAS PERGUNTAS, UM MOTOR. De um lado o fornecedor: a página de preços mexeu?
 * Do outro o cliente inadimplente: ele ainda está aberto? São perguntas de áreas
 * diferentes do Hub, mas têm a mesma natureza — informação pública, que muda sem
 * avisar, que ninguém tem o hábito de reler, e que custa crédito de raspagem.
 * Ficam na mesma tela porque dividem o mesmo pote, e é aqui que se vê o pote.
 *
 * O RATEIO NO TOPO NÃO É ENFEITE. O plano de raspagem é mensal e compartilhado
 * por seis consumidores; quando ele acaba, nada quebra com estrondo — a
 * varredura devolve zero e a tela diz "nada mudou", que é indistinguível de um
 * mercado parado. É o mesmo motivo pelo qual o saldo já aparecia no Facilities,
 * agora aberto por quem gasta.
 *
 * O QUE ESTA TELA NÃO FAZ: decidir. O aviso de mudança de preço não vira tarefa
 * sozinho, e o sinal de que o cliente fechou não cancela cobrança nenhuma. Nome
 * de restaurante é homônimo com frequência, e página de marketing muda sozinha —
 * as duas listas são "vá olhar", não "está resolvido".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { invocar } from "@/lib/erroEdge";
import {
  AlertTriangle, CheckCircle2, ExternalLink, Eye, Gauge, Loader2, RefreshCw,
  Store, TrendingUp,
} from "lucide-react";

/* ------------------------------------------------------------------ tipos */

interface Quinhao {
  consumidor: string; rotulo: string; para_que: string | null; ativo: boolean;
  teto_mes: number; piso_saldo: number; gasto_ciclo: number; resta_ciclo: number;
}
interface Pagina {
  id: number; nome: string; url: string; categoria: string | null; fornecedor: string | null;
  ativo: boolean; o_que_olhar: string | null; ultima_leitura: string | null; ultimo_status: string | null;
}
interface Mudanca {
  id: number; pagina_id: number; detectado_em: string; resumo: string | null;
  natureza: string; diff: string | null; visto_em: string | null;
}
interface Sinal {
  id: number; cliente_ref: string; cliente_nome: string | null; documento: string | null;
  procurado_em: string; sinal: string; resumo: string | null; evidencia: string[] | null;
  valor_aberto: number | null; dias_atraso: number | null;
  conferido_em: string | null; desfecho: string | null;
}

const brl = (n: number | null) =>
  n == null ? "—" : `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quando = (s: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";

/* O status cru da API vira frase. `same` e `new` são sucesso — e "new" é o
   primeiro retrato de uma página, que por definição não tem com o que comparar:
   dizer "novo" na tela faria parecer que algo mudou. */
function frasePagina(p: Pagina): { texto: string; tom: "ok" | "aviso" | "erro" } {
  const s = p.ultimo_status;
  if (!s) return { texto: "ainda não foi lida", tom: "aviso" };
  if (s === "same" || s === "lida") return { texto: "sem mudança", tom: "ok" };
  if (s === "new") return { texto: "primeiro retrato guardado", tom: "ok" };
  if (s === "changed") return { texto: "mudou na última leitura", tom: "aviso" };
  return { texto: s, tom: "erro" };
}

const SINAL_ROTULO: Record<string, { texto: string; tom: "erro" | "aviso" | "ok" }> = {
  fechado: { texto: "diz que fechou", tom: "erro" },
  indicio: { texto: "indício de que parou", tom: "aviso" },
  homonimo: { texto: "achou outra empresa", tom: "ok" },
  nada: { texto: "nada sugere encerramento", tom: "ok" },
};

/* ------------------------------------------------------------------ tela */

export default function Vigilancia() {
  const [aba, setAba] = useState<"fornecedores" | "clientes">("fornecedores");
  const [quinhoes, setQuinhoes] = useState<Quinhao[]>([]);
  const [saldo, setSaldo] = useState<{ restantes: number | null; plano: number | null } | null>(null);
  const [paginas, setPaginas] = useState<Pagina[]>([]);
  const [mudancas, setMudancas] = useState<Mudanca[]>([]);
  const [sinais, setSinais] = useState<Sinal[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [rodando, setRodando] = useState<"paginas" | "clientes" | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [q, pg, md, sn] = await Promise.all([
      /* Sem `p_desde`: a tela não sabe a data de renovação do plano (quem sabe é
         quem acabou de ler o saldo, do lado do servidor), e a função cai no mês
         corrente. Erra por alguns dias no mês em que o ciclo não começa no dia
         1º — e sempre para o lado de contar gasto a mais, que é o lado seguro
         de errar num painel de teto. */
      supabase.rpc("firecrawl_orcamento_status"),
      supabase.from("vigilancia_paginas").select("*").order("nome"),
      supabase.from("vigilancia_mudancas").select("*").order("detectado_em", { ascending: false }).limit(50),
      supabase.from("churn_sinais").select("*").order("procurado_em", { ascending: false }).limit(100),
    ]);
    setQuinhoes((q.data as Quinhao[]) ?? []);
    setPaginas((pg.data as Pagina[]) ?? []);
    setMudancas((md.data as Mudanca[]) ?? []);
    setSinais((sn.data as Sinal[]) ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /* O saldo vem por fora do carregamento principal: é uma chamada externa, mais
     lenta que as quatro do banco juntas, e não pode segurar a tela. Falhar aqui
     deixa o rateio sem o "de quanto" e mantém o resto de pé. */
  useEffect(() => {
    let vivo = true;
    supabase.functions.invoke("facilities-radar", { body: { action: "saldo" } })
      .then(({ data }) => { if (vivo && data) setSaldo(data as any); })
      .catch(() => { /* o rateio ainda diz o gasto de cada um; só falta o total */ });
    return () => { vivo = false; };
  }, []);

  const naoVistas = useMemo(() => mudancas.filter((m) => !m.visto_em), [mudancas]);
  const paraConferir = useMemo(
    () => sinais.filter((s) => !s.conferido_em && (s.sinal === "fechado" || s.sinal === "indicio")),
    [sinais],
  );
  const porPagina = useMemo(() => new Map(paginas.map((p) => [p.id, p])), [paginas]);

  const rodar = async (qual: "paginas" | "clientes") => {
    setRodando(qual);
    try {
      const r = await invocar<any>(
        supabase.functions.invoke(
          qual === "paginas" ? "vigilancia-mudancas" : "churn-sinal-externo",
          { body: { action: "varrer" } },
        ),
      );
      toast[r?.freado ? "warning" : "success"](r?.mensagem ?? "Rodada concluída.");
      await carregar();
    } catch (e: any) {
      toast.error(e?.message ?? "Não deu para rodar agora.");
    } finally {
      setRodando(null);
    }
  };

  const marcarVista = async (m: Mudanca) => {
    const { error } = await supabase.from("vigilancia_mudancas")
      .update({ visto_em: new Date().toISOString() }).eq("id", m.id);
    if (error) { toast.error(error.message); return; }
    setMudancas((xs) => xs.map((x) => (x.id === m.id ? { ...x, visto_em: new Date().toISOString() } : x)));
  };

  const decidir = async (s: Sinal, desfecho: string) => {
    const { error } = await supabase.from("churn_sinais")
      .update({ desfecho, conferido_em: new Date().toISOString() }).eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    setSinais((xs) => xs.map((x) => (x.id === s.id ? { ...x, desfecho, conferido_em: new Date().toISOString() } : x)));
    toast.success(desfecho === "fechado_mesmo" ? "Marcado como encerrado." : "Marcado como aberto.");
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------ o rateio */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Créditos de raspagem do ciclo</h2>
          </div>
          {saldo?.restantes != null && (
            <span className="text-xs text-muted-foreground">
              <span className="num">{saldo.restantes.toLocaleString("pt-BR")}</span>
              {saldo.plano ? <span className="text-muted-foreground/70">/{saldo.plano.toLocaleString("pt-BR")}</span> : null}
              {" "}restantes no plano
            </span>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {quinhoes.map((q) => {
            const pct = q.teto_mes ? Math.min(100, Math.round((q.gasto_ciclo / q.teto_mes) * 100)) : 0;
            return (
              <div key={q.consumidor} className="rounded-md border border-border/60 p-2.5" title={q.para_que ?? undefined}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("text-xs font-medium", !q.ativo && "text-muted-foreground line-through")}>{q.rotulo}</span>
                  <span className="num text-[11px] text-muted-foreground">
                    {q.gasto_ciclo.toLocaleString("pt-BR")}/{q.teto_mes.toLocaleString("pt-BR")}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-primary")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Cada consumidor tem um teto do ciclo e um piso de saldo. O piso é a ordem em que eles param
          quando o crédito aperta: a conferência do radar de preços é a última a ceder, a busca de sinal
          de churn é a primeira.
        </p>
      </section>

      {/* ------------------------------------------------------- as abas */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          ["fornecedores", "Fornecedores", naoVistas.length],
          ["clientes", "Clientes", paraConferir.length],
        ] as const).map(([id, rotulo, n]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={cn(
              "relative px-3 py-2 text-sm transition-colors",
              aba === id ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {rotulo}
            {n > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{n}</span>
            )}
            {aba === id && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
          </button>
        ))}
        <div className="ml-auto pb-1.5">
          <button
            onClick={() => rodar(aba === "fornecedores" ? "paginas" : "clientes")}
            disabled={!!rodando}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {rodando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {aba === "fornecedores" ? "Ler as páginas agora" : "Procurar sinais agora"}
          </button>
        </div>
      </div>

      {carregando && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> carregando…
        </div>
      )}

      {/* ----------------------------------------------- aba fornecedores */}
      {!carregando && aba === "fornecedores" && (
        <div className="space-y-6">
          <section>
            <h3 className="mb-2 text-sm font-medium">O que mudou</h3>
            {mudancas.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Nenhuma mudança detectada ainda. As páginas são lidas uma vez por dia; a primeira leitura
                só guarda o retrato, e a comparação começa na segunda.
              </p>
            ) : (
              <ul className="space-y-2">
                {mudancas.map((m) => {
                  const p = porPagina.get(m.pagina_id);
                  return (
                    <li
                      key={m.id}
                      className={cn(
                        "rounded-lg border border-border bg-card p-3",
                        m.visto_em && "opacity-60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{p?.nome ?? "página removida"}</span>
                            {m.natureza === "preco" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                <TrendingUp className="h-3 w-3" /> mexeu em valor
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground">{quando(m.detectado_em)}</span>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {m.resumo || "mudança detectada — abra o diff para ver o que foi."}
                          </p>
                          {p?.categoria && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground/80">cai em {p.categoria}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {p?.url && (
                            <a
                              href={p.url} target="_blank" rel="noreferrer"
                              className="ghost-icone rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                              title="abrir a página"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <button
                            onClick={() => setAberto(aberto === m.id ? null : m.id)}
                            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                          >
                            {aberto === m.id ? "fechar" : "ver o diff"}
                          </button>
                          {!m.visto_em && (
                            <button
                              onClick={() => marcarVista(m)}
                              className="ghost-icone rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                              title="marcar como visto"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {aberto === m.id && (
                        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">
                          {(m.diff ?? "").split("\n").map((l, i) => (
                            <div
                              key={i}
                              className={cn(
                                l.startsWith("+") && !l.startsWith("+++") && "text-emerald-700 dark:text-emerald-400",
                                l.startsWith("-") && !l.startsWith("---") && "text-destructive",
                              )}
                            >
                              {l || " "}
                            </div>
                          ))}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium">Páginas vigiadas</h3>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Página</th>
                    <th className="px-3 py-2 text-left font-medium">Categoria</th>
                    <th className="px-3 py-2 text-left font-medium">Última leitura</th>
                    <th className="px-3 py-2 text-left font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {paginas.map((p) => {
                    const f = frasePagina(p);
                    return (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline" title={p.o_que_olhar ?? undefined}>
                            {p.nome}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{p.categoria ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{quando(p.ultima_leitura)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "text-xs",
                              f.tom === "erro" ? "text-destructive" : f.tom === "aviso" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                            )}
                            title={p.ultimo_status ?? undefined}
                          >
                            {f.tom === "erro" && <AlertTriangle className="mr-1 inline h-3 w-3" />}
                            {f.texto.length > 70 ? `${f.texto.slice(0, 70)}…` : f.texto}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Página que não abre aparece aqui em vermelho de propósito: silêncio de uma URL quebrada é
              indistinguível de "nada mudou", e esse é o jeito mais fácil de a vigilância parecer viva
              estando morta.
            </p>
          </section>
        </div>
      )}

      {/* --------------------------------------------------- aba clientes */}
      {!carregando && aba === "clientes" && (
        <section className="space-y-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Clientes com cobrança vencida há mais de 30 dias, procurados uma vez por trimestre. O que
            aparece aqui é <strong>indício público</strong>, não veredito: nome de restaurante se repete
            muito, e a busca pode ter achado outro estabelecimento. Confira antes de mexer na cobrança.
          </p>
          {sinais.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhuma consulta feita ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {sinais.map((s) => {
                const r = SINAL_ROTULO[s.sinal] ?? SINAL_ROTULO.nada;
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "rounded-lg border border-border bg-card p-3",
                      s.conferido_em && "opacity-60",
                      s.sinal === "fechado" && !s.conferido_em && "border-destructive/40",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Store className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium">{s.cliente_nome ?? s.cliente_ref}</span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              r.tom === "erro" ? "bg-destructive/10 text-destructive"
                                : r.tom === "aviso" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {r.texto}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{s.resumo || "—"}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                          {brl(s.valor_aberto)} em aberto · {s.dias_atraso ?? "?"} dias de atraso · consultado {quando(s.procurado_em)}
                        </p>
                        {!!s.evidencia?.length && (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {s.evidencia.slice(0, 3).map((l) => (
                              <a
                                key={l} href={l} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                {(() => { try { return new URL(l).hostname.replace(/^www\./, ""); } catch { return l.slice(0, 30); } })()}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      {!s.conferido_em && (s.sinal === "fechado" || s.sinal === "indicio") && (
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() => decidir(s, "fechado_mesmo")}
                            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                          >
                            fechou mesmo
                          </button>
                          <button
                            onClick={() => decidir(s, "segue_aberto")}
                            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                          >
                            segue aberto
                          </button>
                        </div>
                      )}
                      {s.conferido_em && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {s.desfecho === "fechado_mesmo" ? "confirmado encerrado" : "conferido: segue aberto"}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
