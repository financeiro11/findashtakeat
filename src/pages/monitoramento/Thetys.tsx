/* /monitoramento/thetys — o que a agente fez, o que ela escalou, e o que erramos junto.
 *
 * QUEM ESCREVE A TRILHA NÃO É O HUB. `agente_execucoes` é preenchida pelo runtime
 * da TETS, que roda fora deste repositório. Esta tela LÊ. As duas únicas coisas
 * que ela escreve são humanas: resolver uma exceção e corrigir uma decisão — e as
 * duas passam por RPC (`agente_excecao_resolver`, `agente_execucao_corrigir`),
 * porque `agente_execucoes` não tem policy de UPDATE e um `update` direto daqui
 * devolveria sucesso sem gravar nada.
 *
 * A CORREÇÃO É O PONTO, não o enfeite. `corrigido_por_humano` existe desde a Onda
 * 4 e nunca foi preenchida uma vez, porque não havia porta. É dela que sai o
 * aprendizado: a agente erra a categoria, alguém escreve qual era a certa, e essa
 * linha vira exemplo. Sem tela, o erro só existia na cabeça de quem viu.
 *
 * TRÊS NÚMEROS, NÃO UM. "314 ações" é um número inflado: 65 delas são "consultei
 * um fornecedor". O que ela MUDOU, o que ela CONSULTOU e o que ela LANÇOU (em
 * reais) são três leituras diferentes e ficam separadas — ver `lib/thetys.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useApelidosCadastro } from "@/hooks/useApelidos";
import {
  brlStr, classeDe, detalheDe, diaLocal, excecaoAberta, excecaoVencida, horaLocal,
  modoDe, periodoDe, periodoManual, resumir, resumirExcecoes, rotuloDe, rotuloExcecao,
  textoCorrecao,
  type Atalho, type Excecao, type Execucao, type NomeDe, type Periodo,
} from "@/lib/thetys";
import { exportarExcel, exportarPdf } from "@/lib/thetysExport";
import {
  AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Clock, FileSpreadsheet,
  FileText, Loader2, PencilLine, RefreshCw, Search, X,
} from "lucide-react";

/* `types.ts` é gerado pelo CLI e ainda não conhece as RPCs desta migration.
   Mesmo atalho dos apelidos e das justificativas — some na próxima regeração.
   A chamada fica dentro de uma função, e não num `const rpc = supabase.rpc`:
   arrancar o método do cliente o desliga do seu `this`. */
type RespostaRpc = { error: { message: string } | null };
const chamarRpc = (nome: string, args: Record<string, unknown>): Promise<RespostaRpc> =>
  (supabase as unknown as {
    rpc: (n: string, a?: Record<string, unknown>) => Promise<RespostaRpc>;
  }).rpc(nome, args);

const AGENTE = "thetys";

/* ------------------------------------------------------------------ leitura */

/**
 * Lê uma tabela inteira em páginas de mil.
 *
 * O PostgREST corta em 1000 linhas SEM AVISAR: um mês movimentado devolveria as
 * mil primeiras e o relatório fecharia com um total redondo e errado. Só para de
 * pedir quando a página volta incompleta.
 */
async function lerTudo<T>(
  monta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGINA = 1000;
  const tudo: T[] = [];
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await monta(i, i + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as T[];
    tudo.push(...lote);
    if (lote.length < PAGINA) return tudo;
  }
}

/* ------------------------------------------------------------------ pecinhas */

function Kpi({ rotulo, valor, apoio, tom }: {
  rotulo: string; valor: React.ReactNode; apoio?: string; tom?: "alerta" | "neutro";
}) {
  return (
    <div className={cn("card-surface p-3", tom === "alerta" && "border-amber-500/40")}>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={cn("num mt-0.5 text-[19px] font-semibold leading-tight",
        tom === "alerta" ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
        {valor}
      </p>
      {apoio && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{apoio}</p>}
    </div>
  );
}

const SELO_CLASSE: Record<string, string> = {
  escrita: "bg-primary/10 text-primary",
  leitura: "bg-muted text-muted-foreground",
  desconhecida: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};
const TEXTO_CLASSE: Record<string, string> = {
  escrita: "mudou algo",
  leitura: "consultou",
  desconhecida: "não classificada",
};

const SELO_RESULTADO: Record<string, string> = {
  executado: "text-emerald-600 dark:text-emerald-400",
  proposto: "text-sky-600 dark:text-sky-400",
  escalado: "text-amber-600 dark:text-amber-400",
  falhou: "text-red-600 dark:text-red-400",
};

const SEVERIDADE_COR: Record<string, string> = {
  critica: "border-red-500/50",
  alta: "border-red-500/40",
  media: "border-amber-500/35",
  baixa: "border-border",
};

/* ------------------------------------------------------------------ a tela */

type Corte = "todas" | "escrita" | "leitura";

export default function Thetys() {
  const { profile } = useAuth();
  const { cadastro } = useApelidosCadastro();

  const [atalho, setAtalho] = useState<Atalho>("7dias");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [excecoes, setExcecoes] = useState<Excecao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [exportando, setExportando] = useState<"xlsx" | "pdf" | null>(null);

  const [corte, setCorte] = useState<Corte>("todas");
  const [soProblema, setSoProblema] = useState(false);
  const [busca, setBusca] = useState("");
  const [filaAberta, setFilaAberta] = useState(true);

  /* Qual linha está com o campo de correção aberto, e o que já foi digitado. */
  const [corrigindo, setCorrigindo] = useState<string | null>(null);
  const [textoCorrecaoNovo, setTextoCorrecaoNovo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const periodo: Periodo = useMemo(
    () => (atalho === "personalizado" ? periodoManual(de, ate) ?? periodoDe("7dias") : periodoDe(atalho)),
    [atalho, de, ate],
  );

  /* O uuid do fornecedor vira nome de gente — e o apelido do cadastro vence a
     razão social, pela mesma regra do resto do Hub. */
  const nomeDe: NomeDe = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const f of cadastro) mapa.set(f.id, (f.apelido || "").trim() || f.nome);
    return (id) => (id ? mapa.get(id) ?? null : null);
  }, [cadastro]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [acoes, fila, resolvidas] = await Promise.all([
        lerTudo<Execucao>((i, f) =>
          supabase.from("agente_execucoes").select("*")
            .eq("agente_id", AGENTE)
            .gte("executado_em", periodo.de.toISOString())
            .lte("executado_em", periodo.ate.toISOString())
            .order("executado_em", { ascending: false })
            .range(i, f)),
        /* A fila vem INTEIRA, não recortada pelo período: uma exceção aberta há
           três semanas continua sendo trabalho de hoje, e sumir do painel porque
           o filtro é "ontem" seria esconder justamente a que mais atrasou. */
        lerTudo<Excecao>((i, f) =>
          supabase.from("agente_excecoes").select("*")
            .eq("agente_id", AGENTE)
            .in("status", ["aberta", "em_analise"])
            .order("vence_em", { ascending: true })
            .range(i, f)),
        /* As resolvidas, só as do período — é o que o relatório conta como
           trabalho de quem tratou a fila. */
        lerTudo<Excecao>((i, f) =>
          supabase.from("agente_excecoes").select("*")
            .eq("agente_id", AGENTE)
            .in("status", ["resolvida", "descartada"])
            .gte("resolvido_em", periodo.de.toISOString())
            .lte("resolvido_em", periodo.ate.toISOString())
            .range(i, f)),
      ]);
      setExecucoes(acoes);
      setExcecoes([...fila, ...resolvidas]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [periodo.de, periodo.ate]);

  useEffect(() => { carregar(); }, [carregar]);

  const resumo = useMemo(() => resumir(execucoes), [execucoes]);
  const resumoFila = useMemo(
    () => resumirExcecoes(excecoes, { de: periodo.de, ate: periodo.ate }),
    [excecoes, periodo.de, periodo.ate],
  );

  const abertas = useMemo(
    () => excecoes.filter(excecaoAberta)
      .sort((a, b) => Number(excecaoVencida(b)) - Number(excecaoVencida(a))
        || (a.vence_em ?? "").localeCompare(b.vence_em ?? "")),
    [excecoes],
  );

  /* A trilha filtrada. A busca varre o detalhe JÁ TRADUZIDO, não o JSON cru:
     procurar por "Central Lola" precisa achar a linha em que o banco só guardou
     o uuid do fornecedor. */
  const trilha = useMemo(() => {
    const alvo = busca.trim().toLowerCase();
    return execucoes.filter((e) => {
      if (corte !== "todas" && classeDe(e) !== corte) return false;
      if (soProblema && e.resultado !== "falhou" && e.resultado !== "escalado") return false;
      if (!alvo) return true;
      const texto = `${rotuloDe(e)} ${detalheDe(e, nomeDe)} ${e.tarefa} ${e.erro ?? ""} ${textoCorrecao(e)}`;
      return texto.toLowerCase().includes(alvo);
    });
  }, [execucoes, corte, soProblema, busca, nomeDe]);

  /* Agrupada por dia local — ver `diaLocal`: por UTC as ações do fim da tarde
     cairiam no dia seguinte. */
  const porDia = useMemo(() => {
    const mapa = new Map<string, Execucao[]>();
    for (const e of trilha) {
      const dia = diaLocal(e.executado_em);
      const lista = mapa.get(dia) ?? [];
      lista.push(e);
      mapa.set(dia, lista);
    }
    return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [trilha]);

  /* ------------------------------------------------------------- os gestos */

  async function exportar(formato: "xlsx" | "pdf") {
    setExportando(formato);
    try {
      const dados = {
        periodo, execucoes, excecoes, nome: nomeDe, autor: profile?.nome ?? null,
      };
      if (formato === "xlsx") await exportarExcel(dados);
      else await exportarPdf(dados);
    } catch (e) {
      toast.error(`Não deu para gerar o arquivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportando(null);
    }
  }

  async function salvarCorrecao(execucao: Execucao) {
    setSalvando(true);
    const texto = textoCorrecaoNovo.trim();
    const { error } = await chamarRpc("agente_execucao_corrigir", {
      p_execucao_id: execucao.id,
      p_texto: texto,
      p_campos: null,
    });
    setSalvando(false);

    if (error) { toast.error(`Não deu para gravar: ${error.message}`); return; }

    /* Atualiza a linha na mão em vez de reler tudo: recarregar um mês inteiro
       para carimbar uma linha faz a tela piscar e perde a rolagem de quem está
       no meio da trilha. */
    setExecucoes((antes) => antes.map((e) => e.id === execucao.id ? {
      ...e,
      corrigido_por_humano: !!texto,
      correcao: texto ? { texto, campos: null } : null,
      corrigido_em: texto ? new Date().toISOString() : null,
    } : e));
    setCorrigindo(null);
    setTextoCorrecaoNovo("");
    toast.success(texto ? "Correção registrada." : "Correção desfeita.");
  }

  async function moverExcecao(x: Excecao, status: Excecao["status"], resolucao?: string) {
    const { error } = await chamarRpc("agente_excecao_resolver", {
      p_excecao_id: x.id, p_status: status, p_resolucao: resolucao ?? null,
    });
    if (error) { toast.error(`Não deu para mover: ${error.message}`); return; }

    setExcecoes((antes) => antes.map((e) => e.id === x.id ? {
      ...e, status,
      resolucao: resolucao ?? null,
      resolvido_em: status === "resolvida" || status === "descartada" ? new Date().toISOString() : null,
    } : e));
    toast.success(
      status === "resolvida" ? "Exceção resolvida."
        : status === "descartada" ? "Exceção descartada."
        : "Exceção marcada como em análise.",
    );
  }

  /* ------------------------------------------------------------- desenho */

  const pill = (ativo: boolean) =>
    cn("rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
      ativo ? "border-primary bg-primary/10 font-medium text-primary"
            : "border-border text-muted-foreground hover:text-foreground");

  return (
    <div className="space-y-3.5 px-5 pb-7 pt-3.5">
      {/* ---------------- cabeçalho ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">TETS</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(265_62%_55%/0.14)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(265_62%_45%)] dark:text-[hsl(265_62%_72%)]">
              <Bot className="h-3 w-3" /> agente
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">
            O que ela fez, decisão a decisão. A trilha vem do runtime dela — daqui só se lê,
            se trata o que ela escalou e se corrige o que ela errou.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button className="ghost-btn" onClick={() => exportar("xlsx")}
            disabled={!!exportando || carregando} title="Baixar a planilha do período">
            {exportando === "xlsx"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <FileSpreadsheet className="h-3.5 w-3.5" />}
            Excel
          </button>
          <button className="ghost-btn" onClick={() => exportar("pdf")}
            disabled={!!exportando || carregando} title="Baixar o relatório do período">
            {exportando === "pdf"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <FileText className="h-3.5 w-3.5" />}
            PDF
          </button>
          <button className="ghost-btn ghost-icone" onClick={carregar} disabled={carregando} title="Reler agora">
            {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* ---------------- período ---------------- */}
      <div className="card-surface flex flex-wrap items-center gap-2 p-2.5">
        {([["ontem", "Ontem"], ["hoje", "Hoje"], ["7dias", "7 dias"],
           ["mes", "Este mês"], ["mes_passado", "Mês passado"]] as [Atalho, string][])
          .map(([chave, texto]) => (
            <button key={chave} className={pill(atalho === chave)} onClick={() => setAtalho(chave)}>
              {texto}
            </button>
          ))}

        <span className="mx-1 h-4 w-px bg-border" />

        <input
          type="date" value={de}
          onChange={(e) => { setDe(e.target.value); if (e.target.value && ate) setAtalho("personalizado"); }}
          className="h-7 rounded-md border border-border bg-background px-2 text-[11.5px]"
          aria-label="Data inicial"
        />
        <span className="text-[11.5px] text-muted-foreground">a</span>
        <input
          type="date" value={ate}
          onChange={(e) => { setAte(e.target.value); if (de && e.target.value) setAtalho("personalizado"); }}
          className="h-7 rounded-md border border-border bg-background px-2 text-[11.5px]"
          aria-label="Data final"
        />

        <span className="ml-auto text-[11.5px] text-muted-foreground">{periodo.rotulo}</span>
      </div>

      {erro && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-[12.5px] text-red-700 dark:text-red-400">
          Não deu para ler a trilha da agente: {erro}
        </div>
      )}

      {/* O ensaio precisa estar escrito na tela, não só no relatório: um painel em
          que tudo é teste, lido como produção, conta trabalho que não aconteceu. */}
      {!carregando && resumo.emTeste > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12.5px] text-amber-800 dark:text-amber-300">
          <span className="font-semibold">
            {resumo.emTeste === resumo.total
              ? "Todas as ações deste período rodaram em modo de teste."
              : `${resumo.emTeste} de ${resumo.total} ações rodaram em modo de teste.`}
          </span>{" "}
          O runtime carimba <code className="mono text-[11.5px]">_modo</code> na entrada; enquanto ele
          disser <em>teste</em>, o que está aqui é ensaio.
        </div>
      )}

      {/* ---------------- os números ---------------- */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
        <Kpi rotulo="Mudou algo" valor={resumo.escritas}
          apoio={`de ${resumo.total} ações no período`} />
        <Kpi rotulo="Só consultou" valor={resumo.leituras}
          apoio="leituras, sem escrever em lugar nenhum" />
        <Kpi rotulo="Lançou" valor={brlStr(resumo.lancamentos.valor)}
          apoio={`${resumo.lancamentos.n} conta(s) e obrigação(ões)`} />
        <Kpi rotulo="Falhas" valor={resumo.falhas}
          apoio={resumo.escaladas ? `${resumo.escaladas} escalada(s)` : "nenhuma escalada"}
          tom={resumo.falhas ? "alerta" : "neutro"} />
        <Kpi rotulo="Fila do humano" valor={resumoFila.abertas}
          apoio={resumoFila.vencidas ? `${resumoFila.vencidas} vencida(s)` : "nenhuma vencida"}
          tom={resumoFila.vencidas ? "alerta" : "neutro"} />
      </div>

      {/* ---------------- a fila do humano ---------------- */}
      <section className="card-surface">
        <button
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
          onClick={() => setFilaAberta((v) => !v)}
        >
          {filaAberta ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="text-[13.5px] font-semibold">Fila do humano</span>
          <span className="text-[11.5px] text-muted-foreground">
            {abertas.length} aberta(s){resumoFila.vencidas ? ` · ${resumoFila.vencidas} fora do prazo` : ""}
            {resumoFila.resolvidasNoPeriodo ? ` · ${resumoFila.resolvidasNoPeriodo} resolvida(s) no período` : ""}
          </span>
        </button>

        {filaAberta && (
          <div className="border-t border-border">
            {!abertas.length ? (
              <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
                Nada esperando decisão humana.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {abertas.map((x) => (
                  <ItemExcecao key={x.id} x={x} onMover={moverExcecao} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ---------------- a trilha ---------------- */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[13.5px] font-semibold">A trilha</h2>
          <div className="flex items-center gap-1.5">
            {([["todas", "Tudo"], ["escrita", "Mudou algo"], ["leitura", "Só consultou"]] as [Corte, string][])
              .map(([chave, texto]) => (
                <button key={chave} className={pill(corte === chave)} onClick={() => setCorte(chave)}>
                  {texto}
                </button>
              ))}
            <button className={pill(soProblema)} onClick={() => setSoProblema((v) => !v)}>
              Falhas e escaladas
            </button>
          </div>

          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="fornecedor, título, tarefa…"
              className="h-7 w-56 rounded-md border border-border bg-background pl-7 pr-2 text-[11.5px]"
            />
          </div>
          <span className="text-[11.5px] text-muted-foreground">
            {trilha.length} de {execucoes.length}
          </span>
        </div>

        {carregando ? (
          <div className="card-surface flex items-center gap-2 p-4 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> lendo a trilha…
          </div>
        ) : !porDia.length ? (
          <div className="card-surface p-4 text-[12.5px] text-muted-foreground">
            {execucoes.length
              ? "Nenhuma ação bate com este filtro."
              : "Nenhuma ação registrada neste período."}
          </div>
        ) : (
          porDia.map(([dia, acoes]) => (
            <div key={dia} className="card-surface overflow-hidden">
              <div className="flex items-baseline gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
                <span className="text-[12px] font-semibold">
                  {new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", {
                    weekday: "long", day: "2-digit", month: "long",
                  })}
                </span>
                <span className="text-[11px] text-muted-foreground">{acoes.length} ação(ões)</span>
              </div>
              <ul className="divide-y divide-border">
                {acoes.map((e) => (
                  <LinhaAcao
                    key={e.id}
                    e={e}
                    nomeDe={nomeDe}
                    corrigindo={corrigindo === e.id}
                    texto={textoCorrecaoNovo}
                    salvando={salvando}
                    onAbrir={() => { setCorrigindo(e.id); setTextoCorrecaoNovo(textoCorrecao(e)); }}
                    onFechar={() => { setCorrigindo(null); setTextoCorrecaoNovo(""); }}
                    onTexto={setTextoCorrecaoNovo}
                    onSalvar={() => salvarCorrecao(e)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ uma exceção */

function ItemExcecao({ x, onMover }: {
  x: Excecao;
  onMover: (x: Excecao, status: Excecao["status"], resolucao?: string) => Promise<void>;
}) {
  const [resolvendo, setResolvendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const vencida = excecaoVencida(x);

  const agir = async (status: Excecao["status"], resolucao?: string) => {
    setOcupado(true);
    await onMover(x, status, resolucao);
    setOcupado(false);
    setResolvendo(false);
    setTexto("");
  };

  return (
    <li className={cn("border-l-[3px] px-3 py-2.5", SEVERIDADE_COR[x.severidade] ?? "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] font-medium">{x.titulo}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {rotuloExcecao(x.tipo)}
            </span>
            {x.status === "em_analise" && (
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400">
                em análise
              </span>
            )}
            {vencida && (
              <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                <AlertTriangle className="h-3 w-3" /> fora do prazo
              </span>
            )}
          </div>
          {x.descricao && (
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{x.descricao}</p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            aberta {horaLocal(x.criado_em)}
            {x.vence_em && <> · vence {horaLocal(x.vence_em)}</>}
            {x.valor != null && <> · {brlStr(x.valor)}</>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {x.status === "aberta" && (
            <button className="ghost-btn" disabled={ocupado} onClick={() => agir("em_analise")}>
              <Clock className="h-3.5 w-3.5" /> Estou vendo
            </button>
          )}
          <button className="ghost-btn" disabled={ocupado} onClick={() => setResolvendo((v) => !v)}>
            <Check className="h-3.5 w-3.5" /> Resolver
          </button>
          <button className="ghost-btn" disabled={ocupado} onClick={() => agir("descartada")}
            title="Não era problema — sai da fila sem virar aprendizado">
            <X className="h-3.5 w-3.5" /> Descartar
          </button>
        </div>
      </div>

      {resolvendo && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && texto.trim()) agir("resolvida", texto); }}
            placeholder="O que foi feito? (fica registrado na exceção)"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11.5px]"
          />
          <button className="ghost-btn" disabled={ocupado || !texto.trim()}
            onClick={() => agir("resolvida", texto)}>
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Confirmar
          </button>
        </div>
      )}
    </li>
  );
}

/* --------------------------------------------------------- uma ação */

function LinhaAcao({ e, nomeDe, corrigindo, texto, salvando, onAbrir, onFechar, onTexto, onSalvar }: {
  e: Execucao;
  nomeDe: NomeDe;
  corrigindo: boolean;
  texto: string;
  salvando: boolean;
  onAbrir: () => void;
  onFechar: () => void;
  onTexto: (t: string) => void;
  onSalvar: () => void;
}) {
  const classe = classeDe(e);
  const detalhe = detalheDe(e, nomeDe);
  const correcao = textoCorrecao(e);
  const teste = modoDe(e) === "teste";

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="num mt-0.5 w-[38px] shrink-0 text-[11px] text-muted-foreground">
          {new Date(e.executado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] font-medium">{rotuloDe(e)}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px]", SELO_CLASSE[classe])}>
              {TEXTO_CLASSE[classe]}
            </span>
            {e.resultado !== "executado" && (
              <span className={cn("text-[11px] font-semibold", SELO_RESULTADO[e.resultado])}>
                {e.resultado}
              </span>
            )}
            {teste && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                teste
              </span>
            )}
          </div>

          {detalhe && (
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{detalhe}</p>
          )}
          {e.erro && (
            <p className="mt-0.5 text-[11.5px] leading-snug text-red-600 dark:text-red-400">{e.erro}</p>
          )}
          {correcao && !corrigindo && (
            <p className="mt-1 rounded border border-primary/30 bg-primary/5 px-2 py-1 text-[11.5px] leading-snug text-foreground">
              <span className="font-medium">Correção:</span> {correcao}
              {e.corrigido_em && (
                <span className="text-muted-foreground"> · {horaLocal(e.corrigido_em)}</span>
              )}
            </p>
          )}

          {corrigindo && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                autoFocus
                value={texto}
                onChange={(ev) => onTexto(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") onSalvar();
                  if (ev.key === "Escape") onFechar();
                }}
                placeholder="O que deveria ter acontecido? (vazio desfaz a correção)"
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11.5px]"
              />
              <button className="ghost-btn" disabled={salvando} onClick={onSalvar}>
                {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Gravar
              </button>
              <button className="ghost-btn ghost-icone" onClick={onFechar} title="Cancelar">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {!corrigindo && (
          <button
            className="ghost-btn ghost-icone shrink-0"
            onClick={onAbrir}
            title={correcao ? "Editar a correção" : "Ela errou aqui? Registre o que era certo"}
          >
            <PencilLine className={cn("h-3.5 w-3.5", correcao && "text-primary")} />
          </button>
        )}
      </div>
    </li>
  );
}
