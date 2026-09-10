import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  TrendingUp, Search, Download, Loader2, Lock, AlertTriangle, ArrowUpRight,
  ArrowDownRight, Minus, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, Filter,
  FilterX, ChevronDown, History, Maximize2, Minimize2, UserSearch, Users, Check,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkline } from "@/components/ui/sparkline";
import { KpiCard } from "@/components/ui/kpi-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  abasDaPlanilha, compararComPares, competenciasFechadas, custoNoAno, custoPorArea,
  degrausDoFixo, faixaVazia, foraDaLinha,
  filtrarPessoas, filtrarPorFaixa, filtrosLigados, montarLinhas, ordenarLinhas,
  pessoasSemTime, quemOFiltroEscondeu, semReajusteHaMaisTempo,
  recortarAte, resumoDaPessoa, rotuloMes, totaisDoMes, ultimaCompetenciaFechada,
  FILTROS_VAZIOS,
  type ColunaFaixa, type ColunaOrdenavel, type Faixa, type FaixaDeCargo, type Filtros,
  type Ordem, type PainelRemuneracao, type Pares, type PessoaRemuneracao, type PessoaSemTime,
} from "@/lib/remuneracao";
import { normalize } from "@/lib/normalize";

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

/**
 * "2 anos e 1 mês". Vazio quando a data de início não parseia.
 *
 * `ate` é o fim do mês em foco, não hoje: em dezembro/25 quem entrou em
 * abril/26 não tinha oito meses de casa negativos, não tinha casa nenhuma.
 */
function tempoDeCasaStr(inicio: string | null, ate: Date): string {
  const d = parseISO(inicio);
  if (!d) return "—";
  const meses = mesesDeCasa(d, ate);
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

/* ─────────────────────────── Cabeçalho da tabela ───────────────────────────
   Cada coluna numérica ordena e filtra por faixa. Antes a lista vinha ordenada
   por fixo e ponto: achar "quem está há mais tempo sem reajuste" ou "quem ganha
   entre 3 e 5 mil" exigia exportar e abrir no Excel. */

type Coluna = {
  rotulo: string;
  ordenar?: ColunaOrdenavel;
  faixa?: ColunaFaixa;
  /** Sufixo da caixinha de faixa: "R$" para dinheiro, "m" para meses. */
  unidade?: string;
  classe?: string;
  alinhaDireita?: boolean;
};

/**
 * As colunas, com o mês em foco no rótulo.
 *
 * "Fixo hoje" ao lado de um seletor em dezembro/25 é a mentira que originou
 * esta mudança: o número que aparece é o do mês escolhido, e o cabeçalho tem de
 * dizer isso. No presente ele continua sendo "hoje", que é como se fala.
 */
const colunasDe = (mes: string | null, presente: boolean): Coluna[] => {
  const quando = presente ? "hoje" : `em ${rotuloMes(mes ?? "")}`;
  return [
    { rotulo: "Pessoa", ordenar: "nome" },
    { rotulo: "Tempo de casa", ordenar: "tempoDeCasa", faixa: "tempoDeCasa", unidade: "meses",
      classe: "hidden md:table-cell" },
    { rotulo: `Fixo ${quando}`, ordenar: "fixo", faixa: "fixo", unidade: "R$", alinhaDireita: true },
    { rotulo: "Variável médio", ordenar: "variavel", faixa: "variavel", unidade: "R$",
      alinhaDireita: true, classe: "hidden lg:table-cell" },
    { rotulo: "Contra os pares", ordenar: "contraPares", faixa: "contraPares", unidade: "R$",
      alinhaDireita: true, classe: "hidden xl:table-cell" },
    { rotulo: "Último reajuste", ordenar: "ultimoReajuste", alinhaDireita: true },
    { rotulo: "Sem reajuste", ordenar: "semReajuste", faixa: "semReajuste", unidade: "meses",
      alinhaDireita: true, classe: "hidden sm:table-cell" },
    { rotulo: "Evolução", classe: "hidden xl:table-cell w-[90px]" },
  ];
};

/** Cabeçalho de uma coluna: ordena ao clicar, e abre o funil quando tem faixa. */
function CabecalhoColuna({ col, ordem, onOrdenar, faixa, onFaixa }: {
  col: Coluna;
  ordem: Ordem;
  onOrdenar: (c: ColunaOrdenavel) => void;
  faixa?: Faixa;
  onFaixa: (c: ColunaFaixa, f: Faixa) => void;
}) {
  const ativa = col.ordenar && ordem.coluna === col.ordenar;
  const comFiltro = !faixaVazia(faixa);
  return (
    <div className={cn("flex items-center gap-1", col.alinhaDireita && "justify-end")}>
      {col.ordenar ? (
        <button
          type="button"
          onClick={() => onOrdenar(col.ordenar!)}
          className="inline-flex items-center gap-1 hover:text-foreground"
          title={`Ordenar por ${col.rotulo}`}
        >
          {col.rotulo}
          {ativa
            ? (ordem.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)
            : <ArrowUpDown className="h-3 w-3 opacity-25" />}
        </button>
      ) : col.rotulo}

      {col.faixa && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn("rounded p-0.5 hover:bg-secondary",
                comFiltro ? "text-primary" : "text-muted-foreground/40")}
              title={comFiltro ? "Faixa aplicada" : `Filtrar ${col.rotulo}`}
            >
              <Filter className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3" align="end">
            <p className="text-xs font-medium">{col.rotulo}</p>
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number" placeholder="mín." className="h-8 text-xs"
                value={faixa?.min ?? ""}
                onChange={(e) => onFaixa(col.faixa!, {
                  min: e.target.value === "" ? null : Number(e.target.value),
                  max: faixa?.max ?? null,
                })}
              />
              <span className="text-xs text-muted-foreground">a</span>
              <Input
                type="number" placeholder="máx." className="h-8 text-xs"
                value={faixa?.max ?? ""}
                onChange={(e) => onFaixa(col.faixa!, {
                  min: faixa?.min ?? null,
                  max: e.target.value === "" ? null : Number(e.target.value),
                })}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Em {col.unidade}. Deixe um lado vazio para “acima de” ou “até”.
            </p>
            {comFiltro && (
              <Button
                size="sm" variant="ghost" className="mt-2 h-7 w-full"
                onClick={() => onFaixa(col.faixa!, { min: null, max: null })}
              >
                Limpar esta coluna
              </Button>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Escolha de vários valores — usado em setor e cargo. */
function EscolherVarios({ rotulo, opcoes, escolhidos, onMudar }: {
  rotulo: string; opcoes: string[]; escolhidos: string[]; onMudar: (v: string[]) => void;
}) {
  const [busca, setBusca] = useState("");
  const visiveis = busca
    ? opcoes.filter((o) => normalize(o).includes(normalize(busca)))
    : opcoes;
  return (
    <Popover onOpenChange={(a) => !a && setBusca("")}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 justify-between gap-2 font-normal">
          {escolhidos.length === 0
            ? `Todos os ${rotulo.toLowerCase()}`
            : escolhidos.length === 1
              ? escolhidos[0]
              : `${escolhidos.length} ${rotulo.toLowerCase()}`}
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        {opcoes.length > 8 && (
          <Input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder={`Buscar ${rotulo.toLowerCase()}…`} className="mb-2 h-8 text-xs"
          />
        )}
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {visiveis.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-secondary">
              <Checkbox
                checked={escolhidos.includes(o)}
                onCheckedChange={(v) => onMudar(
                  v === true ? [...escolhidos, o] : escolhidos.filter((x) => x !== o),
                )}
              />
              <span className="truncate">{o}</span>
            </label>
          ))}
          {!visiveis.length && (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">Nada com esse nome.</p>
          )}
        </div>
        {escolhidos.length > 0 && (
          <Button size="sm" variant="ghost" className="mt-1 h-7 w-full" onClick={() => onMudar([])}>
            Limpar
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ─────────────────────────── A fila de classificação ───────────────────────────
   Quem tem pagamento e não tem time. São 99 fichas e R$ 2,4 milhões de história
   — gente que saiu antes de abr/2026 e nunca esteve no Portal RH, mais os
   favorecidos que o RH não cadastra.

   Elas não entram no recorte de líder nenhum enquanto não tiverem time, e essa
   ausência é silenciosa: o 2025 do Head de Operações aparece 29% menor sem que
   nada na tela diga que falta alguém. Por isso a classificação vive aqui, ao
   lado do número que ela conserta, e não numa planilha à parte.

   A SUGESTÃO NÃO SALVA SOZINHA. A área da categoria do Omie serve de palpite
   quando é inequívoca (Suporte, Onboarding, Sucesso, Marketing e Tecnologia se
   chamam igual nos dois vocabulários); "Comercial" não é setor — é Field Sales,
   Inside Sales ou Franquias, e essa é exatamente a informação que só uma pessoa
   tem. Sugerir ali entregaria o time de um líder para outro. */

function FilaSemTime({
  pessoas, setores, onFechar, onSalvo,
}: {
  pessoas: PessoaSemTime[];
  setores: string[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  /* O rascunho começa com as sugestões JÁ escolhidas — é o que transforma 99
     decisões em "confira e corrija as que estão erradas". Nada vai ao banco
     antes do clique em salvar. */
  const [escolha, setEscolha] = useState<Record<string, string>>(() =>
    Object.fromEntries(pessoas.filter((p) => p.sugestao).map((p) => [p.id, p.sugestao!])),
  );
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");

  const visiveis = useMemo(() => {
    const t = normalize(busca);
    if (!t) return pessoas;
    return pessoas.filter((p) => normalize(`${p.nome} ${p.areaPrincipal ?? ""}`).includes(t));
  }, [pessoas, busca]);

  const decididas = Object.values(escolha).filter(Boolean).length;
  const dinheiroDecidido = pessoas
    .filter((p) => escolha[p.id])
    .reduce((s, p) => s + p.total, 0);
  const dinheiroTotal = pessoas.reduce((s, p) => s + p.total, 0);

  const salvar = async () => {
    const alvo = Object.entries(escolha).filter(([, s]) => s);
    if (!alvo.length) return;
    setSalvando(true);
    /* Uma RPC e não 99 updates — e não um `upsert`, que pelo PostgREST exigiria
       mandar a linha inteira de volta (`chave` e `nome` são obrigatórios no
       insert) e transformaria uma classificação em reescrita. A função só toca a
       coluna `setor`, e confere a permissão do lado do servidor. */
    const { data, error } = await supabase.rpc("remuneracao_classificar", {
      p_itens: Object.fromEntries(alvo),
    });
    setSalvando(false);
    if (error) return toast.error(error.message);
    const n = Number(data ?? 0);
    toast.success(
      n === 0
        ? "Nada mudou — os times já estavam assim."
        : `${n} ficha${n > 1 ? "s" : ""} classificada${n > 1 ? "s" : ""}`,
    );
    onSalvo();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Quem está sem time</DialogTitle>
        </DialogHeader>

        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Estas {pessoas.length} fichas têm pagamento e não têm setor — quase todas são de gente
          que saiu antes de abr/2026 e nunca esteve no Portal RH. Sem time, elas ficam de fora do
          recorte de qualquer líder, e o histórico do time dele aparece menor do que foi.
          {" "}<strong className="font-medium text-foreground">A sugestão vem da categoria do
          Omie</strong> e só aparece quando o nome bate exatamente com um setor; “Comercial” fica
          em branco de propósito, porque só você sabe se é Field Sales, Inside Sales ou Franquias.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar por nome ou área…" className="h-8 pl-8 text-xs"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {decididas} de {pessoas.length} · {fmtBRLStr(dinheiroDecidido)} de {fmtBRLStr(dinheiroTotal)}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead className="hidden sm:table-cell">Quando</TableHead>
                <TableHead className="text-right">Custou</TableHead>
                <TableHead className="w-[190px]">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="py-2">
                    <div className="font-medium">{p.nome}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.areaPrincipal ?? "sem área na categoria"}
                      {!p.ehPessoa && " · balde de área, não é pessoa"}
                    </div>
                  </TableCell>
                  <TableCell className="hidden py-2 text-xs text-muted-foreground sm:table-cell">
                    {p.de ? rotuloMes(p.de) : "—"} → {p.ate ? rotuloMes(p.ate) : "—"}
                  </TableCell>
                  <TableCell className="py-2 text-right text-xs tabular-nums">
                    {fmtBRL(p.total)}
                  </TableCell>
                  <TableCell className="py-2">
                    <Select
                      value={escolha[p.id] ?? "__nenhum"}
                      onValueChange={(v) => setEscolha((e) => {
                        const novo = { ...e };
                        if (v === "__nenhum") delete novo[p.id]; else novo[p.id] = v;
                        return novo;
                      })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__nenhum">— deixar sem time —</SelectItem>
                        {setores.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {!visiveis.length && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    Nada com esse nome.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-3 sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            Fica gravado. A carga diária não apaga, e o Portal RH continua mandando em quem tem ficha.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onFechar} disabled={salvando}>Cancelar</Button>
            <Button size="sm" onClick={salvar} disabled={salvando || !decididas}>
              {salvando && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Salvar {decididas || ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * De onde veio cada lançamento, pelo nome que a pessoa reconhece.
 *
 * Só o Omie tem código que existe no ERP; nas outras fontes o `origem_ref` é
 * uma impressão digital deste repositório ("2024-01-05-12a1c9e5db06") e
 * estampá-la como "código no Omie" mandaria procurar por algo que não está lá.
 */
const FONTE: Record<string, { rotulo: string; ajuda: string }> = {
  conta_azul: {
    rotulo: "Conta Azul",
    ajuda: "Veio do export de contas a pagar do Conta Azul, antes da migração para o Omie. Não há título no ERP para procurar.",
  },
  manual: {
    rotulo: "lançado à mão",
    ajuda: "Gravado direto no Hub, sem título correspondente no ERP.",
  },
  nf_drive: {
    rotulo: "NF no Drive",
    ajuda: "Veio de uma nota fiscal lida do Drive, não de um título do Omie.",
  },
};

/* ─────────────────────────── Faixa por cargo ───────────────────────────
   A régua do time: cada cargo numa linha, com as pessoas posicionadas entre o
   menor e o maior fixo do PRÓPRIO cargo — não entre o menor e o maior da tela.
   Normalizar por cargo é o que faz a pergunta ser "quem está fora da linha dos
   pares", e não "quem ganha mais", que já é a ordenação da tabela.

   O caso que motivou o card: dois Product Designers com R$ 250 entre eles e 20
   meses de diferença de casa — a mais antiga é a que ganha menos. Sem esta
   leitura isso mora numa coluna da tabela e ninguém repara.

   Cargo com uma pessoa só não tem régua: mostra o valor e nada mais, porque uma
   bolinha sozinha numa barra sugere uma faixa que não existe. */

function FaixaPorCargo({ faixas, mes }: { faixas: FaixaDeCargo[]; mes: string | null }) {
  return (
    <div className="card-surface overflow-hidden p-4">
      <div className="eyebrow">Quem está fora da linha · {rotuloMes(mes ?? "")}</div>

      {!faixas.length ? (
        /* Nada aqui é BOA notícia, e a tela tem de dizer isso. Um bloco vazio
           sem explicação parece defeito; com ela, é o veredito. */
        <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center">
          <Check className="h-5 w-5 text-pos" />
          <p className="text-[12.5px] font-medium">Ninguém fora da linha.</p>
          <p className="max-w-[220px] text-[11px] leading-relaxed text-muted-foreground">
            Em todo cargo com mais de uma pessoa, todas ganham o mesmo fixo neste mês.
          </p>
        </div>
      ) : (
        <div className="mt-2 max-h-[210px] space-y-2.5 overflow-y-auto pr-1">
          {faixas.map((f) => {
            const amplitude = f.max - f.min;
            const piso = f.pessoas[0];
            const teto = f.pessoas[f.pessoas.length - 1];
            return (
              <div key={f.cargo}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium">{f.cargo}</span>
                  {/* A DIFERENÇA em reais é a manchete, não a faixa: é ela que
                      ordena o bloco e é ela que se leva para a conversa. */}
                  <span className="num shrink-0 text-[11px] font-medium">
                    {fmtBRL(amplitude)}
                    <span className="font-normal text-muted-foreground"> de diferença</span>
                  </span>
                </div>

                {/* A barra vai do menor ao maior DESTE cargo. Cada pessoa é um
                    traço na posição dela; quem está no piso encosta na esquerda,
                    quem está no teto na direita. */}
                <div className="relative mt-1.5 h-[18px]">
                  <div className="absolute inset-x-0 top-[8px] h-[3px] rounded-full bg-secondary" />
                  {f.pessoas.map((p) => (
                    <div
                      key={p.id}
                      className="absolute top-[3px] h-[13px] w-[3px] -translate-x-1/2 rounded-full bg-[hsl(var(--serie-fixo))]"
                      style={{ left: `${amplitude > 0 ? ((p.fixo - f.min) / amplitude) * 100 : 50}%` }}
                      title={`${p.nome} — ${fmtBRLStr(p.fixo)}${
                        p.tempoDeCasa != null ? ` · ${mesesEmTexto(p.tempoDeCasa)} de casa` : ""
                      }`}
                    />
                  ))}
                </div>

                {/* Piso e teto NOMEADOS, com o tempo de casa ao lado. É a
                    combinação que vira conversa: um piso de três anos de casa
                    não é o mesmo que um piso de três meses. */}
                <div className="mt-1 flex items-baseline justify-between gap-3 text-[10.5px]">
                  <span className="truncate text-muted-foreground">
                    <span className="num text-foreground">{fmtBRLStr(piso.fixo)}</span>{" "}
                    {piso.nome}
                    {piso.tempoDeCasa != null && ` · ${mesesEmTexto(piso.tempoDeCasa)}`}
                  </span>
                  <span className="shrink-0 truncate text-right text-muted-foreground">
                    {teto.nome}
                    {teto.tempoDeCasa != null && ` · ${mesesEmTexto(teto.tempoDeCasa)}`}{" "}
                    <span className="num text-foreground">{fmtBRLStr(teto.fixo)}</span>
                  </span>
                </div>
                {f.pessoas.length > 2 && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {f.pessoas.length} pessoas no cargo · mediana {fmtBRLStr(f.mediana)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground">
        Cargos com mais de uma pessoa e valores diferentes, do maior desvio para o menor.
        Fixo do mês, com pró-labore. A barra é a faixa do próprio cargo — não a da empresa.
      </p>
    </div>
  );
}

/** "20 meses" → "1a8m". O tempo de casa aparece ao lado de nome, e cabe pouco. */
function mesesEmTexto(meses: number): string {
  if (meses < 12) return `${meses}m`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  return `${anos}a${resto ? `${resto}m` : ""}`;
}

/* ─────────────────────────── Filtros ─────────────────────────── */

const FILTROS_PADRAO: Filtros = FILTROS_VAZIOS;

/* ─────────────────────────── Página ─────────────────────────── */

export default function Remuneracao() {
  const { profile, acesso } = useAuth();

  /* ESTA TELA TEM DUAS PORTAS.
     `remuneracao` abre a empresa inteira (financeiro, diretoria, RH).
     `remuneracao_time` abre a mesma tela recortada nos setores da ficha da
     conta — é o líder, e ele não tem as outras cinco telas de folha.
     Quem recorta de verdade é `remuneracao_painel()`, que devolve só as pessoas
     do escopo; daqui para baixo o `painel` JÁ vem recortado, e é por isso que
     nenhum KPI, gráfico ou exportação precisou saber que o líder existe. */
  const folha = acesso.folha;
  const podeVer = folha.tipo !== "nenhum";
  const vejoTudo = folha.tipo === "tudo";
  /* Líder com a capacidade e nenhum time marcado: o painel volta vazio e, sem
     isto, "nenhuma pessoa" seria indistinguível de "mês sem folha". Decidido
     pelo ACESSO e não pelo painel — é o que evita a busca que não traria nada. */
  const semRecorte = folha.tipo === "times" && folha.setores.length === 0;

  const [painel, setPainel] = useState<PainelRemuneracao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_PADRAO);
  /* Começa pelo fixo, do maior para o menor — é a leitura que responde "quanto
     custa cada um" sem ninguém pedir nada. */
  const [ordem, setOrdem] = useState<Ordem>({ coluna: "fixo", desc: true });

  // Clicar na coluna já ordenada inverte; noutra, começa decrescente (o maior
  // primeiro é o que se quer ver em valor) — menos em nome, onde A→Z é o natural.
  const ordenarPor = (coluna: ColunaOrdenavel) =>
    setOrdem((o) => o.coluna === coluna
      ? { coluna, desc: !o.desc }
      : { coluna, desc: coluna !== "nome" });

  const definirFaixa = (coluna: ColunaFaixa, f: Faixa) =>
    setFiltros((x) => ({ ...x, faixas: { ...x.faixas, [coluna]: f } }));
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

  // Sem times marcados não há o que buscar: a RPC devolveria uma lista vazia e a
  // tela mostraria "carregando" para chegar a lugar nenhum.
  useEffect(() => {
    if (podeVer && !semRecorte) void carregar(); else setCarregando(false);
  }, [podeVer, semRecorte]);

  /* O Omie tem coisa que a carga ainda não pegou. Não é erro — é a janela entre
     a sync do ERP e a carga diária —, mas quem está lendo precisa saber. */
  const atrasada =
    !!frescor?.carga_em && !!frescor?.omie_em && frescor.omie_em > frescor.carga_em;

  /* O RÓTULO DO RECORTE VEM DE QUEM RECORTOU.
     `acesso.folha` é a leitura do front e serve para decidir se busca; o que a
     tela ESCREVE é o `escopo` que `remuneracao_painel()` carimbou, porque é ele
     que mandou nas linhas que chegaram. Se os dois divergirem (ficha editada com
     a aba aberta), o cabeçalho continua descrevendo o que está na tela em vez de
     descrever o que o front achava que ia vir. */
  const meusTimes = painel?.escopo && !painel.escopo.tudo
    ? painel.escopo.setores ?? []
    : folha.tipo === "times" ? folha.setores : [];

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

  /* Estamos viajando no tempo? Só o mês PASSADO muda as regras da lista.
     O mês corrente (posterior à referência, com meia dúzia de avulsos já
     lançados) continua sendo "o agora": cobrar pagamento nele derrubaria como
     saída todo mundo que só recebeu no mês anterior — a empresa inteira. */
  const passado = !!mes && !!referencia && mes < referencia;

  /* Até onde a lista exige pagamento. No passado é o próprio mês em foco; no
     agora é o último fechado, aconteça o que acontecer com o corrente. */
  const referenciaDaLista = passado ? mes : referencia;

  /* A data que representa o mês em foco: hoje, quando se olha o agora (para o
     tempo de casa continuar contando os dias do mês corrente); o último dia do
     mês, quando se olha para trás. `new Date(ano, mes, 0)` é o dia 0 do mês
     seguinte, que é o último deste. */
  const dataDoFoco = useMemo(() => {
    if (!passado || !mes) return new Date();
    const [ano, m] = mes.split("-").map(Number);
    return new Date(ano, m, 0);
  }, [mes, passado]);

  const setores = useMemo(() => {
    const s = new Set<string>();
    for (const p of painel?.pessoas ?? []) if (p.setor) s.add(p.setor);
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [painel]);

  /* ── Quem está sem time ──
     Só para quem vê a folha inteira: é ele quem classifica, e a RLS de
     `remuneracao_pessoa` só o deixa gravar. O líder não vê este botão nem a
     lista — as fichas sem time simplesmente não chegam ao recorte dele.

     Os setores OFERECIDOS não são os que estão na tela (`setores` acima, que só
     tem quem já tem time): vêm de `remuneracao_setores()`, o vocabulário
     inteiro do Portal RH. Sem isso, um setor sem nenhuma ficha pendente sumiria
     da lista justo na hora de atribuir a primeira. */
  const [setoresConhecidos, setSetoresConhecidos] = useState<string[]>([]);
  const [classificando, setClassificando] = useState(false);

  useEffect(() => {
    if (!vejoTudo) return;
    void supabase.rpc("remuneracao_setores").then(({ data }) => {
      setSetoresConhecidos((data as string[] | null) ?? []);
    });
  }, [vejoTudo]);

  const semTime = useMemo(
    () => (vejoTudo ? pessoasSemTime(painel?.pessoas ?? [], setoresConhecidos) : []),
    [vejoTudo, painel, setoresConhecidos],
  );

  const cargos = useMemo(() => {
    const s = new Set<string>();
    for (const p of painel?.pessoas ?? []) if (p.cargo?.trim()) s.add(p.cargo.trim());
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [painel]);

  /* ── O recorte no tempo ──
     A série de cada pessoa cortada no mês em foco. É daqui que sai TUDO o que
     a lista mostra: quem aparece, quanto ganhava, há quanto tempo estava sem
     reajuste, onde caía entre os pares. Sem isto o seletor de mês mexia só nos
     KPIs — a lista era sempre a de hoje, e dezembro/25 aparecia com gente que
     só entrou em abril/26, ganhando o salário de agora. */
  const pessoasAteOFoco = useMemo(
    () => recortarAte(painel?.pessoas ?? [], mes),
    [painel, mes],
  );
  const mesesAteOFoco = useMemo(
    () => (mes ? meses.filter((m) => m <= mes) : meses),
    [meses, mes],
  );

  /* A comparação com os pares roda sobre TODAS as pessoas, não sobre o recorte
     de filtros: a mediana do cargo não muda porque alguém filtrou por setor, e
     recalcular por filtro faria o percentil da mesma pessoa dançar conforme a
     tela. O recorte no TEMPO ela respeita — comparar alguém de dezembro/25 com
     a mediana de agosto/26 mistura duas folhas diferentes.
     Fica ANTES da lista porque o filtro de faixa e a ordenação a usam. */
  const pares = useMemo(
    () => compararComPares(pessoasAteOFoco, mesesAteOFoco),
    [pessoasAteOFoco, mesesAteOFoco],
  );

  const pessoas = useMemo(
    () => filtrarPessoas(pessoasAteOFoco, filtros, referenciaDaLista, !passado),
    [pessoasAteOFoco, filtros, referenciaDaLista, passado],
  );

  /* Filtro de faixa e ordenação trabalham sobre o CALCULADO (fixo do mês,
     posição contra os pares, meses sem reajuste), por isso vêm depois do
     `montarLinhas` e não junto do filtro de pessoa. */
  const linhas = useMemo(
    () => ordenarLinhas(
      filtrarPorFaixa(montarLinhas(pessoas, pares, dataDoFoco), filtros.faixas),
      ordem,
    ),
    [pessoas, pares, dataDoFoco, filtros.faixas, ordem],
  );

  /* O que a faixa deixou passar — é este conjunto que vai para a exportação e
     para os totais, não o de antes do funil. */
  const pessoasVisiveis = useMemo(() => linhas.map((l) => l.pessoa), [linhas]);

  const colunas = useMemo(() => colunasDe(mes, !passado), [mes, passado]);

  /* ── O período inteiro, sem recorte no tempo ──
     O KPI do mês, o gráfico e a tabela por área NÃO usam a lista da tabela.

     A lista responde "quem estava aqui no mês em foco" e por isso esconde quem
     saiu; o custo de agosto, não — quem foi pago em agosto custou em agosto,
     mesmo tendo saído no dia 20. Com o filtro da lista o KPI dizia R$ 508.072
     para um mês que fechou em R$ 557.737, e um número rotulado "custo de
     pessoas" tem de bater com a DRE.

     E sem o corte no tempo porque gráfico e tabela por área são SÉRIES: escolher
     dezembro/25 não pode apagar o resto do ano do gráfico — é olhando a série
     inteira que se decide qual mês olhar. O KPI continua certo porque
     `totaisDoMes` pesca a competência exata.

     Busca, setor e cargo continuam valendo ("custo de Tecnologia em agosto" é
     uma pergunta legítima), e as faixas também: filtrar "fixo acima de 10 mil"
     e ver o custo da empresa inteira em cima de uma lista curta seria mentira.

     `incluirNaoPessoas` é forçado pelo mesmo motivo que `incluirSaidas`: quem
     não é gente também custou. Em 2024 o extrato escreveu o time no lugar do
     nome em 83 linhas, que viraram balde de área — e por elas ficarem de fora,
     o KPI dizia R$ 96.751 num março/2024 que custou R$ 114.116. A caixa
     "Incluir empresas" segue mandando na LISTA, que é sobre pessoas; não no
     custo, que é sobre dinheiro. */
  const pessoasDoPeriodo = useMemo(
    () => filtrarPorFaixa(
      montarLinhas(
        filtrarPessoas(
          painel?.pessoas ?? [],
          { ...filtros, incluirSaidas: true, incluirNaoPessoas: true },
          referencia,
        ),
        pares,
        dataDoFoco,
      ),
      filtros.faixas,
    ).map((l) => l.pessoa),
    [painel, filtros, referencia, pares, dataDoFoco],
  );

  const totais = useMemo(
    () => (mes ? totaisDoMes(pessoasDoPeriodo, mes) : null),
    [pessoasDoPeriodo, mes],
  );

  /* Quantos foram pagos no mês mas não estão na lista dele — em geral a
     rescisão de quem já ia embora. É a diferença entre o custo real do mês e o
     time que ele tinha, dita em voz alta em vez de sumir na conta. */
  const saidasNoMes = useMemo(
    () => (mes ? totais!.gente - totaisDoMes(pessoasVisiveis, mes).gente : 0),
    [totais, pessoasVisiveis, mes],
  );

  /* ── Onde as séries param ──
     No último mês FECHADO, e não no mês mais novo da base. O corrente entra
     com meia dúzia de títulos avulsos e folha nenhuma: no fim de cada sparkline
     ele virava um despenhadeiro que parece corte de custo e é só mês que ainda
     não aconteceu — e na barra do topo, uma coluna vazia com rótulo.

     Só os GRÁFICOS param aqui. O seletor de mês continua oferecendo o corrente
     para quem quiser ver os avulsos, e a contagem de gente segue o mês em foco
     esteja ele na série ou não — `custoPorArea` conta por competência. */
  const mesesDaSerie = useMemo(
    () => (referencia ? meses.filter((m) => m <= referencia) : meses),
    [meses, referencia],
  );

  /* Quais meses já tiveram o VARIÁVEL lançado, medido na empresa inteira.
     Calculado aqui, e não dentro da planilha, porque exportar uma pessoa só
     media a pergunta na comissão dela: um mês em que ela não vendeu virava
     "mês não fechado" para todo mundo. */
  const fechadasDoPainel = useMemo(
    () => competenciasFechadas(painel?.pessoas ?? [], meses),
    [painel, meses],
  );

  /* A série é do período inteiro, mas a contagem de gente é do mês em foco —
     pelo último mês da série ela era a do corrente, e toda área da tela dizia
     "0 no último mês". */
  const areas = useMemo(
    () => custoPorArea(pessoasDoPeriodo, mesesDaSerie, mes),
    [pessoasDoPeriodo, mesesDaSerie, mes],
  );

  /* Quanto a folha custou NO ANO até o mês em foco. Vai embaixo do custo do mês,
     no mesmo card: a pergunta "e no ano?" vem imediatamente depois de "quanto
     custou este mês", e hoje ela exigia somar doze barras do gráfico à mão.
     Mesmo conjunto do KPI (`pessoasDoPeriodo`), então os dois números falam da
     mesma folha. */
  const noAno = useMemo(
    () => (mes ? custoNoAno(pessoasDoPeriodo, mes) : null),
    [pessoasDoPeriodo, mes],
  );

  /* ── O que ficou no lugar de "Fichas do RH" e "Por área" na visão de líder ──
     Aquela é pendência do RH, que um Head não resolve; esta é dele. E a tabela
     por área, num recorte de um time, dizia "Tecnologia 6, Administrativo 0" com
     uma variação de +798% que só significava que o time não existia em dez/23.

     As duas leem `linhas` — o recorte JÁ filtrado e ordenado da tela —, não o
     painel cru: "sem reajuste" e "faixa do cargo" são leituras de quem está na
     lista, e responder sobre gente que o filtro tirou seria responder outra
     pergunta. */
  /* Quem casaria com a busca se as caixas de conjunto estivessem ligadas —
     calculado sobre o MESMO recorte no tempo de onde sai a lista, senão a
     mensagem prometeria gente que o mês em foco não tem. */
  const escondidos = useMemo(
    () => quemOFiltroEscondeu(pessoasAteOFoco, filtros, referenciaDaLista, !passado),
    [pessoasAteOFoco, filtros, referenciaDaLista, passado],
  );

  const semReajuste = useMemo(() => semReajusteHaMaisTempo(linhas), [linhas]);
  /* `foraDaLinha` e não `faixaPorCargo`: a régua completa, num time pequeno,
     ficava com uma barra e quatro linhas de "uma pessoa só". O que se veio ver
     são os cargos onde HÁ diferença — e não haver nenhuma é uma resposta, não
     um bloco vazio. */
  const faixas = useMemo(
    () => (mes ? foraDaLinha(linhas, mes) : []),
    [linhas, mes],
  );

  /* A série do gráfico do topo: o custo do período, decomposto nas mesmas três
     séries da ficha. `iso` viaja junto do rótulo para a barra saber que mês ela
     é quando alguém clica nela. */
  const serieDoCusto: LinhaGrafico[] = useMemo(
    () => mesesDaSerie.map((m) => {
      const t = totaisDoMes(pessoasDoPeriodo, m);
      return {
        iso: m,
        mes: rotuloMes(m),
        fixo: t.fixo, prolabore: t.prolabore, variavel: t.premiacao, escala: t.escala,
        total: t.total, reajuste: null,
      };
    }),
    [pessoasDoPeriodo, mesesDaSerie],
  );

  const seriesDoCusto = useMemo(() => seriesPresentes(serieDoCusto), [serieDoCusto]);

  /* Quantos têm a ficha do RH atrasada em relação ao que o Omie pagou. É a
     pendência que esta tela devolve para o RH — e ela é do PRESENTE, sempre:
     `valor_contrato` é o contrato de hoje, e medi-lo contra o pagamento de um
     mês passado acusaria como "atraso" todo reajuste dado depois dele. */
  const fichasAtrasadas = useMemo(
    () => filtrarPessoas(painel?.pessoas ?? [], filtros, referencia)
      .filter((p) => Math.abs(resumoDaPessoa(p, referencia).divergenciaContrato ?? 0) >= 1).length,
    [painel, filtros, referencia],
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
    /* Quem sai da tela sai com a HISTÓRIA INTEIRA, mesmo com um mês passado em
       foco: a lista é recortada no tempo, mas uma planilha que parasse em
       dezembro/25 sem dizer nada seria uma armadilha — quem abre espera o
       histórico da pessoa, não o do que estava na tela. Por isso os ids
       voltam ao painel cru. */
    const ids = quem
      ? new Set(quem.map((p) => p.id))
      : selecionadas.size
        ? selecionadas
        : new Set(pessoasVisiveis.map((p) => p.id));
    const alvo = (painel.pessoas ?? []).filter((p) => ids.has(p.id));
    if (!alvo.length) return;

    const wb = XLSX.utils.book_new();

    /* A aba "Por área" ganha uma coluna por mês desta lista, e é dela que sai a
       Variação % — a mesma que a tela mostra. Passar o mês corrente aqui daria
       uma coluna de avulsos e uma variação negativa que contradiz o card ao
       lado. As linhas do "Mês a mês" continuam vindo da pessoa: o corrente
       aparece lá, marcado como mês não fechado. */
    /* `referencia` e `fechadas` vêm do PAINEL, não de `alvo`. Deduzidos do
       recorte exportado, uma pessoa só que saiu em julho/25 virava a própria
       referência: o acerto de contas dela reaparecia na planilha como
       "reajuste em jul/25", numa linha que a tela mostra como "nenhum". */
    for (const aba of abasDaPlanilha(alvo, mesesDaSerie, pares, referencia, fechadasDoPainel)) {
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
          Esta tela mostra quanto cada pessoa ganha. Ela abre inteira para o financeiro, a
          diretoria e o RH, e recortada no próprio time para quem lidera um. Fale com o
          financeiro se você precisa dela.
        </p>
      </div>
    );
  }

  /* ── Líder sem times marcados ──
     A capacidade está ligada e o recorte, vazio. Sem este aviso a tela abriria
     com zero pessoas e zero reais, indistinguível de um mês sem folha — e a
     pessoa concluiria que o painel está quebrado, não que falta um cadastro. */
  if (semRecorte) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
          <Users className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">Seu recorte ainda não foi definido</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Você tem acesso à folha do seu time, mas nenhum time está marcado na sua ficha —
          então ainda não há ninguém para mostrar. O financeiro define os times em
          Configurações › Usuários.
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
          {/* O RECORTE, DITO EM VOZ ALTA. Um custo de R$ 1,1 M sem esta linha
              parece o da empresa; é o de três times. Quem vê tudo não ganha
              rótulo nenhum — dizer "empresa inteira" a quem sempre viu tudo é
              ruído. */}
          {!vejoTudo && meusTimes.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>Seu time:</span>
              {meusTimes.map((s) => (
                <Badge key={s} variant="secondary" className="font-normal">{s}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Classificar quem está sem time é do financeiro, e só aparece quando
              há fila. O líder não vê: as fichas sem time nem chegam a ele. */}
          {/* `setoresConhecidos` na condição, e não só na fila: abrir o diálogo
              antes de a lista de times chegar daria seletores vazios e nenhuma
              sugestão — o rascunho é montado uma vez, na abertura. */}
          {vejoTudo && semTime.length > 0 && setoresConhecidos.length > 0 && (
            <Button
              variant="outline" size="sm"
              onClick={() => setClassificando(true)}
              title="Fichas com pagamento e sem setor — elas ficam fora do recorte de qualquer líder"
            >
              <UserSearch className="mr-1.5 h-3.5 w-3.5" />
              Sem time · {semTime.length}
            </Button>
          )}
          {/* Recarregar do Omie é de quem responde pela folha inteira. A RPC
              recusaria o líder de qualquer jeito (`remuneracao_atualizar` exige
              `pode_ver_remuneracao()`); esconder o botão evita o erro. */}
          {vejoTudo && (
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
          )}
          <Button
            size="sm"
            onClick={() => exportar()}
            disabled={!painel || (!pessoasVisiveis.length && !selecionadas.size)}
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
              {vejoTudo
                ? " clique em “Recarregar do Omie” para trazer agora."
                : " o financeiro pode trazer agora, se você precisar do número de hoje."}
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
                /* O acumulado do ano logo abaixo do mês: é a pergunta seguinte,
                   e somá-la à mão exigia ler doze barras do gráfico. Ano-
                   calendário do mês em foco — em dez/25 é 2025, não os últimos
                   doze meses. */
                subline={noAno && noAno.meses > 0
                  ? <>no ano até {rotuloMes(mes)}: {fmtBRL(noAno.total)}
                      <span className="text-muted-foreground"> · {noAno.meses} {noAno.meses === 1 ? "mês" : "meses"}</span></>
                  : undefined}
                stats={[
                  { label: "Fixo", value: fmtBRL(totais.fixo) },
                  { label: "Variável", value: fmtBRL(totais.premiacao) },
                  { label: "Escala", value: fmtBRL(totais.escala) },
                ]}
                footnote="Tudo o que a folha custou no mês: inclui quem foi pago nele e depois saiu, e as linhas em que o extrato escreveu o time no lugar do nome."
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
              {/* O QUARTO CARD MUDA COM O PÚBLICO.
                  Quem vê a empresa inteira (financeiro, diretoria, RH) fica com
                  a pendência do RH — lá ela tem dono e alguém a conserta. O
                  líder fica com o tempo sem reajuste, que é o que ELE resolve:
                  a ficha desatualizada de outra pessoa não é ação dele, e um
                  card que não vira ação vira ruído. */}
              {vejoTudo ? (
                <KpiCard
                  label="Fichas do RH atrasadas"
                  value={String(fichasAtrasadas)}
                  valueTone={fichasAtrasadas > 0 ? "neg" : "neutral"}
                  subline="contrato no RH ≠ pago no Omie"
                  footnote="O Omie manda. A ficha é que precisa ser corrigida."
                />
              ) : (
                <KpiCard
                  label="Mais tempo sem reajuste"
                  value={semReajuste ? `${semReajuste.meses} ${semReajuste.meses === 1 ? "mês" : "meses"}` : "—"}
                  valueTone={semReajuste && semReajuste.meses >= semReajuste.limiar ? "neg" : "neutral"}
                  subline={semReajuste
                    ? <>{semReajuste.nome}{semReajuste.cargo ? ` · ${semReajuste.cargo}` : ""}</>
                    : "ninguém do time tem histórico de reajuste ainda"}
                  footnote={semReajuste
                    ? (semReajuste.acimaDoLimiar > 0
                        ? `${semReajuste.acimaDoLimiar} ${semReajuste.acimaDoLimiar === 1 ? "pessoa passou" : "pessoas passaram"} de ${semReajuste.limiar} meses sem reajuste.`
                        : `Ninguém passou de ${semReajuste.limiar} meses.`)
                    : "Quem nunca teve reajuste não entra: está no primeiro salário, não parado."}
                />
              )}
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
                {/* Clicar numa barra põe aquele mês em foco: é o caminho curto
                    entre "esse mês está estranho" e ver quem estava lá. */}
                <div className="mt-3 h-[190px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={serieDoCusto} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}
                      barCategoryGap="24%" className="cursor-pointer"
                      onClick={(e) => {
                        const iso = (e?.activePayload?.[0]?.payload as LinhaGrafico | undefined)?.iso;
                        if (iso) setMesFoco(iso);
                      }}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.6} />
                      <XAxis dataKey="mes" tickLine={false} axisLine={false}
                             tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tickLine={false} axisLine={false} width={46}
                             tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                             tickFormatter={emMilStr} />
                      <Tooltip cursor={{ fill: "hsl(var(--secondary))", opacity: 0.5 }} content={<Dica />} />
                      {seriesDoCusto.map((s) => (
                        <Bar key={s.chave} dataKey={s.chave} stackId="a" fill={s.cor}
                             shape={Segmento(s.chave, mes)} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* O BLOCO DA DIREITA TAMBÉM MUDA COM O PÚBLICO.
                  "Por área" só diz alguma coisa com a empresa inteira, onde há
                  nove áreas e cada uma tem curva. Recortado num time, virava
                  "Tecnologia 6, Administrativo 0, Onboarding 0" com um +798% que
                  só significava que o time não existia em dez/23. No lugar dele,
                  a régua dos cargos DO TIME — que é a pergunta que um Head faz
                  olhando a folha: quem está fora da linha do próprio cargo. */}
              {!vejoTudo ? (
                <FaixaPorCargo faixas={faixas} mes={mes} />
              ) : (
              <div className="card-surface overflow-hidden p-4">
                <div className="eyebrow">
                  Por área · {rotuloMes(mesesDaSerie[0])} a{" "}
                  {rotuloMes(mesesDaSerie[mesesDaSerie.length - 1])}
                </div>
                <div className="mt-2 max-h-[210px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {areas.map((a) => (
                        <tr key={a.area} className="border-b border-border/30 last:border-0">
                          <td className="py-1.5 pr-2">
                            <div className="font-medium leading-tight">{a.area}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {a.pessoasNoMes} em {rotuloMes(mes ?? "")}
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
              )}
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

            {/* O mês em foco manda em TUDO: KPIs, lista e valores de cada
                linha. Enquanto ele mexia só nos KPIs, escolher dezembro/25
                mostrava o time de hoje com o salário de hoje. */}
            <Select value={mes ?? ""} onValueChange={setMesFoco}>
              <SelectTrigger
                className={cn("h-9 w-[130px]", mes !== referencia && "border-primary text-primary")}
                title="Mês em foco — a lista passa a ser a de quem estava aqui nele"
              >
                <SelectValue placeholder="Mês" />
              </SelectTrigger>
              <SelectContent>
                {[...meses].reverse().map((m) => (
                  <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <EscolherVarios
              rotulo="Setores" opcoes={setores} escolhidos={filtros.setores}
              onMudar={(v) => setFiltros((f) => ({ ...f, setores: v }))}
            />
            <EscolherVarios
              rotulo="Cargos" opcoes={cargos} escolhidos={filtros.cargos}
              onMudar={(v) => setFiltros((f) => ({ ...f, cargos: v }))}
            />

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

            {/* Só aparece com algo ligado, e diz quantos — sem isso, um funil
                esquecido numa coluna escondida faz a lista mentir em silêncio. */}
            {filtrosLigados(filtros) > 0 && (
              <Button
                size="sm" variant="ghost" className="h-9 gap-1.5"
                onClick={() => setFiltros(FILTROS_PADRAO)}
              >
                <FilterX className="h-3.5 w-3.5" />
                Limpar {filtrosLigados(filtros)} filtro{filtrosLigados(filtros) > 1 ? "s" : ""}
              </Button>
            )}
          </div>

          {/* Viajar no tempo tem de ser visível. A lista muda de gente e de
              valor quando o mês em foco não é o último fechado, e sem esta
              faixa o leitor atribui a mudança a outra coisa — foi o que
              aconteceu quando o seletor mexia só nos KPIs. */}
          {mes && mes !== referencia && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
              <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>
                {passado ? (
                  <>
                    Vendo <span className="font-medium">{rotuloMes(mes)}</span>: a lista é quem
                    estava na Takeat naquele mês, com o que ganhava então.
                  </>
                ) : (
                  <>
                    Vendo <span className="font-medium">{rotuloMes(mes)}</span>, que ainda está
                    em andamento — a folha não foi lançada inteira, e a lista continua sendo a
                    de {rotuloMes(referencia ?? "")}.
                  </>
                )}
              </span>
              <Button
                size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs"
                onClick={() => setMesFoco(referencia)}
              >
                Voltar para {rotuloMes(referencia ?? "")}
              </Button>
            </div>
          )}

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
                  {colunas.map((col) => (
                    <TableHead
                      key={col.rotulo}
                      className={col.classe}
                      title={col.rotulo === "Contra os pares"
                        ? "Remuneração inteira (fixo + variável) contra quem tem o mesmo cargo"
                        : undefined}
                    >
                      <CabecalhoColuna
                        col={col} ordem={ordem} onOrdenar={ordenarPor}
                        faixa={col.faixa ? filtros.faixas[col.faixa] : undefined}
                        onFaixa={definirFaixa}
                      />
                    </TableHead>
                  ))}
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
                          tempoDeCasaStr(p.inicio, dataDoFoco)
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
                    <TableCell colSpan={9} className="py-12 text-center">
                      {/* "NINGUÉM" E "NINGUÉM DENTRO DESTE FILTRO" SÃO RESPOSTAS
                          DIFERENTES. Procurando "joão guilherme" a tela dizia a
                          primeira — e mostrava os R$ 9.873 dele no bloco ao
                          lado, em Administrativo. Ele está na base desde
                          mai/2024; o que o escondia era "Incluir quem saiu",
                          desmarcada por padrão. Dizer "ninguém" manda quem
                          procura concluir que o dado não existe, que é a pior
                          conclusão possível num painel que guarda história. */}
                      {escondidos.total > 0 ? (
                        <div className="mx-auto max-w-md space-y-2">
                          <p className="text-sm">
                            Ninguém <strong>neste recorte</strong> — mas{" "}
                            {escondidos.total === 1 ? "há 1 pessoa" : `há ${escondidos.total} pessoas`}{" "}
                            fora dele.
                          </p>
                          <p className="text-[12px] leading-relaxed text-muted-foreground">
                            {escondidos.exemplos.map((e, i) => (
                              <Fragment key={e.id}>
                                {i > 0 && ", "}
                                <span className="text-foreground">{e.nome}</span>
                                {e.ultimo && ` (até ${rotuloMes(e.ultimo)})`}
                              </Fragment>
                            ))}
                            {escondidos.total > escondidos.exemplos.length &&
                              ` e mais ${escondidos.total - escondidos.exemplos.length}`}.
                          </p>
                          {/* Os botões ligam exatamente a caixa que revela cada
                              grupo. Quem acumula dois motivos precisa dos dois
                              cliques — por isso todos os que se aplicam
                              aparecem, em vez de só o maior. */}
                          <div className="flex flex-wrap justify-center gap-2 pt-1">
                            {escondidos.saidas > 0 && (
                              <Button size="sm" variant="outline"
                                onClick={() => setFiltros((f) => ({ ...f, incluirSaidas: true }))}>
                                Incluir quem saiu ({escondidos.saidas})
                              </Button>
                            )}
                            {escondidos.semFicha > 0 && (
                              <Button size="sm" variant="outline"
                                onClick={() => setFiltros((f) => ({ ...f, soComFichaRh: false }))}>
                                Sem ficha no RH ({escondidos.semFicha})
                              </Button>
                            )}
                            {escondidos.naoPessoas > 0 && (
                              <Button size="sm" variant="outline"
                                onClick={() => setFiltros((f) => ({ ...f, incluirNaoPessoas: true }))}>
                                Incluir empresas ({escondidos.naoPessoas})
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Ninguém no recorte atual.</span>
                      )}
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
            {linhas.length} pessoas {mes ? `em ${rotuloMes(mes)}` : ""}
            {" · série de "}
            {meses.length ? `${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])}` : "sem período"}
            {/* O Conta Azul JÁ entrou — é ele que faz a série começar em dez/23.
                O rodapé prometia o contrário e fazia o painel parecer pela
                metade. O que a linha diz agora é de onde vem cada pedaço. */}
            {" · "}até fev/26 pelo export do Conta Azul, de mar/26 em diante pelo Omie
            {frescor?.carga_em && ` · carga de ${fmtDataHoraStr(frescor.carga_em)}`}
          </p>
        </>
      )}

      <FichaDaPessoa
        pessoa={(painel?.pessoas ?? []).find((p) => p.id === idAberto) ?? null}
        par={idAberto ? pares.get(idAberto) : undefined}
        referencia={referencia}
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

      {classificando && (
        <FilaSemTime
          pessoas={semTime}
          setores={setoresConhecidos}
          onFechar={() => setClassificando(false)}
          // Relê o painel: o time novo muda o filtro por setor, a tabela por
          // área e — o que importa — o recorte que cada líder passa a enxergar.
          onSalvo={() => { setClassificando(false); void carregar(); }}
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
  const referencia = ultimaCompetenciaFechada(meses);
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
                const r = resumoDaPessoa(p, referencia);
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
  /** A competência ISO. Só no gráfico do topo, que é clicável. */
  iso?: string;
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
function Segmento(serie: string, foco?: string | null) {
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
    /* Os meses fora do foco desbotam em vez de sumir: a série inteira continua
       legível — é ela que faz escolher o mês —, mas fica claro qual barra é a
       que está nos KPIs e na lista logo abaixo. Sem foco definido, nenhuma
       desbota. */
    const apagada = !!foco && !!payload.iso && payload.iso !== foco;
    return (
      <path
        d={d} fill={fill} stroke="hsl(var(--background))" strokeWidth={1}
        opacity={apagada ? 0.32 : 1}
      />
    );
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

/** Gaveta ou tela cheia — a escolha fica no aparelho de quem abriu. */
const CHAVE_FICHA_EXPANDIDA = "remuneracao:ficha-expandida";

function FichaDaPessoa({ pessoa, par, referencia, onClose, onExportar }: {
  pessoa: PessoaRemuneracao | null;
  par?: Pares;
  /** O último mês fechado do painel — separa quem saiu de quem só não tem mês mais novo. */
  referencia: string | null;
  onClose: () => void;
  onExportar: (quem: PessoaRemuneracao[]) => void;
}) {
  /* Qual mês está aberto no drill-down, e o que veio dele. Fica AQUI e não em
     cada linha para que abrir um mês feche o anterior — dois meses abertos ao
     mesmo tempo empurram a tabela para fora da tela. */
  const [mesAberto, setMesAberto] = useState<string | null>(null);
  const [titulos, setTitulos] = useState<LancamentoDoMes[] | null>(null);
  const [buscandoTitulos, setBuscandoTitulos] = useState(false);

  /* Gaveta ou tela cheia. A gaveta de 672px cabe numa coluna só, e ler a ficha
     inteira (dois gráficos, a trajetória e a tabela de meses) custa três telas
     de rolagem. Expandida, a mesma ficha ocupa a janela e se reparte em duas
     colunas — em coluna única "tela cheia" só esticaria a linha de texto.
     A preferência gruda no navegador: quem gosta de grande gosta sempre. */
  const [expandida, setExpandida] = useState(() => {
    try { return localStorage.getItem(CHAVE_FICHA_EXPANDIDA) === "1"; } catch { return false; }
  });
  function alternarTamanho() {
    const proxima = !expandida;
    setExpandida(proxima);
    // Modo anônimo com armazenamento bloqueado lança aqui; a ficha continua.
    try { localStorage.setItem(CHAVE_FICHA_EXPANDIDA, proxima ? "1" : "0"); } catch { /* sem memória */ }
  }

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
  const r = resumoDaPessoa(pessoa, referencia);
  const degraus = degrausDoFixo(pessoa.meses, referencia);
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

  /* ── Os blocos da ficha, nomeados ──
     Na gaveta eles descem um sob o outro; em tela cheia se repartem em duas
     colunas. Ficam em constantes porque a alternativa é escrever a mesma
     marcação duas vezes — e as duas cópias divergem na primeira alteração. */

  const identificacao = (
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
      {/* No celular a gaveta já ocupa a tela inteira e o botão não teria o que
          fazer. Quem se esconde é o invólucro: `hidden` não venceria o
          `display:inline-flex` do `.ghost-btn`, emitido depois na mesma camada. */}
      <span className="hidden sm:inline-flex">
        <button
          type="button"
          onClick={alternarTamanho}
          className="ghost-btn ghost-icone"
          title={expandida ? "Voltar para a gaveta" : "Abrir em tela cheia — a ficha inteira de uma vez"}
          aria-label={expandida ? "Voltar para a gaveta" : "Abrir em tela cheia"}
        >
          {expandida ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </span>
    </div>
  );

  const resumo = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { r: "Fixo hoje", v: fmtBRL(r.fixoAtual) },
        // O ladrilho do pró-labore toma o lugar do "variável médio" em quem
        // recebe pró-labore: sócio não tem comissão, e um ladrilho com
        // travessão desperdiça o espaço que o número precisa.
        ...(temProlabore
          ? [{ r: "Pró-labore/mês", v: fmtBRL(dados[dados.length - 1]?.prolabore || null) }]
          : [{ r: "Variável médio", v: r.mesesComPremiacao ? fmtBRL(r.premiacaoMedia) : "—" }]),
        { r: "Total no período", v: fmtBRL(r.totalPeriodo) },
        // A ficha é a trajetória INTEIRA, não o recorte da lista: aqui o
        // tempo de casa é o de hoje mesmo.
        { r: "Tempo de casa", v: tempoDeCasaStr(pessoa.inicio, new Date()) },
      ].map((x) => (
        <div key={x.r} className="rounded-lg border border-border/60 p-2.5">
          <div className="eyebrow text-[9.5px]">{x.r}</div>
          <div className="num mt-0.5 text-sm font-semibold">{x.v}</div>
        </div>
      ))}
    </div>
  );

  /* Onde ela está entre quem tem o mesmo cargo. Em tom neutro: metade de
     qualquer grupo ganha abaixo da mediana, por definição — pintar isso de
     alarme transformaria estatística em acusação. */
  const contraPares = par ? (
    <div className="rounded-lg border border-border/60 p-2.5 text-xs">
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
  ) : null;

  const alertaRH = Math.abs(r.divergenciaContrato ?? 0) >= 1 ? (
    <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-xs">
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
  ) : null;

  const vazio = !meses.length ? (
    <p className="py-6 text-center text-sm text-muted-foreground">
      Nenhum pagamento registrado no período carregado.
    </p>
  ) : null;

  /* ── A composição, mês a mês ── */
  const composicao = meses.length ? (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Composição mês a mês</h3>
        <Legenda series={series} />
      </div>
      {/* Em tela cheia o gráfico cresce também na vertical: esticado só na
          horizontal, ele vira uma faixa e as diferenças de altura somem. */}
      <div className={cn("mt-2 w-full", expandida ? "h-[300px]" : "h-[210px]")}>
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
    </section>
  ) : null;

  /* ── A trajetória do fixo ──
     Separado da composição de propósito: no empilhado o fixo é a base e os
     degraus somem sob a variação do topo. Aqui a linha responde "quando ela
     teve aumento, e de quanto", que é a pergunta que fez este painel existir.
     Um eixo só — nunca dois no mesmo gráfico. */
  const trajetoriaDoFixo = meses.filter((m) => Number(m.fixo) > 0).length > 1 ? (
    <section>
      <h3 className="text-sm font-semibold">Trajetória do fixo</h3>
      <div className={cn("mt-2 w-full", expandida ? "h-[230px]" : "h-[150px]")}>
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
    </section>
  ) : null;

  /* ── A trajetória pelos times ──
     Único histórico de posição que existe: o Portal RH guarda o cargo de HOJE,
     e a categoria do pagamento carrega a área. A tela diz que é troca de TIME e
     não promoção — subir de nível dentro do mesmo time não muda a categoria e
     não aparece aqui. */
  const trajetoriaNaEmpresa = meses.length ? (
    <section>
      <h3 className="text-sm font-semibold">Trajetória na empresa</h3>
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
    </section>
  ) : null;

  /* ── A tabela ──
     Os números por extenso. É também o "relief" que o âmbar da escala exige no
     tema claro, onde ele não alcança 3:1 contra o branco. */
  const valores = meses.length ? (
    <section>
      <h3 className="text-sm font-semibold">Valores</h3>
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
                              {/* Só o Omie tem código que existe no ERP. Na era
                                  Conta Azul o `origem_ref` é uma impressão
                                  digital que este repositório inventou
                                  ("2024-01-05-12a1c9e5db06") — 2.777 das 3.911
                                  linhas. Estampá-la como "código no Omie"
                                  mandava quem lê procurar no ERP por uma coisa
                                  que não está lá. */}
                              {t.fonte === "omie" ? (
                                <span
                                  className="num select-all text-muted-foreground/70"
                                  title="Código do título no Omie — procure por ele no ERP"
                                >
                                  #{t.cod_titulo}
                                </span>
                              ) : (
                                /* O `else` era "Conta Azul" fixo, porque só
                                   existiam duas fontes. Já são quatro
                                   (`manual` e `nf_drive` entraram depois), e
                                   um lançamento de 2026 estampado "Conta Azul"
                                   manda procurar num sistema desligado em
                                   fevereiro. Cada fonte diz o que é. */
                                <span
                                  className="text-muted-foreground/70"
                                  title={FONTE[t.fonte]?.ajuda ?? "Origem não identificada."}
                                >
                                  {FONTE[t.fonte]?.rotulo ?? t.fonte}
                                </span>
                              )}
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
        {rotuloMes(meses[meses.length - 1].competencia)} — até fev/26 pelo
        export do Conta Azul, de mar/26 em diante pelo Omie. Até dez/25 a DRE
        fica um mês à frente: ela é por caixa até ali e por competência depois.
      </p>
    </section>
  ) : null;

  const cadastro = (
    <dl className="space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
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
  );

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className={cn("w-full overflow-y-auto", expandida ? "sm:max-w-none" : "sm:max-w-2xl")}>
        {/* Em tela cheia a ficha para de crescer em algum ponto: num monitor
            largo, tabela e texto de 1.200px não se leem — se varrem. */}
        <div className={cn(expandida && "mx-auto w-full max-w-[1700px]")}>
          <SheetHeader>
            <SheetTitle className="pr-6 text-left leading-tight">{pessoa.nome}</SheetTitle>
          </SheetHeader>
          {identificacao}

          {expandida ? (
            /* Duas colunas: à esquerda o que se lê de relance (ladrilhos,
               gráficos, régua dos pares); à direita o que se lê linha a linha
               (a tabela dos meses e o cadastro). É a repartição que faz a ficha
               caber numa tela só — o pedido que fez este botão existir. */
            <div className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-5">
                {resumo}
                {alertaRH}
                {composicao}
                {trajetoriaDoFixo}
                {contraPares}
              </div>
              <div className="min-w-0 space-y-5">
                {vazio}
                {valores}
                {trajetoriaNaEmpresa}
                {cadastro}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              {resumo}
              {contraPares}
              {alertaRH}
              {vazio}
              {composicao}
              {trajetoriaDoFixo}
              {trajetoriaNaEmpresa}
              {valores}
              {cadastro}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
