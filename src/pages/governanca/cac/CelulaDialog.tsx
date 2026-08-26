import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronRight, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { comValorExato } from "@/components/ValorExato";
import { useApelidos } from "@/hooks/useApelidos";
import { nomeExibido } from "@/lib/apelidos";
import {
  MESES, agruparPorPessoa, resumirCelula, desvioVsMedia,
  type Lancamento, type LinhaMatriz,
} from "@/lib/cac";

const db = supabase as unknown as {
  rpc: (n: string, a?: Record<string, unknown>) => any;
};

function brl(n: number | null | undefined) {
  const v = Number(n);
  if (n == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const pctStr = (v: number) =>
  (v > 0 ? "+" : "") + (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";

export function CelulaDialog({
  ano, linha, mes, onClose,
}: {
  ano: number;
  linha: LinhaMatriz | null;
  mes: number | null;
  onClose: () => void;
}) {
  const [lancs, setLancs] = useState<Lancamento[]>([]);
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const apelidos = useApelidos();

  const aberto = !!linha && mes != null;

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setLoading(true);
    setBusca("");
    setAberta(null);

    void (async () => {
      const { data, error } = await db.rpc("cac_celula", {
        p_ano: ano, p_mes: mes, p_linha_id: linha!.linha_id,
      });
      if (cancelado) return;
      if (error) {
        toast.error("Não consegui abrir a célula", { description: error.message });
        setLancs([]);
      } else {
        setLancs((data ?? []) as Lancamento[]);
      }
      setLoading(false);
    })();

    return () => { cancelado = true; };
  }, [aberto, ano, mes, linha]);

  const resumo = useMemo(() => resumirCelula(lancs), [lancs]);
  const pessoas = useMemo(() => agruparPorPessoa(lancs), [lancs]);

  /* O mesmo desvio que pinta a célula na matriz. Quem clicou clicou POR CAUSA
     da cor — a explicação tem de estar aqui dentro, não só no hover que ficou
     para trás. */
  const dv = useMemo(
    () => (linha && mes ? desvioVsMedia(linha.meses, mes - 1) : null),
    [linha, mes],
  );

  /* A busca varre o apelido junto com o nome cru e o CNPJ. Se varresse só o
     que o Omie escreveu, procurar pelo nome que está ESCRITO na linha não
     acharia nada — a lição da Parametrização. */
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return pessoas;
    return pessoas.filter((p) => {
      const alvo = [
        p.pessoa,
        p.cnpj,
        ...p.lancamentos.map((l) => l.favorecido ?? ""),
        ...p.lancamentos.map((l) => nomeExibido(apelidos, l.favorecido, l.cnpj)),
        ...p.lancamentos.map((l) => l.categoria_descricao ?? ""),
      ].join(" ").toLowerCase();
      return alvo.includes(q);
    });
  }, [pessoas, busca, apelidos]);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {linha?.rotulo} · {mes ? MESES[mes - 1] : ""}/{String(ano).slice(2)}
          </DialogTitle>
          <p className="text-[11.5px] text-muted-foreground">
            {linha?.grupo}
            {" · "}
            {dv ? `${pctStr(dv.desvio)} vs média 3m (${brl(dv.media)})` : "sem base de comparação"}
            {!loading && ` · ${pessoas.length} pessoa(s) na regra`}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Folha × comissão: em Inside Sales mais da metade da célula é
                variável, e sem separar isso o número não conta a história. */}
            <div className="grid grid-cols-4 gap-2">
              <Resumo rotulo="Folha" valor={resumo.folha} total={resumo.total} />
              <Resumo rotulo="Comissão" valor={resumo.comissao} total={resumo.total} />
              <Resumo rotulo="Total" valor={resumo.total} total={resumo.total} destaque />
              <div className="rounded-md border border-border px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Desvio 3m</p>
                <p className={cn("num text-[14px] font-semibold", dv && (dv.desvio > 0 ? "text-neg" : "text-pos"))}>
                  {dv ? pctStr(dv.desvio) : "—"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {dv ? `média ${brl(dv.media)}` : "sem base"}
                </p>
              </div>
            </div>

            {resumo.semPagamento.length > 0 && (
              <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warn">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {resumo.semPagamento.length} sem pagamento neste mês
                  <span className="font-normal text-muted-foreground">
                    · {comValorExato(resumo.semPagamentoEsperado, brl(resumo.semPagamentoEsperado))} de remuneração cadastrada
                  </span>
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {resumo.semPagamento.map((l) => l.pessoa).join(" · ")}
                </p>
              </div>
            )}

            {pessoas.length > 4 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar pessoa, CNPJ ou categoria…"
                  className="h-8 pl-8 text-[12.5px]"
                />
              </div>
            )}

            <div className="max-h-[46vh] overflow-y-auto rounded-md border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-semibold">Pessoa</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Folha</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Comissão</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((p) => (
                    <PessoaLinha
                      key={p.chave}
                      p={p}
                      aberta={aberta === p.chave}
                      onToggle={() => setAberta(aberta === p.chave ? null : p.chave)}
                      apelidos={apelidos}
                    />
                  ))}
                  {!filtradas.length && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      {busca ? "Nada encontrado." : "Sem lançamentos neste mês."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {linha?.regra_nota && (
              <p className={cn(
                "text-[11.5px] leading-relaxed",
                linha.regra_nota.startsWith("CONFERIR") ? "text-warn" : "text-muted-foreground",
              )}>
                {linha.regra_nota}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Resumo({ rotulo, valor, total, destaque }: {
  rotulo: string; valor: number; total: number; destaque?: boolean;
}) {
  const pct = total > 0 ? (valor / total) * 100 : 0;
  return (
    <div className={cn("rounded-md border border-border px-3 py-2", destaque && "bg-muted/40")}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="num text-[14px] font-semibold" title={valorExato(valor)}>{brl(valor)}</p>
      {!destaque && total > 0 && (
        <p className="text-[11px] text-muted-foreground">{pct.toFixed(0)}% da célula</p>
      )}
    </div>
  );
}

function PessoaLinha({ p, aberta, onToggle, apelidos }: {
  p: ReturnType<typeof agruparPorPessoa>[number];
  aberta: boolean;
  onToggle: () => void;
  apelidos: ReturnType<typeof useApelidos>;
}) {
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={onToggle}>
        <td className="px-3 py-1.5">
          <span className="inline-flex items-center gap-1">
            <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", aberta && "rotate-90")} />
            {p.pessoa}
          </span>
        </td>
        <td className="px-3 py-1.5 text-right num text-muted-foreground">{p.folha ? comValorExato(p.folha, brl(p.folha)) : "—"}</td>
        <td className="px-3 py-1.5 text-right num text-muted-foreground">{p.comissao ? comValorExato(p.comissao, brl(p.comissao)) : "—"}</td>
        <td className="px-3 py-1.5 text-right num font-medium">{comValorExato(p.total, brl(p.total))}</td>
      </tr>

      {aberta && p.lancamentos.map((l) => {
        /* Apelido em cima, nome cru embaixo — é o nome cru que se procura no
           Omie, então ele não pode sumir da tela. */
        const cru = l.favorecido ?? "";
        const exibido = nomeExibido(apelidos, cru, l.cnpj);
        return (
          <tr key={l.cod_titulo ?? `${l.cnpj}-${l.categoria}`} className="border-t border-border/50 bg-muted/10">
            <td className="px-3 py-1.5 pl-9">
              <span className="block text-[12px]">
                {l.data_pagamento ? new Date(`${l.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR") : "—"}
                {" · "}
                <span className="text-muted-foreground">{l.categoria_descricao ?? l.categoria ?? "—"}</span>
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {exibido !== cru ? `${exibido} · ${cru}` : cru}
                {l.cod_titulo ? ` · título ${l.cod_titulo}` : ""}
              </span>
            </td>
            <td colSpan={2} className="px-3 py-1.5 text-right">
              <Badge variant="outline" className="text-[10.5px]">{l.natureza ?? "—"}</Badge>
            </td>
            <td className="px-3 py-1.5 text-right num">{comValorExato(l.valor, brl(l.valor))}</td>
          </tr>
        );
      })}
    </>
  );
}
