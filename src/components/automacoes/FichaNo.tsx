import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Link2, Unlink, Pencil, Maximize2, Trash2, X, ListPlus, ListChecks, ClipboardCheck, ClipboardPlus, Loader2 } from "lucide-react";
import {
  TIER_META, nomeNivel, bandaDe, horasDe, listaFerramentas, temUpgrade, impactoDe, esforcoDe,
  type NoPos, type Nivel,
} from "./arvore-layout";
import { quadranteDe } from "./esteira";
import { tarefaDe, tarefaViva } from "./criar-tarefa";
import { canonResp, PESSOAS, AMBOS } from "@/lib/responsavel";

/* ---------------------------------------------------------------------------
 * Ficha do nó — o cartão que abre ao clicar, com as ações em cima do próprio nó.
 *
 * Vive fora da árvore porque a esteira abre exatamente o mesmo cartão: o que
 * muda entre os dois é só o que ancorá-lo e quais ações fazem sentido ali.
 * ------------------------------------------------------------------------- */
export default function FichaNo({
  n, niveis, prereq, ancora, caixa,
  onEditar, onConectar, onDesligar, onSoltar, onExcluir, onFechar, onEsteira,
  onCriarTarefa, onVerTarefa,
}: {
  n: NoPos; niveis: Nivel[]; prereq: string | null;
  ancora: { x: number; y: number };   // posição do nó em coordenadas de tela
  caixa: { w: number; h: number };    // tamanho do container que a ficha não pode furar
  onEditar: () => void;
  onDesligar: () => void;
  onExcluir: () => void;
  onFechar: () => void;
  /** ações da árvore — a esteira não passa, porque lá elas não teriam onde acontecer */
  onConectar?: () => void;
  onSoltar?: () => void;
  /** só quando faz sentido pôr/tirar o upgrade da linha de produção */
  onEsteira?: () => void;
  /** abre a tarefa em /tarefas; recebe quem vai tocar */
  onCriarTarefa?: (responsavel: string) => Promise<void>;
  onVerTarefa?: () => void;
}) {
  const meta = TIER_META[n.tier];
  const ferramentas = listaFerramentas(n.r.ferramentas);
  const horas = horasDe(n.r);
  const impacto = impactoDe(n.r);
  const esforco = esforcoDe(n.r);
  const quadrante = quadranteDe(n.r);
  const naEsteira = !!n.r.esteira_upgrade;

  /* "Começar a fazer isto".
     O dono já cadastrado resolve o caso comum num clique só. Quando ele é
     "Ambos" (ou não existe), a tarefa não tem para quem ir — o quadro filtra por
     pessoa — e aí, e SÓ aí, a ficha pergunta. Perguntar sempre seria um passo a
     mais em 7 das 10 automações da fila, que já têm dono. */
  const dono = canonResp(n.r.responsavel);
  const donoServe = !!dono && dono !== AMBOS;
  const [perguntando, setPerguntando] = useState(false);
  const [criando, setCriando] = useState(false);

  /* Tem trabalho aberto? Pergunta-se à TAREFA, não ao `tarefa_id`.
     `/tarefas` arquiva em vez de apagar, então o vínculo sobrevive à tarefa
     sair do quadro; quem apagou espera a automação de volta na fila, e é isso
     que `tarefaViva` devolve — a mesma regra que a RPC já usava para gravar. */
  const tarefa = tarefaDe(n.r);
  const viva = tarefaViva(tarefa);
  /* Houve uma tarefa e ela saiu do quadro. Dizer o que aconteceu evita a
     pergunta "eu não tinha aberto isso já?" na frente do botão verde. */
  const anterior = !viva && tarefa
    ? tarefa.arquivada_em ? "arquivada" : "concluída"
    : null;

  const criar = async (resp: string) => {
    if (!onCriarTarefa) return;
    setCriando(true);
    try { await onCriarTarefa(resp); setPerguntando(false); }
    finally { setCriando(false); }
  };

  /* A ficha precisa da PRÓPRIA altura para caber: com um Upgrade longo ela passa
     de 600px, e a conta antiga assumia ~340px fixos — o rodapé com os botões
     acabava fora do canvas, que é overflow-hidden, sem jeito de alcançar. */
  const ref = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ w: 310, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setTam({ w: el.offsetWidth, h: el.offsetHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n.r.id]);

  const M = 10; // respiro das bordas do container
  const maxAltura = Math.max(180, caixa.h - M * 2);
  const prender = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  // De preferência à direita do nó; se não couber, à esquerda.
  const cabeDireita = ancora.x + 42 + tam.w + M <= caixa.w;
  const left = caixa.w
    ? prender(cabeDireita ? ancora.x + 42 : ancora.x - 42 - tam.w, M, Math.max(M, caixa.w - tam.w - M))
    : ancora.x + 42;
  const top = caixa.h
    ? prender(ancora.y - 40, M, Math.max(M, caixa.h - tam.h - M))
    : ancora.y - 40;

  return (
    <div
      ref={ref}
      data-ficha
      className="absolute z-30 flex w-[310px] touch-auto flex-col overflow-hidden rounded-xl border border-white/[0.12]"
      style={{
        left, top, maxHeight: maxAltura,
        background: "rgba(10,12,18,.98)",
        boxShadow: `0 18px 50px rgba(0,0,0,.7), 0 0 0 1px ${n.cor}22`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* cabeçalho fixo */}
      <div className="shrink-0 px-4 pb-2 pt-4">
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
      </div>

      {/* miolo rolável — é o que cresce quando o Upgrade é longo */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
      {/* As duas metades da prioridade, lado a lado: é o par que decide a posição
          na esteira, então mostrar separado esconderia a leitura. */}
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {([["IMPACTO", impacto], ["ESFORÇO", esforco]] as const).map(([rotulo, v]) => (
          <div key={rotulo} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
            <div className="text-[8.5px] font-bold tracking-[0.14em] text-slate-600">{rotulo}</div>
            <div className="text-[11.5px] font-bold leading-tight" style={{ color: v.cor }}>{v.nome.toUpperCase()}</div>
          </div>
        ))}
      </div>
      {quadrante && (
        <div
          className="mt-1.5 rounded-md px-2 py-1 text-center text-[9.5px] font-bold tracking-[0.14em]"
          style={{ color: quadrante.cor, background: `${quadrante.cor}14`, border: `1px solid ${quadrante.cor}44` }}
        >
          {quadrante.rotulo}
        </div>
      )}

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
          {onEsteira && (
            <button
              onClick={onEsteira}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded border px-2 py-1 text-[10.5px] font-semibold transition"
              style={
                naEsteira
                  ? { color: "#34d399", borderColor: "#34d39955", background: "#34d3991a" }
                  : { color: "#fbbf24", borderColor: "#fbbf2455", background: "transparent" }
              }
            >
              {naEsteira
                ? <><ListChecks className="h-3 w-3" /> Na linha de produção — clique para tirar</>
                : <><ListPlus className="h-3 w-3" /> Pôr este upgrade na linha de produção</>}
            </button>
          )}
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/[0.08] pt-2.5 text-[10.5px]">
        <span className="min-w-0 truncate text-slate-500">{n.r.responsavel ? `Construída por ${n.r.responsavel}` : "Sem responsável"}</span>
        {horas > 0 && (
          <span className="num inline-flex shrink-0 items-center gap-0.5 font-semibold text-emerald-400">
            <ArrowUp className="h-3 w-3" /> {horas} h/mês
          </span>
        )}
      </div>

      {/* --- vira trabalho no quadro --- */}
      {(onCriarTarefa || onVerTarefa) && (
        <div className="mt-2.5">
          {viva ? (
            <button
              onClick={onVerTarefa}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-[10.5px] font-semibold text-sky-400 transition hover:bg-sky-500/20"
            >
              <ClipboardCheck className="h-3 w-3" /> Já está no quadro — ver a tarefa
            </button>
          ) : perguntando ? (
            <div className="rounded-md border border-white/[0.12] bg-white/[0.03] p-2">
              <div className="mb-1.5 text-[10px] text-slate-400">
                {dono === AMBOS ? "Vocês dois tocam esta — quem abre a tarefa?" : "Quem vai tocar?"}
              </div>
              <div className="flex gap-1.5">
                {PESSOAS.map((p) => (
                  <button
                    key={p}
                    disabled={criando}
                    onClick={() => criar(p)}
                    className="flex-1 rounded border border-white/[0.14] px-2 py-1 text-[10.5px] font-semibold text-slate-200 transition hover:border-emerald-500/60 hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
                <button
                  disabled={criando}
                  onClick={() => setPerguntando(false)}
                  className="rounded border border-transparent px-1.5 text-[10.5px] text-slate-500 transition hover:text-slate-300 disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                disabled={criando}
                onClick={() => (donoServe ? criar(dono!) : setPerguntando(true))}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10.5px] font-semibold text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {criando
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Abrindo…</>
                  : <><ClipboardPlus className="h-3 w-3" /> {anterior ? "Começar de novo" : "Começar"} — criar tarefa{donoServe ? ` para ${dono}` : ""}</>}
              </button>
              {anterior && (
                <div className="mt-1 text-center text-[9.5px] leading-tight text-slate-600">
                  A tarefa anterior foi {anterior}
                  {/* Arquivada some das listas de /tarefas — mandar clicar num
                      link que não acha nada seria pior que não oferecer. */}
                  {anterior === "concluída" && onVerTarefa && (
                    <> — <button onClick={onVerTarefa} className="underline decoration-dotted underline-offset-2 transition hover:text-slate-400">ver</button></>
                  )}
                  .
                </div>
              )}
            </>
          )}
        </div>
      )}
      </div>

      {/* ações fixas — nunca somem, por mais longo que seja o texto acima */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-white/[0.08] bg-black/30 px-4 py-3">
        <button onClick={onEditar} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground transition hover:brightness-110">
          <Pencil className="h-3 w-3" /> Editar
        </button>
        {onConectar && (
          <button onClick={onConectar} className="inline-flex items-center gap-1 rounded-md border border-white/[0.12] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.07]">
            <Link2 className="h-3 w-3" /> Conectar
          </button>
        )}
        {onSoltar && n.fixo && (
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
