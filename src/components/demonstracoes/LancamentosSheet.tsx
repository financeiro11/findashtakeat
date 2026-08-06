import { Fragment, useCallback, useEffect, useState } from "react";
import { Loader2, TriangleAlert, Check, FileText, Users, Undo2, ArrowRightLeft, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CategoriaEditavel } from "@/components/demonstracoes/TrocarCategoria";
import { ehCartao, lerObservacaoTitulo } from "@/lib/observacaoTitulo";

/* ---------------------------------------------------------------------------
 * Auditoria: os lançamentos do Omie por trás de uma célula da DRE/DFC.
 *
 * Chama a função `demonstracoes_lancamentos` (ver a migration
 * 20260803150000), que reproduz a atribuição do omie-sync. A soma é sempre
 * exibida ao lado do valor da célula: quando as duas batem, é o carimbo de que
 * a lista está completa; quando não batem, o painel diz por quê em vez de
 * deixar a conta furada passar batido.
 * ------------------------------------------------------------------------- */

export type AlvoLancamentos = {
  tipo: "dre" | "dfc";
  rubrica: string;
  mes: string;        // "Jul-26"
  mesLabel: string;   // "Jul 26"
  celula: number | null;
  travado: boolean;
};

type Lancamento = {
  data: string | null;
  vencimento: string | null;
  titulo: string | null;
  documento: string | null;
  contraparte: string | null;
  cnpj_cpf: string | null;
  categoria_codigo: string | null;
  categoria_descricao: string | null;
  grupo: string | null;
  status: string | null;
  valor: number | null;
  cod_titulo: string | null;
};

/* Alerta de reclassificação (migration 20260804120000): este fornecedor vinha
   caindo noutra rubrica. Casa com o lançamento pelo `cod_titulo`. */
type Alerta = {
  id: string;
  cod_titulo: string;
  fornecedor: string | null;
  rubrica_padrao: string;
  valor: number | null;
  valor_padrao: number | null;
  severidade: "alta" | "media" | "baixa";
  status: "aberto" | "ignorado";
  hist_lancamentos: number | null;
  hist_no_padrao: number | null;
  ignorado_motivo: string | null;
};

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const dataCurta = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—");

/** CNPJ/CPF só com dígitos fica ilegível numa coluna estreita. */
const doc = (v: string | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return v ?? "—";
};

export function LancamentosSheet({
  alvo, onClose, onCategoriaTrocada,
}: {
  alvo: AlvoLancamentos | null;
  onClose: () => void;
  /** Recalcular a demonstração depois da troca — quem sabe fazer isso é a página. */
  onCategoriaTrocada?: () => void | Promise<void>;
}) {
  const [linhas, setLinhas] = useState<Lancamento[]>([]);
  const [alertas, setAlertas] = useState<Map<string, Alerta>>(new Map());
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  /* Qual seletor de categoria está aberto (cod_titulo). Fica aqui em cima
     porque o botão "Mover para …" do alerta abre o seletor da linha DE CIMA. */
  const [trocando, setTrocando] = useState<string | null>(null);

  /** Alertas da célula, por lançamento. Isolado porque é recarregado sozinho a
   *  cada "ignorar" — a lista de lançamentos não muda nessa hora. */
  const carregarAlertas = useCallback(async () => {
    if (!alvo) return;
    const { data } = await supabase.rpc("demonstracoes_reclassificacoes_celula", {
      p_tipo: alvo.tipo, p_rubrica: alvo.rubrica, p_mes: alvo.mes,
    });
    const m = new Map<string, Alerta>();
    for (const a of (data as Alerta[]) ?? []) m.set(a.cod_titulo, a);
    setAlertas(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.tipo, alvo?.rubrica, alvo?.mes]);

  /* ----- observação do título ------------------------------------------
   * Todo gasto de cartão chega aqui como "Lancamento Fatura Cartao" — é o
   * balde da fatura no ERP. O que cada linha É está na OBSERVAÇÃO do título,
   * que o Omie só entrega em ConsultarContaPagar, um título por chamada. Por
   * isso o texto é guardado em `omie_titulo_texto`: lido uma vez, vale sempre.
   * Ver a edge function `omie-titulo-texto`. */
  const [textos, setTextos] = useState<Map<string, string | null>>(new Map());
  const [buscandoObs, setBuscandoObs] = useState(false);

  const lerTextos = useCallback(async (cods: string[]): Promise<Map<string, string | null>> => {
    const m = new Map<string, string | null>();
    if (!cods.length) return m;
    const { data } = await supabase
      .from("omie_titulo_texto" as never)
      .select("cod_titulo,observacao")
      .in("cod_titulo", cods.map(Number));
    for (const r of (data as unknown as { cod_titulo: number; observacao: string | null }[]) ?? []) {
      m.set(String(r.cod_titulo), r.observacao);
    }
    return m;
  }, []);

  /** Busca no Omie o texto que ainda não temos. Sequencial lá dentro (a API
   *  recusa chamadas simultâneas do mesmo método), então vem com teto: o que
   *  não couber é oferecido num botão em vez de segurar o painel. */
  const buscarObs = useCallback(async (cods: string[]) => {
    if (!cods.length) return;
    setBuscandoObs(true);
    try {
      const { data, error } = await supabase.functions.invoke("omie-titulo-texto", {
        body: { cod_titulos: cods },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      // Relê o cache: quem entrou some da lista de pendentes sozinho, e o que
      // não coube no teto da função continua lá para o botão.
      const novos = await lerTextos(cods);
      setTextos((antes) => new Map([...antes, ...novos]));
    } catch (e) {
      // Acessório: sem a observação a lista continua de pé, só sem o nome do
      // lojista. Não vale derrubar a auditoria por isso.
      toast.error("Não consegui buscar as observações no Omie: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBuscandoObs(false);
    }
  }, [lerTextos]);

  const carregar = useCallback(async () => {
    if (!alvo) return;
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase
      .rpc("demonstracoes_lancamentos", { p_tipo: alvo.tipo, p_rubrica: alvo.rubrica, p_mes: alvo.mes });
    if (error) { setErro(error.message); setLinhas([]); setTextos(new Map()); setCarregando(false); return; }

    const rows = (data as Lancamento[]) ?? [];
    setLinhas(rows);
    const cods = rows.map((l) => l.cod_titulo).filter(Boolean) as string[];
    const cache = await lerTextos(cods);
    setTextos(cache);
    setCarregando(false);

    // Só o cartão puxa texto sozinho: é onde a contraparte não diz nada. Nas
    // demais linhas o nome do fornecedor já está na tela e a chamada não se
    // pagaria. Sem await: a lista aparece na hora e as observações entram
    // depois, quando o Omie responder.
    const faltam = rows
      .filter((l) => l.cod_titulo && ehCartao(l.contraparte) && !cache.has(l.cod_titulo))
      .map((l) => l.cod_titulo as string);
    if (faltam.length) void buscarObs(faltam);
    // Depende dos três campos da consulta, não do objeto: `celula` e `travado`
    // mudam de identidade a cada clique e disparariam uma busca idêntica.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.tipo, alvo?.rubrica, alvo?.mes, lerTextos, buscarObs]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarAlertas(); }, [carregarAlertas]);

  /* Depois de trocar a categoria: a lista sai daqui (o lançamento foi para outra
     rubrica) e o alerta some sozinho — a detecção roda no gatilho do cache. Só
     a demonstração em si precisa de quem sabe recalcular: a página. */
  const aposTroca = useCallback(async () => {
    await carregar();
    await carregarAlertas();
    await onCategoriaTrocada?.();
  }, [carregar, carregarAlertas, onCategoriaTrocada]);

  /* escopo 'lancamento' cala só este; 'fornecedor' aceita o par de rubricas
     para sempre — é o que resolve quem legitimamente cai nas duas linhas. */
  const decidir = async (a: Alerta, escopo: "lancamento" | "fornecedor") => {
    setDecidindo(a.id);
    const { error } = await supabase.rpc("reclassificacao_ignorar", { p_id: a.id, p_escopo: escopo });
    setDecidindo(null);
    if (error) { toast.error("Não consegui registrar: " + error.message); return; }
    toast.success(escopo === "fornecedor"
      ? `As duas rubricas passam a ser normais para ${a.fornecedor ?? "este fornecedor"}.`
      : "Lançamento marcado como correto.");
    await carregarAlertas();
  };

  const reabrir = async (a: Alerta) => {
    setDecidindo(a.id);
    const { error } = await supabase.rpc("reclassificacao_reabrir", { p_id: a.id });
    setDecidindo(null);
    if (error) { toast.error("Não consegui reabrir: " + error.message); return; }
    await carregarAlertas();
  };

  const alertasAbertos = [...alertas.values()].filter(a => a.status === "aberto").length;

  /* O movimento do Omie não traz o nome da contraparte, só o código e o CNPJ —
     quem resolve é o cadastro em `omie_cache`. Enquanto esse cache estiver vazio
     a coluna mostra documento, então o botão de buscar aparece bem onde o
     problema é visto, e some sozinho depois. */
  const [buscandoNomes, setBuscandoNomes] = useState(false);
  const semNome = linhas.filter((l) => !l.contraparte).length;

  const buscarNomes = async () => {
    setBuscandoNomes(true);
    const { data, error } = await supabase.functions.invoke("omie-clientes-sync", { body: {} });
    setBuscandoNomes(false);
    if (error || data?.status === "erro") {
      toast.error("Não consegui buscar os nomes no Omie: " + (data?.erro ?? error?.message ?? "erro desconhecido"));
      return;
    }
    toast.success(`${data?.clientes ?? 0} cadastros carregados do Omie.`);
    await carregar();
  };

  /* Gastos de cartão cujo texto ainda não foi lido do Omie. `textos` guarda a
     entrada mesmo quando a observação volta vazia, então "não tem no mapa" é
     literalmente "ainda não perguntei" — e é isso que o botão resolve. */
  const cartoesSemObs = linhas
    .filter((l) => l.cod_titulo && ehCartao(l.contraparte) && !textos.has(l.cod_titulo))
    .map((l) => l.cod_titulo as string);

  const soma = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const bate = alvo?.celula != null && Math.abs(soma - alvo.celula) < 0.5;
  const dataUsada = alvo?.tipo === "dre" ? "data de registro (competência)" : "data de pagamento (caixa)";

  return (
    <Sheet open={!!alvo} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-[640px]">
        {alvo && (
          <div className="flex h-full flex-col">
            {/* ---------------- cabeçalho ---------------- */}
            <SheetHeader className="shrink-0 space-y-0 border-b border-border px-5 pb-3 pt-5 text-left">
              <SheetTitle className="text-[15px] font-semibold">
                {alvo.rubrica} <span className="text-muted-foreground">· {alvo.mesLabel}</span>
              </SheetTitle>
              <p className="pt-0.5 text-[11.5px] text-muted-foreground">
                {alvo.tipo.toUpperCase()} · lançamentos do Omie por {dataUsada}
              </p>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-2.5">
                <div>
                  <div className="text-[9px] font-bold tracking-[0.14em] text-muted-foreground">NA TELA</div>
                  <div className="num text-[15px] font-bold text-foreground">
                    {alvo.celula != null ? moeda(alvo.celula) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold tracking-[0.14em] text-muted-foreground">SOMA DOS LANÇAMENTOS</div>
                  <div className={cn("num text-[15px] font-bold", bate ? "text-emerald-600" : "text-foreground")}>
                    {moeda(soma)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold tracking-[0.14em] text-muted-foreground">QUANTIDADE</div>
                  <div className="num text-[15px] font-bold text-foreground">{linhas.length}</div>
                </div>
              </div>
            </SheetHeader>

            {/* Sem este aviso o painel mentiria: em mês travado a célula vem da
                planilha e não tem por que casar com o que o Omie tem. */}
            {!carregando && !erro && !bate && alvo.celula != null && (
              <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
                <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-amber-900">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    A soma difere da célula em <b className="num">{moeda(soma - alvo.celula)}</b>.
                    {alvo.travado
                      ? " Este mês está travado, então o valor na tela veio do tracker, não do Omie — a diferença é o quanto as duas fontes discordam."
                      : " Pode ser lançamento fora da janela de sincronização ou mudança no DE-PARA depois do último recálculo."}
                  </span>
                </div>
              </div>
            )}
            {!carregando && !erro && bate && (
              <div className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-5 py-2 text-[11.5px] text-emerald-800">
                <Check className="mr-1 inline h-3.5 w-3.5" />
                A soma dos lançamentos bate exatamente com o valor na tela.
              </div>
            )}

            {!carregando && !erro && alertasAbertos > 0 && (
              <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
                <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-amber-900">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {alertasAbertos === 1
                      ? "1 lançamento aqui está numa rubrica diferente da que o fornecedor vinha usando."
                      : `${alertasAbertos} lançamentos aqui estão numa rubrica diferente da que o fornecedor vinha usando.`}
                    {" "}Estão destacados abaixo — pode ser classificação errada no Omie.
                  </span>
                </div>
              </div>
            )}

            {!carregando && !erro && (buscandoObs || cartoesSemObs.length > 0) && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-5 py-2">
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  {buscandoObs
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Buscando a observação dos gastos de cartão no Omie…</>
                    : <><CreditCard className="h-3 w-3" /> {cartoesSemObs.length} gasto(s) de cartão sem a observação carregada.</>}
                </span>
                {!buscandoObs && (
                  <button
                    onClick={() => buscarObs(cartoesSemObs)}
                    title="Cada título custa uma consulta ao Omie; o que já foi lido não é lido de novo."
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium transition hover:bg-secondary"
                  >
                    <CreditCard className="h-3 w-3" /> Buscar observações
                  </button>
                )}
              </div>
            )}

            {!carregando && !erro && semNome > 0 && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-5 py-2">
                <span className="text-[11.5px] text-muted-foreground">
                  {semNome === linhas.length
                    ? "Nenhuma contraparte tem nome — o Omie manda só o código no lançamento."
                    : `${semNome} de ${linhas.length} contrapartes sem nome.`}
                </span>
                <button
                  onClick={buscarNomes}
                  disabled={buscandoNomes}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium transition hover:bg-secondary disabled:opacity-50"
                >
                  {buscandoNomes
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Buscando…</>
                    : <><Users className="h-3 w-3" /> Buscar nomes no Omie</>}
                </button>
              </div>
            )}

            {/* ---------------- lista ---------------- */}
            <div className="min-h-0 flex-1 overflow-auto">
              {carregando ? (
                <div className="flex h-32 items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando lançamentos…
                </div>
              ) : erro ? (
                <div className="px-5 py-8 text-center text-[12.5px] text-primary">{erro}</div>
              ) : !linhas.length ? (
                <div className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
                  Nenhum lançamento do Omie caiu nesta rubrica neste mês.
                  {alvo.travado && (
                    <div className="mt-1 text-[11.5px]">
                      Como o mês está travado, o valor da tela vem do tracker importado.
                    </div>
                  )}
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                    <tr className="border-b border-border text-[9.5px] font-semibold tracking-[0.06em] text-muted-foreground">
                      <th className="px-3 py-2 text-left">DATA</th>
                      <th className="px-2 py-2 text-left">CONTRAPARTE</th>
                      <th className="px-2 py-2 text-left">CATEGORIA NO OMIE</th>
                      <th className="px-3 py-2 text-right">VALOR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l, i) => {
                      const a = l.cod_titulo ? alertas.get(l.cod_titulo) : undefined;
                      const aberto = a?.status === "aberto";
                      const obs = l.cod_titulo ? textos.get(l.cod_titulo) : undefined;
                      const lida = lerObservacaoTitulo(obs);
                      return (
                      <Fragment key={i}>
                      <tr className={cn(
                        "align-top hover:bg-muted/30",
                        aberto ? "border-b border-amber-300 bg-amber-100/60" : "border-b border-border/60",
                      )}>
                        <td className="whitespace-nowrap px-3 py-2 text-[11.5px] num text-muted-foreground">
                          {dataCurta(l.data)}
                        </td>
                        {/* No cartão a contraparte é sempre o balde da fatura
                            ("Lancamento Fatura Cartao") e quem identifica o gasto
                            é a observação do título — então ela vem na frente, e
                            o balde desce para a linha de apoio. O texto cru fica
                            no hover, porque é ele que se confere contra o ERP. */}
                        <td className="px-2 py-2 text-[11.5px]">
                          <div className="flex items-center gap-1 text-foreground">
                            {aberto && <TriangleAlert strokeWidth={2.5} className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-800" />}
                            {lida ? (
                              <span className="inline-flex items-center gap-1" title={obs ?? undefined}>
                                <CreditCard className="h-3 w-3 shrink-0 text-muted-foreground" />
                                {lida.estabelecimento}
                              </span>
                            ) : (l.contraparte ?? doc(l.cnpj_cpf))}
                          </div>
                          <div className="mt-px flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
                            {lida && <span title={obs ?? undefined}>{l.contraparte ?? doc(l.cnpj_cpf)}</span>}
                            {lida?.detalhe && <span>{lida.detalhe}</span>}
                            {lida?.parcela && <span>parcela {lida.parcela}</span>}
                            {l.titulo && <span className="inline-flex items-center gap-0.5"><FileText className="h-2.5 w-2.5" />{l.titulo}</span>}
                            {l.documento && <span>NF {l.documento}</span>}
                            {l.status && <span className="uppercase">{l.status}</span>}
                          </div>
                        </td>
                        {/* O código é o que se corrige no Omie; a descrição é o que
                            o DE-PARA casa. Auditar categorização precisa dos dois.
                            Clicar troca a categoria — no Omie e aqui. */}
                        <td className="px-2 py-2 text-[11.5px]">
                          <CategoriaEditavel
                            codTitulo={l.cod_titulo}
                            codigo={l.categoria_codigo}
                            descricao={l.categoria_descricao}
                            contraparte={l.contraparte}
                            tipo={alvo.tipo}
                            mes={alvo.mes}
                            mesLabel={alvo.mesLabel}
                            travado={alvo.travado}
                            rubricaSugerida={aberto ? a?.rubrica_padrao : null}
                            aberto={!!l.cod_titulo && trocando === l.cod_titulo}
                            onAbertoChange={(o) => setTrocando(o ? l.cod_titulo : null)}
                            onTrocado={aposTroca}
                          />
                        </td>
                        <td className={cn(
                          "whitespace-nowrap px-3 py-2 text-right text-[11.5px] num font-medium",
                          (l.valor ?? 0) < 0 ? "text-primary" : "text-emerald-700",
                        )}>
                          {moeda(Number(l.valor) || 0)}
                        </td>
                      </tr>

                      {/* A explicação vai numa linha própria: o motivo e as duas
                          decisões não cabem nas colunas sem espremer o valor. */}
                      {a && (
                        <tr className={cn("border-b", aberto ? "border-amber-300 bg-amber-100/60" : "border-border/60 bg-muted/30")}>
                          <td colSpan={4} className="px-3 pb-2.5 pt-0">
                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pl-[52px]">
                              <span className={cn("text-[11px] leading-relaxed", aberto ? "text-amber-900" : "text-muted-foreground")}>
                                Vinha em <b>{a.rubrica_padrao}</b>
                                {a.hist_no_padrao != null && a.hist_lancamentos != null && (
                                  <> ({a.hist_no_padrao} dos {a.hist_lancamentos} lançamentos anteriores)</>
                                )}
                                {a.valor_padrao != null && (
                                  <>
                                    {" · "}
                                    {a.severidade === "alta"
                                      ? <>mesmo valor de sempre, <b>{moeda(Number(a.valor_padrao))}</b></>
                                      : <>valor típico {moeda(Number(a.valor_padrao))}</>}
                                  </>
                                )}
                                {!aberto && a.status === "ignorado" && <> · <i>marcado como correto</i></>}
                              </span>

                              <span className="flex shrink-0 items-center gap-1.5">
                                {aberto ? (
                                  <>
                                    {/* Abre o seletor da linha de cima, já com as
                                        categorias da rubrica de origem no topo. */}
                                    <button
                                      onClick={() => setTrocando(a.cod_titulo)}
                                      disabled={decidindo === a.id}
                                      className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-200/70 px-2 py-1 text-[10.5px] font-semibold text-amber-950 transition hover:bg-amber-200 disabled:opacity-50"
                                      title={`Trocar a categoria no Omie — sugerindo as de "${a.rubrica_padrao}"`}
                                    >
                                      <ArrowRightLeft className="h-2.5 w-2.5" /> Trocar categoria…
                                    </button>
                                    <button
                                      onClick={() => decidir(a, "lancamento")}
                                      disabled={decidindo === a.id}
                                      className="rounded-md border border-amber-300 bg-card px-2 py-1 text-[10.5px] font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
                                    >
                                      Este está certo
                                    </button>
                                    <button
                                      onClick={() => decidir(a, "fornecedor")}
                                      disabled={decidindo === a.id}
                                      className="rounded-md border border-amber-300 bg-card px-2 py-1 text-[10.5px] font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
                                      title={`Não avisar mais quando ${a.fornecedor ?? "este fornecedor"} cair em "${a.rubrica_padrao}" ou nesta rubrica`}
                                    >
                                      Sempre pode cair nas duas
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => reabrir(a)}
                                    disabled={decidindo === a.id}
                                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                                  >
                                    <Undo2 className="h-2.5 w-2.5" /> Reabrir
                                  </button>
                                )}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
