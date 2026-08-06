// Memória do Assistente — fatos e preferências que ele lembra sobre cada pessoa.
//
// Desenho (adaptado do OpenJarvis, que faz isto em JSONL local e monousuário):
//   • a extração roda DEPOIS da resposta, nunca no caminho dela — memória é um bônus e
//     não pode atrasar nem derrubar uma pergunta sobre números;
//   • toda falha degrada para "nenhum fato", em silêncio;
//   • cada fato tem dono, origem e data, e a pessoa pode apagar.
//
// A gravação usa service_role de propósito: a RLS deixa a pessoa LER e APAGAR a própria
// memória, mas não inserir — assim ninguém planta um "fato" falso sobre si via PostgREST.

import { gerarJSON } from "./llm.ts";

export type Fato = { texto: string; tipo: "fato" | "preferencia" };

const PROMPT_EXTRACAO = `Você extrai fatos duráveis sobre um usuário a partir de UMA troca de mensagens
no assistente financeiro interno da Takeat.

Um bom fato é estável e útil em conversas futuras: o cargo da pessoa, as rubricas ou
períodos que ela acompanha, como prefere receber a resposta, o que costuma investigar.

NÃO extraia:
- valores, números ou resultados financeiros (esses vêm sempre de consulta, nunca da memória);
- detalhes de uma pergunta pontual ("queria saber o caixa de julho");
- qualquer coisa que o assistente disse sobre si.

Responda SOMENTE com JSON: {"fatos": [{"texto": "...", "tipo": "fato"|"preferencia"}]}
No máximo 3 por troca, cada um com menos de 160 caracteres. Se não houver nada durável, {"fatos": []}.`;

/**
 * Lê a memória da pessoa e monta o bloco para o prompt.
 *
 * Devolve string vazia quando não há nada — o chamador simplesmente não inclui a seção.
 * O rótulo deixa explícito ao modelo que memória NÃO é fonte de número, senão ele começa
 * a citar valores que "lembra" de conversas passadas, que é exatamente o que não pode.
 */
export async function blocoDeMemoria(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("assistente_memoria")
      .select("texto, tipo")
      .eq("user_id", userId)
      .order("criado_em", { ascending: false })
      .limit(30);

    if (error || !data?.length) return "";

    const linhas = (data as Fato[]).map((f) => `- ${f.texto}`).join("\n");
    return [
      "O QUE VOCÊ SABE SOBRE ESTA PESSOA:",
      linhas,
      "",
      "Use isso para ajustar o tom e o foco da resposta. NUNCA use como fonte de número:",
      "todo valor citado tem que vir do bloco DADOS desta requisição.",
    ].join("\n");
  } catch {
    return ""; // memória indisponível nunca impede uma resposta
  }
}

/**
 * Extrai fatos de uma troca e grava os novos.
 *
 * Nunca lança: toda falha vira zero fatos. Chame sem `await` bloqueante (idealmente dentro
 * de `EdgeRuntime.waitUntil`) para não somar latência à resposta.
 */
export async function memorizar(
  admin: { from: (t: string) => any },
  userId: string,
  pergunta: string,
  resposta: string,
  conversaId: string | null,
): Promise<number> {
  try {
    const extraido = await gerarJSON<{ fatos?: Fato[] }>({
      temperature: 0,
      messages: [
        { role: "system", content: PROMPT_EXTRACAO },
        { role: "user", content: `Usuário: ${pergunta}\nAssistente: ${resposta}` },
      ],
    });

    const fatos = (extraido?.fatos ?? [])
      .filter((f) => typeof f?.texto === "string" && f.texto.trim().length > 0)
      .slice(0, 3)
      .map((f) => ({
        user_id: userId,
        texto: f.texto.trim().slice(0, 160),
        tipo: f.tipo === "preferencia" ? "preferencia" : "fato",
        origem: "conversa",
        conversa_id: conversaId,
      }));

    if (fatos.length === 0) return 0;

    // A constraint (user_id, texto_norm) absorve repetição entre conversas —
    // ignoreDuplicates evita que um fato já conhecido vire erro. `texto_norm` é coluna
    // gerada: não se insere, mas é ela que o on_conflict referencia.
    const { error } = await admin
      .from("assistente_memoria")
      .upsert(fatos, { onConflict: "user_id,texto_norm", ignoreDuplicates: true });

    return error ? 0 : fatos.length;
  } catch {
    return 0;
  }
}

/** Registra a execução. Também silencioso: log que falha não pode derrubar a resposta. */
export async function registrarExecucao(
  admin: { from: (t: string) => any },
  registro: {
    user_id: string;
    conversa_id: string | null;
    pergunta: string;
    consulta: string | null;
    ok: boolean;
    numeros: unknown[];
    avisos: string[];
    resposta: string;
    latencia_ms: number;
  },
): Promise<void> {
  try {
    await admin.from("assistente_execucao").insert(registro);
  } catch {
    /* log é observabilidade, não requisito da resposta */
  }
}
