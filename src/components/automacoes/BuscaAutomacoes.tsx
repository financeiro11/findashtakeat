import { useEffect, useRef, useState } from "react";
import { Search, X, CornerDownLeft, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TIER_META, tierDe, corTrilha, trilhaDe, nomeNivel, bandaDe, temUpgrade,
  type Nivel,
} from "./arvore-layout";
import { iconeDe } from "./arvore-icones";
import { grifar, MIN_TERMO, type Achado } from "./arvore-busca";

/* ---------------------------------------------------------------------------
 * Campo de busca da árvore — o atalho para chegar num nó sem varrer o desenho.
 *
 * O resultado mostra o nome grifado e, quando o casamento foi por outra coisa
 * (ferramenta, responsável, dor…), o trecho que casou. Sem isso a lista traz
 * linha cujo nome não tem nenhuma letra do que foi digitado e parece defeito.
 *
 * A lista é só o meio do caminho: escolher leva a árvore até o nó (enquadra,
 * seleciona e abre a ficha). Quem faz esse voo é o pai — aqui só se decide QUAL.
 * ------------------------------------------------------------------------- */

export default function BuscaAutomacoes({
  valor, onValor, achados, total, niveis, onEscolher, campoRef,
}: {
  valor: string;
  onValor: (v: string) => void;
  /** null = busca desligada (termo curto demais); [] = digitou e não achou nada */
  achados: Achado[] | null;
  total: number;
  niveis: Nivel[];
  onEscolher: (id: string) => void;
  campoRef?: React.RefObject<HTMLInputElement>;
}) {
  const [focado, setFocado] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);
  const proprio = useRef<HTMLInputElement>(null);
  const campo = campoRef ?? proprio;

  // termo novo recomeça a navegação pelo topo
  useEffect(() => { setAtivo(0); }, [valor]);

  // mantém o item ativo à vista quando se anda de seta
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>("[data-ativo=true]")
      ?.scrollIntoView({ block: "nearest" });
  }, [ativo, achados]);

  const aberto = focado && achados !== null;

  const escolher = (id: string) => {
    onEscolher(id);
    campo.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();               // em tela cheia o ESC fecharia a árvore
      if (valor) { onValor(""); return; }
      campo.current?.blur();
      return;
    }
    if (!achados?.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => (i + 1) % achados.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => (i - 1 + achados.length) % achados.length); }
    else if (e.key === "Enter") { e.preventDefault(); escolher(achados[Math.min(ativo, achados.length - 1)].r.id); }
  };

  return (
    <div className="relative ml-auto w-full sm:w-[300px]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
      <input
        ref={campo}
        value={valor}
        onChange={(e) => onValor(e.target.value)}
        onFocus={() => setFocado(true)}
        // pointerdown na lista é cancelado, então blur aqui só acontece de verdade
        onBlur={() => setFocado(false)}
        onKeyDown={onKey}
        placeholder="Buscar automação, ferramenta, responsável…"
        className="h-8 w-full rounded-md border border-white/[0.12] bg-white/[0.04] pl-8 pr-16 text-[12px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-white/25 focus:bg-white/[0.07]"
      />
      <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        {achados !== null ? (
          <span className="num text-[10px] font-semibold text-slate-500">{achados.length}/{total}</span>
        ) : (
          !valor && <span className="rounded border border-white/[0.12] px-1 font-mono text-[9px] text-slate-600">/</span>
        )}
        {valor && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onValor(""); campo.current?.focus(); }}
            title="Limpar a busca"
            className="pointer-events-auto text-slate-500 transition hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {aberto && (
        <div
          ref={listaRef}
          onPointerDown={(e) => e.preventDefault()}   // clicar na lista não pode tirar o foco do campo
          className="absolute right-0 top-[calc(100%+6px)] z-50 max-h-[340px] w-full min-w-[320px] overflow-y-auto overscroll-contain rounded-lg border border-white/[0.14] shadow-2xl sm:w-[420px]"
          style={{ background: "rgba(9,11,17,.985)" }}
        >
          {achados.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-slate-500">
              Nenhuma automação com <b className="text-slate-300">“{valor}”</b>.
              <div className="mt-1 text-[10.5px] text-slate-600">
                A busca varre nome, ferramenta, responsável, categoria, status, nível e o texto de dor, solução e upgrade.
              </div>
            </div>
          ) : (
            <>
              {achados.map((a, i) => {
                const meta = TIER_META[tierDe(a.r.status)];
                const trilha = trilhaDe(a.r.categoria);
                const cor = corTrilha(trilha);
                const Icone = iconeDe(a.r);
                return (
                  <button
                    key={a.r.id}
                    data-ativo={i === ativo}
                    onMouseEnter={() => setAtivo(i)}
                    onClick={() => escolher(a.r.id)}
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b border-white/[0.05] px-3 py-2 text-left transition last:border-b-0",
                      i === ativo ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ background: `${cor}1a`, border: `1.5px solid ${cor}77` }}
                    >
                      <Icone className="h-3.5 w-3.5" style={{ color: cor }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-100">
                          {grifar(a.r.automacao || "(sem nome)", a.nome).map((p, j) => (
                            <span key={j} className={p.forte ? "rounded-sm bg-amber-400/25 text-amber-200" : undefined}>{p.texto}</span>
                          ))}
                        </span>
                        {temUpgrade(a.r) && <ArrowUp className="h-3 w-3 shrink-0 text-emerald-400" strokeWidth={3} />}
                        <span
                          className="shrink-0 rounded-full px-1.5 py-px text-[8.5px] font-bold tracking-wider"
                          style={{ color: meta.cor, background: `${meta.cor}14`, border: `1px solid ${meta.cor}44` }}
                        >
                          {a.r.status.toUpperCase()}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[9px] tracking-[0.08em] text-slate-600">
                        {nomeNivel(niveis, bandaDe(a.r, niveis) || null)} · {trilha.toUpperCase()}
                      </span>
                      {a.trecho && (
                        <span className="mt-1 block text-[10.5px] leading-snug text-slate-400">
                          <b className="font-semibold text-slate-500">{a.trecho.rotulo}</b>
                          {" · "}
                          {grifar(a.trecho.texto, a.trecho.faixas).map((p, j) => (
                            <span key={j} className={p.forte ? "rounded-sm bg-amber-400/25 text-amber-200" : undefined}>{p.texto}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
              <div className="sticky bottom-0 flex items-center gap-3 border-t border-white/[0.07] px-3 py-1.5 text-[9.5px] text-slate-600" style={{ background: "rgba(9,11,17,.985)" }}>
                <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> Enter leva até o nó</span>
                <span>↑ ↓ navegam</span>
                <span>Esc limpa</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* dica de quando a busca ainda não ligou */}
      {focado && valor.length > 0 && achados === null && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-full rounded-lg border border-white/[0.14] px-3 py-2 text-[11px] text-slate-500 shadow-2xl" style={{ background: "rgba(9,11,17,.985)" }}>
          Digite pelo menos {MIN_TERMO} letras.
        </div>
      )}
    </div>
  );
}
