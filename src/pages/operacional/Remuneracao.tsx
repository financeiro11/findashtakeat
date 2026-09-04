import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  TrendingUp, Search, Download, Loader2, Lock, AlertTriangle, ArrowUpRight,
  ArrowDownRight, Minus, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { moduleAccess } from "@/lib/modules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkline } from "@/components/ui/sparkline";
import { KpiCard } from "@/components/ui/kpi-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { valorExato } from "@/lib/valor";
import { mesesDeCasa, parseISO } from "@/lib/rescisao";
import {
  abasDaPlanilha, compararComPares, custoPorArea, degrausDoFixo, filtrarPessoas,
  resumoDaPessoa, rotuloMes, totaisDoMes, ultimaCompetenciaFechada,
  type Filtros, type PainelRemuneracao, type Pares, type PessoaRemuneracao,
  type ResumoPessoa,
} from "@/lib/remuneracao";

/**
 * Remuneração — a linha do tempo de quanto cada pessoa ganha.
 *
 * O OMIE É A VOZ DA VERDADE. Todo número desta tela é pagamento que saiu do
 * ERP; o espelho do Portal RH entra só para dizer o cargo, o setor e a data de
 * entrada — e para ser CONFERIDO contra o pagamento, nunca o contrário. Quando
 * a ficha do RH discorda do que foi pago, é a ficha que está atrasada, e a tela
 * marca isso como pendência do RH.
 *
 * Os dados vêm de `remuneracao_painel()` num bloco só. A tentação era ler
 * `vw_remuneracao_mensal` direto, mas o PostgREST corta em 1.000 linhas SEM
 * avisar e a view já tem ~1.020 — a tela mostraria uma folha menor que a real e
 * pareceria certa.
 */

/* ─────────────────────────── Formatadores ───────────────────────────
   Convenção do repo: o formatador "normal" devolve ReactNode com o valor cheio
   no hover; a variante `…Str` devolve string pura, para template literal,
   `title=` e a planilha. */

const fmtBRLStr = (n: number | null | undefined) => {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", {
    style: "currency", currency: "BRL",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
};

const fmtBRL = (n: number | null | undefined) => comValorExato(n, fmtBRLStr(n));

const pctStr = (v: number) =>
  `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const fmtDataHoraStr = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const fmtDataStr = (iso: string | null) => {
  const d = parseISO(iso);
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR");
};

/** "2 anos e 1 mês". Vazio quando a data de início não parseia. */
function tempoDeCasaStr(inicio: string | null): string {
  const d = parseISO(inicio);
  if (!d) return "—";
  const meses = mesesDeCasa(d, new Date());
  if (meses < 0) return "—";
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  if (anos === 0) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  return `${anos} ${anos === 1 ? "ano" : "anos"}${resto ? ` e ${resto}m` : ""}`;
}

/* Data de início anterior a 2015 é quase certamente a data de NASCIMENTO
   digitada no campo errado no Portal RH — o André Rocon está com 02/12/1996 nos
   dois campos. Marcar em vez de mostrar "29 anos de casa" calado. */
const inicioSuspeito = (iso: string | null) => {
  const d = parseISO(iso);
  return !!d && d.getFullYear() < 2015;
};

/* ─────────────────────────── Filtros ─────────────────────────── */

const FILTROS_PADRAO: Filtros = {
  busca: "",
  incluirSaidas: false,
  incluirNaoPessoas: false,
  soComFichaRh: false,
  setor: null,
};

/* ─────────────────────────── Página ─────────────────────────── */

type Linha = { pessoa: PessoaRemuneracao; resumo: ResumoPessoa };

export default function Remuneracao() {
  const { profile } = useAuth();
  const podeVer = moduleAccess(profile?.cargo).remuneracao;

  const [painel, setPainel] = useState<PainelRemuneracao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_PADRAO);
  const [mesFoco, setMesFoco] = useState<string | null>(null);

  /* A ficha aberta vive na URL: sem isso não dá para mandar "olha a trajetória
     da Thais" para ninguém — o destinatário cairia na lista e teria de procurar.
     Mesmo padrão de /tarefas?tarefa=<id>. */
  const [params, setParams] = useSearchParams();
  const idAberto = params.get("pessoa");
  const abrir = (id: string | null) => {
    setParams((p) => {
      const novo = new URLSearchParams(p);
      if (id) novo.set("pessoa", id); else novo.delete("pessoa");
      return novo;
    }, { replace: true });
  };

  /* Quem está marcado na lista. SEM TETO: a seleção serve para exportar o
     histórico de um punhado de pessoas específicas, que é o pedido da diretoria,
     e prender isso em três só porque a comparação visual não aguenta mais seria
     deixar o limite de um recurso mandar no outro.
     A comparação tem teto próprio, aplicada no botão dela. */
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [comparando, setComparando] = useState(false);
  const MAX_COMPARAR = 3;

  const marcar = (id: string, marcado: boolean) =>
    setSelecionadas((s) => {
      const novo = new Set(s);
      if (marcado) novo.add(id); else novo.delete(id);
      return novo;
    });

  /* De quando é o dado. O painel lê uma TABELA, não o Omie ao vivo: sem isto,
     um número velho parece atual. Em 04/09/2026 as premiações de agosto entraram
     no cache do Omie às 00:07 e a carga só rodaria às 12:40 — a tela mostrou
     R$ 1.178 de variável no mês em que havia R$ 108.987. */
  const [frescor, setFrescor] = useState<{ carga_em?: string; omie_em?: string } | null>(null);

  const carregar = async (recarregarDoOmie = false) => {
    setCarregando(true);
    setErro(null);

    // "Atualizar" dispara a carga ANTES de reler. Antes ele só relia a mesma
    // tabela — um botão de atualizar que não atualiza faz quem clica concluir
    // que o número está certo.
    if (recarregarDoOmie) {
      const { error } = await supabase.rpc("remuneracao_atualizar");
      if (error) {
        setErro(error.message);
        setCarregando(false);
        return;
      }
    }

    const [painelRes, frescorRes] = await Promise.all([
      supabase.rpc("remuneracao_painel"),
      supabase.rpc("remuneracao_frescor"),
    ]);
    if (painelRes.error) {
      setErro(painelRes.error.message);
      setPainel(null);
    } else {
      setPainel(painelRes.data as unknown as PainelRemuneracao);
      setFrescor((frescorRes.data as { carga_em?: string; omie_em?: string } | null) ?? null);
    }
    setCarregando(false);
    if (recarregarDoOmie) toast.success("Recarregado do Omie");
  };

  useEffect(() => { if (podeVer) void carregar(); else setCarregando(false); }, [podeVer]);

  /* O Omie tem coisa que a carga ainda não pegou. Não é erro — é a janela entre
     a sync do ERP e a carga diária —, mas quem está lendo precisa saber. */
  const atrasada =
    !!frescor?.carga_em && !!frescor?.omie_em && frescor.omie_em > frescor.carga_em;

  const meses = useMemo(
    () => [...(painel?.meses ?? [])].sort((a, b) => a.localeCompare(b)),
    [painel],
  );

  /* A referência é o último mês FECHADO, não o mais recente da base.
     O mês corrente tem uns poucos títulos avulsos já lançados, e usá-lo como
     referência dizia que todo mundo tinha saído: em 03/09/2026 era 1 lançamento
     de setembro contra 107 pessoas pagas em agosto, e as 107 sumiam da tela. */
  const referencia = useMemo(() => ultimaCompetenciaFechada(meses), [meses]);

  // O mês em foco começa no último fechado. `mesFoco` só é escrito pelo
  // seletor — assim recarregar não joga a pessoa de volta para o padrão.
  const mes = mesFoco ?? referencia;

  const setores = useMemo(() => {
    const s = new Set<string>();
    for (const p of painel?.pessoas ?? []) if (p.setor) s.add(p.setor);
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [painel]);

  const pessoas = useMemo(
    () => filtrarPessoas(painel?.pessoas ?? [], filtros, referencia),
    [painel, filtros, referencia],
  );

  const linhas: Linha[] = useMemo(
    () => pessoas
      .map((pessoa) => ({ pessoa, resumo: resumoDaPessoa(pessoa) }))
      .sort((a, b) => (b.resumo.fixoAtual ?? 0) - (a.resumo.fixoAtual ?? 0)),
    [pessoas],
  );

  /* O KPI do mês NÃO usa a lista da tabela.
     A lista responde "quem está aqui hoje" e por isso esconde quem saiu; o custo
     de agosto, não — quem foi pago em agosto custou em agosto, mesmo tendo saído
     no dia 20. Com o filtro da lista o KPI dizia R$ 508.072 para um mês que
     fechou em R$ 557.737, e um número rotulado "custo de pessoas" tem de bater
     com a DRE. Busca e setor continuam valendo: "custo de Tecnologia em agosto"
     é uma pergunta legítima. */
  const pessoasDoMes = useMemo(
    () => filtrarPessoas(painel?.pessoas ?? [], { ...filtros, incluirSaidas: true }, referencia),
    [painel, filtros, referencia],
  );

  const totais = useMemo(
    () => (mes ? totaisDoMes(pessoasDoMes, mes) : null),
    [pessoasDoMes, mes],
  );

  /* Quantos daquele mês já não estão na lista — a diferença entre o custo real
     e o time de hoje, dita em voz alta em vez de sumir na conta. */
  const saidasNoMes = useMemo(
    () => (mes ? totais!.gente - totaisDoMes(pessoas, mes).gente : 0),
    [totais, pessoas, mes],
  );

  /* A comparação com os pares roda sobre TODAS as pessoas, não sobre o recorte:
     a mediana do cargo não muda porque alguém filtrou por setor, e recalcular
     por filtro faria o percentil da mesma pessoa dançar conforme a tela. */
  const pares = useMemo(
    () => compararComPares(painel?.pessoas ?? [], meses),
    [painel, meses],
  );

  const areas = useMemo(
    () => custoPorArea(pessoasDoMes, meses),
    [pessoasDoMes, meses],
  );

  /* A série do gráfico do topo: o custo do período, decomposto nas mesmas três
     séries da ficha. */
  const serieDoCusto: LinhaGrafico[] = useMemo(
    () => meses.map((m) => {
      const t = totaisDoMes(pessoasDoMes, m);
      return {
        mes: rotuloMes(m),
        fixo: t.fixo, prolabore: t.prolabore, variavel: t.premiacao, escala: t.escala,
        total: t.total, reajuste: null,
      };
    }),
    [pessoasDoMes, meses],
  );

  const seriesDoCusto = useMemo(() => seriesPresentes(serieDoCusto), [serieDoCusto]);

  /* Quantos têm a ficha do RH atrasada em relação ao que o Omie pagou. É a
     pendência que esta tela devolve para o RH. */
  const fichasAtrasadas = useMemo(
    () => linhas.filter((l) => Math.abs(l.resumo.divergenciaContrato ?? 0) >= 1).length,
    [linhas],
  );

  /* O formato de moeda do Excel em pt-BR. Aplicado célula a célula porque o
     SheetJS não tem formato por coluna — e sem ele o número sai cru, sem
     separador de milhar, que é onde a planilha começa a parecer despejo. */
  const FORMATO_MOEDA = 'R$ #,##0.00';
  const FORMATO_PCT = '0.0"%"';

  /* Quem vai no arquivo: as marcadas, se houver alguma; senão o recorte inteiro
     da tela. Assim "exportar tudo" continua sendo um clique e "exportar estas
     quatro pessoas" também. */
  const exportar = (quem?: PessoaRemuneracao[]) => {
    if (!painel) return;
    const alvo = quem
      ?? (selecionadas.size
        ? (painel.pessoas ?? []).filter((p) => selecionadas.has(p.id))
        : pessoas);
    if (!alvo.length) return;

    const wb = XLSX.utils.book_new();

    for (const aba of abasDaPlanilha(alvo, meses, pares)) {
      const ws = XLSX.utils.aoa_to_sheet(aba.linhas);
      ws["!cols"] = aba.larguras.map((wch) => ({ wch }));

      /* Congelar painel NÃO dá: a edição comunitária do SheetJS não escreve
         `<pane>` — testei, e `ws["!freeze"]` sai do arquivo sem deixar rastro.
         Por isso as abas são estreitas: a que tem 24 colunas é a de uma linha
         por pessoa, e a de mês a mês tem 11. */

      // Filtro na faixa INTEIRA, não só no cabeçalho: com a faixa de uma linha
      // o Excel abre o menu e não filtra nada. É a primeira coisa que alguém faz
      // numa lista de 150 pessoas.
      ws["!autofilter"] = { ref: ws["!ref"]! };

      // O formato de número é por CÉLULA no SheetJS — não existe formato de
      // coluna. Sem isto o dinheiro sai cru, sem separador de milhar.
      const ultimaLinha = aba.linhas.length - 1;
      const moeda = new Set(aba.moeda);
      const pct = new Set(aba.percentual);
      for (let linha = 1; linha <= ultimaLinha; linha++) {
        for (const col of [...moeda, ...pct]) {
          const cel = ws[XLSX.utils.encode_cell({ r: linha, c: col })];
          if (cel && cel.t === "n") cel.z = moeda.has(col) ? FORMATO_MOEDA : FORMATO_PCT;
        }
      }
      XLSX.utils.book_append_sheet(wb, ws, aba.nome);
    }

    /* O nome do arquivo diz de QUEM ele é. Exportar cinco pessoas e receber
        "remuneracao-2026-09-04.xlsx" faz o terceiro download da semana virar
        adivinhação. Uma pessoa só leva o nome dela. */
    const quantas = alvo.length;
    const apelido = quantas === 1
      ? alvo[0].nome.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
      : `${quantas}-pessoas`;
    XLSX.writeFile(wb, `remuneracao-${apelido}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(
      quantas === 1
        ? `Histórico de ${alvo[0].nome} exportado`
        : `${quantas} pessoas exportadas em 3 abas`,
    );
  };

  /* ── Sem acesso ──
     A policy no Postgres já devolveria listas vazias, mas "nenhuma pessoa" é
     indistinguível de "sem permissão" para quem está olhando — e é o tipo de
     dúvida que vira chamado. */
  if (!podeVer) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">Remuneração é restrita</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Esta tela mostra quanto cada pessoa ganha. O acesso é dos cargos
          Diretoria, CEO e Financeiro. Fale com o financeiro se você precisa dela.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Cabeçalho ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <TrendingUp className="h-5 w-5 text-primary" />
            Remuneração
          </h1>
          <p className="text-sm text-muted-foreground">
            Quanto cada pessoa ganha, mês a mês — fixo e comissão separados.
            Os valores são o que saiu do Omie.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={atrasada ? "default" : "outline"}
            size="sm"
            onClick={() => void carregar(true)}
            disabled={carregando}
            title="Recarrega do Omie e relê o painel"
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", carregando && "animate-spin")} />
            {atrasada ? "Recarregar do Omie" : "Atualizar"}
          </Button>
          <Button
            size="sm"
            onClick={() => exportar()}
            disabled={!painel || (!pessoas.length && !selecionadas.size)}
            title="Resumo, mês a mês e por área — fixo, variável e escala separados"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {selecionadas.size
              ? `Exportar ${selecionadas.size} selecionada${selecionadas.size > 1 ? "s" : ""}`
              : "Exportar planilha"}
          </Button>
        </div>
      </div>

      {atrasada && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div>
            <p className="font-medium">O Omie tem lançamentos que este painel ainda não leu.</p>
            <p className="text-muted-foreground">
              Última carga: {fmtDataHoraStr(frescor?.carga_em)} · Omie sincronizado em{" "}
              {fmtDataHoraStr(frescor?.omie_em)}. A carga automática roda uma vez por dia;
              clique em “Recarregar do Omie” para trazer agora.
            </p>
          </div>
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-neg/30 bg-neg/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-neg" />
          <div>
            <p className="font-medium">Não foi possível carregar o painel.</p>
            <p className="text-muted-foreground">{erro}</p>
          </div>
        </div>
      )}

      {carregando && !painel ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : (
        <>
          {/* ── KPIs do mês em foco ── */}
          {totais && mes && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label={`Custo de pessoas · ${rotuloMes(mes)}`}
                value={fmtBRL(totais.total)}
                stats={[
                  { label: "Fixo", value: fmtBRL(totais.fixo) },
                  { label: "Variável", value: fmtBRL(totais.premiacao) },
                  { label: "Escala", value: fmtBRL(totais.escala) },
                ]}
                footnote="O custo do mês inclui quem foi pago nele e depois saiu."
              />
              <KpiCard
                label="Pessoas no mês"
                value={String(totais.gente)}
                subline={
                  saidasNoMes > 0
                    ? `${linhas.length} na lista · ${saidasNoMes} já saíram`
                    : `${linhas.length} na lista`
                }
              />
              <KpiCard
                label="Comissão sobre o total"
                value={totais.total ? `${Math.round((totais.premiacao / totais.total) * 100)}%` : "—"}
                subline={`${fmtBRLStr(totais.premiacao)} de ${fmtBRLStr(totais.total)}`}
              />
              <KpiCard
                label="Fichas do RH atrasadas"
                value={String(fichasAtrasadas)}
                valueTone={fichasAtrasadas > 0 ? "neg" : "neutral"}
                subline="contrato no RH ≠ pago no Omie"
                footnote="O Omie manda. A ficha é que precisa ser corrigida."
              />
            </div>
          )}

          {/* ── Para onde vai o dinheiro de gente ──
              O custo total decomposto nas MESMAS três séries da ficha (fixo,
              variável, escala) — três cores já validadas, em vez de inventar uma
              paleta de nove para as áreas. A quebra por área vem na tabela ao
              lado, com o número por extenso e a curva de cada uma. */}
          {meses.length > 1 && (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="card-surface p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="eyebrow">Custo de pessoas por mês</div>
                  <Legenda series={seriesDoCusto} />
                </div>
                <div className="mt-3 h-[190px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={serieDoCusto} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barCategoryGap="24%">
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.6} />
                      <XAxis dataKey="mes" tickLine={false} axisLine={false}
                             tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tickLine={false} axisLine={false} width={46}
                             tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                             tickFormatter={emMilStr} />
                      <Tooltip cursor={{ fill: "hsl(var(--secondary))", opacity: 0.5 }} content={<Dica />} />
                      {seriesDoCusto.map((s) => (
                        <Bar key={s.chave} dataKey={s.chave} stackId="a" fill={s.cor}
                             shape={Segmento(s.chave)} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card-surface overflow-hidden p-4">
                <div className="eyebrow">Por área · {rotuloMes(meses[0])} a {rotuloMes(meses[meses.length - 1])}</div>
                <div className="mt-2 max-h-[210px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {areas.map((a) => (
                        <tr key={a.area} className="border-b border-border/30 last:border-0">
                          <td className="py-1.5 pr-2">
                            <div className="font-medium leading-tight">{a.area}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {a.pessoasNoUltimoMes} no último mês
                            </div>
                          </td>
                          <td className="w-[70px] py-1.5">
                            <Sparkline data={a.serie} color="hsl(var(--serie-fixo))" width={64} height={18} />
                          </td>
                          <td className="num py-1.5 text-right">{fmtBRL(a.total)}</td>
                          <td className="num w-[54px] py-1.5 text-right text-[10.5px]">
                            {a.variacao == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className={a.variacao > 0 ? "text-neg" : "text-pos"}>
                                {pctStr(a.variacao)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Variação do primeiro ao último mês com valor. Custo subindo aparece
                  em vermelho — é despesa, não resultado.
                </p>
              </div>
            </div>
          )}

          {/* ── Filtros ── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filtros.busca}
                onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                placeholder="Nome, cargo, setor ou código do RH…"
                className="h-9 pl-8"
              />
            </div>

            <Select value={mes ?? ""} onValueChange={setMesFoco}>
              <SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="Mês" /></SelectTrigger>
              <SelectContent>
                {[...meses].reverse().map((m) => (
                  <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filtros.setor ?? "todos"}
              onValueChange={(v) => setFiltros((f) => ({ ...f, setor: v === "todos" ? null : v }))}
            >
              <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os setores</SelectItem>
                {setores.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            {([
              ["incluirSaidas", "Incluir quem saiu"],
              ["soComFichaRh", "Só com ficha no RH"],
              ["incluirNaoPessoas", "Incluir empresas"],
            ] as const).map(([chave, rotulo]) => (
              <label key={chave} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={filtros[chave]}
                  onCheckedChange={(v) => setFiltros((f) => ({ ...f, [chave]: v === true }))}
                />
                {rotulo}
              </label>
            ))}
          </div>

          {/* ── A lista ── */}
          <div className="card-surface overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[34px]">
                    {/* Marca todo o recorte de uma vez — com filtro de setor
                        aplicado, é como se exporta "o time de Tecnologia
                        inteiro" sem clicar dezessete vezes. */}
                    <Checkbox
                      aria-label="Marcar todas as pessoas do recorte"
                      checked={
                        linhas.length > 0 && linhas.every((l) => selecionadas.has(l.pessoa.id))
                          ? true
                          : linhas.some((l) => selecionadas.has(l.pessoa.id))
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={(v) => setSelecionadas((s) => {
                        const novo = new Set(s);
                        for (const l of linhas) {
                          if (v === true) novo.add(l.pessoa.id); else novo.delete(l.pessoa.id);
                        }
                        return novo;
                      })}
                    />
                  </TableHead>
                  <TableHead>Pessoa</TableHead>
                  <TableHead className="hidden md:table-cell">Tempo de casa</TableHead>
                  <TableHead className="text-right">Fixo hoje</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Variável médio</TableHead>
                  <TableHead
                    className="hidden xl:table-cell text-right"
                    title="Remuneração inteira (fixo + variável) contra quem tem o mesmo cargo"
                  >
                    Contra os pares
                  </TableHead>
                  <TableHead className="text-right">Último reajuste</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Sem reajuste</TableHead>
                  <TableHead className="hidden xl:table-cell w-[90px]">Evolução</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map(({ pessoa: p, resumo: r }) => {
                  const serie = p.meses.map((m) => Number(m.fixo) || 0);
                  const atrasada = Math.abs(r.divergenciaContrato ?? 0) >= 1;
                  return (
                    <TableRow key={p.id} onClick={() => abrir(p.id)} className="cursor-pointer">
                      {/* `stopPropagation` na célula inteira: sem isso marcar a
                          caixa também abriria a ficha, e escolher duas pessoas
                          para comparar viraria abrir duas fichas. */}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selecionadas.has(p.id)}
                          onCheckedChange={(v) => marcar(p.id, v === true)}
                          aria-label={`Selecionar ${p.nome}`}
                        />
                      </TableCell>

                      <TableCell>
                        <div className="font-medium leading-tight">{p.nome}</div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{p.cargo ?? "cargo não informado"}</span>
                          {p.setor && <span className="opacity-60">· {p.setor}</span>}
                          {!p.codigo_rh && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">sem ficha no RH</Badge>
                          )}
                          {p.datadesl && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">saiu {fmtDataStr(p.datadesl)}</Badge>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {inicioSuspeito(p.inicio) ? (
                          <span
                            className="inline-flex items-center gap-1 text-warn"
                            title={`Início ${fmtDataStr(p.inicio)} no Portal RH — provavelmente a data de nascimento no campo errado.`}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            data suspeita
                          </span>
                        ) : (
                          tempoDeCasaStr(p.inicio)
                        )}
                      </TableCell>

                      <TableCell className="num text-right font-medium">
                        {fmtBRL(r.fixoAtual)}
                        {atrasada && (
                          <div
                            className="text-[10px] font-normal text-warn"
                            title={`Ficha do RH: ${valorExato(p.valor_contrato)}. O Omie pagou ${valorExato(r.fixoAtual)}.`}
                          >
                            RH desatualizado
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="num hidden lg:table-cell text-right text-muted-foreground">
                        {r.mesesComPremiacao ? fmtBRL(r.premiacaoMedia) : "—"}
                      </TableCell>

                      {/* Onde a pessoa cai entre quem tem o MESMO cargo. Vazio
                          quando o grupo é pequeno demais para a mediana dizer
                          algo — melhor não dizer nada do que dizer ruído. */}
                      <TableCell className="hidden xl:table-cell text-right">
                        <ContraOsPares par={pares.get(p.id)} />
                      </TableCell>

                      {/* O reajuste em REAIS na frente, o percentual embaixo:
                          "+R$ 2.500" é a informação que fecha a conversa; "+12,5%"
                          sozinho obriga quem lê a fazer a multiplicação de cabeça
                          para saber do que se trata. */}
                      <TableCell className="text-right">
                        {r.ultimoReajuste ? (
                          <>
                            <div className={cn("num flex items-center justify-end gap-1 font-medium",
                              r.ultimoReajuste.variacao > 0 ? "text-pos" : "text-neg")}>
                              {r.ultimoReajuste.variacao > 0
                                ? <ArrowUpRight className="h-3 w-3" />
                                : <ArrowDownRight className="h-3 w-3" />}
                              {comValorExato(
                                r.ultimoReajuste.para - r.ultimoReajuste.de,
                                `${r.ultimoReajuste.variacao > 0 ? "+" : "−"}${fmtBRLStr(Math.abs(r.ultimoReajuste.para - r.ultimoReajuste.de))}`,
                              )}
                            </div>
                            <div
                              className="num text-[10.5px] text-muted-foreground"
                              title={`${fmtBRLStr(r.ultimoReajuste.de)} → ${fmtBRLStr(r.ultimoReajuste.para)}`}
                            >
                              {pctStr(r.ultimoReajuste.variacao)} · {rotuloMes(r.ultimoReajuste.competencia)}
                            </div>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Minus className="h-3 w-3" /> nenhum
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="num hidden sm:table-cell text-right text-sm">
                        {r.mesesSemReajuste == null
                          ? <span className="text-muted-foreground">—</span>
                          : `${r.mesesSemReajuste}m`}
                      </TableCell>

                      <TableCell className="hidden xl:table-cell">
                        {serie.length > 1 && (
                          <Sparkline data={serie} color="hsl(var(--primary))" width={80} height={20} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {!linhas.length && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                      Ninguém no recorte atual.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Barra da comparação: aparece quando há pelo menos uma escolhida, e
              some sozinha ao limpar. */}
          {selecionadas.size > 0 && (
            <div className="sticky bottom-3 z-10 mx-auto flex w-fit flex-wrap items-center gap-2 rounded-full border border-border bg-popover px-4 py-2 shadow-lg">
              <span className="text-xs font-medium">
                {selecionadas.size} selecionada{selecionadas.size > 1 ? "s" : ""}
              </span>
              <Button size="sm" className="h-7" onClick={() => exportar()}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Exportar histórico
              </Button>
              {/* A comparação visual tem teto próprio; a seleção não. Explicar o
                  porquê no título evita que o botão desabilitado pareça defeito. */}
              <Button
                size="sm" variant="outline" className="h-7"
                disabled={selecionadas.size < 2 || selecionadas.size > MAX_COMPARAR}
                onClick={() => setComparando(true)}
                title={
                  selecionadas.size < 2
                    ? "Escolha ao menos duas pessoas"
                    : selecionadas.size > MAX_COMPARAR
                      ? `A comparação visual cabe em ${MAX_COMPARAR} — acima disso as trajetórias viram novelo`
                      : "Sobrepor as trajetórias"
                }
              >
                Comparar
              </Button>
              <Button size="sm" variant="ghost" className="h-7"
                      onClick={() => setSelecionadas(new Set())}>
                Limpar
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {linhas.length} pessoas · {meses.length ? `${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])}` : "sem período"}
            {" · "}o histórico antes de {meses[0] ? rotuloMes(meses[0]) : "—"} ainda vai entrar pelo Conta Azul.
            {frescor?.carga_em && ` · carga de ${fmtDataHoraStr(frescor.carga_em)}`}
          </p>
        </>
      )}

      <FichaDaPessoa
        pessoa={(painel?.pessoas ?? []).find((p) => p.id === idAberto) ?? null}
        par={idAberto ? pares.get(idAberto) : undefined}
        onClose={() => abrir(null)}
        onExportar={exportar}
      />

      {comparando && (
        <Comparacao
          pessoas={(painel?.pessoas ?? []).filter((p) => selecionadas.has(p.id))}
          meses={meses}
          onClose={() => setComparando(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Comparar pessoas ───────────────────────────
   O pedido que originou o painel era sobre duas pessoas ("Sara e Karol"). Sem
   isto a comparação é abrir uma ficha, decorar e abrir a outra. */

function Comparacao({ pessoas, meses, onClose }: {
  pessoas: PessoaRemuneracao[]; meses: string[]; onClose: () => void;
}) {
  if (pessoas.length < 2) return null;

  /* Uma cor por PESSOA, na ordem em que foram escolhidas — as mesmas três
     séries validadas. Aqui a identidade é a pessoa, não o bloco. */
  const cores = SERIES.map((s) => s.cor);
  const dados = meses.map((m) => {
    const linha: Record<string, string | number> = { mes: rotuloMes(m) };
    for (const p of pessoas) {
      const mes = p.meses?.find((x) => x.competencia === m);
      linha[p.id] = Number(mes?.fixo) || 0;
    }
    return linha;
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-left">Comparar trajetórias</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          {pessoas.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1.5 text-xs">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: cores[i] }} />
              <span className="font-medium">{p.nome}</span>
              <span className="text-muted-foreground">{p.cargo ?? "sem cargo"}</span>
            </span>
          ))}
        </div>

        <div className="h-[230px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dados} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.6} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false}
                     tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickLine={false} axisLine={false} width={46}
                     tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                     tickFormatter={emMilStr} />
              <Tooltip content={<DicaComparacao pessoas={pessoas} cores={cores} />} />
              {pessoas.map((p, i) => (
                <Line key={p.id} type="stepAfter" dataKey={p.id} name={p.nome}
                      stroke={cores[i]} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* A tabela existe porque as linhas se cruzam: onde duas trajetórias se
            encostam, só o número resolve. */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Pessoa</th>
                {meses.map((m) => (
                  <th key={m} className="py-1.5 text-right font-medium">{rotuloMes(m)}</th>
                ))}
                <th className="py-1.5 text-right font-medium">No período</th>
              </tr>
            </thead>
            <tbody>
              {pessoas.map((p, i) => {
                const r = resumoDaPessoa(p);
                return (
                  <tr key={p.id} className="border-b border-border/30 last:border-0">
                    <td className="py-1.5">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle"
                            style={{ background: cores[i] }} />
                      {p.nome}
                    </td>
                    {meses.map((m) => {
                      const mes = p.meses?.find((x) => x.competencia === m);
                      return (
                        <td key={m} className="num py-1.5 text-right">
                          {mes ? fmtBRL(mes.fixo) : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                    <td className="num py-1.5 text-right font-semibold">{fmtBRL(r.totalPeriodo)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          A linha é o <strong>fixo</strong>; a coluna "no período" é tudo somado
          (fixo, variável e escala). Tempo de casa e cargo estão na legenda —
          trajetórias iguais podem ser de pessoas em pontos bem diferentes.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function DicaComparacao({ active, payload, label, pessoas, cores }: {
  active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string;
  pessoas: PessoaRemuneracao[]; cores: string[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((s) => {
        const i = pessoas.findIndex((p) => p.id === s.dataKey);
        if (i < 0 || !s.value) return null;
        return (
          <div key={s.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: cores[i] }} />
              {pessoas[i].nome}
            </span>
            <span className="num">{valorExato(s.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── A ficha ───────────────────────────
   A linha do tempo mês a mês, que é o artefato que o diretor pediu: dá para
   apontar o dedo em cada degrau e dizer quando foi e de quanto. */

/* As três séries, na ORDEM FIXA em que aparecem em todo lugar desta tela: fixo,
   variável, escala. Cor por identidade, nunca por posição no ranking — se a
   ordem mudasse conforme o mês, a mesma cor significaria coisas diferentes.
   Os tokens estão em `src/styles/tokens.css` e têm passo próprio no tema
   escuro; foram medidos contra as duas superfícies, não estimados. */
type Serie = { chave: string; rotulo: string; cor: string };

const SERIES: Serie[] = [
  { chave: "fixo",      rotulo: "Fixo",       cor: "hsl(var(--serie-fixo))" },
  // Pró-labore fica DEPOIS do fixo na pilha e antes do variável: é dinheiro
  // fixo do mês, só que do sócio e não do trabalho.
  { chave: "prolabore", rotulo: "Pró-labore", cor: "hsl(var(--serie-prolabore))" },
  { chave: "variavel",  rotulo: "Variável",   cor: "hsl(var(--serie-variavel))" },
  { chave: "escala",    rotulo: "Escala",     cor: "hsl(var(--serie-escala))" },
];

/**
 * As séries que ESTE conjunto de meses realmente tem.
 *
 * Pró-labore hoje é de uma pessoa só, e escala de dezesseis. Desenhar as quatro
 * sempre deixaria duas legendas permanentemente zeradas em quase toda ficha —
 * ruído que faz o leitor procurar uma cor que não está no gráfico. Fixo fica
 * sempre, mesmo zerado, porque é a linha de base da leitura.
 */
function seriesPresentes(dados: LinhaGrafico[]): Serie[] {
  return SERIES.filter(
    (s) => s.chave === "fixo" || dados.some((d) => Number(d[s.chave as keyof LinhaGrafico]) > 0),
  );
}

/**
 * Onde a pessoa cai entre quem tem o mesmo cargo.
 *
 * Compara a REMUNERAÇÃO INTEIRA — no comercial o fixo é R$ 3.000 para quase
 * todo mundo e a diferença mora na comissão. O número em destaque é a distância
 * em reais para a mediana; o percentil dá a escala, porque "R$ 2.000 a menos"
 * não diz se são 3 pessoas ou 30 acima dela.
 *
 * Cinza, não vermelho: ganhar abaixo da mediana não é um erro — metade do grupo
 * ganha, por definição. Pintar isso de alarme transforma estatística em
 * acusação.
 */
function ContraOsPares({ par }: { par?: Pares }) {
  if (!par) return <span className="text-xs text-muted-foreground">—</span>;
  const abaixo = par.contraMediana < 0;
  return (
    <div
      title={
        `${par.quantos} pessoas no cargo "${par.cargo}"\n` +
        `Ela: ${fmtBRLStr(par.valor)}/mês · mediana do cargo: ${fmtBRLStr(par.mediana)}\n` +
        `${Math.round(par.parteVariavel * 100)}% da remuneração dela é variável`
      }
    >
      <div className="num text-xs font-medium">
        {par.contraMediana === 0
          ? "na mediana"
          : `${abaixo ? "−" : "+"}${fmtBRLStr(Math.abs(par.contraMediana))}`}
      </div>
      <div className="num text-[10.5px] text-muted-foreground">
        p{par.percentil} de {par.quantos}
      </div>
    </div>
  );
}

/** Legenda: obrigatória com duas ou mais séries — identidade nunca por cor sozinha. */
function Legenda({ series = SERIES }: { series?: Serie[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {series.map((s) => (
        <span key={s.chave} className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: s.cor }} />
          {s.rotulo}
        </span>
      ))}
    </div>
  );
}

/* Eixo em milhares: "R$ 22.500" repetido cinco vezes na lateral rouba a largura
   do gráfico. Devolve string pura — dentro de SVG o hover do ValorExato não
   vale, e o número cheio está na tabela logo abaixo. */
const emMilStr = (v: number) =>
  v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));

type LinhaGrafico = {
  mes: string; fixo: number; prolabore: number; variavel: number; escala: number;
  total: number; reajuste: number | null;
};

/** Qual série está no TOPO da pilha desta barra — a última com valor. */
const topoDaPilha = (d: LinhaGrafico): string =>
  d.escala > 0 ? "escala"
  : d.variavel > 0 ? "variavel"
  : d.prolabore > 0 ? "prolabore"
  : "fixo";

/**
 * O segmento da barra empilhada.
 *
 * Arredondar só a última série (`radius` na Bar de escala) daria topo quadrado
 * na maioria das barras: escala é zero para quase todo mundo, e variável para
 * metade — o canto arredondado apareceria em uma barra a cada dez, o que lê como
 * defeito. Aqui o topo é arredondado no segmento que estiver POR CIMA naquele
 * mês, seja ele qual for.
 *
 * O `stroke` na cor da superfície é o vão de 2px entre os empilhados; sem ele os
 * três viram um bloco contínuo e a divisão só existe na diferença de matiz.
 */
function Segmento(serie: string) {
  return function Forma(props: {
    x?: number; y?: number; width?: number; height?: number;
    fill?: string; payload?: LinhaGrafico;
  }) {
    const { x = 0, y = 0, width = 0, height = 0, fill, payload } = props;
    if (!height || !width || !payload) return null;
    const r = topoDaPilha(payload) === serie ? Math.min(4, height, width / 2) : 0;
    const d = r
      ? `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y}
         L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r}
         L${x + width},${y + height} Z`
      : `M${x},${y} L${x + width},${y} L${x + width},${y + height} L${x},${y + height} Z`;
    return <path d={d} fill={fill} stroke="hsl(var(--background))" strokeWidth={1} />;
  };
}

/** O balão do hover. `soFixo` no gráfico da trajetória, que só tem uma série. */
function Dica({ active, payload, soFixo }: {
  active?: boolean; payload?: { payload: LinhaGrafico }[]; soFixo?: boolean;
}) {
  const d = active && payload?.length ? payload[0].payload : null;
  if (!d) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{d.mes}</div>
      {(soFixo ? SERIES.slice(0, 1) : SERIES).map((s) => {
        const v = Number(d[s.chave as keyof LinhaGrafico]);
        if (!v) return null;
        return (
          <div key={s.chave} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: s.cor }} />
              {s.rotulo}
            </span>
            {/* Valor em tinta de texto, não na cor da série: quem carrega a
                identidade é o quadradinho ao lado. */}
            <span className="num">{valorExato(v)}</span>
          </div>
        );
      })}
      {!soFixo && (
        <div className="mt-1 flex items-center justify-between gap-4 border-t border-border/60 pt-1 font-medium">
          <span>Total</span>
          <span className="num">{valorExato(d.total)}</span>
        </div>
      )}
      {d.reajuste != null && (
        <div className={cn("mt-1 num text-[10.5px] font-medium", d.reajuste > 0 ? "text-pos" : "text-neg")}>
          {d.reajuste > 0 ? "▲" : "▼"} reajuste de {pctStr(d.reajuste)}
        </div>
      )}
    </div>
  );
}

/* O mês do reajuste ganha um ponto; os demais, nada. Marcar todos os pontos
   esconderia justamente o que importa nesta linha. */
function PontoDeReajuste(props: { cx?: number; cy?: number; payload?: LinhaGrafico }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload?.reajuste) return null;
  return (
    <g>
      {/* Anel na cor da superfície: separa o ponto da linha por baixo dele. */}
      <circle cx={cx} cy={cy} r={5} fill="hsl(var(--serie-fixo))" stroke="hsl(var(--background))" strokeWidth={2} />
      <title>{`${payload.mes}: reajuste de ${pctStr(payload.reajuste)} — ${valorExato(payload.fixo)}`}</title>
    </g>
  );
}

/** Um lançamento do mês — o que a RPC de drill-down devolve. */
type LancamentoDoMes = {
  cod_titulo: string; bloco: string; categoria: string | null;
  valor: number; vencimento: string | null; pagamento: string | null; fonte: string;
};

const ROTULO_BLOCO: Record<string, string> = {
  fixo: "Fixo", premiacao: "Variável", escala: "Escala",
  prolabore: "Pro labore", outro: "Outro",
};

function FichaDaPessoa({ pessoa, par, onClose, onExportar }: {
  pessoa: PessoaRemuneracao | null;
  par?: Pares;
  onClose: () => void;
  onExportar: (quem: PessoaRemuneracao[]) => void;
}) {
  /* Qual mês está aberto no drill-down, e o que veio dele. Fica AQUI e não em
     cada linha para que abrir um mês feche o anterior — dois meses abertos ao
     mesmo tempo empurram a tabela para fora da tela. */
  const [mesAberto, setMesAberto] = useState<string | null>(null);
  const [titulos, setTitulos] = useState<LancamentoDoMes[] | null>(null);
  const [buscandoTitulos, setBuscandoTitulos] = useState(false);

  const pessoaId = pessoa?.id ?? null;
  useEffect(() => { setMesAberto(null); setTitulos(null); }, [pessoaId]);

  useEffect(() => {
    if (!pessoaId || !mesAberto) { setTitulos(null); return; }
    let vivo = true;
    setBuscandoTitulos(true);
    void supabase
      .rpc("remuneracao_lancamentos", { p_pessoa: pessoaId, p_competencia: mesAberto })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) toast.error(`Não deu para abrir o mês: ${error.message}`);
        setTitulos((data as LancamentoDoMes[] | null) ?? []);
        setBuscandoTitulos(false);
      });
    return () => { vivo = false; };
  }, [pessoaId, mesAberto]);

  if (!pessoa) return null;
  const r = resumoDaPessoa(pessoa);
  const degraus = degrausDoFixo(pessoa.meses);
  const porCompetencia = new Map(degraus.map((d) => [d.competencia, d]));
  const porMudanca = new Map(r.mudancas.map((m) => [m.competencia, m]));
  const meses = [...pessoa.meses].sort((a, b) => a.competencia.localeCompare(b.competencia));

  const dados: LinhaGrafico[] = meses.map((m) => ({
    mes: rotuloMes(m.competencia),
    fixo: Number(m.fixo) || 0,
    prolabore: Number(m.prolabore) || 0,
    variavel: Number(m.premiacao) || 0,
    escala: Number(m.escala) || 0,
    total: Number(m.total) || 0,
    reajuste: porCompetencia.get(m.competencia)?.variacao ?? null,
  }));

  const series = seriesPresentes(dados);
  const temProlabore = dados.some((d) => d.prolabore > 0);

  const soma = dados.reduce(
    (a, d) => ({
      fixo: a.fixo + d.fixo, prolabore: a.prolabore + d.prolabore,
      variavel: a.variavel + d.variavel,
      escala: a.escala + d.escala, total: a.total + d.total,
    }),
    { fixo: 0, prolabore: 0, variavel: 0, escala: 0, total: 0 },
  );

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="pr-6 text-left leading-tight">{pessoa.nome}</SheetTitle>
        </SheetHeader>

        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {pessoa.cargo && <Badge variant="secondary" className="h-5">{pessoa.cargo}</Badge>}
          {pessoa.setor && <Badge variant="outline" className="h-5">{pessoa.setor}</Badge>}
          {pessoa.modalidade && <Badge variant="outline" className="h-5">{pessoa.modalidade}</Badge>}
          {/* Quem já abriu a ficha não deveria ter de fechá-la, achar a linha e
              marcar a caixa só para levar o histórico dessa pessoa. */}
          <Button
            size="sm" variant="outline" className="ml-auto h-7"
            onClick={() => onExportar([pessoa])}
            title="Histórico completo desta pessoa, com fixo, variável e escala separados"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar histórico
          </Button>
        </div>

        {/* Resumo */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { r: "Fixo hoje", v: fmtBRL(r.fixoAtual) },
            // O ladrilho do pró-labore toma o lugar do "variável médio" em quem
            // recebe pró-labore: sócio não tem comissão, e um ladrilho com
            // travessão desperdiça o espaço que o número precisa.
            ...(temProlabore
              ? [{ r: "Pró-labore/mês", v: fmtBRL(dados[dados.length - 1]?.prolabore || null) }]
              : [{ r: "Variável médio", v: r.mesesComPremiacao ? fmtBRL(r.premiacaoMedia) : "—" }]),
            { r: "Total no período", v: fmtBRL(r.totalPeriodo) },
            { r: "Tempo de casa", v: tempoDeCasaStr(pessoa.inicio) },
          ].map((x) => (
            <div key={x.r} className="rounded-lg border border-border/60 p-2.5">
              <div className="eyebrow text-[9.5px]">{x.r}</div>
              <div className="num mt-0.5 text-sm font-semibold">{x.v}</div>
            </div>
          ))}
        </div>

        {/* Onde ela está entre quem tem o mesmo cargo. Em tom neutro: metade de
            qualquer grupo ganha abaixo da mediana, por definição — pintar isso
            de alarme transformaria estatística em acusação. */}
        {par && (
          <div className="mt-3 rounded-lg border border-border/60 p-2.5 text-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">Contra quem tem o mesmo cargo</span>
              <span className="text-muted-foreground">
                {par.quantos} pessoas em “{par.cargo}”
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span>
                Ela: <span className="num font-medium">{fmtBRLStr(par.valor)}</span>/mês
              </span>
              <span>
                Mediana do cargo: <span className="num font-medium">{fmtBRLStr(par.mediana)}</span>
              </span>
              <span>
                {par.contraMediana === 0 ? "Exatamente na mediana" : (
                  <>
                    {par.contraMediana < 0 ? "Abaixo" : "Acima"} em{" "}
                    <span className="num font-medium">
                      {fmtBRLStr(Math.abs(par.contraMediana))}
                    </span>
                  </>
                )}
              </span>
              <span className="text-muted-foreground">percentil {par.percentil}</span>
            </div>
            {/* Quando a maior parte vem da comissão, dizer isso muda a conversa:
                o fixo é quase igual para o time todo e não explica nada. */}
            {par.parteVariavel >= 0.3 && (
              <p className="mt-1 text-[10.5px] text-info">
                {Math.round(par.parteVariavel * 100)}% da remuneração dela é variável —
                o fixo não conta a história deste cargo.
              </p>
            )}
            {/* Régua: onde ela cai dentro do grupo, de relance. */}
            <div className="relative mt-2 h-1.5 w-full rounded-full bg-secondary">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" title="Mediana" />
              <div
                className="absolute -top-0.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-primary ring-2 ring-background"
                style={{ left: `${Math.min(98, Math.max(2, par.percentil))}%` }}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Compara a remuneração inteira (fixo + variável + escala), pela mediana
              mensal dos meses cujo variável já foi lançado — o mês em que a comissão
              ainda não entrou ficaria com só o fixo e afundaria o percentil por
              motivo de calendário.
            </p>
          </div>
        )}

        {Math.abs(r.divergenciaContrato ?? 0) >= 1 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
            <div>
              <p className="font-medium">A ficha do Portal RH está desatualizada.</p>
              <p className="text-muted-foreground">
                Contrato lá: {valorExato(pessoa.valor_contrato)} · pago pelo Omie:{" "}
                {valorExato(r.fixoAtual)}. O Omie é a referência — o que precisa ser
                corrigido é a ficha.
              </p>
            </div>
          </div>
        )}

        {!meses.length ? (
          <p className="mt-6 py-6 text-center text-sm text-muted-foreground">
            Nenhum pagamento registrado no período carregado.
          </p>
        ) : (
          <>
            {/* ── A composição, mês a mês ── */}
            <div className="mt-5 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">Composição mês a mês</h3>
              <Legenda series={series} />
            </div>
            <div className="mt-2 h-[210px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dados} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="22%">
                  {/* Grade recessiva: só horizontal, tracejada. A vertical não
                      ajuda a ler valor e compete com as próprias barras. */}
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.6} />
                  <XAxis
                    dataKey="mes" tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickLine={false} axisLine={false} width={46}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={emMilStr}
                  />
                  <Tooltip cursor={{ fill: "hsl(var(--secondary))", opacity: 0.5 }} content={<Dica />} />
                  {series.map((s) => (
                    <Bar
                      key={s.chave} dataKey={s.chave} stackId="a" fill={s.cor}
                      shape={Segmento(s.chave)} isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* ── A trajetória do fixo ──
                Separado da composição de propósito: no empilhado o fixo é a base
                e os degraus somem sob a variação do topo. Aqui a linha responde
                "quando ela teve aumento, e de quanto", que é a pergunta que fez
                este painel existir. Um eixo só — nunca dois no mesmo gráfico. */}
            {meses.filter((m) => Number(m.fixo) > 0).length > 1 && (
              <>
                <h3 className="mt-5 text-sm font-semibold">Trajetória do fixo</h3>
                <div className="mt-2 h-[150px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dados} margin={{ top: 12, right: 10, bottom: 0, left: 4 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.6} />
                      <XAxis
                        dataKey="mes" tickLine={false} axisLine={false}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      />
                      <YAxis
                        tickLine={false} axisLine={false} width={46}
                        // Nunca abaixo de zero: `dataMin - 1000` num mês de
                        // fixo baixo desenharia um eixo de salário negativo.
                        domain={[(min: number) => Math.max(0, min - 1000), "dataMax + 1000"]}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={emMilStr}
                      />
                      <Tooltip cursor={{ stroke: "hsl(var(--border))" }} content={<Dica soFixo />} />
                      {/* Degrau, não curva: o salário muda de uma vez no mês do
                          reajuste; interpolar sugeriria aumento gradual. */}
                      <Line
                        type="stepAfter" dataKey="fixo" stroke="hsl(var(--serie-fixo))" strokeWidth={2}
                        dot={<PontoDeReajuste />} activeDot={{ r: 4 }} isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {/* ── A trajetória pelos times ──
                Único histórico de posição que existe: o Portal RH guarda o cargo
                de HOJE, e a categoria do pagamento carrega a área. A tela diz
                que é troca de TIME e não promoção — subir de nível dentro do
                mesmo time não muda a categoria e não aparece aqui. */}
            <h3 className="mt-5 text-sm font-semibold">Trajetória na empresa</h3>
            <ol className="mt-2 space-y-0 border-l border-border/70 pl-4">
              {[
                { quando: meses[0].competencia, area: meses[0].area, entrada: true },
                ...r.mudancas.map((m) => ({ quando: m.competencia, area: m.para, entrada: false })),
              ].map((passo, i) => (
                <li key={`${passo.quando}-${i}`} className="relative py-1.5 text-xs">
                  <span className="absolute -left-[21px] top-2.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                  <span className="text-muted-foreground">{rotuloMes(passo.quando)}</span>
                  <span className="mx-1.5">·</span>
                  <span className="font-medium">{passo.area ?? "sem área"}</span>
                  {passo.entrada && (
                    <span className="ml-1.5 text-muted-foreground">
                      (primeiro mês do período carregado)
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-1 pl-4 text-[10.5px] text-muted-foreground">
              Lido da categoria que pagou o fixo. É troca de <strong>time</strong>, não
              promoção — mudar de nível dentro do mesmo time não muda a categoria.
            </p>

            {/* ── A tabela ──
                Os números por extenso. É também o "relief" que o âmbar da escala
                exige no tema claro, onde ele não alcança 3:1 contra o branco. */}
            <h3 className="mt-5 text-sm font-semibold">Valores</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 text-left font-medium">Mês</th>
                    <th className="py-1.5 text-right font-medium">Fixo</th>
                    {/* Só quem recebe ganha a coluna — uma coluna de traços em
                        toda ficha é ruído. */}
                    {temProlabore && <th className="py-1.5 text-right font-medium">Pró-labore</th>}
                    <th className="py-1.5 text-right font-medium">Variável</th>
                    <th className="py-1.5 text-right font-medium">Escala</th>
                    <th className="py-1.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {meses.map((m) => {
                    const degrau = porCompetencia.get(m.competencia);
                    const troca = porMudanca.get(m.competencia);
                    const aberto = mesAberto === m.competencia;
                    return (
                    <Fragment key={m.competencia}>
                      <tr
                        onClick={() => setMesAberto(aberto ? null : m.competencia)}
                        title="Abrir os lançamentos deste mês"
                        className={cn("cursor-pointer border-b border-border/30 hover:bg-secondary/40",
                          aberto && "bg-secondary/60")}
                      >
                        <td className="py-1.5">
                          <span className="text-muted-foreground">{rotuloMes(m.competencia)}</span>
                          {degrau && (
                            <span
                              className={cn("ml-1.5 num text-[10px] font-medium",
                                degrau.variacao > 0 ? "text-pos" : "text-neg")}
                              title={`Reajuste de ${fmtBRLStr(degrau.de)} para ${fmtBRLStr(degrau.para)} · ${pctStr(degrau.variacao)}`}
                            >
                              {degrau.variacao > 0 ? "▲" : "▼"}{" "}
                              {degrau.variacao > 0 ? "+" : "−"}{fmtBRLStr(Math.abs(degrau.para - degrau.de))}
                            </span>
                          )}
                          {troca && (
                            <span
                              className="ml-1.5 text-[10px] text-info"
                              title={`Passou de ${troca.de} para ${troca.para}`}
                            >
                              ⇄ {troca.para}
                            </span>
                          )}
                        </td>
                        <td className="num py-1.5 text-right">{fmtBRL(Number(m.fixo) || null)}</td>
                        {temProlabore && (
                          <td className="num py-1.5 text-right">
                            {Number(m.prolabore) ? fmtBRL(m.prolabore) : <span className="text-muted-foreground">—</span>}
                          </td>
                        )}
                        <td className="num py-1.5 text-right">
                          {Number(m.premiacao) ? fmtBRL(m.premiacao) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="num py-1.5 text-right">
                          {Number(m.escala) ? fmtBRL(m.escala) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="num py-1.5 text-right font-semibold">{fmtBRL(m.total)}</td>
                      </tr>

                      {/* Os títulos que formam o mês. `cod_titulo` é o
                          `nCodTitulo` do Omie — é por ele que se acha a linha
                          no ERP, e por isso vai em monoespaçada e selecionável. */}
                      {aberto && (
                        <tr>
                          <td colSpan={temProlabore ? 6 : 5} className="bg-secondary/40 px-2 py-2">
                            {buscandoTitulos && !titulos ? (
                              <span className="text-[10.5px] text-muted-foreground">Abrindo…</span>
                            ) : !titulos?.length ? (
                              <span className="text-[10.5px] text-muted-foreground">
                                Nenhum lançamento — o mês veio de outra fonte.
                              </span>
                            ) : (
                              <div className="space-y-1">
                                {titulos.map((t) => (
                                  <div key={`${t.fonte}-${t.cod_titulo}`}
                                       className="flex flex-wrap items-baseline gap-x-2 text-[10.5px]">
                                    <span className="w-[68px] shrink-0 font-medium">
                                      {ROTULO_BLOCO[t.bloco] ?? t.bloco}
                                    </span>
                                    <span className="num w-[74px] shrink-0 text-right">
                                      {fmtBRL(t.valor)}
                                    </span>
                                    <span className="text-muted-foreground">{t.categoria ?? "—"}</span>
                                    <span className="text-muted-foreground/70">
                                      vence {fmtDataStr(t.vencimento)}
                                    </span>
                                    <span
                                      className="num select-all text-muted-foreground/70"
                                      title="Código do título no Omie — procure por ele no ERP"
                                    >
                                      #{t.cod_titulo}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-1.5 text-muted-foreground">Total</td>
                    <td className="num py-1.5 text-right">{fmtBRL(soma.fixo)}</td>
                    {temProlabore && <td className="num py-1.5 text-right">{fmtBRL(soma.prolabore)}</td>}
                    <td className="num py-1.5 text-right">{fmtBRL(soma.variavel)}</td>
                    <td className="num py-1.5 text-right">{fmtBRL(soma.escala)}</td>
                    <td className="num py-1.5 text-right">{fmtBRL(soma.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="mt-2 text-[10.5px] text-muted-foreground">
              Período coberto: {rotuloMes(meses[0].competencia)} a{" "}
              {rotuloMes(meses[meses.length - 1].competencia)}. O que vem antes disso
              ainda vai entrar pelo histórico do Conta Azul.
            </p>
          </>
        )}

        <dl className="mt-5 space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {[
            ["Código no RH", pessoa.codigo_rh ?? "sem ficha no Portal RH"],
            ["CNPJ/CPF", pessoa.doc ?? "—"],
            ["Início", inicioSuspeito(pessoa.inicio)
              ? `${fmtDataStr(pessoa.inicio)} — data suspeita, provavelmente o nascimento no campo errado`
              : fmtDataStr(pessoa.inicio)],
            ["Desligamento", pessoa.datadesl ? fmtDataStr(pessoa.datadesl) : "—"],
            ["Reajustes no período", String(degraus.length)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt>{k}</dt>
              <dd className="text-right text-foreground/80">{v}</dd>
            </div>
          ))}
        </dl>
      </SheetContent>
    </Sheet>
  );
}
