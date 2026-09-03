import { useEffect, useState } from "react";
import { Loader2, Search, Sparkles, TrendingDown, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { invocar } from "@/lib/erroEdge";
import { db, parseValor, fmtBRL, CATEGORIAS, type Solicitacao } from "./lib";
import { resumoDoAlvo, fonteLabel, pisoDePreco, UNIDADE_LABEL, type AlvoSpecs } from "@/lib/radarPrecos";

/**
 * As fontes, com o estado REAL de cada uma medido em 26/08/2026 — não a lista
 * do que seria bom ter. Marcar "funciona" no que devolve zero é o jeito mais
 * rápido de o Facilities perder a confiança na aba.
 */
const FONTES: { id: string; nota: string | null; ok: boolean }[] = [
  { id: "kabum", nota: null, ok: true },
  { id: "terabyte", nota: null, ok: true },
  { id: "buscape", nota: "várias lojas", ok: true },
  { id: "zoom", nota: "várias lojas", ok: true },
  { id: "bondfaro", nota: "várias lojas", ok: true },
  { id: "pichau", nota: null, ok: true },
  { id: "americanas", nota: null, ok: true },
  { id: "casasbahia", nota: null, ok: true },
  { id: "carrefour", nota: null, ok: true },
  { id: "balao", nota: "veio vazia no teste", ok: false },
  { id: "fastshop", nota: "veio vazia no teste", ok: false },
  { id: "amazon", nota: "bloqueia robô", ok: false },
  { id: "magalu", nota: "bloqueia robô", ok: false },
  { id: "mercado_livre", nota: "bloqueia robô", ok: false },
];

/** O que um alvo novo já vem marcando: só o que está medido e trazendo resultado. */
const FONTES_PADRAO = FONTES.filter((f) => f.ok).map((f) => f.id);

export interface AlvoRow {
  id: string;
  titulo: string;
  pedido: string;
  link_ref: string | null;
  categoria: string;
  specs: AlvoSpecs;
  preco_alvo: number;
  quantidade: number;
  solicitacao_id: string | null;
  fontes: string[];
  ativo: boolean;
  /** Equipamento que a empresa compra sempre: fixa no topo e entra primeiro na varredura. */
  favorito: boolean;
  /** Dias mínimos entre varreduras. 0 = toda rodada; 7 = o consumível semanal. */
  cadencia_dias: number;
  /**
   * O regime. `vigia` é a curva permanente e muda — duas fontes, uma vez por
   * semana, sem conferência e sem aviso; `compra` é o ritmo cheio de sempre.
   * São ~9 créditos de raspagem por mês contra ~600.
   */
  modo: "vigia" | "compra";
  /** A faixa de que este alvo é um modelo específico. Null na própria faixa. */
  pai_id: string | null;
  /** Quando o modo compra vence e o alvo volta sozinho à vigia. */
  compra_ate: string | null;
}

interface Props {
  alvo: AlvoRow | null;      // null = criando
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  /** Roda varredura + conferência já para este alvo, e só volta quando terminam. */
  onBuscarAgora?: (alvoId: string) => Promise<void>;
}

interface Sugestao {
  pode: boolean;
  dias: number;
  minimo: number;
  tipico: number;
  teto: number;
  veredito: "abaixo_do_minimo" | "apertado" | "bom" | "folgado" | null;
  texto: string;
}

const VEREDITO_ESTILO: Record<string, string> = {
  abaixo_do_minimo: "border-rose-200 bg-rose-50/60 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300",
  apertado: "border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  bom: "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  folgado: "border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
};

export function NovoAlvoDialog({ alvo, open, onOpenChange, onSaved, onBuscarAgora }: Props) {
  const { profile } = useAuth();
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [pedido, setPedido] = useState("");
  const [linkRef, setLinkRef] = useState("");
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState<string>("TI");
  const [precoTxt, setPrecoTxt] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  /* De quantos em quantos dias vale olhar. Zero é "toda rodada", que é o
     equipamento; o consumível nasce em 7 pela mão da interpretação. */
  const [cadencia, setCadencia] = useState(0);
  /* O REGIME. Nasce em `compra`, que é o comportamento de sempre — o mesmo
     motivo pelo qual a coluna no banco tem esse default. A vigia é o regime
     novo, e regime novo que se liga sozinho vira alvo que não avisa e ninguém
     entende por quê. */
  const [modo, setModo] = useState<"vigia" | "compra">("compra");
  const [fontes, setFontes] = useState<string[]>(FONTES_PADRAO);
  const [specs, setSpecs] = useState<AlvoSpecs | null>(null);
  const [solicId, setSolicId] = useState<string>("");
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    db.from("facilities_solicitacoes")
      .select("*")
      .in("status", ["solicitado", "em_cotacao", "aguardando_aprovacao"])
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }: any) => setSolicitacoes(data ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (alvo) {
      setPedido(alvo.pedido); setLinkRef(alvo.link_ref ?? ""); setTitulo(alvo.titulo);
      setCategoria(alvo.categoria); setPrecoTxt(String(alvo.preco_alvo));
      setQuantidade(String(alvo.quantidade)); setFontes(alvo.fontes ?? []);
      setCadencia(Number(alvo.cadencia_dias ?? 0));
      setModo(alvo.modo ?? "compra");
      setSpecs(alvo.specs ?? null); setSolicId(alvo.solicitacao_id ?? "");
    } else {
      setPedido(""); setLinkRef(""); setTitulo(""); setCategoria("TI"); setPrecoTxt("");
      setQuantidade("1"); setFontes(FONTES_PADRAO); setCadencia(0); setModo("compra");
      setSpecs(null); setSolicId("");
    }
  }, [open, alvo]);

  const preco = parseValor(precoTxt);
  /* Quem manda no modo recorrente é a interpretação: `unidade` presente = o teto
     é por quilo/litro/peça. Não há interruptor manual de propósito — o modo tem
     de bater com o que a regra do servidor vai aplicar, e ela lê daqui. */
  const unidade = specs?.unidade ?? null;

  /* A CURVA OPINA SOBRE O TETO — mas só num alvo que já existe, porque só ele
     tem histórico. Roda ao abrir e de novo quando o valor digitado muda: o
     Facilities precisa ver na hora que "R$ 3.000" nunca vai disparar, não
     descobrir isso três semanas depois olhando uma aba vazia. */
  useEffect(() => {
    if (!open || !alvo) { setSugestao(null); return; }
    let vivo = true;
    const t = setTimeout(() => {
      invocar<any>(supabase.functions.invoke("facilities-radar", {
        body: { action: "sugerir_teto", alvo_id: alvo.id, preco_alvo: preco || undefined },
      }))
        .then((r) => { if (vivo) setSugestao(r as Sugestao); })
        .catch(() => { /* sugestão é ajuda, não requisito: falhou, some */ });
    }, 500); // espera a digitação parar
    return () => { vivo = false; clearTimeout(t); };
  }, [open, alvo, preco]);

  async function interpretar() {
    if (!pedido.trim()) { toast.error("Escreva o que você quer monitorar."); return; }
    setLendo(true);
    try {
      const r = await invocar<any>(supabase.functions.invoke("facilities-radar", {
        body: { action: "interpretar", pedido, link_ref: linkRef || undefined },
      }));
      setSpecs(r.specs);
      if (!titulo) setTitulo(r.titulo ?? "");
      if (r.categoria_facilities) setCategoria(r.categoria_facilities);
      if (r.preco_alvo && !precoTxt) setPrecoTxt(String(r.preco_alvo));
      if (r.quantidade) setQuantidade(String(r.quantidade));
      if (Number.isFinite(r.cadencia_dias)) setCadencia(r.cadencia_dias);
      toast.success(r.leu_referencia ? "Li o pedido e o anúncio de referência." : "Pedido interpretado.");
    } catch (e: any) {
      toast.error(e.message ?? "Não consegui interpretar o pedido.");
    } finally { setLendo(false); }
  }

  /**
   * Salva e, opcionalmente, já sai buscando.
   *
   * O "buscar agora" existe para o caso real: alguém chega na mesa do Facilities
   * e pergunta quanto custa um monitor. Esperar o cron das 08:45 não serve — ele
   * precisa de uma primeira noção na hora. A varredura já roda encadeada com a
   * conferência, então em torno de dois minutos ele tem preço com estoque
   * confirmado, não só uma lista de anúncios.
   */
  async function salvar(buscarDepois = false) {
    if (!specs) { toast.error("Interprete o pedido antes de salvar — é dele que saem os filtros."); return; }
    if (!preco || preco <= 0) { toast.error("Defina o preço-teto."); return; }
    if (!fontes.length) { toast.error("Escolha pelo menos uma fonte."); return; }
    /* A PROIBIÇÃO DO CAFÉ, dita aqui em português. O banco tem o mesmo check
       (`radar_vigia_nao_e_consumivel`) e é ele que garante — mas o que chega da
       violação de constraint é uma linha de Postgres, e quem está preenchendo o
       formulário merece a razão: a Takeat tem fornecedor fechado de copa e
       limpeza, e vigiar preço deles é pagar raspagem para reconfirmar um número
       que ninguém vai usar. Pedido em 28/08/2026, e o barateamento da vigia não
       muda a decisão. */
    if (modo === "vigia" && specs.unidade) {
      toast.error(
        "Consumível não entra na vigia permanente — a Takeat já tem fornecedor de copa e limpeza. " +
        "Para comparar uma vez, deixe em “compra pontual” e use “Criar e buscar agora”.",
        { duration: 9000 },
      );
      return;
    }
    setSalvando(true);
    const linha = {
      titulo: titulo.trim() || pedido.slice(0, 80),
      pedido, link_ref: linkRef || null, categoria,
      specs, preco_alvo: preco, quantidade: Number(quantidade) || 1,
      modo,
      /* Em vigia a cadência é do REGIME, não do gosto de quem cadastra: o cron
         da vigia roda uma vez por semana, e um alvo com cadência 0 aqui só
         atravessaria a fila na frente dos outros sem ganhar rodada nenhuma. */
      cadencia_dias: modo === "vigia" ? Math.max(cadencia, 7) : cadencia,
      /* O PRAZO SÓ É TOCADO QUANDO O REGIME MUDA — e esta linha já esteve
         errada. Mandar `compra_ate: null` em todo salvamento significaria que
         corrigir o teto de um alvo ACORDADO apagaria, de quebra, o relógio que
         o faz voltar a vigiar: um alvo em ritmo de compra para sempre, por
         causa de uma edição que não tinha nada a ver com isso. É exatamente a
         falha que `compra_ate` existe para impedir, entrando pela porta dos
         fundos.
         Trocar o regime na mão, aí sim, zera o relógio: é uma decisão de gente,
         e decisão de gente não expira sozinha. */
      ...(alvo && alvo.modo === modo ? {} : { compra_ate: null }),
      solicitacao_id: solicId || null, fontes, updated_at: new Date().toISOString(),
      /* Quem cadastrou vira o solicitante quando o achado virar cotação — é o
         que `facilities_radar_virar_cotacao` usa. Sem isso a solicitação nasce
         órfã e ninguém sabe a quem perguntar. Só na criação: editar um alvo não
         transfere a autoria para quem passou por ali. */
      ...(alvo ? {} : { criado_por: profile?.nome ?? null }),
    };
    const { data, error } = alvo
      ? await db.from("facilities_radar_alvos").update(linha).eq("id", alvo.id).select("id").single()
      : await db.from("facilities_radar_alvos").insert(linha).select("id").single();
    setSalvando(false);
    if (error) { toast.error(error.message); return; }

    if (buscarDepois && onBuscarAgora && data?.id) {
      /* O diálogo fecha ANTES da busca: são ~2 minutos, e travar o formulário
         aberto todo esse tempo faria parecer que emperrou. A tela de trás mostra
         o progresso e recarrega sozinha. */
      onOpenChange(false);
      onSaved();
      setBuscando(true);
      try { await onBuscarAgora(data.id); } finally { setBuscando(false); }
      return;
    }

    toast.success(
      alvo
        ? "Alvo atualizado."
        : modo === "vigia"
          ? "Alvo em vigia. A curva começa a andar na segunda de manhã — e ele não vai avisar nada até você ligar o modo de compra."
          : "Alvo criado. O radar começa a olhar na próxima varredura.",
    );
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{alvo ? "Editar alvo do radar" : "Novo alvo do radar"}</DialogTitle>
          <DialogDescription>
            Escreva o que você quer como escreveria para um colega. O Hub traduz em filtros e passa a vigiar o preço.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="pedido">O que você quer comprar</Label>
            <Textarea
              id="pedido"
              rows={3}
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              placeholder="Ex.: notebook i5 de 12ª geração ou melhor, 16GB de RAM, SSD de 512GB, tela de 14 a 16 polegadas, novo, até R$ 3.000"
            />
          </div>

          <div>
            <Label htmlFor="link">Link de um produto parecido (opcional)</Label>
            <Input
              id="link"
              value={linkRef}
              onChange={(e) => setLinkRef(e.target.value)}
              placeholder="https://www.mercadolivre.com.br/..."
            />
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Se colar um link do Mercado Livre, o radar lê a ficha técnica dele pela API e aproveita as specs.
            </p>
          </div>

          <Button type="button" variant="outline" onClick={interpretar} disabled={lendo} className="w-full">
            {lendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {specs ? "Interpretar de novo" : "Interpretar o pedido"}
          </Button>

          {specs && (
            <div className="rounded-md border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/30">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                <Sparkles className="h-3.5 w-3.5" /> O que o radar entendeu
              </div>
              <div className="mt-1.5 text-[13px] font-medium text-foreground">{resumoDoAlvo(specs)}</div>
              {!!specs.buscas?.length && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {specs.buscas.map((b) => (
                    <span key={b} className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border">
                      {b}
                    </span>
                  ))}
                </div>
              )}
              {!!specs.termos_proibidos?.length && (
                <div className="mt-1.5 text-[11.5px] text-muted-foreground">
                  Exclui: {specs.termos_proibidos.join(", ")}
                </div>
              )}
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                Cada item acima vira uma recusa automática. Se algo aí não é exigência de verdade, ajuste o texto e interprete de novo —
                filtro sobrando faz o radar descartar anúncio bom.
              </p>
            </div>
          )}

          {/* O REGIME É A PRIMEIRA DECISÃO DE CUSTO deste formulário, e está
              escrito com o preço na mesa porque as duas opções não são "mais" e
              "menos" da mesma coisa: uma avisa e a outra é muda. Escolher a
              vigia sem saber disso produz um alvo que funciona perfeitamente e
              nunca fala — a forma de defeito mais difícil de diagnosticar que
              este módulo tem. */}
          <div>
            <Label>Como o radar deve olhar isto</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[
                {
                  id: "compra" as const,
                  nome: "Estou comprando",
                  ritmo: "5 fontes · 4× ao dia · confere estoque e frete · avisa",
                  custo: "~600 créditos/mês",
                  ajuda: "O ritmo de sempre. Para a compra que está acontecendo agora.",
                },
                {
                  id: "vigia" as const,
                  nome: "Vigia permanente",
                  ritmo: "2 fontes · 1× por semana · sem conferência · não avisa",
                  custo: "~9 créditos/mês",
                  ajuda: "Para o que a empresa compra sempre. Só constrói a curva — no dia da compra, você já sabe se o preço é bom.",
                },
              ].map((op) => (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => setModo(op.id)}
                  className={cn(
                    "rounded-md border p-3 text-left transition",
                    modo === op.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-muted-foreground/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-foreground">{op.nome}</span>
                    <span className="num rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{op.custo}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{op.ritmo}</div>
                  <div className="mt-1 text-[11.5px] text-muted-foreground">{op.ajuda}</div>
                </button>
              ))}
            </div>
            {modo === "vigia" && (
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                Em vigia o preço mostrado <span className="font-medium text-foreground">não passa pela conferência de estoque</span> — a
                vitrine da loja continua listando o esgotado com o último preço praticado. É aceitável aqui porque a pergunta é
                “o mercado está caro?”, e não “dá para comprar este?”. Ao ligar o modo de compra, a conferência entra e os fantasmas
                saem antes de qualquer decisão.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="titulo">Nome do alvo</Label>
              <Input id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Notebook do time de vendas" />
            </div>
            <div>
              <Label htmlFor="categoria">Categoria</Label>
              <select
                id="categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-[13px]"
              >
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              {/* EM CONSUMÍVEL O TETO É POR QUILO/LITRO/PEÇA, e o rótulo tem
                  de gritar isso. "R$ 40" num alvo de café significa coisas
                  opostas conforme a leitura: por pacote, é generoso; por quilo,
                  é apertado. Quem digita precisa saber qual das duas está
                  escrevendo ANTES de salvar. */}
              <Label htmlFor="preco">
                {unidade
                  ? `Preço-teto por ${UNIDADE_LABEL[unidade]}`
                  : modo === "vigia" ? "Preço de referência" : "Preço-teto (por unidade)"}
              </Label>
              <Input id="preco" value={precoTxt} onChange={(e) => setPrecoTxt(e.target.value)} placeholder={unidade ? "40,00" : "3.000"} />
              {!!preco && (
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  {unidade ? (
                    <>
                      Avisa em até {fmtBRL(preco)} por {UNIDADE_LABEL[unidade]} — o pacote inteiro pode custar mais que isso,
                      desde que a conta por {UNIDADE_LABEL[unidade]} feche. Anúncio que não diz o tamanho da embalagem é recusado,
                      porque sem ele não há como comparar.
                    </>
                  ) : modo === "vigia" ? (
                    /* EM VIGIA O NÚMERO NÃO DISPARA NADA — vira a linha
                       tracejada do gráfico e o corte entre "melhor agora" e
                       "nada no teto · menor: X" no card. Chamá-lo de "teto"
                       aqui prometeria um aviso que o regime não dá. */
                    <>
                      Referência de {fmtBRL(preco)} — em vigia não dispara aviso: vira a linha do gráfico e o corte do card.
                      Depois de 14 dias medidos, a curva sugere um número melhor que o chutado hoje. Abaixo de{" "}
                      {fmtBRL(pisoDePreco(preco))} o radar ignora o anúncio — nesse preço não é o produto, é acessório ou isca.
                    </>
                  ) : (
                    <>
                      Avisa em até {fmtBRL(preco)}. Abaixo de {fmtBRL(pisoDePreco(preco))} o radar ignora — nesse preço não é o produto,
                      é acessório ou anúncio isca.
                    </>
                  )}
                </p>
              )}

              {sugestao && (
                <div className={cn(
                  "mt-2 rounded-md border p-2.5 text-[11.5px]",
                  sugestao.veredito ? VEREDITO_ESTILO[sugestao.veredito] : "border-border bg-muted/40 text-muted-foreground",
                )}>
                  <div className="flex items-start gap-1.5">
                    <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0">
                      <div>{sugestao.texto}</div>
                      {sugestao.pode && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span className="text-[11px] opacity-80">
                            {sugestao.dias} dia(s) medidos · menor {fmtBRL(sugestao.minimo)} · típico {fmtBRL(sugestao.tipico)}
                          </span>
                          {/* Sugere, não impõe: o botão preenche o campo e quem
                              confirma é ele. A IA nunca decide o número — o
                              número vem da regra, e a decisão vem da pessoa. */}
                          {Math.round(sugestao.teto) !== Math.round(preco ?? 0) && (
                            <button
                              type="button"
                              onClick={() => setPrecoTxt(String(sugestao.teto))}
                              className="rounded border border-current/30 px-1.5 py-0.5 text-[11px] font-medium hover:bg-current/10"
                            >
                              usar {fmtBRL(sugestao.teto)}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="qtd">{unidade ? `Quanto se compra (${UNIDADE_LABEL[unidade]})` : "Quantidade"}</Label>
              <Input id="qtd" type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
              {/* A cadência é a peça que faz o consumível caber no orçamento de
                  raspagem: preço de café não se mexe entre a manhã e a tarde. */}
              <div className="mt-3">
                {/* EM VIGIA A CADÊNCIA É DO REGIME, e o campo sai da tela em vez
                    de ficar desabilitado: ele não está indisponível, ele deixou
                    de ser uma pergunta. O cron da vigia roda uma vez por semana,
                    e um alvo com cadência menor só passaria na frente dos outros
                    na fila sem ganhar rodada nenhuma — um controle que parece
                    fazer efeito e não faz. */}
                {modo === "vigia" ? (
                  <>
                    <Label>De quanto em quanto tempo olhar</Label>
                    <div className="mt-1 rounded-md border border-border bg-muted/40 px-2 py-2 text-[12.5px] text-muted-foreground">
                      Segunda de manhã, uma vez por semana
                    </div>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      Sempre no mesmo dia de propósito: medir ora na segunda, ora no sábado misturaria promoção de fim de semana
                      com preço de dia útil na mesma linha do tempo.
                    </p>
                  </>
                ) : (
                  <>
                    <Label htmlFor="cad">De quanto em quanto tempo olhar</Label>
                    <select
                      id="cad"
                      value={cadencia}
                      onChange={(e) => setCadencia(Number(e.target.value))}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
                    >
                      <option value={0}>Toda rodada (4x ao dia)</option>
                      <option value={1}>Uma vez por dia</option>
                      <option value={7}>Uma vez por semana</option>
                      <option value={15}>A cada 15 dias</option>
                    </select>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      {cadencia >= 7
                        ? "Consumível não muda de preço todo dia — e cada varredura consome crédito de raspagem."
                        : "Equipamento vale olhar sempre: o preço se mexe e a compra é grande."}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div>
            <Label>Onde procurar</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {FONTES.map((f) => {
                const on = fontes.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFontes((p) => (on ? p.filter((x) => x !== f.id) : [...p, f.id]))}
                    className={`rounded-md border px-2.5 py-1 text-[12px] transition ${
                      on ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground"
                    }`}
                  >
                    {fonteLabel(f.id)}
                    {f.nota && <span className="ml-1 text-[10.5px] text-amber-700 dark:text-amber-400">· {f.nota}</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              <span className="font-medium text-foreground">Nove fontes medidas e trazendo resultado.</span> Buscapé, Zoom e Bondfaro
              são comparadores: cobrem várias lojas de uma vez, e o radar segue o link até descobrir de qual loja é a oferta.
              As cinco marcadas em âmbar não renderam nada no teste — seguem selecionáveis e, se voltarem, funcionam sozinhas.
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {modo === "vigia" ? (
                <>
                  Marcar aqui monta o <span className="font-medium text-foreground">conjunto</span>, não a rodada: em vigia cada
                  varredura lê <span className="font-medium text-foreground">duas</span> — a que mais rendeu, sempre (para a série
                  ser comparável de semana a semana), mais uma girando entre as demais, que é o que cobre as outras vitrines ao longo
                  do mês e denuncia a que parou de responder.
                </>
              ) : (
                <>
                  Cada varredura consulta até cinco, em rodízio: as comprovadas vão sempre e as demais giram, para nenhuma ficar
                  ligada aqui e muda na prática.
                </>
              )}
            </p>
          </div>

          <div>
            <Label htmlFor="solic">Vincular a uma solicitação (opcional)</Label>
            <select
              id="solic"
              value={solicId}
              onChange={(e) => setSolicId(e.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-[13px]"
            >
              <option value="">Nenhuma — o radar só avisa</option>
              {solicitacoes.map((s) => <option key={s.id} value={s.id}>{s.titulo}</option>)}
            </select>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Com uma solicitação vinculada, o achado vira cotação nela num clique. Sem vínculo, o botão cria a solicitação na hora —
              perguntando antes.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => salvar(false)} disabled={salvando || buscando || !specs}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {alvo ? "Salvar" : "Criar e esperar o horário"}
            </Button>
            {/* O caminho de quem foi perguntado agora e precisa responder agora. */}
            <Button onClick={() => salvar(true)} disabled={salvando || buscando || !specs}>
              {(salvando || buscando) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              {alvo ? "Salvar e buscar agora" : "Criar e buscar agora"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
