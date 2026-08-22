/**
 * NFs que vieram pelo Hub de Facilities e ainda não têm dono.
 *
 * Quando a nota bate com folga (CNPJ do documento, ou nome do fornecedor + data perto),
 * ela já entrou sozinha na auditoria e não aparece aqui. Aqui ficam só os casos em que
 * o valor bateu mas a prova é fraca — dois lançamentos igualmente prováveis, nome que
 * não se parece com o do extrato, data distante. Nesses, quem decide é gente: casar
 * errado marcaria um lançamento como resolvido com a nota de outro gasto.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, ExternalLink, Loader2, Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolverComprovante } from "@/lib/comprovante";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Proposta = {
  id: number;
  compra_id: string;
  compra_item: string | null;
  compra_data: string | null;
  compra_valor: number | null;
  fornecedor_nome: string | null;
  forma_pagamento: string | null;
  nf_arquivo: string | null;
  nf_nome: string | null;
  nf_numero: string | null;
  nf_cnpj: string | null;
  alvo_tipo: "cartao" | "pix" | "achado";
  alvo_id_unico: string;
  alvo_descricao: string | null;
  alvo_data: string | null;
  alvo_valor: number | null;
  confianca: "exata" | "alta" | "media" | "baixa";
  score: number | null;
  criterio: Record<string, unknown> | null;
};

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: string | null | undefined) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—";

const ALVO_LABEL: Record<string, string> = { cartao: "cartão", pix: "PIX/boleto", achado: "achado" };

export default function FacilitiesNfPropostas({ onAplicado }: { onAplicado?: () => void }) {
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("facilities_nf_propostas");
    if (error) return; // a barra some em vez de gritar: não é o assunto principal da tela
    setPropostas((data as Proposta[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const decidir = async (p: Proposta, aceita: boolean) => {
    setOcupado(p.id);
    try {
      const body = aceita
        ? {
            action: "aplicar", compra_id: p.compra_id, alvo_tipo: p.alvo_tipo,
            alvo_id_unico: p.alvo_id_unico, confianca: p.confianca,
            criterio: p.criterio ?? {}, score: p.score,
          }
        : { action: "recusar", vinculo_id: p.id };
      const { data, error } = await supabase.functions.invoke("facilities-nf-auditoria", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(aceita ? "NF lançada no comprovante." : "Proposta descartada.");
      await load();
      if (aceita) onAplicado?.();
    } catch (e: any) {
      toast.error(e?.message || "Não consegui registrar a decisão.");
    } finally {
      setOcupado(null);
    }
  };

  const abrir = async (p: Proposta) => {
    if (!p.nf_arquivo) return;
    try {
      window.open(await resolverComprovante(p.nf_arquivo), "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message || "Não consegui abrir a NF.");
    }
  };

  if (propostas.length === 0) return null;

  // Barra de 44px fechada, igual aos outros avisos da auditoria — abre sob demanda.
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex h-11 w-full items-center gap-2 px-4 text-left"
      >
        <Paperclip className="h-4 w-4 text-[hsl(212_80%_45%)]" />
        <span className="text-sm font-medium text-foreground">
          {propostas.length} NF(s) do Facilities esperando confirmação
        </span>
        <span className="text-[12px] text-muted-foreground">
          — o valor bateu, mas não dá para afirmar a qual lançamento pertence
        </span>
        <span className="ml-auto text-[12px] text-muted-foreground">{aberto ? "fechar" : "ver"}</span>
      </button>

      {aberto && (
        <div className="border-t border-border divide-y divide-border/60">
          {propostas.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-[220px] flex-1">
                <div className="text-[13px] text-foreground">
                  {p.compra_item || "—"}
                  <span className="text-muted-foreground"> · {p.fornecedor_nome || "sem fornecedor"}</span>
                </div>
                <div className="text-[11.5px] text-muted-foreground">
                  compra {dia(p.compra_data)} · {brl(p.compra_valor)}
                  {p.nf_numero ? ` · NF ${p.nf_numero}` : ""}
                </div>
              </div>

              <div className="text-muted-foreground">→</div>

              <div className="min-w-[220px] flex-1">
                <div className="text-[13px] text-foreground">{p.alvo_descricao || p.alvo_id_unico}</div>
                <div className="text-[11.5px] text-muted-foreground">
                  {ALVO_LABEL[p.alvo_tipo] ?? p.alvo_tipo} · {dia(p.alvo_data)} · {brl(p.alvo_valor)}
                  {typeof p.criterio?.dias === "number" ? ` · ${Math.abs(p.criterio.dias as number)}d de diferença` : ""}
                </div>
              </div>

              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium",
                  p.confianca === "media" ? "bg-amber-50 text-amber-700" : "bg-muted text-muted-foreground",
                )}
                title="Confiança do casamento: só 'exata' e 'alta' entram sozinhas."
              >
                {p.confianca}
              </span>

              {p.nf_arquivo && (
                <button
                  onClick={() => abrir(p)}
                  className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
                  title="Abrir a NF que o Facilities mandou"
                >
                  <ExternalLink className="h-3 w-3" /> ver NF
                </button>
              )}

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm" variant="outline" className="h-7 px-2"
                  disabled={ocupado === p.id}
                  onClick={() => decidir(p, true)}
                  title="Esta NF é o comprovante deste lançamento"
                >
                  {ocupado === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  <span className="ml-1 text-[12px]">é esta</span>
                </Button>
                <Button
                  size="sm" variant="ghost" className="ghost-icone h-7 w-7"
                  disabled={ocupado === p.id}
                  onClick={() => decidir(p, false)}
                  title="Não é este lançamento"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
