// Edge Function: omie-anexos-varredura
//
// PERGUNTA AO OMIE, TÍTULO A TÍTULO, SE A NOTA ESTÁ LÁ.
//
// Por que existe. Até 25/08/2026 o Hub só sabia o que ELE MESMO tinha mandado
// (82 anexos) e o que a `omie-pix-sync` tinha lido de UMA conta (a corrente do
// Sicoob). Para todo o resto — o cartão corporativo com 1.005 títulos e R$ 1,13
// milhão, o BTG, as contas de subvenção — um título com nota anexada à mão no
// ERP e um título sem nota nenhuma eram indistinguíveis daqui. "Está tudo no
// Omie?" não tinha resposta, só palpite, e palpite não vai para reunião.
//
// O que ela NÃO faz: escrever. Isto aqui é leitura pura (`geral/anexo/ListarAnexo`).
// Quem sobe arquivo é a `omie-anexar-comprovante`.
//
// O RITMO É SEQUENCIAL DE PROPÓSITO. A trava do Omie é POR MÉTODO: duas leituras
// do mesmo método ao mesmo tempo esbarram nela mesmo sendo de títulos diferentes
// (medido neste repo: 4 em voo, 3 recusadas). Paralelizar aqui não acelera —
// transforma leitura em fila de retentativa.
//
// A FILA É DO POSTGRES, não daqui: `cap_anexos_fila` já sabe quem exige nota
// (pela régua de categoria), quem nunca foi lido, quem falhou e quem tem leitura
// velha demais. Título com anexo confirmado nunca volta: anexo não some sozinho.
//
// Ações (body.action):
//   "varrer"  (default) → lê um lote da fila. { limite?: number }
//   "titulo"            → lê UM título e devolve o que veio, sem gravar nada
//                         (diagnóstico). { cod_titulo: number }
//   "resumo"            → quanto já foi lido e quanto falta. Não fala com o Omie.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// De `omie-rpc.ts`, e não de `omie.ts`: esta função só LÊ o ERP, e não tem por
// que arrastar o pdf-lib e o fflate do caminho de escrita para dentro do bundle.
import { listarAnexos } from "../_shared/omie-rpc.ts";
import { classificarAnexo } from "../_shared/anexo-tipo.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* O worker morre aos 150s sem devolver relatório nenhum. Melhor parar por conta
 * própria e deixar o resto para a próxima rodada — a fila é a mesma consulta,
 * então nada se perde e nada é lido duas vezes. */
const ORCAMENTO_MS = 100_000;

/** Um título do contas a pagar. `conta-receber` existe mas não é o caso aqui. */
const TABELA = "conta-pagar";

type Linha = {
  cod_titulo: number;
  c_tabela: string | null;
  qtd: number;
  anexos: unknown;
  parece_nota: boolean | null;
  classe: string | null;
  lido_em: string;
  erro: string | null;
  retentar: boolean;
};

/**
 * O Omie mandou parar?
 *
 * "API bloqueada por consumo indevido. Tente novamente em 245 segundos" é um
 * cooldown DE MINUTOS, e o backoff do `omieCall` cobre ~18 segundos. Insistir
 * depois disso não é resiliência — é gastar a janela inteira da rodada colhendo
 * o mesmo 425 e devolvendo um relatório de falhas que assusta sem informar.
 * Melhor parar, dizer por quê, e deixar o resto para a próxima rodada.
 */
const mandouEsperar = (erro?: string) => /bloqueada por consumo|425/i.test(String(erro ?? ""));

/**
 * O resultado de uma leitura, pronto para gravar.
 *
 * A distinção que importa: `erro` preenchido significa "não deu para saber", e é
 * DIFERENTE de `qtd = 0`, que significa "o Omie respondeu e não há anexo". Tratar
 * os dois como a mesma coisa contaria como buraco um título que talvez tenha nota
 * — e um número de auditoria que inclui palpite não serve para nada.
 */
function linhaDaLeitura(
  codTitulo: number,
  r: Awaited<ReturnType<typeof listarAnexos>>,
  cTabela = TABELA,
): Linha {
  const agora = new Date().toISOString();

  if (!r.ok) {
    return {
      cod_titulo: codTitulo,
      c_tabela: cTabela,
      qtd: 0,
      anexos: [],
      parece_nota: null,
      classe: null,
      lido_em: agora,
      erro: (r.erro ?? "leitura recusada pelo Omie").slice(0, 300),
      // Rate limit passa; "documento não cadastrado" não passa nunca.
      retentar: r.falha === "transitorio",
    };
  }

  const anexos = r.anexos.map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho }));
  const classes = anexos.map((a) => classificarAnexo(a.nome));

  /* A MELHOR classe entre os anexos vale. Um título com a nota E um print junto
   * está coberto; mandar alguém revisar isso é gastar atenção à toa — e atenção
   * gasta à toa é o que faz a fila de revisão ser abandonada. */
  const classe = !anexos.length ? null
    : classes.includes("nota") ? "nota"
    : classes.includes("indefinido") ? "indefinido"
    : "duvidoso";

  return {
    cod_titulo: codTitulo,
    c_tabela: cTabela,
    qtd: anexos.length,
    anexos,
    // `parece_nota` é null quando não há anexo — "não tem" não é "tem coisa errada".
    parece_nota: anexos.length ? classe === "nota" : null,
    classe,
    lido_em: agora,
    erro: null,
    retentar: true,
  };
}

/**
 * Uma leitura, com o plano B da outra tabela.
 *
 * "Documento não cadastrado para o Código [X]" é o Omie dizendo que aquele
 * nCodTitulo não existe COMO CONTA A PAGAR. Quase sempre é isso mesmo — mas o
 * espelho de movimentos traz alguns títulos que moram do outro lado, e para
 * esses a resposta certa está em `conta-receber`. Uma segunda chamada resolve, e
 * só acontece na recusa de negócio: rate limit não vira segunda tentativa (seria
 * bater na mesma porta trancada).
 */
async function lerTitulo(cod: number): Promise<Linha> {
  const primeira = await listarAnexos(cod, TABELA);
  if (primeira.ok || primeira.falha === "transitorio") return linhaDaLeitura(cod, primeira, TABELA);

  const segunda = await listarAnexos(cod, "conta-receber");
  if (segunda.ok) return linhaDaLeitura(cod, segunda, "conta-receber");

  // Nenhuma das duas: fica registrado com a mensagem da PRIMEIRA, que é a que
  // descreve o caso normal, e sem retentativa.
  return linhaDaLeitura(cod, primeira, TABELA);
}

async function varrer(supabase: any, limite: number) {
  const { data: fila, error } = await supabase.rpc("cap_anexos_fila", { p_limite: limite });
  if (error) throw new Error(`cap_anexos_fila: ${error.message}`);
  if (!fila?.length) return { fila: 0, lidos: 0, com_anexo: 0, sem_anexo: 0, falhas: 0, restantes: 0 };

  const inicio = Date.now();
  const linhas: Linha[] = [];
  let parouPorTempo = 0;
  let parouPorBloqueio: string | null = null;

  for (const [i, item] of fila.entries()) {
    if (Date.now() - inicio > ORCAMENTO_MS) { parouPorTempo = fila.length - i; break; }

    const linha = await lerTitulo(Number(item.cod_titulo));
    linhas.push(linha);

    /* O Omie mandou esperar minutos. Continuar só colheria o mesmo 425 em cada
     * título restante e encheria a tabela de erros que não são dos títulos —
     * são nossos, de ritmo. Para aqui; a próxima rodada retoma a mesma fila. */
    if (linha.erro && mandouEsperar(linha.erro)) {
      parouPorBloqueio = linha.erro;
      parouPorTempo = fila.length - i - 1;
      break;
    }
  }

  if (linhas.length) {
    // Upsert em lote: a leitura vale por título, e reler depois só sobrescreve.
    const { error: erroGrava } = await supabase
      .from("omie_titulo_anexo")
      .upsert(linhas, { onConflict: "cod_titulo" });
    if (erroGrava) throw new Error(`omie_titulo_anexo upsert: ${erroGrava.message}`);
  }

  const comAnexo = linhas.filter((l) => !l.erro && l.qtd > 0).length;
  const semAnexo = linhas.filter((l) => !l.erro && l.qtd === 0).length;
  const falhas = linhas.filter((l) => l.erro).length;

  return {
    fila: fila.length,
    lidos: linhas.length,
    com_anexo: comAnexo,
    sem_anexo: semAnexo,
    falhas,
    parou_por_tempo: parouPorTempo,
    ...(parouPorBloqueio ? { parou_por_bloqueio: parouPorBloqueio } : {}),
    // O que continua duvidoso: nome que o sistema gerou sozinho, sem sinal de nota.
    suspeitos: linhas
      .filter((l) => l.qtd > 0 && l.classe === "duvidoso")
      .slice(0, 20)
      .map((l) => ({ cod_titulo: l.cod_titulo, anexos: l.anexos })),
    exemplos_falha: linhas.filter((l) => l.erro).slice(0, 5).map((l) => ({ cod_titulo: l.cod_titulo, erro: l.erro })),
  };
}

async function resumo(supabase: any) {
  const [{ count: lidos }, { count: comAnexo }, { count: comErro }, { data: fila }] = await Promise.all([
    supabase.from("omie_titulo_anexo").select("cod_titulo", { count: "exact", head: true }),
    supabase.from("omie_titulo_anexo").select("cod_titulo", { count: "exact", head: true }).gt("qtd", 0),
    supabase.from("omie_titulo_anexo").select("cod_titulo", { count: "exact", head: true }).not("erro", "is", null),
    // O teto alto responde "quanto ainda falta" sem uma consulta própria.
    supabase.rpc("cap_anexos_fila", { p_limite: 100000 }),
  ]);
  return {
    titulos_lidos: lidos ?? 0,
    com_anexo: comAnexo ?? 0,
    com_erro_de_leitura: comErro ?? 0,
    na_fila: Array.isArray(fila) ? fila.length : 0,
  };
}

async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "omie-anexos-varredura").eq("token", token).maybeSingle();
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
    const action = String(body?.action ?? "varrer");

    if (!(await chamadaDeCron(req, supabase))) {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    if (action === "resumo") return json({ ok: true, ...(await resumo(supabase)) });

    if (action === "titulo") {
      const cod = Number(body?.cod_titulo ?? 0);
      if (!cod) return json({ erro: "Informe cod_titulo." }, 400);
      // Passa pelo mesmo caminho da varredura, com plano B de tabela — senão o
      // diagnóstico responderia "não existe" para um título que existe do outro
      // lado, que é exatamente a confusão que este modo serve para desfazer.
      return json({ ok: true, cod_titulo: cod, gravaria: await lerTitulo(cod) });
    }

    if (action === "varrer") {
      // Teto por rodada: o suficiente para a janela de 100s e para o cron de 10
      // em 10 minutos zerar as ~1.700 pendências em algumas horas.
      const limite = Math.min(Math.max(Number(body?.limite ?? 150), 1), 400);
      return json({ ok: true, ...(await varrer(supabase, limite)) });
    }

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-anexos-varredura:", msg);
    return json({ erro: msg }, 500);
  }
});
