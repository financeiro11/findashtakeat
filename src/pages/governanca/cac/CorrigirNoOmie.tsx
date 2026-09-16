import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { comValorExato } from "@/components/ValorExato";
import { useCategoriasOmie } from "@/components/demonstracoes/TrocarCategoria";
import { trocarEmLote, resumoLote, type ItemLote, type ResultadoLote } from "@/lib/loteCategoria";
import { MESES, colunaDoMes, destinoSugerido, type SuspeitaDepartamento } from "@/lib/cac";

function brl(n: number | null | undefined) {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Resposta = { status: "ok" | "erro"; erro?: string; ja_estava?: boolean };

/* ---------------------------------------------------------------------------
 * Corrigir no Omie a categoria de quem foi pago no departamento errado.
 *
 * NÃO é uma via nova de escrita. Cada título passa pela `omie-trocar-categoria`
 * (ERP primeiro, confirma, espelha no cache, grava a trilha), em laço pelo
 * `trocarEmLote` — com a mesma parada depois de três recusas iguais, que é o que
 * acontece quando o período contábil está fechado no Omie. O que este diálogo
 * acrescenta é o DESTINO por lançamento: um grupo mistura "Pessoal - Suporte" e
 * "Escala - Suporte", e cada um vai para o seu par na família certa.
 *
 * Sempre prévia + clique, como no chat da célula da DRE: a pessoa vê de → para
 * de cada título e desmarca o que não quer.
 * ------------------------------------------------------------------------- */
export function CorrigirNoOmie({ ano, lancamentos, onClose, onConcluido }: {
  ano: number;
  /** Nulo: fechado. */
  lancamentos: SuspeitaDepartamento[] | null;
  onClose: () => void;
  /** Recarregar quadro, matriz e DRE — quem sabe é o painel. */
  onConcluido: () => void | Promise<void>;
}) {
  const aberto = !!lancamentos?.length;
  const { categorias, carregando } = useCategoriasOmie(aberto);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [incluidos, setIncluidos] = useState<Set<string>>(new Set());
  const [feitos, setFeitos] = useState<number | null>(null);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const cancelar = useRef(false);

  const lista = useMemo(() => lancamentos ?? [], [lancamentos]);
  const destinos = useMemo(
    () => new Map(lista.map((l) => [String(l.cod_titulo), destinoSugerido(l, categorias)])),
    [lista, categorias],
  );

  /* A escolha inicial é a sugestão, e entra marcado só o que TEM destino. Refaz
     quando o diálogo abre com outra lista ou quando as categorias chegam. */
  useEffect(() => {
    const e: Record<string, string> = {};
    const inc = new Set<string>();
    for (const l of lista) {
      const k = String(l.cod_titulo);
      const s = destinos.get(k)?.sugerida;
      if (s) { e[k] = s.codigo; inc.add(k); }
    }
    setEscolhas(e);
    setIncluidos(inc);
    setResultado(null);
  }, [lista, destinos]);

  const rodando = feitos !== null;
  const selecionados = lista.filter((l) => incluidos.has(String(l.cod_titulo)) && escolhas[String(l.cod_titulo)]);
  const soma = selecionados.reduce((a, l) => a + (Number(l.valor) || 0), 0);
  const travados = selecionados.filter((l) => l.mes_travado).length;
  const rhConcorda = lista.find((l) => l.departamento_rh && l.familias_rh?.includes(l.familia));
  const nomeCategoria = (codigo: string) => categorias.find((c) => c.codigo === codigo)?.descricao ?? codigo;

  const fechar = (v: boolean) => {
    if (v || rodando) return;   // no meio do lote o diálogo não some
    onClose();
  };

  const executar = useCallback(async () => {
    const alvo = selecionados;
    if (!alvo.length) return;
    cancelar.current = false;
    setResultado(null);
    setFeitos(0);

    const porTitulo = new Map(alvo.map((l) => [String(l.cod_titulo), l]));
    const itens: ItemLote[] = alvo.map((l) => ({
      codTitulo: String(l.cod_titulo),
      contraparte: `${l.pessoa} · ${MESES[l.mes - 1]}/${String(ano).slice(2)}`,
      valor: Number(l.valor) || 0,
      categoriaCodigo: l.categoria,
      categoriaDescricao: l.categoria_descricao,
    }));

    const r = await trocarEmLote(
      itens,
      async (item) => {
        const l = porTitulo.get(item.codTitulo)!;
        const { data, error } = await supabase.functions.invoke("omie-trocar-categoria", {
          body: {
            action: "trocar",
            cod_titulo: item.codTitulo,
            codigo: escolhas[item.codTitulo],
            origem: "cac",
            mes: colunaDoMes(ano, l.mes),
            motivo: `Painel CAC · departamento fora do padrão: ${l.pessoa} é de ${l.departamento}, pago em ${l.familia}`,
          },
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
    const resumo = resumoLote(r);
    if (resumo.falhas || resumo.naoTentados) {
      setResultado(r);
      const periodo = /per[ií]odo cont[áa]bil/i.test(r.interrompidoPor ?? r.resultados.find((x) => !x.ok)?.erro ?? "");
      toast.warning(resumo.frase, {
        duration: 12000,
        description: periodo
          ? "O Omie está com o período fechado. Reabra o mês lá (ou fale com quem fechou) e tente de novo."
          : r.interrompidoPor
            ? `Parei depois de três recusas iguais: "${r.interrompidoPor}".`
            : "As recusas estão no diálogo, com o motivo de cada uma.",
      });
    } else {
      toast.success(resumo.frase, { duration: 6000 });
      onClose();
    }

    // Recarrega sempre: o que passou já mudou o ERP e o cache.
    if (resumo.ok) await onConcluido();
  }, [selecionados, escolhas, ano, onClose, onConcluido]);

  const primeira = lista[0];

  return (
    <Dialog open={aberto} onOpenChange={fechar}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Corrigir no Omie</DialogTitle>
          {primeira && (
            <p className="text-[11.5px] text-muted-foreground">
              {primeira.pessoa} · cadastro em {primeira.departamento} · pago em {primeira.familia}
            </p>
          )}
        </DialogHeader>

        {rodando ? (
          <div className="py-4">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Alterando no Omie… {feitos} de {selecionados.length}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all"
                style={{ width: `${Math.round(((feitos ?? 0) / Math.max(1, selecionados.length)) * 100)}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Um título por vez — a API do Omie recusa chamadas simultâneas.</p>
            <Button size="sm" variant="outline" className="mt-2 h-7 text-[11.5px]" onClick={() => { cancelar.current = true; }}>
              Parar depois deste
            </Button>
          </div>
        ) : resultado ? (
          <Recusas resultado={resultado} onFechar={onClose} />
        ) : (
          <div className="space-y-3">
            {rhConcorda && (
              <Aviso>
                O Portal RH põe {rhConcorda.pessoa} em <b>{rhConcorda.departamento_rh}</b>, que combina com a categoria
                atual. Se a pessoa mudou de time, o certo é corrigir o cadastro em “Pessoas e regras”, e não o ERP.
              </Aviso>
            )}
            {travados > 0 && (
              <Aviso>
                {travados} {travados === 1 ? "lançamento está" : "lançamentos estão"} em mês travado na DRE. O Omie
                costuma recusar período contábil fechado; depois de três recusas iguais o laço para sozinho.
              </Aviso>
            )}

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-left font-semibold">Mês</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Hoje no Omie</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Vai para</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((l) => {
                    const k = String(l.cod_titulo);
                    const d = destinos.get(k);
                    const semDestino = !carregando && !d?.candidatas.length;
                    return (
                      <tr key={k} className="border-t border-border align-top">
                        <td className="px-2 py-2">
                          <Checkbox
                            checked={incluidos.has(k) && !!escolhas[k]}
                            disabled={!escolhas[k]}
                            onCheckedChange={(v) => setIncluidos((s) => {
                              const n = new Set(s);
                              if (v) n.add(k); else n.delete(k);
                              return n;
                            })}
                          />
                        </td>
                        <td className="num px-2 py-2 text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            {MESES[l.mes - 1]}/{String(ano).slice(2)}
                            {l.mes_travado && (
                              <span title="Mês travado na DRE"><Lock className="h-3 w-3" /></span>
                            )}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <span className="block">{l.categoria_descricao ?? l.categoria}</span>
                          <span className="num block text-[11px] text-muted-foreground">título {l.cod_titulo}</span>
                        </td>
                        <td className="px-2 py-2">
                          {carregando ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : semDestino ? (
                            <span className="text-[11.5px] text-muted-foreground">
                              nenhuma categoria de pessoa em {l.familias_esperadas.join(" ou ")}
                            </span>
                          ) : (
                            <>
                              <Select
                                value={escolhas[k] ?? ""}
                                onValueChange={(v) => {
                                  setEscolhas((e) => ({ ...e, [k]: v }));
                                  setIncluidos((s) => new Set(s).add(k));
                                }}
                              >
                                <SelectTrigger className="h-8 text-[12px]">
                                  <SelectValue placeholder="Escolha a categoria…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {d!.candidatas.map((c) => (
                                    <SelectItem key={c.codigo} value={c.codigo} className="text-[12px]">
                                      {c.descricao}
                                      {c.rubrica_dre ? <span className="text-muted-foreground"> · DRE {c.rubrica_dre}</span> : null}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {d!.mudaTipo && (
                                <span className="mt-0.5 block text-[11px] text-warn">
                                  Não há o mesmo tipo de pagamento em {l.familias_esperadas.join(" ou ")} — a troca muda a natureza.
                                </span>
                              )}
                              {!d!.sugerida && !d!.mudaTipo && (
                                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                  Mais de uma família possível: escolha o time.
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="num px-2 py-2 text-right">{comValorExato(l.valor, brl(l.valor))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11.5px] text-muted-foreground">
                {selecionados.length
                  ? <>{selecionados.length} {selecionados.length === 1 ? "título" : "títulos"} · {comValorExato(soma, brl(soma))} · a troca vale no ERP, e a trilha fica em “Alterações de categoria”</>
                  : "Nada marcado."}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
                <Button size="sm" onClick={executar} disabled={!selecionados.length || carregando}
                  title={selecionados.map((l) => `${l.cod_titulo}: → ${nomeCategoria(escolhas[String(l.cod_titulo)])}`).join("\n") || undefined}>
                  Trocar {selecionados.length || ""} no Omie
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[12px] leading-relaxed">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
      <span>{children}</span>
    </div>
  );
}

/** O que o ERP recusou, item a item — com o texto dele, não com um resumo meu. */
function Recusas({ resultado, onFechar }: { resultado: ResultadoLote; onFechar: () => void }) {
  const resumo = resumoLote(resultado);
  const falhas = resultado.resultados.filter((r) => !r.ok);
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] font-medium">{resumo.frase}</p>
      {resultado.interrompidoPor && (
        <p className="text-[11.5px] text-warn">
          Parei depois de três recusas iguais — os {resumo.naoTentados} restantes não foram tentados.
        </p>
      )}
      {resultado.cancelado && (
        <p className="text-[11.5px] text-muted-foreground">Parado a pedido. O que já tinha sido alterado continua alterado no Omie.</p>
      )}
      <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
        {falhas.map((f) => (
          <div key={f.item.codTitulo} className="border-b border-border/50 px-3 py-1.5 last:border-0">
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="truncate">{f.item.contraparte} · título {f.item.codTitulo}</span>
              <span className="num shrink-0 text-muted-foreground">{brl(f.item.valor)}</span>
            </div>
            <div className="text-[11px] leading-relaxed text-primary">{f.erro}</div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onFechar}>Fechar</Button>
      </div>
    </div>
  );
}
