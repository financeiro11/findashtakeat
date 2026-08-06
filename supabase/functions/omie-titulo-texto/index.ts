// Edge Function: omie-titulo-texto
//
// Lê no Omie o TEXTO de títulos específicos (observação, documento, NF,
// favorecido) e guarda em `omie_titulo_texto`. É o que faz o gasto de cartão
// deixar de ser "Lancamento Fatura Cartao" no drill-down da DRE/DFC: o nome do
// lojista está na observação do título.
//
// Por que é uma função dedicada, e não mais um pedaço do omie-contas-pagar-sync:
// aquele cobre uma JANELA de vencimento (o dia que o briefing confere); aqui o
// pedido vem da tela, com a lista exata de títulos que estão na frente da pessoa
// — meses fechados, muito fora de qualquer janela.
//
// O custo manda no desenho: `ConsultarContaPagar` é UMA CHAMADA POR TÍTULO e o
// Omie recusa duas chamadas simultâneas do mesmo método ("Já existe uma
// requisição desse método sendo executada"), então é SEQUENCIAL. Daí o teto de
// títulos e o orçamento de tempo por execução: a função devolve o que deu tempo
// e diz quantos faltam, em vez de estourar o tempo da requisição.
//
// Body: { cod_titulos: (number|string)[], max?: number, orcamento_ms?: number, forcar?: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { omieCall } from "../_shared/omie.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const limpo = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const pedidos = Array.isArray(body?.cod_titulos) ? body.cod_titulos : [];
    const cods = [...new Set(
      pedidos.map((c: unknown) => Number(c)).filter((n: number) => Number.isFinite(n) && n > 0),
    )] as number[];
    if (!cods.length) return json({ ok: true, lidos: 0, restantes: 0, ja_tinha: 0 });

    const teto = Math.min(Math.max(Number(body?.max ?? 100), 1), 400);
    const prazo = Date.now() + Math.min(Math.max(Number(body?.orcamento_ms ?? 25_000), 1_000), 120_000);
    const forcar = body?.forcar === true;

    // O que já foi lido antes não é relido — inclusive o que voltou vazio.
    let jaTem = new Set<number>();
    if (!forcar) {
      const { data, error } = await supabase
        .from("omie_titulo_texto").select("cod_titulo").in("cod_titulo", cods);
      if (error) throw error;
      jaTem = new Set((data ?? []).map((r: { cod_titulo: number }) => Number(r.cod_titulo)));
    }
    const faltando = cods.filter((c) => !jaTem.has(c));

    const erros: string[] = [];
    const linhas: Record<string, unknown>[] = [];
    let lidos = 0;

    for (const cod of faltando.slice(0, teto)) {
      if (Date.now() > prazo) break;   // o resto fica para a próxima chamada
      try {
        const c = await omieCall<Record<string, unknown>>(
          "financas/contapagar", "ConsultarContaPagar", { codigo_lancamento_omie: cod },
        );
        linhas.push({
          cod_titulo: cod,
          observacao: limpo(c?.observacao),
          documento: limpo(c?.numero_documento),
          nota_fiscal: limpo(c?.numero_documento_fiscal),
          favorecido: limpo((c?.cnab_integracao_bancaria as Record<string, unknown>)?.nome_transferencia),
          lido_em: new Date().toISOString(),
        });
        lidos++;
      } catch (e) {
        // Título que não é conta a pagar (recebimento, transferência) responde
        // erro — registrar mesmo assim, com texto vazio, evita perguntar de novo
        // a cada abertura do painel.
        const msg = e instanceof Error ? e.message : String(e);
        if (/n[ãa]o encontrad|inexistente|invalid|não existe/i.test(msg)) {
          linhas.push({ cod_titulo: cod, observacao: null, lido_em: new Date().toISOString() });
        } else if (erros.length < 5) {
          erros.push(`${cod}: ${msg.slice(0, 120)}`);
        }
      }
    }

    if (linhas.length) {
      const { error } = await supabase.from("omie_titulo_texto").upsert(linhas, { onConflict: "cod_titulo" });
      if (error) throw error;
    }

    return json({
      ok: true,
      lidos,
      ja_tinha: cods.length - faltando.length,
      restantes: Math.max(0, faltando.length - linhas.length),
      erros,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-titulo-texto error:", msg);
    return json({ error: msg }, 200);
  }
});
