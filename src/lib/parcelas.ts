// Parcelas irmãs de um título no Omie — o front lê a MESMA regra que o servidor.
//
// Sem cópia: o núcleo vive em `supabase/functions/_shared/parcelas.ts` (arquivo
// sem imports, por isso o Vite e o Deno leem os dois). A tela precisa dele para
// explicar por que um grupo foi para revisão usando exatamente o critério que o
// servidor aplicou — se as duas explicações divergirem, quem confirma perde a
// confiança na proposta.
export * from "../../supabase/functions/_shared/parcelas";
