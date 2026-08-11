import { ArrowUp, ArrowDown, Equal, History } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Situacao } from "@/lib/comparativoFornecedores";

/* ---------------------------------------------------------------------------
 * O chip de "novo / voltou / subiu / caiu / igual / sumiu".
 *
 * Mora aqui porque dois painéis do drill-down o usam — o comparativo de
 * fornecedores e a composição por categoria — e eles ficam um embaixo do outro
 * na mesma tela. Duas cópias divergiriam na primeira mexida de cor, e a mesma
 * situação passaria a ser lida de dois jeitos a dez pixels de distância.
 *
 * VERDE/VERMELHO SEGUEM O CAIXA, NÃO O NÚMERO: numa despesa, gastar menos é
 * verde mesmo com o valor "caindo". Novo e voltou não são bons nem ruins — são
 * fatos —, então ficam em cor própria em vez de julgar.
 * ------------------------------------------------------------------------- */

export function ChipSituacao({
  situacao, favoravel, rotulo, titulo, className,
}: {
  situacao: Situacao;
  favoravel: boolean;
  rotulo: string;
  /** A frase inteira, com os dois meses — sem ela o número do chip mente por omissão. */
  titulo: string;
  className?: string;
}) {
  const Icone =
    situacao === "subiu" ? ArrowUp
    : situacao === "caiu" ? ArrowDown
    : situacao === "igual" ? Equal
    : situacao === "voltou" ? History
    : null;

  const cor =
    situacao === "novo" ? "border-indigo-300 bg-indigo-100 text-indigo-900"
    : situacao === "voltou" ? "border-sky-300 bg-sky-100 text-sky-900"
    : situacao === "igual" || situacao === "sumiu" ? "border-border bg-muted text-muted-foreground"
    : favoravel ? "border-emerald-300 bg-emerald-100 text-emerald-900"
    : "border-rose-300 bg-rose-100 text-rose-900";

  return (
    <span
      title={titulo}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border px-1.5 text-[9.5px] font-semibold leading-[15px]",
        cor,
        className,
      )}
    >
      {Icone && <Icone strokeWidth={3} className="h-2.5 w-2.5" />}
      {rotulo}
    </span>
  );
}
