import { valorExato } from "@/lib/valor";

type Opts = { moeda?: boolean | "USD"; casas?: number };

/**
 * Envolve um número já abreviado/arredondado e revela o valor cheio ao passar
 * o mouse. Usado dentro dos formatadores de cada tela, para que todo lugar que
 * hoje renderiza `{fmtX(v)}` ganhe o hover sem mudar o call site.
 */
export function comValorExato(
  v: number | null | undefined,
  texto: string,
  opts?: Opts,
) {
  // sem número não há o que revelar — devolve o texto cru ("—", vazio etc.)
  if (v == null || !isFinite(Number(v))) return texto;
  return (
    <span title={valorExato(v, opts)} className="cursor-help">
      {texto}
    </span>
  );
}

/** Versão em componente, para quando é mais natural escrever em JSX. */
export function ValorExato({
  v,
  texto,
  className,
  ...opts
}: { v: number | null | undefined; texto: string; className?: string } & Opts) {
  return (
    <span title={valorExato(v, opts)} className={className ?? "cursor-help"}>
      {texto}
    </span>
  );
}
