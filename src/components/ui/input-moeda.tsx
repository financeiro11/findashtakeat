import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Campo de dinheiro. O que se digita são CENTAVOS, da direita para a esquerda, e o
// campo mostra o resultado já formatado em real — digitar "3500" vira "35,00".
//
// Substitui o <Input type="number">, que trazia as setinhas do browser (e o scroll do
// mouse alterando o valor sem querer) e deixava "35" ambíguo entre 35 reais e 35
// centavos. O prefixo R$ fica fora do texto editável para não atrapalhar a digitação.
//
// Mesmo comportamento do MoedaInput do TakeatOS: quem preenche valor num sistema
// encontra o mesmo campo no outro.

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function formatarCentavos(digitos: string) {
  if (!digitos) return "";
  return (Number(digitos) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export type InputMoedaProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> & {
  /** Valor em reais ("" quando vazio). */
  value: string | number | null | undefined;
  /** Recebe o valor em reais, ou "" quando o campo é limpo. */
  onChange: (valor: number | "") => void;
};

const InputMoeda = React.forwardRef<HTMLInputElement, InputMoedaProps>(
  ({ value, onChange, className, style, ...props }, ref) => {
    const texto = React.useMemo(() => {
      if (value === "" || value === null || value === undefined) return "";
      const n = Number(value);
      if (!Number.isFinite(n)) return "";
      return formatarCentavos(String(Math.round(n * 100)));
    }, [value]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      // Teto em 11 dígitos: sem limite, um acidente no teclado vira um valor que
      // alguém precisa corrigir depois.
      const digitos = soDigitos(e.target.value).slice(0, 11);
      onChange(digitos ? Number(digitos) / 100 : "");
    }

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          R$
        </span>
        <Input
          {...props}
          ref={ref}
          type="text"
          inputMode="numeric"
          value={texto}
          onChange={handleChange}
          placeholder="0,00"
          // padding pelo style: vence qualquer px-* que venha na className de fora
          style={{ paddingLeft: "2.25rem", ...style }}
          className={cn("text-right font-mono", className)}
        />
      </div>
    );
  },
);
InputMoeda.displayName = "InputMoeda";

export { InputMoeda };
