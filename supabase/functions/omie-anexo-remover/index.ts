// Edge Function: omie-anexo-remover
//
// TIRAR DO TÍTULO O ANEXO QUE NÃO É DELE.
//
// A esteira do acervo sabe pôr documento no ERP e não sabe tirar. Em 28/08/2026
// isso apareceu de um jeito caro: as notas da Victoria Partners anteriores a
// abril não têm título nenhum em `cap_titulos`, e o casador as acomodou no
// título do vizinho — o que ainda estivesse "devendo". O cron de anexo, que
// drena a fila sozinho a cada rodada, subiu seis comprovantes para o título
// errado antes de alguém olhar.
//
// AS QUATRO GUARDAS, porque apagar no ERP não tem desfazer:
//   1. NADA SEM LISTA EXPLÍCITA. Não existe "limpe o título", nem "apague o
//      mais antigo": quem chama diz `cod_titulo` + `nome` do arquivo, um a um.
//   2. A PRÉVIA É O PADRÃO. Sem `aplicar: true` a função só LÊ e conta o que
//      faria — e devolve a lista inteira de anexos de cada título, para quem
//      decide comparar antes.
//   3. CASA PELO NOME, e o nome tem de ser ÚNICO no título. Id de anexo em
//      cache envelhece; nome repetido é ambiguidade. Nos dois casos ela recusa
//      aquele item e segue para o próximo, em vez de escolher por conta.
//   4. CONFERE DEPOIS. Relê o título e só diz "removido" se o arquivo sumiu da
//      lista — o Omie responde 200 para coisa que não fez.
//
// UMA LEITURA POR TÍTULO, E NÃO UMA POR ARQUIVO. A primeira versão listava a
// cada item e morreu no primeiro uso: quatro arquivos do mesmo título viraram
// quatro `ListarAnexo` seguidos, o Omie devolveu "Consumo redundante detectado"
// e depois bloqueou a API por 282 segundos. É a mesma armadilha que já mordeu a
// emissão em lote. Então os itens são agrupados por título, lidos de uma vez, e
// há espera entre a exclusão e a releitura de conferência.
//
// Body: { itens: [{ cod_titulo, nome }], aplicar?: boolean, tabela?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { listarAnexos, omieCall } from "../_shared/omie-rpc.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Item = { cod_titulo: string | number; nome: string };
type Saida = {
  cod_titulo: string;
  nome: string;
  situacao: "removido" | "removeria" | "nao_achei" | "nome_repetido" | "sem_id" | "erro" | "ainda_la";
  detalhe?: string;
  anexos_no_titulo?: string[];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    /* Caminho de operação sem tela (o `x-cron-token`), como o resto da esteira.
       Não é cron nenhum: não há agendamento para esta função, e não deve haver —
       apagar anexo é ato deliberado. O token existe para quem opera de fora do
       navegador, e o que protege de verdade são as quatro guardas do cabeçalho. */
    const tok = req.headers.get("x-cron-token");
    if (tok) {
      const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data } = await supa.from("internal_cron_tokens")
        .select("token").eq("name", "omie-anexo-remover").maybeSingle();
      if (!data?.token || data.token !== tok) return json({ error: "Token inválido." }, 401);
    } else {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const itens: Item[] = Array.isArray(body?.itens) ? body.itens.slice(0, 40) : [];
    if (!itens.length) return json({ error: "Mande `itens: [{cod_titulo, nome}]`." }, 400);
    const aplicar = body?.aplicar === true;
    const cTabela = String(body?.tabela ?? "conta-pagar");

    const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const saida: Saida[] = [];

    /* Um balde por título — ver o cabeçalho: é o agrupamento que evita o
       "consumo redundante" do Omie. */
    const porTitulo = new Map<string, string[]>();
    for (const it of itens) {
      const cod = String(it?.cod_titulo ?? "").trim();
      const nome = String(it?.nome ?? "").trim();
      if (!cod || !nome) {
        saida.push({ cod_titulo: cod, nome, situacao: "erro", detalhe: "item sem cod_titulo ou nome" });
        continue;
      }
      porTitulo.set(cod, [...(porTitulo.get(cod) ?? []), nome]);
    }

    let primeiro = true;
    for (const [cod, nomes] of porTitulo) {
      if (!primeiro) await espera(2_000);
      primeiro = false;

      const lista = await listarAnexos(cod, cTabela);
      if (!lista.ok) {
        for (const nome of nomes) {
          saida.push({ cod_titulo: cod, nome, situacao: "erro", detalhe: `ListarAnexo: ${lista.erro ?? lista.falha}` });
        }
        continue;
      }
      const todos = lista.anexos.map((a) => a.nome ?? "?");

      /* Resolve TUDO contra a mesma leitura, e só depois começa a apagar. */
      const aApagar: { nome: string; id: string }[] = [];
      for (const nome of nomes) {
        const achados = lista.anexos.filter((a) => (a.nome ?? "") === nome);
        if (achados.length === 0) { saida.push({ cod_titulo: cod, nome, situacao: "nao_achei", anexos_no_titulo: todos }); continue; }
        if (achados.length > 1) { saida.push({ cod_titulo: cod, nome, situacao: "nome_repetido", detalhe: `${achados.length} arquivos com este nome`, anexos_no_titulo: todos }); continue; }
        if (!achados[0].id) { saida.push({ cod_titulo: cod, nome, situacao: "sem_id", anexos_no_titulo: todos }); continue; }
        if (!aplicar) { saida.push({ cod_titulo: cod, nome, situacao: "removeria", detalhe: `nIdAnexo ${achados[0].id}`, anexos_no_titulo: todos }); continue; }
        aApagar.push({ nome, id: achados[0].id! });
      }
      if (!aApagar.length) continue;

      const falhou = new Map<string, string>();
      for (const [i, a] of aApagar.entries()) {
        if (i > 0) await espera(1_200);
        try {
          await omieCall("geral/anexo", "ExcluirAnexo", { nId: Number(cod), cTabela, nIdAnexo: a.id });
        } catch (e) {
          falhou.set(a.nome, String((e as Error)?.message ?? e).slice(0, 200));
        }
      }

      /* O 200 do Omie não é prova. Reler é — depois de esperar, porque reler o
         mesmo título colado na leitura anterior é o que ele chama de redundante. */
      await espera(4_000);
      const depois = await listarAnexos(cod, cTabela);
      const agora = depois.ok ? depois.anexos.map((a) => a.nome ?? "?") : todos;
      for (const a of aApagar) {
        const erro = falhou.get(a.nome);
        if (erro) { saida.push({ cod_titulo: cod, nome: a.nome, situacao: "erro", detalhe: erro, anexos_no_titulo: agora }); continue; }
        if (!depois.ok) {
          saida.push({ cod_titulo: cod, nome: a.nome, situacao: "ainda_la", detalhe: `não deu para reler: ${depois.erro ?? depois.falha}`, anexos_no_titulo: agora });
          continue;
        }
        saida.push({
          cod_titulo: cod, nome: a.nome,
          situacao: depois.anexos.some((x) => (x.nome ?? "") === a.nome) ? "ainda_la" : "removido",
          anexos_no_titulo: agora,
        });
      }
    }

    const conta = (s: Saida["situacao"]) => saida.filter((x) => x.situacao === s).length;
    return json({
      ok: true,
      aplicou: aplicar,
      resumo: {
        removidos: conta("removido"), removeria: conta("removeria"),
        nao_achei: conta("nao_achei"), nome_repetido: conta("nome_repetido"),
        ainda_la: conta("ainda_la"), erros: conta("erro") + conta("sem_id"),
      },
      itens: saida,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-anexo-remover:", msg);
    return json({ error: msg }, 200);
  }
});
