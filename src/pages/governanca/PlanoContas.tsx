import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, Loader2, Plus, Search, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { normalize } from "@/lib/normalize";
import { useAuth } from "@/hooks/useAuth";
import { abrev } from "@/pages/cartao/valores";
import {
  FILTROS_ARVORE, PERIODOS, SEM_DEPARTAMENTO, contarFiltros, departamentosDaCategoria, ehPosicaoLivre, inicioDosDados,
  montarArvore, montarDepartamentos, montarRecorte, nosDaArvore, passaNoFiltro, rotuloMes, rotuloPeriodo, situacaoCadastro,
  type Base, type CategoriaPlano, type FiltroArvore, type LinhaDepartamento, type NoPlano, type Periodo, type ResumoPlano, type Secao,
} from "@/lib/planoContas";
import { AnaliseCategoria } from "./plano-contas/AnaliseCategoria";
import { Conferencia } from "./plano-contas/Conferencia";
import { MapearCategoria } from "./plano-contas/MapearCategoria";
import { AnaliseDepartamento, PanoramaDepartamentos } from "./plano-contas/AnaliseDepartamento";
import { EditarCategoria, type Operacao } from "./plano-contas/EditarCategoria";
import { Panorama } from "./plano-contas/Panorama";
import { Variacao } from "./plano-contas/comum";

/* ---------------------------------------------------------------------------
 * Governança › Plano de contas.
 *
 * O espelho das categorias do Omie, uma a uma — TODAS, inclusive as desativadas,
 * as posições <Disponível> e as nunca usadas (o `ListarCategorias` vai sem o filtro
 * de ativas). A DRE e a DFC olham a rubrica, que é um balde de várias categorias;
 * aqui a pergunta é a categoria: de que ela é feita, quem recebe, se o ritmo
 * mudou, se alguém a reclassificou.
 *
 * DUAS VISÕES: por categoria e por DEPARTAMENTO do Omie (a distribuição do título,
 * que só existe em conta a pagar — ver lib/planoContas.ts).
 *
 * Quem tem a capacidade `conciliacao` também CRIA e renomeia categorias — no
 * Omie, pela Edge Function `omie-plano-contas`.
 *
 * As RPCs (migrations 20260914210000 → 20260915110000) aplicam a regra da DRE/DFC,
 * por isso a soma de uma categoria fecha com a linha em que ela cai.
 * ------------------------------------------------------------------------- */

const db = supabase as unknown as {
  rpc: (n: string, a?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

type Visao = "categorias" | "departamentos" | "conferencia";

const BASES: { valor: Base; label: string; dica: string }[] = [
  { valor: "competencia", label: "Competência", dica: "A regra da DRE: data de registro do título" },
  { valor: "caixa", label: "Caixa", dica: "A regra da DFC: data do pagamento ou do recebimento" },
];

const VISOES: { valor: Visao; label: string; dica: string }[] = [
  { valor: "categorias", label: "Categorias", dica: "O plano de contas do Omie, em árvore" },
  { valor: "departamentos", label: "Departamentos", dica: "As despesas pela distribuição por departamento do título no Omie" },
  { valor: "conferencia", label: "Conferência", dica: "Categorias do Omie × DRE (competência) ou DFC (caixa), rubrica a rubrica, e o DE-PARA órfão" },
];

function lerPreferencia<T extends string>(chave: string, padrao: T, validos: readonly T[]): T {
  try {
    const v = localStorage.getItem(chave) as T | null;
    return v && validos.includes(v) ? v : padrao;
  } catch {
    return padrao;
  }
}

function gravarPreferencia(chave: string, valor: string) {
  try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento, sem memória — a tela segue */ }
}

const horaCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export default function PlanoContas() {
  const { acesso } = useAuth();
  const podeEditar = acesso.capacidades.has("conciliacao");

  const [params, setParams] = useSearchParams();
  // A base do link vence a preferência: quem sai da DFC tem de chegar em caixa.
  const [base, setBase] = useState<Base>(() => {
    const b = params.get("base");
    return b === "competencia" || b === "caixa" ? b : lerPreferencia("plano-contas.base", "competencia", ["competencia", "caixa"]);
  });
  const [periodo, setPeriodo] = useState<Periodo>(() => lerPreferencia("plano-contas.periodo", "3m", ["mes", "3m", "6m", "ano"]));
  const [filtro, setFiltro] = useState<FiltroArvore>(() => lerPreferencia("plano-contas.filtro", "movimento", ["movimento", "sem_movimento", "inativas", "todas"]));
  // Um link com ?departamento= abre direto na visão de departamentos.
  const [visao, setVisao] = useState<Visao>(() =>
    params.get("visao") === "conferencia" ? "conferencia"
      : params.get("departamento") ? "departamentos"
        : params.get("categoria") ? "categorias"
          : lerPreferencia("plano-contas.visao", "categorias", ["categorias", "departamentos", "conferencia"]));
  const [resumo, setResumo] = useState<ResumoPlano | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [recarga, setRecarga] = useState(0);
  const [operacao, setOperacao] = useState<Operacao | null>(null);
  const [mapeando, setMapeando] = useState<CategoriaPlano | null>(null);
  const selecionado = params.get("categoria");
  const departamentoSel = params.get("departamento");

  useEffect(() => { gravarPreferencia("plano-contas.base", base); }, [base]);
  useEffect(() => { gravarPreferencia("plano-contas.periodo", periodo); }, [periodo]);
  useEffect(() => { gravarPreferencia("plano-contas.filtro", filtro); }, [filtro]);
  useEffect(() => { gravarPreferencia("plano-contas.visao", visao); }, [visao]);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    db.rpc("plano_contas_resumo", { p_base: base })
      .then(({ data, error }) => {
        if (!vivo) return;
        setCarregando(false);
        if (error) { setErro(error.message); return; }
        if (!data) { setErro("O banco não liberou o plano de contas para este perfil."); return; }
        setResumo(data as ResumoPlano);
      });
    return () => { vivo = false; };
  }, [base, recarga]);

  const recorte = useMemo(() => (resumo ? montarRecorte(resumo, periodo) : null), [resumo, periodo]);
  const secoes = useMemo<Secao[]>(() => (resumo && recorte ? montarArvore(resumo, recorte) : []), [resumo, recorte]);
  const nos = useMemo(() => nosDaArvore(secoes), [secoes]);
  const folhas = useMemo(() => nos.filter((n) => n.filhos.length === 0), [nos]);
  const contagem = useMemo(() => contarFiltros(folhas), [folhas]);
  const noSelecionado = useMemo(() => nos.find((n) => n.codigo === selecionado) ?? null, [nos, selecionado]);

  const departamentos = useMemo<LinhaDepartamento[]>(
    () => (resumo && recorte ? montarDepartamentos(resumo, recorte) : []),
    [resumo, recorte],
  );
  const depSelecionado = useMemo(() => departamentos.find((d) => d.codigo === departamentoSel) ?? null, [departamentos, departamentoSel]);
  const nomesDepartamento = useMemo(
    () => new Map((resumo?.departamentos ?? []).map((d) => [d.codigo, d.descricao])),
    [resumo],
  );

  const trocarParam = (chave: "categoria" | "departamento", valor: string | null) => {
    const p = new URLSearchParams(params);
    p.delete("categoria");
    p.delete("departamento");
    p.delete("visao");
    p.delete("rubrica");
    if (valor) p.set(chave, valor);
    setParams(p, { replace: true });
  };
  const selecionar = (codigo: string | null) => trocarParam("categoria", codigo);
  const selecionarDepartamento = (codigo: string | null) => trocarParam("departamento", codigo);
  const abrirCategoria = (codigo: string) => { setVisao("categorias"); selecionar(codigo); };

  const termos = normalize(busca).toLowerCase().split(/\s+/).filter(Boolean);

  const arvoreVisivel = useMemo(() => {
    const casa = (n: NoPlano) => {
      if (!termos.length) return true;
      const alvo = normalize(`${n.codigo} ${n.descricao} ${n.categoria?.rubrica_dre ?? ""} ${n.categoria?.rubrica_dfc ?? ""}`).toLowerCase();
      return termos.every((t) => alvo.includes(t));
    };
    return secoes
      .map((s) => ({
        ...s,
        grupos: s.grupos
          .map((g) => ({ g, filhos: g.filhos.filter((f) => passaNoFiltro(f, filtro) && (casa(f) || casa(g))) }))
          // Grupo vazio no filtro só aparece em "Todas" — é onde se cria categoria num grupo novo.
          .filter(({ g, filhos }) => filhos.length > 0 || (filtro === "todas" && casa(g))),
      }))
      .filter((s) => s.grupos.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secoes, busca, filtro]);

  const departamentosVisiveis = departamentos.filter((d) =>
    !termos.length || termos.every((t) => normalize(`${d.codigo} ${d.descricao}`).toLowerCase().includes(t)));

  /* A divisão por departamento da categoria aberta. Receita fica sem: o Omie desta
     empresa não distribui conta a receber. */
  const departamentosDaAberta = useMemo(() => {
    if (!resumo || !recorte || !noSelecionado || !noSelecionado.despesa) return null;
    const codigos = noSelecionado.filhos.length ? noSelecionado.filhos.map((f) => f.codigo) : [noSelecionado.codigo];
    return {
      carregados: !!resumo.departamentos_carregados,
      linhas: departamentosDaCategoria(resumo, recorte, codigos, true),
    };
  }, [resumo, recorte, noSelecionado]);

  const inicio = resumo && recorte ? inicioDosDados(resumo.mensal, recorte.meses[recorte.meses.length - 1]) : null;
  const totalCategorias = resumo?.categorias.filter((c) => !c.totalizadora).length ?? 0;
  const totalGrupos = resumo?.categorias.filter((c) => c.totalizadora).length ?? 0;

  const alternar = (codigo: string) =>
    setFechados((s) => {
      const n = new Set(s);
      if (n.has(codigo)) n.delete(codigo); else n.add(codigo);
      return n;
    });

  return (
    <div className="space-y-3.5 px-5 pb-7 pt-3.5">
      {/* ---------------- Cabeçalho ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Plano de contas</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Omie
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {resumo
              ? <>
                  O plano inteiro do Omie: {totalCategorias} categorias em {totalGrupos} grupos
                  {(resumo.departamentos?.length ?? 0) > 0 && <> e {resumo.departamentos!.length} departamentos</>}
                  {" "}· categorias lidas em {horaCurta(resumo.categorias_atualizado_em)}, movimentos em {horaCurta(resumo.movimentos_atualizado_em)}
                  {inicio && <> · lançamentos completos desde {rotuloMes(inicio)}</>}
                </>
              : "As categorias do Omie, uma a uma"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
          <Alternador<Visao> opcoes={VISOES} valor={visao} onChange={setVisao} />
          <Alternador<Base> opcoes={BASES} valor={base} onChange={setBase} />
          <Alternador<Periodo> opcoes={PERIODOS} valor={periodo} onChange={setPeriodo} />
          {recorte && (
            <span className="text-[11.5px] text-muted-foreground">
              {rotuloPeriodo(recorte.meses)}
              {recorte.comBase ? ` × ${rotuloPeriodo(recorte.anteriores)}` : " · sem comparação"}
            </span>
          )}
          {carregando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {podeEditar && resumo && (
            <Button size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setOperacao({ tipo: "criar" })}>
              <Plus className="h-3.5 w-3.5" /> Nova categoria
            </Button>
          )}
        </div>
      </div>

      {erro && (
        <div className="card-surface flex items-start gap-2 p-4 text-[12.5px] text-neg">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Não consegui carregar o plano de contas: {erro}
        </div>
      )}

      {resumo && recorte && visao === "conferencia" && (
        <Conferencia
          resumo={resumo}
          recorte={recorte}
          base={base}
          rubricaFoco={params.get("rubrica")}
          podeEditar={podeEditar}
          onAbrirCategoria={abrirCategoria}
          onMapear={setMapeando}
          onLimparRubrica={() => {
            const p = new URLSearchParams(params);
            p.delete("rubrica");
            setParams(p, { replace: true });
          }}
        />
      )}

      {resumo && recorte && visao !== "conferencia" && (
        <div className="grid gap-3.5 lg:grid-cols-[400px_minmax(0,1fr)]">
          {/* ---------------- Lista ---------------- */}
          <aside className="card-surface flex flex-col lg:sticky lg:top-3 lg:max-h-[calc(100vh-150px)]">
            <div className="space-y-2 border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={visao === "categorias" ? "Buscar categoria, código ou rubrica…" : "Buscar departamento…"}
                  className="h-8 pl-8 text-[12.5px]"
                />
              </div>
              {visao === "categorias" ? (
                <>
                  {/* Cada situação com nome e contagem: a versão anterior escondia as
                      inativas e as nunca usadas atrás de uma caixinha desligada. */}
                  <div className="grid grid-cols-4 gap-0.5 rounded-lg border border-border bg-card p-[3px]">
                    {FILTROS_ARVORE.map((f) => (
                      <button
                        key={f.valor}
                        type="button"
                        title={f.dica}
                        onClick={() => setFiltro(f.valor)}
                        className={cn(
                          "rounded-[5px] px-1 py-1 text-center text-[11px] font-medium leading-tight transition-colors",
                          filtro === f.valor ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {f.label}
                        <span className="num block text-[10.5px] opacity-80">{contagem[f.valor]}</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => selecionar(null)} className={cn("text-[11px] font-medium text-muted-foreground hover:text-foreground", !selecionado && "text-foreground")}>
                    ← Panorama do período
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => selecionarDepartamento(null)} className={cn("text-[11px] font-medium text-muted-foreground hover:text-foreground", !departamentoSel && "text-foreground")}>
                  ← Cobertura de departamentos
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-1.5">
              {visao === "categorias" ? (
                <>
                  {arvoreVisivel.length === 0 && (
                    <p className="p-3 text-[12px] text-muted-foreground">
                      {busca ? "Nenhuma categoria com esse texto neste filtro." : "Nenhuma categoria neste filtro."}
                    </p>
                  )}
                  {arvoreVisivel.map((s) => (
                    <div key={s.chave} className="mb-2">
                      <div className="flex items-baseline justify-between px-2 pb-1 pt-1.5">
                        <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{s.titulo}</span>
                        <span className="num text-[11px] font-semibold text-muted-foreground">{abrev(s.stats.total)}</span>
                      </div>
                      {s.grupos.map(({ g, filhos }) => {
                        const aberto = !fechados.has(g.codigo) || !!busca;
                        return (
                          <div key={g.codigo}>
                            <LinhaArvore
                              no={g}
                              nivel={0}
                              ativo={selecionado === g.codigo}
                              onClick={() => selecionar(g.codigo)}
                              antes={
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); alternar(g.codigo); }}
                                  className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                                  aria-label={aberto ? "Recolher grupo" : "Abrir grupo"}
                                >
                                  <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", aberto && "rotate-90")} />
                                </button>
                              }
                              depois={podeEditar && g.categoria && !g.categoria.inativa && (
                                <button
                                  type="button"
                                  title={`Nova categoria em ${g.descricao}`}
                                  onClick={(e) => { e.stopPropagation(); setOperacao({ tipo: "criar", superior: g.codigo }); }}
                                  className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              )}
                            />
                            {aberto && filhos.map((f) => (
                              <LinhaArvore key={f.codigo} no={f} nivel={1} ativo={selecionado === f.codigo} onClick={() => selecionar(f.codigo)} />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {!resumo.departamentos_carregados && (
                    <p className="m-1.5 rounded-md border border-warn/40 bg-warn/5 p-2 text-[11.5px] text-warn">
                      Os departamentos do Omie ainda não chegaram ao Hub — entram na próxima leitura do Omie.
                    </p>
                  )}
                  {departamentosVisiveis.length === 0 && (
                    <p className="p-3 text-[12px] text-muted-foreground">Nenhum departamento com esse texto.</p>
                  )}
                  <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Despesas por departamento</div>
                  {departamentosVisiveis.map((d) => (
                    <LinhaDepartamentoArvore key={d.codigo} linha={d} ativo={departamentoSel === d.codigo} onClick={() => selecionarDepartamento(d.codigo)} />
                  ))}
                </>
              )}
            </div>
          </aside>

          {/* ---------------- Análise ---------------- */}
          <main className="min-w-0">
            {visao === "departamentos" ? (
              depSelecionado
                ? <AnaliseDepartamento linha={depSelecionado} resumo={resumo} recorte={recorte} base={base} onAbrirCategoria={abrirCategoria} />
                : <PanoramaDepartamentos linhas={departamentos} carregados={!!resumo.departamentos_carregados} recorte={recorte} />
            ) : noSelecionado ? (
              <AnaliseCategoria
                no={noSelecionado} base={base} recorte={recorte} hoje={resumo.hoje} onSelecionar={selecionar}
                podeEditar={podeEditar} onEditar={setOperacao}
                onMapear={podeEditar ? setMapeando : undefined}
                cadastro={(resumo.cadastro ?? []).filter((a) => a.codigo === noSelecionado.codigo || a.superior === noSelecionado.codigo)}
                departamentos={departamentosDaAberta}
                nomesDepartamento={nomesDepartamento}
              />
            ) : (
              <Panorama folhas={folhas} base={base} recorte={recorte} onSelecionar={selecionar} />
            )}
          </main>
        </div>
      )}

      <MapearCategoria
        categoria={mapeando}
        categorias={resumo?.categorias ?? []}
        onFechar={() => setMapeando(null)}
        onFeito={() => { setMapeando(null); setRecarga((n) => n + 1); }}
      />

      <EditarCategoria
        operacao={operacao}
        categorias={resumo?.categorias ?? []}
        vejoAFolha={acesso.remuneracao}
        onFechar={() => setOperacao(null)}
        onFeito={(codigo) => {
          setOperacao(null);
          setRecarga((n) => n + 1);
          if (codigo) abrirCategoria(codigo);
        }}
      />
    </div>
  );
}

function LinhaArvore({ no, nivel, ativo, onClick, antes, depois }: {
  no: NoPlano; nivel: 0 | 1; ativo: boolean; onClick: () => void; antes?: React.ReactNode; depois?: React.ReactNode;
}) {
  const c = no.categoria;
  const semDePara = !!c && !c.totalizadora && !c.rubrica_dre && !c.rubrica_dfc && Math.abs(no.stats.total) >= 0.005;
  const situacao = nivel === 1 ? situacaoCadastro(no) : null;
  const livre = !!c && ehPosicaoLivre(c.descricao);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 transition",
        nivel === 0 ? "pl-1" : "pl-7",
        ativo ? "bg-primary/10" : "hover:bg-secondary",
      )}
    >
      {antes}
      <div className="min-w-0 flex-1">
        <div className={cn(
          "flex items-center gap-1 truncate text-[12px]",
          nivel === 0 ? "font-semibold text-foreground" : "text-foreground/90",
          c?.inativa && "text-muted-foreground",
          livre && "italic",
        )}>
          <span className={cn("truncate", c?.inativa && !livre && "line-through decoration-muted-foreground/40")} title={no.descricao}>{no.descricao}</span>
          {semDePara && <TriangleAlert className="h-3 w-3 shrink-0 text-warn" aria-label="Fora do DE-PARA" />}
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[9.5px] text-muted-foreground">
          {no.codigo}
          {c?.inativa && !livre && <span className="font-sans">· inativa</span>}
          {livre && <span className="font-sans">· posição livre</span>}
          {situacao === "nunca_usada" && <span className="font-sans">· nunca usada</span>}
        </div>
      </div>
      {depois}
      <div className="shrink-0 text-right">
        <div className={cn("num text-[12px]", nivel === 0 && "font-semibold")}>{Math.abs(no.stats.total) >= 0.005 ? abrev(no.stats.total) : <span className="text-muted-foreground">—</span>}</div>
        {no.stats.variacao !== null && <Variacao v={no.stats.variacao} despesa={no.despesa} className="text-[10px]" />}
      </div>
    </div>
  );
}

function LinhaDepartamentoArvore({ linha, ativo, onClick }: { linha: LinhaDepartamento; ativo: boolean; onClick: () => void }) {
  const sem = linha.codigo === SEM_DEPARTAMENTO;
  const zerado = Math.abs(linha.stats.total) < 0.005;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-md py-1 pl-2 pr-2 transition",
        ativo ? "bg-primary/10" : "hover:bg-secondary",
        sem && "mt-1 border-t border-border/60 pt-1.5",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[12px]", sem ? "italic text-muted-foreground" : "text-foreground/90", zerado && !sem && "text-muted-foreground")}>
          {linha.descricao}
        </div>
        <div className="text-[9.5px] text-muted-foreground">
          {linha.categorias} {linha.categorias === 1 ? "categoria" : "categorias"}
          {linha.inativo && " · inativo"}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="num text-[12px]">{zerado ? <span className="text-muted-foreground">—</span> : abrev(linha.stats.total)}</div>
        {linha.stats.variacao !== null && <Variacao v={linha.stats.variacao} despesa className="text-[10px]" />}
      </div>
    </div>
  );
}

function Alternador<T extends string>({ opcoes, valor, onChange }: {
  opcoes: { valor: T; label: string; dica?: string }[]; valor: T; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-card p-[3px]">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          title={o.dica}
          onClick={() => onChange(o.valor)}
          className={cn(
            "h-6 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors",
            valor === o.valor ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
