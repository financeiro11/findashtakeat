import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { errorResponse, generateJSON, handleCors, jsonResponse } from "../_shared/openai.ts";
import { buildOrgContext } from "../_shared/org-context.ts";
import { requireUser } from "../_shared/auth.ts";

interface Tx { description: string; amount: number; tipo: "Crédito" | "Débito" }

Deno.serve(async (req) => {
  const pre = handleCors(req); if (pre) return pre;

  /* PORTÃO (30/08/2026). Sem ele, qualquer pessoa com a chave pública do bundle
     usava a chave de IA da empresa de graça — e recebia de volta o contexto
     organizacional (fornecedores, centros de custo, colaboradores) que o prompt
     carrega. Não era só custo: era o organograma saindo junto.

     Fica FORA do `try` de propósito: o `errorResponse` compartilhado troca a
     mensagem por um texto genérico de "tente de novo" e devolve 500, o que
     faria a recusa de acesso se parecer com instabilidade da IA — tanto para
     quem lê o log quanto para quem está tentando entrar. */
  try {
    await requireUser(req);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 401);
  }

  try {
    const { transactions } = await req.json() as { transactions: Tx[] };
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return jsonResponse({ error: "transactions required" }, 400);
    }

    // contexto organizacional (Biblioteca) — usa anon + auth header se houver
    const auth = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      auth ? { global: { headers: { Authorization: auth } } } : undefined,
    );
    let org = "";
    try { org = await buildOrgContext(supabase); } catch { /* segue sem contexto */ }

    const sys = `Você é um classificador financeiro brasileiro da Takeat. Para cada lançamento bancário sugira: categoria, centro_custo, conta, cliente_fornecedor e observacao breve. Use conhecimento do mercado BR (LIGHT/CPFL=Energia, VIVO/CLARO/TIM=Telecom, etc) E o contexto organizacional abaixo — quando a descrição bater com um fornecedor cadastrado, use o nome canônico da Biblioteca; quando casar com um colaborador, atribua ao centro de custo dele. Retorne JSON estrito: { results: [{categoria, centro_custo, conta, cliente_fornecedor, observacao}] } na MESMA ORDEM dos lançamentos recebidos.\n\n${org}`;

    const parsed = await generateJSON<{ results: any[] }>({
      consumidor: "classificacao",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Classifique:\n${JSON.stringify(transactions)}` },
      ],
      temperature: 0.2,
      responseSchema: {
        type: "object",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                categoria: { type: "string" },
                centro_custo: { type: "string" },
                conta: { type: "string" },
                cliente_fornecedor: { type: "string" },
                observacao: { type: "string" },
              },
              required: ["categoria", "centro_custo", "conta", "cliente_fornecedor", "observacao"],
            },
          },
        },
        required: ["results"],
      },
    });

    return jsonResponse(parsed);
  } catch (e) {
    return errorResponse(e);
  }
});
