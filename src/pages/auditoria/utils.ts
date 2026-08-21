/* O marcador de parcela da fatura ("CENTRAL DE AVIAMENTO  01/02   VITORIA") vem
   da MESMA regra que a conferência usa no servidor, e não de uma cópia: quem
   decide o que é parcela é `_shared/conferencia-comprovante.ts`, e a tela só
   mostra. O módulo é TypeScript puro, sem nada de Deno — é o mesmo arquivo que os
   testes de `src/lib/conferenciaComprovante.test.ts` importam. */
export { parcelaDoMemo, type Parcela } from "../../../supabase/functions/_shared/conferencia-comprovante.ts";
/* Pelo mesmo motivo: a lista de itens da nota esconde as linhas que existem para
   o fisco (ICMS, base de cálculo, desconto), e quem sabe quais são é a regra do
   servidor — repetir a lista de tokens aqui seria criar uma segunda verdade. */
export { rotuloNaoPagavel } from "../../../supabase/functions/_shared/conferencia-comprovante.ts";
/* E de novo: QUAL valor do documento foi dividido em vezes (o total, ou só a
   tarifa do bilhete) é conta da regra. A tela pergunta para escrever a frase
   "R$ X em 3× = R$ Y" com o número certo — antes ela supunha o total e escrevia
   uma conta que não fecha. */
export { baseDaParcela } from "../../../supabase/functions/_shared/conferencia-comprovante.ts";
/* E a regra inteira: a tela a roda para saber se o veredito GRAVADO ainda é o
   que a regra diz hoje — quando mudou, chama a varredura do servidor para
   regravar. Antes isso era adivinhado pelo texto do motivo, e a adivinhação
   parou de funcionar no dia em que a frase mudou. Aqui não se decide nada: quem
   grava veredito é a Edge Function, com a MESMA função. */
export { conferir, type Leitura } from "../../../supabase/functions/_shared/conferencia-comprovante.ts";

export const MESES_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
export const MESES_PT_LONG = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

export function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function brlAbbr(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sign}R$ ${Math.round(abs / 1_000).toLocaleString("pt-BR")} mil`;
  return brl(n);
}
export function fmtDateBR(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
export function fmtDateTimeBR(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${MM}/${d.getFullYear()} ${hh}:${mi}`;
}
export function fmtTrilha(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dd} ${MESES_PT[d.getMonth()]} · ${hh}:${mm}`;
}
export function compLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${MESES_PT_LONG[d.getMonth()]} / ${d.getFullYear()}`;
}
