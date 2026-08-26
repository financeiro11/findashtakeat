import { useEffect, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { db, parseValor, fmtBRL, CATEGORIAS, type Solicitacao } from "./lib";
import { resumoDoAlvo, fonteLabel, pisoDePreco, type AlvoSpecs } from "@/lib/radarPrecos";

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
  { id: "amazon", nota: "veio vazia no teste", ok: false },
  { id: "magalu", nota: "veio vazia no teste", ok: false },
  { id: "mercado_livre", nota: "bloqueado hoje", ok: false },
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
}

interface Props {
  alvo: AlvoRow | null;      // null = criando
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

export function NovoAlvoDialog({ alvo, open, onOpenChange, onSaved }: Props) {
  const [pedido, setPedido] = useState("");
  const [linkRef, setLinkRef] = useState("");
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState<string>("TI");
  const [precoTxt, setPrecoTxt] = useState("");
  const [quantidade, setQuantidade] = useState("1");
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
      setSpecs(alvo.specs ?? null); setSolicId(alvo.solicitacao_id ?? "");
    } else {
      setPedido(""); setLinkRef(""); setTitulo(""); setCategoria("TI"); setPrecoTxt("");
      setQuantidade("1"); setFontes(FONTES_PADRAO);
      setSpecs(null); setSolicId("");
    }
  }, [open, alvo]);

  const preco = parseValor(precoTxt);

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
      toast.success(r.leu_referencia ? "Li o pedido e o anúncio de referência." : "Pedido interpretado.");
    } catch (e: any) {
      toast.error(e.message ?? "Não consegui interpretar o pedido.");
    } finally { setLendo(false); }
  }

  async function salvar() {
    if (!specs) { toast.error("Interprete o pedido antes de salvar — é dele que saem os filtros."); return; }
    if (!preco || preco <= 0) { toast.error("Defina o preço-teto."); return; }
    if (!fontes.length) { toast.error("Escolha pelo menos uma fonte."); return; }
    setSalvando(true);
    const linha = {
      titulo: titulo.trim() || pedido.slice(0, 80),
      pedido, link_ref: linkRef || null, categoria,
      specs, preco_alvo: preco, quantidade: Number(quantidade) || 1,
      solicitacao_id: solicId || null, fontes, updated_at: new Date().toISOString(),
    };
    const { error } = alvo
      ? await db.from("facilities_radar_alvos").update(linha).eq("id", alvo.id)
      : await db.from("facilities_radar_alvos").insert(linha);
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success(alvo ? "Alvo atualizado." : "Alvo criado. O radar começa a olhar na próxima varredura.");
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
              <Label htmlFor="preco">Preço-teto (por unidade)</Label>
              <Input id="preco" value={precoTxt} onChange={(e) => setPrecoTxt(e.target.value)} placeholder="3.000" />
              {!!preco && (
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  Avisa em até {fmtBRL(preco)}. Abaixo de {fmtBRL(pisoDePreco(preco))} o radar ignora — nesse preço não é o produto,
                  é acessório ou anúncio isca.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="qtd">Quantidade</Label>
              <Input id="qtd" type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
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
              <span className="font-medium text-foreground">Kabum, Terabyte, Buscapé e Zoom estão medidas e trazendo resultado</span> —
              os dois últimos são comparadores e cobrem várias lojas de uma vez. Amazon e Magalu abrem a página mas não renderam nada
              no teste, e o Mercado Livre bloqueia robô (a API de busca dele fechou para aplicações). As três seguem selecionáveis: se
              voltarem a funcionar, funcionam sozinhas — e enquanto não funcionarem o card do alvo diz isso, em vez de fingir que
              simplesmente não há promoção.
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

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !specs}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {alvo ? "Salvar" : "Criar alvo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
