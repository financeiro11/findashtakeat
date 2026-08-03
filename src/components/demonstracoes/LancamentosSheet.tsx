import { useEffect, useState } from "react";
import { Loader2, TriangleAlert, Check, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/* ---------------------------------------------------------------------------
 * Auditoria: os lançamentos do Omie por trás de uma célula da DRE/DFC.
 *
 * Chama a função `demonstracoes_lancamentos` (ver a migration
 * 20260803150000), que reproduz a atribuição do omie-sync. A soma é sempre
 * exibida ao lado do valor da célula: quando as duas batem, é o carimbo de que
 * a lista está completa; quando não batem, o painel diz por quê em vez de
 * deixar a conta furada passar batido.
 * ------------------------------------------------------------------------- */

export type AlvoLancamentos = {
  tipo: "dre" | "dfc";
  rubrica: string;
  mes: string;        // "Jul-26"
  mesLabel: string;   // "Jul 26"
  celula: number | null;
  travado: boolean;
};

type Lancamento = {
  data: string | null;
  vencimento: string | null;
  titulo: string | null;
  documento: string | null;
  contraparte: string | null;
  cnpj_cpf: string | null;
  categoria_codigo: string | null;
  categoria_descricao: string | null;
  grupo: string | null;
  status: string | null;
  valor: number | null;
};

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const dataCurta = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—");

/** CNPJ/CPF só com dígitos fica ilegível numa coluna estreita. */
const doc = (v: string | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return v ?? "—";
};

export function LancamentosSheet({ alvo, onClose }: { alvo: AlvoLancamentos | null; onClose: () => void }) {
  const [linhas, setLinhas] = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!alvo) return;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    supabase
      .rpc("demonstracoes_lancamentos", { p_tipo: alvo.tipo, p_rubrica: alvo.rubrica, p_mes: alvo.mes })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) { setErro(error.message); setLinhas([]); }
        else setLinhas((data as Lancamento[]) ?? []);
        setCarregando(false);
      });
    return () => { cancelado = true; };
    // Depende dos três campos da consulta, não do objeto: `celula` e `travado`
    // mudam de identidade a cada clique e disparariam uma busca idêntica.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.tipo, alvo?.rubrica, alvo?.mes]);

  const soma = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const bate = alvo?.celula != null && Math.abs(soma - alvo.celula) < 0.5;
  const dataUsada = alvo?.tipo === "dre" ? "data de registro (competência)" : "data de pagamento (caixa)";

  return (
    <Sheet open={!!alvo} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-[640px]">
        {alvo && (
          <div className="flex h-full flex-col">
            {/* ---------------- cabeçalho ---------------- */}
            <SheetHeader className="shrink-0 space-y-0 border-b border-border px-5 pb-3 pt-5 text-left">
              <SheetTitle className="text-[15px] font-semibold">
                {alvo.rubrica} <span className="text-muted-foreground">· {alvo.mesLabel}</span>
              </SheetTitle>
              <p className="pt-0.5 text-[11.5px] text-muted-foreground">
                {alvo.tipo.toUpperCase()} · lançamentos do Omie por {dataUsada}
              </p>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-2.5">
                <div>
                  <div className="text-[9px] font-bold tracking-[0.14em] text-muted-foreground">NA TELA</div>
                  <div className="num text-[15px] font-bold text-foreground">
                    {alvo.celula != null ? moeda(alvo.celula) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold tracking-[0.14em] text-muted-foreground">SOMA DOS LANÇAMENTOS</div>
                  <div className={cn("num text-[15px] font-bold", bate ? "text-emerald-600" : "text-foreground")}>
                    {moeda(soma)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold tracking-[0.14em] text-muted-foreground">QUANTIDADE</div>
                  <div className="num text-[15px] font-bold text-foreground">{linhas.length}</div>
                </div>
              </div>
            </SheetHeader>

            {/* Sem este aviso o painel mentiria: em mês travado a célula vem da
                planilha e não tem por que casar com o que o Omie tem. */}
            {!carregando && !erro && !bate && alvo.celula != null && (
              <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
                <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-amber-900">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    A soma difere da célula em <b className="num">{moeda(soma - alvo.celula)}</b>.
                    {alvo.travado
                      ? " Este mês está travado, então o valor na tela veio do tracker, não do Omie — a diferença é o quanto as duas fontes discordam."
                      : " Pode ser lançamento fora da janela de sincronização ou mudança no DE-PARA depois do último recálculo."}
                  </span>
                </div>
              </div>
            )}
            {!carregando && !erro && bate && (
              <div className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-5 py-2 text-[11.5px] text-emerald-800">
                <Check className="mr-1 inline h-3.5 w-3.5" />
                A soma dos lançamentos bate exatamente com o valor na tela.
              </div>
            )}

            {/* ---------------- lista ---------------- */}
            <div className="min-h-0 flex-1 overflow-auto">
              {carregando ? (
                <div className="flex h-32 items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando lançamentos…
                </div>
              ) : erro ? (
                <div className="px-5 py-8 text-center text-[12.5px] text-primary">{erro}</div>
              ) : !linhas.length ? (
                <div className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
                  Nenhum lançamento do Omie caiu nesta rubrica neste mês.
                  {alvo.travado && (
                    <div className="mt-1 text-[11.5px]">
                      Como o mês está travado, o valor da tela vem do tracker importado.
                    </div>
                  )}
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                    <tr className="border-b border-border text-[9.5px] font-semibold tracking-[0.06em] text-muted-foreground">
                      <th className="px-3 py-2 text-left">DATA</th>
                      <th className="px-2 py-2 text-left">CONTRAPARTE</th>
                      <th className="px-2 py-2 text-left">CATEGORIA NO OMIE</th>
                      <th className="px-3 py-2 text-right">VALOR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l, i) => (
                      <tr key={i} className="border-b border-border/60 align-top hover:bg-muted/30">
                        <td className="whitespace-nowrap px-3 py-2 text-[11.5px] num text-muted-foreground">
                          {dataCurta(l.data)}
                        </td>
                        <td className="px-2 py-2 text-[11.5px]">
                          <div className="text-foreground">{l.contraparte ?? doc(l.cnpj_cpf)}</div>
                          <div className="mt-px flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
                            {l.titulo && <span className="inline-flex items-center gap-0.5"><FileText className="h-2.5 w-2.5" />{l.titulo}</span>}
                            {l.documento && <span>NF {l.documento}</span>}
                            {l.status && <span className="uppercase">{l.status}</span>}
                          </div>
                        </td>
                        {/* O código é o que se corrige no Omie; a descrição é o que
                            o DE-PARA casa. Auditar categorização precisa dos dois. */}
                        <td className="px-2 py-2 text-[11.5px]">
                          <div className="text-foreground/90">{l.categoria_descricao ?? "—"}</div>
                          <div className="mt-px font-mono text-[10px] text-muted-foreground">{l.categoria_codigo ?? "—"}</div>
                        </td>
                        <td className={cn(
                          "whitespace-nowrap px-3 py-2 text-right text-[11.5px] num font-medium",
                          (l.valor ?? 0) < 0 ? "text-primary" : "text-emerald-700",
                        )}>
                          {moeda(Number(l.valor) || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
