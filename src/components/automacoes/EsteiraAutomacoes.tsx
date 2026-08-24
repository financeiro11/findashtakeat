import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GripVertical, Pin, PinOff, ArrowUp, Sparkles, ListChecks, RotateCcw, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { criarTarefaDaAutomacao } from "./criar-tarefa";
import { respCobre, respExistentes, contarPorResp, canonResp, SEM_RESP } from "@/lib/responsavel";
import {
  nomeNivel, bandaDe, tierDe, TIER_META, impactoDe, esforcoDe, iniciaisDe,
  type Automacao, type Nivel, type NoPos,
} from "./arvore-layout";
import { ordenarEsteira, quadranteDe, resumoEsteira } from "./esteira";
import FichaNo from "./FichaNo";

/* Cor estável por pessoa, derivada do nome — quem entrar depois ganha a sua
   sem precisar mexer aqui. Mesma ideia do corTrilha da árvore. */
const CORES_RESP = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#2dd4bf"];
function corResp(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return CORES_RESP[h % CORES_RESP.length];
}

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
  const navigate = useNavigate();
  const itens = useMemo(() => ordenarEsteira(rows, niveis), [rows, niveis]);
  const resumo = useMemo(() => resumoEsteira(itens), [itens]);

  /* Filtro por responsável. Só recorta o que se VÊ — a fila continua sendo a
     mesma lista ordenada, com as mesmas posições. Ver `linhas` abaixo. */
  const [filtroResp, setFiltroResp] = useState("");
  const filtrando = filtroResp !== "";

  const opcoesResp = useMemo(
    () => respExistentes(itens.map((i) => i.r.responsavel)),
    [itens],
  );
  const semDono = useMemo(
    () => contarPorResp(itens.map((i) => i.r.responsavel), SEM_RESP),
    [itens],
  );

  /* A posição é calculada ANTES de filtrar e viaja junto com o item.
     Sem isso o número na tela viraria a posição dentro do recorte ("1" para o
     primeiro item da Júlia, mesmo ele sendo o 4º da fila) e — pior — o
     `soltarEm` gravaria esse índice recortado como se fosse o absoluto,
     embaralhando a fila inteira em silêncio. Ver esteira.ts:74. */
  const linhas = useMemo(
    () => itens
      .map((it, pos) => ({ it, pos }))
      .filter(({ it }) => respCobre(it.r.responsavel, filtroResp)),
    [itens, filtroResp],
  );

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
    // Cinto de segurança: com filtro ligado a lista tem buracos, e "soltar aqui"
    // não quer dizer nada — entre duas linhas visíveis pode haver cinco escondidas.
    // O arraste já vem desligado na marcação; isto é para o caso de escapar.
    if (filtrando) return;
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
            <div className="num text-[20px] font-bold leading-none text-white">
              {filtrando ? `${linhas.length}/${resumo.total}` : resumo.total}
            </div>
            <div className="text-[9px] font-bold tracking-[0.16em] text-slate-600">
              {filtrando ? "DA FILA" : "NA FILA"}
            </div>
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

      {/* ---------------- filtro por responsável ----------------
          Chips e não dropdown: são duas pessoas, e o número em cada chip já
          responde "quanto tem na minha fila" sem precisar clicar. */}
      {itens.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.07] px-4 py-2.5" style={{ background: "#080a10" }}>
          <span className="mr-0.5 text-[9px] font-bold tracking-[0.16em] text-slate-600">QUEM TOCA</span>
          <ChipResp ativo={!filtrando} onClick={() => setFiltroResp("")} n={itens.length}>
            Todos
          </ChipResp>
          {opcoesResp.map((p) => {
            const n = contarPorResp(itens.map((i) => i.r.responsavel), p);
            return (
              <ChipResp
                key={p}
                ativo={filtroResp === p}
                cor={corResp(p)}
                n={n}
                onClick={() => setFiltroResp(filtroResp === p ? "" : p)}
              >
                {p}
              </ChipResp>
            );
          })}
          {semDono > 0 && (
            <ChipResp
              ativo={filtroResp === SEM_RESP}
              n={semDono}
              onClick={() => setFiltroResp(filtroResp === SEM_RESP ? "" : SEM_RESP)}
            >
              Sem dono
            </ChipResp>
          )}
          {filtrando && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-500">
              <Lock className="h-3 w-3" />
              arraste desligado — a ordem se muda com a fila inteira à vista
            </span>
          )}
        </div>
      )}

      {/* ---------------- fila ---------------- */}
      <div ref={boxRef} className="relative p-3">
        {itens.length === 0 ? (
          <div className="px-2 py-8 text-center text-[12px] text-slate-500">
            Nada na fila — toda automação da árvore já está rodando.
            <div className="mt-1 text-[11px] text-slate-600">
              Para continuar evoluindo, abra uma automação com upgrade e clique em “Pôr este upgrade na linha de produção”.
            </div>
          </div>
        ) : linhas.length === 0 ? (
          <div className="px-2 py-8 text-center text-[12px] text-slate-500">
            Nada na fila para esse filtro.
            <div className="mt-1 text-[11px] text-slate-600">
              A fila inteira continua com {resumo.total} item{resumo.total > 1 ? "s" : ""} — clique em “Todos” para ver.
            </div>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {linhas.map(({ it, pos }) => {
              const imp = impactoDe(it.r);
              const esf = esforcoDe(it.r);
              const quad = quadranteDe(it.r);
              const no = porId.get(it.r.id);
              const meta = TIER_META[tierDe(it.r.status)];
              const aberto = sel?.id === it.r.id;
              const dono = canonResp(it.r.responsavel);

              return (
                <li
                  key={it.r.id}
                  draggable={!filtrando}
                  onDragStart={() => setArrastando(it.r.id)}
                  onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                  onDragOver={(e) => { if (filtrando) return; e.preventDefault(); setAlvo(pos); }}
                  onDrop={(e) => { e.preventDefault(); soltarEm(pos); }}
                  onClick={(e) => {
                    const box = boxRef.current?.getBoundingClientRect();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setSel(aberto ? null : { id: it.r.id, y: r.top - (box?.top ?? 0) });
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition",
                    arrastando === it.r.id && "opacity-40",
                    alvo === pos && arrastando && arrastando !== it.r.id
                      ? "border-emerald-500/70 bg-emerald-500/[0.08]"
                      : aberto
                        ? "border-white/25 bg-white/[0.07]"
                        : "border-white/[0.08] bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]",
                  )}
                >
                  <GripVertical
                    className={cn(
                      "h-4 w-4 shrink-0 text-slate-700",
                      filtrando ? "cursor-not-allowed opacity-30" : "cursor-grab",
                    )}
                  />

                  {/* posição na fila — a de verdade, não a do recorte */}
                  <span
                    className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-bold"
                    style={{ color: pos < 3 ? "#34d399" : "#64748b", background: pos < 3 ? "#34d3991a" : "rgba(255,255,255,.04)" }}
                    title={filtrando ? `Posição ${pos + 1} na fila inteira` : undefined}
                  >
                    {pos + 1}
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

                  {/* quem toca — fora do bloco `sm:flex` de propósito: no
                      celular some o impacto/esforço, mas o dono continua. */}
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                    title={dono ? `Responsável: ${it.r.responsavel}` : "Sem responsável"}
                    style={
                      dono
                        ? { color: corResp(dono), background: `${corResp(dono)}1f`, border: `1px solid ${corResp(dono)}55` }
                        : { color: "#475569", background: "rgba(255,255,255,.03)", border: "1px dashed rgba(255,255,255,.14)" }
                    }
                  >
                    {dono ? iniciaisDe(dono)[0] : "?"}
                  </span>
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
            onCriarTarefa={async (resp) => {
              await criarTarefaDaAutomacao(aberta.item.r.id, resp);
              // Recarrega mesmo quando dá erro: se a tarefa já existia, a RPC
              // devolve a antiga e é o reload que troca o botão para "ver".
              await onRecarregar();
            }}
            onVerTarefa={() => navigate(`/tarefas?tarefa=${aberta.item.r.tarefa_id}`)}
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

/* Chip do filtro. O número não é enfeite: é ele que responde "quanto tem na
   minha fila" sem precisar clicar em cada um. */
function ChipResp({
  children, ativo, n, cor, onClick,
}: {
  children: React.ReactNode;
  ativo: boolean;
  n: number;
  cor?: string;
  onClick: () => void;
}) {
  const c = cor || "#94a3b8";
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
        !ativo && "border-white/[0.1] text-slate-400 hover:border-white/25 hover:text-slate-200",
      )}
      style={ativo ? { color: c, background: `${c}1f`, borderColor: `${c}66` } : undefined}
    >
      {children}
      <span
        className="num rounded-full px-1.5 text-[9.5px] font-bold"
        style={{ background: ativo ? `${c}2e` : "rgba(255,255,255,.06)", color: ativo ? c : "#64748b" }}
      >
        {n}
      </span>
    </button>
  );
}
