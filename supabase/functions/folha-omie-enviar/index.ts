// Edge Function: folha-omie-enviar
//
// Cria os títulos da folha no Omie, UM A UM. É o único caminho de escrita da
// folha, e por isso está na lista de autorizados de `src/lib/cartao/envio.test.ts`.
//
// Um a um, e não em lote, porque o `IncluirContaPagarPorLote` recusa
// `departamentos` — testado com dois títulos reais em 26/08/2026. O detalhe
// está no topo de `_shared/folha-envio.ts`.
//
// TRÊS AÇÕES (body.acao):
//
//   "simular"  devolve o payload EXATO que iria ao Omie, sem criar nada. Não
//              depende de `ENVIO_FOLHA_LIBERADO`: simular não escreve, e ver o
//              payload antes é justamente como se descobre que ele está errado.
//   "enviar"   cria de verdade. Exige a chave ligada e passa por `recusaDaFolha`.
//   "excluir"  apaga títulos criados por aqui, pelo `codigo_lancamento_integracao`.
//              Existe porque o primeiro envio real é um teste de 1 ou 2 títulos,
//              e teste sem desfazer não é teste — é aposta.
//   "excluir_competencia"  apaga a folha INTEIRA de uma competência.
//              A tela só sabe desfazer o que ela mesma criou na sessão; quem
//              recarregou a página perdeu a lista e ficaria apagando cem
//              títulos à mão no ERP. As chaves são determinísticas
//              (`FOLHA-<codigo>-<AAAA-MM>`), então dá para remontá-las a partir
//              do espelho do RH sem depender de ter guardado nada.
//
// `codigos` restringe a um subconjunto de pessoas. É o que permite o teste
// pequeno antes dos cem — e também deixa a tela mandar em pedaços, para uma
// folha de cem não depender de uma única requisição sobreviver inteira.
//
// O REGISTRO em `folha_envios_omie` só é gravado quando a competência vai
// INTEIRA. Um teste de duas pessoas não pode marcar o mês como enviado — no
// dia seguinte ninguém provisionaria os outros cem, e o erro apareceria como
// "já foi enviado", que é a mensagem mais tranquilizadora possível para o pior
// desfecho.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import {
  CONTA_CORRENTE_FOLHA, chaveDoTitulo, integracaoFolhaDe, montarLote, montarTituloFolha,
  recusaDaFolha, resolvedorDeCategoria, soDigitos,
  type CadastroDoFornecedor,
  type ColaboradorDaFolha, type EstadoDaFolha, type ResolveDePara, type TituloDaFolha,
} from "../_shared/folha-envio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE = "https://app.omie.com.br/api/v1";

/**
 * Quando o laço de criação para por conta própria.
 *
 * A Edge Function é MORTA aos 150s e a resposta se perde inteira — foi o que
 * aconteceu com a folha de agosto/2026 duas vezes: 96 títulos entraram no ERP
 * e o navegador só viu "non-2xx", sem saber de nenhum deles. Parando antes, a
 * resposta chega dizendo quem entrou e quem falta.
 */
const TETO_DE_TEMPO_MS = 110_000;

/**
 * Idade máxima da varredura de chaves PIX para ela valer sem reconsulta.
 *
 * A chave TEM de ser a do cadastro do Omie (título e cadastro divergentes
 * travam o pagamento em lote). Mas reler as cem ao vivo dobrava as chamadas e
 * foi o que estourou o tempo e trancou a API por consumo. Meia hora é o
 * bastante para cobrir o caminho normal — reconsultar na tela e provisionar em
 * seguida — e curto o bastante para uma correção feita hoje de manhã não
 * passar despercebida.
 */
const CHAVES_FRESCAS_MS = 30 * 60_000;

/** O Omie trancou a API por consumo. Carrega quanto falta para destrancar. */
class BloqueioDoOmie extends Error {
  constructor(public readonly segundos: number, mensagem: string) {
    super(mensagem);
    this.name = "BloqueioDoOmie";
  }
}

async function omieCall(
  call: string,
  param: Record<string, unknown>,
  path = "financas/contapagar",
): Promise<any> {
  const app_key = Deno.env.get("OMIE_APP_KEY");
  const app_secret = Deno.env.get("OMIE_APP_SECRET");
  if (!app_key || !app_secret) throw new Error("Credenciais do Omie ausentes nos secrets.");

  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const res = await fetch(`${BASE}/${path}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
    });
    const texto = await res.text();
    let data: any;
    try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
    const fault = data && typeof data === "object" ? data.faultstring : null;
    if (res.ok && !fault) return data;

    const msg = String(fault || texto);

    /* Bloqueio por consumo NÃO é transitório: o Omie devolve "Tente novamente
       em 1748 segundos" — vinte e nove minutos. Insistir com backoff de 4,8s
       gastava mais quatro chamadas por pessoa contra uma porta trancada, o que
       só aprofunda o bloqueio. Sai na hora, com o tempo à vista, para o
       chamador poder abortar o lote inteiro em vez de repetir cem vezes. */
    const bloqueio = msg.match(/bloqueada por consumo[\s\S]*?(\d+)\s*segundo/i);
    if (bloqueio) {
      throw new BloqueioDoOmie(Number(bloqueio[1]) || 0, `Omie ${call}: ${msg}`);
    }

    const transitorio = /425|redundante|processando|5020|too many|timeout|50[234]/i.test(msg);
    if (transitorio && tentativa < 3) {
      /* O Omie DIZ quanto esperar: "Aguarde 53 segundos para tentar novamente".
         O backoff exponencial ia a 4,8s e desistia — e um título caía por um
         problema que era só de ritmo. Quando ele informa o tempo, obedecer é o
         que faz a tentativa valer; teto de 60s para a função não estourar. */
      const pedido = msg.match(/aguarde\s+(\d+)\s*segundo/i);
      const espera = pedido
        ? Math.min(60_000, (Number(pedido[1]) + 1) * 1000)
        : 1200 * 2 ** tentativa;
      await new Promise((r) => setTimeout(r, espera));
      continue;
    }
    throw new Error(`Omie ${call}: ${msg}`);
  }
  throw new Error(`Omie ${call}: sem resposta`);
}

/**
 * A chave PIX que o FORNECEDOR tem cadastrada no Omie.
 *
 * É a chave que o ERP usaria se pudesse buscá-la sozinho — e ele não pode: com
 * `finalidade_transferencia` "01.3" ele EXIGE `pix_qrcode` no título. Então o
 * Hub busca e manda.
 *
 * Vale mais que a do espelho do RH: o cadastro do fornecedor é conferido quando
 * a pessoa é criada, e o espelho é digitado a cada admissão. Em 26/08/2026 o
 * espelho tinha CPF com cara de telefone, CNPJ truncado e CNPJ com dígito
 * trocado — dez títulos recusados por causa disso.
 */
async function cadastroDoFornecedor(cnpj: string): Promise<CadastroDoFornecedor> {
  const r = await omieCall("ListarClientes", {
    pagina: 1,
    registros_por_pagina: 20,
    apenas_importado_api: "N",
    clientesFiltro: { cnpj_cpf: cnpj },
  }, "geral/clientes");
  const achados = r?.clientes_cadastro ?? [];
  if (!achados.length) return { chave: "", existe: false };
  /* Prefere o cadastro que TEM chave: o mesmo documento às vezes aparece em
     mais de um registro, e o que interessa é o que consegue pagar. */
  const comChave = achados.find((c: any) => String(c?.dadosBancarios?.cChavePix ?? "").trim());
  const c = comChave ?? achados[0];
  return { chave: String(c?.dadosBancarios?.cChavePix ?? "").trim(), existe: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const quem = await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = await req.json().catch(() => ({}));
    const acao = String(body?.acao ?? "simular");
    const competencia = String(body?.competencia ?? "").slice(0, 7);

    /* ---------- excluir ---------- */
    if (acao === "excluir") {
      const chaves: string[] = Array.isArray(body?.integracoes)
        ? body.integracoes.map((c: unknown) => String(c ?? "").trim()).filter(Boolean)
        : [];
      if (!chaves.length) return json({ status: "erro", erro: "Nada para excluir." }, 400);
      if (chaves.some((c) => !c.startsWith("FOLHA-"))) {
        // Só apaga o que este caminho criou. Sem isto, um id digitado errado
        // apagaria um título de fornecedor que nada tem a ver com a folha.
        return json({ status: "erro", erro: "Só é possível excluir títulos com chave FOLHA-." }, 400);
      }
      const out: Record<string, unknown>[] = [];
      for (const codigo_lancamento_integracao of chaves) {
        try {
          await omieCall("ExcluirContaPagar", { codigo_lancamento_integracao });
          out.push({ integracao: codigo_lancamento_integracao, excluido: true });
        } catch (e) {
          out.push({
            integracao: codigo_lancamento_integracao,
            excluido: false,
            erro: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return json({ status: "ok", acao, resultados: out });
    }

    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      return json({ status: "erro", erro: "Competência inválida." }, 400);
    }

    /* ---------- excluir a competência inteira ---------- */
    if (acao === "excluir_competencia") {
      /* Varre TODO o espelho, não só o lote desta competência: quem foi
         provisionado e depois desligado saiu do lote, mas o título dele
         continua lá. Chave que não existe no Omie volta como "não encontrado",
         que é resposta e não erro — e é separada na saída para a tela não
         parecer um desastre quando na verdade não havia nada para apagar. */
      const { data: pessoas } = await supabase.from("rh_colaboradores").select("codigo, nome");
      const alvos = ((pessoas ?? []) as Record<string, unknown>[])
        // Código vazio geraria "FOLHA--2026-08", que é truthy e não é chave de
        // ninguém — filtra ANTES de montar, não depois.
        .filter((p) => String(p.codigo ?? "").trim())
        .map((p) => ({
          nome: String(p.nome ?? "").trim(),
          integracao: integracaoFolhaDe(String(p.codigo), competencia),
        }));

      const excluidos: string[] = [];
      const naoEncontrados: string[] = [];
      const recusados: { integracao: string; nome: string; erro: string }[] = [];

      for (const a of alvos) {
        try {
          await omieCall("ExcluirContaPagar", { codigo_lancamento_integracao: a.integracao });
          excluidos.push(a.integracao);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // "não existe" é o caso normal de quem nunca foi provisionado.
          if (/não\s*(existe|foi\s*encontrad)|inexistente|not\s*found/i.test(msg)) {
            naoEncontrados.push(a.integracao);
          } else {
            recusados.push({ integracao: a.integracao, nome: a.nome, erro: msg });
            console.error(`ExcluirContaPagar ${a.integracao} (${a.nome}): ${msg}`);
          }
        }
      }

      /* A competência volta a "pendente": ela deixou de estar no ERP, e deixar
         "enviada" faria a próxima pessoa ver "já foi" sobre uma folha vazia. */
      if (excluidos.length) {
        await supabase.from("folha_envios_omie")
          .update({ estado: "pendente" })
          .eq("competencia", `${competencia}-01`);
      }

      return json({
        status: "ok",
        acao,
        competencia,
        excluidos: excluidos.length,
        nao_encontrados: naoEncontrados.length,
        recusados,
      });
    }

    /* ---------- montar o lote ---------- */
    const comecou = Date.now();
    const [rh, dep, cadastros, clientes, chavesCache, envio] = await Promise.all([
      supabase.from("rh_colaboradores")
        .select("id, codigo, nome, cnpj, razao, valor, inicio, datadesl, pix, cargo"),
      supabase.from("folha_depara")
        .select("codigo_rh, departamento, categoria_descricao, valor_referencia, valor_ajustado, documento_ajustado"),
      supabase.from("omie_cache").select("dados").eq("chave", "folha_cadastros").maybeSingle(),
      supabase.from("omie_cache").select("dados").eq("chave", "clientes").maybeSingle(),
      supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "folha_chaves_pix").maybeSingle(),
      supabase.from("folha_envios_omie").select("estado, previsao_ajustada").eq("competencia", `${competencia}-01`).maybeSingle(),
    ]);
    if (rh.error) throw new Error(`Espelho do RH: ${rh.error.message}`);

    const cat = (cadastros.data?.dados ?? {}) as {
      categorias?: { codigo: string; descricao: string; conta_inativa?: boolean }[];
      departamentos?: { codigo: string; descricao: string }[];
      contas_correntes?: { id: number; descricao: string }[];
    };

    const idContaCorrente = (cat.contas_correntes ?? [])
      .find((c) => c.descricao?.trim() === CONTA_CORRENTE_FOLHA)?.id ?? 0;
    if (!idContaCorrente) {
      return json({
        status: "erro",
        erro: `Conta corrente "${CONTA_CORRENTE_FOLHA}" não achada no cadastro do Omie. `
          + "Rode omie-folha-cadastros-sync.",
      }, 409);
    }

    const codCategoria = resolvedorDeCategoria(cat.categorias ?? []);
    const codDepartamento = new Map((cat.departamentos ?? []).map((d) => [d.descricao, d.codigo]));

    const porCodigo = new Map(
      ((dep.data ?? []) as Record<string, unknown>[]).map((d) => [String(d.codigo_rh), d]),
    );
    const deParaDe: ResolveDePara = (codigo) => {
      const d = porCodigo.get(codigo);
      if (!d) return null;
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        departamento: String(d.departamento ?? ""),
        categoria: String(d.categoria_descricao ?? ""),
        valorReferencia: num(d.valor_referencia),
        valorAjustado: num(d.valor_ajustado),
        documentoAjustado: (d.documento_ajustado as string) ?? null,
      };
    };

    const linhasRh = (rh.data ?? []) as Record<string, unknown>[];
    const pessoas: ColaboradorDaFolha[] = linhasRh.map((c) => ({
      id: String(c.id),
      codigo: (c.codigo as string) ?? null,
      nome: String(c.nome ?? "").trim(),
      cnpj: (c.cnpj as string) ?? null,
      razao: (c.razao as string) ?? null,
      valor: c.valor as number,
      inicio: (c.inicio as string) ?? null,
      datadesl: (c.datadesl as string) ?? null,
    }));
    const cargoPorCodigo = new Map(
      linhasRh.map((c) => [String(c.codigo), (c.cargo as string) ?? null]),
    );
    const estagioPorCodigo = new Map(
      linhasRh.map((c) => [String(c.codigo), /estagi/i.test(String(c.cargo ?? ""))]),
    );

    const lote = montarLote(
      pessoas, competencia, deParaDe,
      (envio.data?.previsao_ajustada as string) ?? null,
    );

    /* Subconjunto explícito, para o teste pequeno antes dos cem. */
    const so: string[] = Array.isArray(body?.codigos)
      ? body.codigos.map((c: unknown) => String(c ?? "").trim().toUpperCase()).filter(Boolean)
      : [];
    const parcial = so.length > 0;
    const itens = parcial ? lote.itens.filter((i) => so.includes(i.codigo)) : lote.itens;

    if (!itens.length) return json({ status: "erro", erro: "Nenhum título a enviar." }, 400);

    const fornecedorPorCnpj = new Map<string, number>();
    for (const c of (clientes.data?.dados ?? []) as Record<string, unknown>[]) {
      const k = soDigitos(c?.cnpj_cpf);
      if (k && !fornecedorPorCnpj.has(k)) fornecedorPorCnpj.set(k, Number(c.codigo));
    }

    const titulos: TituloDaFolha[] = [];
    const semPreparo: { nome: string; falta: string }[] = [];

    /* A chave de cada um, lida do CADASTRO do fornecedor, ao vivo.
     *
     * Ao vivo, e não do cache `folha_chaves_pix`: se alguém acabou de corrigir
     * a chave no Omie, um cache de ontem mandaria a antiga — e título com uma
     * chave e cadastro com outra é exatamente a divergência que trava o
     * pagamento em lote inteiro.
     *
     * O espelho do RH não entra aqui. Ele era a primeira opção até 26/08/2026,
     * e é por isso que noventa títulos saíram com uma chave que o cadastro não
     * confirmava. Continua conferido na tela, para o DH arrumar a origem. */
    const cadastroCache = new Map<string, CadastroDoFornecedor | null>();

    /* Passada 1: a varredura `folha_chaves_pix`, se for recente.
     *
     * Ler as cem ao vivo era o certo em teoria e desastroso na prática:
     * dobrava as chamadas ao Omie, o conjunto passou dos 150s da Edge Function
     * e o Omie ainda trancou a API por consumo. A varredura já fez esse
     * trabalho uma vez, e o caminho normal é reconsultar na tela e provisionar
     * logo em seguida. */
    const chavesEm = chavesCache.data?.atualizado_em
      ? new Date(String(chavesCache.data.atualizado_em)).getTime()
      : 0;
    const chavesFrescas = chavesEm > 0 && (Date.now() - chavesEm) < CHAVES_FRESCAS_MS;
    if (chavesFrescas) {
      for (const c of (chavesCache.data?.dados ?? []) as Record<string, unknown>[]) {
        const doc = soDigitos(c?.doc);
        if (doc && !cadastroCache.has(doc)) {
          cadastroCache.set(doc, { chave: String(c.chaveOmie ?? ""), existe: !!c.existe });
        }
      }
    }

    let doCache = 0;
    let doOmie = 0;

    /* Passada 2: quem a varredura não cobre (ou varredura velha) vai ao Omie,
       um a um. Sem teto de tempo aqui: `TETO_DE_TEMPO_MS` no laço de criação é
       quem garante que a função responde. */
    const cadastroDe = async (doc: string): Promise<CadastroDoFornecedor | null> => {
      if (cadastroCache.has(doc)) { doCache++; return cadastroCache.get(doc) ?? null; }
      // Falha de rede não é "não existe": vira null, e a pessoa fica de fora
      // com o motivo escrito em vez de ir com uma chave inventada.
      try { cadastroCache.set(doc, await cadastroDoFornecedor(doc)); }
      catch (e) {
        if (e instanceof BloqueioDoOmie) throw e;  // trancou: não adianta seguir
        cadastroCache.set(doc, null);
      }
      doOmie++;
      return cadastroCache.get(doc) ?? null;
    };

    for (const i of itens) {
      const fornecedor = fornecedorPorCnpj.get(i.cnpj) ?? 0;
      const categoria = i.categoria ? codCategoria(i.categoria) : null;
      const departamento = i.departamento ? codDepartamento.get(i.departamento) ?? null : null;
      /* Departamento NÃO entra na conta de "pronto": ele não vai no payload,
         então exigi-lo aqui barraria um envio por um campo que nem é enviado.
         Continua resolvido e devolvido, para a prévia e para o dia em que o
         Omie aceitar o campo. */
      const estagiario = estagioPorCodigo.get(i.codigo) ?? false;
      const daChave = chaveDoTitulo({
        documento: i.cnpj,
        cadastro: await cadastroDe(i.cnpj),
        estagiario,
      });
      const falta = !fornecedor ? "fornecedor no Omie"
        : !categoria ? "categoria"
          : daChave.bloqueio ?? null;
      if (falta) { semPreparo.push({ nome: i.nome, falta }); continue; }
      titulos.push({
        codigo: i.codigo,
        integracao: i.integracao,
        codigoFornecedor: fornecedor,
        idContaCorrente,
        codigoCategoria: categoria!,
        codigoDepartamento: departamento ?? "",
        valor: i.valor,
        registro: lote.registro,
        vencimento: lote.vencimento,
        previsao: lote.previsao,
        nome: i.nome,
        chavePix: daChave.chave!,
        estagiario,
        cnpj: i.cnpj,
        razao: i.razao,
      });
    }


    /* ---------- simular ---------- */
    if (acao !== "enviar") {
      return json({
        status: "ok",
        acao: "simular",
        competencia,
        parcial,
        titulos: titulos.length,
        sem_preparo: semPreparo,
        contaCorrente: { nome: CONTA_CORRENTE_FOLHA, id: idContaCorrente },
        // O payload do primeiro título: é ele que se confere campo a campo
        // contra a planilha de importação antes de qualquer envio.
        payload: titulos[0] ? montarTituloFolha(titulos[0]) : null,
      });
    }

    /* ---------- enviar ---------- */
    const recusa = recusaDaFolha({
      competencia,
      estado: ((envio.data?.estado as EstadoDaFolha) ?? null),
      itens: itens.map((i) => ({
        cnpj: i.cnpj,
        codigoFornecedor: fornecedorPorCnpj.get(i.cnpj) ?? null,
        codigoCategoria: i.categoria ? codCategoria(i.categoria) : null,
      })),
    });
    if (recusa) return json({ status: "erro", erro: recusa }, 409);
    if (semPreparo.length) {
      return json({
        status: "erro",
        erro: `${semPreparo.length} título(s) sem preparo: ` + semPreparo.map((s) => `${s.nome} (${s.falta})`).join(", "),
      }, 409);
    }

    /* UM A UM, e não em lote.
     *
     * O `IncluirContaPagarPorLote` recusa `departamentos` — testado em
     * 26/08/2026, ver o comentário no topo de `_shared/folha-envio.ts`. Aqui a
     * chamada é `IncluirContaPagar`, a mesma que o fluxo n8n de parceiro usa.
     *
     * Uma falha NÃO derruba as outras: quem passou, passou, e o relatório diz
     * exatamente quem ficou. Reenviar depois é seguro porque o
     * `codigo_lancamento_integracao` faz o Omie recusar o duplicado — e essa
     * recusa é lida como "já criado", não como erro. */
    const resultados: { integracao: string; nome: string; criado: boolean; erro?: string }[] = [];
    /* Quem nem chegou a ser tentado, e por quê. A folha de agosto/2026 morreu
       calada duas vezes por não ter isto: a função era MORTA aos 151s e o
       navegador só via "non-2xx", sem saber que 96 tinham entrado. */
    let interrompido: { motivo: string; segundos?: number } | null = null;

    for (const t of titulos) {
      /* Teto de tempo, e não o teto do Supabase.
         A Edge Function é morta aos 150s sem devolver nada — a resposta se
         perde junto com os títulos que já foram criados, e quem clicou não
         descobre quantos entraram. Parar por conta própria antes disso é o que
         transforma "morreu" em "faltam estes, continue". */
      if (Date.now() - comecou > TETO_DE_TEMPO_MS) {
        interrompido = { motivo: "tempo" };
        break;
      }
      try {
        await omieCall("IncluirContaPagar", montarTituloFolha(t));
        resultados.push({ integracao: t.integracao, nome: t.nome, criado: true });
      } catch (e) {
        /* Bloqueio por consumo não é falha DESTA pessoa: é a API inteira
           trancada por meia hora. Continuar o laço só produziria cem linhas de
           erro iguais e afundaria mais o bloqueio. */
        if (e instanceof BloqueioDoOmie) {
          interrompido = { motivo: "bloqueio", segundos: e.segundos };
          console.error(`folha-omie-enviar: Omie bloqueou a API por ${e.segundos}s`);
          break;
        }
        const msg = e instanceof Error ? e.message : String(e);
        // Duplicado é sucesso: o título já existe com esta chave.
        const jaExiste = /duplicad|j.\s*existe|j.\s*cadastrad|integra..o.*utilizad/i.test(msg);
        // Falha de título vai para o log TAMBÉM, e não só para a resposta: sem
        // isto, um envio em que todos falham aparece como sucesso silencioso e
        // o motivo morre junto com a aba do navegador.
        if (!jaExiste) console.error(`folha-omie-enviar [${t.integracao}]:`, msg);
        resultados.push({
          integracao: t.integracao, nome: t.nome,
          criado: jaExiste, erro: jaExiste ? undefined : msg,
        });
      }
      // Respiro entre chamadas: o Omie derruba rajada com "too many requests".
      await new Promise((r) => setTimeout(r, 150));
    }

    const tentados = new Set(resultados.map((r) => r.integracao));
    const restantes = titulos.filter((t) => !tentados.has(t.integracao));

    const criados = resultados.filter((r) => r.criado);
    const falharam = resultados.filter((r) => !r.criado);

    /* Só a competência INTEIRA marca o mês como enviado, e só se TUDO passou.
       Marcar com falhas dentro faria os que ficaram nunca serem reenviados. */
    if (!parcial && falharam.length === 0 && restantes.length === 0) {
      await supabase.from("folha_envios_omie").upsert({
        competencia: `${competencia}-01`,
        estado: "enviado",
        titulos: titulos.length,
        valor_total: titulos.reduce((s, t) => s + t.valor, 0),
        enviado_em: new Date().toISOString(),
        enviado_por: quem.userId,
        resposta: resultados,
      }, { onConflict: "competencia" });

      /* A referência de cada pessoa passa a ser o que ACABOU de ser pago, para
         o mês que vem comparar contra a realidade e não contra julho. */
      for (const i of itens) {
        await supabase.from("folha_depara")
          .update({ valor_referencia: i.valorBase, valor_referencia_competencia: `${competencia}-01` })
          .eq("codigo_rh", i.codigo);
      }
    }

    return json({
      status: "ok",
      acao: "enviar",
      competencia,
      parcial,
      titulos: criados.length,
      falharam: falharam.length,
      // Só as chaves criadas: são elas que o botão de desfazer apaga.
      integracoes: criados.map((r) => r.integracao),
      resultados,
      /* Quem não foi tentado. A tela usa isto para continuar de onde parou,
         em vez de mandar tudo de novo e depender da recusa por duplicidade. */
      restantes: restantes.length,
      restantes_codigos: restantes.map((t) => t.codigo),
      interrompido,
      /* De onde saiu a chave PIX de cada um. Fica na resposta porque "o Omie
         está bloqueado" e "o cache estava velho" pedem ações diferentes. */
      chaves: { do_cache: doCache, do_omie: doOmie },
    });
  } catch (e) {
    /* Bloqueio por consumo tem resposta própria: o que resolve é ESPERAR, e
       dizer quantos minutos é a diferença entre a pessoa tentar de novo agora
       (afundando o bloqueio) e voltar depois do almoço. */
    if (e instanceof BloqueioDoOmie) {
      console.error("folha-omie-enviar: Omie bloqueou a API por", e.segundos, "s");
      const min = Math.ceil(e.segundos / 60);
      return json({
        status: "erro",
        erro: `O Omie bloqueou a API por consumo. Nada foi criado nesta tentativa. `
          + `Tente de novo em ${min} minuto(s).`,
        bloqueio_segundos: e.segundos,
      }, 429);
    }
    const msg = e instanceof Error ? e.message : String(e);
    /* Vai para os logs da função além do corpo da resposta. O corpo serve a
       quem clicou; o log serve a quem investiga depois, quando a tela já
       fechou e a única pergunta é "por que aquele envio falhou?". */
    console.error("folha-omie-enviar:", msg);
    const status = /autentic|permiss/i.test(msg) ? 401 : 500;
    return json({ status: "erro", erro: msg }, status);
  }
});
