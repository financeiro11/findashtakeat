// Cadastro de celular no sentido Hub → TakeatOS.
//
// O TakeatOS já empurrava o cadastro para cá (recargas-takeatos-webhook). Faltava o
// contrário: um celular cadastrado no Hub não existia lá, e a lista de números era
// diferente nos dois sistemas — que é justamente o que a integração veio acabar.
//
// Três ações:
//   colaboradores → a lista de gente do TakeatOS, para o cadastro ser ESCOLHER uma
//                   pessoa em vez de digitar um nome. Digitado à mão, "Guilherme
//                   Borborema" e "Guilherme B." viram duas pessoas, e o número nunca
//                   casa com o de lá.
//   enviar        → empurra a linha do Hub para o TakeatOS e guarda de volta o id que
//                   ele devolveu. É esse id que faz a próxima edição reencontrar a
//                   mesma linha em vez de criar uma segunda.
//   remover       → precisa ser chamada ANTES do delete local: depois, não há mais de
//                   onde ler o número.
//
// O segredo não pode viver no navegador — por isso a chamada sai daqui, server-side.
//
// Secrets (Supabase › Edge Functions › Secrets):
//   FINANCEIRO_CALLBACK_SECRET  mesmo valor da env de mesmo nome no TakeatOS
//   TAKEATOS_URL                opcional; o padrão é https://takeatos.vercel.app
//
// Body: { acao: "colaboradores" } | { acao: "enviar" | "remover", linha_id: uuid }
// Auth: JWT do usuário logado (verify_jwt no padrão).

import { createClient } from "npm:@supabase/supabase-js@2";

// CORS inline, como em recargas-concluir: a função é publicada isolada, e depender de
// ../_shared/ acopla o deploy ao resto da pasta.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BASE = (Deno.env.get("TAKEATOS_URL") || "https://takeatos.vercel.app").replace(/\/+$/, "");
const TIMEOUT_MS = 15000;

async function chamarTakeatOS(caminho: string, init: RequestInit = {}) {
  const segredo = Deno.env.get("FINANCEIRO_CALLBACK_SECRET");
  if (!segredo) throw new Error("FINANCEIRO_CALLBACK_SECRET não configurado");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}${caminho}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Takeat-Secret": segredo,
        ...(init.headers || {}),
      },
      signal: ctrl.signal,
    });
    const texto = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`http_${r.status}${texto ? ": " + texto.slice(0, 300) : ""}`);
    return texto ? JSON.parse(texto) : {};
  } catch (e) {
    const err = e as Error;
    throw new Error(err?.name === "AbortError" ? "timeout" : err?.message || "erro");
  } finally {
    clearTimeout(timer);
  }
}

type Linha = {
  id: string;
  proprietario: string | null;
  numero: string | null;
  setor: string | null;
  valor: number | null;
  verificado: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, service, { auth: { persistSession: false } });

  let body: { acao?: string; linha_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "body inválido" }, 400);
  }

  if (body.acao === "colaboradores") {
    try {
      const r = await chamarTakeatOS("/api/recargas/colaboradores", { method: "GET" });
      return json({ ok: true, colaboradores: r.colaboradores ?? [] });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  if (body.acao !== "enviar" && body.acao !== "remover") {
    return json({ error: 'acao deve ser "colaboradores", "enviar" ou "remover"' }, 400);
  }
  if (!body.linha_id) return json({ error: "linha_id é obrigatório" }, 400);

  const { data, error } = await supabase
    .from("recargas_celulares")
    .select("id, proprietario, numero, setor, valor, verificado")
    .eq("id", body.linha_id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "linha não encontrada" }, 404);
  const linha = data as Linha;

  if (body.acao === "remover") {
    try {
      await chamarTakeatOS("/api/recargas/linha-externa", {
        method: "POST",
        body: JSON.stringify({ hub_id: linha.id, remover: true }),
      });
      return json({ ok: true, removido: true });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  try {
    const r = await chamarTakeatOS("/api/recargas/linha-externa", {
      method: "POST",
      body: JSON.stringify({
        hub_id: linha.id,
        nome: linha.proprietario,
        numero: linha.numero,
        setor: linha.setor,
        valor: Number(linha.valor ?? 0),
        verificado: linha.verificado === "Sim",
      }),
    });

    // Guarda o id de lá na linha daqui. A partir deste ponto os dois lados se
    // reconhecem, e uma edição em qualquer um deles atualiza a mesma linha.
    // Reenviar uma linha que veio do TakeatOS não duplica nada: lá ela é reencontrada
    // pelos dígitos do número, e o id que volta é o dela mesma.
    if (r?.id) {
      await supabase
        .from("recargas_celulares")
        .update({ origem: "takeatos", origem_id: String(r.id) })
        .eq("id", linha.id);
    }

    return json({ ok: true, enviado: true, takeatos_id: r?.id ?? null, vinculado: !!r?.vinculado });
  } catch (e) {
    // O cadastro no Hub já está salvo — falhar aqui não desfaz nada, só deixa a linha
    // sem espelho até alguém salvar de novo.
    return json({ error: (e as Error).message }, 502);
  }
});
