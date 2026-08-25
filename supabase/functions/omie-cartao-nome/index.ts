// Edge Function: omie-cartao-nome
//
// ESCREVE O NOME DO LOJISTA DENTRO DO OMIE.
//
// No contas a pagar, todo gasto de cartão entra com a contraparte-carimbo
// "Lancamento Fatura Cartao" — 2.146 títulos só entre abril e agosto de 2026.
// Quem abre o ERP vê uma coluna inteira com o mesmo nome genérico e R$ 837 mil
// espalhados nela. O lojista existe, mas enterrado na observação, depois de um
// "|", em colunas posicionais que ninguém lê a olho:
//
//   Conta a Pagar importada automaticamente em 04/08/2026 às 12:51.|Hubspot Inc.V  888-48
//
// Resolver isso só na tela do Hub não resolve o problema: a exigência é que o
// ERP seja a fonte, e lá o nome não estava em lugar nenhum que se lesse.
//
// ONDE ESCREVE: `numero_documento`. Vinte caracteres, aparece na listagem do
// contas a pagar e está VAZIO em todo título de cartão — o próprio `montarTitulo`
// do Hub deixa o campo de fora "porque é o que a prática faz". Campo vazio,
// visível e sem semântica disputada. `nota_fiscal` NÃO serve: significa outra
// coisa e poluiria a métrica de cobertura que a tela de Notas publica.
//
// O PARSER É O MESMO DO FRONT. `_shared/cartao-memo.ts` desceu de
// `src/lib/cartao/ofx.ts` para poder ser usado dos dois lados. Não existe um
// segundo leitor de MEMO neste repositório, e a trava do `ehCartao` vem junto:
// numa conta a pagar comum a observação é o que o FORNECEDOR escreveu ("Link
// para visualizar a NFS-e…"), e lida como MEMO posicional viraria um
// "estabelecimento" plausível e errado.
//
// LER ANTES DE ESCREVER, SEMPRE. `AlterarContaPagar` exige o payload completo —
// mandar só a chave e o campo novo é recusado com "O preenchimento da tag
// [valor_documento] é obrigatório". Dava para montar esse payload a partir do
// espelho e economizar metade das chamadas; não se faz, porque um espelho
// desatualizado gravaria um valor_documento velho por cima do título. Numa
// escrita fiscal, meia chamada não paga esse risco.
//
// E NÃO SE RELÊ DEPOIS. O Omie serve leitura de um instantâneo velho por perto
// de um minuto após a escrita (ver a nota 3 de `trocarCategoriaTitulo`):
// conferir relendo REPROVA alteração que deu certo. Quem confirma é a resposta
// da própria alteração.
//
// Ações (body.action):
//   "previa"  → o que seria escrito, sem tocar no Omie. { limite? }
//   "aplicar" → escreve. { limite? }  ← o cron
//   "resumo"  → quantos já têm nome, quantos faltam, e por que os que falharam.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { omieCall } from "../_shared/omie-rpc.ts";
import { lojistaDoTitulo } from "../_shared/cartao-memo.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** O worker morre aos 150s. Paramos antes e a próxima rodada retoma a fila. */
const ORCAMENTO_MS = 100_000;

/** `numero_documento` no Omie tem 20 caracteres. Medido, não suposto: o maior
 *  valor da base tem exatamente 20 e está visivelmente cortado. */
const MAX_DOCUMENTO = 20;

const mensagemDoOmie = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e))
    .replace(/^Omie \w+ \[\d+\]:\s*/i, "").replace(/^ERROR:\s*/i, "").trim();

/** O Omie mandou esperar? Cooldown de minutos — insistir só gasta a janela. */
const mandouEsperar = (erro: string) => /bloqueada por consumo|425/i.test(erro);

/** Mês fechado não abre por insistência: é decisão de quem controla o período. */
const mesFechado = (erro: string) => /per[ií]odo cont[aá]bil|fechad/i.test(erro);

type Alvo = {
  cod_titulo: number;
  lojista: string;
  documento: string;
  origem: "apelido" | "fatura";
};

/**
 * O que escrever em cada título da fila.
 *
 * O apelido da Parametrização vence o nome cru da fatura: "Hubspot Inc." é o que
 * a fatura diz, mas se alguém cadastrou "Hubspot — CRM" é esse o nome pelo qual
 * a empresa chama aquilo, e é ele que deve estar no ERP. Os apelidos do lote
 * inteiro vêm numa consulta só.
 */
async function alvos(supabase: any, limite: number): Promise<Alvo[]> {
  const { data: fila, error } = await supabase.rpc("cartao_nome_fila", { p_limite: limite });
  if (error) throw new Error(`cartao_nome_fila: ${error.message}`);
  if (!fila?.length) return [];

  const lidos = (fila as any[])
    .map((f) => ({ cod: Number(f.cod_titulo), nome: lojistaDoTitulo(f.favorecido_cru, f.observacao) }))
    .filter((x) => !!x.nome) as { cod: number; nome: string }[];
  if (!lidos.length) return [];

  const nomes = [...new Set(lidos.map((l) => l.nome))];
  const { data: apelidos } = await supabase.rpc("contraparte_apelido_de", { p_nomes: nomes });
  const porNome = new Map<string, string>();
  for (const a of (apelidos as any[]) ?? []) {
    if (a?.apelido) porNome.set(String(a.nome), String(a.apelido));
  }

  return lidos.map((l) => {
    const apelido = porNome.get(l.nome);
    const escolhido = apelido ?? l.nome;
    return {
      cod_titulo: l.cod,
      lojista: escolhido,
      documento: escolhido.slice(0, MAX_DOCUMENTO).trim(),
      origem: apelido ? "apelido" : "fatura",
    };
  });
}

/** Registra a tentativa — a que deu certo e a que não deu, com o motivo. */
async function anotar(supabase: any, a: Alvo, erro: string | null) {
  const { data: atual } = await supabase
    .from("omie_titulo_nome_cartao").select("tentativas").eq("cod_titulo", a.cod_titulo).maybeSingle();

  await supabase.from("omie_titulo_nome_cartao").upsert({
    cod_titulo: a.cod_titulo,
    documento: a.documento,
    lojista: a.lojista,
    origem: a.origem,
    escrito_em: erro ? null : new Date().toISOString(),
    erro,
    tentativas: Number(atual?.tentativas ?? 0) + 1,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "cod_titulo" });
}

/**
 * Escreve o documento de UM título. Nunca lança: quem chama está num lote, e um
 * título que falha não pode derrubar os outros.
 */
async function escrever(a: Alvo): Promise<{ ok: boolean; erro?: string }> {
  let atual: any;
  try {
    atual = await omieCall<any>("financas/contapagar", "ConsultarContaPagar", {
      codigo_lancamento_omie: a.cod_titulo,
    });
  } catch (e) {
    return { ok: false, erro: `leitura: ${mensagemDoOmie(e)}` };
  }

  // Alguém preencheu entre a fila e agora? Então não é nosso lugar.
  const jaTem = String(atual?.numero_documento ?? "").trim();
  if (jaTem) return { ok: true };

  try {
    const r = await omieCall<any>("financas/contapagar", "AlterarContaPagar", {
      codigo_lancamento_omie: a.cod_titulo,
      numero_documento: a.documento,
      // Obrigatórios do cadastro, repetidos com o MESMO valor que o Omie acabou
      // de devolver. Ver o cabeçalho: é por isso que se lê antes.
      codigo_cliente_fornecedor: atual?.codigo_cliente_fornecedor,
      data_vencimento: atual?.data_vencimento,
      data_previsao: atual?.data_previsao,
      valor_documento: atual?.valor_documento,
    });
    const aceite = String(r?.descricao ?? r?.cDescricao ?? "");
    const confirmou = Number(r?.codigo_lancamento_omie ?? 0) > 0 || /alterad|sucesso/i.test(aceite);
    if (!confirmou) {
      return { ok: false, erro: `o Omie respondeu sem confirmar: ${JSON.stringify(r ?? null).slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: mensagemDoOmie(e) };
  }
}

async function aplicar(supabase: any, limite: number) {
  const lista = await alvos(supabase, limite);
  if (!lista.length) return { fila: 0, escritos: 0, falhas: 0 };

  const inicio = Date.now();
  const escritos: Alvo[] = [];
  const falhas: Array<Alvo & { erro: string }> = [];
  let restantes = 0;
  let parouPorBloqueio: string | null = null;

  for (const [i, a] of lista.entries()) {
    if (Date.now() - inicio > ORCAMENTO_MS) { restantes = lista.length - i; break; }

    const r = await escrever(a);
    await anotar(supabase, a, r.ok ? null : (r.erro ?? "falha sem mensagem"));

    if (r.ok) { escritos.push(a); continue; }

    falhas.push({ ...a, erro: r.erro ?? "" });
    if (mandouEsperar(r.erro ?? "")) {
      parouPorBloqueio = r.erro ?? null;
      restantes = lista.length - i - 1;
      break;
    }
  }

  return {
    fila: lista.length,
    escritos: escritos.length,
    falhas: falhas.length,
    restantes,
    ...(parouPorBloqueio ? { parou_por_bloqueio: parouPorBloqueio } : {}),
    // O mês fechado sai separado: não é falha de integração, é o ERP dizendo que
    // aquele período não se toca mais sem passar por quem o fechou.
    mes_fechado: falhas.filter((f) => mesFechado(f.erro)).length,
    exemplos: escritos.slice(0, 10).map((e) => ({ cod_titulo: e.cod_titulo, documento: e.documento, origem: e.origem })),
    exemplos_falha: falhas.slice(0, 5).map((f) => ({ cod_titulo: f.cod_titulo, erro: f.erro.slice(0, 160) })),
  };
}

async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "omie-cartao-nome").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "previa");

    if (!(await chamadaDeCron(req, supabase))) {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    if (action === "resumo") {
      const [{ count: escritos }, { count: comErro }, { data: fila }] = await Promise.all([
        supabase.from("omie_titulo_nome_cartao").select("cod_titulo", { count: "exact", head: true })
          .not("escrito_em", "is", null),
        supabase.from("omie_titulo_nome_cartao").select("cod_titulo", { count: "exact", head: true })
          .not("erro", "is", null).is("escrito_em", null),
        supabase.rpc("cartao_nome_fila", { p_limite: 100000 }),
      ]);
      return json({
        ok: true,
        com_nome_no_omie: escritos ?? 0,
        com_erro: comErro ?? 0,
        na_fila: Array.isArray(fila) ? fila.length : 0,
      });
    }

    if (action === "previa") {
      const limite = Math.min(Math.max(Number(body?.limite ?? 30), 1), 200);
      const lista = await alvos(supabase, limite);
      return json({
        ok: true, seco: true, total: lista.length,
        alvos: lista.map((a) => ({
          cod_titulo: a.cod_titulo, lojista: a.lojista,
          documento: a.documento, origem: a.origem,
          cortado: a.lojista.length > MAX_DOCUMENTO,
        })),
      });
    }

    if (action === "aplicar") {
      const limite = Math.min(Math.max(Number(body?.limite ?? 40), 1), 120);
      return json({ ok: true, ...(await aplicar(supabase, limite)) });
    }

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-cartao-nome:", msg);
    return json({ erro: msg }, 500);
  }
});
