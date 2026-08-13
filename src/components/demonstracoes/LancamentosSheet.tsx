import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2, TriangleAlert, Check, FileText, Users, Undo2, ArrowRightLeft, CreditCard, ChevronDown,
  Paperclip, MessageSquareText, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CategoriaEditavel } from "@/components/demonstracoes/TrocarCategoria";
import { ehCartao, lerGastoDeCartao } from "@/lib/observacaoTitulo";
import { mesAtras, mesCurto } from "@/lib/demonstracoes-schema";
import {
  BuscaLancamentos, CabecalhoContraparte, CabecalhoValor, RodapeLista,
} from "@/components/demonstracoes/FiltroLancamentos";
import { TrocarCategoriaLote } from "@/components/demonstracoes/TrocarCategoriaLote";
import { podeTrocarCategoria, motivoNaoAlteravel, type ItemLote } from "@/lib/loteCategoria";
import {
  categoriasDaCelula, filtrarLancamentos, filtroInicial, filtroVazio, type Filtro,
} from "@/lib/filtroLancamentos";
import {
  agruparPorNome, linhasEconomizadas, periodoDoGrupo, type Grupo,
} from "@/lib/agruparLancamentos";
import {
  janelaDeMeses, montarComparativo, rotuloSituacao, explicarFornecedor,
  type Comparativo, type Fornecedor, type LinhaContraparte,
} from "@/lib/comparativoFornecedores";
import { ChipSituacao } from "@/components/demonstracoes/ChipSituacao";
import { ComposicaoCategorias, resumoDaComposicao } from "@/components/demonstracoes/ComposicaoCategorias";
import { montarComposicao, type LinhaCategoriaMes } from "@/lib/composicaoCategorias";
import { PonteVariacao } from "@/components/demonstracoes/PonteVariacao";
import { montarPonte } from "@/lib/ponteVariacao";
import { useApelidos } from "@/hooks/useApelidos";
import { apelidoDe, apelidosNoTexto } from "@/lib/apelidos";
import { BotaoNota, lerNotas, carimboNota, type NotaLancamento } from "@/components/demonstracoes/NotaLancamento";

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
  /* O mesmo par um mês atrás, como está NA GRADE. A ponte de variação compara
     Omie com Omie; isto entra só para acusar quando a grade discorda — em mês
     travado ela vem do tracker, e sem o aviso a diferença seria lida como erro
     da ponte. Opcional: quando o mês anterior não está no blob carregado, o
     painel simplesmente não tem com o que confrontar. */
  celulaAnterior?: number | null;
  travadoAnterior?: boolean;
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
  from: (tabela: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/* ----- o comprovante que explica a linha ---------------------------------
 * `comprovantes_drive` guarda a nota do Mercado Livre e a foto do grupo do
 * WhatsApp já casadas com o lançamento (ver `comprovantes-drive-sync`). É o que
 * transforma "MERCADO LIVRE R$ 45,60" em "pingadeira e tampa do purificador".
 * O vínculo é `cod_titulo`, que a linha da DRE já tem na mão. */
type Comprovante = {
  cod_titulo: string;
  descricao: string | null;
  emitente: string | null;
  casamento: string | null;
  confianca: string | null;
  drive_id: string;
  nome_arquivo: string;
};

const linkDoDrive = (driveId: string) => `https://drive.google.com/file/d/${driveId}/view`;

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

/* ----- o chip da linha RESUMO -------------------------------------------
 * Aberto ele fica sólido (fundo escuro, texto branco) e a seta vira para cima:
 * a mesma pílula diz o que traz e se está aberta, sem precisar de um segundo
 * elemento na linha para marcar a aba ativa. */
type ResumoAberto = "fornecedores" | "categorias" | null;

const CHAVE_RESUMO = "demonstracoes.painel.resumo";

function resumoInicial(): ResumoAberto {
  try {
    const v = localStorage.getItem(CHAVE_RESUMO);
    return v === "categorias" ? "categorias" : v === "nenhum" ? null : "fornecedores";
  } catch { return "fornecedores"; }
}
function guardarResumo(v: ResumoAberto) {
  try { localStorage.setItem(CHAVE_RESUMO, v ?? "nenhum"); } catch { /* modo privado */ }
}

/* ----- agrupar por fornecedor -------------------------------------------
 * Preferência de leitura, como o chip do resumo: quem confere fatura de cartão
 * quer sempre a mesma vista, e trocar de célula não pode desfazer a escolha.
 * Nasce LIGADA porque numa célula sem repetição agrupar não muda nada — um
 * grupo de um lançamento é renderizado como a linha de sempre. */
const CHAVE_AGRUPAR = "demonstracoes.painel.agrupar";

function agruparInicial(): boolean {
  try { return localStorage.getItem(CHAVE_AGRUPAR) !== "nao"; } catch { return true; }
}
function guardarAgrupar(v: boolean) {
  try { localStorage.setItem(CHAVE_AGRUPAR, v ? "sim" : "nao"); } catch { /* modo privado */ }
}

/** O que a lista desenha, em ordem: faixas, lançamentos soltos e grupos. */
type Bloco =
  | { tipo: "cabecalho"; chave: string; texto: string; suspeito: boolean }
  | { tipo: "linha"; chave: string; l: Lancamento }
  | { tipo: "grupo"; chave: string; g: Grupo<Lancamento> };

function ChipResumo({
  aberto, onClick, titulo, children,
}: {
  aberto: boolean;
  onClick: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-expanded={aberto}
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] transition",
        aberto
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground hover:bg-secondary",
      )}
    >
      {children}
      <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", aberto ? "rotate-180" : "opacity-60")} />
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
  /* A frase do hover é montada com o nome cru lá em `explicarFornecedor`. Em vez
     de fazer aquela função conhecer o cadastro, o nome é trocado DEPOIS, no
     texto pronto — mesma varredura por janelas de palavras que os comentários da
     IA usam, e que preserva o resto da frase intacto. */
  const apelidos = useApelidos();
  return (
    <ChipSituacao
      situacao={f.situacao}
      favoravel={f.favoravel}
      rotulo={rotuloSituacao(f)}
      titulo={apelidosNoTexto(apelidos, explicarFornecedor(f, comp, moeda))}
    />
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
  /* O de-para de apelidos (Configurações › Parametrização). Cache compartilhado
     em nível de módulo — dezenas de linhas na tela pedem o mesmo mapa. */
  const apelidos = useApelidos();
  const [linhas, setLinhas] = useState<Lancamento[]>([]);
  /* Os lançamentos da MESMA célula um mês atrás — a outra metade da ponte de
     variação. Vêm da mesma RPC, disparada junto com a do mês em foco, mas o
     painel não espera por eles: a lista (que é o que se veio conferir) aparece
     assim que a primeira consulta responde, e a ponte se monta atrás. */
  const [anteriores, setAnteriores] = useState<Lancamento[]>([]);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);
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
   * inteira, só sem os chips.
   *
   * Doze meses, e não dois: é o que separa "novo" de "fornecedor trimestral", e
   * é só isso que ele acrescenta à ponte de variação — que enxerga dois meses e,
   * sozinha, só sabe dizer "entrou". */
  const [comparativo, setComparativo] = useState<Comparativo | null>(null);

  const carregarComparativo = useCallback(async () => {
    if (!alvo) return;
    setComparativo(null);
    const { data, error } = await db.rpc("demonstracoes_contrapartes", {
      p_tipo: alvo.tipo,
      p_meses: janelaDeMeses(alvo.mes, MESES_DE_HISTORICO),
      p_rubrica: alvo.rubrica,
    });
    if (error) return;
    setComparativo(montarComparativo((data as LinhaContraparte[]) ?? [], alvo.mes, MESES_DE_HISTORICO));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.tipo, alvo?.rubrica, alvo?.mes]);

  /* ----- de que a linha é feita ----------------------------------------
   * As categorias do mês em foco saem dos próprios lançamentos listados — não
   * desta consulta. Ela traz só os meses ANTERIORES, para dizer o que é novo e
   * o que sumiu da composição. Por isso, como o comparativo, carrega em
   * paralelo e falha calada: sem ela a composição continua na tela, apenas sem
   * as colunas de comparação. */
  const [histCategorias, setHistCategorias] = useState<LinhaCategoriaMes[]>([]);

  /* Não limpa nada antes de buscar: quem zera o histórico é a troca de CÉLULA
     (lá embaixo, junto com o filtro). Assim trocar a categoria
     de um lançamento atualiza a composição sem fechá-la na cara de quem estava
     lendo — e é justamente ali que se quer conferir o efeito da troca. */
  const carregarCategorias = useCallback(async () => {
    if (!alvo) return;
    const { data, error } = await db.rpc("demonstracoes_categorias", {
      p_tipo: alvo.tipo,
      p_meses: janelaDeMeses(alvo.mes, MESES_DE_HISTORICO),
      p_rubrica: alvo.rubrica,
    });
    if (error) return;
    setHistCategorias((data as LinhaCategoriaMes[]) ?? []);
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
   * guardada em `omie_titulo_texto`: lida uma vez, vale sempre.
   *
   * O CAMINHO NORMAL É O CACHE. Uma varredura diária (cron) traz a observação
   * de TODAS as contas a pagar de uma vez — `ListarContasPagar` com
   * `exibir_obs`, ~70 s para a empresa inteira —, então o painel abre com o
   * texto já em casa. O que sobra aqui é o buraco entre a varredura e um título
   * recém-criado: poucos, e buscados sem que ninguém precise clicar. Ver a edge
   * function `omie-titulo-texto`. */
  const [textos, setTextos] = useState<Map<string, string | null>>(new Map());
  /* Os comprovantes do Drive já casados com estes títulos. Carrega junto com a
     lista, numa consulta só — a tabela é pequena e o índice é por cod_titulo. */
  const [comprovantes, setComprovantes] = useState<Map<string, Comprovante>>(new Map());
  /* A justificativa escrita à mão para cada lançamento. O comprovante diz o que
     foi comprado; esta diz por que — e só a pessoa sabe. Carrega junto com a
     lista, pela mesma chave (`cod_titulo`). */
  const [notas, setNotas] = useState<Map<string, NotaLancamento>>(new Map());
  const [buscandoObs, setBuscandoObs] = useState(false);
  /** Quanto já entrou, para a espera ter tamanho em vez de ser um giro sem fim. */
  const [obsProgresso, setObsProgresso] = useState<{ feitos: number; total: number } | null>(null);
  /* Cada abertura de célula tem um número. Uma busca só escreve na tela se o
     número dela ainda for o da célula aberta — sem isso, a busca da célula
     anterior (que pode levar minutos) despejaria observações de outra rubrica em
     cima da lista que a pessoa está lendo agora. */
  const geracao = useRef(0);

  const lerTextos = useCallback(async (cods: string[]): Promise<Map<string, string | null>> => {
    const m = new Map<string, string | null>();
    if (!cods.length) return m;
    /* Em blocos: a consulta vai por URL (`in`), e uma célula de fatura de cartão
       tem centenas de títulos — a lista inteira de uma vez estoura o limite da
       URL e a chamada volta vazia, que é indistinguível de "não tem texto". */
    const BLOCO = 150;
    const blocos: string[][] = [];
    for (let i = 0; i < cods.length; i += BLOCO) blocos.push(cods.slice(i, i + BLOCO));
    const respostas = await Promise.all(blocos.map((bloco) =>
      supabase
        .from("omie_titulo_texto" as never)
        .select("cod_titulo,observacao")
        .in("cod_titulo", bloco.map(Number))));
    for (const { data } of respostas) {
      for (const r of (data as unknown as { cod_titulo: number; observacao: string | null }[]) ?? []) {
        m.set(String(r.cod_titulo), r.observacao);
      }
    }
    return m;
  }, []);

  /** Quantas rodadas a busca insiste sozinha. Cada uma tem orçamento próprio na
   *  função; o teto existe só para um erro que se repete não virar laço eterno. */
  const RODADAS_OBS = 8;

  /**
   * Busca no Omie o texto que ainda não temos — e vai até o fim.
   *
   * A função tem orçamento de tempo por execução e devolve quantos títulos do
   * pedido ainda estão sem texto; antes, o que não coubesse numa execução ficava
   * esperando um clique no botão — era assim que a lista terminava pela metade.
   * Agora cada rodada relê o cache (as linhas se preenchem à vista) e a seguinte
   * pede só o que faltou, parando quando não sobra nada ou quando uma rodada não
   * anda — insistir aí seria repetir o mesmo erro.
   */
  const buscarObs = useCallback(async (cods: string[]) => {
    if (!cods.length) return;
    const minha = geracao.current;
    setBuscandoObs(true);
    setObsProgresso({ feitos: 0, total: cods.length });
    try {
      let faltam = cods;
      for (let rodada = 0; rodada < RODADAS_OBS && faltam.length; rodada++) {
        const { data, error } = await supabase.functions.invoke("omie-titulo-texto", {
          body: {
            cod_titulos: faltam,
            max: 400,
            orcamento_ms: 40_000,
            /* A varredura (a busca em lote, que a função decide sozinha quando
               falta muita coisa) só faz sentido uma vez: ela sempre recomeça do
               título mais novo, e repeti-la a cada rodada seria reler o mesmo
               pedaço. Da segunda em diante, título a título. */
            sem_varredura: rodada > 0,
          },
        });
        if (geracao.current !== minha) return;   // outra célula abriu no meio
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);

        const novos = await lerTextos(cods);
        if (geracao.current !== minha) return;
        setTextos((antes) => new Map([...antes, ...novos]));

        const antes = faltam.length;
        faltam = cods.filter((c) => !novos.has(c));
        setObsProgresso({ feitos: cods.length - faltam.length, total: cods.length });
        if (faltam.length >= antes) break;      // rodada sem avanço: desiste
      }
    } catch (e) {
      // Acessório: sem a observação a lista continua de pé, só sem o nome do
      // lojista. Não vale derrubar a auditoria por isso.
      if (geracao.current === minha) {
        toast.error("Não consegui buscar as observações no Omie: " + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      if (geracao.current === minha) { setBuscandoObs(false); setObsProgresso(null); }
    }
  }, [lerTextos]);

  const carregar = useCallback(async () => {
    if (!alvo) return;
    const minha = ++geracao.current;
    setCarregando(true);
    setErro(null);
    setRecemDecididos(new Set());
    /* A busca da célula anterior acabou de perder a vez (é o que o número novo
       faz). Ela sai sem mexer na tela — inclusive sem apagar o próprio "buscando",
       que ficaria girando para sempre. Quem apaga é aqui. */
    setBuscandoObs(false);
    setObsProgresso(null);

    const mesAnterior = mesAtras(alvo.mes);
    setAnteriores([]);
    setCarregandoAnteriores(!!mesAnterior);

    /* As duas consultas saem JUNTAS e só depois são esperadas em ordem: a do mês
       anterior custa o mesmo que a do mês em foco, e enfileirá-las dobraria a
       espera da lista para servir a faixa que fica acima dela. */
    const pedido = (mes: string) => supabase.rpc("demonstracoes_lancamentos", {
      p_tipo: alvo.tipo, p_rubrica: alvo.rubrica, p_mes: mes,
    });
    const pAtual = pedido(alvo.mes);
    const pAnterior = mesAnterior ? pedido(mesAnterior) : null;

    const { data, error } = await pAtual;
    if (geracao.current !== minha) return;
    if (error) {
      setErro(error.message); setLinhas([]); setTextos(new Map());
      setCarregando(false); setCarregandoAnteriores(false);
      return;
    }

    const rows = (data as Lancamento[]) ?? [];
    /* A lista aparece assim que o Postgres responde. O texto do cartão vem
       logo atrás e preenche as linhas onde estiverem: fazer a tabela esperar
       pelo cache das observações era segurar a auditoria inteira por um nome. */
    setLinhas(rows);
    setCarregando(false);

    const cods = rows.map((l) => l.cod_titulo).filter(Boolean) as string[];
    const cache = await lerTextos(cods);
    if (geracao.current !== minha) return;
    setTextos(cache);

    /* O mês anterior entra depois, sem segurar nada. Falha calada: sem ele a
       ponte não aparece e o resto do painel continua inteiro. */
    let rowsAnteriores: Lancamento[] = [];
    if (pAnterior) {
      const r = await pAnterior;
      if (geracao.current !== minha) return;
      rowsAnteriores = (r.data as Lancamento[]) ?? [];
      setAnteriores(rowsAnteriores);
      setCarregandoAnteriores(false);

      const codsAnteriores = rowsAnteriores.map((l) => l.cod_titulo).filter(Boolean) as string[];
      const cacheAnterior = await lerTextos(codsAnteriores);
      if (geracao.current !== minha) return;
      for (const [k, v] of cacheAnterior) cache.set(k, v);
      setTextos(new Map(cache));
    }

    // Só o cartão puxa texto sozinho: é onde a contraparte não diz nada. Nas
    // demais linhas o nome do fornecedor já está na tela e a chamada não se
    // pagaria. Sem await: a lista já está de pé e as observações entram
    // depois, quando o Omie responder.
    //
    // Os DOIS meses: sem o lojista, todo gasto de cartão do mês anterior cai no
    // balde da fatura e a ponte inventaria uma entrada por lojista deste mês e
    // uma saída gigante do balde — a variação mais errada que ela poderia dar.
    const faltam = [...rows, ...rowsAnteriores]
      .filter((l) => l.cod_titulo && ehCartao(l.contraparte) && !cache.has(l.cod_titulo))
      .map((l) => l.cod_titulo as string);
    if (faltam.length) void buscarObs(faltam);
    // Depende dos três campos da consulta, não do objeto: `celula` e `travado`
    // mudam de identidade a cada clique e disparariam uma busca idêntica.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.tipo, alvo?.rubrica, alvo?.mes, lerTextos, buscarObs]);

  useEffect(() => { carregar(); }, [carregar]);

  /* Os comprovantes desta célula. Roda depois da lista porque depende dos
     `cod_titulo` dela, e falha calada: sem comprovante a linha continua inteira,
     só sem a frase do que foi comprado. */
  useEffect(() => {
    const cods = [...new Set(linhas.map((l) => l.cod_titulo).filter(Boolean))] as string[];
    if (!cods.length) { setComprovantes(new Map()); return; }

    let vivo = true;
    db.from("comprovantes_drive")
      .select("cod_titulo,descricao,emitente,casamento,confianca,drive_id,nome_arquivo")
      .in("cod_titulo", cods)
      .then(({ data }: { data: Comprovante[] | null }) => {
        if (!vivo) return;
        setComprovantes(new Map((data ?? []).map((c) => [c.cod_titulo, c])));
      });
    return () => { vivo = false; };
  }, [linhas]);

  /* As justificativas destas linhas. Também falha calada: sem elas a lista fica
     inteira, só sem as frases — e o botão continua abrindo para escrever. */
  useEffect(() => {
    const cods = [...new Set(linhas.map((l) => l.cod_titulo).filter(Boolean))] as string[];
    if (!cods.length) { setNotas(new Map()); return; }

    let vivo = true;
    lerNotas(cods).then((m) => { if (vivo) setNotas(m); });
    return () => { vivo = false; };
  }, [linhas]);

  useEffect(() => { carregarAlertas(); }, [carregarAlertas]);
  useEffect(() => { carregarComparativo(); }, [carregarComparativo]);
  useEffect(() => { carregarCategorias(); }, [carregarCategorias]);

  /* Depois de trocar a categoria: a lista sai daqui (o lançamento foi para outra
     rubrica) e o alerta some sozinho — a detecção roda no gatilho do cache. Só
     a demonstração em si precisa de quem sabe recalcular: a página. */
  const aposTroca = useCallback(async () => {
    await carregar();
    await carregarAlertas();
    // O lançamento saiu desta rubrica: o fornecedor pode ter saído junto, e o
    // comparativo continuaria contando um gasto que já não está aqui. A
    // composição por categoria muda pelo mesmo motivo — e é justamente o que
    // uma troca de categoria mexe.
    await carregarComparativo();
    await carregarCategorias();
    await onCategoriaTrocada?.();
  }, [carregar, carregarAlertas, carregarComparativo, carregarCategorias, onCategoriaTrocada]);

  /* escopo 'lancamento' cala só este lançamento; 'fornecedor' aceita o par de
     rubricas para sempre — é o que resolve quem legitimamente cai nas duas
     linhas. Nos dois casos a decisão vale na DRE e na DFC: o mesmo título rende
     um alerta em cada demonstrativo, e a categoria que se discute é uma só
     (migration 20260811173000). O contador devolvido diz em quantos deu, e é
     ele que escolhe o texto — dizer "e na DFC" quando não havia gêmea seria
     prometer um efeito que não houve. */
  const decidir = async (a: Alerta, escopo: "lancamento" | "fornecedor") => {
    setDecidindo(a.id);
    const { data, error } = await supabase.rpc("reclassificacao_ignorar", { p_id: a.id, p_escopo: escopo });
    setDecidindo(null);
    if (error) { toast.error("Não consegui registrar: " + error.message); return; }
    setRecemDecididos((s) => new Set(s).add(a.cod_titulo));
    toast.success(escopo === "fornecedor"
      ? `As duas rubricas passam a ser normais para ${a.fornecedor ?? "este fornecedor"}.`
      : Number(data) > 1
        ? "Lançamento marcado como correto — na DRE e na DFC."
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
     literalmente "ainda não perguntei" — e é isso que o botão resolve.
     Conta os dois meses: o do mês anterior não aparece na lista, mas é ele que
     faz a ponte separar o lojista em vez de empilhar tudo no balde da fatura. */
  const cartoesSemObs = [...linhas, ...anteriores]
    .filter((l) => l.cod_titulo && ehCartao(l.contraparte) && !textos.has(l.cod_titulo))
    .map((l) => l.cod_titulo as string);

  /* ----- o nome do fornecedor, uma regra só -----------------------------
   * No cartão a contraparte do título é o balde da fatura e quem identifica o
   * gasto é a observação — a MESMA leitura que a lista faz para escrever a
   * linha. Quem cuida de só ler observação de cartão é `lerGastoDeCartao`; ver
   * lá por que a trava não pode ficar aqui. */
  const nomeDoFornecedor = useCallback((l: Lancamento): string => {
    let cru = l.contraparte?.trim() || "";
    const lida = lerGastoDeCartao(l.contraparte, l.cod_titulo ? textos.get(l.cod_titulo) : undefined);
    if (lida) cru = lida.estabelecimento;
    /* O apelido entra aqui, e não só na linha da lista, porque este é o nome que
       a ponte de variação e o comparativo usam para AGRUPAR. Duas grafias do
       mesmo fornecedor apontando para o mesmo apelido passam a ser uma linha só
       — que é justamente o que se quer de quem chega picado. */
    const ap = apelidoDe(apelidos, cru, l.cnpj_cpf);
    if (ap) return ap.apelido;
    return cru || (l.cnpj_cpf ? doc(l.cnpj_cpf) : "") || "Sem contraparte";
  }, [textos, apelidos]);

  /** O nome SEM apelido — o que se procura no Omie, e o que a linha de apoio
   *  mostra quando o apelido assume a de cima. */
  const nomeCru = useCallback((l: Lancamento): string => {
    const lida = lerGastoDeCartao(l.contraparte, l.cod_titulo ? textos.get(l.cod_titulo) : undefined);
    return lida ? lida.estabelecimento : (l.contraparte ?? doc(l.cnpj_cpf));
  }, [textos]);

  /* ----- por que a linha mudou ------------------------------------------
   * A decomposição da variação contra o mês anterior, fornecedor a fornecedor.
   * Refaz quando as observações chegam: até elas entrarem, os gastos de cartão
   * dos dois meses estão todos sob o balde da fatura. */
  const ponte = useMemo(() => {
    const mesAnterior = alvo ? mesAtras(alvo.mes) : null;
    if (!alvo || !mesAnterior) return null;
    return montarPonte(linhas, anteriores, { mes: alvo.mes, mesAnterior, nomeDe: nomeDoFornecedor });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.mes, linhas, anteriores, nomeDoFornecedor]);

  /* Sem nenhum lançamento no mês anterior E sem histórico na janela de doze
     meses, não dá para afirmar que tudo é novidade: pode ser só o cache do Omie
     que não vai tão para trás. Calar é mais honesto do que carimbar a rubrica
     inteira de "entrou". */
  const temComparacao = anteriores.length > 0 || comparativo?.temHistorico === true;
  const temPonte = !!ponte && temComparacao;

  /* ----- qual detalhe do RESUMO está aberto -----------------------------
   * UM SÓ POR VEZ, e é essa a regra que devolve a lista: com os dois abertos ao
   * mesmo tempo não sobrava altura para lançamento nenhum. Clicar no chip aberto
   * fecha; a escolha vale para as próximas células, porque quem confere fatura
   * de cartão quer sempre a mesma leitura. */
  const [resumo, setResumo] = useState<ResumoAberto>(resumoInicial);
  const abrirResumo = (qual: Exclude<ResumoAberto, null>) => {
    const novo = resumo === qual ? null : qual;
    setResumo(novo);
    guardarResumo(novo);
  };

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
  /* Célula nova, tela nova: o filtro volta ao zero e o histórico da célula
     anterior sai da frente — senão, no intervalo até a RPC responder, as
     categorias do mês novo seriam comparadas com as do corte velho e sairiam
     carimbadas de "nova". O chip aberto NÃO se mexe: é preferência de leitura,
     não estado da célula. */
  useEffect(() => {
    setFiltro(filtroInicial());
    setHistCategorias([]);
  }, [alvo?.tipo, alvo?.rubrica, alvo?.mes]);

  const categorias = categoriasDaCelula(linhas);
  /* A composição sai da MESMA lista que está na tela — o histórico só entra
     para os meses anteriores. É o que garante que a coluna do mês feche com a
     soma do cabeçalho, e o que faz a tabela existir mesmo se a RPC falhar. */
  const composicao = alvo ? montarComposicao(categorias, histCategorias, alvo.mes, MESES_DE_HISTORICO) : null;
  /* Uma categoria sozinha não é composição: a linha É ela, e o chip só ofereceria
     um clique para ler o que já está no cabeçalho. */
  const temComposicao = !!composicao && composicao.categorias.length > 1;
  /* O apelido entra no texto que a busca varre junto com o nome cru: quem
     procura "café" precisa achar o Grupo Souza, e quem procura "JIM" também —
     trocar só a exibição faria a linha sumir do filtro pelo nome que está
     escrito na tela. */
  const visiveis = filtrarLancamentos(linhas, filtro, (l) => {
    const lida = lerGastoDeCartao(l.contraparte, l.cod_titulo ? textos.get(l.cod_titulo) : undefined);
    const cru = lida ? lida.estabelecimento : l.contraparte;
    const ap = apelidoDe(apelidos, cru, l.cnpj_cpf);
    return [
      lida ? `${lida.estabelecimento} ${lida.detalhe ?? ""}` : null,
      ap?.apelido, ap?.oQueE,
      /* A justificativa entra na varredura da busca: ela está escrita NA linha,
         e procurar por uma palavra que se vê na tela tem de achá-la. */
      l.cod_titulo ? notas.get(l.cod_titulo)?.texto : null,
    ].filter(Boolean).join(" ") || null;
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

  /* ----- uma linha por fornecedor ---------------------------------------
   * Quatro parcelas da LATAM, dezoito corridas de Uber e seis diárias de
   * Airbnb são três coisas, não vinte e oito: a lista junta o que tem o mesmo
   * nome NA TELA (já com apelido, e no cartão já com o lojista lido da
   * observação), mostra a soma, e abre embaixo quando se quer ver a parcela.
   *
   * OS SUSPEITOS FICAM DE FORA. Cada alerta de reclassificação tem decisão
   * própria e explicação em linha separada; enfiá-los dentro de um grupo
   * fechado esconderia justamente o que fez a célula ser clicada.
   *
   * E agrupar não mexe em número nenhum: os grupos são um recorte da MESMA
   * lista filtrada, então cabeçalho, rodapé e carimbo continuam contando
   * lançamentos. */
  const [agrupar, setAgrupar] = useState(agruparInicial);
  /* Quais grupos estão abertos, pela chave (o nome normalizado) — por índice,
     reordenar a lista abriria outro grupo. Zera na troca de célula. */
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  useEffect(() => { setAbertos(new Set()); }, [alvo?.tipo, alvo?.rubrica, alvo?.mes]);

  const grupos = agruparPorNome(demais, {
    nomeDe: nomeDoFornecedor,
    valorDe: (l) => Number(l.valor) || 0,
    ordem: filtro.ordem,
  });
  const economia = linhasEconomizadas(grupos);
  /* Sem repetição, agrupar não muda nada — e uma casca a abrir em volta de um
     lançamento só seria um clique a mais para ler o que já estava na tela. */
  const agrupado = agrupar && economia > 0;

  const alternarGrupo = (chave: string) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(chave)) n.delete(chave); else n.add(chave);
    return n;
  });

  /** Marcar o grupo é marcar o que dele é marcável — o resto nem tem caixinha. */
  const alternarSelecaoGrupo = (g: Grupo<Lancamento>) => setSelecionados((s) => {
    const n = new Set(s);
    const cods = g.itens.filter(selecionavel).map((l) => l.cod_titulo as string);
    const todos = cods.length > 0 && cods.every((c) => n.has(c));
    for (const c of cods) { if (todos) n.delete(c); else n.add(c); }
    return n;
  });

  /* Cabeçalho só quando há os dois blocos: sem alerta nenhum a lista continua
     sendo uma lista só, sem faixa explicando o óbvio. */
  const chaveLinha = (l: Lancamento, i: number) => `l-${l.cod_titulo ?? "s"}-${i}`;
  const blocos: Bloco[] = [];
  if (suspeitos.length) {
    blocos.push({
      tipo: "cabecalho", chave: "cab-suspeitos", suspeito: true,
      texto: `${suspeitos.length} ${suspeitos.length === 1 ? "lançamento fora do padrão do fornecedor" : "lançamentos fora do padrão do fornecedor"}`,
    });
    suspeitos.forEach((l, i) => blocos.push({ tipo: "linha", chave: chaveLinha(l, i), l }));
    if (demais.length) {
      blocos.push({
        tipo: "cabecalho", chave: "cab-demais", suspeito: false,
        texto: `demais lançamentos (${demais.length})`,
      });
    }
  }
  if (agrupado) {
    for (const g of grupos) blocos.push({ tipo: "grupo", chave: `g-${g.chave}`, g });
  } else {
    demais.forEach((l, i) => blocos.push({ tipo: "linha", chave: chaveLinha(l, suspeitos.length + i), l }));
  }

  /* Sem nenhum mês anterior na janela não há o que comparar: a rubrica começou
     agora ou o cache do Omie não vai tão para trás. Calar é mais honesto do que
     carimbar "novo" em todo mundo — por isso tudo que é comparativo pende deste
     `comp`, e não do estado cru. */
  const comp = comparativo?.temHistorico ? comparativo : null;

  const soma = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const somaVisivel = visiveis.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const bate = alvo?.celula != null && Math.abs(soma - alvo.celula) < 0.5;
  const dataUsada = alvo?.tipo === "dre" ? "data de registro (competência)" : "data de pagamento (caixa)";

  /* ----- a linha de um lançamento ---------------------------------------
   * Função, e não componente: um componente declarado aqui dentro seria um
   * TIPO novo a cada render e o React remontaria a lista inteira — com o
   * seletor de categoria fechando na cara de quem o abriu. Como função, isto
   * devolve elementos, e a reconciliação segue pela `key`.
   *
   * `dentro` é a mesma linha, só que aberta debaixo de um grupo: o nome ali em
   * cima já foi dito, então ele recua para a cor de apoio e o chip do
   * fornecedor (que fala do fornecedor, não da parcela) fica só no grupo. */
  const renderLinha = (l: Lancamento, chave: string, dentro: boolean) => {
    if (!alvo) return null;
    const a = l.cod_titulo ? alertas.get(l.cod_titulo) : undefined;
    const aberto = a?.status === "aberto";
    const obs = l.cod_titulo ? textos.get(l.cod_titulo) : undefined;
    const lida = lerGastoDeCartao(l.contraparte, obs);
    /* O nome cru que identifica o gasto: o lojista, quando é cartão; a
       contraparte do Omie, no resto. É por ele que se procura o apelido — e é
       ele que sobra na linha de apoio quando o apelido assume a de cima. */
    const cru = lida ? lida.estabelecimento : (l.contraparte ?? doc(l.cnpj_cpf));
    const ap = apelidoDe(apelidos, cru, l.cnpj_cpf);
    /* A nota do Mercado Livre ou a foto do grupo do WhatsApp, quando o sync
       achou par para esta linha. */
    const cpv = l.cod_titulo ? comprovantes.get(l.cod_titulo) : undefined;
    /* A justificativa escrita à mão para esta linha. */
    const nota = l.cod_titulo ? notas.get(l.cod_titulo) : undefined;
    /* Pelo código do título, não pelo nome: no cartão o nome que está na tela
       vem da observação (que chega depois) e o do comparativo vem do casamento
       com a fatura — casar por texto deixaria justamente o Datadog sem chip. O
       nome é só a rede de segurança de quem não tem código. */
    const forn = dentro || !comp ? undefined
      : (l.cod_titulo ? comp.porTitulo.get(l.cod_titulo) : undefined)
        ?? (l.contraparte ? comp.porContraparte.get(l.contraparte) : undefined);
    const marcado = !!l.cod_titulo && selecionados.has(l.cod_titulo);

    return (
      <Fragment key={chave}>
        {/* `group/linha`: é o hover DESTA linha que acende o botão de escrever
            a justificativa. Nomeado porque a linha inteira já é área de hover
            de outras coisas. */}
        <tr className={cn(
          "group/linha align-top hover:bg-muted/30",
          aberto ? "border-b border-amber-300 bg-amber-100/60" : "border-b border-border/60",
          dentro && !aberto && "bg-muted/[0.15]",
          marcado && "bg-primary/[0.06]",
        )}>
          {/* A caixinha some — não fica desabilitada — quando o lançamento não
              tem categoria própria: caixinha morta é convite a clicar e não
              entender por que nada acontece. O porquê fica no hover do traço. */}
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
          <td className="whitespace-nowrap px-2 py-2 text-[11.5px] num text-muted-foreground">
            {dataCurta(l.data)}
          </td>
          {/* No cartão a contraparte é sempre o balde da fatura ("Lancamento
              Fatura Cartao") e quem identifica o gasto é a observação do título
              — então ela vem na frente, e o balde desce para a linha de apoio.
              O texto cru fica no hover, porque é ele que se confere contra o
              ERP.

              Havendo apelido cadastrado (Configurações › Parametrização), é ELE
              que ocupa a linha de cima e o nome do extrato desce junto com o
              balde: o de cima responde "o que é isso?" e o de baixo continua
              sendo a string que se procura no Omie. */}
          {/* Numa coluna de largura fixa a linha de apoio não pode mais quebrar
              em três: vira uma frase só, cortada por reticências, com o inteiro
              no hover. Sem isso uma observação de cartão comprida decidia
              sozinha a altura de todas as linhas da lista. */}
          <td className={cn("overflow-hidden px-2 py-2 text-[11.5px]", dentro && "pl-5")}>
            <div className={cn(
              "flex items-center gap-1.5 whitespace-nowrap",
              dentro ? "text-muted-foreground" : "text-foreground",
            )}>
              {aberto && <TriangleAlert strokeWidth={2.5} className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-800" />}
              {lida && <CreditCard className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <span className="truncate" title={ap?.oQueE ?? obs ?? undefined}>
                {ap ? ap.apelido : cru}
              </span>
              {forn && comp && <ChipFornecedor f={forn} comp={comp} />}
              {/* O clipe abre o comprovante no Drive. Fica na linha de cima,
                  junto do nome, porque é a resposta a "o que foi isso?" — não
                  um detalhe de apoio. */}
              {cpv && (
                <a
                  href={linkDoDrive(cpv.drive_id)}
                  target="_blank" rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-muted-foreground transition hover:text-foreground"
                  title={[
                    cpv.descricao,
                    cpv.emitente ? `vendedor: ${cpv.emitente}` : null,
                    `casou por ${cpv.casamento === "soma_pedido" ? "soma do pedido"
                      : cpv.casamento === "parcela" ? "valor da parcela" : "valor e data"}`,
                    cpv.nome_arquivo,
                  ].filter(Boolean).join(" · ")}
                >
                  <Paperclip className="h-3 w-3" />
                </a>
              )}
              {/* Escrever o porquê desta linha. Fica junto do clipe: um responde
                  "o que foi isso?", o outro "por que isso aconteceu?". Sem
                  `cod_titulo` não há onde pendurar a nota (previsão de OS, perna
                  bancária) — e aí o botão não aparece. */}
              {l.cod_titulo && (
                <BotaoNota
                  codTitulo={l.cod_titulo}
                  nota={nota}
                  contexto={{
                    tipo: alvo.tipo,
                    rubrica: alvo.rubrica,
                    mes: alvo.mes,
                    contraparte: l.contraparte,
                    titulo: `${dataCurta(l.data)} · ${ap ? ap.apelido : cru} · ${moeda(Number(l.valor) || 0)}`,
                  }}
                  onSalvo={(n) => setNotas((m) => {
                    const novo = new Map(m);
                    if (n) novo.set(n.cod_titulo, n); else novo.delete(l.cod_titulo as string);
                    return novo;
                  })}
                />
              )}
            </div>
            {(() => {
              const apoio = [
                // O que o comprovante diz vem PRIMEIRO: numa linha que corta por
                // reticências, é o que não pode sumir.
                cpv?.descricao ?? null,
                ap ? cru : null,
                lida ? (l.contraparte ?? doc(l.cnpj_cpf)) : null,
                lida?.detalhe,
                lida?.parcela ? `parcela ${lida.parcela}` : null,
                l.titulo,
                l.documento ? `NF ${l.documento}` : null,
                l.status?.toUpperCase(),
              ].filter(Boolean) as string[];
              if (!apoio.length) return null;
              return (
                <div
                  className="mt-px flex items-center gap-1 truncate text-[10px] text-muted-foreground"
                  title={obs ?? apoio.join(" · ")}
                >
                  {l.titulo && <FileText className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{apoio.join(" · ")}</span>
                </div>
              );
            })()}
            {/* A justificativa aparece na própria linha — escrever e não ver de
                novo seria escrever para ninguém. Uma linha só, cortada por
                reticências (o texto inteiro está no hover e na caixa): o teto de
                altura da lista é o que devolveu os lançamentos à tela. */}
            {nota && (
              <div
                className="mt-px flex items-center gap-1 truncate text-[10px] text-violet-700"
                title={`${nota.texto}${carimboNota(nota) ? `\n\n— ${carimboNota(nota)}` : ""}`}
              >
                <MessageSquareText className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{nota.texto}</span>
              </div>
            )}
          </td>
          {/* O código é o que se corrige no Omie; a descrição é o que o DE-PARA
              casa. Auditar categorização precisa dos dois. Clicar troca a
              categoria — no Omie e aqui. */}
          <td className="overflow-hidden px-2 py-2 text-[11px]">
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

        {/* A explicação vai numa linha própria: o motivo e as duas decisões não
            cabem nas colunas sem espremer o valor. */}
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
                      {/* Abre o seletor da linha de cima, já com as categorias da
                          rubrica de origem no topo. */}
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
  };

  /* ----- a linha de um grupo --------------------------------------------
   * O que o grupo diz sem ser aberto: quem é, quantas cobranças, de quando a
   * quando, em que categoria e quanto somou. É a linha que substitui as vinte
   * e oito — e por isso ela precisa carregar o que se perderia ao juntá-las:
   * o chip do fornecedor, a existência de comprovante e de justificativa, e o
   * aviso de que ali dentro há mais de uma categoria. */
  const renderGrupo = (g: Grupo<Lancamento>, chave: string) => {
    if (!alvo) return null;
    const abertoG = abertos.has(g.chave);
    const cats = categoriasDaCelula(g.itens);
    const { de, ate } = periodoDoGrupo(g.itens);
    const marcaveis = g.itens.filter(selecionavel);
    const marcados = marcaveis.filter((l) => selecionados.has(l.cod_titulo as string)).length;
    const todos = marcaveis.length > 0 && marcados === marcaveis.length;
    const cartao = g.itens.every((l) => ehCartao(l.contraparte));
    const comNota = g.itens.filter((l) => l.cod_titulo && notas.has(l.cod_titulo)).length;
    const comCpv = g.itens.filter((l) => l.cod_titulo && comprovantes.has(l.cod_titulo)).length;
    /* O chip é do FORNECEDOR, então basta o primeiro item que o comparativo
       souber casar — os outros devolveriam o mesmo veredito. */
    let forn: Fornecedor | undefined;
    if (comp) {
      for (const l of g.itens) {
        forn = (l.cod_titulo ? comp.porTitulo.get(l.cod_titulo) : undefined)
          ?? (l.contraparte ? comp.porContraparte.get(l.contraparte) : undefined);
        if (forn) break;
      }
    }
    /* As grafias cruas que caíram neste grupo — é uma delas que se procura no
       Omie. Quando é uma só e o apelido tomou a linha de cima, ela desce para a
       de apoio, como na linha solta. */
    const crus = [...new Set(g.itens.map(nomeCru).filter(Boolean))];

    const apoio = [
      `${g.itens.length} lançamentos`,
      de && ate && de !== ate ? `${dataCurta(de)} a ${dataCurta(ate)}` : null,
      crus.length === 1 ? (crus[0] !== g.nome ? crus[0] : null) : `${crus.length} grafias`,
    ].filter(Boolean) as string[];

    return (
      <Fragment key={chave}>
        <tr
          onClick={() => alternarGrupo(g.chave)}
          className={cn(
            "cursor-pointer border-b align-top transition hover:bg-muted/40",
            abertoG ? "border-border bg-muted/30" : "border-border/60",
          )}
        >
          <td className="w-7 py-2 pl-4 pr-0" onClick={(e) => e.stopPropagation()}>
            {marcaveis.length > 0 ? (
              <Caixinha
                marcada={todos}
                parcial={marcados > 0 && !todos}
                onClick={() => alternarSelecaoGrupo(g)}
                titulo={todos
                  ? `Tirar os ${marcaveis.length} da seleção`
                  : `Selecionar os ${marcaveis.length} lançamentos de ${g.nome}`}
              />
            ) : (
              <span className="block text-center text-[11px] text-muted-foreground/40">–</span>
            )}
          </td>
          {/* A data do grupo é a da primeira cobrança; o intervalo inteiro está
              na linha de apoio, que é onde ele cabe. */}
          <td
            className="whitespace-nowrap px-2 py-2 text-[11.5px] num text-muted-foreground"
            title={de && ate && de !== ate ? `De ${dataCurta(de)} a ${dataCurta(ate)}` : undefined}
          >
            {dataCurta(de)}
          </td>
          <td className="overflow-hidden px-2 py-2 text-[11.5px]">
            <div className="flex items-center gap-1.5 whitespace-nowrap text-foreground">
              <ChevronRight className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                abertoG && "rotate-90",
              )} />
              {cartao && <CreditCard className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <span className="truncate font-medium" title={g.nome}>{g.nome}</span>
              <span
                className="num shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground"
                title={`${g.itens.length} lançamentos somados nesta linha — clique para abrir`}
              >
                {g.itens.length}
              </span>
              {forn && comp && <ChipFornecedor f={forn} comp={comp} />}
              {/* O que some ao juntar as linhas: que ali dentro há comprovante e
                  justificativa. O ícone não abre nada — diz onde procurar. */}
              {comCpv > 0 && (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground" title={`${comCpv} com comprovante no Drive`}>
                  <Paperclip className="h-3 w-3" />
                  {comCpv > 1 && <span className="num text-[10px]">{comCpv}</span>}
                </span>
              )}
              {comNota > 0 && (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-violet-700" title={`${comNota} com justificativa escrita`}>
                  <MessageSquareText className="h-3 w-3" />
                  {comNota > 1 && <span className="num text-[10px]">{comNota}</span>}
                </span>
              )}
            </div>
            <div className="mt-px truncate text-[10px] text-muted-foreground" title={apoio.join(" · ")}>
              {apoio.join(" · ")}
            </div>
          </td>
          {/* Uma categoria é dita; mais de uma é avisada. Trocar continua sendo
              coisa de lançamento (ou do lote, pela caixinha) — o grupo abre. */}
          <td className="overflow-hidden px-2 py-2 text-[11px]">
            {cats.length === 1 ? (
              <>
                <div className="truncate text-foreground/90" title={cats[0].descricao}>{cats[0].descricao}</div>
                <div className="mt-px truncate font-mono text-[9.5px] text-muted-foreground">{cats[0].codigo ?? "—"}</div>
              </>
            ) : (
              <span
                className="text-muted-foreground"
                title={cats.map((c) => `${c.descricao} · ${moeda(c.total)}`).join("\n")}
              >
                {cats.length} categorias
              </span>
            )}
          </td>
          <td className={cn(
            "whitespace-nowrap px-3 py-2 text-right text-[11.5px] num font-semibold",
            g.total < 0 ? "text-primary" : "text-emerald-700",
          )}>
            {moeda(g.total)}
          </td>
        </tr>
        {abertoG && g.itens.map((l, i) => renderLinha(l, `${chave}-${l.cod_titulo ?? "s"}-${i}`, true))}
      </Fragment>
    );
  };

  return (
    <Sheet open={!!alvo} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-[640px]">
        {alvo && (
          <div className="flex h-full flex-col">
            {/* ---------------- cabeçalho ----------------
                O CARIMBO VIRA O PRÓPRIO BLOCO DO NÚMERO. Antes eram três KPIs
                soltos mais uma faixa colorida embaixo dizendo se batiam — quatro
                linhas para uma informação só. Agora o bloco da direita É o
                veredito: verde e "N lançamentos · confere" quando fecha, âmbar e
                a diferença quando não. */}
            <SheetHeader className="shrink-0 space-y-0 border-b border-border px-5 pb-3.5 pt-5 text-left">
              <SheetTitle className="text-[15px] font-semibold">
                {alvo.rubrica} <span className="text-muted-foreground">· {alvo.mesLabel}</span>
              </SheetTitle>
              {/* Curto na tela, exato no hover: qual campo de data o corte usa
                  é o que se confere contra o ERP, mas não precisa ocupar uma
                  linha inteira do cabeçalho toda vez que o painel abre. */}
              <p className="pt-0.5 text-[11px] text-muted-foreground" title={`Lançamentos do Omie por ${dataUsada}`}>
                {alvo.tipo.toUpperCase()} · Omie por {alvo.tipo === "dre" ? "competência" : "caixa"}
              </p>

              <div className="mt-3 flex items-stretch overflow-hidden rounded-lg border border-border">
                <div className="flex-1 px-3 py-2">
                  <div className="text-[9px] font-bold tracking-[0.12em] text-muted-foreground">NA TELA</div>
                  <div className="num mt-0.5 text-[15px] font-bold text-foreground">
                    {alvo.celula != null ? moeda(alvo.celula) : "—"}
                  </div>
                </div>
                <div className="w-px bg-border" />
                <div className={cn(
                  "flex-1 px-3 py-2",
                  carregando || erro ? "bg-muted/40" : bate ? "bg-emerald-50" : "bg-amber-50",
                )}>
                  <div className={cn(
                    "flex items-center gap-1.5 text-[9px] font-bold tracking-[0.12em]",
                    carregando || erro ? "text-muted-foreground" : bate ? "text-emerald-700" : "text-amber-800",
                  )}>
                    {carregando ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      : bate ? <Check strokeWidth={3.5} className="h-2.5 w-2.5" />
                      : <TriangleAlert className="h-2.5 w-2.5" />}
                    <span className="truncate">
                      {carregando ? "SOMANDO…"
                        : erro ? "SOMA DOS LANÇAMENTOS"
                        : `${linhas.length} ${linhas.length === 1 ? "LANÇAMENTO" : "LANÇAMENTOS"}`}
                      {!carregando && !erro && alvo.celula != null && (bate ? " · CONFERE" : " · DIFERE")}
                    </span>
                  </div>
                  <div className={cn(
                    "num mt-0.5 text-[15px] font-bold",
                    carregando || erro ? "text-foreground" : bate ? "text-emerald-700" : "text-amber-900",
                  )}>
                    {moeda(soma)}
                  </div>
                </div>
              </div>

              {/* A exceção explica a si mesma, e só ela ocupa linha: em mês
                  travado a célula vem do tracker e não tem por que casar com o
                  que o Omie tem. */}
              {!carregando && !erro && !bate && alvo.celula != null && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-amber-900">
                  Diferença de <b className="num">{moeda(soma - alvo.celula)}</b> —{" "}
                  {alvo.travado
                    ? "este mês está travado, então o valor na tela veio do tracker, não do Omie."
                    : "pode ser lançamento fora da janela de sincronização ou mudança no DE-PARA depois do último recálculo."}
                </p>
              )}
            </SheetHeader>

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

            {/* ---------------- linha RESUMO ----------------
                Comparativo e composição eram duas faixas empilhadas, cada uma
                com seu cabeçalho recolhível; juntas comiam a lista. Viram dois
                chips: SÓ UM ABRE POR VEZ, o detalhe tem teto de altura e a busca
                sobe para cá — uma faixa a menos entre o cabeçalho e a lista. */}
            {!carregando && !erro && (temPonte || temComposicao || linhas.length >= 6 || !filtroVazio(filtro)) && (
              <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-5 py-2">
                {(temPonte || temComposicao) && (
                  <span className="shrink-0 text-[10px] font-bold tracking-[0.1em] text-muted-foreground/80">RESUMO</span>
                )}

                {temPonte && ponte && (
                  <ChipResumo
                    aberto={resumo === "fornecedores"}
                    onClick={() => abrirResumo("fornecedores")}
                    titulo={carregandoAnteriores
                      ? `Comparando com ${mesCurto(ponte.mesAnterior)}…`
                      : `Cada real da diferença entre ${mesCurto(ponte.mesAnterior)} e ${mesCurto(ponte.mes)}, fornecedor a fornecedor`}
                  >
                    Fornecedores{" "}
                    {carregandoAnteriores ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : Math.abs(ponte.delta) < 0.005 ? (
                      <span className="text-muted-foreground">sem mudança</span>
                    ) : (
                      <>
                        <span className={cn(
                          "num font-semibold",
                          resumo === "fornecedores" ? "" : ponte.delta < 0 ? "text-primary" : "text-emerald-700",
                        )}>
                          {moedaSemCentavos(ponte.delta)}
                        </span>
                        <span className={resumo === "fornecedores" ? "opacity-70" : "text-muted-foreground"}>
                          vs {mesCurto(ponte.mesAnterior)}
                        </span>
                      </>
                    )}
                  </ChipResumo>
                )}

                {temComposicao && composicao && (
                  <ChipResumo
                    aberto={resumo === "categorias"}
                    onClick={() => abrirResumo("categorias")}
                    titulo="Quais categorias do Omie o DE-PARA jogou nesta rubrica, e quanto cada uma pesou"
                  >
                    Categorias{" "}
                    <span className="num font-semibold">{resumoDaComposicao(composicao, filtro.categorias)}</span>
                  </ChipResumo>
                )}

                <BuscaLancamentos filtro={filtro} onFiltro={setFiltro} className="ml-auto w-[190px] shrink-0" />
              </div>
            )}

            {/* ---------------- o detalhe do chip aberto ---------------- */}
            {!carregando && !erro && temPonte && ponte && resumo === "fornecedores" && (
              <PonteVariacao
                key={`${alvo.tipo}|${alvo.rubrica}|${alvo.mes}`}
                ponte={ponte}
                comp={comp}
                carregando={carregandoAnteriores}
                /* Só o texto copiado usa: é o que faz o comentário dizer de que
                   linha e de que mês ele fala, longe desta tela. */
                rubrica={alvo.rubrica}
                mesLabel={alvo.mesLabel}
                celula={alvo.celula}
                celulaAnterior={alvo.celulaAnterior}
                travado={alvo.travado}
                travadoAnterior={alvo.travadoAnterior}
                moeda={moeda}
                moedaSemCentavos={moedaSemCentavos}
                obsDe={(cod) => (cod ? textos.get(cod) : undefined)}
              />
            )}

            {!carregando && !erro && temComposicao && composicao && resumo === "categorias" && (
              <ComposicaoCategorias
                comp={composicao}
                marcadas={filtro.categorias}
                onMarcadas={(c) => setFiltro({ ...filtro, categorias: c })}
                moeda={moeda}
                moedaSemCentavos={moedaSemCentavos}
              />
            )}

            {!carregando && !erro && (buscandoObs || cartoesSemObs.length > 0) && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-5 py-2">
                {/* A espera diz de quanto é: sem o contador, uma busca longa é
                    indistinguível de uma travada — foi o que aconteceu numa
                    célula com 236 gastos de cartão. */}
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  {buscandoObs
                    ? <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Buscando a observação dos gastos de cartão no Omie…
                        {obsProgresso && obsProgresso.total > 0 && (
                          <span className="num">{obsProgresso.feitos} de {obsProgresso.total}</span>
                        )}
                      </>
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
                /* `table-fixed`: com largura automática a CATEGORIA quebrava em
                   quatro linhas de texto e empurrava a lista inteira para
                   baixo — uma descrição comprida decidia a altura de todas as
                   linhas. Agora cada coluna tem largura declarada e o que não
                   cabe corta com reticências, com o texto inteiro no hover. */
                <table className="w-full table-fixed border-collapse">
                  <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                    <tr className="border-b border-border text-[9.5px] font-semibold tracking-[0.06em] text-muted-foreground">
                      <th className="w-[26px] py-2 pl-4 pr-0 text-left">
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
                      <th className="w-[46px] px-2 py-2 text-left">DATA</th>
                      <th className="px-2 py-2 text-left">
                        <CabecalhoContraparte
                          agrupado={agrupado}
                          onAgrupado={(v) => { setAgrupar(v); guardarAgrupar(v); }}
                          fornecedores={grupos.length}
                          economia={economia}
                        />
                      </th>
                      <th className="w-[124px] px-2 py-2 text-left">CATEGORIA</th>
                      <th className="w-[108px] px-3 py-2 text-right">
                        <CabecalhoValor ordem={filtro.ordem} onOrdem={(o) => setFiltro({ ...filtro, ordem: o })} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocos.map((b) => {
                      if (b.tipo === "cabecalho") {
                        return (
                          <tr key={b.chave} className={cn("border-b", b.suspeito ? "border-amber-300 bg-amber-100" : "border-border bg-muted/60")}>
                            <td colSpan={5} className={cn(
                              "px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-[0.1em]",
                              b.suspeito ? "text-amber-900" : "text-muted-foreground",
                            )}>
                              <span className="inline-flex items-center gap-1.5">
                                {b.suspeito && <TriangleAlert strokeWidth={2.5} className="h-3 w-3 fill-amber-400 text-amber-800" />}
                                {b.texto}
                              </span>
                            </td>
                          </tr>
                        );
                      }
                      if (b.tipo === "grupo") return renderGrupo(b.g, b.chave);
                      return renderLinha(b.l, b.chave, false);
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* ---------------- rodapé ----------------
                Fixo, e é isso que ele resolve: a contagem do filtro morava numa
                linha que aparecia e sumia acima da lista, empurrando as linhas
                para cima e para baixo no meio da leitura. Aqui embaixo ela tem
                sempre a mesma altura. */}
            {!carregando && !erro && !!linhas.length && (
              <RodapeLista
                filtro={filtro}
                onFiltro={setFiltro}
                total={linhas.length}
                mostrados={visiveis.length}
                somaMostrada={somaVisivel}
                moeda={moeda}
                /* Só quando a lista está de fato agrupada: dizer "em N
                   fornecedores" com a lista aberta seria contar uma coisa que
                   não está na tela. Os suspeitos ficam fora do agrupamento, e
                   por isso entram na conta como uma linha cada. */
                fornecedores={agrupado ? grupos.length + suspeitos.length : null}
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
