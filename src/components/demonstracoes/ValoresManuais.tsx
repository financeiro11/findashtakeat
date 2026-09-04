import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, PencilLine, RefreshCw, Loader2, Check, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chaveCelula } from "@/components/demonstracoes/Reclassificacoes";
import { DetalheStatus, SegmentoStatus } from "@/components/demonstracoes/BarraStatus";
import { paraCampo, paraNumero, rotuloMes } from "@/lib/valoresManuais";
import { ASAAS_META, type AsaasKey } from "@/lib/extratoAsaas";

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
 *
 * NEM TODA CÉLULA DAQUI FOI DIGITADA. A mesma camada é o único lugar em que um
 * número sobrevive ao sync e ao import, então "Meios de Pagamento" — que nunca
 * vem do Omie, porque a taxa do Asaas é descontada na liquidação e não vira
 * conta a pagar — passou a ser escrita por rotina, com `origem='asaas'`. Daí a
 * marca, o hover e o resumo olharem a origem: dizer "digitado à mão" para um
 * número que ninguém digitou mandaria a pessoa procurar um autor que não existe.
 * ------------------------------------------------------------------------- */

/** Prestação de contas de quem escreveu sozinho (só em `origem='asaas'`). */
export type DetalheAsaas = {
  taxas?: Record<string, number>;
  lancamentos?: number;
  /** mês ainda em curso — o número cresce até o fim dele */
  parcial?: boolean;
  mes?: string;
  em?: string;
};

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
  /** quem escreveu: uma pessoa ou a rotina das taxas do Asaas */
  origem: "manual" | "asaas";
  detalhe: DetalheAsaas | null;
  autor_email: string | null;
  atualizado_em: string;
};

export const ehDoAsaas = (m: ValorManual | undefined): boolean => m?.origem === "asaas";

/**
 * Rubricas que uma rotina reescreve sozinha, e o que a alimenta. Serve para o
 * editor não mentir depois que alguém FIXA um valor nessas células: ali a
 * origem vira 'manual', mas apagar não deixa a célula vazia — devolve a linha à
 * rotina na próxima rodada. Ver supabase/functions/_shared/meios-pagamento-asaas.ts.
 */
const RUBRICAS_DE_ROTINA: Record<string, string> = {
  "Meios de Pagamento": "o somatório das taxas do Asaas",
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
        // Linha gravada antes da coluna existir é de gente: o default é 'manual'.
        origem: r.origem === "asaas" ? "asaas" : "manual",
        detalhe: (r.detalhe as DetalheAsaas) ?? null,
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

/* Roxo = mão humana, índigo = rotina. Cores distintas de propósito: na grade a
   pessoa lê o fundo antes de ler o hover, e "alguém decidiu isto" e "isto se
   atualiza sozinho" pedem reações diferentes. */
export function fundoCelulaManual(m?: ValorManual): string {
  return ehDoAsaas(m)
    ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
    : "bg-violet-50 ring-1 ring-inset ring-violet-200";
}

/** "Taxa de cartão 16.074,06 · Taxa de mensageria 1.402,64 · …", da que mais pesa. */
function quebraDasTaxas(d: DetalheAsaas | null): string[] {
  return Object.entries(d?.taxas ?? {})
    .filter(([, v]) => Number(v))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([k, v]) => `${ASAAS_META[k as AsaasKey]?.rot ?? k} ${valorExato(Number(v))}`);
}

export function tituloValorManual(m: ValorManual): string {
  if (m.origem === "asaas") {
    const d = m.detalhe;
    return [
      `somatório das taxas do Asaas em ${rotuloMes(m.col_key)}: ${valorExato(m.valor)}`,
      d?.lancamentos ? `${d.lancamentos.toLocaleString("pt-BR")} lançamentos` : null,
      d?.parcial ? "mês em curso — ainda cresce até o fim dele" : null,
      ...quebraDasTaxas(d),
    ].filter(Boolean).join(" · ");
  }
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
  const doAsaas = ehDoAsaas(manual);
  const rotina = RUBRICAS_DE_ROTINA[rubrica];
  /** rubrica de rotina em que alguém já fixou um número à mão */
  const fixado = !!rotina && !!manual && !doAsaas;
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
      title={manual
        ? tituloValorManual(manual) + (doAsaas ? " · clique para fixar um valor à mão" : "")
        : "Digitar um valor nesta célula"}
      /* Na fila de marcas, com lugar próprio. Já foi absoluto (`left-1`) para não
         reservar largura nenhuma, e o preço era cair POR CIMA do triângulo de
         reclassificação e do balão de justificativa — três alvos de 14px
         empilhados no mesmo ponto, nenhum clicável.

         Sem valor manual o lápis é `invisible`, não `hidden`: some da vista e do
         clique, mas continua ocupando o espaço, então o número não dança quando
         o mouse entra e sai da linha. */
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm transition hover:bg-black/10",
        manual
          ? (doAsaas ? "text-indigo-700" : "text-violet-700")
          // Sem valor manual o lápis só aparece no hover da linha: um lápis em
          // cada célula da grade competiria com os números.
          : "invisible text-muted-foreground/70 group-hover/linha:visible",
      )}
    >
      {/* Setas em círculo, não lápis: a célula do Asaas se refaz sozinha todo
          dia, e um lápis prometeria que alguém escreveu aquilo. */}
      {manual
        ? (doAsaas
            ? <RefreshCw strokeWidth={2.5} className="h-3 w-3" />
            : <PencilLine strokeWidth={2.5} className="h-3.5 w-3.5" />)
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
          {doAsaas && (
            <div className="mt-1 text-[11px] text-indigo-700">
              Taxas do Asaas: <span className="num font-medium">{valorExato(manual!.valor)}</span>
              {manual!.detalhe?.lancamentos
                ? ` · ${manual!.detalhe.lancamentos.toLocaleString("pt-BR")} lançamentos`
                : null}
              {manual!.detalhe?.parcial ? " · mês em curso" : null}
            </div>
          )}
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
            {doAsaas && (
              <div className="text-indigo-700">
                Esta célula é escrita todo dia por {rotina ?? "uma rotina"}. Salvar um valor aqui
                <b> fixa</b> o número — a rotina passa a respeitar a célula e não mexe mais nela.
              </div>
            )}
            {fixado && (
              <div className="text-indigo-700">
                Valor fixado à mão: {rotina} está parado nesta célula. Apagar devolve a linha à rotina
                na próxima rodada.
              </div>
            )}
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
              onClick={() => chamar(
                { remover: true },
                rotina
                  ? `${rubrica} · ${rotuloMes(col)} volta a ${rotina} na próxima rodada.`
                  : automatico == null
                  ? `Valor manual apagado de ${rubrica} · ${rotuloMes(col)}.`
                  : `${rubrica} · ${rotuloMes(col)} voltou ao valor do Omie.`,
              )}
              disabled={salvando}
              /* O que interessa saber antes de clicar não é que a linha some da
                 tabela de manuais, é em que número a célula vai parar: o rótulo
                 diz o destino e o hover diz o valor. Chamava-se "Remover", com
                 lixeira, e parecia apagar a célula. */
              title={rotina
                ? `A célula volta a ${rotina} na próxima rodada da rotina.`
                : automatico == null
                ? "A rubrica não vem do Omie nem do tracker: a célula volta a ficar vazia."
                : `A célula volta a valer ${valorExato(automatico)}, como veio do Omie/tracker.`}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              {rotina
                ? <><RotateCcw className="h-2.5 w-2.5" /> Voltar à rotina</>
                : automatico == null
                ? <><Trash2 className="h-2.5 w-2.5" /> Apagar valor</>
                : <><RotateCcw className="h-2.5 w-2.5" /> Voltar ao Omie</>}
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

  /* Dois contadores, não um. Somar as células do Asaas às digitadas faria a barra
     anunciar "5 valores manuais" num mês em que ninguém digitou nada — e mandaria
     alguém procurar um autor que não existe. */
  const digitados = visiveis.filter((m) => m.origem !== "asaas");
  const doAsaas = visiveis.filter((m) => m.origem === "asaas");

  const lista = (itens: ValorManual[]) => (
    <div className="max-h-[300px] overflow-y-auto py-1">
      {itens.map((m) => (
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
  );

  if (!visiveis.length) return null;

  return (
    <>
      {digitados.length > 0 && (
        <SegmentoStatus
          icone={<PencilLine strokeWidth={2.2} className="h-[13px] w-[13px] text-violet-600" />}
          valor={digitados.length}
          rotulo={digitados.length === 1 ? "valor manual" : "valores manuais"}
          titulo="Células com valor digitado à mão: entram no total como qualquer outro lançamento e sobrevivem à sincronização com o Omie."
          larguraDetalhe={340}
          detalhe={
            <DetalheStatus
              titulo="Valores digitados à mão"
              nota="Eles entram no total como qualquer outro lançamento e sobrevivem à sincronização com o Omie. Para mudar, ou voltar ao valor do Omie, clique no lápis roxo dentro da célula."
            >
              {lista(digitados)}
            </DetalheStatus>
          }
        />
      )}

      {doAsaas.length > 0 && (
        <SegmentoStatus
          icone={<RefreshCw strokeWidth={2.2} className="h-[13px] w-[13px] text-indigo-600" />}
          valor={doAsaas.length}
          rotulo={doAsaas.length === 1 ? "célula do Asaas" : "células do Asaas"}
          titulo="Meses em que a linha veio do somatório das taxas do Asaas, e não do Omie nem do tracker."
          larguraDetalhe={340}
          detalhe={
            <DetalheStatus
              titulo="Escrito pelo extrato do Asaas"
              nota="A taxa do Asaas é descontada na liquidação: ela nunca vira conta a pagar no Omie, então esta linha é somada do extrato uma vez por dia. Passe o mouse no número para ver a quebra por tipo de taxa; clique nas setas índigo para fixar um valor à mão."
            >
              {lista(doAsaas)}
            </DetalheStatus>
          }
        />
      )}
    </>
  );
}
