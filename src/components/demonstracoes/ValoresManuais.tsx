import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, PencilLine, Loader2, Check, Trash2, ListTree } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chaveCelula } from "@/components/demonstracoes/Reclassificacoes";
import { paraCampo, paraNumero, rotuloMes } from "@/lib/valoresManuais";

/* ---------------------------------------------------------------------------
 * Valor digitado à mão na célula da DRE/DFC.
 *
 * Depreciação, provisão, imposto ainda não lançado: parte da demonstração nunca
 * saiu do Omie nem do tracker, e até aqui só entrava reimportando a planilha
 * inteira. Agora se digita na célula.
 *
 * O número NÃO é gravado direto no blob da demonstração — ele mora em
 * `demonstracoes_valor_manual` e é reaplicado no fim de toda escrita (sync,
 * import, edição). Sem isso ele viveria até a próxima sincronização: o omie-sync
 * reescreve cada mês aberto do zero. Ver _shared/valores-manuais.ts.
 * ------------------------------------------------------------------------- */

export type ValorManual = {
  id: string;
  tipo: "dre" | "dfc";
  rubrica: string;
  col_key: string;
  modo: "substitui" | "soma";
  valor: number;
  /** o que o Omie/tracker dizia antes do manual (null = a célula não existia) */
  valor_base: number | null;
  valor_aplicado: number | null;
  autor_email: string | null;
  atualizado_em: string;
};

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a tabela criada na
   migration 20260806150000. Mesmo atalho tipado das justificativas. */
const db = supabase as unknown as {
  from: (tabela: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export function useValoresManuais(tipo: "dre" | "dfc") {
  const [mapa, setMapa] = useState<Map<string, ValorManual>>(new Map());

  const recarregar = useCallback(async () => {
    const { data, error } = await db.from("demonstracoes_valor_manual").select("*").eq("tipo", tipo);
    if (error) {
      // Acessório como as outras marcas: falhou, a demonstração continua na tela
      // (com os valores manuais já dentro do blob) em vez de derrubar a página.
      setMapa(new Map());
      return;
    }
    const m = new Map<string, ValorManual>();
    for (const r of data ?? []) {
      const v: ValorManual = {
        id: String(r.id),
        tipo,
        rubrica: String(r.rubrica ?? ""),
        col_key: String(r.col_key ?? ""),
        modo: r.modo === "soma" ? "soma" : "substitui",
        valor: Number(r.valor ?? 0),
        valor_base: r.valor_base == null ? null : Number(r.valor_base),
        valor_aplicado: r.valor_aplicado == null ? null : Number(r.valor_aplicado),
        autor_email: (r.autor_email as string) ?? null,
        atualizado_em: String(r.atualizado_em ?? ""),
      };
      m.set(chaveCelula(v.rubrica, v.col_key), v);
    }
    setMapa(m);
  }, [tipo]);

  useEffect(() => { recarregar(); }, [recarregar]);

  return { manuais: mapa, recarregarManuais: recarregar };
}

/* ============================================================
 *  Marca na célula
 * ============================================================ */

export function fundoCelulaManual(): string {
  return "bg-violet-50 ring-1 ring-inset ring-violet-200";
}

export function tituloValorManual(m: ValorManual): string {
  const base = m.valor_base == null ? "não havia valor" : valorExato(m.valor_base);
  const quem = m.autor_email ? ` por ${m.autor_email}` : "";
  return m.modo === "soma"
    ? `valor manual: ${valorExato(m.valor)} somados ao automático (${base})${quem}`
    : `valor manual: ${valorExato(m.valor)} no lugar do automático (${base})${quem}`;
}

/* ============================================================
 *  Editor
 * ============================================================ */

export function EditorValorManual({
  tipo, rubrica, col, valorCelula, manual, despesa, onSalvo,
}: {
  tipo: "dre" | "dfc";
  rubrica: string;
  col: string;
  /** o que está na tela hoje — já com o manual, se houver */
  valorCelula: number | null;
  manual?: ValorManual;
  /** rubrica que desce de um bloco "(-)": o número costuma entrar negativo */
  despesa: boolean;
  onSalvo: () => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  /* O Popover só é MONTADO no primeiro clique. Com "Todos os anos" a grade passa
     de mil células que aceitam digitação, e um Popover em cada uma seria mil
     árvores de componente para nada — o normal é a pessoa abrir uma. */
  const [montado, setMontado] = useState(false);
  const [modo, setModo] = useState<"substitui" | "soma">(manual?.modo ?? "substitui");
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  // O automático é o que o Omie/tracker entregou — na célula com manual, isso
  // está guardado em valor_base; sem manual, é o próprio valor da célula.
  const automatico = manual ? manual.valor_base : valorCelula;
  const digitado = paraNumero(texto);
  const previa = digitado == null ? null : modo === "soma" ? (automatico ?? 0) + digitado : digitado;
  const sinalEstranho = digitado != null && digitado !== 0 && despesa === (digitado > 0);

  const abrir = (o: boolean) => {
    setAberto(o);
    if (o) {
      setMontado(true);
      setModo(manual?.modo ?? "substitui");
      setTexto(manual ? paraCampo(manual.valor) : "");
    }
  };

  const chamar = async (body: Record<string, unknown>, ok: string) => {
    setSalvando(true);
    try {
      const { data, error } = await supabase.functions.invoke("demonstracoes-valor-manual", {
        body: { tipo, rubrica, col_key: col, ...body },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setAberto(false);
      toast.success(ok);
      await onSalvo();
    } catch (e) {
      toast.error("Não consegui salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvando(false);
    }
  };

  const salvar = () => {
    if (digitado == null) { toast.error("Digite um valor."); return; }
    chamar({ valor: digitado, modo }, `${rubrica} · ${rotuloMes(col)} atualizado.`);
  };

  const gatilho = (
    <button
      type="button"
      /* A célula inteira abre o drill-down de lançamentos. */
      onClick={(e) => { e.stopPropagation(); if (!montado) abrir(true); }}
      title={manual ? tituloValorManual(manual) : "Digitar um valor nesta célula"}
      /* Absoluto, na sobra à esquerda da célula (o número é alinhado à direita):
         inline, ele reservaria 14px em TODA célula que aceita digitação e
         empurraria a grade inteira para caber um lápis invisível. */
      className={cn(
        "absolute left-1 top-1/2 -translate-y-1/2 items-center rounded-sm p-px transition hover:bg-black/5",
        manual
          ? "inline-flex text-violet-700"
          // Sem valor manual o lápis só aparece no hover da linha: um lápis em
          // cada célula da grade competiria com os números.
          : "hidden text-muted-foreground/70 group-hover/linha:inline-flex",
      )}
    >
      {manual
        ? <PencilLine strokeWidth={2.5} className="h-3.5 w-3.5" />
        : <Pencil strokeWidth={2.25} className="h-3 w-3" />}
    </button>
  );

  if (!montado) return gatilho;

  return (
    <Popover open={aberto} onOpenChange={abrir}>
      <PopoverTrigger asChild>{gatilho}</PopoverTrigger>

      <PopoverContent align="end" className="w-[320px] p-0 text-left" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 pb-2.5 pt-3">
          <div className="text-[13px] font-semibold leading-tight text-foreground">
            {rubrica}
            <span className="font-normal text-muted-foreground"> · {rotuloMes(col)}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Automático (Omie/tracker):{" "}
            <span className="num">{automatico == null ? "sem valor" : valorExato(automatico)}</span>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="mb-2 inline-flex rounded-md border border-border p-0.5">
            {([
              { id: "substitui", label: "Substituir" },
              { id: "soma", label: "Somar" },
            ] as const).map((o) => (
              <button
                key={o.id}
                onClick={() => setModo(o.id)}
                className={cn(
                  "h-6 rounded px-2 text-[11px] font-medium transition-colors",
                  modo === o.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") salvar(); }}
            autoFocus
            inputMode="decimal"
            placeholder={despesa ? "-0,00" : "0,00"}
            className="num w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-right text-[13px] focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="mt-1.5 space-y-1 text-[10.5px] leading-snug text-muted-foreground">
            {modo === "soma" && previa != null && (
              <div>Fica <span className="num font-medium text-foreground">{valorExato(previa)}</span> na célula.</div>
            )}
            {sinalEstranho && (
              <div className="text-amber-700">
                {despesa
                  ? "Esta rubrica é despesa — costuma entrar negativa."
                  : "Esta rubrica é de receita — costuma entrar positiva."}
              </div>
            )}
            <div>
              Vale sobre o Omie e sobre o tracker: é reaplicado depois de cada sincronização e de cada import.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 border-t border-border px-4 py-2.5">
          <button
            onClick={salvar}
            disabled={salvando}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {salvando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Salvar
          </button>
          <button
            onClick={() => setAberto(false)}
            className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-secondary"
          >
            Cancelar
          </button>
          {manual && (
            <button
              onClick={() => chamar({ remover: true }, `Valor manual removido de ${rubrica} · ${rotuloMes(col)}.`)}
              disabled={salvando}
              title="Volta a valer o que vem do Omie/tracker"
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
            >
              <Trash2 className="h-2.5 w-2.5" /> Remover
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ============================================================
 *  Resumo acima da tabela
 * ============================================================ */

export function ResumoValoresManuais({
  mapa, colunas,
}: { mapa: Map<string, ValorManual>; colunas: string[] }) {
  const visiveis = useMemo(() => {
    const cols = new Set(colunas);
    const ordem = new Map(colunas.map((c, i) => [c, i]));
    return [...mapa.values()]
      .filter((m) => cols.has(m.col_key))
      .sort((a, b) => (ordem.get(a.col_key)! - ordem.get(b.col_key)!) || a.rubrica.localeCompare(b.rubrica));
  }, [mapa, colunas]);

  if (!visiveis.length) return null;

  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-violet-950">
      <span className="flex items-start gap-2">
        <PencilLine strokeWidth={2.5} className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
        <span>
          <b>{visiveis.length}</b> {visiveis.length === 1 ? "célula tem valor" : "células têm valor"} digitado à mão
          nos meses visíveis — {visiveis.length === 1 ? "ela entra" : "eles entram"} no total como qualquer outro
          lançamento e {visiveis.length === 1 ? "sobrevive" : "sobrevivem"} à sincronização com o Omie.
        </span>
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <button className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-violet-300 bg-card px-2.5 py-1 text-[11.5px] font-medium text-violet-900 transition hover:bg-violet-100">
            <ListTree className="h-3 w-3" /> Ver quais
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[340px] p-0">
          <div className="border-b border-border px-3 py-2 text-[12px] font-semibold text-foreground">
            Valores digitados à mão
          </div>
          <div className="max-h-[300px] overflow-y-auto py-1">
            {visiveis.map((m) => (
              <div key={m.id} className="flex items-baseline justify-between gap-2 px-3 py-1.5 hover:bg-secondary/60">
                <span className="text-[11.5px] text-foreground">
                  {m.rubrica}
                  <span className="text-muted-foreground"> · {rotuloMes(m.col_key)}</span>
                </span>
                <span className="num shrink-0 text-[11.5px] font-medium text-foreground" title={tituloValorManual(m)}>
                  {m.modo === "soma" ? "+" : ""}{valorExato(m.valor)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-3 py-2 text-[10.5px] leading-snug text-muted-foreground">
            Para mudar ou tirar, clique no lápis roxo dentro da célula.
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
