/* A necessidade de capital de giro como card de apresentação.
 *
 * NÃO é um card novo: é o mesmo componente que a aba Análises da DRE já mostra
 * (`demonstracoes/CapitalGiro`), embrulhado para entrar no registro. Reescrever
 * a leitura do snapshot aqui daria uma segunda versão do mesmo número para
 * manter em dia — e o dia em que as duas divergissem seria numa reunião.
 *
 * ⚠️ Ele é foto do ÚLTIMO MÊS FECHADO no snapshot, não do mês da apresentação:
 * a necessidade é calculada pela edge `omie-capital-giro-sync` e o componente lê
 * a referência de lá. Numa folha de mês anterior isso aparece como um número
 * mais novo que o resto — daí o aviso. */

import { Info } from "lucide-react";
import CapitalGiro from "@/components/demonstracoes/CapitalGiro";
import type { ContextoCard } from "@/lib/registroCards";

export function CardCapitalGiro({ ctx }: { ctx: ContextoCard }) {
  return (
    <div className="flex flex-col gap-1.5">
      <CapitalGiro />
      <p className="flex items-start gap-1.5 text-[10.5px] leading-snug text-muted-foreground/80">
        <Info className="mt-px h-3 w-3 shrink-0" />
        Regime de caixa e foto do último mês fechado do Omie — não é a necessidade de{" "}
        {ctx.rotuloMes}.
      </p>
    </div>
  );
}
