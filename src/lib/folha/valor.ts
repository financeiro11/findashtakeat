/**
 * Leitura do valor de salário digitado à mão.
 *
 * O campo é livre porque quem opera digita como está acostumado: às vezes
 * "2.400,00", às vezes "2400". Ler "2.400" como dois inteiros e quatro décimos
 * em vez de dois mil e quatrocentos é a diferença entre pagar certo e pagar mil
 * vezes menos — por isso a regra é explícita e tem teste.
 */

/** "2.400,50" e "2400.5" viram 2400.5. `null` quando não dá para ler. */
export function lerValor(texto: string): number | null {
  const limpo = String(texto ?? "").trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  // Com vírgula, o ponto é separador de milhar. Sem vírgula, o ponto é decimal.
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}
