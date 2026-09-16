import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Loader2, Lock, PenLine, Tags, TriangleAlert, Unlink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { chaveRubrica } from "@/lib/demonstracoes-schema";
import { abrev } from "@/pages/cartao/valores";
import { abrevStr } from "@/pages/cartao/fmt";
import {
  leitorDaDemonstracao, montarConferencia, resumirSaude,
  type CelulaConferencia, type SaudeDePara, type SituacaoConferencia,
} from "@/lib/conferenciaDemonstracao";
import { linkCelula, tipoDaBase } from "@/lib/linksPlanoContas";
import { rotuloMes, rotuloPeriodo, type Base, type CategoriaPlano, type Recorte, type ResumoPlano } from "@/lib/planoContas";
import { Secao } from "./comum";

/* ---------------------------------------------------------------------------
 * Plano de contas × DRE/DFC — a conferência.
 *
 * Três perguntas de governança que nenhuma das duas telas respondia sozinha:
 *   1. a demonstração mostra o que as categorias do Omie somam? E quando não,
 *      é valor digitado, mês travado ou algo que ninguém explicou?
 *   2. o DE-PARA ainda aponta para categorias que existem? (nome mudado no Omie
 *      tira a categoria da DRE sem erro)
 *   3. que categorias com dinheiro no período não entram na demonstração?
 *
 * A base escolhida no topo decide a demonstração: competência confere a DRE,
 * caixa confere a DFC — é a mesma régua dos dois lados.
 * ------------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any; rpc: (n: string, a?: Record<string, unknown>) => any };

const ROTULO: Record<SituacaoConferencia, string> = {
  bate: "Bate", manual: "Valor digitado", travado: "Mês travado", diverge: "Sem explicação",
};

const TOM: Record<SituacaoConferencia, string> = {
  bate: "text-muted-foreground hover:bg-secondary",
  manual: "bg-violet-50 text-violet-800 hover:bg-violet-100",
  travado: "bg-sky-50 text-sky-800 hover:bg-sky-100",
  diverge: "bg-amber-50 font-semibold text-amber-900 hover:bg-amber-100",
};

export function Conferencia({ resumo, recorte, base, rubricaFoco, podeEditar, onAbrirCategoria, onMapear, onLimparRubrica }: {
  resumo: ResumoPlano;
  recorte: Recorte;
  base: Base;
  rubricaFoco: string | null;
  podeEditar: boolean;
  onAbrirCategoria: (codigo: string) => void;
  onMapear: (c: CategoriaPlano) => void;
  onLimparRubrica: () => void;
}) {
  const tipo = tipoDaBase(base);
  const [carregando, setCarregando] = useState(true);
  const [blob, setBlob] = useState<{ rows: Record<string, unknown>[]; columns: string[] }>({ rows: [], columns: [] });
  const [travados, setTravados] = useState<Set<string>>(new Set());
  const [manuais, setManuais] = useState<Set<string>>(new Set());
  const [saude, setSaude] = useState<SaudeDePara[]>([]);
  const [soDiverge, setSoDiverge] = useState(true);
  const [recarga, setRecarga] = useState(0);
  const [apontando, setApontando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    Promise.all([
      db.from("demonstracoes_contabeis").select("dados").eq("tipo", tipo).eq("periodo", "completo").maybeSingle(),
      db.from("demonstracoes_mes_trancado").select("col_key"),
      db.from("demonstracoes_valor_manual").select("rubrica, col_key").eq("tipo", tipo),
      db.rpc("plano_contas_de_para_saude", { p_demonstrativo: null }),
    ]).then(([b, t, m, s]) => {
      if (!vivo) return;
      setCarregando(false);
      if (b.error) toast.error(`Não consegui ler a ${tipo.toUpperCase()}: ${b.error.message}`);
      const raw = b.data?.dados;
      const rows: Record<string, unknown>[] = Array.isArray(raw?.rows) ? raw.rows : Array.isArray(raw) ? raw : [];
      const columns: string[] = (Array.isArray(raw?.columns) ? raw.columns : rows[0] ? Object.keys(rows[0]) : [])
        .filter((c: string) => /^[A-Za-z]{3}-\d{2}$/.test(c));
      setBlob({ rows, columns });
      setTravados(new Set(((t.data ?? []) as { col_key: string }[]).map((x) => String(x.col_key))));
      setManuais(new Set(((m.data ?? []) as { rubrica: string; col_key: string }[]).map((x) => `${x.rubrica}|${x.col_key}`)));
      setSaude(Array.isArray(s.data) ? (s.data as SaudeDePara[]) : []);
    });
    return () => { vivo = false; };
  }, [tipo, recarga]);

  const conferencia = useMemo(() => {
    if (!blob.columns.length) return null;
    return montarConferencia({
      tipo,
      categorias: resumo.categorias,
      mensal: resumo.mensal,
      meses: recorte.meses,
      lerDemonstracao: leitorDaDemonstracao(blob.rows, blob.columns, tipo),
      travados,
      manuais,
    });
  }, [blob, tipo, resumo, recorte.meses, travados, manuais]);

  const saudeDoTipo = useMemo(() => resumirSaude(saude, tipo), [saude, tipo]);

  const fora = useMemo(() => {
    const campo = tipo === "dre" ? "rubrica_dre" : "rubrica_dfc";
    const meses = new Set(recorte.meses);
    const soma = new Map<string, { v: number; n: number }>();
    for (const [c, mes, v, n] of resumo.mensal) {
      if (!meses.has(mes)) continue;
      const a = soma.get(c) ?? { v: 0, n: 0 };
      soma.set(c, { v: a.v + Number(v), n: a.n + Number(n) });
    }
    return resumo.categorias
      .filter((c) => !c.totalizadora && !c[campo])
      .map((c) => ({ c, ...(soma.get(c.codigo) ?? { v: 0, n: 0 }) }))
      .filter((x) => Math.abs(x.v) >= 0.005)
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  }, [resumo, recorte.meses, tipo]);

  const linhas = useMemo(() => {
    let l = conferencia?.linhas ?? [];
    if (rubricaFoco) l = l.filter((x) => chaveRubrica(x.rubrica) === chaveRubrica(rubricaFoco));
    else if (soDiverge) l = l.filter((x) => x.celulas.some((c) => c.situacao !== "bate"));
    return l;
  }, [conferencia, rubricaFoco, soDiverge]);

  async function apontar(s: SaudeDePara) {
    if (!s.sugestao_descricao) return;
    setApontando(s.id);
    const { error } = await db.from("omie_dre_mapa")
      .update({ codigo_categoria: s.sugestao_descricao, descricao_categoria: s.sugestao_descricao, updated_at: new Date().toISOString() })
      .eq("id", s.id);
    setApontando(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${s.codigo_categoria}" agora aponta para "${s.sugestao_descricao}".`, {
      description: `A ${s.demonstrativo === "dfc" ? "DFC" : "DRE"} muda depois de recalcular (botão Recalcular na tela dela).`,
    });
    setRecarga((n) => n + 1);
  }

  const nome = tipo.toUpperCase();
  const periodo = rotuloPeriodo(recorte.meses);

  return (
    <div className="space-y-3.5">
      <div className="card-surface p-4 text-[12.5px] leading-relaxed text-muted-foreground">
        <p>
          <b className="text-foreground">Base {base === "competencia" ? "competência" : "caixa"} → {nome}.</b>{" "}
          Para cada rubrica, a soma das categorias do Omie que o DE-PARA põe nela, contra o que a {nome} mostra.
          Diferença com explicação ({ROTULO.manual.toLowerCase()} ou {ROTULO.travado.toLowerCase()}, quando a coluna
          veio do tracker) aparece em cor própria; a que ninguém explicou, em âmbar. Clique numa célula para abrir os
          lançamentos dela na {nome}.
        </p>
      </div>

      {carregando || !conferencia ? (
        <div className="card-surface flex items-center gap-2 p-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lendo a {nome}…
        </div>
      ) : (
        <Secao
          titulo={`Rubricas · ${periodo}`}
          nota={<>
            {conferencia.resumo.bate} células batem · {conferencia.resumo.manual} com valor digitado ·{" "}
            {conferencia.resumo.travado} em mês travado ·{" "}
            <span className={conferencia.resumo.diverge ? "font-medium text-amber-800" : ""}>
              {conferencia.resumo.diverge} sem explicação ({abrevStr(conferencia.resumo.valorDivergente)})
            </span>
          </>}
          acao={rubricaFoco ? (
            <button type="button" onClick={onLimparRubrica} className="text-[11.5px] font-medium text-primary hover:underline">
              Só {rubricaFoco} · ver todas
            </button>
          ) : (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <input type="checkbox" checked={soDiverge} onChange={(e) => setSoDiverge(e.target.checked)} className="h-3 w-3 accent-primary" />
              Só as que têm diferença
            </label>
          )}
        >
          {linhas.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <Check className="h-4 w-4 text-pos" /> {rubricaFoco ? `${rubricaFoco} não tem categoria mapeada com valor no período.` : `Toda rubrica da ${nome} bate com as categorias do Omie em ${periodo}.`}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-1.5 font-medium">Rubrica</th>
                    {recorte.meses.map((m) => <th key={m} className="pb-1.5 text-right font-medium">{rotuloMes(m)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.rubrica} className="border-t border-border/60 align-top">
                      <td className="max-w-[280px] py-1.5 pr-3">
                        <div className="truncate font-medium text-foreground">{l.rubrica}</div>
                        <div className="flex flex-wrap gap-x-1.5 text-[10.5px] text-muted-foreground">
                          {l.categorias.slice(0, 4).map((c) => (
                            <button key={c.codigo} type="button" onClick={() => onAbrirCategoria(c.codigo)} className="hover:text-foreground hover:underline" title={c.descricao}>
                              {c.codigo}
                            </button>
                          ))}
                          {l.categorias.length > 4 && <span>+{l.categorias.length - 4}</span>}
                        </div>
                      </td>
                      {l.celulas.map((c) => (
                        <td key={c.mes} className="py-1 pl-1 text-right">
                          <CelulaLink c={c} tipo={tipo} rubrica={l.rubrica} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Secao>
      )}

      <Secao
        titulo="DE-PARA que perdeu a categoria"
        nota={saudeDoTipo.orfas.length
          ? `${saudeDoTipo.orfas.length} linha(s) da ${nome} apontam para nomes que não existem mais no Omie — o que cair nelas fica fora da demonstração`
          : `Toda linha do DE-PARA da ${nome} aponta para uma categoria que existe`}
      >
        {saudeDoTipo.orfas.length > 0 && (
          <ul className="divide-y divide-border/60">
            {[...saudeDoTipo.orfas]
              .sort((a, b) => Number(!!b.sugestao_codigo && !b.sugestao_ja_mapeada) - Number(!!a.sugestao_codigo && !a.sugestao_ja_mapeada))
              .map((s) => (
                <li key={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-[12px]">
                  <Unlink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground">
                      <span className="line-through decoration-muted-foreground/50">{s.codigo_categoria}</span>{" "}
                      <span className="text-muted-foreground">→ {s.rubrica}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {!s.sugestao_codigo ? "Sem categoria parecida no Omie — provavelmente uma categoria antiga; a linha pode sair."
                        : <>
                            {s.sugestao_motivo === "pontuacao" ? "Só a pontuação mudou: " : "Mesmo nome, outro número — confira: "}
                            <button type="button" onClick={() => onAbrirCategoria(s.sugestao_codigo!)} className="font-medium text-foreground hover:underline">
                              {s.sugestao_descricao}
                            </button>
                            {s.sugestao_ja_mapeada && " · ela já tem linha própria no DE-PARA, esta é duplicata"}
                          </>}
                    </div>
                  </div>
                  {podeEditar && s.sugestao_codigo && !s.sugestao_ja_mapeada && (
                    <button
                      type="button"
                      onClick={() => apontar(s)}
                      disabled={apontando === s.id}
                      className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium hover:bg-secondary disabled:opacity-50"
                    >
                      {apontando === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apontar para ela"}
                    </button>
                  )}
                </li>
              ))}
          </ul>
        )}
        {saudeDoTipo.orfas.length > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            As que não têm par e as duplicatas se removem no painel DE-PARA da tela da {nome}.
          </p>
        )}
      </Secao>

      <Secao
        titulo={`Com valor em ${periodo} e fora da ${nome}`}
        nota={fora.length ? `${fora.length} categoria(s) · transferência, aporte e CAPEX costumam ficar fora de propósito` : undefined}
      >
        {fora.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Toda categoria com lançamento no período entra na {nome}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <tbody>
                {fora.map(({ c, v, n }) => (
                  <tr key={c.codigo} className="border-t border-border/60 first:border-t-0">
                    <td className="max-w-[340px] py-1.5 pr-2">
                      <button type="button" onClick={() => onAbrirCategoria(c.codigo)} className="block truncate text-left font-medium text-foreground hover:underline">
                        {c.descricao}
                      </button>
                      <div className="font-mono text-[10px] text-muted-foreground">{c.codigo} · {n} lanç.</div>
                    </td>
                    <td className="num py-1.5 text-right">{abrev(v)}</td>
                    <td className="py-1.5 pl-3 text-right">
                      {podeEditar && (
                        <button type="button" onClick={() => onMapear(c)} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium hover:bg-secondary">
                          <Tags className="h-3 w-3" /> Escolher a linha
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </div>
  );
}

/* A célula abre a lista INTEIRA: a diferença pode estar num lançamento que não é
   de nenhuma das categorias mapeadas (valor digitado, tracker), e filtrar
   esconderia justamente o que explica. */
function CelulaLink({ c, tipo, rubrica }: { c: CelulaConferencia; tipo: "dre" | "dfc"; rubrica: string }) {
  const nome = tipo.toUpperCase();
  const titulo = `${ROTULO[c.situacao]}\nOmie: ${valorExato(c.omie)}\n${nome}: ${c.demonstracao == null ? "—" : valorExato(c.demonstracao)}`
    + (c.situacao === "bate" ? "" : `\nDiferença (${nome} − Omie): ${valorExato(c.diferenca)}`)
    + `\n\nClique para abrir os lançamentos na ${nome}.`;
  const Icone = c.situacao === "manual" ? PenLine : c.situacao === "travado" ? Lock : c.situacao === "diverge" ? TriangleAlert : null;
  return (
    <Link
      to={linkCelula({ tipo, rubrica, mes: c.mes })}
      title={titulo}
      className={cn("num inline-flex min-w-[76px] items-center justify-end gap-1 rounded px-1.5 py-0.5 text-[11.5px] transition", TOM[c.situacao])}
    >
      {Icone && <Icone className="h-2.5 w-2.5 shrink-0" />}
      {c.situacao === "bate"
        ? (Math.abs(c.omie) < 0.005 ? "—" : abrevStr(c.omie))
        : `${c.diferenca > 0 ? "+" : ""}${abrevStr(c.diferenca)}`}
      {c.situacao !== "bate" && <ArrowUpRight className="h-2.5 w-2.5 shrink-0 opacity-50" />}
    </Link>
  );
}
