/**
 * "O que fazer nesta fatura" — o painel consultivo do cartão.
 *
 * O resto desta tela é espelho: diz que a SYMPLA subiu 15,8 mil e para aí. Aqui
 * cada sinal vem com o que ele provavelmente É e com quem conferir — "a Sympla é
 * praça de ingresso e show, provavelmente são ingressos, fale com Eventos".
 *
 * A DIVISÃO DE TRABALHO (igual à das justificativas da DRE): o SINAL e os NÚMEROS
 * são determinísticos, calculados em `_shared/cartao-sinais.ts`; a IA só redige em
 * cima deles. Por isso o card mostra a série mês a mês e os fatos ao lado do
 * texto: quem lê confere a hipótese sem sair da tela, e o que for invenção morre
 * ali.
 *
 * Nada aqui é recalculado no cliente. Diferente dos KPIs e das matrizes, a
 * recomendação está ancorada na COMPETÊNCIA e foi escrita contra a história
 * inteira do fornecedor — recortar o período não muda o fato de o HubSpot ter
 * faltado em mai/26. É o que permite guardar o texto sem ele discordar do filtro
 * à vista.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, ClipboardList, ExternalLink, Eye, Flag, Flame, Loader2,
  Pencil, RotateCcw, Sparkles, Trash2, TrendingUp, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmtBRLStr, labelDeCompetencia } from "./fmt";
import { fmtBRL } from "./valores";

export type SinalRecomendacao = "pico" | "ausente" | "dobrada";

export type Recomendacao = {
  id: string;
  competencia: string;
  estabelecimento: string;
  sinal: SinalRecomendacao;
  nivel: "critico" | "atencao" | "info";
  titulo: string;
  valor: number | null;
  valor_referencia: number | null;
  razao: number | null;
  lancamentos: number | null;
  /** A prova: o gasto mês a mês, a história toda. */
  serie: { m: string; v: number; n: number }[];
  /** As frases que a IA NÃO escreveu — os fatos que ela recebeu. */
  fatos: string[];
  texto: string;
  acao: string | null;
  com_quem: string | null;
  confianca: "alta" | "media" | "baixa" | null;
  status: "novo" | "aceito" | "descartado";
  texto_editado: string | null;
  tarefa_id: string | null;
  gerado_em: string;
};

/** O que vale é o que a pessoa escreveu; o rascunho da IA é o padrão. */
const textoFinal = (r: Recomendacao) => (r.texto_editado?.trim() || r.texto || "").trim();

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a tabela nem as
   funções da migration 20260811120000. O mesmo atalho tipado que Cartao.tsx usa —
   some quando os tipos forem regerados. */
const db = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => Promise<{ data: Recomendacao[] | null; error: { message: string } | null }>;
    };
  };
  rpc: (fn: string, params: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { message: string } | null }>;
};

/* ============================================================
 *  Carga + geração
 * ============================================================ */

export function useRecomendacoes(competencia: string | null) {
  const [recomendacoes, setRecomendacoes] = useState<Recomendacao[]>([]);
  const [gerando, setGerando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  /* A geração automática roda no MÁXIMO uma vez por montagem: sem esta trava o
     StrictMode dispara duas chamadas de IA para a mesma fatura, e um erro na
     função viraria um laço de tentativas a cada re-render. */
  const jaTentou = useRef<string | null>(null);

  const recarregar = useCallback(async (): Promise<Recomendacao[]> => {
    if (!competencia) { setRecomendacoes([]); return []; }
    setCarregando(true);
    const { data, error } = await db.from("cartao_recomendacoes").select("*").eq("competencia", competencia);
    setCarregando(false);
    if (error) {
      // Acessório: falhou, a tela continua com os números em vez de derrubar a página.
      setRecomendacoes([]);
      return [];
    }
    const lista = (data ?? []).map((r) => ({
      ...r,
      // Vêm como jsonb: uma linha antiga pode trazer algo que não é lista, e o
      // render assume que é.
      serie: Array.isArray(r.serie) ? r.serie : [],
      fatos: Array.isArray(r.fatos) ? r.fatos : [],
    }));
    setRecomendacoes(lista);
    return lista;
  }, [competencia]);

  const gerar = useCallback(async (force: boolean) => {
    if (!competencia) return;
    setGerando(true);
    const { data, error } = await supabase.functions.invoke("cartao-recomendar", {
      body: { competencia, force },
    });
    setGerando(false);

    const resp = data as { geradas?: number; candidatos?: number; lotes_falhos?: number; falha_ia?: string; error?: string } | null;
    if (error || resp?.error) {
      toast.error(`Não consegui gerar as recomendações: ${resp?.error ?? error?.message ?? "erro desconhecido"}`);
      return;
    }
    // A redação pode falhar sem a chamada falhar (o lote é engolido lá dentro).
    // Sem isto, "0 geradas" chega na tela com cara de "não havia o que recomendar".
    if (resp?.lotes_falhos) {
      toast.error(`A IA não redigiu as recomendações — ${resp.falha_ia ?? "sem detalhe"}`);
    } else if (force) {
      toast.success(
        resp?.geradas
          ? `${resp.geradas} recomendação(ões) reescrita(s).`
          : "Nada fora da curva nesta fatura.",
      );
    }
    await recarregar();
  }, [competencia, recarregar]);

  /* Primeira carga. Fatura sem NENHUMA recomendação salva gera sozinha, uma vez:
     é o que faz o texto já estar na tela quando a fatura nova chega, sem
     ninguém ter de pedir. Se o detector não achar nada, a função volta sem
     chamar a IA — então a tentativa a cada visita custa duas leituras de banco,
     não uma redação. */
  useEffect(() => {
    if (!competencia) return;
    (async () => {
      const lista = await recarregar();
      if (lista.length || jaTentou.current === competencia) return;
      jaTentou.current = competencia;
      await gerar(false);
    })();
  }, [competencia, recarregar, gerar]);

  return { recomendacoes, recarregarRecomendacoes: recarregar, gerarRecomendacoes: gerar, gerando, carregando };
}

/* ============================================================
 *  O painel
 * ============================================================ */

const ICONE_NIVEL = { critico: Flame, atencao: AlertTriangle, info: TrendingUp } as const;

const ROTULO_SINAL: Record<SinalRecomendacao, string> = {
  pico: "pico sobre a própria história",
  ausente: "recorrente que não veio",
  dobrada: "possível cobrança dobrada",
};

export function PainelRecomendacoes({
  recomendacoes, competencia, gerando, onGerar, onMudou, onMarcar, onVerLancamentos,
}: {
  recomendacoes: Recomendacao[];
  competencia: string | null;
  gerando: boolean;
  onGerar: (force: boolean) => void;
  onMudou: () => void;
  /** Reaproveita a bandeirinha da matriz — a marca é por estabelecimento. */
  onMarcar: (estabelecimento: string, nota: string) => void;
  onVerLancamentos: (estabelecimento: string, competencia: string) => void;
}) {
  const [mostrarDescartadas, setMostrarDescartadas] = useState(false);

  const { vivas, descartadas } = useMemo(() => {
    const ordem = { critico: 0, atencao: 1, info: 2 } as const;
    const ordenar = (a: Recomendacao, b: Recomendacao) =>
      ordem[a.nivel] - ordem[b.nivel] ||
      Math.abs(Number(b.valor ?? 0) - Number(b.valor_referencia ?? 0)) -
        Math.abs(Number(a.valor ?? 0) - Number(a.valor_referencia ?? 0));
    return {
      vivas: recomendacoes.filter((r) => r.status !== "descartado").sort(ordenar),
      descartadas: recomendacoes.filter((r) => r.status === "descartado").sort(ordenar),
    };
  }, [recomendacoes]);

  const novas = vivas.filter((r) => r.status === "novo").length;
  const label = competencia ? labelDeCompetencia(competencia) : "—";
  const visiveis = mostrarDescartadas ? [...vivas, ...descartadas] : vivas;

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
          <Zap className="h-4 w-4 text-primary" /> O que fazer nesta fatura
          <span className="text-[12px] font-normal text-muted-foreground">· {label}</span>
        </span>

        {novas > 0 && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
            {novas} sem conferir
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {descartadas.length > 0 && (
            <button
              onClick={() => setMostrarDescartadas((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-secondary"
            >
              <Eye className="h-3 w-3" />
              {mostrarDescartadas ? "Ocultar" : "Ver"} {descartadas.length} descartada{descartadas.length > 1 ? "s" : ""}
            </button>
          )}
          <button
            onClick={() => onGerar(true)}
            disabled={gerando || !competencia}
            title="Reescreve as recomendações desta fatura, inclusive as já conferidas"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium transition hover:bg-secondary disabled:opacity-50"
          >
            {gerando
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Gerando…</>
              : <><Sparkles className="h-3 w-3" /> Regerar</>}
          </button>
        </div>
      </div>

      {visiveis.length ? (
        <div className="grid gap-px bg-border md:grid-cols-2">
          {visiveis.map((r) => (
            <Card
              key={r.id}
              r={r}
              onMudou={onMudou}
              onMarcar={onMarcar}
              onVerLancamentos={onVerLancamentos}
            />
          ))}
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-[12.5px] leading-relaxed text-muted-foreground">
          {gerando
            ? "Lendo a fatura contra a história de cada fornecedor…"
            : <>
                Nenhum sinal nesta fatura: nenhum estabelecimento veio 3× acima da própria mediana, nenhuma
                cobrança mensal faltou e nenhum valor dobrou sem lançamento a mais.
              </>}
        </p>
      )}

      <p className="border-t border-border px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
        O sinal e os números são calculados dos lançamentos, sempre com a mesma regra. A IA escreve só a leitura
        (o que o estabelecimento provavelmente é e com quem conferir) — passe o olho na série antes de repassar.
      </p>
    </div>
  );
}

/* ============================================================
 *  Um card
 * ============================================================ */

function Card({
  r, onMudou, onMarcar, onVerLancamentos,
}: {
  r: Recomendacao;
  onMudou: () => void;
  onMarcar: (estabelecimento: string, nota: string) => void;
  onVerLancamentos: (estabelecimento: string, competencia: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(textoFinal(r));
  const [salvando, setSalvando] = useState(false);
  const Icone = ICONE_NIVEL[r.nivel];

  const decidir = async (status: Recomendacao["status"] | null, texto?: string | null) => {
    setSalvando(true);
    const { error } = await db.rpc("cartao_recomendacao_decidir", {
      p_id: r.id, p_status: status, p_texto: texto ?? null,
    });
    setSalvando(false);
    if (error) { toast.error("Não consegui salvar: " + error.message); return; }
    setEditando(false);
    onMudou();
  };

  const criarTarefa = async () => {
    setSalvando(true);
    const { error } = await db.rpc("cartao_recomendacao_tarefa", { p_id: r.id });
    setSalvando(false);
    if (error) { toast.error("Não consegui criar a tarefa: " + error.message); return; }
    toast.success("Tarefa criada no Backlog de /tarefas.");
    onMudou();
  };

  return (
    <article className={cn("bg-card p-4", r.status === "descartado" && "opacity-55")}>
      {/* ---- cabeçalho ---- */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className={cn("insight-tag", r.nivel)}>
          <Icone className="h-3 w-3" /> {r.nivel === "critico" ? "CRÍTICO" : r.nivel === "atencao" ? "ATENÇÃO" : "INFO"}
        </span>
        <span className="shrink-0 text-[10.5px] text-muted-foreground">{ROTULO_SINAL[r.sinal]}</span>
      </div>

      <h4 className="text-[13.5px] font-semibold leading-snug">{r.titulo}</h4>

      <Serie serie={r.serie} />

      {/* ---- os números, para conferir a frase ---- */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
        <span className="num font-semibold text-foreground">{fmtBRL(Number(r.valor ?? 0))}</span>
        <span>nesta fatura</span>
        <span className="opacity-60">·</span>
        <span>normal</span>
        <span className="num font-medium text-foreground/80">{fmtBRL(Number(r.valor_referencia ?? 0))}</span>
        {r.lancamentos ? <span className="opacity-70">· {r.lancamentos} lanç.</span> : null}
      </div>

      {/* ---- a leitura ---- */}
      <div className="mt-2.5">
        {editando ? (
          <textarea
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            rows={4}
            autoFocus
            className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-[12px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">
            {textoFinal(r) || "—"}
          </p>
        )}
      </div>

      {/* ---- a ação: o motivo de o painel existir ---- */}
      {!editando && r.acao && (
        <div className="mt-2.5 flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-2">
          <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-[12px] font-medium leading-relaxed text-foreground">{r.acao}</p>
            {r.com_quem && (
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">com {r.com_quem}</p>
            )}
          </div>
        </div>
      )}

      {/* ---- os fatos: o que a IA recebeu, não o que ela escreveu ---- */}
      {!editando && !!r.fatos.length && (
        <details className="mt-2 group">
          <summary className="cursor-pointer list-none text-[10.5px] text-muted-foreground hover:text-foreground">
            <Sparkles className="mr-1 inline h-2.5 w-2.5" />
            {r.texto_editado
              ? "Reescrito por você · ver os números que geraram o sinal"
              : <>Rascunho da IA{r.confianca && ` · confiança ${r.confianca}`} · ver os números que geraram o sinal</>}
          </summary>
          <ul className="mt-1.5 space-y-1 border-l-2 border-border pl-2.5">
            {r.fatos.map((f, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-muted-foreground">{f}</li>
            ))}
          </ul>
        </details>
      )}

      {/* ---- ações ---- */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
        {editando ? (
          <>
            <button
              onClick={() => decidir(null, rascunho)}
              disabled={salvando}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {salvando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Salvar
            </button>
            <button
              onClick={() => { setRascunho(textoFinal(r)); setEditando(false); }}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-secondary"
            >
              Cancelar
            </button>
            {r.texto_editado && (
              <button
                onClick={() => decidir(null, "")}
                disabled={salvando}
                title="Descarta a sua reescrita e volta a valer o rascunho da IA"
                className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
              >
                <RotateCcw className="h-2.5 w-2.5" /> Voltar ao rascunho
              </button>
            )}
          </>
        ) : (
          <>
            {r.status !== "aceito" && r.status !== "descartado" && (
              <button
                onClick={() => decidir("aceito")}
                disabled={salvando}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-card px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:bg-emerald-50 disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Conferi
              </button>
            )}
            {r.status === "aceito" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-[10.5px] font-semibold text-emerald-800">
                <Check className="h-3 w-3" /> conferido
              </span>
            )}

            {r.tarefa_id ? (
              <Link
                to="/tarefas"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium transition hover:bg-secondary"
                title="Esta recomendação já virou tarefa no quadro"
              >
                <ExternalLink className="h-3 w-3" /> Ver tarefa
              </Link>
            ) : (
              <button
                onClick={criarTarefa}
                disabled={salvando || r.status === "descartado"}
                title="Abre a ação como tarefa no Backlog de /tarefas, com o texto e os números no corpo"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium transition hover:bg-secondary disabled:opacity-50"
              >
                <ClipboardList className="h-3 w-3" /> Criar tarefa
              </button>
            )}

            <button
              onClick={() => onMarcar(r.estabelecimento, r.acao || r.titulo)}
              title="Marca o estabelecimento para revisão na matriz — a marca vale para as próximas faturas também"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium transition hover:bg-secondary"
            >
              <Flag className="h-3 w-3" /> Marcar
            </button>

            <button
              onClick={() => onVerLancamentos(r.estabelecimento, r.competencia)}
              title="Abre a aba de detalhe já filtrada neste estabelecimento e nesta fatura"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium transition hover:bg-secondary"
            >
              <Eye className="h-3 w-3" /> Lançamentos
            </button>

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setEditando(true)}
                title="Reescrever o texto"
                className="rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
              </button>
              {r.status === "descartado" ? (
                <button
                  onClick={() => decidir("novo")}
                  disabled={salvando}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                >
                  <RotateCcw className="h-2.5 w-2.5" /> Restaurar
                </button>
              ) : (
                <button
                  onClick={() => decidir("descartado")}
                  disabled={salvando}
                  title="Some do painel. Dá para restaurar depois, e a regeração não a traz de volta."
                  className="rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

/**
 * A série mês a mês, em barras. É a prova do sinal: no `pico` a última barra
 * estoura contra o resto, no `ausente` ela simplesmente não existe.
 *
 * Feita com `div` e não com SVG de propósito — em `<text>` o hover de valor não
 * funciona (`comValorExato` devolve um `<span>`, que o SVG descarta), e aqui o
 * número cheio no hover é o que evita ter de abrir os lançamentos para conferir.
 */
function Serie({ serie }: { serie: { m: string; v: number; n: number }[] }) {
  if (serie.length < 2) return null;
  const max = Math.max(...serie.map((p) => Number(p.v) || 0), 1);

  return (
    <div className="mt-2.5 flex h-9 items-end gap-[3px]">
      {serie.map((p, i) => {
        const v = Number(p.v) || 0;
        const ultima = i === serie.length - 1;
        return (
          <div
            key={p.m}
            className="group/bar flex h-full flex-1 flex-col justify-end"
            title={`${labelDeCompetencia(p.m)}: ${v > 0 ? fmtBRLStr(v) : "não veio"}`}
          >
            <div
              className={cn(
                "w-full rounded-t-[2px] transition-all",
                v === 0
                  ? "border-b-2 border-dashed border-muted-foreground/40"
                  : ultima ? "bg-primary" : "bg-primary/25",
              )}
              style={{ height: v === 0 ? undefined : `${Math.max(4, (v / max) * 100)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
