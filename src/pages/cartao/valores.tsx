/**
 * Os mesmos formatadores de ./fmt, embrulhados no hover com o número cheio.
 *
 * Convenção do repo (CLAUDE.md): a variante que a tela renderiza devolve
 * ReactNode; a variante `…Str` devolve string e é a que vai para template
 * literal, `title=` e `tickFormatter`. Como aqui a matriz mostra tudo em
 * milhares, o hover é a ÚNICA forma de ver que "1,4" são R$ 1.437,92 — sem ele a
 * tela não serve para conferir fatura.
 */

import { comValorExato } from "@/components/ValorExato";
import { abrevStr, deltaMilStr, fmtBRLStr, milStr } from "./fmt";

export const fmtBRL = (n: number | null | undefined) => comValorExato(n, fmtBRLStr(n));
export const abrev = (n: number | null | undefined) => comValorExato(n, abrevStr(n));
export const mil = (n: number | null | undefined) => comValorExato(n, milStr(n));
export const deltaMil = (n: number | null | undefined) => comValorExato(n, deltaMilStr(n));
