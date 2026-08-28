import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Newspaper, ExternalLink, Check, RefreshCw, Loader2, TrendingUp } from "lucide-react";

/**
 * O painel de notícias do briefing.
 *
 * O QUE MUDOU EM 28/08/2026. Antes isto era um bloco de prosa por tema, escrito
 * pela skill de briefing: sem link por item, sem data, sem veículo e sem
 * memória — a mesma notícia voltava três manhãs seguidas e ninguém tinha como
 * dizer "essa eu já li". Agora a função `briefing-noticias` grava item a item em
 * `briefing_noticias`, e esta tela mostra o que ainda não foi lido.
 *
 * A PROSA NÃO MORREU, e isso é de propósito: macro Brasil e foodservice
 * genérico continuam vindo da skill, em texto, porque ali o que vale é o
 * panorama e não o link. Ela desce para o rodapé do card, abaixo dos itens.
 *
 * A FAIXA DO FORNECEDOR É A PARTE MAIS BARATA E A MAIS ACIONÁVEL. A vigilância
 * de páginas já lê, todo dia, a tabela de preços da Anthropic, da OpenAI, do
 * Omie e do Asaas — um diff ali vale mais que dez manchetes, e já está pago.
 * O que faltava era ele aparecer na tela que se abre de manhã em vez de morrer
 * em /governanca/vigilancia, que ninguém abre.
 */

type Noticia = {
  id: number;
  pauta: string;
  titulo: string;
  url: string;
  fonte: string | null;
  publicado_em: string | null;
  resumo: string | null;
  por_que_importa: string | null;
  /** Veredito da IA sobre o item já aprovado pela régua. `null` = ela não respondeu. */
  muda_algo: boolean | null;
  relevancia: number;
  colhido_em: string;
};

type MudancaFornecedor = {
  id: number;
  resumo: string | null;
  natureza: string;
  detectado_em: string;
  pagina: string;
};

const sb = supabase as any;

const PAUTA_META: Record<string, { rotulo: string; chip: string; barra: string }> = {
  ia_ferramentas: { rotulo: "Ferramentas", chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400", barra: "border-sky-500/60" },
  ia_backoffice:  { rotulo: "IA no financeiro", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", barra: "border-emerald-500/60" },
  concorrentes:   { rotulo: "Concorrentes", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", barra: "border-amber-500/60" },
};
const metaDaPauta = (p: string) =>
  PAUTA_META[p] ?? { rotulo: p.replace(/_/g, " "), chip: "bg-secondary text-muted-foreground", barra: "border-border" };

/**
 * "há 3 h", "ontem", "12/08". Data de notícia é sempre relativa até deixar de
 * ser: passado um par de dias, o dia do mês diz mais que "há 51 horas".
 */
function quando(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const horas = (Date.now() - t) / 3_600_000;
  if (horas < 1) return "agora há pouco";
  if (horas < 24) return `há ${Math.round(horas)} h`;
  if (horas < 48) return "ontem";
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Uma linha do painel. Mesma marcação para as acionáveis e para as outras — o
 *  que muda entre as duas listas é a posição e a opacidade, não o conteúdo: quem
 *  abrir "ver as outras" quer o mesmo link e a mesma legenda. */
function Item({ n, onLida }: { n: Noticia; onLida: (id: number) => void }) {
  const meta = metaDaPauta(n.pauta);
  return (
    <li className={cn("group rounded-md border border-border bg-card px-2.5 py-2 transition hover:border-primary/40", "border-l-2", meta.barra)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider", meta.chip)}>
              {meta.rotulo}
            </span>
            <a
              href={n.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium leading-snug text-foreground hover:text-primary hover:underline"
            >
              {n.titulo}
              <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
            </a>
          </div>
          {n.por_que_importa && (
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{n.por_que_importa}</p>
          )}
          {/* A aba de notícias nem sempre diz o veículo, e o host do link é o de
              um redirecionador — por isso a fonte some quando não se sabe, em
              vez de virar "google.com". */}
          <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
            {n.fonte && <span>{n.fonte}</span>}
            {n.fonte && <span>·</span>}
            <span className="num">{quando(n.publicado_em ?? n.colhido_em)}</span>
          </div>
        </div>
        <button
          onClick={() => onLida(n.id)}
          title="Já li — some da lista e não volta"
          className="shrink-0 rounded p-1 text-muted-foreground/60 transition hover:bg-secondary hover:text-foreground"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

export function PainelNoticias({ prosa, janela }: { prosa?: ReactNode; janela?: string | null }) {
  const [itens, setItens] = useState<Noticia[]>([]);
  const [mudancas, setMudancas] = useState<MudancaFornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [verOutros, setVerOutros] = useState(false);

  const carregar = useCallback(async () => {
    /* As duas leituras em paralelo: são tabelas diferentes e nenhuma depende da
       outra — em série, a tela do briefing esperaria dois round-trips por nada. */
    const [n, m] = await Promise.all([
      sb.from("briefing_noticias")
        .select("id,pauta,titulo,url,fonte,publicado_em,resumo,por_que_importa,muda_algo,relevancia,colhido_em")
        .is("lido_em", null)
        .order("colhido_em", { ascending: false })
        .order("relevancia", { ascending: false })
        .limit(12),
      sb.from("vigilancia_mudancas")
        .select("id,resumo,natureza,detectado_em,vigilancia_paginas(nome)")
        .is("visto_em", null)
        .gte("detectado_em", new Date(Date.now() - 5 * 86_400_000).toISOString())
        .order("detectado_em", { ascending: false })
        .limit(3),
    ]);
    setItens((n.data ?? []) as Noticia[]);
    setMudancas(((m.data ?? []) as any[]).map((x) => ({
      id: x.id, resumo: x.resumo, natureza: x.natureza, detectado_em: x.detectado_em,
      pagina: x.vigilancia_paginas?.nome ?? "fornecedor",
    })));
    setLoading(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function marcarLida(id: number) {
    /* Some da tela na hora e só depois grava. Marcar "li" é reversível na
       prática (a linha continua no banco) e a espera de um round-trip para uma
       lista de seis itens é o que faz a interação parecer travada. */
    setItens((a) => a.filter((i) => i.id !== id));
    const { data: u } = await supabase.auth.getUser();
    const { error } = await sb.from("briefing_noticias")
      .update({ lido_em: new Date().toISOString(), lido_por: u?.user?.email ?? null })
      .eq("id", id);
    if (error) { toast.error("Não deu para marcar como lida."); void carregar(); }
  }

  async function buscarAgora() {
    setBuscando(true);
    try {
      const r = await invocar<{ gravadas?: number; buscas?: number; creditos?: number; freado?: boolean; mensagem?: string }>(
        supabase.functions.invoke("briefing-noticias", { body: { action: "varrer", forcar: true } }),
      );
      toast[r.freado ? "warning" : "success"](
        r.mensagem ?? `${r.gravadas ?? 0} notícia(s) novas`,
        r.creditos ? { description: `${r.creditos} crédito(s) de raspagem` } : undefined,
      );
      await carregar();
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally { setBuscando(false); }
  }

  /* O CORTE FINAL É DA IA, E `null` NÃO ESCONDE.
     A régua determinística aprova por palavra e não distingue o anúncio do
     produto da análise que MENCIONA o anúncio — na estreia, os quatro itens
     aprovados eram do segundo tipo. Então a IA responde, sobre o item já
     aprovado, se aquilo muda algo concreto; o "não" desce para o rodapé em vez
     de sumir, e o "não sei" (falha da chamada) fica em cima, porque esconder por
     falha de leitura seria censura silenciosa. */
  const acionaveis = itens.filter((n) => n.muda_algo !== false);
  const outros = itens.filter((n) => n.muda_algo === false);

  // Nada de notícia e nada de prosa: o card inteiro some, como o resto da página.
  if (loading || (itens.length === 0 && mudancas.length === 0 && !prosa)) return null;

  return (
    <SectionCard
      title={<span className="flex items-center gap-2"><Newspaper className="h-4 w-4 text-muted-foreground" /> Notícias</span>}
      subtitle={
        itens.length
          ? `${acionaveis.length} para olhar${outros.length ? ` · ${outros.length} sem novidade` : ""}`
          : (janela ? `janela ${janela}` : undefined)
      }
      actions={
        <button
          onClick={buscarAgora}
          disabled={buscando}
          title="Busca as três pautas de novo agora. Gasta 8 a 10 créditos de raspagem."
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
        >
          {buscando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} buscar agora
        </button>
      }
    >
      {/* ---- mudou no seu fornecedor: já pago pela vigilância, e o mais acionável ---- */}
      {mudancas.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {mudancas.map((m) => (
            <div key={m.id} className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-2.5 py-2">
              <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 text-[12px] leading-snug">
                <span className="font-semibold text-foreground">{m.pagina}</span>
                <span className="text-muted-foreground"> · {m.natureza === "preco" ? "mexeu no preço" : "mudou a página"}</span>
                {m.resumo && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{m.resumo}</p>}
              </div>
              <span className="num shrink-0 text-[10.5px] text-muted-foreground/80">{quando(m.detectado_em)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------- os itens ------------------------------- */}
      {acionaveis.length > 0 && (
        <ul className="space-y-1.5">
          {acionaveis.map((n) => <Item key={n.id} n={n} onLida={marcarLida} />)}
        </ul>
      )}

      {/* Dia sem nada acionável é resultado, não falha — e dizer isso vale mais
          que uma lista de manchetes que a própria IA classificou como inúteis. */}
      {itens.length > 0 && acionaveis.length === 0 && (
        <div className="rounded-md border border-dashed border-border px-3 py-3 text-center text-[12px] text-muted-foreground">
          Nada que mude alguma coisa para a gente hoje.
        </div>
      )}

      {outros.length > 0 && (
        <div className={cn(acionaveis.length > 0 && "mt-2")}>
          <button
            onClick={() => setVerOutros((v) => !v)}
            className="text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            {verOutros ? "esconder" : `ver as outras ${outros.length}`} — sem novidade para a Takeat
          </button>
          {verOutros && (
            <ul className="mt-1.5 space-y-1.5 opacity-70">
              {outros.map((n) => <Item key={n.id} n={n} onLida={marcarLida} />)}
            </ul>
          )}
        </div>
      )}

      {/* ---- o panorama em prosa da skill: macro e setor, que não viram item ---- */}
      {prosa && (
        <div className={cn(itens.length > 0 && "mt-4 border-t border-border/60 pt-3")}>
          {itens.length > 0 && (
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              Panorama do dia
            </div>
          )}
          {prosa}
        </div>
      )}
    </SectionCard>
  );
}
