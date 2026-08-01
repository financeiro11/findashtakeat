import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Zap, Minus, Plus, Maximize2, Sparkles, Loader2, X, Pencil, Trash2,
  Link2, Unlink, MousePointer2, ArrowUp, Layers, Maximize, Minimize,
} from "lucide-react";
import {
  montarLayout, correnteDe, destravadasPor, resumoTrilhas, alvosValidos, bandaNoY,
  fiosDaTrilha, caminhoSuave,
  corTrilha, trilhaDe, tierDe, horasDe, bandaDe, nomeNivel, iniciaisDe, listaFerramentas,
  TIER_META, TRILHAS, NIVEIS_PADRAO, STATUS_OPTS, temUpgrade,
  type Automacao, type NoPos, type Nivel, type Faixa,
} from "./arvore-layout";
import { iconeDe, ICONES, NOMES_ICONES, nomeIconeDe } from "./arvore-icones";
import takeatSymbol from "@/assets/takeat-symbol-white.png";

/* ============================================================================
 * Árvore de Automações — o catálogo desenhado como árvore de habilidades.
 *
 * Eixos: X = trilha · Y = nível de maturidade (N1 na base → N5 no topo, o mesmo
 * da pirâmide). O tronco sai do Hub Financeiro, embaixo, e o brilho corre pelos
 * canais do hub para as pontas.
 *
 * Duas leituras de aresta, deliberadamente distintas para não inventar relação
 * que o dado não tem:
 *   · traço fraco  = andaime (tronco da trilha)
 *   · traço aceso  = pré-requisito REAL, vindo da coluna `depende_de`
 *
 * Tudo é editável no lugar: arrastar o nó salva pos_x/pos_y, o cartão abre a
 * ficha e o editor completo, e dá para criar automação e ligar pré-requisito
 * sem sair da árvore.
 * ========================================================================== */

const CAMPOS = "id,automacao,categoria,nivel,status,horas_mes,ferramentas,responsavel,impacto,dor,solucao,observacao,upgrade,depende_de,pos_x,pos_y,icone,ordem";

const vazia = (nivel: number | null): Automacao => ({
  id: "", automacao: "", categoria: TRILHAS[0].categorias[0], nivel, status: "Ideias",
  horas_mes: null, ferramentas: "", responsavel: "", impacto: "Médio",
  dor: "", solucao: "", observacao: "", upgrade: "", depende_de: null, pos_x: null, pos_y: null,
  icone: null, ordem: 0,
});

export default function ArvoreAutomacoes() {
  const [rows, setRows] = useState<Automacao[]>([]);
  const [niveis, setNiveis] = useState<Nivel[]>(NIVEIS_PADRAO);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [trilhaIso, setTrilhaIso] = useState<string | null>(null);
  const [simular, setSimular] = useState(false);
  const [conectando, setConectando] = useState<string | null>(null);
  const [editando, setEditando] = useState<Automacao | null>(null);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [posLocal, setPosLocal] = useState<Record<string, { x: number; y: number }>>({});
  const [bandaAlvo, setBandaAlvo] = useState<Faixa | null>(null); // banda sob o nó durante o arraste
  const [telaCheia, setTelaCheia] = useState(false);

  const carregar = useCallback(async () => {
    const [{ data, error }, { data: nv }] = await Promise.all([
      supabase.from("automacoes_catalogo").select(CAMPOS).order("ordem"),
      supabase.from("automacoes_niveis").select("n,nome,bullets").order("n"),
    ]);
    if (error) toast.error(error.message);
    else { setRows((data as Automacao[]) || []); setPosLocal({}); }
    if (nv?.length) setNiveis(nv as unknown as Nivel[]);
    setLoading(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  /* ----------------------------- layout ----------------------------- */
  const layout = useMemo(() => montarLayout(rows, niveis), [rows, niveis]);
  // posições otimistas do arraste sobrepõem o layout, para as arestas seguirem o nó
  const nos: NoPos[] = useMemo(
    () => layout.nos.map((n) => {
      const p = posLocal[n.r.id];
      return p ? { ...n, x: p.x, y: p.y, fixo: true } : n;
    }),
    [layout.nos, posLocal],
  );
  const porId = useMemo(() => new Map(nos.map((n) => [n.r.id, n])), [nos]);
  // Fios calculados sobre as posições EM TELA (inclui o arraste em curso): a
  // curva passa pelos nós, então o nó nunca descola do galho.
  const fios = useMemo(() => {
    const hub = { x: layout.hubX, y: layout.hubY };
    return layout.troncos.flatMap((tr) => {
      const meus = nos.filter((n) => n.trilha === tr.trilha);
      return fiosDaTrilha(meus.map((n) => ({ x: n.x, y: n.y })), hub)
        .map((pontos, i) => ({ chave: `${tr.trilha}#${i}`, trilha: tr.trilha, cor: tr.cor, d: caminhoSuave(pontos) }));
    });
  }, [layout.troncos, layout.hubX, layout.hubY, nos]);

  // Etiqueta da trilha: fica logo acima do hub, na coluna da trilha.
  const etiquetas = useMemo(
    () => layout.troncos
      .filter((tr) => nos.some((n) => n.trilha === tr.trilha))
      .map((tr) => ({ ...tr, y: layout.hubY - 86 })),
    [layout.troncos, layout.hubY, nos],
  );
  const corrente = useMemo(() => correnteDe(rows, sel), [sel, rows]);
  const destrava = useMemo(() => destravadasPor(rows, sel), [sel, rows]);
  const trilhas = useMemo(() => resumoTrilhas(rows), [rows]);
  const temPrereq = useMemo(() => rows.some((r) => r.depende_de), [rows]);
  const kpi = useMemo(() => {
    const on = rows.filter((r) => tierDe(r.status) === "on");
    return {
      total: rows.length, on: on.length,
      horas: on.reduce((s, r) => s + horasDe(r), 0),
      upgrades: rows.filter(temUpgrade).length,
    };
  }, [rows]);
  const categorias = useMemo(
    () => Array.from(new Set([...TRILHAS.flatMap((t) => t.categorias), ...rows.map((r) => r.categoria || "").filter(Boolean)])).sort(),
    [rows],
  );

  /* --------------------------- pan & zoom --------------------------- */
  const boxRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  const [t, setT] = useState({ x: 0, y: 0 });
  const pan = useRef<{ x: number; y: number; tx: number; ty: number; moveu: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  const [ajustado, setAjustado] = useState(false);

  const ajustar = useCallback(() => {
    const el = boxRef.current;
    if (!el || !layout.W) return;
    const escala = Math.min(1, Math.min(el.clientWidth / layout.W, el.clientHeight / layout.H)) || 1;
    setK(escala);
    setT({ x: (el.clientWidth - layout.W * escala) / 2, y: (el.clientHeight - layout.H * escala) / 2 });
  }, [layout.W, layout.H]);

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
        const kNovo = Math.min(2.4, Math.max(0.2, kPrev * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        setT((tPrev) => ({ x: px - ((px - tPrev.x) / kPrev) * kNovo, y: py - ((py - tPrev.y) / kPrev) * kNovo }));
        return kNovo;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loading]); // o canvas só existe depois do carregamento

  const zoomBotao = (fator: number) => {
    const el = boxRef.current;
    if (!el) return;
    const px = el.clientWidth / 2, py = el.clientHeight / 2;
    setK((kPrev) => {
      const kNovo = Math.min(2.4, Math.max(0.2, kPrev * fator));
      setT((tPrev) => ({ x: px - ((px - tPrev.x) / kPrev) * kNovo, y: py - ((py - tPrev.y) / kPrev) * kNovo }));
      return kNovo;
    });
  };

  /* --------------------------- tela cheia ---------------------------
   * Overlay fixo em vez da Fullscreen API: o zoom/arraste continuam iguais, o
   * ESC fica sob nosso controle e o editor (Dialog, z-50) ainda abre por cima. */
  useEffect(() => {
    if (!telaCheia) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // sem barra de rolagem atrás
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editando) return;                       // o diálogo trata o ESC dele
      if (conectando) { setConectando(null); return; } // 1º ESC cancela a ligação
      setTelaCheia(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [telaCheia, editando, conectando]);

  // Reenquadra ao entrar/sair da tela cheia — o canvas mudou de tamanho.
  const ajustarRef = useRef(ajustar);
  ajustarRef.current = ajustar;
  const primeiraVez = useRef(true);
  useEffect(() => {
    if (primeiraVez.current) { primeiraVez.current = false; return; }
    // dois quadros: um para o layout aplicar, outro para medir já com o novo tamanho
    const id = requestAnimationFrame(() => requestAnimationFrame(() => ajustarRef.current()));
    return () => cancelAnimationFrame(id);
  }, [telaCheia]);

  const onPanDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-no]")) return;
    pan.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moveu: false };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPanMove = (e: React.PointerEvent) => {
    const a = pan.current;
    if (!a) return;
    const dx = e.clientX - a.x, dy = e.clientY - a.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) a.moveu = true;
    setT({ x: a.tx + dx, y: a.ty + dy });
  };
  const onPanUp = () => {
    const a = pan.current;
    pan.current = null;
    setPanning(false);
    if (a && !a.moveu) { setSel(null); setSimular(false); setConectando(null); }
  };

  /* ------------------------- arraste do nó ------------------------- */
  const arr = useRef<{ id: string; x: number; y: number; ox: number; oy: number; banda: number; moveu: boolean } | null>(null);

  const onNoDown = (e: React.PointerEvent, n: NoPos) => {
    e.stopPropagation();
    arr.current = { id: n.r.id, x: e.clientX, y: e.clientY, ox: n.x, oy: n.y, banda: n.banda, moveu: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onNoMove = (e: React.PointerEvent) => {
    const a = arr.current;
    if (!a) return;
    const dx = (e.clientX - a.x) / k, dy = (e.clientY - a.y) / k;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) a.moveu = true;
    if (!a.moveu) return;
    const y = a.oy + dy;
    setPosLocal((p) => ({ ...p, [a.id]: { x: a.ox + dx, y } }));
    // avisa quando o nó cruza a barreira e passa a pertencer a outro nível
    const alvo = bandaNoY(layout.faixas, y);
    setBandaAlvo(alvo && alvo.k !== a.banda ? alvo : null);
  };
  const onNoUp = async (e: React.PointerEvent, n: NoPos) => {
    e.stopPropagation();
    const a = arr.current;
    arr.current = null;
    const alvo = bandaAlvo;
    setBandaAlvo(null);
    if (!a) return;
    if (!a.moveu) {          // clique simples
      if (conectando) { await ligar(conectando, n.r.id); return; }
      setSel((p) => (p === n.r.id ? null : n.r.id));
      setSimular(false);
      return;
    }
    const p = posLocal[a.id];
    if (!p) return;
    // soltar dentro de outra faixa promove/rebaixa a automação de nível
    const mudouNivel = alvo && alvo.k !== a.banda;
    const patch: Record<string, unknown> = { pos_x: Math.round(p.x), pos_y: Math.round(p.y) };
    if (mudouNivel) patch.nivel = alvo.k || null;
    const { error } = await supabase.from("automacoes_catalogo").update(patch as never).eq("id", a.id);
    if (error) { toast.error("Não salvou a posição: " + error.message); return; }
    setRows((rs) => rs.map((r) => (r.id === a.id
      ? { ...r, pos_x: p.x, pos_y: p.y, ...(mudouNivel ? { nivel: alvo.k || null } : {}) }
      : r)));
    if (mudouNivel) {
      const subiu = (alvo.k || 0) > a.banda;
      toast.success(`${n.r.automacao} ${subiu ? "subiu" : "desceu"} para ${alvo.label}`);
    }
  };

  const soltarPosicao = async (id: string) => {
    const { error } = await supabase.from("automacoes_catalogo")
      .update({ pos_x: null, pos_y: null } as never).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setPosLocal((p) => { const n = { ...p }; delete n[id]; return n; });
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, pos_x: null, pos_y: null } : r)));
    toast.success("Nó voltou para a posição automática.");
  };

  const reorganizar = async () => {
    if (!confirm("Recolocar todos os nós na posição automática?")) return;
    const { error } = await supabase.from("automacoes_catalogo")
      .update({ pos_x: null, pos_y: null } as never).not("pos_x", "is", null);
    if (error) { toast.error(error.message); return; }
    setPosLocal({});
    await carregar();
    setAjustado(false);
    toast.success("Árvore reorganizada.");
  };

  /* --------------------------- níveis --------------------------- */
  const novoNivel = async () => {
    const nome = prompt("Nome do novo nível (ele vira uma faixa da árvore e um andar da pirâmide):");
    if (!nome?.trim()) return;
    const n = Math.max(0, ...niveis.map((x) => x.n)) + 1;
    const { error } = await supabase.from("automacoes_niveis").insert({ n, nome: nome.trim() } as never);
    if (error) { toast.error(error.message); return; }
    await carregar();
    toast.success(`Nível N${n} · ${nome.trim()} criado.`);
  };

  /* ------------------------- pré-requisitos ------------------------- */
  const ligar = async (origem: string, alvo: string) => {
    setConectando(null);
    if (origem === alvo) return;
    if (!alvosValidos(rows, alvo).some((r) => r.id === origem)) {
      toast.error("Essa ligação criaria um ciclo de dependência.");
      return;
    }
    const { error } = await supabase.from("automacoes_catalogo").update({ depende_de: origem } as never).eq("id", alvo);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.map((r) => (r.id === alvo ? { ...r, depende_de: origem } : r)));
    const nomeA = rows.find((r) => r.id === alvo)?.automacao, nomeO = rows.find((r) => r.id === origem)?.automacao;
    toast.success(`"${nomeA}" agora depende de "${nomeO}".`);
  };

  const desligar = async (id: string) => {
    const { error } = await supabase.from("automacoes_catalogo").update({ depende_de: null } as never).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, depende_de: null } : r)));
    toast.success("Pré-requisito removido.");
  };

  /* ---------------------------- CRUD do nó ---------------------------- */
  const salvar = async () => {
    if (!editando) return;
    if (!editando.automacao.trim()) { toast.error("Dê um nome para a automação."); return; }
    setSalvando(true);
    const campos = {
      automacao: editando.automacao.trim(), categoria: editando.categoria || null, nivel: editando.nivel,
      status: editando.status, horas_mes: editando.horas_mes, ferramentas: editando.ferramentas || null,
      responsavel: editando.responsavel || null, impacto: editando.impacto || "Médio",
      dor: editando.dor || null, solucao: editando.solucao || null, observacao: editando.observacao || null,
      upgrade: editando.upgrade || null,
      depende_de: editando.depende_de || null, icone: editando.icone || null,
    };
    if (criando) {
      const ordem = rows.length ? Math.max(...rows.map((r) => r.ordem)) + 1 : 1;
      const { error } = await supabase.from("automacoes_catalogo").insert({ ...campos, ordem, execucoes: 0 } as never);
      if (error) { toast.error(error.message); setSalvando(false); return; }
      toast.success("Automação criada na árvore.");
    } else {
      const { error } = await supabase.from("automacoes_catalogo").update(campos as never).eq("id", editando.id);
      if (error) { toast.error(error.message); setSalvando(false); return; }
      toast.success("Automação atualizada.");
    }
    setSalvando(false);
    setEditando(null); setCriando(false);
    await carregar();
  };

  const excluir = async (id: string) => {
    if (!confirm("Excluir esta automação da árvore e do catálogo?")) return;
    const { error } = await supabase.from("automacoes_catalogo").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setSel(null);
    await carregar();
    toast.success("Automação excluída.");
  };

  /* ------------------------- estado visual ------------------------- */
  const apagado = (n: NoPos) => {
    if (trilhaIso && n.trilha !== trilhaIso) return true;
    if (simular && sel) return !(n.r.id === sel || destrava.ids.has(n.r.id));
    if (corrente) return !corrente.has(n.r.id);
    return false;
  };
  const selNo = sel ? porId.get(sel) : null;

  /* --------------------------- curvas ---------------------------
   * A corrente de pré-requisito sai pelo lado do nó de origem e chega pelo lado
   * do destino, com folga proporcional à distância — dá o mesmo balanço das
   * linhas da trilha em vez de subir reta. */
  const curvaPrereq = (a: NoPos, b: NoPos) => {
    const dy = b.y - a.y;
    const dx = b.x - a.x;
    const folga = Math.max(60, Math.abs(dy) * 0.45);
    return `M ${a.x} ${a.y} C ${a.x + dx * 0.12} ${a.y - folga}, ${b.x - dx * 0.12} ${b.y + folga}, ${b.x} ${b.y}`;
  };

  if (loading) {
    return (
      <div className="flex h-[440px] items-center justify-center rounded-xl border border-border" style={{ background: "#06070b" }}>
        <span className="inline-flex items-center gap-2 text-[13px] text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando a árvore…
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden border border-border",
        telaCheia ? "fixed inset-0 z-40 flex flex-col rounded-none border-0" : "rounded-xl",
      )}
    >
      {/* ---------------- cabeçalho ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3" style={{ background: "#0b0e15" }}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow-[0_0_18px_rgba(244,63,94,.45)]">
            <Zap className="h-[18px] w-[18px]" />
          </span>
          <div>
            <div className="text-[13.5px] font-bold tracking-[0.14em] text-white">ÁRVORE DE AUTOMAÇÕES</div>
            <div className="text-[11px] text-slate-500">Trilha × nível de maturidade — arraste os nós, clique para abrir a ficha</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="num text-[20px] font-bold leading-none text-emerald-400">
              {kpi.on}<span className="text-[13px] text-slate-600">/{kpi.total}</span>
            </div>
            <div className="text-[9px] font-bold tracking-[0.16em] text-slate-600">DESBLOQUEADAS</div>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div className="text-right">
            <div className="num text-[20px] font-bold leading-none text-white">{kpi.horas}</div>
            <div className="text-[9px] font-bold tracking-[0.16em] text-slate-600">H/MÊS</div>
          </div>
          {kpi.upgrades > 0 && (
            <>
              <div className="h-8 w-px bg-white/10" />
              <div className="text-right" title="Automações com upgrade sugerido">
                <div className="num inline-flex items-center gap-0.5 text-[20px] font-bold leading-none text-emerald-400">
                  <ArrowUp className="h-4 w-4" strokeWidth={3} />{kpi.upgrades}
                </div>
                <div className="text-[9px] font-bold tracking-[0.16em] text-slate-600">UPGRADES</div>
              </div>
            </>
          )}
          <button
            onClick={() => setTelaCheia((v) => !v)}
            title={telaCheia ? "Sair da tela cheia (ESC)" : "Abrir a árvore em tela cheia"}
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-white/[0.14] px-2.5 py-2 text-[12px] font-medium text-slate-300 transition hover:bg-white/[0.07]"
          >
            {telaCheia ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
            {telaCheia ? "Sair" : "Tela cheia"}
          </button>
          <button
            onClick={novoNivel}
            title="Criar um nível novo — a faixa aparece na árvore e na pirâmide"
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-white/[0.14] px-2.5 py-2 text-[12px] font-medium text-slate-300 transition hover:bg-white/[0.07]"
          >
            <Layers className="h-3.5 w-3.5" /> Novo nível
          </button>
          <button
            onClick={() => { setEditando(vazia(null)); setCriando(true); }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground transition hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" /> Nova automação
          </button>
        </div>
      </div>

      {/* ---------------- cartões de trilha ---------------- */}
      <div className="border-b border-white/[0.07] px-4 py-3" style={{ background: "#080a10" }}>
        <div className="mb-2 text-[9px] font-bold tracking-[0.18em] text-slate-600">TRILHAS · CLIQUE PARA ISOLAR</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {trilhas.map((tr) => {
            const ativo = trilhaIso === tr.nome;
            const pct = tr.total ? (100 * tr.on) / tr.total : 0;
            return (
              <button
                key={tr.nome}
                onClick={() => setTrilhaIso(ativo ? null : tr.nome)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition",
                  ativo ? "border-white/25 bg-white/[0.07]" : "border-white/[0.09] bg-white/[0.02] hover:bg-white/[0.05]",
                )}
                style={ativo ? { boxShadow: `0 0 0 1px ${tr.cor}66, 0 0 22px ${tr.cor}22` } : undefined}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tr.cor, boxShadow: `0 0 10px ${tr.cor}` }} />
                  <span className="flex-1 truncate text-[12.5px] font-semibold text-white">{tr.nome}</span>
                  <span className="num shrink-0 text-[12px] font-semibold text-slate-400">{tr.on}/{tr.total}</span>
                </div>
                <div className="mt-1 truncate text-[10px] text-slate-500">{tr.categorias.join(" · ")}</div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${tr.cor}88, ${tr.cor})`, boxShadow: `0 0 10px ${tr.cor}aa` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------- canvas ---------------- */}
      <div
        ref={boxRef}
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={onPanUp}
        onPointerCancel={onPanUp}
        className={cn(
          "relative touch-none select-none overflow-hidden",
          telaCheia ? "min-h-0 flex-1" : "h-[620px]",
        )}
        style={{
          background:
            "radial-gradient(58% 38% at 50% 102%, rgba(244,63,94,.22) 0%, transparent 62%)," +
            "radial-gradient(90% 65% at 50% 25%, rgba(30,41,59,.5) 0%, transparent 72%)," +
            "#06070b",
          cursor: conectando ? "crosshair" : panning ? "grabbing" : "grab",
        }}
      >
        {nos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-slate-400">
            Nenhuma automação no catálogo ainda.
            <Button size="sm" onClick={() => { setEditando(vazia(null)); setCriando(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Criar a primeira
            </Button>
          </div>
        ) : (
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${k})` }}>
            <svg width={layout.W} height={layout.H} className="absolute left-0 top-0 overflow-visible">
              <defs>
                <filter id="arv-glow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="4" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <filter id="arv-glow-forte" x="-120%" y="-120%" width="340%" height="340%">
                  <feGaussianBlur stdDeviation="9" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* faixas de nível — rótulo à esquerda + divisor tracejado atravessando a árvore */}
              {layout.faixas.map((f) => {
                const alvo = bandaAlvo?.k === f.k;
                return (
                  <g key={f.k}>
                    {alvo && (
                      <rect x={8} y={f.topo} width={layout.W - 16} height={Math.max(20, f.base - f.topo)}
                            rx={10} fill="rgba(52,211,153,.07)" stroke="rgba(52,211,153,.45)" strokeWidth={1.5} strokeDasharray="9 6" />
                    )}
                    <line x1={20} y1={f.base} x2={layout.W - 20} y2={f.base}
                          stroke={alvo ? "rgba(52,211,153,.5)" : "rgba(148,163,184,.13)"}
                          strokeWidth={1} strokeDasharray="4 8" />
                    <text x={20} y={f.base - 13} fontSize={8.5} fontWeight={700} letterSpacing={2.4}
                          fill={alvo ? "rgba(52,211,153,.95)" : "rgba(148,163,184,.4)"} className="font-mono">
                      {f.label}
                    </text>
                  </g>
                );
              })}

              {/* fios das trilhas: sobem do hub costurando os nós, com o brilho correndo por dentro */}
              {fios.map((f, i) => {
                const off = trilhaIso && f.trilha !== trilhaIso;
                return (
                  <g key={f.chave} opacity={off ? 0.07 : 1}>
                    <path d={f.d} fill="none" stroke={f.cor} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.3} />
                    <path d={f.d} fill="none" stroke={f.cor} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round"
                          pathLength={100} strokeDasharray="8 92" filter="url(#arv-glow)" opacity={0.95}>
                      <animate attributeName="stroke-dashoffset" from="0" to="-100" dur="5.5s" begin={`${i * 0.55}s`} repeatCount="indefinite" />
                    </path>
                  </g>
                );
              })}

              {/* pré-requisitos reais */}
              {nos.map((n, i) => {
                if (!n.r.depende_de) return null;
                const pai = porId.get(n.r.depende_de);
                if (!pai) return null;
                const aceso = !apagado(n) && !apagado(pai);
                const naCorrente = !!corrente && corrente.has(n.r.id) && corrente.has(pai.r.id);
                const d = curvaPrereq(pai, n);
                const tracejado = n.tier === "todo";
                return (
                  <g key={`p-${n.r.id}`} opacity={aceso ? 1 : 0.07}>
                    <path d={d} fill="none" stroke={n.cor} strokeWidth={naCorrente ? 3 : 2.2} strokeLinecap="round"
                          opacity={0.42} strokeDasharray={tracejado ? "7 7" : undefined} />
                    {!tracejado && (
                      <path d={d} fill="none" stroke={n.cor} strokeWidth={naCorrente ? 3.4 : 2.6} strokeLinecap="round"
                            pathLength={100} strokeDasharray="9 91" filter="url(#arv-glow)">
                        <animate attributeName="stroke-dashoffset" from="0" to="-100" dur="3.2s" begin={`${i * 0.25}s`} repeatCount="indefinite" />
                      </path>
                    )}
                  </g>
                );
              })}

              {/* hub — símbolo da Takeat no miolo */}
              <g>
                <circle cx={layout.hubX} cy={layout.hubY} r={58} fill="rgba(244,63,94,.06)" />
                <circle cx={layout.hubX} cy={layout.hubY} r={30} fill="#12141d" stroke="#f43f5e" strokeWidth={2.2} filter="url(#arv-glow-forte)" />
                <image
                  href={takeatSymbol}
                  x={layout.hubX - 15} y={layout.hubY - 17} width={30} height={34}
                  preserveAspectRatio="xMidYMid meet"
                />
                <text x={layout.hubX} y={layout.hubY + 56} fontSize={9.5} fontWeight={800} letterSpacing={3} fill="rgba(226,232,240,.6)" textAnchor="middle" className="font-mono">
                  FINANCEIRO TAKEAT
                </text>
              </g>

              {/* etiqueta da trilha na base do tronco */}
              {etiquetas.map((tr) => {
                const info = trilhas.find((x) => x.nome === tr.trilha);
                const off = trilhaIso && tr.trilha !== trilhaIso;
                return (
                  <g key={`et-${tr.trilha}`} opacity={off ? 0.15 : 1}>
                    <rect x={tr.x - 96} y={tr.y} width={192} height={22} rx={11} fill="rgba(8,10,16,.92)" stroke={`${tr.cor}66`} strokeWidth={1} />
                    <text x={tr.x} y={tr.y + 15} fontSize={9} fontWeight={800} letterSpacing={1.8} fill={tr.cor} textAnchor="middle" className="font-mono">
                      {tr.trilha.toUpperCase()} {info ? `${info.on}/${info.total}` : ""}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* nós */}
            {nos.map((n) => {
              const off = apagado(n);
              const meta = TIER_META[n.tier];
              const Icone = iconeDe(n.r);
              const ehSel = sel === n.r.id;
              const novo = simular && sel && destrava.ids.has(n.r.id);
              const alvoConexao = conectando && conectando !== n.r.id;
              const ini = iniciaisDe(n.r.responsavel);
              return (
                <div
                  key={n.r.id}
                  data-no
                  onPointerDown={(e) => onNoDown(e, n)}
                  onPointerMove={onNoMove}
                  onPointerUp={(e) => onNoUp(e, n)}
                  onMouseEnter={() => setHover(n.r.id)}
                  onMouseLeave={() => setHover((h) => (h === n.r.id ? null : h))}
                  className="absolute flex w-[150px] -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center active:cursor-grabbing"
                  style={{ left: n.x, top: n.y, opacity: off ? 0.14 : 1, zIndex: ehSel ? 12 : 5 }}
                >
                  <div className="relative">
                    <div
                      className="flex h-[48px] w-[48px] items-center justify-center rounded-full transition-all"
                      style={{
                        background: n.tier === "on" ? `radial-gradient(circle at 50% 35%, ${n.cor}33, #10131c)` : "#0d1017",
                        border: `2px ${n.tier === "todo" ? "dashed" : "solid"} ${n.tier === "todo" ? "#3d465a" : n.cor}`,
                        boxShadow: ehSel
                          ? `0 0 0 3px ${n.cor}55, 0 0 28px ${n.cor}cc`
                          : novo || (alvoConexao && hover === n.r.id)
                          ? `0 0 0 3px ${TIER_META.on.cor}66, 0 0 24px ${TIER_META.on.cor}aa`
                          : n.tier === "on"
                          ? `0 0 16px ${n.cor}66`
                          : n.tier === "wip"
                          ? `0 0 12px ${meta.cor}44`
                          : "none",
                      }}
                    >
                      <Icone className="h-[19px] w-[19px]" style={{ color: n.tier === "todo" ? "#6b7689" : n.cor }} />
                    </div>
                    {/* responsável */}
                    {ini && (
                      <span
                        className="absolute -right-1.5 -top-1.5 flex h-[17px] w-[17px] items-center justify-center rounded-full text-[7.5px] font-bold text-slate-200"
                        style={{ background: "#161a24", border: `1px solid ${n.cor}77` }}
                        title={n.r.responsavel || ""}
                      >
                        {ini[0]}
                      </span>
                    )}
                    {/* status */}
                    {n.tier !== "todo" && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 h-[11px] w-[11px] rounded-full"
                        style={{ background: meta.cor, border: "2px solid #06070b", boxShadow: `0 0 8px ${meta.cor}` }}
                        title={n.r.status}
                      />
                    )}
                    {/* oportunidade de upgrade — seta verde para cima */}
                    {temUpgrade(n.r) && (
                      <span
                        className="absolute -left-1.5 -top-1.5 flex h-[18px] w-[18px] animate-pulse items-center justify-center rounded-full"
                        style={{ background: "#0b1a14", border: "1.5px solid #34d399", boxShadow: "0 0 12px rgba(52,211,153,.85)" }}
                        title="Tem upgrade sugerido — dá para deixar essa automação melhor"
                      >
                        <ArrowUp className="h-[11px] w-[11px] text-emerald-400" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-2 line-clamp-2 text-center text-[10.5px] font-medium leading-tight"
                    style={{ color: n.tier === "todo" ? "#7d879b" : "#dde5f2", textShadow: "0 1px 6px rgba(0,0,0,.9)" }}
                  >
                    {n.r.automacao}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ---------------- ficha do nó selecionado ---------------- */}
        {selNo && (
          <FichaNo
            n={selNo}
            niveis={niveis}
            prereq={selNo.r.depende_de ? porId.get(selNo.r.depende_de)?.r.automacao ?? null : null}
            estilo={{
              left: Math.min(Math.max(selNo.x * k + t.x + 42, 10), (boxRef.current?.clientWidth ?? 900) - 320),
              top: Math.min(Math.max(selNo.y * k + t.y - 40, 10), (boxRef.current?.clientHeight ?? 620) - 340),
            }}
            onEditar={() => { setEditando({ ...selNo.r }); setCriando(false); }}
            onConectar={() => { setConectando(selNo.r.id); toast.message("Agora clique no nó que depende dessa automação."); }}
            onDesligar={() => desligar(selNo.r.id)}
            onSoltar={() => soltarPosicao(selNo.r.id)}
            onExcluir={() => excluir(selNo.r.id)}
            onFechar={() => setSel(null)}
          />
        )}

        {/* sair da tela cheia — sempre visível no canto */}
        {telaCheia && (
          <div className="absolute right-4 top-3 z-40 flex items-center gap-2">
            <span className="rounded-md border border-white/[0.09] px-2 py-1 font-mono text-[10px] tracking-wider text-slate-500" style={{ background: "rgba(8,10,16,.9)" }}>
              ESC PARA SAIR
            </span>
            <button
              onClick={() => setTelaCheia(false)}
              title="Sair da tela cheia (ESC)"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.14] text-slate-300 transition hover:bg-white/10 hover:text-white"
              style={{ background: "rgba(8,10,16,.9)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* cruzando a barreira de nível durante o arraste */}
        {bandaAlvo && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-lg border border-emerald-500/60 px-4 py-2 text-center shadow-xl" style={{ background: "rgba(8,10,16,.96)" }}>
            <div className="text-[11.5px] font-semibold text-emerald-400">
              <ArrowUp className="mr-1 inline h-3.5 w-3.5" />
              Soltar aqui move para {bandaAlvo.label}
            </div>
          </div>
        )}

        {/* modo conectar */}
        {conectando && (
          <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg border border-primary/50 px-4 py-2 text-center shadow-xl" style={{ background: "rgba(8,10,16,.96)" }}>
            <div className="text-[11.5px] text-slate-200">
              <MousePointer2 className="mr-1 inline h-3.5 w-3.5" />
              Clique no nó que <b>depende</b> de “{rows.find((r) => r.id === conectando)?.automacao}”
            </div>
            <button onClick={() => setConectando(null)} className="mt-0.5 text-[10px] text-slate-500 hover:text-white">cancelar</button>
          </div>
        )}

        {/* dica */}
        <div className="pointer-events-none absolute bottom-3 left-4 max-w-[330px] rounded-lg border border-white/[0.07] px-3 py-2 text-[10.5px] leading-relaxed text-slate-500" style={{ background: "rgba(8,10,16,.75)" }}>
          Arraste o fundo para navegar · role para dar zoom · <b className="text-slate-400">arraste um nó para movê-lo</b> · clique num nó para abrir a ficha e editar.
        </div>

        {/* legenda + controles */}
        <div className="absolute bottom-3 right-4 flex flex-col items-end gap-2">
          <div className="flex items-center gap-3 rounded-lg border border-white/[0.09] px-3 py-1.5 text-[10.5px] text-slate-400" style={{ background: "rgba(8,10,16,.9)" }}>
            {(["on", "wip", "todo"] as const).map((tr) => (
              <span key={tr} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: TIER_META[tr].cor, boxShadow: tr !== "todo" ? `0 0 8px ${TIER_META[tr].cor}` : undefined }} />
                {TIER_META[tr].label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => zoomBotao(1 / 1.2)} title="Diminuir zoom" className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.09] text-slate-300 transition hover:bg-white/10" style={{ background: "rgba(8,10,16,.9)" }}>
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => zoomBotao(1.2)} title="Aumentar zoom" className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.09] text-slate-300 transition hover:bg-white/10" style={{ background: "rgba(8,10,16,.9)" }}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button onClick={ajustar} title="Enquadrar a árvore" className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.09] text-slate-300 transition hover:bg-white/10" style={{ background: "rgba(8,10,16,.9)" }}>
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={reorganizar} title="Recolocar todos os nós na posição automática" className="rounded-md border border-white/[0.09] px-2 py-1.5 text-[10.5px] font-semibold text-slate-300 transition hover:bg-white/10" style={{ background: "rgba(8,10,16,.9)" }}>
              REORGANIZAR
            </button>
            <button
              onClick={() => {
                if (!sel) { toast.message("Selecione uma automação para simular o desbloqueio."); return; }
                if (!destrava.ids.size) {
                  toast.message(temPrereq
                    ? "Nenhuma automação depende dessa ainda."
                    : "Nenhum pré-requisito ligado ainda — use “Conectar” na ficha de um nó.");
                  return;
                }
                setSimular((s) => !s);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10.5px] font-bold tracking-wider transition",
                simular ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground hover:brightness-110",
              )}
            >
              <Sparkles className="h-3.5 w-3.5" /> {simular ? "SIMULANDO" : "SIMULAR"}
            </button>
          </div>
        </div>

        {/* resumo da simulação */}
        {simular && selNo && (
          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-emerald-500/40 px-4 py-2 text-center shadow-xl" style={{ background: "rgba(8,10,16,.96)" }}>
            <div className="text-[11.5px] text-slate-300">
              Concluir <b className="text-white">{selNo.r.automacao}</b> destrava{" "}
              <b className="num text-emerald-400">{destrava.ids.size}</b> automação{destrava.ids.size === 1 ? "" : "ões"}
              {destrava.horas > 0 && <> · <b className="num text-emerald-400">+{destrava.horas} h/mês</b></>}
            </div>
            <div className="text-[10px] text-slate-500">simulação — nada é alterado no catálogo</div>
          </div>
        )}
      </div>

      {/* rodapé: leitura das arestas */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/[0.07] px-4 py-2 text-[10.5px] text-slate-400" style={{ background: "#080a10" }}>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#94a3b8" strokeWidth="1.5" opacity=".35" /></svg>
          tronco da trilha (andaime visual)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#f43f5e" strokeWidth="2.5" /></svg>
          pré-requisito real (<span className="num">depende_de</span>)
        </span>
        {!temPrereq && (
          <span className="text-amber-400/80">
            Nenhum pré-requisito ligado ainda — abra um nó e use “Conectar” para acender as correntes.
          </span>
        )}
      </div>

      {/* ---------------- editor ---------------- */}
      <Dialog open={!!editando} onOpenChange={(o) => { if (!o) { setEditando(null); setCriando(false); } }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{criando ? "Nova automação" : "Editar automação"}</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Nome</Label>
                <Input autoFocus value={editando.automacao} onChange={(e) => setEditando({ ...editando, automacao: e.target.value })} placeholder="Ex.: Categorização com IA" />
              </div>
              <div className="col-span-2">
                <Label>Ícone do nó</Label>
                <div className="mt-1 flex max-h-[132px] flex-wrap gap-1 overflow-y-auto rounded-md border border-border p-2">
                  {NOMES_ICONES.map((nome) => {
                    const Ic = ICONES[nome];
                    const ativo = nomeIconeDe(editando) === nome;
                    return (
                      <button
                        key={nome}
                        type="button"
                        title={nome}
                        onClick={() => setEditando({ ...editando, icone: nome })}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-md border transition",
                          ativo ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-secondary",
                        )}
                      >
                        <Ic className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  {editando.icone
                    ? "Ícone escolhido à mão."
                    : "Nenhum escolhido — deduzido pelo nome da automação."}
                  {editando.icone && (
                    <button type="button" className="ml-1 text-primary hover:underline" onClick={() => setEditando({ ...editando, icone: null })}>
                      voltar ao automático
                    </button>
                  )}
                </p>
              </div>
              <div>
                <Label>Categoria (define a trilha)</Label>
                <Select value={editando.categoria || ""} onValueChange={(v) => setEditando({ ...editando, categoria: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {categorias.map((c) => (
                      <SelectItem key={c} value={c}>
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: corTrilha(trilhaDe(c)) }} />
                          {c}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10.5px] text-muted-foreground">Trilha: {trilhaDe(editando.categoria)}</p>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={editando.status} onValueChange={(v) => setEditando({ ...editando, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_OPTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Nível (altura na árvore)</Label>
                <Select value={editando.nivel != null ? String(editando.nivel) : "0"} onValueChange={(v) => setEditando({ ...editando, nivel: v === "0" ? null : Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">— sem nível</SelectItem>
                    {niveis.map((x) => <SelectItem key={x.n} value={String(x.n)}>N{x.n} · {x.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Impacto</Label>
                <Select value={editando.impacto || "Médio"} onValueChange={(v) => setEditando({ ...editando, impacto: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Baixo", "Médio", "Alto"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Pré-requisito (depende de)</Label>
                <Select
                  value={editando.depende_de ?? "__none"}
                  onValueChange={(v) => setEditando({ ...editando, depende_de: v === "__none" ? null : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— nenhum (pode começar já)</SelectItem>
                    {(editando.id ? alvosValidos(rows, editando.id) : rows).map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.automacao || "(sem nome)"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Horas/mês poupadas</Label>
                <Input type="number" value={editando.horas_mes ?? ""} onChange={(e) => setEditando({ ...editando, horas_mes: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <div>
                <Label>Responsável</Label>
                <Input value={editando.responsavel || ""} placeholder="Júlia" onChange={(e) => setEditando({ ...editando, responsavel: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Ferramentas (separadas por vírgula)</Label>
                <Input value={editando.ferramentas || ""} placeholder="n8n, Omie, Claude" onChange={(e) => setEditando({ ...editando, ferramentas: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Dor</Label>
                <Textarea rows={2} value={editando.dor || ""} placeholder="O que doía antes dessa automação existir" onChange={(e) => setEditando({ ...editando, dor: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Solução</Label>
                <Textarea rows={2} value={editando.solucao || ""} placeholder="O que a automação faz" onChange={(e) => setEditando({ ...editando, solucao: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label className="flex items-center gap-1.5">
                  <ArrowUp className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} />
                  Upgrade — melhoria possível
                </Label>
                <Textarea
                  rows={2}
                  value={editando.upgrade || ""}
                  placeholder="Ex.: já roda, mas dá para ela também classificar o centro de custo sozinha"
                  onChange={(e) => setEditando({ ...editando, upgrade: e.target.value })}
                />
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  Preenchido, o nó ganha a seta verde de oportunidade na árvore. Em branco, a ficha mostra só dor e solução.
                </p>
              </div>
              <div className="col-span-2">
                <Label>Observação</Label>
                <Textarea rows={2} value={editando.observacao || ""} onChange={(e) => setEditando({ ...editando, observacao: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setEditando(null); setCriando(false); }}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {criando ? "Criar" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Ficha do nó — o cartão que abre ao clicar, com as ações em cima do próprio nó.
 * ------------------------------------------------------------------------- */
function FichaNo({ n, niveis, prereq, estilo, onEditar, onConectar, onDesligar, onSoltar, onExcluir, onFechar }: {
  n: NoPos; niveis: Nivel[]; prereq: string | null; estilo: React.CSSProperties;
  onEditar: () => void; onConectar: () => void; onDesligar: () => void;
  onSoltar: () => void; onExcluir: () => void; onFechar: () => void;
}) {
  const meta = TIER_META[n.tier];
  const ferramentas = listaFerramentas(n.r.ferramentas);
  const horas = horasDe(n.r);
  return (
    <div
      className="absolute z-30 w-[310px] rounded-xl border border-white/[0.12] p-4"
      style={{ ...estilo, background: "rgba(10,12,18,.98)", boxShadow: `0 18px 50px rgba(0,0,0,.7), 0 0 0 1px ${n.cor}22` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[15px] font-bold leading-tight text-white">{n.r.automacao}</div>
        <span
          className="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-wider"
          style={{ color: meta.cor, borderColor: `${meta.cor}66`, background: `${meta.cor}14` }}
        >
          {n.r.status.toUpperCase()}
        </span>
      </div>

      <div className="mt-1.5 font-mono text-[9.5px] leading-relaxed tracking-[0.09em] text-slate-500">
        {nomeNivel(niveis, bandaDe(n.r, niveis) || null)} · {n.trilha.toUpperCase()}
      </div>

      {(n.r.dor || n.r.solucao) && (
        <div className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed">
          {n.r.dor && <div className="text-slate-300"><b className="text-rose-400">Dor</b> · {n.r.dor}</div>}
          {n.r.solucao && <div className="text-slate-300"><b className="text-emerald-400">Solução</b> · {n.r.solucao}</div>}
        </div>
      )}

      {/* Upgrade: só aparece quando há melhoria sugerida — sem sugestão, a ficha
          fica só com dor e solução. */}
      {temUpgrade(n.r) && (
        <div className="mt-2.5 rounded-md border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-2 text-[11.5px] leading-relaxed">
          <div className="flex items-start gap-1.5 text-slate-300">
            <ArrowUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" strokeWidth={3} />
            <span><b className="text-amber-400">Upgrade</b> · {n.r.upgrade}</span>
          </div>
        </div>
      )}

      {ferramentas.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {ferramentas.map((f, i) => (
            <span key={i} className="rounded border border-white/[0.09] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{f}</span>
          ))}
        </div>
      )}

      {prereq && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[10.5px] text-slate-400">
          <Link2 className="h-3 w-3 shrink-0" style={{ color: n.cor }} />
          depende de <b className="text-slate-200">{prereq}</b>
          <button onClick={onDesligar} title="Remover pré-requisito" className="ml-auto text-slate-500 hover:text-rose-400">
            <Unlink className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-white/[0.08] pt-2.5 text-[10.5px]">
        <span className="text-slate-500">{n.r.responsavel ? `Construída por ${n.r.responsavel}` : "Sem responsável"}</span>
        {horas > 0 && (
          <span className="num inline-flex items-center gap-0.5 font-semibold text-emerald-400">
            <ArrowUp className="h-3 w-3" /> {horas} h/mês
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button onClick={onEditar} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground transition hover:brightness-110">
          <Pencil className="h-3 w-3" /> Editar
        </button>
        <button onClick={onConectar} className="inline-flex items-center gap-1 rounded-md border border-white/[0.12] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.07]">
          <Link2 className="h-3 w-3" /> Conectar
        </button>
        {n.fixo && (
          <button onClick={onSoltar} title="Voltar para a posição automática" className="inline-flex items-center gap-1 rounded-md border border-white/[0.12] px-2 py-1.5 text-[11px] text-slate-400 transition hover:bg-white/[0.07]">
            <Maximize2 className="h-3 w-3" />
          </button>
        )}
        <button onClick={onExcluir} title="Excluir" className="ml-auto inline-flex items-center rounded-md border border-white/[0.12] px-2 py-1.5 text-slate-500 transition hover:border-rose-500/50 hover:text-rose-400">
          <Trash2 className="h-3 w-3" />
        </button>
        <button onClick={onFechar} title="Fechar" className="inline-flex items-center rounded-md border border-white/[0.12] px-2 py-1.5 text-slate-500 transition hover:bg-white/[0.07]">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
