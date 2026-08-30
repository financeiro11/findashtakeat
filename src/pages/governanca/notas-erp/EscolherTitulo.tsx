import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, FileText, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/**
 * O empate tem saída: escolher o título à mão.
 *
 * POR QUE ESTA JANELA EXISTE. O casador é DETERMINÍSTICO — quando dois títulos
 * batem igualmente bem com uma nota, ele não escolhe, e no dia seguinte não
 * escolhe de novo, pelas mesmas razões. Até aqui o único caminho era esperar,
 * e esperar não resolvia: os documentos em "mais de um cabe" e "dois querem o
 * mesmo" ficavam parados para sempre, somando dinheiro numa fila que ninguém
 * sabia destravar.
 *
 * O QUE ELA MOSTRA. Os candidatos que o próprio casador levantou
 * (`notas_externas_candidatos`), lado a lado, com o que separa um do outro:
 * valor, data, categoria e — o mais decisivo — se aquele título JÁ TEM nota.
 * Um título que já tem nota quase nunca é o certo, e é justamente o que produz
 * o empate.
 *
 * O QUE ELA ESCREVE. `notas_externas_definir_alvo`, que marca o alvo como
 * MANUAL. Isso importa duas vezes: o documento passa a "sobe sozinha" (a view
 * `notas_externas_parada` trata alvo manual como confiança alta), e o casador
 * não desfaz depois — a decisão de gente vence a heurística, sempre.
 *
 * Não anexa nada aqui. Escolher é dizer QUAL título; quem leva o arquivo ao ERP
 * continua sendo a fila, pelo mesmo caminho de sempre.
 */

/** O mínimo que a lista precisa passar para esta janela abrir. */
export type NotaEmEscolha = {
  id: number;
  nome: string | null;
  o_que_e: string | null;
  valor: number | null;
  data: string | null;
};

/**
 * A opinião da IA sobre o empate (`notas_externas.sugestao_ia`, escrita pela
 * função `notas-explicar` desde 29/08/2026).
 *
 * ELA É PALPITE COM RASTRO, NÃO DECISÃO. Aparece como uma linha acima da tabela,
 * destacando o candidato de que ela fala — e quem grava continua sendo o botão
 * "É este", clicado por gente. Se `escolheu` for falso, a IA olhou e desistiu:
 * isso também é informação, e mostrar a recusa é mais honesto que esconder que
 * alguém já tentou.
 */
type Sugestao = {
  escolheu: boolean;
  alvo_id_unico?: string;
  porque?: string;
  confianca?: "alta" | "media" | "baixa";
  modelo?: string;
};

/** Uma linha de `notas_externas_candidatos(p_id)`. */
type Candidato = {
  alvo_tipo: string;
  id_unico: string;
  cod_titulo: string | null;
  nome: string | null;
  valor: number | null;
  data: string | null;
  categoria: string | null;
  /** Já tem nota anexada no ERP — quase sempre o sinal de que NÃO é este. */
  ja_tem_nota: boolean;
  /** Distância em dias entre a nota e o título. */
  dias: number | null;
};

const db = supabase as any;

const brl = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataBR = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : "—";
};

export function EscolherTitulo({
  nota, aoFechar, aoEscolher,
}: {
  nota: NotaEmEscolha;
  aoFechar: () => void;
  /** Chamado DEPOIS de gravar, para a tela reler resumo e lista. */
  aoEscolher: () => void;
}) {
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCandidatos(null);
    setSugestao(null);
    db.rpc("notas_externas_candidatos", { p_id: nota.id }).then(
      ({ data, error }: { data: Candidato[] | null; error: { message: string } | null }) => {
        if (!vivo) return;
        if (error) {
          toast.error("Não consegui ler os candidatos: " + error.message);
          setCandidatos([]);
          return;
        }
        setCandidatos(data ?? []);
      },
    );
    /* A sugestão é ACESSÓRIA: se não vier, a janela funciona igual à de antes.
       Por isso ela não entra no mesmo `then` dos candidatos nem bloqueia nada —
       um erro aqui não pode tirar de alguém a única saída que o empate tem. */
    db.from("notas_externas").select("sugestao_ia").eq("id", nota.id).maybeSingle()
      .then(({ data }: { data: { sugestao_ia: Sugestao | null } | null }) => {
        if (vivo && data?.sugestao_ia) setSugestao(data.sugestao_ia);
      });
    return () => { vivo = false; };
  }, [nota.id]);

  const escolher = useCallback(async (c: Candidato) => {
    setGravando(c.id_unico);
    try {
      const { error } = await db.rpc("notas_externas_definir_alvo", {
        p_id: nota.id,
        p_alvo_tipo: c.alvo_tipo,
        p_alvo_id_unico: c.id_unico,
      });
      if (error) throw new Error(error.message);
      toast.success(
        `Apontado para ${c.nome || c.cod_titulo || "o título escolhido"}. `
        + "Como a escolha é manual, sobe sozinha na próxima fila.",
      );
      aoEscolher();
      aoFechar();
    } catch (e) {
      toast.error("Não consegui apontar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGravando(null);
    }
  }, [nota.id, aoEscolher, aoFechar]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !gravando) aoFechar(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Escolher o título desta nota</DialogTitle>
          <DialogDescription>
            O casador não desempata sozinho — e não vai desempatar amanhã, porque é determinístico.
            Escolher aqui marca o alvo como manual, e aí ele sobe sem passar por mais ninguém.
          </DialogDescription>
        </DialogHeader>

        {/* O documento, para comparar contra os candidatos sem trocar de tela. */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12.5px]">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{nota.nome || nota.o_que_e || "(sem nome)"}</span>
          <span className="tabular-nums">{nota.valor == null ? "sem valor lido" : brl(nota.valor)}</span>
          <span className="text-muted-foreground">{dataBR(nota.data)}</span>
        </div>

        {/* O palpite da IA, quando existe. Fica ACIMA da tabela e fora dela de
            propósito: é uma leitura sobre os candidatos, não mais um candidato. */}
        {sugestao && (
          <div className={cn(
            "flex gap-2.5 rounded-lg border px-3 py-2 text-[12.5px]",
            sugestao.escolheu
              ? "border-primary/30 bg-primary/5"
              : "border-border bg-muted/40",
          )}>
            <Sparkles className={cn(
              "mt-0.5 h-4 w-4 shrink-0",
              sugestao.escolheu ? "text-primary" : "text-muted-foreground",
            )} />
            <div className="min-w-0">
              <span className="font-medium">
                {sugestao.escolheu
                  ? "A IA leu o documento e aposta num deles"
                  : "A IA leu o documento e não quis escolher"}
              </span>
              {sugestao.porque && (
                <span className="block text-muted-foreground">{sugestao.porque}</span>
              )}
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {sugestao.escolheu && sugestao.confianca
                  ? `Confiança ${sugestao.confianca}. `
                  : ""}
                É palpite, não decisão — quem aponta o título é você, no botão da linha.
              </span>
            </div>
          </div>
        )}

        <div className="max-h-[50vh] overflow-auto">
          {candidatos === null ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : candidatos.length === 0 ? (
            <p className="py-10 text-center text-[12.5px] text-muted-foreground">
              O casador não levantou candidato nenhum para este documento. Não há o que escolher —
              este é um caso de "nenhum título bate", não de empate.
            </p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Título</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Categoria</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {candidatos.map((c) => {
                  /* O que separa um candidato do outro é a divergência, não a
                     coincidência: repetir o valor igual em todas as linhas é
                     ruído, e a diferença é a informação. */
                  const diverge = nota.valor != null && c.valor != null
                    && Math.abs(Number(nota.valor) - Number(c.valor)) > 0.02;
                  const apontado = !!sugestao?.escolheu && sugestao.alvo_id_unico === c.id_unico;
                  return (
                    <tr
                      key={c.id_unico}
                      className={cn(
                        "border-b border-border/50 last:border-0 align-top",
                        apontado && "bg-primary/5",
                      )}
                    >
                      <td className="px-3 py-2">
                        <span className="block font-medium">{c.nome || "(sem nome)"}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {c.alvo_tipo}{c.cod_titulo ? ` · ${c.cod_titulo}` : ""}
                          {c.dias != null && ` · ${Math.abs(c.dias)} dia(s) de distância`}
                        </span>
                        {c.ja_tem_nota && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" /> já tem nota anexada
                          </span>
                        )}
                        {apontado && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-bold text-primary">
                            <Sparkles className="h-3 w-3" /> é o que a IA aponta
                          </span>
                        )}
                      </td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", diverge && "text-destructive")}>
                        {brl(c.valor)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{dataBR(c.data)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.categoria || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm" variant="outline" className="h-7"
                          disabled={!!gravando}
                          onClick={() => escolher(c)}
                        >
                          {gravando === c.id_unico
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Check className="h-3.5 w-3.5" />}
                          É este
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-[11.5px] text-muted-foreground">
          Escolher aponta o título, não anexa o arquivo. Quem leva a nota ao ERP continua sendo a
          fila — este documento entra nela na próxima passada.
        </p>
      </DialogContent>
    </Dialog>
  );
}
