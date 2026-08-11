/* ============================================================================
 * Reduzido ou cheio — como o número aparece na grade da DRE e da DFC.
 *
 * "1,25 M" cabe o ano inteiro na tela e é o que se lê para acompanhar a série;
 * "1.254.439" é o número que se confere valor a valor contra o Omie. Antes só
 * existia o reduzido, e conferir obrigava a passar o mouse célula por célula.
 *
 * A escolha é guardada no navegador e vale nos DOIS demonstrativos: quem está
 * conferindo o fechamento abre a DRE e a DFC na mesma sessão, e ter que trocar
 * de novo ao mudar de tela seria só atrito. O hover com os centavos
 * (`valorExato`) continua nos dois formatos — é lá que o centavo mora.
 * ========================================================================== */

import { useState } from "react";
import { cn } from "@/lib/utils";

export type FormatoNumero = "reduzido" | "completo";

const CHAVE = "demonstracoes:formato-numero";

/** "1,25 M" / "812,4 K" — a série inteira na largura de uma tela. */
export function fmtReduzido(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v as number)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2).replace(".", ",") + " M";
  if (abs >= 1_000) return (v / 1_000).toFixed(1).replace(".", ",") + " K";
  return v.toFixed(0);
}

/* Sem centavos de propósito — o que muda de "1,25 M" para "1.254.439" é poder
   LER o valor sem passar o mouse; os centavos continuam no hover, onde já
   estavam. Com eles a coluna ficaria larga demais para caber um ano na tela. */
export function fmtCheio(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v as number)) return "—";
  return Math.round(v).toLocaleString("pt-BR");
}

/** Largura mínima da coluna de mês — o número cheio precisa de mais espaço. */
export const larguraColuna = (f: FormatoNumero) =>
  f === "completo" ? "min-w-[92px]" : "min-w-[64px]";

export function useFormatoNumero() {
  const [formato, setFormato] = useState<FormatoNumero>(
    () => (localStorage.getItem(CHAVE) as FormatoNumero) ?? "reduzido",
  );
  const escolher = (f: FormatoNumero) => { setFormato(f); localStorage.setItem(CHAVE, f); };
  return {
    formato,
    escolher,
    /** o formatador da grade, já resolvido */
    fmtNum: formato === "completo" ? fmtCheio : fmtReduzido,
    largura: larguraColuna(formato),
  };
}

/* O próprio rótulo do botão é a amostra do formato: não há como explicar
   "abreviado" melhor do que mostrando "1,25 M" ao lado de "1.254.439". */
export function SeletorFormato({
  formato, onChange,
}: {
  formato: FormatoNumero;
  onChange: (f: FormatoNumero) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border p-0.5">
      {([
        { id: "reduzido", label: "1,25 M", hint: "Números abreviados (K/M) — cabe o ano inteiro na tela." },
        { id: "completo", label: "1.254.439", hint: "Número cheio, sem abreviar — para conferir valor a valor." },
      ] as const).map(f => (
        <button
          key={f.id}
          onClick={() => onChange(f.id)}
          title={f.hint}
          className={cn(
            "h-7 rounded px-2 text-[11px] font-medium num transition-colors",
            formato === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}