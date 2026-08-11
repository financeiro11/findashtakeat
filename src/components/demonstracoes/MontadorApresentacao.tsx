/* ============================================================================
 * O montador — onde a apresentação é armada sem passar por código.
 *
 * Painel lateral com o roteiro à vista: as folhas, o que tem em cada uma, e o
 * que está no catálogo esperando ser chamado. Tudo o que ele faz sai das
 * funções puras de `lib/apresentacao.ts` — este arquivo é botão, lista e
 * confirmação, e não sabe nenhuma regra de montagem.
 *
 * A BARRA DE COMANDO não aplica nada sozinha. O pedido em português vai para a
 * edge function, que devolve COMANDOS; o cliente aplica sobre uma cópia, mostra
 * o que entrou, o que saiu e o que foi recusado, e só grava depois do clique.
 * Uma IA que reordenasse a apresentação direto no banco seria a última coisa que
 * alguém quer descobrir no meio da reunião.
 *
 * Mover é por seta e por seletor de folha, não por arrastar. Arrastar é mais
 * bonito e some no primeiro toque errado em tela pequena — e aqui a lista tem
 * trinta linhas.
 * ========================================================================== */

import { useState } from "react";
import {
  ChevronDown, ChevronUp, CornerDownRight, FilePlus2, Layers, Loader2, Plus, Sparkles,
  Trash2, Type, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  aplicarComandos, contarPecas, foraDoRoteiro, inserirPeca, moverFolha, moverPeca,
  nomeDaPeca, novaFolha, novoId, removerFolha, removerPeca, renomearFolha,
  type Comando, type ItemCatalogo, type Roteiro,
} from "@/lib/apresentacao";

type Props = {
  catalogo: ItemCatalogo[];
  roteiro: Roteiro;
  /** `descricao` vira o toast e o rastro do que mudou. */
  onRoteiro: (r: Roteiro, descricao: string) => void;
  nome: string;
  onNome: (v: string) => void;
  mes: string;
  publicada: boolean;
  salvando: boolean;
  onFechar: () => void;
};

type Proposta = { roteiro: Roteiro; aplicados: string[]; recusados: string[]; resumo: string };

export function MontadorApresentacao({
  catalogo, roteiro, onRoteiro, nome, onNome, mes, publicada, salvando, onFechar,
}: Props) {
  const [pedido, setPedido] = useState("");
  const [pensando, setPensando] = useState(false);
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [alvo, setAlvo] = useState<string>("");
  const [novoTexto, setNovoTexto] = useState<{ titulo: string; corpo: string } | null>(null);
  const [novaSerie, setNovaSerie] = useState<{ rubrica: string; meses: number; formato: "barra" | "linha" } | null>(null);

  const folhaAlvo = roteiro.folhas.find((f) => f.id === alvo) ?? roteiro.folhas[0];
  const fora = foraDoRoteiro(roteiro, catalogo);

  /* ---------------------------- linguagem ---------------------------- */
  const propor = async () => {
    if (!pedido.trim() || pensando) return;
    setPensando(true);
    try {
      const { data, error } = await supabase.functions.invoke("demonstracoes-apresentacao", {
        body: { mes, pedido, roteiro, catalogo },
      });
      if (error) throw error;
      const r = (data ?? {}) as { error?: string; comandos?: Comando[]; resumo?: string };
      if (r.error) throw new Error(r.error);
      const comandos = r.comandos ?? [];
      if (!comandos.length) {
        toast.message(r.resumo || "Não entendi o que mudar na apresentação.");
        return;
      }
      const saida = aplicarComandos(roteiro, comandos, catalogo);
      setProposta({ ...saida, resumo: r.resumo ?? "" });
    } catch (e) {
      toast.error("Não consegui interpretar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPensando(false);
    }
  };

  const aplicarProposta = () => {
    if (!proposta) return;
    onRoteiro(proposta.roteiro, `${proposta.aplicados.length} mudança(s) aplicadas`);
    setProposta(null);
    setPedido("");
  };

  /* ------------------------------ peças ------------------------------ */
  const mover = (folhaId: string, id: string, passo: number) => {
    const folha = roteiro.folhas.find((f) => f.id === folhaId)!;
    const i = folha.pecas.findIndex((p) => p.id === id);
    const j = i + passo;
    if (j < 0 || j >= folha.pecas.length) return;
    onRoteiro(moverPeca(roteiro, id, folhaId, j), "peça movida");
  };

  const adicionar = (chave: string) => {
    if (!folhaAlvo) { toast.error("Crie uma folha antes."); return; }
    const peca = { id: novoId("p", roteiro), tipo: "card" as const, chave };
    onRoteiro(inserirPeca(roteiro, folhaAlvo.id, folhaAlvo.pecas.length, peca), "card adicionado");
  };

  return (
    <aside
      data-chrome="montador"
      className="flex w-[384px] shrink-0 flex-col border-l border-border bg-card"
    >
      <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <Layers className="h-4 w-4 shrink-0 text-primary" />
        <input
          value={nome}
          onChange={(e) => onNome(e.target.value)}
          placeholder="Nome da apresentação"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-semibold focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {salvando && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
        <button onClick={onFechar} title="Fechar o montador" className="ghost-btn ghost-icone">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {publicada && (
        <p className="border-b border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          Esta apresentação está <b>publicada</b>. Qualquer mudança aqui volta ela para rascunho e
          descarta os números congelados — publique de novo quando terminar.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ------------------------- barra de comando ------------------------- */}
        <div className="border-b border-border p-3">
          <label className="eyebrow">Diga o que mudar</label>
          <div className="mt-1.5 flex items-start gap-1.5">
            <textarea
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) propor(); }}
              rows={2}
              placeholder={'"tira o caixa e põe o churn depois da DRE"\n"cria uma folha de tendência com o EBITDA dos últimos 12 meses"'}
              className="min-w-0 flex-1 resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[11.5px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={propor}
              disabled={!pedido.trim() || pensando}
              title="Propor a mudança (Ctrl+Enter)"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {pensando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            </button>
          </div>

          {proposta && (
            <div className="mt-2 rounded-md border border-primary/30 bg-accent/50 p-2.5">
              {proposta.resumo && (
                <p className="text-[11.5px] leading-relaxed">{proposta.resumo}</p>
              )}
              <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px]">
                {proposta.aplicados.map((a, i) => (
                  <li key={i} className={cn("font-medium", a.startsWith("−") ? "text-neg" : "text-pos")}>{a}</li>
                ))}
                {proposta.recusados.map((r, i) => (
                  <li key={`r${i}`} className="text-muted-foreground">⚠ {r}</li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  onClick={aplicarProposta}
                  disabled={!proposta.aplicados.length}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11.5px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  Aplicar
                </button>
                <button onClick={() => setProposta(null)} className="ghost-btn h-7 px-2.5 text-[11.5px]">
                  Descartar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---------------------------- as folhas ---------------------------- */}
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-center justify-between">
            <span className="eyebrow">
              {roteiro.folhas.length} folha(s) · {contarPecas(roteiro)} peça(s)
            </span>
            <button
              onClick={() => onRoteiro(novaFolha(roteiro, `Folha ${roteiro.folhas.length + 1}`), "folha criada")}
              className="ghost-btn h-7 px-2.5 text-[11.5px]"
            >
              <FilePlus2 className="h-3.5 w-3.5" /> Nova folha
            </button>
          </div>

          {/* A legenda resolve o painel inteiro numa linha. Antes, cada fileira
              tinha três quadradinhos de 20px com ícone de 10px — quem abria não
              tinha como saber o que era o quê sem clicar e ver o que acontecia. */}
          <p className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] leading-tight text-muted-foreground">
            <span className="inline-flex items-center gap-1"><ChevronUp className="h-3 w-3" /><ChevronDown className="h-3 w-3" /> ordem</span>
            <span className="inline-flex items-center gap-1"><CornerDownRight className="h-3 w-3" /> muda de folha</span>
            <span className="inline-flex items-center gap-1"><X className="h-3 w-3" /> tira da apresentação</span>
          </p>

          {roteiro.folhas.map((f, fi) => (
            <div key={f.id} className="rounded-md border border-border">
              <div className="flex items-center gap-1 border-b border-border bg-secondary/40 px-2 py-1.5">
                <span className="num text-[10px] text-muted-foreground">{String(fi + 1).padStart(2, "0")}</span>
                <input
                  value={f.titulo}
                  onChange={(e) => onRoteiro(renomearFolha(roteiro, f.id, e.target.value), "folha renomeada")}
                  title="O título da folha — é ele que sai no cabeçalho da página exportada"
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] font-semibold hover:border-border focus:border-border focus:outline-none"
                />
                <button onClick={() => onRoteiro(moverFolha(roteiro, f.id, fi - 1), "folha movida")} disabled={fi === 0}
                        title="Subir esta folha" aria-label="Subir esta folha"
                        className="ghost-btn ghost-icone disabled:opacity-25">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button onClick={() => onRoteiro(moverFolha(roteiro, f.id, fi + 1), "folha movida")} disabled={fi === roteiro.folhas.length - 1}
                        title="Descer esta folha" aria-label="Descer esta folha"
                        className="ghost-btn ghost-icone disabled:opacity-25">
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button onClick={() => onRoteiro(removerFolha(roteiro, f.id), `folha "${f.titulo}" removida`)}
                        title={`Excluir a folha "${f.titulo}" e as ${f.pecas.length} peça(s) dela`}
                        aria-label="Excluir esta folha"
                        className="ghost-btn ghost-icone text-muted-foreground hover:border-neg/40 hover:bg-neg-soft hover:text-neg">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {f.pecas.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                  Folha vazia — ela não sai na exportação.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {f.pecas.map((p, pi) => (
                    <li key={p.id} className="flex items-center gap-1 border-b border-border/50 px-2 py-1.5 last:border-b-0 hover:bg-secondary/30">
                      <span className={cn(
                        "inline-flex h-4 shrink-0 items-center rounded px-1 text-[9px] font-bold tracking-wider",
                        p.tipo === "card" ? "bg-secondary text-muted-foreground"
                          : p.tipo === "texto" ? "bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))]"
                          : "bg-pos-soft text-pos",
                      )}>
                        {p.tipo === "card" ? "HUB" : p.tipo === "texto" ? "TXT" : "SÉR"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px]" title={nomeDaPeca(p, catalogo)}>
                        {nomeDaPeca(p, catalogo)}
                      </span>
                      <button onClick={() => mover(f.id, p.id, -1)} disabled={pi === 0}
                              title={`Subir "${nomeDaPeca(p, catalogo)}" nesta folha`} aria-label="Subir"
                              className="ghost-btn ghost-icone ghost-icone-sm disabled:opacity-25">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => mover(f.id, p.id, 1)} disabled={pi === f.pecas.length - 1}
                              title={`Descer "${nomeDaPeca(p, catalogo)}" nesta folha`} aria-label="Descer"
                              className="ghost-btn ghost-icone ghost-icone-sm disabled:opacity-25">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      {/* O seletor mostra "mover…", não a folha atual. Exibindo a
                          folha em que a peça já está, ele lia como um rótulo
                          repetido em vez de uma ação. */}
                      <select
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          onRoteiro(moverPeca(roteiro, p.id, e.target.value, 99), "peça movida de folha");
                        }}
                        title="Mandar esta peça para outra folha"
                        aria-label="Mandar para outra folha"
                        disabled={roteiro.folhas.length < 2}
                        className="h-6 w-[64px] rounded-md border border-border bg-card px-1 text-[10.5px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-25"
                      >
                        <option value="">mover…</option>
                        {roteiro.folhas.filter((d) => d.id !== f.id).map((d) => (
                          <option key={d.id} value={d.id}>{d.titulo}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => onRoteiro(removerPeca(roteiro, p.id), `${nomeDaPeca(p, catalogo)} fora`)}
                        title={`Tirar "${nomeDaPeca(p, catalogo)}" desta apresentação (ela volta para o catálogo)`}
                        aria-label="Tirar da apresentação"
                        className="ghost-btn ghost-icone ghost-icone-sm text-muted-foreground hover:border-neg/40 hover:bg-neg-soft hover:text-neg"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* ---------------------------- adicionar ---------------------------- */}
        <div className="border-t border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">Adicionar em</span>
            <select
              value={folhaAlvo?.id ?? ""}
              onChange={(e) => setAlvo(e.target.value)}
              className="h-6 min-w-0 flex-1 rounded border border-border bg-card px-1.5 text-[11px] focus:outline-none"
            >
              {roteiro.folhas.map((f) => <option key={f.id} value={f.id}>{f.titulo}</option>)}
            </select>
          </div>

          <div className="mt-2 flex gap-1.5">
            <button
              onClick={() => setNovoTexto({ titulo: "", corpo: "" })}
              className="ghost-btn h-7 flex-1 justify-center px-2 text-[11.5px]"
            >
              <Type className="h-3 w-3" /> Texto livre
            </button>
            <button
              onClick={() => setNovaSerie({ rubrica: "EBITDA", meses: 12, formato: "barra" })}
              className="ghost-btn h-7 flex-1 justify-center px-2 text-[11.5px]"
            >
              <TrendIcon /> Série
            </button>
          </div>

          {novoTexto && (
            <div className="mt-2 rounded-md border border-border p-2">
              <input
                autoFocus
                value={novoTexto.titulo}
                onChange={(e) => setNovoTexto({ ...novoTexto, titulo: e.target.value })}
                placeholder="Título do card"
                className="w-full rounded border border-input bg-background px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <textarea
                value={novoTexto.corpo}
                onChange={(e) => setNovoTexto({ ...novoTexto, corpo: e.target.value })}
                rows={3}
                placeholder="O que este card diz"
                className="mt-1.5 w-full resize-y rounded border border-input bg-background px-2 py-1 text-[11.5px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => {
                    if (!folhaAlvo) return;
                    const peca = { id: novoId("p", roteiro), tipo: "texto" as const, ...novoTexto };
                    onRoteiro(inserirPeca(roteiro, folhaAlvo.id, folhaAlvo.pecas.length, peca), "texto adicionado");
                    setNovoTexto(null);
                  }}
                  disabled={!novoTexto.titulo.trim()}
                  className="inline-flex h-6 items-center rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  Inserir
                </button>
                <button onClick={() => setNovoTexto(null)} className="ghost-btn h-6 px-2 text-[11px]">Cancelar</button>
              </div>
            </div>
          )}

          {novaSerie && (
            <div className="mt-2 rounded-md border border-border p-2">
              <input
                autoFocus
                value={novaSerie.rubrica}
                onChange={(e) => setNovaSerie({ ...novaSerie, rubrica: e.target.value })}
                placeholder="Rubrica da DRE (ex.: EBITDA)"
                className="w-full rounded border border-input bg-background px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <label className="flex items-center gap-1">
                  meses
                  <input
                    type="number" min={2} max={24}
                    value={novaSerie.meses}
                    onChange={(e) => setNovaSerie({ ...novaSerie, meses: Number(e.target.value) })}
                    className="num h-6 w-14 rounded border border-input bg-background px-1.5 text-[11px] focus:outline-none"
                  />
                </label>
                <div className="inline-flex items-center rounded border border-border p-0.5">
                  {(["barra", "linha"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setNovaSerie({ ...novaSerie, formato: f })}
                      className={cn(
                        "h-5 rounded px-2 text-[10.5px]",
                        novaSerie.formato === f ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => {
                    if (!folhaAlvo) return;
                    const peca = {
                      id: novoId("p", roteiro),
                      tipo: "serie" as const,
                      titulo: `${novaSerie.rubrica} — últimos ${novaSerie.meses} meses`,
                      ...novaSerie,
                    };
                    onRoteiro(inserirPeca(roteiro, folhaAlvo.id, folhaAlvo.pecas.length, peca), "série adicionada");
                    setNovaSerie(null);
                  }}
                  disabled={!novaSerie.rubrica.trim()}
                  className="inline-flex h-6 items-center rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  Inserir
                </button>
                <button onClick={() => setNovaSerie(null)} className="ghost-btn h-6 px-2 text-[11px]">Cancelar</button>
              </div>
            </div>
          )}

          <div className="mt-3">
            <span className="eyebrow">Cards fora da apresentação</span>
            {fora.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Tudo o que o mês tem já está em alguma folha.
              </p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1">
                {fora.map((c) => (
                  <li key={c.chave}>
                    <button
                      onClick={() => adicionar(c.chave)}
                      disabled={!folhaAlvo}
                      className="flex w-full items-center gap-1.5 rounded border border-dashed border-border px-2 py-1 text-left text-[11.5px] transition hover:border-primary/40 hover:bg-accent/50 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{c.rotulo}</span>
                      {c.vazio && <span className="shrink-0 text-[9.5px] text-amber-600">sem dado</span>}
                      <span className="shrink-0 text-[9.5px] text-muted-foreground">{c.bloco}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Ícone de tendência sem puxar outro import só para dois traços. */
const TrendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
    <path d="M3 17l6-6 4 4 7-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
