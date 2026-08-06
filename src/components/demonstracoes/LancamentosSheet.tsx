import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Loader2, TriangleAlert, Check, FileText, Users, Undo2, ArrowRightLeft, CreditCard,
  ChevronDown, ArrowUp, ArrowDown, Equal, History,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CategoriaEditavel } from "@/components/demonstracoes/TrocarCategoria";
import { ehCartao, lerObservacaoTitulo } from "@/lib/observacaoTitulo";
import { mesCurto } from "@/lib/demonstracoes-schema";
import { BarraFiltros, CabecalhoValor } from "@/components/demonstracoes/FiltroLancamentos";
import { TrocarCategoriaLote } from "@/components/demonstracoes/TrocarCategoriaLote";
import { podeTrocarCategoria, motivoNaoAlteravel, type ItemLote } from "@/lib/loteCategoria";
import {
  categoriasDaCelula, filtrarLancamentos, filtroInicial, type Filtro,
} from "@/lib/filtroLancamentos";
import {
  janelaDeMeses, montarComparativo, rotuloSituacao, explicarFornecedor, resumoComparativo,
  type Comparativo, type Fornecedor, type LinhaContraparte,
} from "@/lib/comparativoFornecedores";

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

/** Sem centavos, para a tabela do comparativo caber. O valor cheio vai no hover. */
const moedaSemCentavos = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const dataCurta = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—");

/* Quantos meses para trás o comparativo olha. Doze porque é o que separa
   "fornecedor novo" de "fornecedor que cobra uma vez por ano" — e porque a
   janela do cache do Omie (1º de janeiro do ano passado) cobre isso. */
const MESES_DE_HISTORICO = 12;

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a assinatura de três
   argumentos de `demonstracoes_contrapartes` (migration 20260806200000). Mesmo
   atalho tipado dos ajustes de EBITDA — some quando os tipos forem regerados. */
const db = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/** CNPJ/CPF só com dígitos fica ilegível numa coluna estreita. */
const doc = (v: string | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return v ?? "—";
};

/** Caixinha de seleção. `parcial` é o estado do cabeçalho quando só uma parte
 *  do que está à vista está marcada — sem ele, o traço viraria "nada marcado". */
function Caixinha({
  marcada, parcial, onClick, titulo,
}: {
  marcada: boolean;
  parcial?: boolean;
  onClick: () => void;
  titulo: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-pressed={marcada}
      className={cn(
        "flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition",
        marcada || parcial ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/60",
      )}
    >
      {marcada ? <Check strokeWidth={3.5} className="h-2.5 w-2.5" />
        : parcial ? <span className="h-[1.5px] w-2 rounded-full bg-primary-foreground" />
        : null}
    </button>
  );
}

/* ----- o veredito do fornecedor -----------------------------------------
 * O chip resume o FORNECEDOR na rubrica — não a linha em que está pousado. Um
 * fornecedor com seis lançamentos carrega o mesmo chip nos seis, porque a
 * pergunta ("isso é novo?") é sobre ele, não sobre a parcela. O hover diz a
 * frase inteira, com os dois meses, para o número do chip nunca ser lido como
 * se fosse o da linha. */
function ChipFornecedor({ f, comp }: { f: Fornecedor; comp: Comparativo }) {
  const Icone =
    f.situacao === "subiu" ? ArrowUp
    : f.situacao === "caiu" ? ArrowDown
    : f.situacao === "igual" ? Equal
    : f.situacao === "voltou" ? History
    : null;

  /* Verde/vermelho seguem o CAIXA, não o número: numa despesa, gastar menos é
     verde mesmo com o valor "caindo". Novo e voltou não são bons nem ruins —
     são fatos —, então ficam em cor própria em vez de julgar. */
  const cor =
    f.situacao === "novo"   ? "border-indigo-300 bg-indigo-100 text-indigo-900"
    : f.situacao === "voltou" ? "border-sky-300 bg-sky-100 text-sky-900"
    : f.situacao === "igual" || f.situacao === "sumiu" ? "border-border bg-muted text-muted-foreground"
    : f.favoravel ? "border-emerald-300 bg-emerald-100 text-emerald-900"
    : "border-rose-300 bg-rose-100 text-rose-900";

  return (
    <span
      title={explicarFornecedor(f, comp, moeda)}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border px-1.5 text-[9.5px] font-semibold leading-[15px]",
        cor,
      )}
    >
      {Icone && <Icone strokeWidth={3} className="h-2.5 w-2.5" />}
      {rotuloSituacao(f)}
    </span>
  );
}

/** A rubrica inteira lado a lado com o mês anterior — inclusive quem sumiu, que
 *  não tem linha na lista para pendurar um chip e mesmo assim explica a queda. */
function TabelaComparativo({ comp }: { comp: Comparativo }) {
  const celula = (v: number, tem: boolean) =>
    tem ? <span title={moeda(v)}>{moedaSemCentavos(v)}</span> : <span className="text-muted-foreground/50">—</span>;

  return (
    <div className="max-h-[280px] overflow-auto border-t border-border">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-muted/95 backdrop-blur">
          <tr className="border-b border-border text-[9px] font-semibold tracking-[0.06em] text-muted-foreground">
            <th className="px-5 py-1.5 text-left">FORNECEDOR</th>
            <th className="px-2 py-1.5 text-right uppercase">{mesCurto(comp.mesAnterior)}</th>
            <th className="px-2 py-1.5 text-right uppercase">{mesCurto(comp.mes)}</th>
            <th className="px-5 py-1.5 text-right">VARIAÇÃO</th>
          </tr>
        </thead>
        <tbody>
          {comp.fornecedores.map((f) => (
            <tr key={f.contraparte} className="border-b border-border/50 last:border-0">
              {/* O corte vai no div, não no td: em tabela de layout automático
                  o `max-width` da célula é só uma sugestão, e o nome comprido
                  empurraria as colunas de valor para fora do painel. */}
              <td className="px-5 py-1.5 text-[11px] text-foreground">
                <div className="max-w-[230px] truncate" title={f.contraparte}>{f.contraparte}</div>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] num text-muted-foreground">
                {celula(f.valorAnterior, f.situacao !== "novo" && f.situacao !== "voltou")}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] num font-medium text-foreground">
                {celula(f.valor, f.situacao !== "sumiu")}
              </td>
              <td className="px-5 py-1.5 text-right">
                <ChipFornecedor f={f} comp={comp} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Em mês travado a célula vem do tracker, mas fornecedor não existe no
          tracker: esta comparação é sempre Omie contra Omie, e dizer isso evita
          que a diferença com a célula seja lida como erro do comparativo. */}
      <div className="border-t border-border bg-muted/40 px-5 py-1.5 text-[10px] text-muted-foreground">
        Comparação feita sobre os lançamentos do Omie nesta rubrica, nos {comp.janela.length - 1} meses anteriores.
      </div>
    </div>
  );
}

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
  /* Quem já foi decidido nesta abertura continua no bloco de cima. Sem isso a
     linha escaparia de baixo do cursor no instante do clique em "Este está
     certo" — e a próxima decisão sairia errada. */
  const [recemDecididos, setRecemDecididos] = useState<Set<string>>(new Set());
  /* Qual seletor de categoria está aberto (cod_titulo). Fica aqui em cima
     porque o botão "Mover para …" do alerta abre o seletor da linha DE CIMA. */
  const [trocando, setTrocando] = useState<string | null>(null);

  /* ----- o mesmo corte um mês atrás -------------------------------------
   * Carrega em paralelo com a lista: é informação de apoio, e segurar o painel
   * por ela seria trocar a auditoria (o que se veio fazer aqui) por um adorno.
   * Falha caladamente pelo mesmo motivo — sem comparativo a lista continua
   * inteira, só sem os chips. */
  const [comparativo, setComparativo] = useState<Comparativo | null>(null);
  const [verComparativo, setVerComparativo] = useState(false);

  const carregarComparativo = useCallback(async () => {
    if (!alvo) return;
    setComparativo(null);
    setVerComparativo(false);
    const { data, error } = await db.rpc("demonstracoes_contrapartes", {
      p_tipo: alvo.tipo,
      p_meses: janelaDeMeses(alvo.mes, MESES_DE_HISTORICO),
      p_rubrica: alvo.rubrica,
    });
    if (error) return;
    setComparativo(montarComparativo((data as LinhaContraparte[]) ?? [], alvo.mes, MESES_DE_HISTORICO));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.tipo, alvo?.rubrica, alvo?.mes]);

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
    setRecemDecididos(new Set());
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
  useEffect(() => { carregarComparativo(); }, [carregarComparativo]);

  /* Depois de trocar a categoria: a lista sai daqui (o lançamento foi para outra
     rubrica) e o alerta some sozinho — a detecção roda no gatilho do cache. Só
     a demonstração em si precisa de quem sabe recalcular: a página. */
  const aposTroca = useCallback(async () => {
    await carregar();
    await carregarAlertas();
    // O lançamento saiu desta rubrica: o fornecedor pode ter saído junto, e o
    // comparativo continuaria contando um gasto que já não está aqui.
    await carregarComparativo();
    await onCategoriaTrocada?.();
  }, [carregar, carregarAlertas, carregarComparativo, onCategoriaTrocada]);

  /* escopo 'lancamento' cala só este; 'fornecedor' aceita o par de rubricas
     para sempre — é o que resolve quem legitimamente cai nas duas linhas. */
  const decidir = async (a: Alerta, escopo: "lancamento" | "fornecedor") => {
    setDecidindo(a.id);
    const { error } = await supabase.rpc("reclassificacao_ignorar", { p_id: a.id, p_escopo: escopo });
    setDecidindo(null);
    if (error) { toast.error("Não consegui registrar: " + error.message); return; }
    setRecemDecididos((s) => new Set(s).add(a.cod_titulo));
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
    setRecemDecididos((s) => new Set(s).add(a.cod_titulo));
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

  /* ----- filtro e ordenação ---------------------------------------------
   * O filtro vale para a LISTA, nunca para os números do cabeçalho: eles são a
   * prova de que a lista está completa e é o que confere com a demonstração.
   * Filtrar a soma de cima faria o carimbo "a soma bate exatamente" comparar a
   * célula com um pedaço escolhido a dedo. O que sobra do filtro é contado na
   * própria barra, ao lado do filtro que o produziu.
   *
   * A busca varre também o lojista do cartão, que não é campo do lançamento e
   * sim texto lido da observação do título — sem isso, procurar "Datadog" não
   * acharia nada numa célula cheia de "Lancamento Fatura Cartao". */
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial);
  useEffect(() => { setFiltro(filtroInicial()); }, [alvo?.tipo, alvo?.rubrica, alvo?.mes]);

  const categorias = categoriasDaCelula(linhas);
  const visiveis = filtrarLancamentos(linhas, filtro, (l) => {
    const lida = lerObservacaoTitulo(l.cod_titulo ? textos.get(l.cod_titulo) : undefined);
    return lida ? `${lida.estabelecimento} ${lida.detalhe ?? ""}` : null;
  });

  /* ----- seleção para o lote --------------------------------------------
   * Guarda `cod_titulo`, e a seleção real é sempre derivada da lista: o que sai
   * da rubrica (porque acabou de ser reclassificado) sai da seleção sozinho, sem
   * ninguém precisar lembrar de limpar. */
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  useEffect(() => { setSelecionados(new Set()); }, [alvo?.tipo, alvo?.rubrica, alvo?.mes]);

  /* Previsão de OS/contrato e perna bancária não têm categoria própria: o
     servidor recusa, então a tela não oferece a caixinha. */
  const selecionavel = (l: Lancamento) => !!l.cod_titulo && podeTrocarCategoria(l.grupo);
  const alternar = (cod: string) => setSelecionados((s) => {
    const n = new Set(s);
    if (n.has(cod)) n.delete(cod); else n.add(cod);
    return n;
  });

  const selecao: Lancamento[] = linhas.filter((l) => !!l.cod_titulo && selecionados.has(l.cod_titulo));
  const itensLote: ItemLote[] = selecao.map((l) => ({
    codTitulo: l.cod_titulo as string,
    contraparte: l.contraparte,
    valor: l.valor,
    categoriaCodigo: l.categoria_codigo,
    categoriaDescricao: l.categoria_descricao,
  }));
  const somaSelecao = selecao.reduce((s, l) => s + (Number(l.valor) || 0), 0);

  /* A caixinha do cabeçalho marca o que está À VISTA — com um filtro aplicado,
     "todos" é o resultado da busca, que é o que a pessoa acabou de pedir. A
     seleção em si atravessa filtros: dá para buscar "anthropic", marcar, buscar
     "datadog", marcar mais, e trocar os dez de uma vez. */
  const marcaveisAgora = visiveis.filter(selecionavel);
  const marcadosAgora = marcaveisAgora.filter((l) => selecionados.has(l.cod_titulo as string)).length;
  const todosMarcados = marcaveisAgora.length > 0 && marcadosAgora === marcaveisAgora.length;
  const alternarTodos = () => setSelecionados((s) => {
    const n = new Set(s);
    for (const l of marcaveisAgora) {
      if (todosMarcados) n.delete(l.cod_titulo as string); else n.add(l.cod_titulo as string);
    }
    return n;
  });

  /* ----- suspeitos no topo ----------------------------------------------
   * A célula marcada é clicada POR CAUSA do alerta, e a lista pode ter dezenas
   * de linhas: deixar os suspeitos na ordem de data é obrigar a rolar atrás da
   * resposta. Eles sobem para um bloco próprio; dentro de cada bloco vale a
   * ordem escolhida na coluna VALOR — por padrão a que o RPC devolveu (data),
   * que é como se confere contra o ERP. */
  const ehSuspeito = (l: Lancamento) =>
    !!l.cod_titulo && (alertas.get(l.cod_titulo)?.status === "aberto" || recemDecididos.has(l.cod_titulo));
  const suspeitos = visiveis.filter(ehSuspeito);
  const demais = visiveis.filter((l) => !ehSuspeito(l));
  /* Cabeçalho só quando há os dois blocos: sem alerta nenhum a lista continua
     sendo uma lista só, sem faixa explicando o óbvio. */
  const ordenadas: { l: Lancamento; cabecalho: string | null }[] = [
    ...suspeitos.map((l, i) => ({
      l,
      cabecalho: i === 0
        ? `${suspeitos.length} ${suspeitos.length === 1 ? "lançamento fora do padrão do fornecedor" : "lançamentos fora do padrão do fornecedor"}`
        : null,
    })),
    ...demais.map((l, i) => ({
      l,
      cabecalho: i === 0 && suspeitos.length > 0 ? `demais lançamentos (${demais.length})` : null,
    })),
  ];

  /* Sem nenhum mês anterior na janela não há o que comparar: a rubrica começou
     agora ou o cache do Omie não vai tão para trás. Calar é mais honesto do que
     carimbar "novo" em todo mundo — por isso tudo que é comparativo pende deste
     `comp`, e não do estado cru. */
  const comp = comparativo?.temHistorico ? comparativo : null;

  const soma = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const somaVisivel = visiveis.reduce((s, l) => s + (Number(l.valor) || 0), 0);
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
                    {" "}Estão no topo da lista — pode ser classificação errada no Omie.
                  </span>
                </div>
              </div>
            )}

            {/* ---------------- quem é novo, quem mexeu ---------------- */}
            {!carregando && !erro && comp && comp.fornecedores.length > 0 && (
              <div className="shrink-0 border-b border-border bg-muted/40">
                <button
                  onClick={() => setVerComparativo((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-2 text-left transition hover:bg-muted/70"
                  title={`Cada fornecedor desta rubrica em ${mesCurto(comp.mes)} contra ${mesCurto(comp.mesAnterior)}`}
                >
                  <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                    <b className="text-foreground">{resumoComparativo(comp)}</b>
                    {" "}· comparado com {mesCurto(comp.mesAnterior)}
                  </span>
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", verComparativo && "rotate-180")}
                  />
                </button>
                {verComparativo && <TabelaComparativo comp={comp} />}
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

            {/* Com meia dúzia de linhas o olho resolve, e a barra só tomaria a
                altura que a lista quer. A partir daí, procurar é o trabalho. */}
            {!carregando && !erro && linhas.length >= 6 && (
              <BarraFiltros
                filtro={filtro}
                onFiltro={setFiltro}
                categorias={categorias}
                total={linhas.length}
                mostrados={visiveis.length}
                somaMostrada={somaVisivel}
                moeda={moeda}
              />
            )}

            {/* ---------------- seleção em lote ---------------- */}
            {!carregando && !erro && selecao.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-primary/30 bg-primary/[0.07] px-5 py-2">
                <span className="text-[11.5px] text-foreground">
                  <b>{selecao.length}</b> {selecao.length === 1 ? "selecionado" : "selecionados"}
                  {" "}· <span className="num">{moeda(somaSelecao)}</span>
                  <button
                    onClick={() => setSelecionados(new Set())}
                    className="ml-2 text-[11px] font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
                  >
                    limpar seleção
                  </button>
                </span>
                <TrocarCategoriaLote
                  itens={itensLote}
                  tipo={alvo.tipo}
                  mes={alvo.mes}
                  mesLabel={alvo.mesLabel}
                  travado={alvo.travado}
                  /* Recarrega tudo e recalcula a demonstração UMA vez, no fim do
                     lote — não a cada título. Quem deu certo sai da seleção na
                     mão: a maioria some da lista sozinha (mudou de rubrica), mas
                     quem trocou para outra categoria da MESMA rubrica continua
                     aqui, e continuar marcado o faria ser reenviado no próximo
                     "tentar de novo". */
                  onConcluido={async (r) => {
                    setSelecionados((s) => {
                      const n = new Set(s);
                      for (const x of r.resultados) if (x.ok) n.delete(x.item.codTitulo);
                      return n;
                    });
                    await aposTroca();
                  }}
                />
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
              ) : !visiveis.length ? (
                /* A lista tem linhas, o filtro é que não deixou nenhuma passar.
                   Dizer isso (e oferecer a volta) evita ler a tela vazia como
                   "esta célula não tem lançamento". */
                <div className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
                  Nenhum dos {linhas.length} lançamentos desta célula passa nos filtros.
                  <div className="mt-2">
                    <button
                      onClick={() => setFiltro(filtroInicial())}
                      className="rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium transition hover:bg-secondary"
                    >
                      Limpar filtros
                    </button>
                  </div>
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                    <tr className="border-b border-border text-[9.5px] font-semibold tracking-[0.06em] text-muted-foreground">
                      <th className="w-7 pl-4 pr-0 py-2 text-left">
                        {marcaveisAgora.length > 0 && (
                          <Caixinha
                            marcada={todosMarcados}
                            parcial={marcadosAgora > 0 && !todosMarcados}
                            onClick={alternarTodos}
                            titulo={todosMarcados
                              ? "Desmarcar os que estão à vista"
                              : `Marcar os ${marcaveisAgora.length} lançamentos à vista`}
                          />
                        )}
                      </th>
                      <th className="px-3 py-2 text-left">DATA</th>
                      <th className="px-2 py-2 text-left">CONTRAPARTE</th>
                      <th className="px-2 py-2 text-left">CATEGORIA NO OMIE</th>
                      <th className="px-3 py-2 text-right">
                        <CabecalhoValor ordem={filtro.ordem} onOrdem={(o) => setFiltro({ ...filtro, ordem: o })} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenadas.map(({ l, cabecalho }, i) => {
                      const a = l.cod_titulo ? alertas.get(l.cod_titulo) : undefined;
                      const aberto = a?.status === "aberto";
                      const suspeito = ehSuspeito(l);
                      const obs = l.cod_titulo ? textos.get(l.cod_titulo) : undefined;
                      const lida = lerObservacaoTitulo(obs);
                      /* Pelo código do título, não pelo nome: no cartão o nome
                         que está na tela vem da observação (que chega depois) e
                         o do comparativo vem do casamento com a fatura — casar
                         por texto deixaria justamente o Datadog sem chip. O
                         nome é só a rede de segurança de quem não tem código. */
                      const forn = !comp ? undefined
                        : (l.cod_titulo ? comp.porTitulo.get(l.cod_titulo) : undefined)
                          ?? (l.contraparte ? comp.porContraparte.get(l.contraparte) : undefined);
                      const marcado = !!l.cod_titulo && selecionados.has(l.cod_titulo);
                      return (
                      <Fragment key={i}>
                      {cabecalho && (
                        <tr className={cn("border-b", suspeito ? "border-amber-300 bg-amber-100" : "border-border bg-muted/60")}>
                          <td colSpan={5} className={cn(
                            "px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-[0.1em]",
                            suspeito ? "text-amber-900" : "text-muted-foreground",
                          )}>
                            <span className="inline-flex items-center gap-1.5">
                              {suspeito && <TriangleAlert strokeWidth={2.5} className="h-3 w-3 fill-amber-400 text-amber-800" />}
                              {cabecalho}
                            </span>
                          </td>
                        </tr>
                      )}
                      <tr className={cn(
                        "align-top hover:bg-muted/30",
                        aberto ? "border-b border-amber-300 bg-amber-100/60" : "border-b border-border/60",
                        marcado && "bg-primary/[0.06]",
                      )}>
                        {/* A caixinha some — não fica desabilitada — quando o
                            lançamento não tem categoria própria: caixinha morta
                            é convite a clicar e não entender por que nada
                            acontece. O porquê fica no hover do traço. */}
                        <td className="w-7 py-2 pl-4 pr-0">
                          {selecionavel(l) ? (
                            <Caixinha
                              marcada={marcado}
                              onClick={() => alternar(l.cod_titulo as string)}
                              titulo={marcado ? "Tirar da seleção" : "Selecionar para trocar a categoria em lote"}
                            />
                          ) : (
                            <span className="block text-center text-[11px] text-muted-foreground/40" title={motivoNaoAlteravel(l.grupo)}>–</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-[11.5px] num text-muted-foreground">
                          {dataCurta(l.data)}
                        </td>
                        {/* No cartão a contraparte é sempre o balde da fatura
                            ("Lancamento Fatura Cartao") e quem identifica o gasto
                            é a observação do título — então ela vem na frente, e
                            o balde desce para a linha de apoio. O texto cru fica
                            no hover, porque é ele que se confere contra o ERP. */}
                        <td className="px-2 py-2 text-[11.5px]">
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-foreground">
                            {aberto && <TriangleAlert strokeWidth={2.5} className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-800" />}
                            {lida ? (
                              <span className="inline-flex items-center gap-1" title={obs ?? undefined}>
                                <CreditCard className="h-3 w-3 shrink-0 text-muted-foreground" />
                                {lida.estabelecimento}
                              </span>
                            ) : (l.contraparte ?? doc(l.cnpj_cpf))}
                            {forn && comp && <ChipFornecedor f={forn} comp={comp} />}
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
                          <td colSpan={5} className="px-3 pb-2.5 pt-0">
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
