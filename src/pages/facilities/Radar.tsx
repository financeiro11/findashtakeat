import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle, ArrowDownRight, ChevronDown, ChevronLeft, ChevronRight, Copy, Eye, ExternalLink,
  Loader2, PackageCheck, PackageX, Pause, PiggyBank, Play, Plus, Radar as RadarIcon, RefreshCw, ShoppingCart,
  Sparkles, Star, ThumbsDown, ThumbsUp, Trash2, TrendingDown, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { invocar } from "@/lib/erroEdge";
import { comValorExato } from "@/components/ValorExato";
import { CatDot } from "./components";
import { NovoAlvoDialog, type AlvoRow } from "./NovoAlvoDialog";
import { db, fmtBRL as fmtBRLStr, fmtData } from "./lib";
import { agruparIguais, mapaDeJuntados, norm, planoDeJuntar, type JuntadoRow, resumoDoAlvo, fonteLabel, textoFrete, textoNota, textoWhats, TIPO_ALERTA_LABEL, type TipoAlerta, type UnidadeBase } from "@/lib/radarPrecos";
import { invalidarRadarAlertas } from "@/hooks/useRadarAlertas";
import { ProximaVarredura } from "./ProximaVarredura";
import { SaldoRaspagem } from "./SaldoRaspagem";
import { HistoricoPreco } from "./HistoricoPreco";
import { Kits } from "./Kits";
import { UltimaRodada } from "./UltimaRodada";
import { lerFontes } from "@/lib/radarRodada";
import { Destinatarios } from "./Destinatarios";

/** O que `sugerir_iguais` devolve — a IA propõe a junção, a trava filtra, a pessoa carimba. */
interface SugestaoIguais {
  ok?: boolean; erro?: string; pode?: boolean; texto?: string;
  linhas?: number; barradas?: number;
  sugestoes?: { porque: string; ofertas: { id: number; titulo: string; vendedor: string | null; fonte: string; preco: number; preco_total: number | null; imagem_url: string | null }[] }[];
}

/** O que `sugerir_busca` devolve — a IA propõe, a pessoa carimba. */
interface SugestaoBusca {
  ok?: boolean; erro?: string; pode?: boolean; texto?: string;
  atual?: string; proposta?: string; mudou?: boolean; porque?: string;
  recusados?: number; evitaveis?: number;
}

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
  /* A tabela do card lista TAMBÉM o que ficou acima do teto (é o "produto
     certo, preço errado" que alimenta a curva); o contador do card conta só
     o que coube. Sem marcar a linha, os dois números não batem na tela. */
  dentro_do_teto: boolean | null;
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

/* O RÓTULO VEM DO `_shared`, e só a cor e o ícone moram aqui. O radar agora
   avisa por WhatsApp sozinho, e o card dizendo "Caiu forte" enquanto a
   mensagem sobre o MESMO achado dissesse outra coisa faria alguém abrir o Hub
   só para conferir se são a mesma oferta. */
const TIPO_STYLE: Record<string, { label: string; cls: string; Icon: typeof TrendingDown }> = {
  minimo_historico: { label: TIPO_ALERTA_LABEL.minimo_historico, cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: TrendingDown },
  queda_forte:      { label: TIPO_ALERTA_LABEL.queda_forte,      cls: "bg-violet-50 text-violet-700 border-violet-200",   Icon: ArrowDownRight },
  alvo_batido:      { label: TIPO_ALERTA_LABEL.alvo_batido,      cls: "bg-amber-50 text-amber-700 border-amber-200",      Icon: Sparkles },
};

export default function Radar() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [varrendo, setVarrendo] = useState<string | null>(null); // id do alvo ou "todos"
  const [adotando, setAdotando] = useState<number | null>(null);
  const [painel, setPainel] = useState<PainelLinha[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ofertas, setOfertas] = useState<Record<string, Oferta[]>>({});
  const [editando, setEditando] = useState<AlvoRow | null>(null);
  const [dialogAberto, setDialogAberto] = useState(false);
  /** alvo_id → oferta_id → o que a pessoa já votou. Só do alvo aberto por vez. */
  const [feedback, setFeedback] = useState<Record<string, Record<number, "gostei" | "nao_gostei">>>({});
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  /* O anúncio com 👎 some da tabela; este interruptor o traz de volta (esmaecido)
     para quem quer rever ou desfazer uma recusa. */
  const [verDescartados, setVerDescartados] = useState(false);
  /* A tabela do card abre mostrando o que CABE no teto — o mesmo que o contador
     do card conta. O resto (produto certo, preço errado) fica a um clique. */
  const [soNoTeto, setSoNoTeto] = useState(true);
  const [sugestoes, setSugestoes] = useState<Record<string, { carregando: boolean; dados?: SugestaoBusca }>>({});
  /* Foto ampliada da tabela de anúncios. Guarda a lista VISÍVEL de quando abriu,
     para dar para triar anúncio a anúncio (←/→) só pela foto. */
  const [foto, setFoto] = useState<{ alvoId: string; lista: Oferta[]; idx: number } | null>(null);
  /* Grupos de anúncios iguais abertos, pelo id da cabeça (a mais barata). */
  const [gruposAbertos, setGruposAbertos] = useState<Set<number>>(new Set());
  /* Anúncios que a pessoa juntou como o mesmo produto (`facilities_radar_iguais`),
     por alvo — é o que supera o título cortado diferente em cada comparador. */
  const [juntados, setJuntados] = useState<Record<string, JuntadoRow[]>>({});
  /* Linhas marcadas para juntar. Só vale no card aberto: trocar de card limpa. */
  const [selecao, setSelecao] = useState<Set<number>>(new Set());
  const [juntando, setJuntando] = useState(false);
  /* Junções que a IA PROPÕE, por alvo. Nada é gravado até o clique em "Juntar";
     "Ignorar" só tira da lista (a próxima sugestão pode trazer de novo). */
  const [sugestoesIguais, setSugestoesIguais] = useState<Record<string, { carregando: boolean; dados?: SugestaoIguais }>>({});
  useEffect(() => { setSelecao(new Set()); }, [aberto]);

  /* Quantos alvos em cada regime. Sai daqui e não de dentro dos componentes
     porque três lugares fazem a mesma pergunta e por motivos diferentes: o
     contador do topo (para não anunciar um cron que passaria pela fila vazia),
     o cabeçalho da lista (porque um em compra vale ~65 em vigia na fatura de
     raspagem) e o toast de "Varrer agora". */
  const regimes = useMemo(() => {
    const vigia = painel.filter((p) => p.alvo.modo === "vigia").length;
    return { vigia, compra: painel.length - vigia };
  }, [painel]);

  /* Os alvos como a caixa de kit precisa deles. Sai do painel que já está na
     memória: uma consulta a mais para ler os mesmos títulos seria trabalho e
     mais uma chance de as duas listas divergirem. */
  const alvosDoKit = useMemo(
    () => painel.map((p) => ({
      id: p.alvo.id,
      titulo: p.alvo.titulo,
      categoria: p.alvo.categoria ?? null,
      modo: p.alvo.modo,
      preco_alvo: Number(p.alvo.preco_alvo),
    })),
    [painel],
  );

  /* Sobe a cada `load`, e é o que faz o bloco de kits reler junto com a página.
     Sem isto, trocar um alvo de regime ou varrer deixaria o total do kit
     mostrando o preço anterior — número velho com cara de atual. */
  const [versao, setVersao] = useState(0);

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
    setVersao((n) => n + 1);
    invalidarRadarAlertas(); // o selo do menu segue o que esta tela acabou de ler
  }, []);
  useEffect(() => { load(); }, [load]);

  function abrirAlvo(id: string) {
    setAberto((atual) => (atual === id ? null : id));
  }

  /* A LISTA DO CARD ABERTO SE REBUSCA SOZINHA. Toda ação que muda o alvo
     (⟳, "Estou comprando", Salvar) limpa `ofertas` para não mostrar anúncio
     velho — e antes só o clique de abrir buscava de novo, então o card aberto
     ficava no skeleton até alguém fechar e reabrir. */
  useEffect(() => {
    if (aberto && !ofertas[aberto]) carregarOfertas(aberto);
  }, [aberto, ofertas]);

  async function carregarOfertas(id: string) {
    const [{ data }, { data: votos }, { data: iguais }] = await Promise.all([
      db.from("facilities_radar_ofertas")
        .select("*").eq("alvo_id", id).eq("ativo", true)
        /* Esgotado apurado não entra na lista. `not.is.false` e não `neq`: o
           estoque desconhecido é `null` — o caso normal de quem ainda não foi
           conferido —, e `neq(false)` derrubaria esses junto. */
        .not("disponivel", "is", false)
        // Pelo TOTAL: o mais barato de verdade, não o de etiqueta menor.
        .order("preco_total", { ascending: true }).limit(60),
      db.from("facilities_radar_feedback").select("oferta_id, sinal").eq("alvo_id", id),
      db.from("facilities_radar_iguais").select("id, alvo_id, titulo, grupo").eq("alvo_id", id),
    ]);
    setJuntados((p) => ({ ...p, [id]: (iguais as JuntadoRow[]) ?? [] }));
    setOfertas((p) => ({ ...p, [id]: (data as Oferta[]) ?? [] }));
    setFeedback((p) => ({
      ...p,
      [id]: Object.fromEntries((votos ?? []).map((v: any) => [v.oferta_id, v.sinal])),
    }));
  }

  /**
   * "Estes são o mesmo produto." Grava por TÍTULO, então vale nas próximas
   * varreduras sem repetir o clique. Linha marcada que já é cabeça de um grupo
   * leva o grupo junto (`planoDeJuntar` funde os grupos).
   */
  async function juntar(alvoId: string, marcados: Oferta[]): Promise<boolean> {
    const titulos = [...new Set(marcados.map((o) => o.titulo))];
    const linhas = planoDeJuntar(alvoId, titulos, juntados[alvoId] ?? [], crypto.randomUUID())
      .map((l) => ({ ...l, criado_por: profile?.nome ?? null }));
    setJuntando(true);
    const { error } = await db.from("facilities_radar_iguais").upsert(linhas, { onConflict: "alvo_id,titulo" });
    setJuntando(false);
    if (error) { toast.error(`Não deu para juntar: ${error.message}`); return false; }
    toast.success(`${marcados.length} anúncios juntados como o mesmo produto — vale também nas próximas varreduras.`);
    setSelecao(new Set());
    await carregarOfertas(alvoId);
    return true;
  }

  async function sugerirIguais(alvoId: string) {
    setSugestoesIguais((p) => ({ ...p, [alvoId]: { carregando: true } }));
    try {
      const r = await invocar<SugestaoIguais>(supabase.functions.invoke("facilities-radar", {
        body: { action: "sugerir_iguais", alvo_id: alvoId },
      }));
      if (r?.ok === false) throw new Error(r.erro ?? "a sugestão falhou");
      setSugestoesIguais((p) => ({ ...p, [alvoId]: { carregando: false, dados: r } }));
    } catch (e: any) {
      toast.error(`Não deu para sugerir junções: ${e.message ?? e}`);
      setSugestoesIguais((p) => { const n = { ...p }; delete n[alvoId]; return n; });
    }
  }

  /** Tira uma sugestão da lista — depois de juntar ou de ignorar. */
  function tirarSugestao(alvoId: string, idx: number) {
    setSugestoesIguais((p) => {
      const atual = p[alvoId]?.dados;
      if (!atual?.sugestoes) return p;
      return { ...p, [alvoId]: { carregando: false, dados: { ...atual, sugestoes: atual.sugestoes.filter((_, i) => i !== idx) } } };
    });
  }

  /** Desfaz a junção de UM título (e das cópias de título igual a ele). */
  async function separar(alvoId: string, o: Oferta) {
    const ids = (juntados[alvoId] ?? []).filter((l) => norm(l.titulo) === norm(o.titulo)).map((l) => l.id);
    if (!ids.length) return;
    const { error } = await db.from("facilities_radar_iguais").delete().in("id", ids);
    if (error) { toast.error(`Não deu para separar: ${error.message}`); return; }
    await carregarOfertas(alvoId);
  }

  /**
   * 👍/👎 num anúncio — sem formulário e sem confirmação. Reclicar no ícone já
   * ativo desfaz o voto.
   *
   * 👎 TIRA O PRODUTO DE CENA NA HORA: some da tabela (com as cópias dele
   * noutras lojas), deixa de ser o "Melhor agora" do card e os achados dele
   * saem da lista — o servidor faz a parte dele e devolve quais anúncios o voto
   * alcançou. 👍 só alimenta o ranking da próxima varredura.
   *
   * OTIMISTA, e sem desfazer sozinho no erro: a chance real de falha aqui é de
   * rede, não de regra de negócio, e um segundo clique já resolve — regredir o
   * ícone sozinho arrisca uma correção que ninguém pediu brigar com o clique
   * seguinte da pessoa.
   */
  async function classificar(alvoId: string, ofertaId: number, sinal: "gostei" | "nao_gostei") {
    // Pelo ref: o "Desfazer" do toast chama esta função com a closure de antes do voto.
    const atual = feedbackRef.current[alvoId]?.[ofertaId];
    const novo = atual === sinal ? null : sinal;
    const aplicar = (ids: number[]) => setFeedback((p) => {
      const doAlvo = { ...(p[alvoId] ?? {}) };
      for (const id of ids) { if (novo) doAlvo[id] = novo; else delete doAlvo[id]; }
      feedbackRef.current = { ...p, [alvoId]: doAlvo };
      return feedbackRef.current;
    });
    aplicar([ofertaId]);
    if (novo === "nao_gostei") {
      setAlertas((p) => p.filter((a) => a.oferta_id !== ofertaId));
      toast("Anúncio descartado — não aparece mais aqui nem vira aviso.", {
        duration: 6000,
        action: { label: "Desfazer", onClick: () => classificar(alvoId, ofertaId, "nao_gostei") },
      });
    }
    try {
      const r = await invocar<any>(supabase.functions.invoke("facilities-radar", {
        body: { action: "classificar", oferta_id: ofertaId, sinal: novo },
      }));
      if (Array.isArray(r?.ofertas)) aplicar(r.ofertas.map(Number));
      /* O card (melhor preço, contador) e os achados dependem do voto quando
         ele é ou deixa de ser 👎. A recarga não pisca: o skeleton é só da
         primeira carga. */
      if (novo === "nao_gostei" || atual === "nao_gostei") load();
      if (r?.proposta) {
        const { marca, contagem } = r.proposta;
        toast.message(
          `${contagem} recusas de marca "${marca}" neste alvo. Proibir essa marca aqui?`,
          { duration: 15000, action: { label: "Proibir", onClick: () => aplicarPreferencia(alvoId, marca) } },
        );
      }
    } catch (e: any) {
      toast.error(`Não deu para registrar: ${e.message ?? e}`);
    }
  }

  /** Aplica a marca proposta em `specs.termos_proibidos` — o mesmo campo que o
   *  formulário já mostra ("Exclui: ...") e que `avaliar()` já sabe recusar. Lê o
   *  `specs` fresco do banco antes de escrever: a cópia em `painel` pode estar
   *  velha se alguém editou o alvo enquanto a proposta ficava no ar. */
  async function aplicarPreferencia(alvoId: string, marca: string) {
    const { data: atual, error: eLer } = await db.from("facilities_radar_alvos")
      .select("specs").eq("id", alvoId).single();
    if (eLer) { toast.error(eLer.message); return; }
    const specs = atual.specs ?? {};
    const termos: string[] = specs.termos_proibidos ?? [];
    if (termos.some((t: string) => t.toLowerCase() === marca.toLowerCase())) {
      toast.info("Essa marca já estava excluída neste alvo.");
      return;
    }
    const { error } = await db.from("facilities_radar_alvos")
      .update({ specs: { ...specs, termos_proibidos: [...termos, marca] }, updated_at: new Date().toISOString() })
      .eq("id", alvoId);
    if (error) { toast.error(error.message); return; }
    toast.success(`Marca "${marca}" passa a ser recusada neste alvo a partir da próxima varredura.`);
    load();
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
    /* A rodada manual leva de meio a dois minutos por metade. Sem um aviso que
       diga em que etapa está, a pessoa só vê um ícone girando e clica de novo. */
    const progresso = toast.loading("Buscando nas lojas… (costuma levar até 2 min)");
    try {
      const r = await invocar<any>(supabase.functions.invoke("facilities-radar", {
        body: alvoId ? { action: "varrer", alvo_id: alvoId } : { action: "varrer" },
      }));
      toast.loading("Conferindo estoque e frete dos achados…", { id: progresso });

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

      /* RODADA SEM ALVO NÃO É RODADA COM ZERO ACHADO — mesma distinção do freio
         de crédito acima. A fila de "Varrer agora" só enxerga alvo em modo
         COMPRA; com o kit inteiro em vigia ela volta legitimamente vazia, e
         essa resposta não traz `ofertas`. Sem esta saída a linha de baixo
         interpolava o campo inexistente e a tela dizia "undefined anúncio(s)
         dentro dos filtros" — um defeito aparente no lugar de uma explicação.
         A frase é montada aqui, e não no servidor, porque quem sabe QUANTOS
         alvos estão em cada regime é esta tela: dizer "os semanais entram
         quando a cadência vence" a quem só tem alvos em vigia é verdadeiro e
         inútil; dizer onde fica o botão que varre agora, não. */
      if (!r.alvos) {
        const { vigia: emVigia, compra: emCompra } = regimes;
        toast.info(
          /* Fila com alvo e zero varridos = o relógio da rodada já tinha acabado,
             quase sempre porque um cron (ou outra pessoa) está varrendo agora. */
          r.restante
            ? "O radar está no meio de outra rodada agora — tente de novo em 2 minutos."
            : !alvoId && emVigia && !emCompra
            ? `Nenhum alvo em modo compra — os ${emVigia} em vigia são varridos uma vez por semana, e "Varrer agora" não os acorda. ` +
              "Para varrer um deles agora, use o ⟳ do card."
            : (r.mensagem ?? "Nenhum alvo na hora de varrer."),
          { duration: 10000 },
        );
        setOfertas({});
        await load();
        return;
      }

      const partes = [`${r.ofertas ?? 0} anúncio(s) dentro dos filtros`];
      if (confirmados) partes.push(`${confirmados} confirmado(s) com estoque`);
      else if (r.alertas) partes.push(`${r.alertas} em conferência`);
      if (r.restante) partes.push(`${r.restante} alvo(s) ficaram para a próxima rodada`);
      toast.success(partes.join(" · "));

      /* O RETORNO AUTOMÁTICO PRECISA SER VISÍVEL. O alvo acordado volta à vigia
         sozinho quando os 14 dias vencem — e, sem este aviso, alguém abre a
         tela, vê o card sem o selo de compra e conclui que outra pessoa
         desligou pelas costas. Um automatismo silencioso vira desconfiança. */
      if (r.dormiram > 0) {
        toast.info(
          `${r.dormiram} alvo(s) voltaram à vigia — o prazo do modo de compra venceu. A curva continua, o aviso não.`,
          { duration: 9000 },
        );
      }

      /* Fonte que falhou não pode sumir calada: é assim que um radar "funciona"
         por semanas devolvendo zero. A mesma leitura alimenta o resumo fixo
         "Última rodada" do topo, que continua lá depois que o toast some. */
      const { falhas, foraDoAssunto } = lerFontes(r.por_alvo);
      if (falhas.length) toast.warning(falhas.join("\n"), { duration: 10000 });
      // Loja que saiu sozinha precisa ser dita, senão parece que alguém a desmarcou.
      if (foraDoAssunto.length) {
        toast.info(
          `${foraDoAssunto.join(", ")} ficaram de fora: nas últimas leituras nenhum anúncio delas era o produto. ` +
          "Voltam a ser consultadas em uma semana.",
          { duration: 9000 },
        );
      }

      setOfertas({});
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "A varredura falhou.");
      /* O servidor grava por alvo antes de terminar: mesmo com erro (ou 504 do
         gateway) parte da rodada já está no banco, e o card precisa mostrar. */
      setOfertas({});
      load();
    } finally {
      toast.dismiss(progresso);
      setVarrendo(null);
    }
  }

  /* O TERMO DE BUSCA ENVELHECE CALADO — ver `sugerir_busca` na função. A IA lê
     as recusas das últimas rodadas e propõe; nada muda até a pessoa aplicar. */
  async function sugerirBusca(l: PainelLinha) {
    const id = l.alvo.id;
    setSugestoes((p) => ({ ...p, [id]: { carregando: true } }));
    try {
      const r = await invocar<SugestaoBusca>(supabase.functions.invoke("facilities-radar", {
        body: { action: "sugerir_busca", alvo_id: id },
      }));
      if (r?.ok === false) throw new Error(r.erro ?? "Não deu para sugerir agora.");
      setSugestoes((p) => ({ ...p, [id]: { carregando: false, dados: r } }));
    } catch (e: any) {
      toast.error(e.message ?? "Não deu para sugerir agora.");
      setSugestoes((p) => ({ ...p, [id]: { carregando: false } }));
    }
  }

  async function aplicarBusca(l: PainelLinha, proposta: string) {
    // Lê o `specs` fresco: a cópia do painel pode estar velha (mesmo cuidado de `aplicarPreferencia`).
    const { data: atual, error: eLer } = await db.from("facilities_radar_alvos")
      .select("specs").eq("id", l.alvo.id).single();
    if (eLer) { toast.error(eLer.message); return; }
    const specs = atual.specs ?? {};
    const outras = ((specs.buscas ?? []) as string[]).filter((b) => b.toLowerCase() !== proposta.toLowerCase());
    const { error } = await db.from("facilities_radar_alvos")
      /* Busca nova, medida nova: zera `fontes_rendimento` como o formulário faz
         quando o pedido muda — loja que era "fora do assunto" pode render agora. */
      .update({ specs: { ...specs, buscas: [proposta, ...outras] }, fontes_rendimento: {}, updated_at: new Date().toISOString() })
      .eq("id", l.alvo.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Busca trocada — vale a partir da próxima varredura.");
    setSugestoes((p) => { const n = { ...p }; delete n[l.alvo.id]; return n; });
    setOfertas({});
    load();
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
    /* DISPENSAR TEM VOLTA. Um clique errado sumia com um achado conferido, e o
       próximo só aparece depois de outra varredura e outra conferência. */
    if (alvo && status === "arquivado") {
      toast.success("Achado dispensado.", {
        duration: 8000,
        action: {
          label: "Desfazer",
          onClick: async () => {
            const { error: e } = await db.from("facilities_radar_alertas").update({ status: alvo.status }).eq("id", id);
            if (e) { toast.error(e.message); return; }
            load();
          },
        },
      });
    }
    setAlertas((p) => p.filter((a) => a.id !== id));
    invalidarRadarAlertas();
    // Só o alvo dono do alerta perde um do contador — e só se ele ainda era "novo".
    if (alvo?.status === "novo") {
      setPainel((p) => p.map((l) => (l.alvo.id === alvo.alvo_id
        ? { ...l, alertas_novos: Math.max(0, l.alertas_novos - 1) }
        : l)));
    }
  }

  /* O MESMO TEXTO QUE O RADAR MANDA SOZINHO. Este botão continua existindo para
     colar num grupo ou noutra conversa, mas o formato é um só: duas versões da
     mesma mensagem divergiriam na primeira vez que alguém mexesse numa delas. */
  function copiar(lista: Alerta[], tituloAlvo: string, precoAlvo: number, quantidade = 1, unidade?: UnidadeBase | null) {
    const txt = textoWhats({
      alvo_titulo: tituloAlvo,
      preco_alvo: precoAlvo,
      quantidade,
      unidade,
      ofertas: lista.filter((a) => a.oferta).map((a) => ({
        // `preco` aqui é o do PRODUTO; o texto soma o frete e mostra a conta.
        titulo: a.oferta!.titulo, preco: Number(a.oferta!.preco), url: a.oferta!.url,
        fonte: fonteLabel(a.oferta!.fonte), vendedor: a.oferta!.vendedor,
        motivo: a.texto, conferir: a.oferta!.conferir ?? [],
        frete_valor: a.frete_valor, frete_texto: a.oferta!.frete_texto,
        tipo: a.tipo as TipoAlerta,
        // `alertas.preco` JÁ É o comparável (unitário no alvo recorrente, total
        // com frete nos demais) — é o que a conferência grava.
        comparavel: Number(a.preco), embalagem: a.oferta!.embalagem_texto,
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

  /**
   * O interruptor entre os dois regimes — e é ele que o módulo inteiro existe
   * para oferecer.
   *
   * LIGAR PASSA PELA RPC, e não por um update. `facilities_radar_acordar` faz
   * três coisas que têm de andar juntas (o modo, a cadência e o prazo de volta)
   * e acorda os MODELOS ADOTADOS da faixa no mesmo movimento: quem adotou um
   * modelo quer o preço dele no dia da compra, não a média da faixa. A mesma
   * regra é usada pelo gatilho da Solicitação — dois caminhos, uma regra.
   *
   * E O PRAZO É O PONTO. Sem o retorno automático em 14 dias, o modo de compra
   * vira o permanente por esquecimento: liga-se numa terça, compra-se na
   * quinta, e o alvo segue a 20 créditos por dia até alguém desconfiar olhando
   * o painel de créditos.
   */
  async function alternarModo(l: PainelLinha) {
    if (l.alvo.modo === "vigia") {
      const { data, error } = await db.rpc("facilities_radar_acordar", { p_alvo_id: l.alvo.id, p_dias: 14 });
      if (error) { toast.error(error.message); return; }
      const n = Number(data ?? 1);
      toast.success(
        (n > 1
          ? `Modo de compra ligado em ${n} alvos — a faixa e os modelos adotados dela. `
          : "Modo de compra ligado — 5 fontes, 4× ao dia, com conferência de estoque e aviso. ") +
        "Volta a vigiar sozinho em 14 dias.",
        { duration: 8000 },
      );
    } else {
      /* O CHECK DO BANCO PEGARIA ISTO, mas devolveria uma linha de Postgres.
         Consumível não entra na vigia permanente — a Takeat tem fornecedor
         fechado de copa e limpeza, e o barateamento da vigia não muda a decisão
         de 28/08/2026. Aqui o alvo se PAUSA; vigiar, não. */
      if ((l.alvo.specs as any)?.unidade) {
        toast.error(
          "Consumível não entra na vigia permanente — a Takeat já tem fornecedor de copa e limpeza. Pause o alvo em vez disso.",
          { duration: 8000 },
        );
        return;
      }
      /* O filho volta junto com o pai. `.or` e não dois updates: são a mesma
         decisão, e metade dela aplicada deixaria o modelo adotado em ritmo de
         compra sozinho — o gasto que ninguém ligou e ninguém vê. */
      const { error } = await db.from("facilities_radar_alvos")
        .update({ modo: "vigia", compra_ate: null, cadencia_dias: 7, updated_at: new Date().toISOString() })
        .or(`id.eq.${l.alvo.id},pai_id.eq.${l.alvo.id}`);
      if (error) { toast.error(error.message); return; }
      toast.success("De volta à vigia — a curva continua andando, em silêncio, uma vez por semana.");
    }
    setOfertas({});
    load();
  }

  /**
   * Adotar um modelo: a oferta que agradou vira alvo próprio, sob a faixa.
   *
   * A FAIXA MEDE O MERCADO, O MODELO MEDE O PRODUTO — e os dois correm juntos,
   * no mesmo regime barato. O específico não substitui o genérico: é a curva da
   * faixa que dá sentido à do modelo ("está 12% acima da mediana de mouse"), e
   * sem ela o preço do modelo é um número solto.
   *
   * A INTERPRETAÇÃO É A MESMA DO FORMULÁRIO, e de propósito. Copiar
   * `specs_lidas` do anúncio pareceria mais direto e produziria um alvo sem
   * `buscas` — os termos que as vitrines de fato recebem. Alvo sem busca boa
   * varre, custa crédito e não acha nada: o defeito mudo, outra vez.
   * Vai sem `link_ref` para não pagar uma raspagem: o título de anúncio já é
   * uma descrição completa do produto, e a `ficha` (quando existe) é o que a
   * conferência transcreveu da própria página.
   */
  async function adotarModelo(pai: PainelLinha, o: Oferta) {
    if (pai.alvo.pai_id) {
      toast.error("A árvore tem dois níveis: adote a partir da faixa, não de um modelo já adotado.");
      return;
    }
    setAdotando(o.id);
    try {
      const r = await invocar<any>(supabase.functions.invoke("facilities-radar", {
        body: { action: "interpretar", pedido: [o.titulo, o.ficha].filter(Boolean).join(" — ") },
      }));
      const visto = Number(o.preco_total ?? o.preco);
      const { error } = await db.from("facilities_radar_alvos").insert({
        titulo: o.titulo.slice(0, 90),
        pedido: o.titulo,
        link_ref: o.url,
        categoria: pai.alvo.categoria,
        specs: r.specs,
        /* A referência nasce no preço em que o modelo foi visto, e não no teto
           da faixa — que é de outra escala e reprovaria o modelo no primeiro
           dia. A curva corrige em 14 dias, e o formulário mostra a sugestão. */
        preco_alvo: visto > 0 ? Math.round(visto) : Number(pai.alvo.preco_alvo),
        quantidade: pai.alvo.quantidade ?? 1,
        fontes: pai.alvo.fontes,
        modo: "vigia",
        cadencia_dias: 7,
        pai_id: pai.alvo.id,
        criado_por: profile?.nome ?? null,
      });
      if (error) { toast.error(error.message); return; }
      toast.success(`Modelo adotado sob "${pai.alvo.titulo}" — passa a ter curva própria a partir de segunda.`);
      load();
    } catch (e: any) {
      toast.error(e.message ?? "Não consegui ler o anúncio para adotar o modelo.");
    } finally { setAdotando(null); }
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

  /* A ÁRVORE, ACHATADA na ordem que o painel já devolve — a RPC põe o modelo
     adotado logo depois da faixa dele, usando a chave de ordenação DO PAI.
     Achatar em vez de aninhar mantém um laço de renderização só: o recuo do
     filho vira uma classe, não uma estrutura, e o card continua sendo o mesmo
     nos dois casos. */
  const linhas = useMemo(() => {
    const ids = new Set(painel.map((l) => l.alvo.id));
    const titulos = new Map(painel.map((l) => [l.alvo.id, l.alvo.titulo]));
    return painel.map((l) => ({
      l,
      /* Filho ÓRFÃO volta a ser raiz. O `pai_id` é `on delete set null` de
         propósito — apagar a faixa não pode levar junto a curva do modelo, que
         é histórico legítimo de mercado —, e um filho recuado sob nada pareceria
         defeito de tela. */
      filho: !!l.alvo.pai_id && ids.has(l.alvo.pai_id),
      pai: l.alvo.pai_id ? titulos.get(l.alvo.pai_id) ?? null : null,
    }));
  }, [painel]);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* O título da página é da moldura (RadarDeCompras); aqui é o da aba. */}
          <h2 className="text-[18px] font-semibold tracking-tight text-foreground">Produtos e equipamentos</h2>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Registre o equipamento e o quanto vale a pena pagar. O Hub olha as lojas e os comparadores em dois regimes: em{" "}
            <span className="font-medium text-foreground">vigia</span>, uma vez por semana e em silêncio, só para construir a curva do
            que a empresa compra sempre; em <span className="font-medium text-foreground">compra</span>, quatro vezes ao dia, com
            conferência de estoque e aviso. O botão no card troca de um para o outro — e o de compra volta a vigiar sozinho em 14 dias.
          </p>
          {/* Quando o radar age, e com quanto ele ainda pode agir. As duas
              respostas moram na mesma linha porque é a mesma pergunta: dá para
              contar com ele hoje? */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProximaVarredura emCompra={regimes.compra} emVigia={regimes.vigia} />
            <SaldoRaspagem />
          </div>
          <UltimaRodada versao={versao} />
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

      {/* Skeleton só na PRIMEIRA carga. Nas recargas (pausar, varrer, salvar) a
          tela fica onde está: trocar tudo por um bloco cinza fazia a página
          piscar e a rolagem pular para o topo a cada clique. */}
      {loading && painel.length === 0 ? (
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
                      <Button size="sm" variant="ghost" onClick={() => copiar(lista, tituloAlvo, teto, linha?.alvo.quantidade ?? 1, linha?.alvo.specs?.unidade ?? null)}>
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
                                {/* DISPENSAR ≠ RECUSAR. Dispensar tira este aviso e
                                    deixa o produto avisar de novo se o preço cair;
                                    o 👎 diz "não compro este" e ele some de vez. */}
                                <Button size="sm" variant="ghost" onClick={() => mudarStatus(al.id, "arquivado")}
                                  title="Tira este aviso. O produto volta a avisar se o preço cair mais.">
                                  Dispensar
                                </Button>
                                <Button size="sm" variant="ghost" className="ghost-icone text-muted-foreground"
                                  onClick={() => classificar(al.alvo_id, al.oferta_id, "nao_gostei")}
                                  title="Não compro este produto — some daqui, da tabela e dos avisos">
                                  <ThumbsDown className="h-3.5 w-3.5" />
                                </Button>
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

          {/* --------------------------------------------------------- kits */}
          {/* Antes da lista de alvos porque é a leitura de cima para baixo: o
              conjunto responde a pergunta da compra ("quanto custa a estação?"),
              e as linhas abaixo são a conferência dela. */}
          <Kits alvos={alvosDoKit} versao={versao} />

          {/* -------------------------------------------------------- alvos */}
          <div className="flex items-center gap-2 pt-1">
            <h2 className="text-[15px] font-semibold text-foreground">O que o radar está vigiando</h2>
            {/* Os dois números separados, porque custam ordens de grandeza
                diferentes: um alvo em compra vale ~65 em vigia. Um total só
                esconderia justamente a conta que interessa ao olhar a fatura
                de raspagem. */}
            <span className="text-[12px] text-muted-foreground">
              {regimes.vigia} em vigia · {regimes.compra} em compra
            </span>
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
              {linhas.map(({ l, filho, pai }) => {
                const expandido = aberto === l.alvo.id;
                const emVigia = l.alvo.modo === "vigia";
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
                /* O filtro "só no teto" só vale quando há algo no teto: com zero,
                   esconder tudo daria uma tabela vazia com cara de radar quebrado. */
                /* O RECUSADO SAI ANTES DE TUDO — das contagens também, senão o
                   "22 no teto" continuaria contando o que a pessoa já descartou. */
                const votosDoAlvo = feedback[l.alvo.id] ?? {};
                const todasDoAlvo = ofertas[l.alvo.id];
                const descartados = todasDoAlvo?.filter((o) => votosDoAlvo[o.id] === "nao_gostei").length ?? 0;
                const listaDoAlvo = verDescartados
                  ? todasDoAlvo
                  : todasDoAlvo?.filter((o) => votosDoAlvo[o.id] !== "nao_gostei");
                const acimaDoTeto = listaDoAlvo?.filter((o) => o.dentro_do_teto === false).length ?? 0;
                const cabemNoTeto = (listaDoAlvo?.length ?? 0) - acimaDoTeto;
                const filtrando = soNoTeto && cabemNoTeto > 0;
                const visiveis = listaDoAlvo?.filter((o) => !filtrando || o.dentro_do_teto !== false) ?? [];
                const mapaJuntados = mapaDeJuntados(juntados[l.alvo.id]);
                const grupos = agruparIguais(visiveis, mapaJuntados);
                const marcados = grupos.filter((g) => selecao.has(g[0].id)).map((g) => g[0]);
                const sugIguais = sugestoesIguais[l.alvo.id];
                const sugestao = sugestoes[l.alvo.id];
                const buscaAtual = ((l.alvo.specs as any)?.buscas?.[0] as string | undefined) ?? l.alvo.titulo;
                return (
                  <div
                    key={l.alvo.id}
                    className={cn(
                      "card-surface",
                      !l.alvo.ativo && "opacity-60",
                      // O modelo adotado mora sob a faixa: recuo e um filete à
                      // esquerda, que é o que liga os dois sem precisar de caixa.
                      filho && "ml-4 border-l-2 border-l-primary/40 sm:ml-8",
                    )}
                  >
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

                          {/* O REGIME NO ROSTO DO CARD. Sem este selo, o alvo em
                              vigia é indistinguível de um alvo de compra que
                              parou de achar coisa — e o diagnóstico dos dois é
                              oposto: um está calado porque foi mandado calar, o
                              outro porque quebrou. */}
                          {emVigia ? (
                            <span
                              className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground"
                              title="Vigia permanente: 2 fontes, uma vez por semana, sem conferência de estoque e sem aviso. Só constrói a curva."
                            >
                              <Eye className="h-3 w-3" /> vigia
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
                              title="Modo de compra: 5 fontes, 4× ao dia, com conferência de estoque e frete, e com aviso."
                            >
                              <ShoppingCart className="h-3 w-3" /> em compra
                              {l.alvo.compra_ate && ` até ${fmtData(l.alvo.compra_ate)}`}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {filho && pai && (
                            <span className="mr-1 text-foreground/70">modelo de <span className="font-medium">{pai}</span> ·</span>
                          )}
                          {resumoDoAlvo(l.alvo.specs)}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Teto</div>
                        <div className="num text-[13px] font-medium text-foreground">{fmtBRL(Number(l.alvo.preco_alvo))}</div>
                      </div>

                      <div className="text-right">
                        {/* "MELHOR AGORA" PROMETE UMA COMPRA, e em vigia esse
                            preço não passou pela conferência de estoque — a
                            vitrine continua listando o esgotado com o último
                            preço praticado. "Menor visto" é o que o número de
                            fato é, e o hover diz por quê. */}
                        <div
                          className="text-[10.5px] uppercase tracking-wide text-muted-foreground"
                          title={emVigia ? "Em vigia o preço não passa pela conferência de estoque — serve para medir o mercado, não para decidir a compra." : undefined}
                        >
                          {emVigia ? "Menor visto" : "Melhor agora"}
                        </div>
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
                        <div title="Anúncios ativos que cabem no teto">{l.ofertas_ativas} no teto</div>
                        {/* "há 3 horas" diz se dá para confiar no número; a data cheia fica no hover. */}
                        <div title={l.alvo.ultima_varredura ? new Date(l.alvo.ultima_varredura).toLocaleString("pt-BR") : undefined}>
                          {l.alvo.ultima_varredura
                            ? `varrido ${formatDistanceToNowStrict(new Date(l.alvo.ultima_varredura), { locale: ptBR, addSuffix: true })}`
                            : "nunca varrido"}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {/* A AÇÃO PRINCIPAL DO CARD, e por isso é a única com
                            texto no meio de uma fileira de ícones. É ela que o
                            Facilities vai procurar no dia em que a compra
                            começar de verdade. */}
                        <Button
                          size="sm"
                          variant={emVigia ? "outline" : "ghost"}
                          onClick={() => alternarModo(l)}
                          title={emVigia
                            ? "Sobe para 5 fontes, 4× ao dia, com conferência de estoque e aviso. Volta a vigiar sozinho em 14 dias."
                            : "Volta ao regime barato: 2 fontes, uma vez por semana, sem aviso."}
                        >
                          {emVigia
                            ? <><ShoppingCart className="mr-1.5 h-3.5 w-3.5" /> Estou comprando</>
                            : <><Eye className="mr-1.5 h-3.5 w-3.5" /> Voltar a vigiar</>}
                        </Button>
                        <Button size="sm" variant="ghost" className="ghost-icone"
                          title={l.alvo.ativo ? "Varrer só este alvo" : "Alvo pausado — retome para varrer"}
                          onClick={() => varrer(l.alvo.id)} disabled={!!varrendo || !l.alvo.ativo}>
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
                        {/* O TERMO QUE AS LOJAS RECEBEM, à vista. Um termo ruim não
                            dá erro, dá silêncio — e é daqui que se pede outro. */}
                        <div className="border-b border-border px-4 py-2 text-[11.5px] text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>Busca usada nas lojas: <span className="font-medium text-foreground">"{buscaAtual}"</span></span>
                            <Button
                              size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                              disabled={sugestao?.carregando}
                              onClick={() => sugerirBusca(l)}
                              title="A IA lê o que foi recusado nas últimas rodadas e propõe um termo melhor. Nada muda até você aplicar."
                            >
                              {sugestao?.carregando
                                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                : <Wand2 className="mr-1 h-3 w-3" />}
                              Melhorar a busca
                            </Button>
                          </div>
                          {sugestao?.dados && (
                            <div className="mt-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                              {!sugestao.dados.pode ? (
                                <span>{sugestao.dados.texto}</span>
                              ) : !sugestao.dados.mudou ? (
                                <span>A busca atual já está boa. {sugestao.dados.porque}</span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span>
                                    Sugestão: <span className="font-medium text-foreground">"{sugestao.dados.proposta}"</span> — {sugestao.dados.porque}
                                    {!!sugestao.dados.recusados && ` (${sugestao.dados.evitaveis ?? 0} de ${sugestao.dados.recusados} recusas seriam evitadas)`}
                                  </span>
                                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                                    onClick={() => aplicarBusca(l, sugestao.dados!.proposta!)}>
                                    Aplicar
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                                    onClick={() => setSugestoes((p) => { const n = { ...p }; delete n[l.alvo.id]; return n; })}>
                                    Manter a atual
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        {!listaDoAlvo ? (
                          <div className="p-4"><Skeleton className="h-24 rounded" /></div>
                        ) : listaDoAlvo.length === 0 && descartados > 0 ? (
                          <div className="p-6 text-center text-[12.5px] text-muted-foreground">
                            Você descartou {descartados === 1 ? "o único anúncio" : `todos os ${descartados} anúncios`} desta lista.
                            A próxima varredura traz o que aparecer de novo.{" "}
                            <button type="button" className="text-primary hover:underline" onClick={() => setVerDescartados(true)}>
                              rever os descartados
                            </button>
                          </div>
                        ) : listaDoAlvo.length === 0 ? (
                          <div className="p-6 text-center text-[12.5px] text-muted-foreground">
                            Nenhum anúncio passou nos filtros na última varredura. Se isso persistir, o pedido pode estar exigindo demais —
                            edite e afrouxe uma spec.
                          </div>
                        ) : (
                          <>
                          {(acimaDoTeto > 0 || descartados > 0) && (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-1.5 text-[11.5px] text-muted-foreground">
                              <span>
                                {acimaDoTeto > 0 && <>{cabemNoTeto} no teto · {acimaDoTeto} acima do teto{filtrando && " (ocultos)"}</>}
                                {acimaDoTeto > 0 && descartados > 0 && " · "}
                                {descartados > 0 && <>{descartados} descartado{descartados > 1 ? "s" : ""}{!verDescartados && " (ocultos)"}</>}
                              </span>
                              <span className="flex flex-wrap items-center gap-3">
                                {descartados > 0 && (
                                  <button type="button" className="text-primary hover:underline" onClick={() => setVerDescartados((v) => !v)}>
                                    {verDescartados ? "esconder os descartados" : "rever os descartados"}
                                  </button>
                                )}
                                {acimaDoTeto > 0 && cabemNoTeto > 0 && (
                                  <button type="button" className="text-primary hover:underline" onClick={() => setSoNoTeto((v) => !v)}>
                                    {soNoTeto ? `ver também os ${acimaDoTeto} acima do teto` : "mostrar só o que cabe no teto"}
                                  </button>
                                )}
                              </span>
                            </div>
                          )}
                          {/* JUNTAR À MÃO: cada comparador corta o título num ponto
                              diferente, e a regra não se arrisca a adivinhar. */}
                          {grupos.length > 1 && (
                            <div className={cn("flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-1.5 text-[11.5px]", marcados.length > 0 && "bg-primary/5")}>
                              <span className="text-muted-foreground">
                                {marcados.length === 0
                                  ? "Mesmo produto em linhas separadas? Marque e junte."
                                  : marcados.length === 1
                                    ? "Marque outro anúncio do mesmo produto para juntar."
                                    : `${marcados.length} anúncios marcados`}
                              </span>
                              <span className="flex items-center gap-2">
                                <Button
                                  size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                                  disabled={sugIguais?.carregando}
                                  onClick={() => sugerirIguais(l.alvo.id)}
                                  title="A IA lê os títulos e aponta os que parecem o mesmo produto. Nada é juntado até você confirmar."
                                >
                                  {sugIguais?.carregando
                                    ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                    : <Wand2 className="mr-1 h-3 w-3" />}
                                  Sugerir junções
                                </Button>
                                {marcados.length > 0 && (
                                  <>
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setSelecao(new Set())}>
                                      Limpar
                                    </Button>
                                    <Button
                                      size="sm" className="h-6 px-2 text-[11px]"
                                      disabled={marcados.length < 2 || juntando}
                                      onClick={() => juntar(l.alvo.id, marcados)}
                                      title="Passam a aparecer numa linha só, com a mais barata na frente — também nas próximas varreduras. O 👎 num deles vale para todos."
                                    >
                                      {juntando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                      Juntar como o mesmo produto
                                    </Button>
                                  </>
                                )}
                              </span>
                            </div>
                          )}
                          {/* A IA PROPÕE, A PESSOA CARIMBA. Cada sugestão já passou
                              pela trava (títulos que se contradizem não chegam aqui). */}
                          {sugIguais?.dados && (
                            <div className="space-y-1.5 border-b border-border bg-muted/30 px-4 py-2 text-[11.5px]">
                              {!sugIguais.dados.pode ? (
                                <span className="text-muted-foreground">{sugIguais.dados.texto}</span>
                              ) : !sugIguais.dados.sugestoes?.length ? (
                                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                                  <span>
                                    Nenhuma junção a sugerir entre as {sugIguais.dados.linhas} linhas.
                                    {!!sugIguais.dados.barradas && ` (${sugIguais.dados.barradas} proposta${sugIguais.dados.barradas > 1 ? "s" : ""} da IA barrada${sugIguais.dados.barradas > 1 ? "s" : ""} porque os títulos se contradiziam.)`}
                                  </span>
                                  <button type="button" className="text-primary hover:underline"
                                    onClick={() => setSugestoesIguais((p) => { const n = { ...p }; delete n[l.alvo.id]; return n; })}>
                                    fechar
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="text-muted-foreground">
                                    Parecem o mesmo produto — confira antes de juntar:
                                    {!!sugIguais.dados.barradas && ` (${sugIguais.dados.barradas} outra${sugIguais.dados.barradas > 1 ? "s" : ""} barrada${sugIguais.dados.barradas > 1 ? "s" : ""} pela trava)`}
                                  </div>
                                  {sugIguais.dados.sugestoes.map((sg, k) => (
                                    <div key={sg.ofertas.map((o) => o.id).join("-")} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                                      <div className="min-w-0 flex-1 space-y-0.5">
                                        {sg.ofertas.map((o) => (
                                          <div key={o.id} className="flex items-center gap-2">
                                            {o.imagem_url && (
                                              <img src={o.imagem_url} alt="" loading="lazy"
                                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                                className="h-6 w-6 shrink-0 rounded border border-border bg-white object-contain" />
                                            )}
                                            <span className="truncate text-foreground" title={o.titulo}>{o.titulo}</span>
                                            <span className="shrink-0 text-muted-foreground">
                                              · {o.vendedor ?? fonteLabel(o.fonte)} · <span className="num">{fmtBRLStr(Number(o.preco_total ?? o.preco))}</span>
                                            </span>
                                          </div>
                                        ))}
                                        {sg.porque && <div className="text-muted-foreground">{sg.porque}</div>}
                                      </div>
                                      <div className="flex shrink-0 gap-1">
                                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => tirarSugestao(l.alvo.id, k)}>
                                          Ignorar
                                        </Button>
                                        <Button
                                          size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                                          disabled={juntando}
                                          onClick={async () => {
                                            const ofs = (todasDoAlvo ?? []).filter((o) => sg.ofertas.some((x) => x.id === o.id));
                                            if (ofs.length < 2) { toast.error("Algum desses anúncios saiu da lista — peça a sugestão de novo."); return; }
                                            if (await juntar(l.alvo.id, ofs)) tirarSugestao(l.alvo.id, k);
                                          }}
                                        >
                                          Juntar
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                          <div className="max-h-[420px] overflow-y-auto">
                            <table className="w-full border-collapse">
                              <thead className="sticky top-0 z-10 bg-muted">
                                <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                                  <th className="w-8 py-2 pl-4 pr-0" title="Marque anúncios do mesmo produto para juntá-los" />
                                  <th className="px-4 py-2 font-semibold">Anúncio</th>
                                  <th className="px-3 py-2 font-semibold">Onde</th>
                                  <th className="px-3 py-2 font-semibold">Frete</th>
                                  <th className="px-3 py-2 text-right font-semibold">Mín. visto</th>
                                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                                  <th className="px-3 py-2" />
                                </tr>
                              </thead>
                              <tbody>
                                {/* O MESMO PRODUTO por três comparadores vira UMA linha:
                                    a mais barata, com as outras lojas a um clique. */}
                                {grupos.flatMap((g) => {
                                  const grupoAberto = gruposAbertos.has(g[0].id);
                                  return (grupoAberto ? g : g.slice(0, 1)).map((o, i) => (
                                  <tr key={o.id} className={cn("border-t border-border/60", i > 0 && "border-border/30 bg-muted/30", votosDoAlvo[o.id] === "nao_gostei" && "opacity-50")}>
                                    <td className="w-8 py-2 pl-4 pr-0 align-top">
                                      {i === 0 ? (
                                        <Checkbox
                                          className="mt-3"
                                          checked={selecao.has(o.id)}
                                          aria-label="Marcar para juntar"
                                          title="Marcar para juntar com outro anúncio do mesmo produto"
                                          onCheckedChange={(v) => setSelecao((p) => {
                                            const n = new Set(p);
                                            if (v) n.add(o.id); else n.delete(o.id);
                                            return n;
                                          })}
                                        />
                                      ) : mapaJuntados.has(norm(o.titulo)) && (
                                        <button
                                          type="button"
                                          className="mt-2.5 text-[10.5px] text-muted-foreground hover:text-foreground hover:underline"
                                          title="Não é o mesmo produto — volta a ter linha própria"
                                          onClick={() => separar(l.alvo.id, o)}
                                        >
                                          separar
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-4 py-2">
                                      <div className="flex items-start gap-2">
                                        {o.imagem_url && (
                                          <button
                                            type="button"
                                            className="shrink-0 cursor-zoom-in rounded"
                                            title="Ampliar a foto"
                                            onClick={() => setFoto({
                                              alvoId: l.alvo.id,
                                              lista: visiveis.filter((x) => x.imagem_url),
                                              idx: visiveis.filter((x) => x.imagem_url).findIndex((x) => x.id === o.id),
                                            })}
                                          >
                                            <img
                                              src={o.imagem_url}
                                              alt=""
                                              loading="lazy"
                                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                              className="h-10 w-10 rounded border border-border bg-white object-contain p-0.5 transition-shadow hover:ring-2 hover:ring-primary/40"
                                            />
                                          </button>
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
                                      {i === 0 && g.length > 1 && (
                                        <button
                                          type="button"
                                          className="mt-0.5 inline-flex items-center gap-0.5 text-[10.5px] text-primary hover:underline"
                                          title={g.slice(1).map((x) => `${x.vendedor ?? fonteLabel(x.fonte)} · ${fmtBRLStr(Number(x.preco_total ?? x.preco))}`).join("\n")}
                                          onClick={() => setGruposAbertos((p) => {
                                            const n = new Set(p);
                                            if (n.has(o.id)) n.delete(o.id); else n.add(o.id);
                                            return n;
                                          })}
                                        >
                                          {grupoAberto ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                          {grupoAberto ? "recolher" : `+${g.length - 1} ${g.length === 2 ? "loja" : "lojas"}`}
                                        </button>
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
                                      <div className={cn("num text-[13px] font-semibold", o.dentro_do_teto === false ? "text-muted-foreground" : "text-foreground")}>
                                        {fmtBRL(Number(o.preco_total ?? o.preco))}
                                      </div>
                                      {o.dentro_do_teto === false && (
                                        <div className="text-[10.5px] text-amber-700 dark:text-amber-400" title="Produto certo, preço acima do teto: entra na curva, não no contador do card.">
                                          acima do teto
                                        </div>
                                      )}
                                      {o.frete_valor != null && o.frete_valor > 0 && (
                                        <div className="num text-[10.5px] text-muted-foreground">{fmtBRLStr(Number(o.preco))} + frete</div>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="flex items-center justify-end gap-1">
                                        {/* O SINAL LEVE, antes do "adotar" pesado.
                                            Sem formulário e sem efeito na hora —
                                            só alimenta a próxima varredura (ver
                                            `classificar`). Reclicar no que já
                                            está aceso desfaz o voto. */}
                                        {(() => {
                                          const voto = feedback[l.alvo.id]?.[o.id];
                                          return (
                                            <>
                                              <Button
                                                size="sm" variant="ghost"
                                                className={cn("ghost-icone", voto === "gostei" && "bg-emerald-50 dark:bg-emerald-950/40")}
                                                onClick={() => classificar(l.alvo.id, o.id, "gostei")}
                                                title={voto === "gostei" ? "Você curtiu — clique para desfazer" : "Eu levaria em conta"}
                                              >
                                                <ThumbsUp className={cn("h-3.5 w-3.5", voto === "gostei" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")} />
                                              </Button>
                                              <Button
                                                size="sm" variant="ghost"
                                                className={cn("ghost-icone", voto === "nao_gostei" && "bg-red-50 dark:bg-red-950/40")}
                                                onClick={() => classificar(l.alvo.id, o.id, "nao_gostei")}
                                                title={voto === "nao_gostei" ? "Você recusou — clique para desfazer" : "Eu não levaria em conta"}
                                              >
                                                <ThumbsDown className={cn("h-3.5 w-3.5", voto === "nao_gostei" ? "text-destructive" : "text-muted-foreground")} />
                                              </Button>
                                            </>
                                          );
                                        })()}
                                        {/* ADOTAR SÓ A PARTIR DA FAIXA. A árvore
                                            tem dois níveis de propósito: um
                                            terceiro daria a mesma curva contada
                                            duas vezes e uma tela que ninguém lê. */}
                                        {!l.alvo.pai_id && (
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2 text-[11px]"
                                            disabled={adotando != null}
                                            onClick={() => adotarModelo(l, o)}
                                            title="Passa a acompanhar ESTE modelo com curva própria, sob esta faixa — no mesmo regime barato."
                                          >
                                            {adotando === o.id
                                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                              : <><Star className="mr-1 h-3 w-3" /> adotar</>}
                                          </Button>
                                        )}
                                        <a href={o.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                                          <ExternalLink className="h-3.5 w-3.5" />
                                        </a>
                                      </div>
                                    </td>
                                  </tr>
                                  ));
                                })}
                              </tbody>
                            </table>
                          </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Destinatarios />
        </>
      )}

      <NovoAlvoDialog
        alvo={editando}
        open={dialogAberto}
        onOpenChange={setDialogAberto}
        onSaved={() => { setOfertas({}); load(); }}
        onBuscarAgora={varrer}
      />

      <FotoAmpliada
        estado={foto}
        voto={foto ? feedback[foto.alvoId]?.[foto.lista[foto.idx]?.id] : undefined}
        onIr={(idx) => setFoto((f) => (f ? { ...f, idx } : f))}
        onFechar={() => setFoto(null)}
        onVotar={(sinal) => {
          if (!foto) return;
          const o = foto.lista[foto.idx];
          const jaTinha = feedback[foto.alvoId]?.[o.id] === sinal;
          classificar(foto.alvoId, o.id, sinal);
          // Votou (e não desfez)? Segue para o próximo — a triagem é o ponto.
          if (!jaTinha) {
            if (foto.idx < foto.lista.length - 1) setFoto({ ...foto, idx: foto.idx + 1 });
            else setFoto(null);
          }
        }}
      />
    </div>
  );
}

/** Foto do anúncio em tamanho de ver o produto, com o mesmo 👍/👎 da linha.
 *  ←/→ passam de anúncio; votar já avança para o próximo. */
function FotoAmpliada({ estado, voto, onIr, onFechar, onVotar }: {
  estado: { alvoId: string; lista: Oferta[]; idx: number } | null;
  voto: "gostei" | "nao_gostei" | undefined;
  onIr: (idx: number) => void;
  onFechar: () => void;
  onVotar: (sinal: "gostei" | "nao_gostei") => void;
}) {
  const o = estado?.lista[estado.idx];
  const total = estado?.lista.length ?? 0;
  const idx = estado?.idx ?? 0;

  useEffect(() => {
    if (!estado) return;
    /* A TRIAGEM PELO TECLADO: D descarta, L levaria, as setas passam. Uma mão
       no teclado dá conta de uma lista de quarenta fotos. */
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "arrowright" && idx < total - 1) onIr(idx + 1);
      else if (k === "arrowleft" && idx > 0) onIr(idx - 1);
      else if (k === "d") onVotar("nao_gostei");
      else if (k === "l") onVotar("gostei");
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [estado, idx, total, onIr, onVotar]);

  return (
    <Dialog open={!!o} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-2xl">
        {o && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 text-[14px] font-medium leading-snug">{o.titulo}</DialogTitle>
              <DialogDescription className="text-[12px]">
                {o.vendedor ?? fonteLabel(o.fonte)} · <span className="num">{fmtBRLStr(Number(o.preco_total ?? o.preco))}</span>
                {total > 1 && <> · {idx + 1} de {total}</>}
              </DialogDescription>
            </DialogHeader>

            <div className="relative flex items-center justify-center rounded-md border border-border bg-white p-2">
              <img
                key={o.id}
                src={o.imagem_url ?? ""}
                alt={o.titulo}
                className="max-h-[60vh] w-auto object-contain"
              />
              {idx > 0 && (
                <Button
                  size="icon" variant="secondary"
                  className="absolute left-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full shadow"
                  onClick={() => onIr(idx - 1)} title="Anterior (←)"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              {idx < total - 1 && (
                <Button
                  size="icon" variant="secondary"
                  className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full shadow"
                  onClick={() => onIr(idx + 1)} title="Próximo (→)"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <a href={o.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
                abrir anúncio <ExternalLink className="h-3 w-3" />
              </a>
              <div className="flex gap-2">
                <Button
                  size="sm" variant="outline"
                  className={cn(voto === "nao_gostei" && "border-destructive/50 bg-red-50 dark:bg-red-950/40")}
                  onClick={() => onVotar("nao_gostei")}
                  title={voto === "nao_gostei" ? "Você recusou — clique para desfazer" : "Eu não levaria em conta"}
                >
                  <ThumbsDown className={cn("mr-1.5 h-3.5 w-3.5", voto === "nao_gostei" && "text-destructive")} />
                  {voto === "nao_gostei" ? "Descartado" : "Descartar"}
                  <kbd className="ml-1.5 rounded border border-border px-1 text-[10px] text-muted-foreground">D</kbd>
                </Button>
                <Button
                  size="sm" variant="outline"
                  className={cn(voto === "gostei" && "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/40")}
                  onClick={() => onVotar("gostei")}
                  title={voto === "gostei" ? "Você curtiu — clique para desfazer" : "Eu levaria em conta"}
                >
                  <ThumbsUp className={cn("mr-1.5 h-3.5 w-3.5", voto === "gostei" && "text-emerald-700 dark:text-emerald-400")} />
                  {voto === "gostei" ? "Curtido" : "Levaria"}
                  <kbd className="ml-1.5 rounded border border-border px-1 text-[10px] text-muted-foreground">L</kbd>
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
