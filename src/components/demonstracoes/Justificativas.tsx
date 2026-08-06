import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageSquareText, MessageSquareWarning, Copy, Check, Pencil, Trash2, RotateCcw, Sparkles, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chaveCelula } from "@/components/demonstracoes/Reclassificacoes";

/* ---------------------------------------------------------------------------
 * Justificativa da variação, na célula da DRE/DFC.
 *
 * É o comentário que hoje é escrito à mão no Tracker de Orçamento. A máquina faz
 * o rascunho a partir dos lançamentos do Omie; aqui a pessoa lê, confere contra
 * os drivers (que vêm salvos junto), corrige se precisar e copia para o tracker.
 *
 * Por que Popover e não o `title` da célula, como o alerta de reclassificação:
 * o texto tem três frases, uma lista de fornecedores e três botões. Um tooltip
 * de sistema não segura isso — e, principalmente, não dá para SELECIONAR nem
 * copiar, que é o objetivo final do recurso.
 * ------------------------------------------------------------------------- */

export type DriverJustificativa = {
  contraparte: string;
  categoria?: string | null;
  atual: number;
  anterior: number;
  delta: number;
  movimento: "entrou" | "saiu" | "aumentou" | "reduziu";
  fmtAtual?: string;
  fmtAnterior?: string;
  fmtDelta?: string;
};

export type Justificativa = {
  id: string;
  tipo: "dre" | "dfc";
  rubrica: string;
  mes: string;
  mes_anterior: string | null;
  valor: number | null;
  valor_anterior: number | null;
  delta: number | null;
  delta_pct: number | null;
  despesa: boolean;
  texto: string;
  texto_editado: string | null;
  drivers: DriverJustificativa[];
  cobertura: number | null;
  confianca: "alta" | "media" | "baixa" | null;
  sinais: { codigo: string; detalhe: string }[];
  status: "novo" | "aceito" | "descartado";
  gerado_em: string;
};

/** O que vale é o que a pessoa escreveu; o rascunho é o padrão. */
export const textoFinal = (j: Justificativa) => (j.texto_editado?.trim() || j.texto || "").trim();

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a tabela nem a
   função criadas na migration 20260804160000. Este atalho tipado evita `any`
   solto pelo arquivo — some quando os tipos forem regerados. */
const db = supabase as unknown as {
  from: (tabela: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{
        data: Justificativa[] | null;
        error: { message: string } | null;
      }>;
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
};

const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rotuloMes(k: string | null): string {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(k ?? "");
  if (!m) return k ?? "—";
  const i = EN.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return i >= 0 ? `${MES_PT[i]}/${m[2]}` : k!;
}

/* ============================================================
 *  Carga
 * ============================================================ */

export function useJustificativas(tipo: "dre" | "dfc") {
  const [mapa, setMapa] = useState<Map<string, Justificativa>>(new Map());
  const [carregando, setCarregando] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await db
      .from("demonstracoes_justificativas")
      .select("*")
      .eq("tipo", tipo);
    setCarregando(false);
    if (error) {
      // Acessório, como o alerta de reclassificação: falhou, a demonstração
      // continua na tela sem marca nenhuma em vez de derrubar a página.
      setMapa(new Map());
      return;
    }
    const m = new Map<string, Justificativa>();
    for (const r of data ?? []) {
      m.set(chaveCelula(r.rubrica, r.mes), {
        ...r,
        // Vêm como jsonb: uma linha antiga ou um insert manual pode trazer algo
        // que não é lista, e o render assume que é.
        drivers: Array.isArray(r.drivers) ? r.drivers : [],
        sinais: Array.isArray(r.sinais) ? r.sinais : [],
      });
    }
    setMapa(m);
  }, [tipo]);

  useEffect(() => { recarregar(); }, [recarregar]);

  return { justificativas: mapa, recarregarJustificativas: recarregar, carregandoJustificativas: carregando };
}

/* ============================================================
 *  Marca na célula
 * ============================================================ */

const CORES = {
  novo: "text-sky-700",
  aceito: "text-emerald-600",
  descartado: "text-muted-foreground/40",
} as const;

export function fundoCelulaJustificativa(j: Justificativa): string {
  if (j.status === "descartado") return "";
  return j.status === "aceito" ? "bg-emerald-50/60" : "bg-sky-50/70";
}

async function copiar(texto: string, rotulo: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${rotulo} copiado — é só colar no tracker.`);
  } catch {
    toast.error("O navegador bloqueou a cópia. Selecione o texto e copie à mão.");
  }
}

export function MarcaJustificativa({
  justificativa, onMudou,
}: { justificativa: Justificativa; onMudou: () => void }) {
  const j = justificativa;
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(textoFinal(j));
  const [salvando, setSalvando] = useState(false);

  const temSinal = j.sinais.length > 0 && j.status !== "descartado";
  const Icone = temSinal ? MessageSquareWarning : MessageSquareText;

  const decidir = async (status: Justificativa["status"] | null, texto?: string | null) => {
    setSalvando(true);
    const { error } = await db.rpc("justificativa_decidir", {
      p_id: j.id,
      p_status: status,
      p_texto: texto ?? null,
    });
    setSalvando(false);
    if (error) { toast.error("Não consegui salvar: " + error.message); return; }
    setEditando(false);
    onMudou();
  };

  const delta = Number(j.delta ?? 0);
  const pct = j.delta_pct == null ? null : Number(j.delta_pct);

  return (
    <Popover onOpenChange={(o) => { if (o) setRascunho(textoFinal(j)); setEditando(false); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          /* A célula inteira abre o drill-down de lançamentos. Sem isto, ler o
             comentário abriria também a gaveta por baixo. */
          onClick={(e) => e.stopPropagation()}
          title="Ver a justificativa desta variação"
          className={cn(
            "inline-flex shrink-0 items-center rounded hover:bg-black/5",
            CORES[j.status],
          )}
        >
          <Icone strokeWidth={2.25} className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[440px] p-0 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- cabeçalho: a variação que motivou o comentário ---- */}
        <div className="border-b border-border px-4 pb-2.5 pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[13px] font-semibold leading-tight text-foreground">
              {j.rubrica}
              <span className="font-normal text-muted-foreground"> · {rotuloMes(j.mes)}</span>
            </div>
            <span className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
              j.status === "aceito" ? "bg-emerald-100 text-emerald-800"
                : j.status === "descartado" ? "bg-muted text-muted-foreground"
                : "bg-sky-100 text-sky-800",
            )}>
              {j.status === "aceito" ? "conferido" : j.status === "descartado" ? "descartado" : "rascunho"}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="num">{valorExato(j.valor_anterior)}</span>
            <span>→</span>
            <span className="num font-semibold text-foreground">{valorExato(j.valor)}</span>
            <span className={cn("num font-semibold", delta >= 0 ? "text-primary" : "text-emerald-700")}>
              {delta >= 0 ? "+" : ""}{valorExato(delta)}
              {pct != null && ` (${(pct * 100).toFixed(1).replace(".", ",")}%)`}
            </span>
            <span className="opacity-70">vs {rotuloMes(j.mes_anterior)}</span>
          </div>
        </div>

        {/* ---- o comentário ---- */}
        <div className="px-4 py-3">
          {editando ? (
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              rows={5}
              autoFocus
              className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-[12px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">
              {textoFinal(j) || "—"}
            </p>
          )}

          {/* Sem isto o texto passaria por verdade contábil. Ele é hipótese: o
              Omie diz QUEM se mexeu, não POR QUÊ. */}
          {!editando && (
            <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Sparkles className="h-2.5 w-2.5" />
              {j.texto_editado
                ? "Reescrito por você."
                : <>Rascunho automático dos lançamentos do Omie{j.confianca && ` · confiança ${j.confianca}`}. Confira antes de levar ao tracker.</>}
            </p>
          )}
        </div>

        {/* ---- sinais: o que pode ser erro de lançamento ---- */}
        {!!j.sinais.length && (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-2">
            {j.sinais.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-amber-900">
                <MessageSquareWarning className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{s.detalhe}</span>
              </div>
            ))}
          </div>
        )}

        {/* ---- os drivers: a prova, para conferir sem sair da tela ---- */}
        {!!j.drivers.length && (
          <div className="border-t border-border bg-muted/30 px-4 py-2">
            <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-muted-foreground">
              QUEM SE MEXEU (OMIE)
            </div>
            <table className="w-full">
              <tbody>
                {j.drivers.slice(0, 5).map((d, i) => (
                  <tr key={i} className="align-baseline">
                    <td className="py-px pr-2 text-[11px] text-foreground/90">
                      {d.contraparte}
                      {(d.movimento === "entrou" || d.movimento === "saiu") && (
                        <span className="ml-1 text-[9px] uppercase text-muted-foreground">{d.movimento}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-px text-right text-[10.5px] num text-muted-foreground">
                      {d.fmtAnterior ?? valorExato(d.anterior)} → {d.fmtAtual ?? valorExato(d.atual)}
                    </td>
                    <td className={cn(
                      "whitespace-nowrap py-px pl-2 text-right text-[10.5px] num font-medium",
                      d.delta >= 0 ? "text-primary" : "text-emerald-700",
                    )}>
                      {d.fmtDelta ?? `${d.delta >= 0 ? "+" : ""}${Math.round(d.delta)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {j.cobertura != null && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                Explica {Math.round(Number(j.cobertura) * 100)}% da variação.
              </div>
            )}
          </div>
        )}

        {/* ---- ações ---- */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
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
                onClick={() => { setRascunho(textoFinal(j)); setEditando(false); }}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-secondary"
              >
                Cancelar
              </button>
              {j.texto_editado && (
                <button
                  onClick={() => decidir(null, "")}
                  disabled={salvando}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                  title="Descarta a sua reescrita e volta a valer o rascunho automático"
                >
                  <RotateCcw className="h-2.5 w-2.5" /> Voltar ao rascunho
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => copiar(textoFinal(j), "Comentário")}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium transition hover:bg-secondary"
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
              <button
                onClick={() => setEditando(true)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium transition hover:bg-secondary"
              >
                <Pencil className="h-3 w-3" /> Editar
              </button>
              {j.status !== "aceito" && (
                <button
                  onClick={() => decidir("aceito")}
                  disabled={salvando}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-card px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:bg-emerald-50 disabled:opacity-50"
                >
                  <Check className="h-3 w-3" /> Conferi
                </button>
              )}
              {j.status === "descartado" ? (
                <button
                  onClick={() => decidir("novo")}
                  disabled={salvando}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                >
                  <RotateCcw className="h-2.5 w-2.5" /> Restaurar
                </button>
              ) : (
                <button
                  onClick={() => decidir("descartado")}
                  disabled={salvando}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
                  title="Some da grade. Dá para restaurar depois."
                >
                  <Trash2 className="h-2.5 w-2.5" /> Descartar
                </button>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ============================================================
 *  Resumo acima da tabela
 * ============================================================ */

export function ResumoJustificativas({
  mapa, colunas, gerando, progresso, onGerar, apenasUltimoMes, onApenasUltimoMesChange,
}: {
  mapa: Map<string, Justificativa>;
  colunas: string[];
  gerando: boolean;
  progresso: string | null;
  onGerar: (force: boolean) => void;
  apenasUltimoMes?: boolean;
  onApenasUltimoMesChange?: (v: boolean) => void;
}) {
  const visiveis = useMemo(() => {
    const cols = new Set(colunas);
    return [...mapa.values()].filter((j) => cols.has(j.mes) && j.status !== "descartado");
  }, [mapa, colunas]);

  const novos = visiveis.filter((j) => j.status === "novo").length;
  const comSinal = visiveis.filter((j) => j.sinais.length > 0).length;

  /** Bloco pronto para colar no tracker, na ordem em que as colunas aparecem. */
  const copiarTudo = () => {
    const ordem = new Map(colunas.map((c, i) => [c, i]));
    const txt = [...visiveis]
      .sort((a, b) => (ordem.get(a.mes)! - ordem.get(b.mes)!) || a.rubrica.localeCompare(b.rubrica))
      .map((j) => `${rotuloMes(j.mes)} — ${j.rubrica}\n${textoFinal(j)}`)
      .join("\n\n");
    if (!txt) { toast.info("Nada para copiar nos meses visíveis."); return; }
    copiar(txt, `${visiveis.length} comentários`);
  };

  if (!visiveis.length) {
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-[11.5px] text-muted-foreground">
        <span>
          Nenhuma justificativa gerada ainda. A cada importação de tracker ou sincronização com o Omie
          elas saem sozinhas — ou gere agora para os meses já carregados.
        </span>
        <button
          onClick={() => onGerar(false)}
          disabled={gerando}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-50"
        >
          {gerando
            ? <><Loader2 className="h-3 w-3 animate-spin" /> {progresso ?? "Gerando…"}</>
            : <><Sparkles className="h-3 w-3" /> Gerar justificativas</>}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-sky-900">
      <span className="flex items-start gap-2">
        <MessageSquareText strokeWidth={2.25} className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
        <span>
          <b>{visiveis.length}</b> {visiveis.length === 1 ? "célula variou" : "células variaram"} mais de 5% e
          {visiveis.length === 1 ? " ganhou" : " ganharam"} um comentário
          {novos > 0 && <> — <b>{novos}</b> ainda sem conferir</>}
          {comSinal > 0 && <>, <b>{comSinal}</b> com sinal de possível erro de lançamento</>}.
          Clique no balão dentro da célula para ler, ajustar e copiar.
          {/* Sem isto, "só N comentários" pareceria a conta toda. */}
          <span className="opacity-80"> Variação abaixo de 5% ou de R$ 1 mil não vira comentário.</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {onApenasUltimoMesChange && (
          <label className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-card px-2.5 py-1 text-[11.5px] font-medium text-sky-900 transition hover:bg-sky-100 cursor-pointer">
            <input
              type="checkbox"
              checked={apenasUltimoMes ?? false}
              onChange={(e) => onApenasUltimoMesChange(e.target.checked)}
              className="rounded"
            />
            Apenas mês recente
          </label>
        )}
        <button
          onClick={copiarTudo}
          className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-card px-2.5 py-1 text-[11.5px] font-medium text-sky-900 transition hover:bg-sky-100"
        >
          <Copy className="h-3 w-3" /> Copiar todos
        </button>
        <button
          onClick={() => onGerar(true)}
          disabled={gerando}
          title="Reescreve todos os comentários dos meses visíveis, inclusive os já conferidos"
          className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-card px-2.5 py-1 text-[11.5px] font-medium text-sky-900 transition hover:bg-sky-100 disabled:opacity-50"
        >
          {gerando
            ? <><Loader2 className="h-3 w-3 animate-spin" /> {progresso ?? "Gerando…"}</>
            : <><Sparkles className="h-3 w-3" /> Regerar</>}
        </button>
      </span>
    </div>
  );
}
