import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownRight, ChevronDown, ChevronRight, Copy, ExternalLink,
  Loader2, Pause, Play, Plus, Radar as RadarIcon, RefreshCw, Sparkles, Trash2, TrendingDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { comValorExato } from "@/components/ValorExato";
import { CatDot } from "./components";
import { NovoAlvoDialog, type AlvoRow } from "./NovoAlvoDialog";
import { db, fmtBRL as fmtBRLStr, fmtData } from "./lib";
import { resumoDoAlvo, fonteLabel, textoWhats } from "@/lib/radarPrecos";
import { invalidarRadarAlertas } from "@/hooks/useRadarAlertas";

/* Valor compacto na tela, número cheio no hover — convenção do Hub.
   Onde precisa ser string mesmo (toast, title, template), use fmtBRLStr. */
const fmtBRL = (v: number | null | undefined) => comValorExato(v, fmtBRLStr(v));

interface Oferta {
  id: number; alvo_id: string; fonte: string; titulo: string; url: string;
  imagem_url: string | null; vendedor: string | null; condicao: string;
  preco: number; preco_min: number | null; frete_gratis: boolean;
  score: number; motivos: string[]; conferir: string[];
  visto_em: string; primeiro_visto_em: string;
}

interface Alerta {
  id: number; alvo_id: string; oferta_id: number; tipo: string; texto: string;
  preco: number; preco_alvo: number; status: string; created_at: string;
  oferta: Oferta | null;
  alvo: { titulo: string; preco_alvo: number; quantidade: number } | null;
}

interface PainelLinha {
  alvo: AlvoRow & { ultima_varredura: string | null; ultimo_erro: string | null };
  alertas_novos: number;
  ofertas_ativas: number;
  melhor: Oferta | null;
}

const TIPO_STYLE: Record<string, { label: string; cls: string; Icon: typeof TrendingDown }> = {
  minimo_historico: { label: "Menor preço já visto", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: TrendingDown },
  queda_forte:      { label: "Caiu forte",           cls: "bg-violet-50 text-violet-700 border-violet-200",   Icon: ArrowDownRight },
  alvo_batido:      { label: "Entrou no teto",       cls: "bg-amber-50 text-amber-700 border-amber-200",      Icon: Sparkles },
};

export default function Radar() {
  const [loading, setLoading] = useState(true);
  const [varrendo, setVarrendo] = useState<string | null>(null); // id do alvo ou "todos"
  const [painel, setPainel] = useState<PainelLinha[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ofertas, setOfertas] = useState<Record<string, Oferta[]>>({});
  const [editando, setEditando] = useState<AlvoRow | null>(null);
  const [dialogAberto, setDialogAberto] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, a] = await Promise.all([
      db.rpc("facilities_radar_painel"),
      db.from("facilities_radar_alertas")
        .select("*, oferta:facilities_radar_ofertas(*), alvo:facilities_radar_alvos(titulo,preco_alvo,quantidade)")
        .in("status", ["novo", "visto"])
        .order("created_at", { ascending: false })
        .limit(60),
    ]);
    setPainel((p.data as PainelLinha[]) ?? []);
    setAlertas((a.data as Alerta[]) ?? []);
    setLoading(false);
    invalidarRadarAlertas(); // o selo do menu segue o que esta tela acabou de ler
  }, []);
  useEffect(() => { load(); }, [load]);

  async function abrirAlvo(id: string) {
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    if (ofertas[id]) return;
    const { data } = await db.from("facilities_radar_ofertas")
      .select("*").eq("alvo_id", id).eq("ativo", true)
      .order("preco", { ascending: true }).limit(60);
    setOfertas((p) => ({ ...p, [id]: (data as Oferta[]) ?? [] }));
  }

  async function varrer(alvoId?: string) {
    setVarrendo(alvoId ?? "todos");
    try {
      const r = await invocar<any>(supabase.functions.invoke("facilities-radar", {
        body: alvoId ? { action: "varrer", alvo_id: alvoId } : { action: "varrer" },
      }));
      const partes = [`${r.ofertas} anúncio(s) dentro dos filtros`];
      if (r.alertas) partes.push(`${r.alertas} novo(s) achado(s)`);
      if (r.restante) partes.push(`${r.restante} alvo(s) ficaram para a próxima rodada`);
      toast.success(partes.join(" · "));

      /* Fonte que falhou não pode sumir calada: é assim que um radar "funciona"
         por semanas devolvendo zero. */
      const falhas: string[] = [];
      for (const pa of r.por_alvo ?? []) {
        for (const [fonte, txt] of Object.entries(pa.fontes ?? {})) {
          if (!/^\d+ anúncios$/.test(String(txt))) falhas.push(`${fonteLabel(fonte)}: ${txt}`);
        }
      }
      if (falhas.length) toast.warning([...new Set(falhas)].join("\n"), { duration: 10000 });

      setOfertas({});
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "A varredura falhou.");
    } finally { setVarrendo(null); }
  }

  async function virarCotacao(al: Alerta) {
    const linha = painel.find((p) => p.alvo.id === al.alvo_id);
    if (linha && !linha.alvo.solicitacao_id) {
      const ok = window.confirm(
        `Este alvo não está vinculado a nenhuma solicitação.\n\n` +
        `Criar a solicitação "${linha.alvo.titulo}" em "Em cotação" e lançar a cotação de ${fmtBRLStr(al.preco)} nela?`,
      );
      if (!ok) return;
    }
    const { data, error } = await db.rpc("facilities_radar_virar_cotacao", { p_alerta_id: al.id });
    if (error) { toast.error(error.message); return; }
    toast.success(data?.solicitacao_nova ? "Solicitação e cotação criadas." : "Cotação lançada na solicitação.");
    await load();
  }

  async function mudarStatus(id: number, status: string) {
    const alvo = alertas.find((a) => a.id === id);
    const { error } = await db.from("facilities_radar_alertas")
      .update({ status, visto_em: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setAlertas((p) => p.filter((a) => a.id !== id));
    invalidarRadarAlertas();
    // Só o alvo dono do alerta perde um do contador — e só se ele ainda era "novo".
    if (alvo?.status === "novo") {
      setPainel((p) => p.map((l) => (l.alvo.id === alvo.alvo_id
        ? { ...l, alertas_novos: Math.max(0, l.alertas_novos - 1) }
        : l)));
    }
  }

  function copiar(lista: Alerta[], tituloAlvo: string, precoAlvo: number) {
    const txt = textoWhats({
      alvo_titulo: tituloAlvo,
      preco_alvo: precoAlvo,
      ofertas: lista.filter((a) => a.oferta).map((a) => ({
        titulo: a.oferta!.titulo, preco: Number(a.preco), url: a.oferta!.url,
        fonte: fonteLabel(a.oferta!.fonte), vendedor: a.oferta!.vendedor,
        motivo: a.texto, conferir: a.oferta!.conferir ?? [],
      })),
    });
    navigator.clipboard.writeText(txt)
      .then(() => toast.success("Texto copiado — é só colar no WhatsApp."))
      .catch(() => toast.error("Não consegui copiar."));
  }

  async function alternarAtivo(l: PainelLinha) {
    const { error } = await db.from("facilities_radar_alvos")
      .update({ ativo: !l.alvo.ativo, updated_at: new Date().toISOString() }).eq("id", l.alvo.id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  async function excluir(l: PainelLinha) {
    if (!window.confirm(`Excluir o alvo "${l.alvo.titulo}"? O histórico de preço dele vai junto.`)) return;
    const { error } = await db.from("facilities_radar_alvos").delete().eq("id", l.alvo.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Alvo excluído.");
    load();
  }

  /* Alertas agrupados por alvo — é assim que a pessoa lê ("o que apareceu do
     notebook?"), e é assim que o texto do WhatsApp sai em uma mensagem só. */
  const porAlvo = useMemo(() => {
    const m = new Map<string, Alerta[]>();
    for (const a of alertas) {
      const arr = m.get(a.alvo_id) ?? [];
      arr.push(a);
      m.set(a.alvo_id, arr);
    }
    return m;
  }, [alertas]);

  const totalNovos = alertas.filter((a) => a.status === "novo").length;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Radar de preços</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
            Registre o equipamento e o quanto vale a pena pagar. O Hub fica olhando Mercado Livre e lojas de TI e avisa quando o preço
            aparecer — com o histórico do anúncio, para você saber se é promoção de verdade.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => varrer()} disabled={!!varrendo}>
            {varrendo === "todos" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Varrer agora
          </Button>
          <Button onClick={() => { setEditando(null); setDialogAberto(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Novo alvo
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-80 rounded-lg" />
      ) : (
        <>
          {/* ------------------------------------------------------ achados */}
          {alertas.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <RadarIcon className="h-4 w-4 text-primary" />
                <h2 className="text-[15px] font-semibold text-foreground">
                  Achados {totalNovos > 0 && <span className="text-primary">({totalNovos} novo{totalNovos > 1 ? "s" : ""})</span>}
                </h2>
              </div>

              {[...porAlvo.entries()].map(([alvoId, lista]) => {
                const linha = painel.find((p) => p.alvo.id === alvoId);
                const tituloAlvo = linha?.alvo.titulo ?? lista[0].alvo?.titulo ?? "Alvo";
                const teto = Number(linha?.alvo.preco_alvo ?? lista[0].preco_alvo);
                return (
                  <div key={alvoId} className="card-surface overflow-hidden">
                    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2">
                      <div className="flex items-center gap-2">
                        <CatDot cat={linha?.alvo.categoria} />
                        <span className="text-[13px] font-medium text-foreground">{tituloAlvo}</span>
                        <span className="text-[11.5px] text-muted-foreground">teto {fmtBRL(teto)}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => copiar(lista, tituloAlvo, teto)}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar p/ WhatsApp
                      </Button>
                    </div>

                    <div className="divide-y divide-border/60">
                      {lista.map((al) => {
                        const est = TIPO_STYLE[al.tipo] ?? TIPO_STYLE.alvo_batido;
                        const o = al.oferta;
                        return (
                          <div key={al.id} className="flex gap-3 p-4">
                            {o?.imagem_url ? (
                              <img src={o.imagem_url} alt="" className="h-16 w-16 shrink-0 rounded-md border border-border object-contain" />
                            ) : (
                              <div className="h-16 w-16 shrink-0 rounded-md border border-dashed border-border" />
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", est.cls)}>
                                  <est.Icon className="h-3 w-3" /> {est.label}
                                </span>
                                {al.status === "novo" && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                                <span className="text-[11.5px] text-muted-foreground">{fmtData(al.created_at)}</span>
                              </div>

                              <div className="mt-1 truncate text-[13px] font-medium text-foreground" title={o?.titulo}>
                                {o?.titulo ?? "—"}
                              </div>
                              <div className="text-[11.5px] text-muted-foreground">
                                {fonteLabel(o?.fonte)}{o?.vendedor ? ` · ${o.vendedor}` : ""}
                                {o?.frete_gratis ? " · frete grátis" : ""}
                                {o?.condicao && o.condicao !== "novo" ? ` · ${o.condicao}` : ""}
                              </div>
                              <div className="mt-1 text-[12px] text-muted-foreground">{al.texto}</div>

                              {!!o?.conferir?.length && (
                                <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <span>O anúncio não informa {o.conferir.join(", ")} — confira no link antes de comprar.</span>
                                </div>
                              )}
                            </div>

                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              <div className="num text-[18px] font-semibold text-foreground">{fmtBRL(Number(al.preco))}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {Math.round(((Number(al.preco_alvo) - Number(al.preco)) / Number(al.preco_alvo)) * 100)}% abaixo do teto
                              </div>
                              <div className="mt-1 flex items-center gap-1">
                                {o?.url && (
                                  <a href={o.url} target="_blank" rel="noreferrer">
                                    <Button size="sm" variant="ghost" className="ghost-icone" title="Abrir o anúncio">
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </Button>
                                  </a>
                                )}
                                <Button size="sm" variant="outline" onClick={() => virarCotacao(al)}>Virar cotação</Button>
                                <Button size="sm" variant="ghost" onClick={() => mudarStatus(al.id, "arquivado")}>Dispensar</Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* -------------------------------------------------------- alvos */}
          <div className="flex items-center gap-2 pt-1">
            <h2 className="text-[15px] font-semibold text-foreground">O que o radar está vigiando</h2>
            <span className="text-[12px] text-muted-foreground">{painel.length}</span>
          </div>

          {painel.length === 0 ? (
            <div className="card-surface py-16 text-center">
              <RadarIcon className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <div className="mt-3 text-[13px] text-muted-foreground">
                Nenhum alvo ainda. Crie o primeiro e escreva o pedido em português mesmo — o Hub traduz em filtros.
              </div>
              <Button className="mt-4" onClick={() => { setEditando(null); setDialogAberto(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Novo alvo
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {painel.map((l) => {
                const expandido = aberto === l.alvo.id;
                const melhor = l.melhor;
                const folga = melhor ? (Number(l.alvo.preco_alvo) - Number(melhor.preco)) / Number(l.alvo.preco_alvo) : null;
                return (
                  <div key={l.alvo.id} className={cn("card-surface", !l.alvo.ativo && "opacity-60")}>
                    <div className="flex flex-wrap items-center gap-3 p-4">
                      <button type="button" onClick={() => abrirAlvo(l.alvo.id)} className="ghost-icone text-muted-foreground">
                        {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>

                      <div className="min-w-[220px] flex-1">
                        <div className="flex items-center gap-2">
                          <CatDot cat={l.alvo.categoria} />
                          <span className="text-[13.5px] font-medium text-foreground">{l.alvo.titulo}</span>
                          {l.alertas_novos > 0 && (
                            <span className="num rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                              {l.alertas_novos}
                            </span>
                          )}
                          {!l.alvo.ativo && <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">pausado</span>}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">{resumoDoAlvo(l.alvo.specs)}</div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Teto</div>
                        <div className="num text-[13px] font-medium text-foreground">{fmtBRL(Number(l.alvo.preco_alvo))}</div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Melhor agora</div>
                        {melhor ? (
                          <div className="num text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
                            {fmtBRL(Number(melhor.preco))}
                            {folga != null && <span className="ml-1 text-[11px] font-normal text-muted-foreground">−{Math.round(folga * 100)}%</span>}
                          </div>
                        ) : (
                          <div className="text-[12px] text-muted-foreground">nada dentro dos filtros</div>
                        )}
                      </div>

                      <div className="text-right text-[11px] text-muted-foreground">
                        <div>{l.ofertas_ativas} anúncio(s)</div>
                        <div>{l.alvo.ultima_varredura ? fmtData(l.alvo.ultima_varredura) : "nunca varrido"}</div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="ghost-icone" title="Varrer só este alvo"
                          onClick={() => varrer(l.alvo.id)} disabled={!!varrendo}>
                          {varrendo === l.alvo.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="ghost-icone" title={l.alvo.ativo ? "Pausar" : "Retomar"}
                          onClick={() => alternarAtivo(l)}>
                          {l.alvo.ativo ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditando(l.alvo); setDialogAberto(true); }}>Editar</Button>
                        <Button size="sm" variant="ghost" className="ghost-icone text-muted-foreground" title="Excluir"
                          onClick={() => excluir(l)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {l.alvo.ultimo_erro && (
                      <div className="flex items-start gap-1.5 border-t border-border bg-amber-50/60 px-4 py-2 text-[11.5px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>Última varredura com problema — {l.alvo.ultimo_erro}</span>
                      </div>
                    )}

                    {expandido && (
                      <div className="border-t border-border">
                        {!ofertas[l.alvo.id] ? (
                          <div className="p-4"><Skeleton className="h-24 rounded" /></div>
                        ) : ofertas[l.alvo.id].length === 0 ? (
                          <div className="p-6 text-center text-[12.5px] text-muted-foreground">
                            Nenhum anúncio passou nos filtros na última varredura. Se isso persistir, o pedido pode estar exigindo demais —
                            edite e afrouxe uma spec.
                          </div>
                        ) : (
                          <div className="max-h-[420px] overflow-y-auto">
                            <table className="w-full border-collapse">
                              <thead className="sticky top-0 bg-muted/50">
                                <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                                  <th className="px-4 py-2 font-semibold">Anúncio</th>
                                  <th className="px-3 py-2 font-semibold">Onde</th>
                                  <th className="px-3 py-2 text-right font-semibold">Mín. visto</th>
                                  <th className="px-3 py-2 text-right font-semibold">Preço</th>
                                  <th className="px-3 py-2" />
                                </tr>
                              </thead>
                              <tbody>
                                {ofertas[l.alvo.id].map((o) => (
                                  <tr key={o.id} className="border-t border-border/60">
                                    <td className="px-4 py-2">
                                      <div className="max-w-[420px] truncate text-[12.5px] text-foreground" title={o.titulo}>{o.titulo}</div>
                                      <div className="text-[11px] text-muted-foreground">
                                        {o.motivos?.slice(0, 3).join(" · ") || "—"}
                                        {!!o.conferir?.length && (
                                          <span className="text-amber-700 dark:text-amber-400"> · conferir: {o.conferir.join(", ")}</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-[11.5px] text-muted-foreground">
                                      {fonteLabel(o.fonte)}
                                      {o.vendedor && <div className="max-w-[140px] truncate" title={o.vendedor}>{o.vendedor}</div>}
                                    </td>
                                    <td className="num px-3 py-2 text-right text-[12px] text-muted-foreground">
                                      {o.preco_min != null ? fmtBRL(Number(o.preco_min)) : "—"}
                                    </td>
                                    <td className="num px-3 py-2 text-right text-[13px] font-semibold text-foreground">
                                      {fmtBRL(Number(o.preco))}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <a href={o.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <NovoAlvoDialog
        alvo={editando}
        open={dialogAberto}
        onOpenChange={setDialogAberto}
        onSaved={() => { setOfertas({}); load(); }}
      />
    </div>
  );
}
