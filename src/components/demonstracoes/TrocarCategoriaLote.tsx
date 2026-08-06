import { useCallback, useRef, useState } from "react";
import { Check, Loader2, ArrowRightLeft, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useCategoriasOmie, type CategoriaOmie } from "@/components/demonstracoes/TrocarCategoria";
import {
  trocarEmLote, resumoLote, categoriasDaSelecao,
  type ItemLote, type ResultadoLote,
} from "@/lib/loteCategoria";

/* ---------------------------------------------------------------------------
 * Trocar a categoria de vários lançamentos de uma vez.
 *
 * Mesma Edge Function do seletor individual, chamada em laço — ver o porquê em
 * `lib/loteCategoria.ts`. O que este componente acrescenta é o que a pessoa
 * precisa para decidir e para não ficar no escuro:
 *
 *   - a confirmação diz DE ONDE os selecionados saem (podem estar em categorias
 *     diferentes) e para onde vão, com a rubrica de destino;
 *   - enquanto roda, mostra em qual item está e deixa PARAR — o que já foi
 *     alterado no ERP está alterado, e a tela diz isso em vez de fingir que dá
 *     para desfazer;
 *   - no fim, quem foi recusado fica na tela com o texto do ERP. Recusa em lote
 *     sem o motivo por item é o mesmo que não avisar.
 * ------------------------------------------------------------------------- */

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const rubricaDe = (c: CategoriaOmie | undefined | null, tipo: "dre" | "dfc") =>
  (tipo === "dre" ? c?.rubrica_dre : c?.rubrica_dfc) ?? null;

type Resposta = {
  status: "ok" | "erro";
  erro?: string;
  ja_estava?: boolean;
};

export function TrocarCategoriaLote({
  itens, tipo, mes, mesLabel, travado, onConcluido,
}: {
  itens: ItemLote[];
  tipo: "dre" | "dfc";
  mes: string;
  mesLabel: string;
  travado: boolean;
  /** Recarregar lista, alertas, comparativo e a demonstração — quem sabe é o painel. */
  onConcluido: (r: ResultadoLote) => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [escolhida, setEscolhida] = useState<CategoriaOmie | null>(null);
  const [feitos, setFeitos] = useState<number | null>(null);   // null = não está rodando
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const { categorias, carregando } = useCategoriasOmie(aberto);
  const cancelar = useRef(false);

  const rodando = feitos !== null;
  const origem = categoriasDaSelecao(itens);
  const soma = itens.reduce((s, i) => s + (Number(i.valor) || 0), 0);
  const rubricaNova = rubricaDe(escolhida, tipo);
  /* Uma rubrica de destino por categoria de origem: se todas saem da mesma, dá
     para dizer "sai de X e entra em Y". Misturado, o painel não promete. */
  const rubricasAtuais = [...new Set(
    origem.map((o) => rubricaDe(categorias.find((c) => c.codigo === o.codigo), tipo) ?? "sem rubrica"),
  )];

  const fechar = (v: boolean) => {
    if (rodando) return;                 // no meio do lote, o painel não some
    setAberto(v);
    if (!v) { setEscolhida(null); setResultado(null); }
  };

  const executar = useCallback(async () => {
    if (!escolhida) return;
    cancelar.current = false;
    setResultado(null);
    setFeitos(0);

    const r = await trocarEmLote(
      itens,
      async (item) => {
        const { data, error } = await supabase.functions.invoke("omie-trocar-categoria", {
          body: { action: "trocar", cod_titulo: item.codTitulo, codigo: escolhida.codigo, origem: tipo, mes },
        });
        const resposta = data as Resposta | null;
        if (error || resposta?.status === "erro") {
          return { ok: false, erro: resposta?.erro ?? error?.message ?? "erro desconhecido" };
        }
        return { ok: true, jaEstava: !!resposta?.ja_estava };
      },
      { onProgresso: (n) => setFeitos(n), cancelado: () => cancelar.current },
    );

    setFeitos(null);
    setResultado(r);

    const resumo = resumoLote(r);
    if (resumo.falhas || resumo.naoTentados) {
      toast.warning(resumo.frase, {
        duration: 12000,
        description: r.interrompidoPor
          ? `Parei depois de três recusas iguais: "${r.interrompidoPor}". O resto não foi tentado.`
          : "As recusas estão listadas no painel, com o motivo de cada uma.",
      });
    } else {
      toast.success(resumo.frase, { duration: 6000 });
      setAberto(false);
      setEscolhida(null);
    }

    // Recarrega sempre: mesmo com falhas, o que passou já mudou o ERP e o cache.
    await onConcluido(r);
  }, [escolhida, itens, tipo, mes, onConcluido]);

  if (!itens.length) return null;

  return (
    <Popover open={aberto} onOpenChange={fechar}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11.5px] font-semibold text-primary-foreground transition hover:opacity-90"
          title={`Trocar a categoria dos ${itens.length} lançamentos selecionados, no Omie`}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          Trocar categoria de {itens.length}…
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[420px] p-0">
        {/* ----- rodando ----- */}
        {rodando ? (
          <div className="px-4 py-4">
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Alterando no Omie… {feitos} de {itens.length}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round(((feitos ?? 0) / itens.length) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Um título por vez — a API do Omie recusa chamadas simultâneas.
            </p>
            <button
              onClick={() => { cancelar.current = true; }}
              className="mt-2 rounded-md border border-border bg-card px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition hover:bg-secondary"
            >
              Parar depois deste
            </button>
          </div>
        ) : resultado ? (
          /* ----- resultado: só quem foi recusado ----- */
          <PainelRecusas
            resultado={resultado}
            onFechar={() => { setResultado(null); setAberto(false); setEscolhida(null); }}
            onTentarDeNovo={executar}
          />
        ) : (
          <>
            <div className="border-b border-border px-3 py-2">
              <div className="text-[11.5px] font-semibold text-foreground">
                {itens.length} {itens.length === 1 ? "lançamento" : "lançamentos"} · <span className="num">{moeda(soma)}</span>
              </div>
              <div className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                {origem.length === 1
                  ? <>hoje em <b className="font-medium text-foreground/80">{origem[0].descricao}</b></>
                  : <>hoje em {origem.length} categorias: {origem.map((o) => `${o.descricao} (${o.n})`).join(" · ")}</>}
              </div>
            </div>

            <Command
              filter={(value, search) => {
                const t = value.toLowerCase();
                return search.split(/\s+/).every((s) => t.includes(s.toLowerCase())) ? 1 : 0;
              }}
            >
              <CommandInput placeholder="Buscar a categoria de destino…" className="h-9" />
              <CommandList className="max-h-[240px]">
                {carregando && (
                  <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando categorias…
                  </div>
                )}
                <CommandEmpty>Nenhuma categoria com esse texto.</CommandEmpty>
                {!carregando && (
                  <CommandGroup heading="Para onde vão">
                    {categorias.map((c) => {
                      const rubrica = rubricaDe(c, tipo);
                      const sel = escolhida?.codigo === c.codigo;
                      return (
                        <CommandItem
                          key={c.codigo}
                          value={`${c.descricao} ${c.codigo} ${rubrica ?? ""}`}
                          onSelect={() => setEscolhida(c)}
                          className={cn("items-start gap-2 py-1.5", sel && "bg-secondary")}
                        >
                          <Check className={cn("mt-0.5 h-3 w-3 shrink-0", sel ? "opacity-100" : "opacity-0")} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] text-foreground">{c.descricao}</div>
                            <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
                              <span className="font-mono">{c.codigo}</span>
                              {rubrica ? <span>→ {rubrica}</span> : <span className="text-amber-700">fora do DE-PARA</span>}
                            </div>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>

            {escolhida && (
              <div className="border-t border-border bg-muted/40 px-3 py-2.5">
                <div className="text-[11.5px] leading-relaxed text-foreground">
                  {itens.length} {itens.length === 1 ? "lançamento vai" : "lançamentos vão"} para{" "}
                  <b>{escolhida.descricao}</b>
                </div>
                {rubricaNova && rubricasAtuais.length === 1 && rubricasAtuais[0] !== rubricaNova && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Na {tipo.toUpperCase()} saem de <b>{rubricasAtuais[0]}</b> e entram em <b>{rubricaNova}</b>.
                  </div>
                )}
                {!rubricaNova && (
                  <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900">
                    <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                    Esta categoria não está no DE-PARA da {tipo.toUpperCase()} — os {itens.length} lançamentos
                    saem da demonstração até alguém mapeá-la.
                  </div>
                )}
                {travado && (
                  <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900">
                    <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                    {mesLabel} está travado: o Omie muda, mas o valor na tela continua vindo do tracker.
                  </div>
                )}
                {/* Lote grande é minutos de espera com o painel aberto. Dizer
                    antes é melhor do que a pessoa descobrir no meio. */}
                {itens.length >= 15 && (
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    São {itens.length} alterações, uma por vez no Omie — pode levar alguns minutos. Dá para parar no meio.
                  </div>
                )}
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => setEscolhida(null)}
                    className="rounded-md border border-border bg-card px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition hover:bg-secondary"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={executar}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[10.5px] font-semibold text-primary-foreground transition hover:opacity-90"
                  >
                    Trocar {itens.length} no Omie
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** O que o ERP recusou, item a item — com o motivo dele, não com um resumo meu. */
function PainelRecusas({
  resultado, onFechar, onTentarDeNovo,
}: {
  resultado: ResultadoLote;
  onFechar: () => void;
  onTentarDeNovo: () => void;
}) {
  const resumo = resumoLote(resultado);
  const falhas = resultado.resultados.filter((r) => !r.ok);

  return (
    <div>
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <div className="text-[11.5px] font-semibold text-foreground">{resumo.frase}</div>
          {resultado.interrompidoPor && (
            <div className="mt-0.5 text-[10.5px] leading-relaxed text-amber-900">
              Parei depois de três recusas iguais — os {resumo.naoTentados} restantes não foram tentados.
            </div>
          )}
          {resultado.cancelado && (
            <div className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
              Parado a pedido. O que já tinha sido alterado continua alterado no Omie.
            </div>
          )}
        </div>
        <button onClick={onFechar} className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-[240px] overflow-auto py-1">
        {falhas.map((f) => (
          <div key={f.item.codTitulo} className="px-3 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11.5px] text-foreground">{f.item.contraparte ?? f.item.codTitulo}</span>
              <span className="num shrink-0 text-[11px] text-muted-foreground">{moeda(Number(f.item.valor) || 0)}</span>
            </div>
            <div className="text-[10.5px] leading-relaxed text-primary">{f.erro}</div>
          </div>
        ))}
      </div>

      {!!resumo.naoTentados && (
        <div className="border-t border-border px-3 py-2">
          <button
            onClick={onTentarDeNovo}
            className="rounded-md border border-border bg-card px-2 py-1 text-[10.5px] font-medium transition hover:bg-secondary"
            title="Tenta de novo os que ainda estão selecionados — o que já foi alterado sai da seleção sozinho."
          >
            Tentar de novo
          </button>
        </div>
      )}
    </div>
  );
}
