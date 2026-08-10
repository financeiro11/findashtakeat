/**
 * Cartão corporativo (Sicoob) — evolução das faturas.
 *
 * A fatura em OFX chega ilegível: o MEMO vem mascarado pelo adquirente e com
 * parcela, cidade e cauda internacional grudadas no nome do lojista. Quem
 * desembrulha isso é a skill "Evolução / Comparativo de Faturas do Cartão (OFX)"
 * rodando no Claude — ela lê os arquivos, normaliza o estabelecimento, classifica
 * e grava os lançamentos aqui via `cartao_importar`.
 *
 * Desta tela para baixo TUDO é calculado na hora, em `cartao/analise.ts`: KPIs,
 * matrizes, destaques e leitura rápida. O período é um controle da tela, então
 * um "total do período" gravado no banco discordaria do filtro à vista assim que
 * alguém mexesse nas datas.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CreditCard, Download, RefreshCw, Loader2, Building2, PieChart, ListOrdered, Upload, Flag,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { InsightCard } from "@/components/ui/insight-card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useContextoDaPagina } from "@/lib/contexto-pagina";
import { analisar, type Fatura, type Lancamento, type Marcacao } from "./cartao/analise";
import { abrevStr, fmtBRLStr, intStr, milStr, pctStr } from "./cartao/fmt";
import { abrev, fmtBRL } from "./cartao/valores";
import { Matriz, ORDENS, type Ordem, type Realce } from "./cartao/Matriz";
import { Detalhe } from "./cartao/Detalhe";
import { Categorias } from "./cartao/Categorias";

/* As tabelas do cartão são novas e ainda não estão no types.ts gerado (que não
   se edita à mão). Este alias mantém o resto do arquivo tipado em vez de
   espalhar `as any` por cada chamada. */
type Resposta = Promise<{ data: unknown[] | null; error: unknown }>;
/* `order` encadeável: a paginação precisa de mais de um critério (ver
   `carregarLancamentos`). */
type Paginavel = {
  order: (c: string, o?: { ascending?: boolean }) => Paginavel;
  range: (de: number, ate: number) => Resposta;
};
const db = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => {
      order: (c: string, o?: { ascending?: boolean }) => Resposta;
      gte: (c: string, v: string) => { lte: (c: string, v: string) => Paginavel };
    };
  };
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
};

type Aba = "estabelecimento" | "categoria" | "detalhe";

const ABAS = [
  ["estabelecimento", "Evolução por Estabelecimento", Building2],
  ["categoria", "Evolução por Categoria", PieChart],
  ["detalhe", "Detalhe dos lançamentos", ListOrdered],
] as const;

export default function Cartao() {
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [marcacoes, setMarcacoes] = useState<Marcacao[]>([]);
  const [de, setDe] = useState<string>("");
  const [ate, setAte] = useState<string>("");
  const [aba, setAba] = useState<Aba>("estabelecimento");
  const [realce, setRealce] = useState<Realce>("penultimo");
  const [ordem, setOrdem] = useState<Ordem>("total");
  const [carregando, setCarregando] = useState(true);

  /* ---------------------------------------------------------------- */

  const carregarFaturas = useCallback(async () => {
    const { data, error } = await db.from("cartao_faturas").select("*").order("competencia");
    if (error) { toast.error("Não consegui ler as faturas do cartão."); return []; }
    const fs = (data ?? []) as Fatura[];
    setFaturas(fs);
    return fs;
  }, []);

  /* Busca paginada. O período inteiro já passa de 3.700 lançamentos e o PostgREST
     corta a resposta num teto próprio sem avisar — e aqui truncar não deixa a
     tela "incompleta", deixa ERRADA: todo KPI e toda matriz saem desta lista.
     O tamanho efetivo da página é o que a primeira resposta devolveu, então isso
     funciona seja qual for o teto do servidor.

     A ordem precisa desempatar por `id`. Ordenar só por `data` é ordem PARCIAL —
     uma fatura fecha no mesmo dia para dezenas de compras (só em 09/02/26 são 22)
     — e o Postgres não promete a mesma ordem entre duas consultas quando o
     critério empata. Como cada página é uma consulta nova, a fronteira caía no
     meio de um empate e a mesma linha vinha em duas páginas enquanto outra não
     vinha em nenhuma: 7 duplicadas e 7 PERDIDAS no período. As duplicadas viravam
     `key` repetida na tabela de detalhe (linha fantasma que sobrevivia à busca) e
     as perdidas sumiam caladamente dos totais. */
  const carregarLancamentos = useCallback(async (dDe: string, dAte: string) => {
    if (!dDe || !dAte) { setLancamentos([]); return; }

    const todos: Lancamento[] = [];
    const vistos = new Set<string>();
    let pagina = 1000;
    for (let inicio = 0; ; inicio += pagina) {
      const { data, error } = await db
        .from("cartao_lancamentos").select("*")
        .gte("competencia", dDe).lte("competencia", dAte)
        .order("data").order("id")
        .range(inicio, inicio + pagina - 1);
      if (error) { toast.error("Não consegui ler os lançamentos."); return; }

      const lote = (data ?? []) as Lancamento[];
      // Cinto e suspensório: `id` repetido aqui é o que quebra a renderização.
      for (const l of lote) {
        if (vistos.has(l.id)) continue;
        vistos.add(l.id);
        todos.push(l);
      }
      if (inicio === 0) pagina = lote.length;   // teto real do servidor
      if (!lote.length || lote.length < pagina) break;
    }

    setLancamentos(todos.map((l) => ({ ...l, valor: Number(l.valor) })));
  }, []);

  const carregarMarcacoes = useCallback(async () => {
    const { data } = await db.from("cartao_marcacoes").select("*").order("marcado_em", { ascending: false });
    setMarcacoes((data ?? []) as Marcacao[]);
  }, []);

  // Primeira carga: descobre o período disponível e abre já com ele inteiro —
  // quem entra aqui quer ver a evolução, não escolher datas antes de ver nada.
  useEffect(() => {
    (async () => {
      setCarregando(true);
      const [fs] = await Promise.all([carregarFaturas(), carregarMarcacoes()]);
      if (fs.length) {
        const primeiro = fs[0].competencia;
        const ultimo = fs[fs.length - 1].competencia;
        setDe(primeiro);
        setAte(ultimo);
        await carregarLancamentos(primeiro, ultimo);
      }
      setCarregando(false);
    })();
  }, [carregarFaturas, carregarMarcacoes, carregarLancamentos]);

  useEffect(() => {
    if (de && ate) carregarLancamentos(de, ate);
  }, [de, ate, carregarLancamentos]);

  /* ---------------------------------------------------------------- */

  const faturasNoPeriodo = useMemo(
    () => faturas.filter((f) => (!de || f.competencia >= de) && (!ate || f.competencia <= ate)),
    [faturas, de, ate],
  );

  const analise = useMemo(
    () => analisar(faturasNoPeriodo, lancamentos, marcacoes),
    [faturasNoPeriodo, lancamentos, marcacoes],
  );

  const mapaMarcacoes = useMemo(
    () => new Map(marcacoes.map((m) => [m.estabelecimento, m])),
    [marcacoes],
  );

  /* Diz ao Assistente o que está à vista aqui. Só o RECORTE — período, aba, ordem —,
     nunca os valores: quem refaz a conta é a consulta `cartao_fatura` no servidor, e é
     assim que o número da resposta continua tendo procedência. */
  const meses = analise.meses;
  useContextoDaPagina(
    meses.length
      ? `Faturas do cartão de crédito à vista: ${meses.map((m) => m.label).join(", ")} ` +
        `(${meses.length}). Última fatura do recorte: ${meses[meses.length - 1].label}. ` +
        `Aba: ${ABAS.find(([v]) => v === aba)?.[1]}.` +
        (aba !== "detalhe" && ordem !== "total"
          ? ` Ordenado por ${ORDENS.find((o) => o.valor === ordem)?.rotulo}.`
          : "")
      : "Tela do cartão de crédito, sem fatura no período selecionado.",
  );

  const marcar = useCallback(async (chave: string, marcado: boolean, nota: string) => {
    const { error } = await db.rpc("cartao_marcar", {
      p_estabelecimento: chave, p_marcado: marcado, p_nota: nota || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(marcado ? `${chave} marcado para revisão.` : `${chave} desmarcado.`);
    carregarMarcacoes();
  }, [carregarMarcacoes]);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    await Promise.all([carregarFaturas(), carregarMarcacoes(), carregarLancamentos(de, ate)]);
    setCarregando(false);
  }, [carregarFaturas, carregarMarcacoes, carregarLancamentos, de, ate]);

  /* ---- export ------------------------------------------------------
     Espelha as abas do Excel que a própria skill gera, para quem já usa
     aquele arquivo não ter de reaprender onde está cada coisa. */
  const baixarExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const meses = analise.meses;

    const resumo = [
      ["Indicador", ...meses.map((m) => m.label)],
      ["Total de gastos", ...analise.kpis.map((k) => k.gastos)],
      ["Nº de lançamentos", ...analise.kpis.map((k) => k.lancamentos)],
      ["Ticket médio", ...analise.kpis.map((k) => k.ticket)],
      ["Pagamentos de boleto", ...analise.kpis.map((k) => k.pagamentos)],
      ["Estornos", ...analise.kpis.map((k) => k.estornos)],
      [],
      ["Leitura rápida"],
      ...analise.leitura.map((l) => [l]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), "Resumo");

    const matriz = (linhas: typeof analise.estabelecimentos, rotulo: string) => [
      [rotulo, "Categoria", ...meses.map((m) => m.label), "Total período", "Δ últ−1º", "Δ% últ−1º", "Δ últ−pen", "Δ% últ−pen"],
      ...linhas.map((l) => [
        l.chave, l.sub ?? "", ...l.porMes, l.total,
        l.deltaPrimeiro, l.pctPrimeiro ?? "novo", l.deltaPenultimo, l.pctPenultimo ?? "novo",
      ]),
    ];
    XLSX.utils.book_append_sheet(
      wb, XLSX.utils.aoa_to_sheet(matriz(analise.estabelecimentos, "Estabelecimento")), "Evolução Estabelecimento",
    );
    XLSX.utils.book_append_sheet(
      wb, XLSX.utils.aoa_to_sheet(matriz(analise.categorias, "Categoria")), "Evolução Categoria",
    );

    for (const m of meses) {
      const linhas = lancamentos.filter((l) => l.competencia === m.competencia && l.tipo === "gasto");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(linhas.map((l) => ({
          Data: l.data, Estabelecimento: l.estabelecimento, Categoria: l.categoria,
          "Descrição original": l.descricao, Parcela: l.parcela, Cidade: l.cidade, "Gasto R$": l.valor,
        }))),
        `Gastos ${m.label}`.replace("/", "-").slice(0, 31),
      );
    }

    const creditos = lancamentos.filter((l) => l.tipo !== "gasto");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(creditos.map((l) => ({
        Data: l.data, Fatura: l.competencia, Descrição: l.descricao ?? l.estabelecimento,
        Tipo: l.tipo, "Valor R$": l.valor,
      }))),
      "Créditos e Pagamentos",
    );

    const nome = meses.length
      ? `Cartao_${meses[0].label}_a_${meses[meses.length - 1].label}`.replace(/\//g, "")
      : "Cartao";
    XLSX.writeFile(wb, `${nome}.xlsx`);
  }, [analise, lancamentos]);

  /* ---------------------------------------------------------------- */

  if (carregando && !faturas.length) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando faturas…
      </div>
    );
  }

  if (!faturas.length) return <SemFatura />;

  const ultimo = analise.ultimo;
  const marcadosNoPeriodo = analise.estabelecimentos.filter((e) => mapaMarcacoes.has(e.chave)).length;

  return (
    <div className="space-y-5 p-5">
      {/* ---- cabeçalho ---- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow">Hub Financeiro · Governança</div>
          <h1 className="mt-0.5 text-3xl font-bold tracking-tight">Cartão</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Evolução das faturas do cartão corporativo · leitura das faturas OFX processadas pela skill.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SeletorPeriodo rotulo="De" valor={de} faturas={faturas} limite={{ max: ate }} onChange={setDe} />
          <span className="text-muted-foreground">→</span>
          <SeletorPeriodo rotulo="Até" valor={ate} faturas={faturas} limite={{ min: de }} onChange={setAte} />
          <Button variant="outline" size="sm" className="h-9" onClick={recarregar} disabled={carregando}>
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" className="h-9" onClick={baixarExcel}>
            <Download className="h-4 w-4" /> Baixar Excel
          </Button>
        </div>
      </div>

      {/* ---- hero + destaques ---- */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="card-surface p-4 sm:p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow">
                {ultimo ? `Fatura de ${ultimo.label} · o que mudou` : "Sem fatura no período"}
              </div>
              <div className="num mt-1 text-[38px] font-bold leading-none tracking-tight">
                {fmtBRL(ultimo?.gastos ?? 0)}
              </div>
              {analise.penultimo && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold",
                      analise.deltaUltimo > 0 ? "bg-neg-soft text-neg" : analise.deltaUltimo < 0 ? "bg-pos-soft text-pos" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {analise.deltaUltimo > 0 ? "↑" : analise.deltaUltimo < 0 ? "↓" : "="} {pctStr(analise.pctUltimo)}
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {analise.deltaUltimo >= 0 ? "+" : "−"}
                    {fmtBRLStr(Math.abs(analise.deltaUltimo))} vs {analise.penultimo.label}
                  </span>
                </div>
              )}
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CreditCard className="h-4.5 w-4.5" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-3 sm:grid-cols-4">
            <MiniKpi rotulo="Lançamentos" valor={intStr(ultimo?.lancamentos ?? 0)} />
            <MiniKpi rotulo="Ticket médio" valor={fmtBRL(ultimo?.ticket ?? 0)} />
            <MiniKpi rotulo="Total do período" valor={abrev(analise.totalPeriodo)} />
            <MiniKpi
              rotulo="Pagamentos / estornos"
              valor={<>{abrev(analise.pagamentosPeriodo)} <span className="text-muted-foreground">/</span> {abrev(analise.estornosPeriodo)}</>}
            />
          </div>

          <GastoPorFatura analise={analise} />
        </div>

        <div className="card-surface flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-[13px] font-bold">Destaques da última fatura</span>
            <span className="text-[10.5px] text-muted-foreground">gerado dos dados</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {analise.destaques.length ? (
              analise.destaques.map((d, i) => (
                <InsightCard key={i} severity={d.nivel} time={d.tag} title={d.titulo} description={d.detalhe} />
              ))
            ) : (
              <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
                Nada fora da curva nesta fatura.
              </p>
            )}
          </div>
        </div>
      </div>

      <Categorias analise={analise} />

      {/* ---- matrizes ---- */}
      <div className="card-surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex rounded-md border border-border bg-card p-0.5">
            {ABAS.map(([v, rot, Icon]) => (
              <button
                key={v}
                onClick={() => setAba(v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition",
                  aba === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {rot}
              </button>
            ))}
          </div>

          {aba !== "detalhe" && analise.meses.length >= 2 && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">realce</span>
                <Select value={realce} onValueChange={(v) => setRealce(v as Realce)}>
                  <SelectTrigger className="h-7 w-[135px] text-[11.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="penultimo">Δ vs mês ant.</SelectItem>
                    <SelectItem value="primeiro">Δ vs 1º mês</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Ordena pela coluna Δ realçada — por isso os dois controles ficam
                  juntos: trocar o realce troca a variação que manda na ordem. */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">ordenar por</span>
                <Select value={ordem} onValueChange={(v) => setOrdem(v as Ordem)}>
                  <SelectTrigger
                    className="h-7 w-[150px] text-[11.5px]"
                    title="Maior variação usa o módulo: sobe quem mais mexeu, para cima ou para baixo"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDENS.map((o) => (
                      <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-3 text-[11.5px] text-muted-foreground">
            {marcadosNoPeriodo > 0 && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <Flag className="h-3 w-3 fill-current" /> {marcadosNoPeriodo} marcado{marcadosNoPeriodo > 1 ? "s" : ""}
              </span>
            )}
            <span>
              {analise.estabelecimentos.length} estabelecimentos · {analise.categorias.length} categorias ·{" "}
              {analise.meses.length} faturas
            </span>
          </div>
        </div>

        {aba === "detalhe" ? (
          <Detalhe lancamentos={lancamentos} meses={analise.meses} />
        ) : (
          <Matriz
            analise={analise}
            modo={aba}
            realce={realce}
            ordem={ordem}
            marcacoes={mapaMarcacoes}
            onMarcar={marcar}
          />
        )}
      </div>

      {/* ---- leitura rápida ---- */}
      {analise.leitura.length > 0 && (
        <div className="card-surface p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[15px] font-bold tracking-tight">Leitura rápida</span>
            <span className="text-[11px] text-muted-foreground">
              {analise.meses[0]?.label} → {analise.meses[analise.meses.length - 1]?.label} · {analise.meses.length} faturas
            </span>
          </div>
          <ul className="grid gap-x-8 gap-y-2 md:grid-cols-2">
            {analise.leitura.map((l, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/90">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="px-1 text-[11.5px] text-muted-foreground">
        Valores em milhares nas matrizes; o número cheio aparece ao passar o mouse e na aba de detalhe. A bandeirinha
        marca o estabelecimento para revisão e o leva para os destaques.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MiniKpi({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow">{rotulo}</div>
      <div className="num mt-1 text-[14px] font-semibold leading-tight">{valor}</div>
    </div>
  );
}

function SeletorPeriodo({
  rotulo, valor, faturas, limite, onChange,
}: {
  rotulo: string;
  valor: string;
  faturas: Fatura[];
  limite: { min?: string; max?: string };
  onChange: (v: string) => void;
}) {
  const opcoes = faturas.filter(
    (f) => (!limite.min || f.competencia >= limite.min) && (!limite.max || f.competencia <= limite.max),
  );
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</span>
      <Select value={valor} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-[105px] text-[12.5px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {opcoes.map((f) => (
            <SelectItem key={f.competencia} value={f.competencia}>{f.mes_label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Barras do gasto por fatura. Feito à mão em vez de Recharts porque o que
 * importa aqui é o rótulo em cima de cada barra e a última destacada — com sete
 * colunas fixas, o layout é mais previsível assim do que configurando eixos.
 */
function GastoPorFatura({ analise }: { analise: ReturnType<typeof analisar> }) {
  if (analise.kpis.length < 2) return null;
  const max = Math.max(...analise.kpis.map((k) => k.gastos), 1);

  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="eyebrow">
          Gasto por fatura · {analise.meses[0]?.label} → {analise.meses[analise.meses.length - 1]?.label}
        </span>
        <span className="text-[10.5px] text-muted-foreground">em milhares de R$</span>
      </div>
      <div className="flex h-[150px] items-end gap-1.5">
        {analise.kpis.map((k, i) => {
          const ultimo = i === analise.kpis.length - 1;
          return (
            <div key={k.competencia} className="flex h-full flex-1 flex-col justify-end gap-1">
              <div className="num text-center text-[11px] font-semibold" title={fmtBRLStr(k.gastos)}>
                {milStr(k.gastos)}
              </div>
              <div
                className={cn("w-full rounded-t-[3px] transition-all", ultimo ? "bg-primary" : "bg-primary/20")}
                style={{ height: `${Math.max(2, (k.gastos / max) * 100)}%` }}
                title={`${k.label}: ${fmtBRLStr(k.gastos)}`}
              />
              <div className="text-center text-[10.5px] text-muted-foreground">{k.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Estado vazio: a tela não tem como se alimentar sozinha, então explica o caminho. */
function SemFatura() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-5">
      <div className="card-surface max-w-lg p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Upload className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold tracking-tight">Nenhuma fatura importada ainda</h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
          Suba os arquivos <span className="font-medium text-foreground">.ofx</span> das faturas no Claude e peça a
          análise do cartão. A skill lê os arquivos, normaliza os estabelecimentos e grava os lançamentos aqui — esta
          tela monta os números a partir deles.
        </p>
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          As faturas ficam em <span className="font-mono">Desktop\Faturas_Cartão_Sicoob</span>.
        </p>
      </div>
    </div>
  );
}
