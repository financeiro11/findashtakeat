import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Pin, PinOff, ArrowUp, Sparkles, ListChecks, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  nomeNivel, bandaDe, tierDe, TIER_META, impactoDe, esforcoDe,
  type Automacao, type Nivel, type NoPos,
} from "./arvore-layout";
import { ordenarEsteira, quadranteDe, resumoEsteira } from "./esteira";
import FichaNo from "./FichaNo";

/* ---------------------------------------------------------------------------
 * Linha de produção — a árvore vira fila.
 *
 * A ordem sai inteira de esteira.ts; aqui só se desenha e se grava o que o
 * usuário arrastou. Clicar num item abre a MESMA ficha da árvore, porque é o
 * mesmo registro visto de outro ângulo — duplicar o cartão faria os dois
 * divergirem na primeira mudança.
 * ------------------------------------------------------------------------- */
export default function EsteiraAutomacoes({
  rows, niveis, porId, onEditar, onExcluir, onDesligar, onRecarregar,
}: {
  rows: Automacao[];
  niveis: Nivel[];
  porId: Map<string, NoPos>;
  onEditar: (r: Automacao) => void;
  onExcluir: (id: string) => void;
  onDesligar: (id: string) => void;
  onRecarregar: () => Promise<void> | void;
}) {
  const itens = useMemo(() => ordenarEsteira(rows, niveis), [rows, niveis]);
  const resumo = useMemo(() => resumoEsteira(itens), [itens]);

  const [sel, setSel] = useState<{ id: string; y: number } | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);

  // A ficha é posicionada dentro deste container e não pode furar as bordas.
  const boxRef = useRef<HTMLDivElement>(null);
  const [caixa, setCaixa] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const medir = () => setCaixa({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Item que sumiu da fila (virou "Rodando", por exemplo) não pode deixar ficha aberta.
  useEffect(() => {
    if (sel && !itens.some((i) => i.r.id === sel.id)) setSel(null);
  }, [itens, sel]);

  const gravar = async (id: string, patch: Partial<Automacao>) => {
    setSalvando(true);
    const { error } = await supabase.from("automacoes_catalogo").update(patch as never).eq("id", id);
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    await onRecarregar();
  };

  /* Soltar no índice i = "quero este aqui". Como o item arrastado sai da fila
     automática antes de ser reinserido, o índice visto na tela é exatamente o
     índice que se grava — sem correção de off-by-one. */
  const soltarEm = async (destino: number) => {
    const id = arrastando;
    setArrastando(null); setAlvo(null);
    if (!id) return;
    const atual = itens.findIndex((i) => i.r.id === id);
    if (atual === destino) return;
    await gravar(id, { esteira_ordem: destino });
    toast.success(`Fixado na posição ${destino + 1} — o resto da fila se reorganiza em volta.`);
  };

  const soltarPino = async (id: string) => {
    await gravar(id, { esteira_ordem: null });
    toast.message("Voltou para a ordem automática.");
  };

  const soltarTodos = async () => {
    const ids = itens.filter((i) => i.fixo).map((i) => i.r.id);
    setSalvando(true);
    const { error } = await supabase.from("automacoes_catalogo").update({ esteira_ordem: null } as never).in("id", ids);
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    await onRecarregar();
    toast.success("Fila inteira de volta para a ordem por impacto e esforço.");
  };

  const selItem = sel ? itens.find((i) => i.r.id === sel.id) : null;
  const selNo = selItem ? porId.get(selItem.r.id) : null;
  const aberta = sel && selItem && selNo ? { sel, item: selItem, no: selNo } : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border" style={{ background: "#06070b" }}>
      {/* ---------------- cabeçalho ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3" style={{ background: "#0b0e15" }}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-sky-500 text-white shadow-[0_0_18px_rgba(52,211,153,.4)]">
            <ListChecks className="h-[18px] w-[18px]" />
          </span>
          <div>
            <div className="text-[13.5px] font-bold tracking-[0.14em] text-white">LINHA DE PRODUÇÃO</div>
            <div className="text-[11px] text-slate-500">
              Ordenada por impacto e esforço, com o nível como desempate — arraste para mudar
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="num text-[20px] font-bold leading-none text-white">{resumo.total}</div>
            <div className="text-[9px] font-bold tracking-[0.16em] text-slate-600">NA FILA</div>
          </div>
          {resumo.rapidos > 0 && (
            <>
              <div className="h-8 w-px bg-white/10" />
              <div className="text-right">
                <div className="num text-[20px] font-bold leading-none text-emerald-400">{resumo.rapidos}</div>
                <div className="text-[9px] font-bold tracking-[0.16em] text-slate-600">GANHO RÁPIDO</div>
              </div>
            </>
          )}
          {resumo.upgrades > 0 && (
            <>
              <div className="h-8 w-px bg-white/10" />
              <div className="text-right">
                <div className="num text-[20px] font-bold leading-none text-amber-400">{resumo.upgrades}</div>
                <div className="text-[9px] font-bold tracking-[0.16em] text-slate-600">UPGRADES</div>
              </div>
            </>
          )}
          {resumo.fixos > 0 && (
            <button
              onClick={soltarTodos}
              disabled={salvando}
              title="Soltar todas as posições fixadas na mão"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.07] disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" /> {resumo.fixos} fixado{resumo.fixos > 1 ? "s" : ""} · reordenar
            </button>
          )}
        </div>
      </div>

      {/* ---------------- fila ---------------- */}
      <div ref={boxRef} className="relative p-3">
        {itens.length === 0 ? (
          <div className="px-2 py-8 text-center text-[12px] text-slate-500">
            Nada na fila — toda automação da árvore já está rodando.
            <div className="mt-1 text-[11px] text-slate-600">
              Para continuar evoluindo, abra uma automação com upgrade e clique em “Pôr este upgrade na linha de produção”.
            </div>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {itens.map((it, i) => {
              const imp = impactoDe(it.r);
              const esf = esforcoDe(it.r);
              const quad = quadranteDe(it.r);
              const no = porId.get(it.r.id);
              const meta = TIER_META[tierDe(it.r.status)];
              const aberto = sel?.id === it.r.id;

              return (
                <li
                  key={it.r.id}
                  draggable
                  onDragStart={() => setArrastando(it.r.id)}
                  onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                  onDragOver={(e) => { e.preventDefault(); setAlvo(i); }}
                  onDrop={(e) => { e.preventDefault(); soltarEm(i); }}
                  onClick={(e) => {
                    const box = boxRef.current?.getBoundingClientRect();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setSel(aberto ? null : { id: it.r.id, y: r.top - (box?.top ?? 0) });
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition",
                    arrastando === it.r.id && "opacity-40",
                    alvo === i && arrastando && arrastando !== it.r.id
                      ? "border-emerald-500/70 bg-emerald-500/[0.08]"
                      : aberto
                        ? "border-white/25 bg-white/[0.07]"
                        : "border-white/[0.08] bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]",
                  )}
                >
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-700" />

                  {/* posição na fila */}
                  <span
                    className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-bold"
                    style={{ color: i < 3 ? "#34d399" : "#64748b", background: i < 3 ? "#34d3991a" : "rgba(255,255,255,.04)" }}
                  >
                    {i + 1}
                  </span>

                  {/* nome + contexto */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {it.tipo === "upgrade" && (
                        <ArrowUp className="h-3.5 w-3.5 shrink-0 text-amber-400" strokeWidth={3} />
                      )}
                      <span className="truncate text-[13px] font-semibold text-white">{it.r.automacao}</span>
                      {it.tipo === "upgrade" && (
                        <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[8.5px] font-bold tracking-wider text-amber-400">
                          UPGRADE
                        </span>
                      )}
                      {it.fixo && (
                        <button
                          onClick={(e) => { e.stopPropagation(); soltarPino(it.r.id); }}
                          title="Posição fixada na mão — clique para voltar à ordem automática"
                          className="shrink-0 text-sky-400 transition hover:text-slate-400"
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[9.5px] tracking-[0.08em] text-slate-600">
                      {nomeNivel(niveis, bandaDe(it.r, niveis) || null)} · {no?.trilha.toUpperCase() ?? "SEM TRILHA"}
                    </div>
                  </div>

                  {/* impacto × esforço — o par que define a posição */}
                  <div className="hidden shrink-0 items-center gap-3 sm:flex">
                    {quad && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.12em]"
                        style={{ color: quad.cor, background: `${quad.cor}18`, border: `1px solid ${quad.cor}44` }}
                      >
                        {quad.rotulo}
                      </span>
                    )}
                    {([["IMP", imp], ["ESF", esf]] as const).map(([rot, v]) => (
                      <span key={rot} className="text-right leading-tight">
                        <span className="block text-[8px] font-bold tracking-[0.14em] text-slate-700">{rot}</span>
                        <span className="block text-[10.5px] font-bold" style={{ color: v.cor }}>{v.nome.toUpperCase()}</span>
                      </span>
                    ))}
                    <span
                      className="h-2 w-2 rounded-full"
                      title={it.r.status}
                      style={{ background: meta.cor, boxShadow: tierDe(it.r.status) !== "todo" ? `0 0 8px ${meta.cor}` : undefined }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* a mesma ficha da árvore, ancorada à direita da linha clicada */}
        {aberta && (
          <FichaNo
            n={aberta.no}
            niveis={niveis}
            prereq={aberta.item.r.depende_de ? porId.get(aberta.item.r.depende_de)?.r.automacao ?? null : null}
            ancora={{ x: Math.max(0, caixa.w - 362), y: aberta.sel.y }}
            caixa={caixa}
            onEditar={() => onEditar({ ...aberta.item.r })}
            onDesligar={() => onDesligar(aberta.item.r.id)}
            onExcluir={() => { setSel(null); onExcluir(aberta.item.r.id); }}
            onFechar={() => setSel(null)}
            onEsteira={
              tierDe(aberta.item.r.status) === "on"
                ? () => gravar(aberta.item.r.id, { esteira_upgrade: false, esteira_ordem: null })
                : undefined
            }
          />
        )}
      </div>

      {/* ---------------- regra, escrita ---------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.07] px-4 py-2.5 text-[10.5px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-emerald-400" />
          Ordem automática: <b className="text-slate-400">alto impacto + baixo esforço primeiro</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ArrowUp className="h-3 w-3 text-sky-400" />
          Empate resolve pelo nível mais baixo — a base antes do topo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <PinOff className="h-3 w-3" />
          Arrastou, fixou; o alfinete solta e devolve para a regra
        </span>
      </div>
    </div>
  );
}
