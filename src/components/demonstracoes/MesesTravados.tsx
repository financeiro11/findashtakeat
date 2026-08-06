import { useState } from "react";
import { Lock, LockOpen, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/* ---------------------------------------------------------------------------
 * Cadeado por mês da DRE/DFC.
 *
 * Mês travado é mês fechado: o omie-sync nunca sobrescreve a coluna. Isso vale
 * enquanto o mês fechou de verdade — se um mês corrente for travado por engano
 * (foi o que houve com Jul-26), a coluna congela pela metade e nenhuma sync
 * conserta. Daí este controle: destravar devolve o mês para o Omie.
 *
 * A trava é compartilhada entre DRE e DFC — mesma planilha, mesmo mês — então
 * destravar aqui destrava nas duas telas.
 * ------------------------------------------------------------------------- */

/** Grava a trava. Devolve true quando deu certo — o chamador decide o que fazer depois. */
export async function alternarTrava(col: string, travar: boolean): Promise<boolean> {
  const tabela = supabase.from("demonstracoes_mes_trancado");
  const { error } = travar
    ? await tabela.insert({ col_key: col, origem: "painel" })
    : await tabela.delete().eq("col_key", col);
  if (error) {
    toast.error(
      travar ? `Não consegui travar ${col}: ${error.message}` : `Não consegui destravar ${col}: ${error.message}`,
    );
    return false;
  }
  return true;
}

type Props = {
  /** colunas de mês já ordenadas (mais antiga → mais nova) */
  columns: string[];
  travados: Set<string>;
  label: (col: string) => string;
  /** true enquanto uma troca está em curso (o pai recalcula depois de destravar) */
  ocupado?: boolean;
  onAlterar: (col: string, travar: boolean) => void;
};

/** Chip "N travados" no subtítulo, que abre a lista de meses com o interruptor. */
export function MesesTravadosChip({ columns, travados, label, ocupado, onAlterar }: Props) {
  const [aberto, setAberto] = useState(false);
  // Mais recente primeiro: o mês que dá problema é sempre o do topo.
  const meses = [...columns].reverse();

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "ml-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-px align-middle transition",
            travados.size > 0
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "border-border text-muted-foreground hover:bg-secondary",
          )}
          title="Ver e destravar meses"
        >
          {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
          {travados.size > 0 ? `${travados.size} travado${travados.size === 1 ? "" : "s"}` : "nenhum travado"}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[290px] p-0">
        <div className="border-b border-border px-3 py-2">
          <div className="text-[12px] font-semibold text-foreground">Meses travados</div>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Mês travado não recebe dado do Omie. Destrave para o mês voltar a ser preenchido
            pelo que já está sincronizado.
          </p>
        </div>

        <div className="max-h-[280px] overflow-y-auto py-1">
          {meses.map((c) => {
            const travado = travados.has(c);
            return (
              <div key={c} className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-secondary/60">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-foreground">
                  {travado
                    ? <Lock className="h-3 w-3 text-emerald-600" />
                    : <LockOpen className="h-3 w-3 text-muted-foreground" />}
                  {label(c).replace("/", " ")}
                </span>
                <button
                  disabled={ocupado}
                  onClick={() => onAlterar(c, !travado)}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-40",
                    travado
                      ? "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                  )}
                >
                  {travado ? "Destravar" : "Travar"}
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Cadeado clicável no cabeçalho da coluna — atalho para o mesmo interruptor. */
export function CadeadoColuna({
  col, travado, label, ocupado, onAlterar,
}: {
  col: string; travado: boolean; label: string; ocupado?: boolean;
  onAlterar: (col: string, travar: boolean) => void;
}) {
  return (
    <button
      disabled={ocupado}
      onClick={() => onAlterar(col, !travado)}
      title={
        travado
          ? `${label} está travado — dado do tracker, não sincroniza com o Omie. Clique para destravar.`
          : `${label} sincroniza com o Omie. Clique para travar e congelar os valores.`
      }
      className={cn(
        "inline-flex rounded-sm p-px transition disabled:opacity-40",
        travado
          ? "text-emerald-600 hover:bg-emerald-100"
          // Sem trava o cadeado só aparece no hover do cabeçalho: 31 cadeados
          // abertos permanentes seriam ruído em cima do que importa, os números.
          : "text-muted-foreground/0 group-hover/col:text-muted-foreground hover:bg-secondary",
      )}
    >
      {travado ? <Lock className="h-2.5 w-2.5" /> : <LockOpen className="h-2.5 w-2.5" />}
    </button>
  );
}
