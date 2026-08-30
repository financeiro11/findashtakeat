import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownRight, ChevronDown, ChevronRight, Copy, ExternalLink,
  Loader2, PackageCheck, PackageX, Pause, PiggyBank, Play, Plus, Radar as RadarIcon, RefreshCw, Sparkles, Star, Trash2, TrendingDown,
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
import { resumoDoAlvo, fonteLabel, textoFrete, textoNota, textoWhats } from "@/lib/radarPrecos";
import { invalidarRadarAlertas } from "@/hooks/useRadarAlertas";
import { ProximaVarredura } from "./ProximaVarredura";
import { SaldoRaspagem } from "./SaldoRaspagem";
import { HistoricoPreco } from "./HistoricoPreco";

/* Valor compacto na tela, número cheio no hover — convenção do Hub.
   Onde precisa ser string mesmo (toast, title, template), use fmtBRLStr. */
const fmtBRL = (v: number | null | undefined) => comValorExato(v, fmtBRLStr(v));

interface Oferta {
  id: number; alvo_id: string; fonte: string; titulo: string; url: string;
  imagem_url: string | null; vendedor: string | null; condicao: string;
  preco: number; preco_total: number | null; preco_min: number | null;
  frete_gratis: boolean; frete_valor: number | null; frete_texto: string | null;
  disponivel: boolean | null; confirmado_em: string | null;
  /* Compra recorrente: o preço na unidade do alvo, e o pacote de onde ele saiu.
     Null em equipamento — e é o `??` com `preco_total` que faz as duas
     naturezas conviverem na mesma linha da tela. */
  preco_unitario: number | null;
  embalagem_unidade: string | null;
  embalagem_texto: string | null;
  avaliacao: number | null; avaliacoes: number | null;
  score: number; motivos: string[]; conferir: string[];
  /* O que a conferência leu na PÁGINA do anúncio, além de estoque e frete.
     `ficha` é transcrição (e é dela que o `lerSpecs` fecha as pendências);
     `porque_barato` só vem quando o preço estava materialmente abaixo dos
     irmãos, porque a pergunta só foi feita nesse caso. */
  ficha: string | null;
  reclamacoes: string | null;
  porque_barato: string | null;
  visto_em: string; primeiro_visto_em: string;
}

interface Alerta {
  id: number; alvo_id: string; oferta_id: number; tipo: string; texto: string;
  preco: number; preco_total: number | null; frete_valor: number | null;
  economia: number | null; preco_alvo: number; status: string; created_at: string;
  oferta: Oferta | null;
  alvo: { titulo: string; preco_alvo: number; quantidade: number } | null;
}

interface PainelLinha {
  alvo: AlvoRow & { ultima_varredura: string | null; ultimo_erro: string | null };
  alertas_novos: number;
  ofertas_ativas: number;
  melhor: Oferta | null;
  economia_aberta: number;
  economia_realizada: number;
  /** Dias distintos com preço medido. Zero = a curva ainda é um ponto solto. */
  pontos_historico: number;
  /** Menor total entre os que NÃO couberam no teto. Null quando algum coube. */
  menor_fora_do_teto: number | null;
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
      /* Esgotado apurado não entra na lista. `not.is.false` e não `neq`: o
         estoque desconhecido é `null` — o caso normal de quem ainda não foi
         conferido —, e `neq(false)` derrubaria esses junto. */
      .not("disponivel", "is", false)
      // Pelo TOTAL: o mais barato de verdade, não o de etiqueta menor.
      .order("preco_total", { ascending: true }).limit(60);
    setOfertas((p) => ({ ...p, [id]: (data as Oferta[]) ?? [] }));
  }

  /* A metade que confere. Vive separada porque roda nos DOIS caminhos: depois
     de uma varredura normal e também quando a varredura foi freada por falta de
     crédito — é justamente aí que ela mais importa, porque é o que impede a tela
     de ficar exibindo achado que já morreu. */
  async function conferir(alvoId?: string): Promise<number> {
    try {
      const c = await invocar<any>(supabase.functions.invoke("facilities-radar", {
        body: alvoId ? { action: "confirmar", alvo_id: alvoId } : { action: "confirmar" },
      }));
      if (c.desfechos?.esgotado) {
        toast.info(`${c.desfechos.esgotado} achado(s) já estavam esgotados ao conferir — por isso não aparecem.`);
      }
      if (c.sumiram) {
        toast.info(`${c.sumiram} achado(s) saíram da lista: o produto acabou depois de aparecer aqui.`);
      }
      if (c.desfechos?.["subiu de preço"]) {
        toast.info(`${c.desfechos["subiu de preço"]} achado(s) saíram da lista: o preço subiu acima do teto.`);
      }
      return c.confirmados ?? 0;
    } catch {
      return 0; // a confirmação sozinha não derruba o resultado da varredura
    }
  }

  async function varrer(alvoId?: string) {
    setVarrendo(alvoId ?? "todos");
    try {
      const r = await invocar<any>(supabase.functions.invoke("facilities-radar", {
        body: alvoId ? { action: "varrer", alvo_id: alvoId } : { action: "varrer" },
      }));

      /* O FREIO DE CRÉDITO NÃO PODE PARECER "NÃO ACHEI NADA". São diagnósticos
         opostos: um diz que o mercado não tem preço bom, o outro que o radar
         nem olhou. Sem esta saída, a rodada freada devolveria "0 anúncio dentro
         dos filtros" e ninguém entenderia por que o teto nunca bate.
         A conferência roda mesmo assim — é a metade barata e a que sustenta a
         verdade do que já está na tela. */
      if (r.freado) {
        toast.warning(r.mensagem ?? "Varredura suspensa por falta de crédito de raspagem.", { duration: 12000 });
        await conferir(alvoId);
        setOfertas({});
        await load();
        return;
      }

      /* O clique manual encadeia as DUAS metades. No cron elas são separadas
         (varrer 08:45, confirmar 09:15) para caber no orçamento de relógio; aqui
         a pessoa está esperando, e um achado que só aparece meia hora depois
         seria indistinguível de "não achei nada".
         E CHAMA A CONFIRMAÇÃO MESMO SEM ACHADO NOVO: é ela que reconfere o que
         já está na tela, e é justamente quando a varredura não traz nada que a
         pessoa fica olhando para os avisos antigos. Sem fila, a chamada custa
         duas consultas e volta na hora — não é rodada de raspagem. */
      const confirmados = await conferir(alvoId);

      const partes = [`${r.ofertas} anúncio(s) dentro dos filtros`];
      if (confirmados) partes.push(`${confirmados} confirmado(s) com estoque`);
      else if (r.alertas) partes.push(`${r.alertas} em conferência`);
      if (r.restante) partes.push(`${r.restante} alvo(s) ficaram para a próxima rodada`);
      toast.success(partes.join(" · "));

      /* Fonte que falhou não pode sumir calada: é assim que um radar "funciona"
         por semanas devolvendo zero. */
      const falhas: string[] = [];
      for (const pa of r.por_alvo ?? []) {
        for (const [fonte, txt] of Object.entries(pa.fontes ?? {})) {
          const s = String(txt);
          // "fora do rodízio" é desenho, não falha — avisar disso ensinaria a
          // pessoa a ignorar o aviso amarelo, que é onde moram os problemas reais.
          if (/^\d+ anúncios/.test(s) || s.startsWith("fora do rodízio")) continue;
          falhas.push(`${fonteLabel(fonte)}: ${s}`);
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

  function copiar(lista: Alerta[], tituloAlvo: string, precoAlvo: number, quantidade = 1) {
    const txt = textoWhats({
      alvo_titulo: tituloAlvo,
      preco_alvo: precoAlvo,
      quantidade,
      ofertas: lista.filter((a) => a.oferta).map((a) => ({
        // `preco` aqui é o do PRODUTO; o texto soma o frete e mostra a conta.
        titulo: a.oferta!.titulo, preco: Number(a.oferta!.preco), url: a.oferta!.url,
        fonte: fonteLabel(a.oferta!.fonte), vendedor: a.oferta!.vendedor,
        motivo: a.texto, conferir: a.oferta!.conferir ?? [],
        frete_valor: a.frete_valor, frete_texto: a.oferta!.frete_texto,
      })),
    });
    navigator.clipboard.writeText(txt)
      .then(() => toast.success("Texto copiado — é só colar no WhatsApp."))
      .catch(() => toast.error("Não consegui copiar."));
  }

  /* Favoritar não é só fixar no topo: o alvo passa à frente na FILA da
     varredura (a Edge Function ordena por favorito primeiro). Equipamento que a
     empresa compra sempre não pode ser o que sobra quando o relógio aperta. */
  async function alternarFavorito(l: PainelLinha) {
    const novo = !l.alvo.favorito;
    setPainel((p) => p.map((x) => (x.alvo.id === l.alvo.id ? { ...x, alvo: { ...x.alvo, favorito: novo } } : x)));
    const { error } = await db.from("facilities_radar_alvos")
      .update({ favorito: novo, updated_at: new Date().toISOString() }).eq("id", l.alvo.id);
    if (error) { toast.error(error.message); load(); return; }
    toast.success(novo ? "Marcado como padrão da casa — entra primeiro na varredura." : "Deixou de ser padrão.");
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
  /* SEMPRE DO MAIS BARATO PARA O MAIS CARO — dentro de cada alvo e entre os
     alvos. É por preço que se decide a compra, então é a ordem em que a lista
     tem de chegar; ordenar por data faria a pessoa ler tudo para achar o que
     interessa. Compara pelo TOTAL (com frete), não pela etiqueta. */
  const porAlvo = useMemo(() => {
    const m = new Map<string, Alerta[]>();
    for (const a of alertas) {
      const arr = m.get(a.alvo_id) ?? [];
      arr.push(a);
      m.set(a.alvo_id, arr);
    }
    const total = (a: Alerta) => Number(a.preco_total ?? a.preco);
    for (const arr of m.values()) arr.sort((x, y) => total(x) - total(y));
    // Os grupos também: o alvo com o achado mais barato aparece primeiro.
    return new Map([...m.entries()].sort((a, b) => total(a[1][0]) - total(b[1][0])));
  }, [alertas]);

  const totalNovos = alertas.filter((a) => a.status === "novo").length;

  /* A ECONOMIA VEM EM DOIS NÚMEROS, e separá-los é o ponto.
     `realizada` é o que já virou cotação — dinheiro que o radar de fato poupou,
     e o único que serve para prestar contas. `aberta` é o que está na mesa
     agora, esperando alguém decidir. Somar os dois num "total economizado"
     inflaria o resultado com achados que ninguém comprou, e seria justamente o
     número que alguém levaria para uma reunião. */
  const economia = useMemo(() => painel.reduce(
    (a, l) => ({
      realizada: a.realizada + Number(l.economia_realizada ?? 0),
      aberta: a.aberta + Number(l.economia_aberta ?? 0),
    }),
    { realizada: 0, aberta: 0 },
  ), [painel]);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Radar de preços</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
            Registre o equipamento e o quanto vale a pena pagar. O Hub fica olhando as lojas e os comparadores e avisa quando o preço
            aparecer — com o histórico, para você saber se é promoção de verdade.
          </p>
          {/* Quando o radar age, e com quanto ele ainda pode agir. As duas
              respostas moram na mesma linha porque é a mesma pergunta: dá para
              contar com ele hoje? */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProximaVarredura />
            <SaldoRaspagem />
          </div>
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
          {/* ----------------------------------------------------- economia */}
          {(economia.realizada > 0 || economia.aberta > 0) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="card-surface border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  <PiggyBank className="h-3.5 w-3.5" /> Economizado
                </div>
                <div className="num mt-1 text-[30px] font-semibold leading-none text-emerald-700 dark:text-emerald-400">
                  {fmtBRL(economia.realizada)}
                </div>
                <div className="mt-1.5 text-[11.5px] text-muted-foreground">
                  Diferença entre o teto e o que foi pago, nos achados que viraram cotação.
                </div>
              </div>

              <div className="card-surface p-4">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" /> Na mesa agora
                </div>
                <div className="num mt-1 text-[30px] font-semibold leading-none text-foreground">
                  {fmtBRL(economia.aberta)}
                </div>
                <div className="mt-1.5 text-[11.5px] text-muted-foreground">
                  O que dá para economizar nos {alertas.length} achado(s) esperando decisão.
                </div>
              </div>

              <div className="card-surface p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Como a conta é feita</div>
                <div className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  Economia é <span className="font-medium text-foreground">teto − (produto + frete)</span>, vezes a quantidade. O frete
                  entra porque é gasto igual. Onde a loja só calcula frete depois do CEP, a conta sai só com o produto e o card avisa.
                </div>
              </div>
            </div>
          )}

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
                      <Button size="sm" variant="ghost" onClick={() => copiar(lista, tituloAlvo, teto, linha?.alvo.quantidade ?? 1)}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar p/ WhatsApp
                      </Button>
                    </div>

                    <div className="divide-y divide-border/60">
                      {lista.map((al) => {
                        const est = TIPO_STYLE[al.tipo] ?? TIPO_STYLE.alvo_batido;
                        const o = al.oferta;
                        return (
                          <div key={al.id} className="flex gap-3 p-4">
                            {/* A foto é grande o bastante para reconhecer o produto sem abrir o
                                link — que é o ponto de ter foto. `onError` derruba a imagem
                                quebrada em vez de deixar o ícone cinza de arquivo faltando. */}
                            {o?.imagem_url ? (
                              <a href={o.url} target="_blank" rel="noreferrer" className="shrink-0">
                                <img
                                  src={o.imagem_url}
                                  alt={o.titulo}
                                  loading="lazy"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                  className="h-24 w-24 rounded-md border border-border bg-white object-contain p-1"
                                />
                              </a>
                            ) : (
                              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground/60">
                                sem foto
                              </div>
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
                                {/* O vendedor vem na frente da fonte: quando o achado veio de um
                                    comparador, quem vende é a loja, e é ela que interessa. */}
                                {o?.vendedor ?? fonteLabel(o?.fonte)}
                                {o?.vendedor && o.vendedor !== fonteLabel(o.fonte) ? ` · via ${fonteLabel(o.fonte)}` : ""}
                                {o?.condicao && o.condicao !== "novo" ? ` · ${o.condicao}` : ""}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                                {o?.disponivel === true && (
                                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                                    <PackageCheck className="h-3 w-3" /> em estoque
                                  </span>
                                )}
                                {/* Não deveria aparecer — o esgotado sai da lista na
                                    reconferência. Se aparecer, a tela DIZ, em vez de
                                    mostrar um preço bonito de coisa que não se compra. */}
                                {o?.disponivel === false && (
                                  <span
                                    className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                    title="a última conferência não encontrou o produto à venda"
                                  >
                                    <PackageX className="h-3 w-3" /> esgotado ao conferir
                                  </span>
                                )}
                                {/* A nota NUNCA aparece sem a contagem: 5,0 com duas avaliações
                                    engana mais do que informa. Poucas avaliações ficam em cinza
                                    para a pessoa ver que a nota não tem lastro. */}
                                {o?.avaliacao != null && (
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                                      (o.avaliacoes ?? 0) >= 5
                                        ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                    title={(o.avaliacoes ?? 0) >= 5 ? undefined : "poucas avaliações — a nota não tem lastro"}
                                  >
                                    <Star className="h-3 w-3" /> {textoNota(o.avaliacao, o.avaliacoes)}
                                  </span>
                                )}
                                <span>{al.texto}</span>
                              </div>

                              {/* A FICHA VEM DA PÁGINA DO ANÚNCIO, não do título — é o
                                  que a conferência transcreveu, e é dela que saem as
                                  specs que o título não dizia. Fica discreta: quem
                                  decide olhar já decidiu pelo preço. */}
                              {!!o?.ficha && (
                                <div className="mt-1 text-[11.5px] text-muted-foreground" title="Ficha técnica lida na página do anúncio">
                                  {o.ficha}
                                </div>
                              )}

                              {/* O QUE OS COMPRADORES CRITICAM. É a única linha aqui
                                  que nenhuma regra produz: "4,6 ★ (1.842)" é número,
                                  isto é o que o número não conta. */}
                              {!!o?.reclamacoes && (
                                <div className="mt-1 text-[11.5px] text-amber-700 dark:text-amber-400">
                                  Nas avaliações: {o.reclamacoes}
                                </div>
                              )}

                              {/* POR QUE ESTE ESTÁ MAIS BARATO. Só aparece quando a
                                  pergunta foi feita — e ela só é feita quando o
                                  anúncio está ao menos 10% abaixo dos irmãos. Preço
                                  bom demais sem motivo é o achado mais convincente
                                  e mais perigoso deste módulo. */}
                              {!!o?.porque_barato && (
                                <div className="mt-1 flex items-start gap-1.5 text-[11.5px] text-violet-700 dark:text-violet-400">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <span>Mais barato porque: {o.porque_barato}</span>
                                </div>
                              )}

                              {!!o?.conferir?.length && (
                                <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <span>O anúncio não informa {o.conferir.join(", ")} — confira no link antes de comprar.</span>
                                </div>
                              )}
                            </div>

                            <div className="flex shrink-0 flex-col items-end gap-1">
                              {/* O TOTAL na frente, e o desmembramento embaixo: é o total que
                                  decide a compra, e um preço sem o frete é meia conta. */}
                              {/* EM CONSUMÍVEL O NÚMERO GRANDE É O DA UNIDADE.
                                  É ele que decide a compra: "R$ 34 o pacote" não
                                  se compara com nada, "R$ 68/kg" se compara com
                                  o teto e com o mês passado. O preço do pacote
                                  desce para a linha de apoio, onde continua
                                  sendo o que se paga no caixa. */}
                              <div className="num text-[18px] font-semibold text-foreground">
                                {o?.preco_unitario != null
                                  ? <>{fmtBRL(Number(o.preco_unitario))}<span className="text-[12px] font-normal text-muted-foreground">/{o.embalagem_unidade === "l" ? "L" : o.embalagem_unidade ?? "un"}</span></>
                                  : fmtBRL(Number(al.preco_total ?? al.preco))}
                              </div>
                              <div className="text-right text-[11px] text-muted-foreground">
                                {o?.preco_unitario != null && o.embalagem_texto
                                  ? `${fmtBRLStr(Number(al.preco_total ?? al.preco))} · ${o.embalagem_texto}`
                                  : <>{fmtBRLStr(Number(o?.preco ?? al.preco))} {textoFrete(al.frete_valor, o?.frete_texto)}</>}
                              </div>
                              {Number(al.economia ?? 0) > 0 && (
                                <div className="num rounded bg-emerald-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                                  economiza {fmtBRL(Number(al.economia))}
                                </div>
                              )}
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
                /* O MESMO COMPARÁVEL DO SERVIDOR: unitário quando existe. Se a
                   tela mostrasse o preço do pacote e o painel tivesse escolhido
                   o melhor pelo preço do quilo, o card exibiria um número que
                   não explica a própria escolha. */
                const melhorTotal = melhor ? Number(melhor.preco_unitario ?? melhor.preco_total ?? melhor.preco) : null;
                const melhorUn = melhor?.preco_unitario != null
                  ? (melhor.embalagem_unidade === "l" ? "L" : melhor.embalagem_unidade ?? "un")
                  : null;
                /* A unidade do ALVO (não a da oferta): é ela que dá sentido ao
                   teto e ao "menor fora do teto", que existem mesmo quando não
                   há nenhuma oferta para tirar a unidade de dentro. */
                const uAlvo = (l.alvo.specs as any)?.unidade as string | undefined;
                const unidadeDoAlvo = uAlvo ? (uAlvo === "l" ? "L" : uAlvo) : null;
                const folga = melhorTotal != null ? (Number(l.alvo.preco_alvo) - melhorTotal) / Number(l.alvo.preco_alvo) : null;
                return (
                  <div key={l.alvo.id} className={cn("card-surface", !l.alvo.ativo && "opacity-60")}>
                    <div className="flex flex-wrap items-center gap-3 p-4">
                      <button type="button" onClick={() => abrirAlvo(l.alvo.id)} className="ghost-icone text-muted-foreground">
                        {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => alternarFavorito(l)}
                        title={l.alvo.favorito ? "Padrão da casa — clique para desmarcar" : "Marcar como padrão da casa"}
                        className={cn("ghost-icone", l.alvo.favorito ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500")}
                      >
                        <Star className={cn("h-4 w-4", l.alvo.favorito && "fill-current")} />
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
                            {fmtBRL(melhorTotal)}{melhorUn && <span className="text-[12px] font-normal text-muted-foreground">/{melhorUn}</span>}
                            {folga != null && <span className="ml-1 text-[11px] font-normal text-muted-foreground">−{Math.round(folga * 100)}%</span>}
                          </div>
                        ) : l.menor_fora_do_teto ? (
                          /* "Nada dentro dos filtros" faz a pessoa achar que o radar
                             está quebrado. Dizer o preço do mais barato que apareceu
                             muda o diagnóstico: o radar achou — o teto é que não
                             alcança o mercado. */
                          <div className="text-[12px] text-amber-700 dark:text-amber-400">
                            nada no teto · menor: <span className="num font-semibold">
                              {fmtBRL(Number(l.menor_fora_do_teto))}
                              {/* Sem o "/kg" o número mente por omissão: R$ 59,60
                                  parece caber num teto de "R$ 45" até se lembrar
                                  de que os dois são por quilo. */}
                              {unidadeDoAlvo && <span className="font-normal">/{unidadeDoAlvo}</span>}
                            </span>
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
                        {/* A curva vem ANTES da lista: a pergunta é "esse preço é bom?",
                            e a resposta está na linha do tempo, não no anúncio de hoje. */}
                        <div className="border-b border-border p-4">
                          <HistoricoPreco
                            alvoId={l.alvo.id}
                            precoAlvo={Number(l.alvo.preco_alvo)}
                            pontos={l.pontos_historico ?? 0}
                          />
                        </div>
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
                                  <th className="px-3 py-2 font-semibold">Frete</th>
                                  <th className="px-3 py-2 text-right font-semibold">Mín. visto</th>
                                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                                  <th className="px-3 py-2" />
                                </tr>
                              </thead>
                              <tbody>
                                {ofertas[l.alvo.id].map((o) => (
                                  <tr key={o.id} className="border-t border-border/60">
                                    <td className="px-4 py-2">
                                      <div className="flex items-start gap-2">
                                        {o.imagem_url && (
                                          <img
                                            src={o.imagem_url}
                                            alt=""
                                            loading="lazy"
                                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                            className="h-10 w-10 shrink-0 rounded border border-border bg-white object-contain p-0.5"
                                          />
                                        )}
                                        <div className="min-w-0">
                                          <div className="max-w-[380px] truncate text-[12.5px] text-foreground" title={o.titulo}>{o.titulo}</div>
                                          <div className="text-[11px] text-muted-foreground">
                                            {o.avaliacao != null && (
                                              <span className={cn("mr-1", (o.avaliacoes ?? 0) >= 5 ? "text-amber-700 dark:text-amber-400" : "")}>
                                                {textoNota(o.avaliacao, o.avaliacoes)} ·
                                              </span>
                                            )}
                                            {o.motivos?.slice(0, 3).join(" · ") || "—"}
                                            {!!o.conferir?.length && (
                                              <span className="text-amber-700 dark:text-amber-400"> · conferir: {o.conferir.join(", ")}</span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-[11.5px] text-muted-foreground">
                                      {o.vendedor ?? fonteLabel(o.fonte)}
                                      {o.vendedor && o.vendedor !== fonteLabel(o.fonte) && (
                                        <div className="text-[10.5px]">via {fonteLabel(o.fonte)}</div>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-[11.5px] text-muted-foreground">
                                      {o.frete_valor === 0
                                        ? <span className="text-emerald-700 dark:text-emerald-400">grátis</span>
                                        : o.frete_valor != null
                                          ? <span className="num">{fmtBRL(Number(o.frete_valor))}</span>
                                          : <span className="text-muted-foreground/70" title={o.frete_texto ?? "a loja só calcula com o CEP"}>a calcular</span>}
                                    </td>
                                    <td className="num px-3 py-2 text-right text-[12px] text-muted-foreground">
                                      {o.preco_min != null ? fmtBRL(Number(o.preco_min)) : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <div className="num text-[13px] font-semibold text-foreground">
                                        {fmtBRL(Number(o.preco_total ?? o.preco))}
                                      </div>
                                      {o.frete_valor != null && o.frete_valor > 0 && (
                                        <div className="num text-[10.5px] text-muted-foreground">{fmtBRLStr(Number(o.preco))} + frete</div>
                                      )}
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
        onBuscarAgora={varrer}
      />
    </div>
  );
}
