// Passagens (Facilities) — o front lê a MESMA regra que o servidor.
//
// Não há cópia aqui: o núcleo vive em `supabase/functions/_shared/passagens.ts`
// (arquivo sem imports, por isso o Vite e o Deno leem os dois). O que o front
// ganha é montar o link do Google Flights com exatamente a mesma função que o
// servidor usa para conferir de qual viagem um e-mail fala — se o link e o
// casamento divergissem, o alerta chegaria e não acharia dono.
export * from "../../supabase/functions/_shared/passagens";
