import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { SectionCard } from "@/components/ui/section-card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Newspaper, ExternalLink, Check, RefreshCw, Loader2, TrendingUp,
  ThumbsUp, ThumbsDown, Brain, Trash2, EyeOff, Eye,
} from "lucide-react";

/**
 * O painel de notícias do briefing.
 *
 * O QUE MUDOU EM 28/08/2026. Antes isto era um bloco de prosa por tema, escrito
 * pela skill de briefing: sem link por item, sem data, sem veículo e sem
 * memória — a mesma notícia voltava três manhãs seguidas e ninguém tinha como
 * dizer "essa eu já li". Passou a ser item: a função `briefing-noticias` grava
 * um a um em `briefing_noticias`, e esta tela mostra o que ainda não foi lido.
 *
 * O QUE MUDOU EM 29/08/2026, e é o assunto desta versão.
 *
 * 1. A PROSA ACABOU. Sobrava, embaixo dos itens, o "Panorama do dia" da skill —
 *    macro Brasil, tech/SaaS e foodservice em três parágrafos. Era exatamente o
 *    pedaço que se repetia, e por construção: "Selic em 14% desde 05/08" é
 *    verdade todo dia e novidade em um só. Texto não tem data, não deduplica e
 *    não se marca como lido. Agora as quatro frentes — IA, finanças,
 *    foodservice e startups — são item, no mesmo lugar e com o mesmo tratamento.
 *
 * 2. O PAINEL APRENDE. Cada linha tem 👍 e 👎. O voto vira vocabulário com peso
 *    em `briefing_noticias_preferencias`, e a régua da rodada seguinte soma esse
 *    peso como soma qualquer outro sinal. Não é um modelo que se ajusta no
 *    escuro: é uma lista de assuntos, com os termos à mostra, que abre no botão
 *    "o que eu aprendi" — e de onde dá para esquecer o que ficou errado.
 *
 * 3. REPETIÇÃO TEM RODAPÉ. A régua já juntava a mesma manchete contada por dois
 *    veículos (palavras em comum). O que ela não pega é "Copom mantém juros"
 *    contra "Selic segue em 14%": mesma manhã, zero palavras iguais. Isso a IA
 *    responde no campo `repete`, e o item desce para "ver as outras" em vez de
 *    sumir — esconder por semelhança julgada é o tipo de corte que precisa ficar
 *    visível.
 *
 * A FAIXA DO FORNECEDOR É A PARTE MAIS BARATA E A MAIS ACIONÁVEL. A vigilância
 * de páginas já lê, todo dia, a tabela de preços da Anthropic, da OpenAI, do
 * Omie e do Asaas — um diff ali vale mais que dez manchetes, e já está pago.
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
  /** A IA achou que é a mesma história de algo já mostrado. `null` = não respondeu. */
  repete: boolean | null;
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

type Preferencia = {
  id: number;
  rotulo: string;
  termos: string[] | null;
  peso: number;
  votos: number;
  exemplos: string[] | null;
  ativo: boolean;
};

const sb = supabase as any;

/**
 * As quatro frentes, e a pauta velha que sobreviveu nas linhas antigas.
 *
 * `concorrentes` virou `foodservice` em 29/08/2026 e a migração renomeou as
 * linhas — mas o rótulo fica, porque uma tela que quebra o chip de uma linha
 * histórica é uma tela que ninguém consegue olhar para trás.
 */
const PAUTA_META: Record<string, { rotulo: string; chip: string; barra: string }> = {
  ia_ferramentas: { rotulo: "IA · ferramentas", chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400", barra: "border-sky-500/60" },
  ia_backoffice:  { rotulo: "IA no financeiro", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", barra: "border-emerald-500/60" },
  financas:       { rotulo: "Finanças", chip: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400", barra: "border-indigo-500/60" },
  foodservice:    { rotulo: "Foodservice", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", barra: "border-amber-500/60" },
  startups:       { rotulo: "Startups", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400", barra: "border-violet-500/60" },
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
 *  abrir "ver as outras" quer o mesmo link, a mesma legenda e os mesmos botões. */
function Item({ n, onLida, onVoto }: {
  n: Noticia;
  onLida: (id: number) => void;
  onVoto: (n: Noticia, voto: 1 | -1) => void;
}) {
  const meta = metaDaPauta(n.pauta);
  return (
    <li className={cn("group rounded-md border border-border bg-card px-2.5 py-2 transition hover:border-primary/40", "border-l-2", meta.barra)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider", meta.chip)}>
              {meta.rotulo}
            </span>
            {n.repete && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                já vimos
              </span>
            )}
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

        {/* Os três botões na mesma coluna, e nessa ordem: o 👍/👎 ensina, o ✓ só
            arquiva. Todos somem a linha da tela — a diferença é o que fica
            gravado, não o que acontece na hora. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => onVoto(n, 1)}
            title="Quero mais assuntos assim"
            className="rounded p-1 text-muted-foreground/60 transition hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onVoto(n, -1)}
            title="Evite esse assunto daqui em diante"
            className="rounded p-1 text-muted-foreground/60 transition hover:bg-primary/10 hover:text-primary"
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onLida(n.id)}
            title="Já li — some da lista e não volta"
            className="rounded p-1 text-muted-foreground/60 transition hover:bg-secondary hover:text-foreground"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------ o que eu aprendi ------------------------------ */

/**
 * A lista do que o 👍/👎 ensinou, aberta e editável.
 *
 * ISTO É O QUE SEPARA O BOTÃO DE UM ENFEITE. Um filtro que aprende sem mostrar o
 * que aprendeu não tem como estar errado aos olhos de ninguém — some com um
 * assunto e a pessoa nunca descobre que ele existia. Aqui está o rótulo, o peso
 * (a soma dos votos, com sinal), os termos que a régua procura de fato e a
 * manchete que originou tudo.
 *
 * DESLIGAR E APAGAR SÃO COISAS DIFERENTES, e as duas existem: desligar guarda o
 * histórico de votos para quem quiser voltar atrás; apagar é para o assunto que
 * nasceu torto e não deve nem constar.
 */
function OQueEuAprendi({ prefs, aberto, onFechar, onMudou }: {
  prefs: Preferencia[]; aberto: boolean; onFechar: () => void; onMudou: () => void;
}) {
  async function alternar(p: Preferencia) {
    const { error } = await sb.from("briefing_noticias_preferencias").update({ ativo: !p.ativo }).eq("id", p.id);
    if (error) toast.error("Não deu para mudar: " + error.message);
    onMudou();
  }
  async function esquecer(p: Preferencia) {
    const { error } = await sb.from("briefing_noticias_preferencias").delete().eq("id", p.id);
    if (error) toast.error("Não deu para esquecer: " + error.message);
    else toast.success(`Esqueci "${p.rotulo}".`);
    onMudou();
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Brain className="h-4 w-4 text-primary" /> O que eu aprendi do seu gosto
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Cada 👍/👎 vira um assunto com peso. A busca da manhã soma esse peso na hora de escolher —
            dois votos contra o mesmo assunto e ele deixa de aparecer.
          </DialogDescription>
        </DialogHeader>

        {prefs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted-foreground">
            Nada ainda. Use o 👍 e o 👎 nas notícias e o que eu entender aparece aqui.
          </div>
        ) : (
          <ul className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
            {prefs.map((p) => (
              <li key={p.id} className={cn("rounded-md border border-border px-2.5 py-2", !p.ativo && "opacity-50")}>
                <div className="flex items-start gap-2">
                  <span className={cn(
                    "num mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
                    p.peso > 0
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-primary/10 text-primary",
                  )}>
                    {p.peso > 0 ? `+${p.peso}` : p.peso}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium leading-snug text-foreground">{p.rotulo}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {(p.termos ?? []).map((t) => (
                        <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{t}</span>
                      ))}
                    </div>
                    {p.exemplos?.[0] && (
                      <div className="mt-1 truncate text-[10.5px] text-muted-foreground/70" title={p.exemplos.join(" · ")}>
                        de: {p.exemplos[p.exemplos.length - 1]}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={() => alternar(p)}
                      title={p.ativo ? "Pausar — para de pesar, mas guarda os votos" : "Voltar a usar"}
                      className="rounded p-1 text-muted-foreground/60 transition hover:bg-secondary hover:text-foreground"
                    >
                      {p.ativo ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => esquecer(p)}
                      title="Esquecer de vez"
                      className="rounded p-1 text-muted-foreground/60 transition hover:bg-primary/10 hover:text-primary"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================= o painel */

export function PainelNoticias() {
  const [itens, setItens] = useState<Noticia[]>([]);
  const [mudancas, setMudancas] = useState<MudancaFornecedor[]>([]);
  const [prefs, setPrefs] = useState<Preferencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [verOutros, setVerOutros] = useState(false);
  const [verAprendido, setVerAprendido] = useState(false);

  const carregarPrefs = useCallback(async () => {
    const { data } = await sb.from("briefing_noticias_preferencias")
      .select("id,rotulo,termos,peso,votos,exemplos,ativo")
      .order("ativo", { ascending: false })
      .order("peso", { ascending: false })
      .limit(60);
    setPrefs((data ?? []) as Preferencia[]);
  }, []);

  const carregar = useCallback(async () => {
    /* As três leituras em paralelo: são tabelas diferentes e nenhuma depende da
       outra — em série, a tela do briefing esperaria três round-trips por nada. */
    const [n, m] = await Promise.all([
      sb.from("briefing_noticias")
        .select("id,pauta,titulo,url,fonte,publicado_em,resumo,por_que_importa,muda_algo,repete,relevancia,colhido_em")
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
      carregarPrefs(),
    ]);
    setItens((n.data ?? []) as Noticia[]);
    setMudancas(((m.data ?? []) as any[]).map((x) => ({
      id: x.id, resumo: x.resumo, natureza: x.natureza, detectado_em: x.detectado_em,
      pagina: x.vigilancia_paginas?.nome ?? "fornecedor",
    })));
    setLoading(false);
  }, [carregarPrefs]);

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

  /**
   * O voto: some da lista na hora, grava, e manda aprender SEM ESPERAR.
   *
   * A classificação do assunto é uma chamada de IA de dois a quatro segundos.
   * Segurar o clique por isso faria a pessoa clicar duas vezes — e um 👎 dado em
   * dobro vira veto imediato, que é justamente o efeito que não se quer por
   * acidente. Então o voto é gravado de imediato e o aprendizado corre atrás;
   * o que falhar no caminho fica na fila e é recolhido pela rodada das 07:55.
   */
  async function votar(n: Noticia, voto: 1 | -1) {
    setItens((a) => a.filter((i) => i.id !== n.id));
    const { data: u } = await supabase.auth.getUser();
    const agora = new Date().toISOString();
    const quem = u?.user?.email ?? null;
    const { error } = await sb.from("briefing_noticias")
      .update({ voto, voto_em: agora, voto_por: quem, lido_em: agora, lido_por: quem })
      .eq("id", n.id);
    if (error) { toast.error("Não deu para registrar o voto."); void carregar(); return; }

    toast.success(voto > 0 ? "Anotado — vou trazer mais assim." : "Anotado — vou evitar esse assunto.");
    invocar(supabase.functions.invoke("briefing-noticias", { body: { action: "aprender", id: n.id } }))
      .then(() => void carregarPrefs())
      .catch((e) => console.warn("o voto ficou na fila do aprendizado:", String((e as Error)?.message ?? e)));
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
     aprovado, se aquilo muda algo concreto e se é a mesma história de algo já
     mostrado; os dois "sim" descem para o rodapé em vez de sumir, e o "não sei"
     (falha da chamada) fica em cima, porque esconder por falha de leitura seria
     censura silenciosa. */
  const acionaveis = itens.filter((n) => n.muda_algo !== false && n.repete !== true);
  const outros = itens.filter((n) => n.muda_algo === false || n.repete === true);
  const nPrefs = useMemo(() => prefs.filter((p) => p.ativo).length, [prefs]);

  // Nada de notícia e nada de mudança de fornecedor: o card inteiro some, como o
  // resto da página. O botão do que foi aprendido não segura a seção sozinho —
  // um card permanente com um botão dentro é a definição de ruído.
  if (loading || (itens.length === 0 && mudancas.length === 0)) return null;

  return (
    <SectionCard
      title={<span className="flex items-center gap-2"><Newspaper className="h-4 w-4 text-muted-foreground" /> Notícias</span>}
      subtitle={
        itens.length
          ? `${acionaveis.length} para olhar${outros.length ? ` · ${outros.length} sem novidade` : ""} · IA, finanças, foodservice e startups`
          : undefined
      }
      actions={
        <div className="flex items-center gap-1.5">
          {nPrefs > 0 && (
            <button
              onClick={() => setVerAprendido(true)}
              title="O que o 👍/👎 ensinou — e como apagar o que ficou errado"
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-secondary"
            >
              <Brain className="h-3 w-3" /> o que eu aprendi <span className="num">{nPrefs}</span>
            </button>
          )}
          <button
            onClick={buscarAgora}
            disabled={buscando}
            title="Refaz as quatro buscas de hoje. Gasta 8 a 10 créditos de raspagem."
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
          >
            {buscando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} buscar agora
          </button>
        </div>
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
          {acionaveis.map((n) => <Item key={n.id} n={n} onLida={marcarLida} onVoto={votar} />)}
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
            {verOutros ? "esconder" : `ver as outras ${outros.length}`} — sem novidade ou repetidas
          </button>
          {verOutros && (
            <ul className="mt-1.5 space-y-1.5 opacity-70">
              {outros.map((n) => <Item key={n.id} n={n} onLida={marcarLida} onVoto={votar} />)}
            </ul>
          )}
        </div>
      )}

      <OQueEuAprendi
        prefs={prefs}
        aberto={verAprendido}
        onFechar={() => setVerAprendido(false)}
        onMudou={() => void carregarPrefs()}
      />
    </SectionCard>
  );
}
