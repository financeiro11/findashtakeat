import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, Check, X, Plus, Trash2, Sparkles, Undo2, ChevronDown, ChevronRight, Scale,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { paraCampo, paraNumero, rotuloMes } from "@/lib/valoresManuais";
import {
  ehParcial, erroDoAjuste, repartirAjuste, rotuloRegra, rubricasDoEbitda, somaAjustes,
} from "@/lib/ebitdaAjustado";

/* ---------------------------------------------------------------------------
 * EBITDA Ajustado: o EBITDA sem os eventos que não se repetem.
 *
 * A MÁQUINA GARIMPA, A PESSOA DECIDE. Um one-off quase nunca tem categoria
 * própria no Omie — a rescisão entra em "Equipe Comercial", o advogado entra em
 * "Assessorias & Consultorias" —, então não dá para marcar rubrica inteira. A
 * RPC `ebitda_ajuste_candidatos` varre os lançamentos do mês contra o histórico
 * de cada fornecedor e devolve os suspeitos COM O MOTIVO; este painel mostra o
 * motivo e espera alguém dizer sim ou não. Nada entra na linha sozinho.
 *
 * O que fica guardado é a decisão, não a sugestão: sugestão é derivada do cache
 * do Omie e se refaz a cada abertura. Ver a migration 20260806190000.
 * ------------------------------------------------------------------------- */

export type AjusteEbitda = {
  id: string;
  col_key: string;
  status: "aceito" | "recusado";
  origem: "sugestao" | "manual";
  cod_titulo: string | null;
  rubrica: string | null;
  contraparte: string | null;
  data: string | null;
  valor_lancamento: number | null;
  /** o add-back: quanto isto SOMA ao EBITDA */
  valor: number;
  descricao: string;
  regra: string | null;
  motivo_sugestao: string | null;
  autor_email: string | null;
  decidido_em: string;
};

type Candidato = {
  cod_titulo: string;
  data: string | null;
  rubrica: string;
  contraparte: string | null;
  cnpj_cpf: string | null;
  categoria: string | null;
  texto: string | null;
  valor_lancamento: number;
  valor: number;
  regra: string;
  motivo: string;
  forca: "alta" | "media" | "baixa";
  hist_lancamentos: number;
  hist_mediana: number | null;
};

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a tabela criada na
   migration 20260806190000 — mesmo atalho tipado dos valores manuais. */
const db = supabase as unknown as {
  from: (tabela: string) => {
    select: (cols: string) => Promise<{
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    }>;
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

const linha = (r: Record<string, unknown>): AjusteEbitda => ({
  id: String(r.id),
  col_key: String(r.col_key ?? ""),
  status: r.status === "recusado" ? "recusado" : "aceito",
  origem: r.origem === "manual" ? "manual" : "sugestao",
  cod_titulo: r.cod_titulo == null ? null : String(r.cod_titulo),
  rubrica: r.rubrica == null ? null : String(r.rubrica),
  contraparte: r.contraparte == null ? null : String(r.contraparte),
  data: r.data == null ? null : String(r.data),
  valor_lancamento: r.valor_lancamento == null ? null : Number(r.valor_lancamento),
  valor: Number(r.valor ?? 0),
  descricao: String(r.descricao ?? ""),
  regra: r.regra == null ? null : String(r.regra),
  motivo_sugestao: r.motivo_sugestao == null ? null : String(r.motivo_sugestao),
  autor_email: (r.autor_email as string) ?? null,
  decidido_em: String(r.decidido_em ?? ""),
});

/** Ajustes por mês. A tela precisa deles para a marca na célula e para o resumo. */
export function useAjustesEbitda() {
  const [mapa, setMapa] = useState<Map<string, AjusteEbitda[]>>(new Map());
  /* Quem confere se a linha do blob está atrasada precisa saber que a lista já
     chegou: comparar contra um mapa ainda vazio acusaria divergência em todo
     mês que tem ajuste. */
  const [carregado, setCarregado] = useState(false);

  const recarregar = useCallback(async () => {
    const { data, error } = await db.from("demonstracoes_ebitda_ajuste").select("*");
    if (error) {
      // Acessório como as outras marcas: a DRE continua na tela (já com a linha
      // ajustada dentro do blob) em vez de a página cair.
      setMapa(new Map());
      return;
    }
    const m = new Map<string, AjusteEbitda[]>();
    for (const r of data ?? []) {
      const a = linha(r);
      const lista = m.get(a.col_key) ?? [];
      lista.push(a);
      m.set(a.col_key, lista);
    }
    setMapa(m);
    setCarregado(true);
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  return { ajustes: mapa, ajustesCarregados: carregado, recarregarAjustes: recarregar };
}

export const aceitos = (lista: AjusteEbitda[] | undefined): AjusteEbitda[] =>
  (lista ?? []).filter((a) => a.status === "aceito");

/* ============================================================
 *  Marca na célula
 * ============================================================ */

export function fundoCelulaAjuste(): string {
  return "bg-teal-50 ring-1 ring-inset ring-teal-200";
}

export function tituloAjustes(lista: AjusteEbitda[]): string {
  const ok = aceitos(lista);
  if (!ok.length) return "clique para garimpar os eventos que não se repetem";
  const total = somaAjustes(ok);
  return `${ok.length} ajuste(s) somando ${valorExato(total)} ao EBITDA · clique para ver`;
}

/* ============================================================
 *  Painel de curadoria
 * ============================================================ */

export type AlvoAjustes = {
  col: string;
  colLabel: string;
  ebitda: number | null;
};

const moeda = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const dataCurta = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—");

const CORES_FORCA: Record<string, string> = {
  alta: "bg-teal-600 text-white",
  media: "bg-teal-100 text-teal-900",
  baixa: "bg-muted text-muted-foreground",
};

export function PainelAjustesEbitda({
  alvo, onClose, onMudou,
}: {
  alvo: AlvoAjustes | null;
  onClose: () => void;
  /** recalcular a DRE — a linha ajustada mudou dentro do blob */
  onMudou: () => void | Promise<void>;
}) {
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [decididos, setDecididos] = useState<AjusteEbitda[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [piso, setPiso] = useState(5000);
  const [textos, setTextos] = useState<Map<string, string>>(new Map());
  const [verRecusados, setVerRecusados] = useState(false);
  const [novoValor, setNovoValor] = useState("");
  const [novaDescricao, setNovaDescricao] = useState("");

  /* Quanto de CADA candidato vira ajuste.
     `modos` guarda a escolha (o lançamento todo, ou um pedaço) e `partes` o que
     foi digitado — junto com QUAL dos dois campos está sendo editado. Os dois
     campos são espelhos ("devolve 33,5k" ⇄ "ficam 6,5k"), e sem saber qual está
     na mão da pessoa o outro reformataria o número no meio da digitação. */
  const [modos, setModos] = useState<Map<string, "tudo" | "parte">>(new Map());
  const [partes, setPartes] = useState<Map<string, { campo: "devolve" | "fica"; texto: string }>>(new Map());
  /** Ajuste já aceito cujo valor está sendo reescrito na lista de cima. */
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);

  const rubricas = useMemo(() => rubricasDoEbitda(), []);

  const carregar = useCallback(async (pisoAtual: number) => {
    if (!alvo) return;
    setCarregando(true);
    setErro(null);
    try {
      const [cand, dec] = await Promise.all([
        db.rpc("ebitda_ajuste_candidatos", { p_mes: alvo.col, p_rubricas: rubricas, p_piso: pisoAtual }),
        db.from("demonstracoes_ebitda_ajuste").select("*"),
      ]);
      if (cand.error) throw new Error(cand.error.message);
      setCandidatos(((cand.data as Candidato[]) ?? []).map((c) => ({ ...c, valor: Number(c.valor) })));
      setDecididos(((dec.data ?? []) as Record<string, unknown>[]).map(linha).filter((a) => a.col_key === alvo.col));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setCandidatos([]);
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.col, rubricas]);

  useEffect(() => {
    if (!alvo) {
      setCandidatos([]); setDecididos([]); setTextos(new Map()); setVerRecusados(false);
      setModos(new Map()); setPartes(new Map()); setEditando(null);
      return;
    }
    carregar(piso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.col]);

  const chamar = async (body: Record<string, unknown>, ok: string, marca: string) => {
    setOcupado(marca);
    try {
      const { data, error } = await supabase.functions.invoke("demonstracoes-ebitda-ajuste", { body });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success(ok);
      await carregar(piso);
      await onMudou();
    } catch (e) {
      toast.error("Não consegui salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setOcupado(null);
    }
  };

  const decididosPorTitulo = useMemo(() => {
    const m = new Map<string, AjusteEbitda>();
    for (const d of decididos) if (d.cod_titulo) m.set(d.cod_titulo, d);
    return m;
  }, [decididos]);

  const pendentes = useMemo(
    () => candidatos.filter((c) => !decididosPorTitulo.has(c.cod_titulo)),
    [candidatos, decididosPorTitulo],
  );
  const naLinha = useMemo(() => decididos.filter((d) => d.status === "aceito"), [decididos]);
  const recusados = useMemo(() => decididos.filter((d) => d.status === "recusado"), [decididos]);

  const total = somaAjustes(naLinha);
  const ajustado = alvo?.ebitda == null ? null : alvo.ebitda + total;

  /** Descrição pré-escrita a partir do que a máquina viu — quem aceita edita. */
  const descricaoDe = (c: Candidato) =>
    textos.get(c.cod_titulo) ??
    [c.contraparte, c.categoria].filter(Boolean).join(" · ") ??
    "";

  /* O "salto" já chega repartido pela RPC (ela sugere só o excesso sobre a
     mediana do fornecedor), então esse candidato abre em "Só parte" com o excesso
     preenchido. Os outros abrem em "Valor todo" — nada muda para quem só aceita. */
  const modoDe = (c: Candidato): "tudo" | "parte" =>
    modos.get(c.cod_titulo) ?? (ehParcial(c.valor_lancamento, c.valor) ? "parte" : "tudo");

  /**
   * Quanto este candidato devolve ao EBITDA e quanto fica no mês, já com sinal.
   *
   * Em "Só parte" o número sai do que foi digitado — em QUALQUER um dos dois
   * campos, porque o outro é só o complemento. `repartirAjuste` põe o sinal e
   * segura o teto, então nada aqui precisa saber que despesa mora negativa.
   */
  const escolhaDe = (c: Candidato): { valor: number; fica: number } => {
    const cheio = Number(c.valor_lancamento);
    if (!Number.isFinite(cheio) || cheio === 0) return { valor: c.valor, fica: 0 };
    if (modoDe(c) === "tudo") return repartirAjuste(cheio, cheio);

    const p = partes.get(c.cod_titulo);
    // Sem nada digitado ainda, o campo já vem com a sugestão da máquina.
    if (!p) return repartirAjuste(cheio, c.valor);
    const digitado = Math.abs(paraNumero(p.texto) ?? 0);
    return repartirAjuste(cheio, p.campo === "devolve" ? digitado : Math.abs(cheio) - digitado);
  };

  const aceitar = (c: Candidato) => {
    const descricao = descricaoDe(c).trim();
    if (!descricao) { toast.error("Diga por que este lançamento não se repete."); return; }
    const { valor } = escolhaDe(c);
    const erro = erroDoAjuste(c.valor_lancamento, valor);
    if (erro) { toast.error(erro); return; }
    chamar({
      acao: "decidir", col_key: alvo!.col, cod_titulo: c.cod_titulo, status: "aceito",
      valor, valor_lancamento: c.valor_lancamento, rubrica: c.rubrica,
      contraparte: c.contraparte, data: c.data, descricao,
      regra: c.regra, motivo_sugestao: c.motivo,
    }, "Entrou no EBITDA Ajustado.", c.cod_titulo);
  };

  /** Reescreve o valor de um ajuste JÁ aceito — o "na verdade só parte disso". */
  const salvarValor = (a: AjusteEbitda) => {
    const digitado = paraNumero(editando?.texto ?? "");
    if (digitado == null) { toast.error("Digite o valor do ajuste."); return; }
    // Com lançamento por trás o sinal é dele e o campo é módulo; no avulso quem
    // digita escolhe o sinal (positivo devolve ao EBITDA, negativo tira).
    const valor = a.valor_lancamento == null
      ? digitado
      : repartirAjuste(a.valor_lancamento, digitado).valor;
    const erro = erroDoAjuste(a.valor_lancamento, valor);
    if (erro) { toast.error(erro); return; }
    chamar({ acao: "editar", id: a.id, valor }, "Valor do ajuste atualizado.", a.id)
      .then(() => setEditando(null));
  };

  const recusar = (c: Candidato) => chamar({
    acao: "decidir", col_key: alvo!.col, cod_titulo: c.cod_titulo, status: "recusado",
    valor: 0, valor_lancamento: c.valor_lancamento, rubrica: c.rubrica,
    contraparte: c.contraparte, data: c.data, descricao: "Não é ajuste",
    regra: c.regra, motivo_sugestao: c.motivo,
  }, "Marcado como recorrente — não volta a aparecer.", c.cod_titulo);

  const incluirManual = () => {
    const v = paraNumero(novoValor);
    if (v == null || v === 0) { toast.error("Digite o valor do ajuste."); return; }
    if (!novaDescricao.trim()) { toast.error("Descreva o ajuste."); return; }
    chamar(
      { acao: "manual", col_key: alvo!.col, valor: v, descricao: novaDescricao.trim() },
      "Ajuste incluído.",
      "manual",
    ).then(() => { setNovoValor(""); setNovaDescricao(""); });
  };

  return (
    <Sheet open={!!alvo} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[720px] overflow-y-auto p-0">
        {alvo && (
          <>
            <SheetHeader className="border-b border-border px-5 py-4">
              <SheetTitle className="flex items-center gap-2 text-[15px]">
                <Scale className="h-4 w-4 text-teal-700" />
                Ajustes de EBITDA · {alvo.colLabel}
              </SheetTitle>
              <div className="mt-2 grid grid-cols-3 gap-2 text-left">
                {[
                  { t: "EBITDA", v: alvo.ebitda, cor: "text-foreground" },
                  { t: "AJUSTES", v: total || null, cor: "text-teal-700" },
                  { t: "EBITDA AJUSTADO", v: ajustado, cor: "text-teal-800" },
                ].map((k) => (
                  <div key={k.t} className="rounded-md border border-border bg-card px-2.5 py-2">
                    <div className="text-[9.5px] font-semibold tracking-[0.08em] text-muted-foreground">{k.t}</div>
                    <div className={cn("num mt-0.5 text-[14px] font-bold", k.cor)} title={k.v == null ? undefined : valorExato(k.v)}>
                      {k.v == null ? "—" : moeda(k.v)}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Só entra o que já estava <b>dentro</b> do EBITDA — receita, custos e SG&amp;A. A linha é de memória:
                não mexe no EBITDA nem no Lucro Líquido.
              </p>
            </SheetHeader>

            <div className="px-5 py-4 space-y-5">
              {/* ---------- já na linha ---------- */}
              <section>
                <h3 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground">
                  NO AJUSTE ({naLinha.length})
                </h3>
                {!naLinha.length ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
                    Nenhum ajuste neste mês — o EBITDA Ajustado é igual ao EBITDA.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {naLinha.map((a) => (
                      <div key={a.id} className="flex items-start gap-2 rounded-md border border-teal-200 bg-teal-50/60 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium leading-snug text-foreground">{a.descricao}</div>
                          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                            {[
                              a.origem === "manual" ? "avulso" : a.contraparte,
                              a.rubrica,
                              a.data ? dataCurta(a.data) : null,
                              a.autor_email,
                            ].filter(Boolean).join(" · ")}
                          </div>
                          {ehParcial(a.valor_lancamento, a.valor) && (
                            <div className="mt-0.5 text-[10.5px] text-teal-800">
                              Só uma parte: o lançamento inteiro foi {moeda(Math.abs(a.valor_lancamento!))} e
                              ficam {moeda(Math.abs(a.valor_lancamento! + a.valor))} em {alvo.colLabel}.
                            </div>
                          )}
                        </div>
                        {/* O valor é clicável: é aqui que se corrige um "achei
                            que era tudo, mas só parte era atrasado". */}
                        {editando?.id === a.id ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <input
                              value={editando.texto}
                              onChange={(e) => setEditando({ id: a.id, texto: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") salvarValor(a);
                                if (e.key === "Escape") setEditando(null);
                              }}
                              autoFocus
                              inputMode="decimal"
                              className="num w-[100px] rounded border border-input bg-background px-1.5 py-0.5 text-right text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              onClick={() => salvarValor(a)}
                              disabled={ocupado === a.id}
                              title="Salvar"
                              className="rounded p-1 text-teal-700 transition hover:bg-teal-100 disabled:opacity-40"
                            >
                              {ocupado === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditando({
                              id: a.id,
                              texto: paraCampo(a.valor_lancamento == null ? a.valor : Math.abs(a.valor)),
                            })}
                            title="Mudar quanto deste lançamento é ajuste"
                            className="num shrink-0 text-[12.5px] font-semibold text-teal-800 underline-offset-2 hover:underline"
                          >
                            <span title={valorExato(a.valor)}>{a.valor > 0 ? "+" : ""}{moeda(a.valor)}</span>
                          </button>
                        )}
                        <button
                          onClick={() => chamar({ acao: "remover", id: a.id }, "Ajuste removido.", a.id)}
                          disabled={ocupado === a.id}
                          title="Tirar da linha"
                          className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-secondary disabled:opacity-40"
                        >
                          {ocupado === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ---------- sugestões ---------- */}
              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground">
                    SUGESTÕES ({pendentes.length})
                  </h3>
                  <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    A partir de R$
                    <input
                      value={piso}
                      onChange={(e) => setPiso(Number(e.target.value.replace(/\D/g, "")) || 0)}
                      onBlur={() => carregar(piso)}
                      onKeyDown={(e) => { if (e.key === "Enter") carregar(piso); }}
                      inputMode="numeric"
                      className="num w-[72px] rounded border border-input bg-background px-1.5 py-0.5 text-right text-[11px]"
                    />
                  </label>
                </div>

                {carregando ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Garimpando os lançamentos do mês…
                  </div>
                ) : erro ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                    {erro}
                  </div>
                ) : !pendentes.length ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
                    Nada fora do padrão acima de {moeda(piso)} neste mês. Baixe o piso para olhar mais fundo.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendentes.map((c) => {
                      const modo = modoDe(c);
                      const esc = escolhaDe(c);
                      const p = partes.get(c.cod_titulo);
                      const erroParte = erroDoAjuste(c.valor_lancamento, esc.valor);
                      const digitar = (campo: "devolve" | "fica", texto: string) =>
                        setPartes((m) => new Map(m).set(c.cod_titulo, { campo, texto }));

                      return (
                      <div key={c.cod_titulo} className="rounded-md border border-border bg-card px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[12.5px] font-medium text-foreground">
                              {c.contraparte ?? "Contraparte não identificada"}
                            </div>
                            <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                              {[c.rubrica, dataCurta(c.data), c.categoria].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="num text-[12.5px] font-semibold text-teal-800" title={valorExato(esc.valor)}>
                              {esc.valor > 0 ? "+" : ""}{moeda(esc.valor)}
                            </div>
                            {/* Com o ajuste parcial o lançamento inteiro sai da
                                vista; sem ele aqui, some a referência do que se
                                está repartindo. */}
                            {ehParcial(c.valor_lancamento, esc.valor) && (
                              <div className="num text-[9.5px] text-muted-foreground">
                                de {moeda(Math.abs(c.valor_lancamento))}
                              </div>
                            )}
                            <span className={cn(
                              "mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9.5px] font-semibold",
                              CORES_FORCA[c.forca] ?? CORES_FORCA.baixa,
                            )}>
                              {rotuloRegra(c.regra)}
                            </span>
                          </div>
                        </div>

                        {/* O porquê. É o que faz a sugestão ser conferível em vez
                            de um palpite — e o que vira a descrição do ajuste. */}
                        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                          <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-teal-600" />
                          {c.motivo}
                        </p>

                        {/* Quanto do lançamento é ajuste.
                            Uma fatura atrasada não é one-off inteira: os R$ 40 mil
                            do Datadog em julho traziam meses anteriores, mas a
                            competência de julho ali dentro é gasto de todo mês e
                            precisa CONTINUAR no EBITDA. Os dois campos são
                            espelhos — preencher qualquer um resolve o outro. */}
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                          <div className="inline-flex rounded-md border border-border p-0.5">
                            {([["tudo", "Valor todo"], ["parte", "Só parte"]] as const).map(([m, rotulo]) => (
                              <button
                                key={m}
                                onClick={() => setModos((x) => new Map(x).set(c.cod_titulo, m))}
                                className={cn(
                                  "rounded px-2 py-0.5 text-[10.5px] font-medium transition",
                                  modo === m ? "bg-teal-700 text-white" : "text-muted-foreground hover:bg-secondary",
                                )}
                              >
                                {rotulo}
                              </button>
                            ))}
                          </div>

                          {modo === "parte" && (
                            <>
                              <label className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                                devolve
                                <input
                                  value={p?.campo === "devolve" ? p.texto : paraCampo(Math.abs(esc.valor))}
                                  onChange={(e) => digitar("devolve", e.target.value)}
                                  inputMode="decimal"
                                  className="num w-[92px] rounded border border-input bg-background px-1.5 py-0.5 text-right text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </label>
                              <label className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                                fica em {alvo.colLabel}
                                <input
                                  value={p?.campo === "fica" ? p.texto : paraCampo(Math.abs(esc.fica))}
                                  onChange={(e) => digitar("fica", e.target.value)}
                                  inputMode="decimal"
                                  className="num w-[92px] rounded border border-input bg-background px-1.5 py-0.5 text-right text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </label>
                            </>
                          )}
                        </div>
                        {erroParte && (
                          <p className="mt-1 text-[10.5px] leading-snug text-destructive">{erroParte}</p>
                        )}

                        <div className="mt-2 flex items-center gap-1.5">
                          <input
                            value={descricaoDe(c)}
                            onChange={(e) => setTextos((m) => new Map(m).set(c.cod_titulo, e.target.value))}
                            placeholder="Por que não se repete? (fica na DRE e vai para a IA)"
                            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <button
                            onClick={() => aceitar(c)}
                            disabled={ocupado === c.cod_titulo || !!erroParte}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-teal-700 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-teal-800 disabled:opacity-50"
                          >
                            {ocupado === c.cod_titulo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            É ajuste
                          </button>
                          <button
                            onClick={() => recusar(c)}
                            disabled={ocupado === c.cod_titulo}
                            title="É gasto recorrente — não some ao EBITDA Ajustado"
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                          >
                            <X className="h-3 w-3" /> Não é
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* ---------- recusados ---------- */}
              {!!recusados.length && (
                <section>
                  <button
                    onClick={() => setVerRecusados((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground hover:text-foreground"
                  >
                    {verRecusados ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    DESCARTADOS ({recusados.length})
                  </button>
                  {verRecusados && (
                    <div className="mt-2 space-y-1">
                      {recusados.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground">
                          <span className="min-w-0 flex-1 truncate">
                            {a.contraparte ?? "—"}
                            {a.valor_lancamento != null && <span className="num"> · {moeda(Math.abs(a.valor_lancamento))}</span>}
                          </span>
                          <button
                            onClick={() => chamar({ acao: "remover", id: a.id }, "Voltou para as sugestões.", a.id)}
                            disabled={ocupado === a.id}
                            title="Voltar a considerar"
                            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-secondary disabled:opacity-40"
                          >
                            {ocupado === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                            reconsiderar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* ---------- avulso ---------- */}
              <section className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
                <h3 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground">
                  INCLUIR À MÃO
                </h3>
                <p className="mb-2 text-[10.5px] leading-snug text-muted-foreground">
                  Para o que não tem lançamento no Omie — provisão revertida, estorno, ajuste de fechamento.
                  Positivo devolve ao EBITDA; negativo tira.
                </p>
                <div className="flex items-center gap-1.5">
                  <input
                    value={novoValor}
                    onChange={(e) => setNovoValor(e.target.value)}
                    placeholder="0,00"
                    inputMode="decimal"
                    className="num w-[110px] shrink-0 rounded-md border border-input bg-background px-2 py-1 text-right text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    value={novaDescricao}
                    onChange={(e) => setNovaDescricao(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") incluirManual(); }}
                    placeholder="O que é, e por que não se repete"
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={incluirManual}
                    disabled={ocupado === "manual"}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-teal-700 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-teal-800 disabled:opacity-50"
                  >
                    {ocupado === "manual" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Incluir
                  </button>
                </div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ============================================================
 *  Resumo acima da tabela
 * ============================================================ */

export function ResumoAjustesEbitda({
  mapa, colunas, onAbrir,
}: {
  mapa: Map<string, AjusteEbitda[]>;
  colunas: string[];
  onAbrir: (col: string) => void;
}) {
  const visiveis = useMemo(() => {
    const cols = new Set(colunas);
    const ordem = new Map(colunas.map((c, i) => [c, i]));
    return [...mapa.entries()]
      .filter(([col, lista]) => cols.has(col) && lista.some((a) => a.status === "aceito"))
      .sort((a, b) => ordem.get(a[0])! - ordem.get(b[0])!);
  }, [mapa, colunas]);

  if (!visiveis.length) return null;

  const quantos = visiveis.reduce((s, [, lista]) => s + aceitos(lista).length, 0);
  const total = visiveis.reduce((s, [, lista]) => s + somaAjustes(aceitos(lista)), 0);

  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-lg border border-teal-300 bg-teal-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-teal-950">
      <span className="flex items-start gap-2">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
        <span>
          <b>{quantos}</b> {quantos === 1 ? "evento não recorrente devolve" : "eventos não recorrentes devolvem"}{" "}
          <b className="num">{valorExato(total)}</b> ao EBITDA nos meses visíveis. A linha <b>EBITDA Ajustado</b> mostra
          o resultado sem eles — o EBITDA e o Lucro Líquido continuam intactos.
        </span>
      </span>
      <span className="flex shrink-0 flex-wrap gap-1">
        {visiveis.map(([col, lista]) => (
          <button
            key={col}
            onClick={() => onAbrir(col)}
            className="rounded-md border border-teal-300 bg-card px-2 py-0.5 text-[11px] font-medium text-teal-900 transition hover:bg-teal-100"
          >
            {rotuloMes(col)} · {aceitos(lista).length}
          </button>
        ))}
      </span>
    </div>
  );
}
