import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

/**
 * O aviso que vai até você quando algo grave quebra.
 *
 * AS TRÊS DECISÕES QUE O DESENHAM (do usuário, em 30/08/2026):
 *
 * 1. SÓ O GRAVE INTERROMPE. `avisos_graves_abertos` devolve apenas
 *    `gravidade = 'alta'` — o resto continua na faixa do topo, que já mostra
 *    tudo. Interromper por qualquer coisa é o caminho conhecido para o modal
 *    virar clique automático em "Entendi", e aí o aviso grave também some.
 *
 * 2. FECHOU, NÃO VOLTA — a não ser que o problema mude de assinatura ou volte
 *    depois de resolvido. Quem garante isso é o banco: resolver APAGA a
 *    dispensa (ver a migração `20260830100000`).
 *
 * 3. SÓ AO CARREGAR OU NAVEGAR. Sem polling. Como as automações rodam de hora em
 *    hora, uma consulta por navegação chega perto de imediato e não deixa
 *    chamada em segundo plano para cada pessoa logada.
 *
 * UM DE CADA VEZ, o mais antigo primeiro. Empilhar quatro problemas numa caixa
 * com paginação transforma o aviso em relatório, e relatório não interrompe —
 * se lê depois, que é o oposto do pedido.
 *
 * A CAUSA E O CONSERTO VÊM JUNTO, e é a razão de o modal existir em vez de um
 * "algo deu errado". O texto é o que a IA escreveu sobre AQUELA falha
 * (`automacao_diagnostico`) ou o que a checagem apurou (`integracao_estado`).
 */

type Aviso = {
  fonte: "automacao" | "integracao";
  chave: string;
  assinatura: string;
  titulo: string;
  resumo: string | null;
  causa: string | null;
  o_que_fazer: string | null;
  ocorrencias: number;
  desde: string;
};

const db = supabase as any;

export function AvisoGrave() {
  const [fila, setFila] = useState<Aviso[]>([]);
  const [fechando, setFechando] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const ler = useCallback(() => {
    db.rpc("avisos_graves_abertos").then(({ data }: { data: Aviso[] | null }) => {
      setFila(data ?? []);
    });
  }, []);

  /* Relê a cada navegação. `pathname` na dependência é o gatilho — é o que
     substitui o polling que a decisão 3 dispensou. */
  useEffect(() => { ler(); }, [ler, pathname]);

  const atual = fila[0];

  const dispensar = useCallback(async (irPara?: string) => {
    if (!atual) return;
    setFechando(true);
    try {
      /* Grava a dispensa ANTES de fechar. Se a gravação falhar, o aviso continua
         na tela — o que é chato e correto: fechar sem registrar faria ele voltar
         na próxima navegação, e a pessoa aprenderia que o botão não funciona. */
      const { error } = await db.rpc("aviso_dispensar", {
        p_fonte: atual.fonte, p_chave: atual.chave, p_assinatura: atual.assinatura,
      });
      if (error) throw new Error(error.message);
      setFila((f) => f.slice(1));
      if (irPara) navigate(irPara);
    } catch {
      /* Silencioso de propósito: um toast de erro em cima de um modal de erro é
         ruído sobre ruído. O aviso simplesmente não sai, e insistir funciona. */
      setFechando(false);
      return;
    }
    setFechando(false);
  }, [atual, navigate]);

  if (!atual) return null;

  const destino = atual.fonte === "integracao" ? "/configuracoes/integracoes" : "/automacoes/painel";

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !fechando) dispensar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            Algo parou de funcionar
          </DialogTitle>
          <DialogDescription>
            {atual.fonte === "integracao"
              ? "Uma integração do Hub está fora do ar."
              : "Uma automação está falhando."}
            {fila.length > 1 && ` Há mais ${fila.length - 1} aviso${fila.length > 2 ? "s" : ""} depois deste.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 text-[13px]">
          <div>
            <p className="font-medium">{atual.titulo}</p>
            {atual.resumo && <p className="text-muted-foreground">{atual.resumo}</p>}
            {atual.ocorrencias > 1 && (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Já aconteceu {atual.ocorrencias} vezes.
              </p>
            )}
          </div>

          {atual.causa && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Causa provável
              </p>
              <p>{atual.causa}</p>
            </div>
          )}

          {atual.o_que_fazer && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                O que fazer
              </p>
              <p>{atual.o_que_fazer}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline" size="sm" className="h-8"
            disabled={fechando}
            onClick={() => dispensar(destino)}
          >
            {atual.fonte === "integracao" ? "Ver integrações" : "Ver automações"}
          </Button>
          <Button size="sm" className="h-8" disabled={fechando} onClick={() => dispensar()}>
            {fechando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Entendi
          </Button>
        </DialogFooter>

        <p className="text-[11px] text-muted-foreground">
          Este aviso não volta — a não ser que o problema mude, ou volte depois de resolvido.
        </p>
      </DialogContent>
    </Dialog>
  );
}
