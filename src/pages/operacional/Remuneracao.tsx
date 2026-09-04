import { useEffect, useMemo, useState } from "react";
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
  degrausDoFixo, filtrarPessoas, matrizParaPlanilha, resumoDaPessoa, rotuloMes,
  totaisDoMes, ultimaCompetenciaFechada,
  type Filtros, type PainelRemuneracao, type PessoaRemuneracao, type ResumoPessoa,
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
  const [aberta, setAberta] = useState<PessoaRemuneracao | null>(null);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc("remuneracao_painel");
    if (error) {
      setErro(error.message);
      setPainel(null);
    } else {
      setPainel(data as unknown as PainelRemuneracao);
    }
    setCarregando(false);
  };

  useEffect(() => { if (podeVer) void carregar(); else setCarregando(false); }, [podeVer]);

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

  /* Quantos têm a ficha do RH atrasada em relação ao que o Omie pagou. É a
     pendência que esta tela devolve para o RH. */
  const fichasAtrasadas = useMemo(
    () => linhas.filter((l) => Math.abs(l.resumo.divergenciaContrato ?? 0) >= 1).length,
    [linhas],
  );

  const exportar = () => {
    if (!painel) return;
    const aoa = matrizParaPlanilha(pessoas, meses);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    /* Largura das 15 colunas fixas; as de mês ficam no padrão, que já cabe.
       Nome, CódRH, Cargo, Setor, Área, Trocas, Modalidade, Início, Deslig.,
       Contrato, Fixo, Últ. reajuste, Reajuste R$, Reajuste %, Meses sem. */
    ws["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 14 },
                   { wch: 34 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 16 },
                   { wch: 12 }, { wch: 14 }, { wch: 13 }, { wch: 11 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Remuneração");
    XLSX.writeFile(wb, `remuneracao-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`${pessoas.length} pessoas exportadas`);
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
          <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", carregando && "animate-spin")} />
            Atualizar
          </Button>
          <Button size="sm" onClick={exportar} disabled={!painel || !pessoas.length}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar planilha
          </Button>
        </div>
      </div>

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
                  <TableHead>Pessoa</TableHead>
                  <TableHead className="hidden md:table-cell">Tempo de casa</TableHead>
                  <TableHead className="text-right">Fixo hoje</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Comissão média</TableHead>
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
                    <TableRow
                      key={p.id}
                      onClick={() => setAberta(p)}
                      className="cursor-pointer"
                    >
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
                    <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                      Ninguém no recorte atual.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            {linhas.length} pessoas · {meses.length ? `${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])}` : "sem período"}
            {" · "}o histórico antes de {meses[0] ? rotuloMes(meses[0]) : "—"} ainda vai entrar pelo Conta Azul.
          </p>
        </>
      )}

      <FichaDaPessoa pessoa={aberta} onClose={() => setAberta(null)} />
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
const SERIES = [
  { chave: "fixo",     rotulo: "Fixo",     cor: "hsl(var(--serie-fixo))" },
  { chave: "variavel", rotulo: "Variável", cor: "hsl(var(--serie-variavel))" },
  { chave: "escala",   rotulo: "Escala",   cor: "hsl(var(--serie-escala))" },
] as const;

/** Legenda: obrigatória com três séries — identidade nunca por cor sozinha. */
function Legenda() {
  return (
    <div className="flex items-center gap-3">
      {SERIES.map((s) => (
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
  mes: string; fixo: number; variavel: number; escala: number; total: number;
  reajuste: number | null;
};

/** Qual série está no TOPO da pilha desta barra — a última com valor. */
const topoDaPilha = (d: LinhaGrafico): string =>
  d.escala > 0 ? "escala" : d.variavel > 0 ? "variavel" : "fixo";

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
        const v = d[s.chave];
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

function FichaDaPessoa({ pessoa, onClose }: { pessoa: PessoaRemuneracao | null; onClose: () => void }) {
  if (!pessoa) return null;
  const r = resumoDaPessoa(pessoa);
  const degraus = degrausDoFixo(pessoa.meses);
  const porCompetencia = new Map(degraus.map((d) => [d.competencia, d]));
  const porMudanca = new Map(r.mudancas.map((m) => [m.competencia, m]));
  const meses = [...pessoa.meses].sort((a, b) => a.competencia.localeCompare(b.competencia));

  const dados: LinhaGrafico[] = meses.map((m) => ({
    mes: rotuloMes(m.competencia),
    fixo: Number(m.fixo) || 0,
    variavel: Number(m.premiacao) || 0,
    escala: Number(m.escala) || 0,
    total: Number(m.total) || 0,
    reajuste: porCompetencia.get(m.competencia)?.variacao ?? null,
  }));

  const soma = dados.reduce(
    (a, d) => ({
      fixo: a.fixo + d.fixo, variavel: a.variavel + d.variavel,
      escala: a.escala + d.escala, total: a.total + d.total,
    }),
    { fixo: 0, variavel: 0, escala: 0, total: 0 },
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
        </div>

        {/* Resumo */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { r: "Fixo hoje", v: fmtBRL(r.fixoAtual) },
            { r: "Variável médio", v: r.mesesComPremiacao ? fmtBRL(r.premiacaoMedia) : "—" },
            { r: "Total no período", v: fmtBRL(r.totalPeriodo) },
            { r: "Tempo de casa", v: tempoDeCasaStr(pessoa.inicio) },
          ].map((x) => (
            <div key={x.r} className="rounded-lg border border-border/60 p-2.5">
              <div className="eyebrow text-[9.5px]">{x.r}</div>
              <div className="num mt-0.5 text-sm font-semibold">{x.v}</div>
            </div>
          ))}
        </div>

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
              <Legenda />
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
                  {SERIES.map((s) => (
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
                        tickLine={false} axisLine={false} width={46} domain={["dataMin - 1000", "dataMax + 1000"]}
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
                    <th className="py-1.5 text-right font-medium">Variável</th>
                    <th className="py-1.5 text-right font-medium">Escala</th>
                    <th className="py-1.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {meses.map((m) => {
                    const degrau = porCompetencia.get(m.competencia);
                    const troca = porMudanca.get(m.competencia);
                    return (
                      <tr key={m.competencia} className="border-b border-border/30 last:border-0 hover:bg-secondary/40">
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
                        <td className="num py-1.5 text-right">
                          {Number(m.premiacao) ? fmtBRL(m.premiacao) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="num py-1.5 text-right">
                          {Number(m.escala) ? fmtBRL(m.escala) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="num py-1.5 text-right font-semibold">{fmtBRL(m.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-1.5 text-muted-foreground">Total</td>
                    <td className="num py-1.5 text-right">{fmtBRL(soma.fixo)}</td>
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
