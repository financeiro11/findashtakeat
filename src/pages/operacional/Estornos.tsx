// /operacional/estornos — o que devolvemos ao cliente e quanto disso é perda de verdade.
//
// Substitui a rodada mensal da skill de churn: o Asaas entrega os estornos (totais E
// parciais), a aba ESTORNOS da planilha entrega a classificação do time, e a conta de
// topo é sempre a mesma —
//
//     churn real = estornado no mês − o que o time marcou como erro de cobrança
//
// TRÊS REGRAS QUE NÃO SÃO ÓBVIAS OLHANDO A TELA — todas vindas da skill que fazia esta
// conta à mão todo mês, e que esta tela aposentou:
//
// • O mês é o do VENCIMENTO da cobrança, não o da devolução. Um estorno feito em abril
//   pode ser de uma parcela que vence em julho (o Asaas cancela lá na frente) e ele
//   pertence a julho — por isso a coluna "estornado em" às vezes mostra um mês
//   diferente do que está selecionado, e está certo.
// • A classificação é procurada na planilha INTEIRA, sem recorte de mês, justamente
//   porque a linha que explica esse estorno está lá atrás.
// • O DESCARTE É POR ESTABELECIMENTO, não por estorno: se qualquer linha daquele
//   cliente na aba está marcada como erro de cobrança, TODOS os estornos dele saem do
//   churn. A tela mostra "descartado pelo estabelecimento" quando foi esse o caso.
//
// Os motivos que descartam ("Cobrança indevida", "Erro de pagamento") moram no SQL, em
// `estornos_motivo_descarta` — mudar a lista é migration, não deploy.
//
// A tela só lê (RPC `estornos_serie` + tabela `estornos_asaas`); quem preenche é a
// edge function `estornos-sync`.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { valorExato } from "@/lib/valor";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Cell,
} from "recharts";
import {
  Undo2, ChevronLeft, ChevronRight, Loader2, RefreshCw, ExternalLink, AlertTriangle,
  Check, Search, TriangleAlert, Clock, Scissors, FileSpreadsheet, Table2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import SheetMirrorPage from "./SheetMirrorPage";

const PLANILHA_ID = "10A9YnskShPPZ2Xz9d-kN2SHCv-qN-48-94rQBbCNWIo";
const PLANILHA_URL = `https://docs.google.com/spreadsheets/d/${PLANILHA_ID}/edit?gid=1062579993`;

const sb = supabase as any;

/* ------------------------------ formatação ------------------------------ */
// Convenção do projeto: o formatador normal devolve ReactNode com o valor cheio no
// hover; a variante `…Str` devolve string pura (título, template literal, eixo do
// Recharts — onde um ReactNode viraria "[object Object]").
const brlStr = (n: number) => `R$ ${Math.round(n || 0).toLocaleString("pt-BR")}`;
const brl = (n: number) => comValorExato(n, brlStr(n));
const brlCentavosStr = (n: number) =>
  `R$ ${(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brlCentavos = (n: number) => comValorExato(n, brlCentavosStr(n));
function eixoStr(n: number): string {
  const a = Math.abs(n || 0);
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} M`;
  if (a >= 1_000) return `${Math.round(n / 1_000)} k`;
  return String(Math.round(n));
}
const inteiro = (n: number) => Math.round(n || 0).toLocaleString("pt-BR");
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function rotuloMes(competencia: string): string {
  const [a, m] = competencia.split("-");
  return `${MES_CURTO[Number(m) - 1]}/${a.slice(2)}`;
}
function dataCurta(d?: string | null): string {
  if (!d) return "—";
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a.slice(2)}`;
}

/* --------------------------------- tipos --------------------------------- */
type LinhaSerie = {
  competencia: string;
  qtd: number; qtd_parciais: number;
  estornado: number; indevida: number; qtd_indevida: number;
  churn_real: number;
  nao_classificado: number; qtd_nao_classificado: number;
  pendente: number; qtd_pendente: number;
};
type Estorno = {
  id: string; id_pagamento: string;
  cliente_nome: string | null; cliente_documento: string | null;
  descricao: string | null; forma: string | null;
  status_cobranca: string | null; status_estorno: string | null; parcial: boolean;
  valor_cobranca: number; valor_estornado: number;
  data_estorno: string | null; data_vencimento: string | null;
  invoice_url: string | null;
  linha_planilha: number | null; casamento: string | null;
  motivo: string | null; cobranca_indevida: boolean;
  /** 'linha' = a linha casada é de descarte; 'estabelecimento' = outra linha do mesmo cliente é. */
  descarte_origem: string | null;
};
type Orfa = {
  linha: number; estabelecimento: string | null; motivo: string | null; status: string | null;
  forma: string | null; valor_estornar: number | null; data_solicitacao: string | null; mes: number | null;
};

const FORMA_ROTULO: Record<string, string> = {
  CREDIT_CARD: "Cartão", PIX: "Pix", BOLETO: "Boleto", UNDEFINED: "—",
  DEBIT_CARD: "Débito", TRANSFER: "Transferência", DEPOSIT: "Depósito",
};
const CASAMENTO_ROTULO: Record<string, string> = {
  link: "link da fatura",
  comprovante: "comprovante",
  lote: "mesmo pedido",
  "nome+valor": "nome + valor",
  nome: "nome",
  estabelecimento: "nome do estabelecimento",
};

/* ============================== componente ============================== */
export default function Estornos() {
  const [aba, setAba] = useState<"conciliacao" | "planilha">("conciliacao");

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Estornos</h2>
          <p className="text-sm text-muted-foreground">
            O que o Asaas devolveu, cruzado com a classificação do time — e o churn real do mês.
          </p>
        </div>
        <div className="flex rounded-md border border-border bg-card p-0.5">
          {([["conciliacao", "Conciliação", Table2], ["planilha", "Planilha", FileSpreadsheet]] as const).map(
            ([v, rotulo, Icone]) => (
              <button
                key={v}
                onClick={() => setAba(v)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-3 py-1 text-[12.5px] font-medium transition",
                  aba === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icone className="h-3.5 w-3.5" />
                {rotulo}
              </button>
            ),
          )}
        </div>
      </div>

      {aba === "conciliacao" ? (
        <Conciliacao />
      ) : (
        <div className="-mx-5 -mb-5">
          <SheetMirrorPage
            spreadsheetId={PLANILHA_ID}
            sheet="ESTORNOS"
            sheetUrl={PLANILHA_URL}
            title="Aba ESTORNOS"
            description="Espelho editável da planilha de churn. Editar aqui grava na planilha — e a conciliação recalcula no próximo Recalcular."
            Icon={Undo2}
          />
        </div>
      )}
    </div>
  );
}

/* ============================== conciliação ============================== */
function Conciliacao() {
  const [serie, setSerie] = useState<LinhaSerie[]>([]);
  const [mes, setMes] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<Estorno[]>([]);
  const [orfas, setOrfas] = useState<Orfa[]>([]);
  const [estado, setEstado] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState<"" | "recalcular" | "atualizar">("");
  const [incluirPendentes, setIncluirPendentes] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "indevida" | "sem_classificacao" | "parcial">("todos");

  /* --------------------------- carga --------------------------- */
  async function carregarSerie(preservarMes = true) {
    const [{ data: s, error }, { data: est }, { data: o }] = await Promise.all([
      sb.rpc("estornos_serie", { p_pendentes: incluirPendentes }),
      sb.from("asaas_sync_estado").select("*").eq("escopo", "estornos").maybeSingle(),
      sb.rpc("estornos_planilha_orfas"),
    ]);
    if (error) { toast.error("Falha ao ler a série de estornos", { description: error.message }); return; }
    const linhasSerie = ((s ?? []) as any[]).map((r) => ({
      ...r,
      competencia: String(r.competencia).slice(0, 10),
      estornado: Number(r.estornado), indevida: Number(r.indevida), churn_real: Number(r.churn_real),
      nao_classificado: Number(r.nao_classificado), pendente: Number(r.pendente),
    })) as LinhaSerie[];
    setSerie(linhasSerie);
    setEstado(est ?? null);
    setOrfas((o ?? []) as Orfa[]);

    if (!preservarMes || !mes) {
      // Abre no mês corrente quando ele existe na série; senão, no último com movimento.
      const hoje = new Date();
      const atual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
      const temAtual = linhasSerie.some((l) => l.competencia === atual);
      setMes(temAtual ? atual : linhasSerie[linhasSerie.length - 1]?.competencia ?? null);
    }
  }

  async function carregarMes(competencia: string) {
    const { data, error } = await sb
      .from("estornos_asaas")
      .select("id, id_pagamento, cliente_nome, cliente_documento, descricao, forma, status_cobranca, status_estorno, parcial, valor_cobranca, valor_estornado, data_estorno, data_vencimento, invoice_url, linha_planilha, casamento, motivo, cobranca_indevida, descarte_origem")
      .eq("competencia", competencia)
      .neq("status_estorno", "CANCELLED")
      .order("valor_estornado", { ascending: false });
    if (error) { toast.error("Falha ao ler os estornos do mês", { description: error.message }); return; }
    setLinhas((data ?? []) as Estorno[]);
  }

  useEffect(() => { (async () => { setCarregando(true); await carregarSerie(false); setCarregando(false); })(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (serie.length) carregarSerie(true); /* eslint-disable-next-line */ }, [incluirPendentes]);
  useEffect(() => { if (mes) carregarMes(mes); /* eslint-disable-next-line */ }, [mes]);

  async function sincronizar(acao: "recalcular" | "atualizar") {
    setSincronizando(acao);
    try {
      const { data, error } = await supabase.functions.invoke("estornos-sync", { body: { action: acao } });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const c = (data as any)?.conciliacao;
      toast.success(acao === "atualizar" ? "Atualizado do Asaas" : "Planilha relida", {
        description: c ? `${inteiro(c.casados)} de ${inteiro(c.estornos)} estornos classificados.` : undefined,
      });
      await carregarSerie(true);
      if (mes) await carregarMes(mes);
    } catch (e: any) {
      toast.error("Não deu para sincronizar", { description: e.message });
    } finally {
      setSincronizando("");
    }
  }

  /* --------------------------- derivados --------------------------- */
  const atual = useMemo(() => serie.find((l) => l.competencia === mes) ?? null, [serie, mes]);
  const anterior = useMemo(() => {
    const i = serie.findIndex((l) => l.competencia === mes);
    return i > 0 ? serie[i - 1] : null;
  }, [serie, mes]);

  const grafico = useMemo(
    () => serie.map((l) => ({ ...l, label: rotuloMes(l.competencia) })),
    [serie],
  );

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (filtro === "indevida" && !l.cobranca_indevida) return false;
      if (filtro === "sem_classificacao" && l.linha_planilha != null) return false;
      if (filtro === "parcial" && !l.parcial) return false;
      if (!q) return true;
      // A busca varre também o motivo e a descrição — é por eles que se procura
      // quando o nome do cliente ainda não foi resolvido.
      return [l.cliente_nome, l.descricao, l.motivo, l.cliente_documento, l.id_pagamento]
        .some((c) => (c ?? "").toLowerCase().includes(q));
    });
  }, [linhas, busca, filtro]);

  const somaVisivel = useMemo(
    () => visiveis.reduce((s, l) => s + Number(l.valor_estornado || 0), 0),
    [visiveis],
  );

  // Quais motivos tiraram dinheiro do churn neste mês. Fica no rodapé do KPI porque a
  // lista de descarte pode crescer ("Erro de pagamento" ainda vai entrar no dropdown da
  // planilha) e ninguém deveria precisar abrir o SQL para saber o que foi abatido.
  const motivosDescartados = useMemo(() => {
    const s = new Set<string>();
    for (const l of linhas) if (l.cobranca_indevida && l.motivo) s.add(l.motivo);
    return [...s].sort();
  }, [linhas]);

  const idx = serie.findIndex((l) => l.competencia === mes);
  const semNome = linhas.filter((l) => !l.cliente_nome).length;

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lendo os estornos…
      </div>
    );
  }
  if (!serie.length) {
    return (
      <div className="card-surface p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum estorno espelhado ainda. Clique em <b>Atualizar do Asaas</b> para a primeira carga.
        </p>
        <button className="chip mx-auto mt-4" onClick={() => sincronizar("atualizar")} disabled={!!sincronizando}>
          {sincronizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar do Asaas
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---------------- barra de comando ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            className="ghost-icone"
            onClick={() => idx > 0 && setMes(serie[idx - 1].competencia)}
            disabled={idx <= 0}
            title="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-[120px] text-center text-sm font-semibold">
            {mes ? rotuloMes(mes) : "—"}
          </div>
          <button
            className="ghost-icone"
            onClick={() => idx >= 0 && idx < serie.length - 1 && setMes(serie[idx + 1].competencia)}
            disabled={idx < 0 || idx >= serie.length - 1}
            title="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-2 text-xs text-muted-foreground">por vencimento da cobrança</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className={cn("chip", incluirPendentes && "border-primary text-primary")}
            onClick={() => setIncluirPendentes((v) => !v)}
            title="Estorno de cartão nasce PENDING e vira DONE em alguns dias. Ligado, ele já entra na conta."
          >
            <Clock className="h-3.5 w-3.5" />
            {incluirPendentes ? "Com pendentes" : "Só concluídos"}
          </button>
          <button className="chip" onClick={() => sincronizar("recalcular")} disabled={!!sincronizando}>
            {sincronizando === "recalcular" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Recalcular
          </button>
          <button className="chip" onClick={() => sincronizar("atualizar")} disabled={!!sincronizando}>
            {sincronizando === "atualizar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar do Asaas
          </button>
        </div>
      </div>

      {/* ---------------- a conta ---------------- */}
      <div className="grid gap-3 md:grid-cols-3">
        <Kpi
          eyebrow="Estornado no mês"
          valor={brl(atual?.estornado ?? 0)}
          rodape={
            <>
              {inteiro(atual?.qtd ?? 0)} estorno(s)
              {(atual?.qtd_parciais ?? 0) > 0 && <> · {inteiro(atual!.qtd_parciais)} parcial(is)</>}
            </>
          }
          icone={<Undo2 className="h-3.5 w-3.5" />}
        />
        <Kpi
          eyebrow="(−) Erro de cobrança"
          valor={brl(atual?.indevida ?? 0)}
          rodape={
            <>
              {inteiro(atual?.qtd_indevida ?? 0)} marcado(s) pelo time na planilha
              {motivosDescartados.length > 0 && <> · {motivosDescartados.join(" · ")}</>}
            </>
          }
          icone={<Scissors className="h-3.5 w-3.5" />}
          tom="neutro"
        />
        <Kpi
          eyebrow="= Churn real"
          valor={brl(atual?.churn_real ?? 0)}
          rodape={
            anterior ? (
              <>
                mês anterior {brl(anterior.churn_real)}
                {anterior.churn_real > 0 && (
                  <span className={cn("ml-1.5 num font-semibold", atual && atual.churn_real > anterior.churn_real ? "text-neg" : "text-pos")}>
                    {atual && atual.churn_real > anterior.churn_real ? "+" : "−"}
                    {Math.abs(((atual?.churn_real ?? 0) - anterior.churn_real) / anterior.churn_real * 100).toFixed(1)}%
                  </span>
                )}
              </>
            ) : (
              <>sem mês anterior na série</>
            )
          }
          icone={<TriangleAlert className="h-3.5 w-3.5" />}
          destaque
        />
      </div>

      {/* ---------------- barra de status ---------------- */}
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {(atual?.qtd_nao_classificado ?? 0) > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-warn">
              <AlertTriangle className="h-3.5 w-3.5" />
              <b className="num">{brlStr(atual!.nao_classificado)}</b> em {inteiro(atual!.qtd_nao_classificado)} estorno(s)
              sem linha na planilha — contam inteiros como churn
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-pos">
              <Check className="h-3.5 w-3.5" /> todo estorno do mês tem linha na planilha
            </span>
          )}
          {(atual?.qtd_pendente ?? 0) > 0 && !incluirPendentes && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <b className="num">{brlStr(atual!.pendente)}</b> ainda em processamento no Asaas (fora da conta)
            </span>
          )}
          {semNome > 0 && (
            <span className="text-muted-foreground">
              {inteiro(semNome)} sem nome de cliente — o cadastro se completa nas próximas atualizações
            </span>
          )}
        </div>
        <span className="text-muted-foreground/80">
          {estado?.ultima_completa
            ? `atualizado ${new Date(estado.ultima_completa).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
            : "nunca atualizado"}
        </span>
      </div>

      {/* ---------------- série ---------------- */}
      <div className="card-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="eyebrow">Mês a mês</div>
            <div className="text-xs text-muted-foreground">
              barra cheia = estornado; a parte clara é o erro de cobrança, que sai do churn
            </div>
          </div>
        </div>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={grafico} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false} width={52}
                tickFormatter={eixoStr}
              />
              <RTooltip content={<DicaGrafico />} cursor={{ fill: "hsl(var(--muted) / 0.35)" }} />
              <Bar dataKey="churn_real" stackId="e" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]}
                   onClick={(d: any) => d?.payload?.competencia && setMes(d.payload.competencia)}>
                {grafico.map((g) => (
                  <Cell key={g.competencia} opacity={g.competencia === mes ? 1 : 0.55} cursor="pointer" />
                ))}
              </Bar>
              <Bar dataKey="indevida" stackId="e" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]}
                   onClick={(d: any) => d?.payload?.competencia && setMes(d.payload.competencia)}>
                {grafico.map((g) => (
                  <Cell key={g.competencia} opacity={g.competencia === mes ? 0.55 : 0.3} cursor="pointer" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ---------------- estornos do mês ---------------- */}
      <div className="card-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ["todos", `Todos (${linhas.length})`],
              ["indevida", `Erro de cobrança (${linhas.filter((l) => l.cobranca_indevida).length})`],
              ["sem_classificacao", `Sem linha na planilha (${linhas.filter((l) => l.linha_planilha == null).length})`],
              ["parcial", `Parciais (${linhas.filter((l) => l.parcial).length})`],
            ] as const).map(([v, rotulo]) => (
              <button
                key={v}
                onClick={() => setFiltro(v)}
                className={cn("chip", filtro === v && "border-primary text-primary")}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="cliente, motivo, cobrança…"
              className="h-8 w-56 pl-8 text-xs"
            />
          </div>
        </div>

        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Cliente</th>
                <th className="px-3 py-2 font-semibold">Classificação</th>
                <th className="px-3 py-2 text-right font-semibold">Cobrança</th>
                <th className="px-3 py-2 text-right font-semibold">Estornado</th>
                <th className="px-3 py-2 font-semibold">Estornado em</th>
                <th className="px-3 py-2 font-semibold">Venc.</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.id} className={cn("border-b border-border/60 hover:bg-muted/40", l.cobranca_indevida && "bg-muted/20")}>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {l.cliente_nome ?? <span className="text-muted-foreground">cliente {l.id_pagamento}</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={l.descricao ?? ""}>
                      {l.descricao ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {l.linha_planilha == null ? (
                      <span className="inline-flex items-center gap-1 text-xs text-warn">
                        <AlertTriangle className="h-3 w-3" /> sem linha na planilha
                      </span>
                    ) : (
                      <div className="space-y-0.5">
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium",
                            l.cobranca_indevida ? "bg-muted text-foreground" : "bg-primary/10 text-primary",
                          )}
                        >
                          {l.motivo ?? "sem motivo"}
                        </span>
                        <div className="text-[11px] text-muted-foreground">
                          linha {l.linha_planilha} · casou por {CASAMENTO_ROTULO[l.casamento ?? ""] ?? l.casamento}
                        </div>
                        {l.descarte_origem === "estabelecimento" && (
                          // O motivo desta linha não é de descarte, mas OUTRA linha do
                          // mesmo cliente é — e aí ele todo sai do churn. Sem esta
                          // frase o chip acima parece contradizer o número de cima.
                          <div className="text-[11px] text-muted-foreground">
                            fora do churn: o estabelecimento tem outra linha marcada
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right num">
                    {brlCentavos(Number(l.valor_cobranca))}
                    <div className="text-[11px] text-muted-foreground">{FORMA_ROTULO[l.forma ?? ""] ?? l.forma ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-right num font-semibold">
                    {brlCentavos(Number(l.valor_estornado))}
                    {l.parcial && (
                      <div className="text-[11px] font-normal text-muted-foreground">
                        parcial · {Math.round((Number(l.valor_estornado) / Math.max(1, Number(l.valor_cobranca))) * 100)}%
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {dataCurta(l.data_estorno)}
                    {l.status_estorno === "PENDING" && (
                      <div className="text-[11px] text-muted-foreground">em processamento</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{dataCurta(l.data_vencimento)}</td>
                  <td className="px-3 py-2 text-right">
                    {l.invoice_url && (
                      <a href={l.invoice_url} target="_blank" rel="noreferrer" className="ghost-icone" title="Abrir a cobrança no Asaas">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {!visiveis.length && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhum estorno com esse recorte.
                  </td>
                </tr>
              )}
            </tbody>
            {visiveis.length > 0 && (
              <tfoot className="sticky bottom-0 bg-card">
                <tr className="border-t border-border text-xs">
                  <td className="px-3 py-2 font-semibold" colSpan={3}>
                    {inteiro(visiveis.length)} linha(s) no recorte
                  </td>
                  <td className="px-3 py-2 text-right num font-semibold">{brlCentavos(somaVisivel)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ---------------- o outro lado da conferência ---------------- */}
      {orfas.length > 0 && (
        <div className="card-surface">
          <div className="border-b border-border p-3">
            <div className="eyebrow">Pedidos da planilha sem estorno no Asaas</div>
            <div className="text-xs text-muted-foreground">
              {inteiro(orfas.length)} linha(s) registradas que nenhum estorno do Asaas encontrou. O caso normal é
              devolução por Pix ou boleto, que sai por fora e o Asaas não tem como saber — o resto vale conferir.
            </div>
          </div>
          <div className="max-h-[280px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Linha</th>
                  <th className="px-3 py-2 font-semibold">Estabelecimento</th>
                  <th className="px-3 py-2 font-semibold">Motivo</th>
                  <th className="px-3 py-2 font-semibold">Forma</th>
                  <th className="px-3 py-2 text-right font-semibold">A estornar</th>
                  <th className="px-3 py-2 font-semibold">Solicitado</th>
                </tr>
              </thead>
              <tbody>
                {orfas.map((o) => (
                  <tr key={o.linha} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="px-3 py-2 num text-xs text-muted-foreground">{o.linha}</td>
                    <td className="px-3 py-2">{o.estabelecimento || "—"}</td>
                    <td className="px-3 py-2 text-xs">{o.motivo || "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{o.forma || "—"}</td>
                    <td className="px-3 py-2 text-right num">
                      {o.valor_estornar != null ? brlCentavos(Number(o.valor_estornar)) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{dataCurta(o.data_solicitacao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ peças ------------------------------ */
function Kpi({
  eyebrow, valor, rodape, icone, destaque, tom,
}: {
  eyebrow: string;
  valor: React.ReactNode;
  rodape?: React.ReactNode;
  icone: React.ReactNode;
  destaque?: boolean;
  tom?: "neutro";
}) {
  return (
    <div className={cn("card-surface flex flex-col gap-2 p-4", destaque && "border-primary/40")}>
      <div className="flex items-center justify-between">
        <div className="eyebrow">{eyebrow}</div>
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg",
            tom === "neutro" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
          )}
        >
          {icone}
        </div>
      </div>
      <div className={cn("num text-2xl font-bold tracking-tight", destaque && "text-primary")}>{valor}</div>
      {rodape && <div className="text-xs text-muted-foreground">{rodape}</div>}
    </div>
  );
}

function DicaGrafico({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as LinhaSerie & { label: string };
  return (
    <div className="rounded-lg border border-border bg-popover p-2.5 text-xs shadow-md">
      <div className="mb-1 font-semibold">{d.label}</div>
      {/* Tooltip já flutua: aqui vai o valor cheio, não o compacto. */}
      <Linha rotulo="Estornado" valor={valorExato(d.estornado)} />
      <Linha rotulo="Erro de cobrança" valor={`− ${valorExato(d.indevida)}`} />
      <Linha rotulo="Churn real" valor={valorExato(d.churn_real)} forte />
      {d.qtd_nao_classificado > 0 && (
        <Linha rotulo="Sem classificação" valor={`${d.qtd_nao_classificado} · ${valorExato(d.nao_classificado)}`} />
      )}
    </div>
  );
}
function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={cn("num", forte && "font-semibold text-primary")}>{valor}</span>
    </div>
  );
}
