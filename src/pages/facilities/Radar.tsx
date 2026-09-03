import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownRight, ChevronDown, ChevronRight, Copy, Eye, ExternalLink,
  Loader2, PackageCheck, PackageX, Pause, PiggyBank, Play, Plus, Radar as RadarIcon, RefreshCw, ShoppingCart,
  Sparkles, Star, ThumbsDown, ThumbsUp, Trash2, TrendingDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
import { Kits } from "./Kits";

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

  async function abrirAlvo(id: string) {
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    if (ofertas[id]) return;
    const [{ data }, { data: votos }] = await Promise.all([
      db.from("facilities_radar_ofertas")
        .select("*").eq("alvo_id", id).eq("ativo", true)
        /* Esgotado apurado não entra na lista. `not.is.false` e não `neq`: o
           estoque desconhecido é `null` — o caso normal de quem ainda não foi
           conferido —, e `neq(false)` derrubaria esses junto. */
        .not("disponivel", "is", false)
        // Pelo TOTAL: o mais barato de verdade, não o de etiqueta menor.
        .order("preco_total", { ascending: true }).limit(60),
      db.from("facilities_radar_feedback").select("oferta_id, sinal").eq("alvo_id", id),
    ]);
    setOfertas((p) => ({ ...p, [id]: (data as Oferta[]) ?? [] }));
    setFeedback((p) => ({
      ...p,
      [id]: Object.fromEntries((votos ?? []).map((v: any) => [v.oferta_id, v.sinal])),
    }));
  }

  /**
   * 👍/👎 num anúncio — sem formulário, sem confirmação, e SEM EFEITO na tela
   * agora: só alimenta a próxima varredura (bônus de ranking em 👍, proposta de
   * regra depois de 👎 repetido). Reclicar no ícone já ativo desfaz o voto.
   *
   * OTIMISTA, e sem desfazer sozinho no erro: a chance real de falha aqui é de
   * rede, não de regra de negócio, e um segundo clique já resolve — regredir o
   * ícone sozinho arrisca uma correção que ninguém pediu brigar com o clique
   * seguinte da pessoa.
   */
  async function classificar(alvoId: string, ofertaId: number, sinal: "gostei" | "nao_gostei") {
    const atual = feedback[alvoId]?.[ofertaId];
    const novo = atual === sinal ? null : sinal;
    setFeedback((p) => {
      const doAlvo = { ...(p[alvoId] ?? {}) };
      if (novo) doAlvo[ofertaId] = novo; else delete doAlvo[ofertaId];
      return { ...p, [alvoId]: doAlvo };
    });
    try {
      const r = await invocar<any>(supabase.functions.invoke("facilities-radar", {
        body: { action: "classificar", oferta_id: ofertaId, sinal: novo },
      }));
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
          !alvoId && emVigia && !emCompra
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
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Radar de preços</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
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
                        <div>{l.ofertas_ativas} anúncio(s)</div>
                        <div>{l.alvo.ultima_varredura ? fmtData(l.alvo.ultima_varredura) : "nunca varrido"}</div>
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
