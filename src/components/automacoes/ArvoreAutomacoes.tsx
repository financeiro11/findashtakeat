import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Zap, Brain, Banknote, FileText, BarChart3, ArrowRightLeft, MessageSquare,
  CalendarCheck, Radar, LayoutDashboard, Receipt, Minus, Plus, Maximize2,
  Sparkles, Loader2, Wrench, Clock, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ============================================================================
 * Árvore de Automações — o catálogo desenhado como árvore de habilidades.
 *
 * Eixos: X = trilha (categoria) · Y = nível de maturidade (N1 na base → N5 no
 * topo, espelhando a pirâmide). O tronco sai do "Hub Financeiro" embaixo.
 *
 * Duas leituras de aresta, deliberadamente distintas para não inventar relação
 * que o dado não tem:
 *   · traço fraco  = andaime (tronco da trilha / ordem sugerida)
 *   · traço aceso  = pré-requisito REAL, vindo da coluna `depende_de`
 *
 * As bandas de nível são adaptativas: só entram no desenho as que têm alguma
 * automação. Como hoje quase tudo está sem nível, a árvore nasce compacta e vai
 * "subindo" sozinha conforme o nível for preenchido no catálogo.
 * ========================================================================== */

import {
  montarLayout, correnteDe, destravadasPor, corTrilha, tierDe, horasDe,
  TIER_META, CANVAS_BG, CANVAS_GRID, PAD_X, ROW_H,
  type Automacao, type Tier, type NoPos,
} from "./arvore-layout";

const CAT_ICON: Record<string, LucideIcon> = {
  "IA & Categorização": Brain,
  "Pagamentos & Cobrança": Banknote,
  "Notas Fiscais": FileText,
  "Reportes & DRE": BarChart3,
  "Conciliação": ArrowRightLeft,
  "Comunicação Interna": MessageSquare,
  "Fechamento Mensal": CalendarCheck,
  "Editais": Radar,
  "Dashboard": LayoutDashboard,
  "Reembolsos": Receipt,
};

export default function ArvoreAutomacoes() {
  const [rows, setRows] = useState<Automacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);       // nó com a corrente acesa
  const [hover, setHover] = useState<string | null>(null);
  const [trilhaIso, setTrilhaIso] = useState<string | null>(null); // trilha isolada
  const [simular, setSimular] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("automacoes_catalogo")
        .select("id,automacao,categoria,nivel,status,horas_mes,ferramentas,responsavel,impacto,depende_de,ordem")
        .order("ordem");
      if (error) toast.error(error.message);
      else setRows((data as Automacao[]) || []);
      setLoading(false);
    })();
  }, []);

  /* ----------------------------- layout ----------------------------- */
  const layout = useMemo(() => montarLayout(rows), [rows]);
  const porId = useMemo(() => new Map(layout.nos.map((n) => [n.r.id, n])), [layout.nos]);
  const corrente = useMemo(() => correnteDe(rows, sel), [sel, rows]);
  const destrava = useMemo(() => destravadasPor(rows, sel), [sel, rows]);

  const temPrereq = useMemo(() => rows.some((r) => r.depende_de), [rows]);

  /* ------------------------------ KPIs ------------------------------ */
  const kpi = useMemo(() => {
    const total = rows.length;
    const on = rows.filter((r) => tierDe(r.status) === "on").length;
    const horas = rows.filter((r) => tierDe(r.status) === "on").reduce((s, r) => s + horasDe(r), 0);
    return { total, on, horas };
  }, [rows]);

  const porTrilha = useMemo(
    () =>
      layout.trilhas.map((t) => {
        const meus = rows.filter((r) => (r.categoria || "Sem categoria") === t);
        return { nome: t, cor: corTrilha(t), on: meus.filter((r) => tierDe(r.status) === "on").length, total: meus.length };
      }),
    [layout.trilhas, rows],
  );

  /* --------------------------- pan & zoom --------------------------- */
  const boxRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  const [t, setT] = useState({ x: 0, y: 0 });
  const arrasto = useRef<{ x: number; y: number; tx: number; ty: number; moveu: boolean } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [ajustado, setAjustado] = useState(false);

  const ajustar = useCallback(() => {
    const el = boxRef.current;
    if (!el || !layout.W) return;
    const escala = Math.min(1.05, Math.min(el.clientWidth / layout.W, el.clientHeight / layout.H)) || 1;
    setK(escala);
    setT({ x: (el.clientWidth - layout.W * escala) / 2, y: (el.clientHeight - layout.H * escala) / 2 });
  }, [layout.W, layout.H]);

  // enquadra assim que os dados chegam
  useEffect(() => {
    if (!ajustado && !loading && layout.nos.length) { ajustar(); setAjustado(true); }
  }, [ajustado, loading, layout.nos.length, ajustar]);

  // zoom no ponteiro — listener não-passivo para poder cancelar o scroll da página
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      setK((kPrev) => {
        const kNovo = Math.min(2.2, Math.max(0.25, kPrev * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        setT((tPrev) => ({
          x: px - ((px - tPrev.x) / kPrev) * kNovo,
          y: py - ((py - tPrev.y) / kPrev) * kNovo,
        }));
        return kNovo;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loading]); // o canvas só existe depois do carregamento — sem isso o zoom nunca é anexado

  const zoomBotao = (fator: number) => {
    const el = boxRef.current;
    if (!el) return;
    const px = el.clientWidth / 2, py = el.clientHeight / 2;
    setK((kPrev) => {
      const kNovo = Math.min(2.2, Math.max(0.25, kPrev * fator));
      setT((tPrev) => ({ x: px - ((px - tPrev.x) / kPrev) * kNovo, y: py - ((py - tPrev.y) / kPrev) * kNovo }));
      return kNovo;
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-no]")) return; // clique no nó não arrasta
    arrasto.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moveu: false };
    setArrastando(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const a = arrasto.current;
    if (!a) return;
    const dx = e.clientX - a.x, dy = e.clientY - a.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) a.moveu = true;
    setT({ x: a.tx + dx, y: a.ty + dy });
  };
  const onPointerUp = () => {
    const a = arrasto.current;
    arrasto.current = null;
    setArrastando(false);
    if (a && !a.moveu) { setSel(null); setSimular(false); } // clique no vazio limpa a seleção
  };

  /* ------------------------- estado visual do nó ------------------------- */
  const apagado = (n: NoPos) => {
    if (trilhaIso && n.trilha !== trilhaIso) return true;
    if (simular && sel) return !(n.r.id === sel || destrava.ids.has(n.r.id));
    if (corrente) return !corrente.has(n.r.id);
    return false;
  };

  const noHover = hover ? porId.get(hover) : null;
  const selNo = sel ? porId.get(sel) : null;

  /* --------------------------- curvas do desenho --------------------------- */
  const curvaTronco = (x: number, topo: number) =>
    `M ${layout.hubX} ${layout.hubY} C ${layout.hubX} ${layout.hubY - 95}, ${x} ${layout.hubY - 55}, ${x} ${topo}`;
  const curvaGalho = (colX: number, n: NoPos) =>
    `M ${colX} ${n.y} C ${colX + (n.x - colX) * 0.5} ${n.y}, ${n.x - (n.x - colX) * 0.5} ${n.y}, ${n.x} ${n.y}`;
  const curvaPrereq = (a: NoPos, b: NoPos) => {
    const meio = a.y + (b.y - a.y) / 2;
    return `M ${a.x} ${a.y} C ${a.x} ${meio}, ${b.x} ${meio}, ${b.x} ${b.y}`;
  };

  if (loading) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-xl" style={{ background: CANVAS_BG }}>
        <span className="inline-flex items-center gap-2 text-[13px] text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando a árvore…
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* ---------------- cabeçalho ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3" style={{ background: "#11141b" }}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-amber-500 text-white shadow-sm">
            <Zap className="h-4 w-4" />
          </span>
          <div>
            <div className="text-[13.5px] font-bold tracking-wide text-white">ÁRVORE DE AUTOMAÇÕES</div>
            <div className="text-[11px] text-slate-400">O catálogo como roadmap de habilidades — trilha × nível de maturidade</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="num text-[19px] font-bold leading-none text-emerald-400">{kpi.on}<span className="text-[13px] text-slate-500">/{kpi.total}</span></div>
            <div className="text-[9.5px] font-bold tracking-wider text-slate-500">DESBLOQUEADAS</div>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div className="text-right">
            <div className="num text-[19px] font-bold leading-none text-white">{kpi.horas}</div>
            <div className="text-[9.5px] font-bold tracking-wider text-slate-500">H/MÊS POUPADAS</div>
          </div>
        </div>
      </div>

      {/* ---------------- chips de trilha ---------------- */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-4 py-2.5" style={{ background: "#0e1117" }}>
        <span className="mr-1 text-[9.5px] font-bold tracking-wider text-slate-500">TRILHAS · CLIQUE PARA ISOLAR</span>
        {porTrilha.map((tr) => {
          const ativo = trilhaIso === tr.nome;
          return (
            <button
              key={tr.nome}
              onClick={() => setTrilhaIso(ativo ? null : tr.nome)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                ativo ? "border-white/25 bg-white/10 text-white" : "border-white/10 text-slate-300 hover:bg-white/[0.06]",
              )}
              style={ativo ? { boxShadow: `inset 0 0 0 1px ${tr.cor}55` } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: tr.cor }} />
              {tr.nome}
              <span className="num text-[10px] text-slate-500">{tr.on}/{tr.total}</span>
            </button>
          );
        })}
        {trilhaIso && (
          <button onClick={() => setTrilhaIso(null)} className="ml-1 inline-flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-white">
            <X className="h-3 w-3" /> limpar
          </button>
        )}
      </div>

      {/* ---------------- canvas ---------------- */}
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative h-[560px] touch-none select-none overflow-hidden"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 100%, #161b26 0%, ${CANVAS_BG} 70%)`,
          cursor: arrastando ? "grabbing" : "grab",
        }}
      >
        {layout.nos.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-slate-400">
            Nenhuma automação no catálogo ainda.
          </div>
        ) : (
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${k})` }}>
            <svg width={layout.W} height={layout.H} className="absolute left-0 top-0">
              <defs>
                <pattern id="arv-grid" width="46" height="46" patternUnits="userSpaceOnUse">
                  <path d="M 46 0 L 0 0 0 46" fill="none" stroke={CANVAS_GRID} strokeWidth="1" />
                </pattern>
                <filter id="arv-glow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="5" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <rect width={layout.W} height={layout.H} fill="url(#arv-grid)" />

              {/* faixas de nível */}
              {layout.faixas.map((f) => (
                <g key={f.k}>
                  <line x1={PAD_X - 46} y1={f.base} x2={layout.W - PAD_X + 46} y2={f.base} stroke="rgba(148,163,184,.10)" strokeWidth={1} strokeDasharray="3 7" />
                  <text x={PAD_X - 58} y={(f.topo + f.base) / 2} fontSize={9.5} fontWeight={700} letterSpacing={1.6} fill="rgba(148,163,184,.55)" textAnchor="middle" transform={`rotate(-90 ${PAD_X - 58} ${(f.topo + f.base) / 2})`}>
                    {f.label}
                  </text>
                </g>
              ))}

              {/* troncos das trilhas (andaime) */}
              {layout.troncos.map((tr) => {
                const off = trilhaIso && tr.trilha !== trilhaIso;
                return (
                  <path key={tr.trilha} d={curvaTronco(tr.x, tr.topo)} fill="none" stroke={tr.cor} strokeWidth={1.6} strokeLinecap="round" opacity={off ? 0.07 : 0.3} />
                );
              })}

              {/* galhos até cada nó (andaime) */}
              {layout.nos.map((n) => {
                const colX = layout.troncos.find((x) => x.trilha === n.trilha)!.x;
                if (Math.abs(n.x - colX) < 1) return null;
                return (
                  <path key={`g-${n.r.id}`} d={curvaGalho(colX, n)} fill="none" stroke={n.cor} strokeWidth={1.4} strokeLinecap="round" opacity={apagado(n) ? 0.06 : 0.3} />
                );
              })}

              {/* pré-requisitos reais */}
              {layout.nos.map((n) => {
                if (!n.r.depende_de) return null;
                const pai = porId.get(n.r.depende_de);
                if (!pai) return null;
                const aceso = !apagado(n) && !apagado(pai);
                const naCorrente = !!corrente && corrente.has(n.r.id) && corrente.has(pai.r.id);
                return (
                  <path
                    key={`p-${n.r.id}`}
                    d={curvaPrereq(pai, n)}
                    fill="none"
                    stroke={n.cor}
                    strokeWidth={naCorrente ? 3 : 2}
                    strokeLinecap="round"
                    opacity={aceso ? (naCorrente ? 1 : 0.75) : 0.08}
                    filter={naCorrente ? "url(#arv-glow)" : undefined}
                  />
                );
              })}

              {/* hub */}
              <g>
                <circle cx={layout.hubX} cy={layout.hubY} r={30} fill="#1a1f2b" stroke="hsl(0 84% 51%)" strokeWidth={2} filter="url(#arv-glow)" />
                <text x={layout.hubX} y={layout.hubY + 6} fontSize={19} textAnchor="middle" fill="#fff">⚡</text>
                <text x={layout.hubX} y={layout.hubY + 50} fontSize={10} fontWeight={800} letterSpacing={2} fill="rgba(226,232,240,.75)" textAnchor="middle">
                  HUB FINANCEIRO
                </text>
              </g>
            </svg>

            {/* nós */}
            {layout.nos.map((n) => {
              const off = apagado(n);
              const meta = TIER_META[n.tier];
              const Icone = CAT_ICON[n.trilha] ?? Zap;
              const ehSel = sel === n.r.id;
              const novo = simular && sel && destrava.ids.has(n.r.id);
              return (
                <div
                  key={n.r.id}
                  data-no
                  className="absolute flex w-[132px] -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center transition-opacity"
                  style={{ left: n.x, top: n.y, opacity: off ? 0.16 : 1 }}
                  onMouseEnter={() => setHover(n.r.id)}
                  onMouseLeave={() => setHover((h) => (h === n.r.id ? null : h))}
                  onClick={(e) => { e.stopPropagation(); setSel((p) => (p === n.r.id ? null : n.r.id)); setSimular(false); }}
                >
                  <div
                    className="flex h-[42px] w-[42px] items-center justify-center rounded-full transition"
                    style={{
                      background: n.tier === "on" ? `${n.cor}26` : "#161b26",
                      border: `2px solid ${n.tier === "todo" ? "#3b4354" : meta.cor}`,
                      boxShadow: ehSel
                        ? `0 0 0 3px ${n.cor}66, 0 0 20px ${meta.cor}88`
                        : novo
                        ? `0 0 0 3px ${TIER_META.on.cor}55, 0 0 18px ${TIER_META.on.cor}77`
                        : n.tier === "on"
                        ? `0 0 12px ${meta.cor}44`
                        : "none",
                    }}
                  >
                    <Icone className="h-[18px] w-[18px]" style={{ color: n.tier === "todo" ? "#7c879b" : n.cor }} />
                  </div>
                  <div
                    className="mt-1.5 line-clamp-2 text-center text-[10px] font-medium leading-tight"
                    style={{ color: n.tier === "todo" ? "#8b97ab" : "#dbe3ef" }}
                  >
                    {n.r.automacao}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ficha ao passar o mouse */}
        {noHover && (
          <div
            className="pointer-events-none absolute z-20 w-[248px] rounded-lg border border-white/15 p-3 shadow-xl"
            style={{
              background: "rgba(14,17,23,.97)",
              left: Math.min(Math.max(noHover.x * k + t.x + 34, 8), (boxRef.current?.clientWidth ?? 800) - 256),
              top: Math.min(Math.max(noHover.y * k + t.y - 30, 8), (boxRef.current?.clientHeight ?? 560) - 170),
            }}
          >
            <div className="flex items-start gap-2">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: noHover.cor }} />
              <div className="text-[12.5px] font-semibold leading-snug text-white">{noHover.r.automacao}</div>
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-slate-400">
              <div>{noHover.trilha}</div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: TIER_META[noHover.tier].cor }} />
                {noHover.r.status}
                <span className="text-slate-600">·</span>
                {noHover.banda ? `Nível ${noHover.banda}` : "sem nível"}
              </div>
              {horasDe(noHover.r) > 0 && (
                <div className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> {horasDe(noHover.r)} h/mês poupadas</div>
              )}
              {noHover.r.ferramentas && (
                <div className="flex items-start gap-1.5"><Wrench className="mt-0.5 h-3 w-3 shrink-0" /> {noHover.r.ferramentas.trim()}</div>
              )}
            </div>
          </div>
        )}

        {/* dica */}
        <div className="pointer-events-none absolute bottom-3 left-4 max-w-[300px] text-[10.5px] leading-relaxed text-slate-500">
          Arraste para navegar · role para dar zoom · passe o mouse num nó para ver a ficha · clique para acender a corrente de pré-requisitos.
        </div>

        {/* legenda + zoom */}
        <div className="absolute bottom-3 right-4 flex flex-col items-end gap-2">
          <div className="flex items-center gap-3 rounded-lg border border-white/10 px-3 py-1.5 text-[10.5px] text-slate-400" style={{ background: "rgba(14,17,23,.9)" }}>
            {(["on", "wip", "todo"] as Tier[]).map((tr) => (
              <span key={tr} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: TIER_META[tr].cor }} /> {TIER_META[tr].label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => zoomBotao(1 / 1.2)} title="Diminuir zoom" className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-slate-300 transition hover:bg-white/10" style={{ background: "rgba(14,17,23,.9)" }}>
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => zoomBotao(1.2)} title="Aumentar zoom" className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-slate-300 transition hover:bg-white/10" style={{ background: "rgba(14,17,23,.9)" }}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button onClick={ajustar} title="Enquadrar a árvore" className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-slate-300 transition hover:bg-white/10" style={{ background: "rgba(14,17,23,.9)" }}>
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                if (!sel) { toast.message("Selecione uma automação na árvore para simular o desbloqueio."); return; }
                if (!destrava.ids.size) {
                  toast.message(
                    temPrereq
                      ? "Nenhuma automação depende dessa ainda."
                      : "Nenhum pré-requisito cadastrado ainda — defina o campo “Pré-requisito (depende de)” no catálogo abaixo.",
                  );
                  return;
                }
                setSimular((s) => !s);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10.5px] font-bold tracking-wider transition",
                simular ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground hover:brightness-110",
              )}
            >
              <Sparkles className="h-3.5 w-3.5" /> {simular ? "SIMULANDO" : "SIMULAR DESBLOQUEIO"}
            </button>
          </div>
        </div>

        {/* resumo da simulação */}
        {simular && selNo && (
          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-emerald-500/40 px-4 py-2 text-center shadow-xl" style={{ background: "rgba(14,17,23,.96)" }}>
            <div className="text-[11.5px] text-slate-300">
              Concluir <b className="text-white">{selNo.r.automacao}</b> destrava{" "}
              <b className="num text-emerald-400">{destrava.ids.size}</b> automação{destrava.ids.size === 1 ? "" : "ões"}
              {destrava.horas > 0 && <> · <b className="num text-emerald-400">+{destrava.horas} h/mês</b></>}
            </div>
            <div className="text-[10px] text-slate-500">simulação — nada é alterado no catálogo</div>
          </div>
        )}
      </div>

      {/* ---------------- rodapé: leitura das arestas ---------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/10 px-4 py-2 text-[10.5px] text-slate-400" style={{ background: "#0e1117" }}>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#94a3b8" strokeWidth="1.5" opacity=".35" /></svg>
          tronco da trilha (andaime visual)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#f43f5e" strokeWidth="2.5" /></svg>
          pré-requisito real (campo <span className="num">depende_de</span>)
        </span>
        {!temPrereq && (
          <span className="text-amber-400/80">
            Nenhum pré-requisito cadastrado ainda — preencha “Pré-requisito (depende de)” no catálogo para acender as correntes.
          </span>
        )}
      </div>
    </div>
  );
}
