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
//              Desde 12/09/2026 ele tem um DEGRAU antes: quem não tem
//              fornecedor no Omie o Hub tenta cadastrar, em vez de devolver
//              "cadastre o CNPJ no Omie" e pular a pessoa. Ver o degrau de
//              cadastro no corpo — e note que o caso mais comum não escreve
//              nada, só descobre que o cache de clientes estava velho.
//   "excluir"  apaga títulos criados por aqui, pelo `codigo_lancamento_integracao`.
//              Existe porque o primeiro envio real é um teste de 1 ou 2 títulos,
//              e teste sem desfazer não é teste — é aposta.
//   "corrigir"  conserta títulos que JÁ existem, sem recriá-los. Manda só o que
//              é nosso — número do documento e o bloco do PIX — porque a
//              documentação do Omie NÃO diz se `AlterarContaPagar` é parcial ou
//              substitui o registro, e alguns títulos já têm NFS-e anexada por
//              gente. Por isso também aceita `codigos`: dá para corrigir UM e
//              conferir antes de mexer nos cem.
//   "sondar_departamento"  pergunta ao Omie como se chama a tag do centro de
//              custo, que segue desconhecida desde 26/08/2026 e faz a folha
//              nascer sem distribuição por área. Leitura pura na parte que
//              responde: lê um título de folha lançado PELA PLANILHA (que tem o
//              campo preenchido) e devolve o registro cru. Ver o corpo.
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
  CONTA_CORRENTE_FOLHA, chaveDoTitulo, cnpjRepetidoNoLote, dataBR, faltaEhDeCadastro,
  integracaoFolhaDe, montarLote,
  montarTituloFolha, numeroDocumentoDaFolha, registroDa,
  recusaDaFolha, resolvedorDeCategoria, soDigitos,
  type CadastroDoFornecedor,
  type ColaboradorDaFolha, type EstadoDaFolha, type ResolveDePara, type TituloDaFolha,
} from "../_shared/folha-envio.ts";
/* A DECISÃO DE CADASTRO VEM DO MÓDULO, não de uma cópia. É a mesma que a
 * `omie-colaboradores-cadastrar` usa pela tela do DH, e ela é pura e testada
 * (`colaboradorOmie.test.ts`). Ver o degrau de cadastro, mais abaixo. */
import {
  decidirCadastro, montarAlterarPix, montarIncluirCliente,
  type ClienteDoOmie, type ColaboradorParaOmie, type DecisaoDeCadastro,
} from "../_shared/colaborador-omie.ts";

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

/* ------------------------------------------------------------------
 * Os dois freios do degrau de cadastro
 * ------------------------------------------------------------------
 * São DUAS chamadas ao Omie por pessoa (`ListarClientes` e, quando é o caso,
 * `IncluirCliente`), com 200ms de respiro entre elas — perto de 1,5s cada. O
 * laço de criação de títulos vem DEPOIS e precisa caber nos 150s do gateway
 * (ver `TETO_DE_TEMPO_MS`): sem freio aqui, uma folha com quinze gente sem
 * cadastro gastaria o orçamento inteiro cadastrando e não criaria título
 * nenhum — trocaria um trabalho manual por uma resposta vazia.
 *
 * 30s medidos do `comecou`, e não do início do degrau, porque o que importa é
 * quanto sobra para os títulos. Quem não couber fica em `semPreparo` como
 * antes e entra na chamada seguinte: a fila anda, só não termina numa tacada.
 */
const CADASTRO_MAX_POR_CHAMADA = 8;
const CADASTRO_PRAZO_MS = 30_000;

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
/**
 * O que o Omie tem para este documento — a lista CRUA. Vazia = ninguém.
 *
 * Uma leitura só, e a lista inteira, porque agora ela responde duas perguntas
 * diferentes: "qual chave paga esta pessoa?" (`cadastroQuePaga`, para o título)
 * e "existe cadastro, e com que código?" (`decidirCadastro`, no degrau de
 * cadastro). Reduzir aqui obrigaria o degrau a repetir o `ListarClientes` da
 * mesma pessoa — duas chamadas coladas ao mesmo método, que é o que o Omie
 * recusa por consumo redundante.
 */
async function cadastrosDoCnpj(cnpj: string): Promise<ClienteDoOmie[]> {
  const r = await omieCall("ListarClientes", {
    pagina: 1,
    registros_por_pagina: 20,
    apenas_importado_api: "N",
    clientesFiltro: { cnpj_cpf: cnpj },
  }, "geral/clientes");
  return (r?.clientes_cadastro ?? []) as ClienteDoOmie[];
}

/** O cadastro que PAGA, reduzido ao que o título precisa. */
function cadastroQuePaga(achados: ClienteDoOmie[]): CadastroDoFornecedor {
  if (!achados.length) return { chave: "", existe: false };
  /* Prefere o cadastro que TEM chave: o mesmo documento às vezes aparece em
     mais de um registro, e o que interessa é o que consegue pagar. */
  const comChave = achados.find((c) => String(c?.dadosBancarios?.cChavePix ?? "").trim());
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
    /* Só `enviar` escreve. O degrau de cadastro respeita isto pelo mesmo motivo
       que a `omie-colaboradores-cadastrar` tem dois modos no mesmo código:
       simular tem de percorrer o caminho inteiro, com a escrita desligada. */
    const simular = acao !== "enviar";
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

    /* ------------------------------------------------------------------
     * SONDAR O NOME DA TAG DO DEPARTAMENTO
     * ------------------------------------------------------------------
     * O PROBLEMA, aberto desde 26/08/2026: a folha vai ao Omie SEM centro de
     * custo, porque o ERP recusa a tag que tentamos —
     *
     *     ERROR: Tag [DEPARTAMENTOS] não faz parte da estrutura do tipo
     *            complexo [conta_pagar_cadastro]!
     *
     * — e o nome certo nunca foi descoberto. Custo mensal: alguém distribui a
     * folha por área à mão no ERP, todo mês, esperando uma descoberta.
     *
     * DOIS ORÁCULOS, e o primeiro é o que de fato responde.
     *
     * 1. O TÍTULO QUE JÁ TEM DEPARTAMENTO. As folhas até julho/2026 foram
     *    lançadas pela planilha de importação, que PREENCHE a coluna
     *    "Departamento (100%)" — e o importador resolve o campo por conta
     *    própria. Logo existem, no Omie, títulos de folha com departamento
     *    gravado. `ConsultarContaPagar` num deles devolve o registro inteiro:
     *    a tag aparece com o NOME REAL e os itens com os NOMES REAIS dos
     *    campos. É a mesma técnica do "cadastro-molde" usada em toda escrita
     *    fiscal deste repo — ler um registro certo em vez de adivinhar formato.
     *
     *    Por isso a resposta devolve o registro CRU, e não só as chaves que eu
     *    achei relevantes: adivinhar qual chave importa é o erro que já custou
     *    duas semanas aqui.
     *
     * 2. A CRÍTICA DE ESTRUTURA, a mesma ideia do `sondarMetodos` da
     *    `omie-nfse-sync` aplicada a CAMPO em vez de método. Tag desconhecida
     *    responde "não faz parte da estrutura do tipo complexo", com o nome no
     *    meio da frase; tag conhecida responde OUTRA COISA (falta campo
     *    obrigatório, lançamento não encontrado) — e é a diferença entre as
     *    duas frases que classifica.
     *
     * NADA É ESCRITO, e isso é garantido por construção, não por cuidado: o
     * `codigo_lancamento_integracao` da sonda é um sentinela que não existe
     * (`SONDA-DEP-…`), e `AlterarContaPagar` não cria. Se a estrutura passar, a
     * recusa seguinte é "lançamento não encontrado" — que é justamente a
     * resposta que prova que a tag existe.
     *
     * UM PAYLOAD DIFERENTE POR CANDIDATO, de propósito: o Omie tranca por
     * consumo redundante quando a MESMA chamada se repete (30 min, ver
     * `BloqueioDoOmie`), e a variação do nome da tag já basta para cada uma ser
     * outra chamada. O respiro de 1,5s entre elas é o que sobra de cuidado.
     */
    if (acao === "sondar_departamento") {
      /* A data de registro de uma folha lançada PELA PLANILHA. O padrão é o
         último dia de junho/2026: `MARCO_FOLHA_FORA_DO_HUB` diz que tudo até
         julho ficou fora do Hub, e a folha de junho é a última com certeza
         importada com a coluna de departamento preenchida. Dá para passar
         outra em `registro` se essa não devolver nada. */
      const registro = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.registro ?? ""))
        ? String(body.registro)
        : "2026-06-30";

      const lista = await omieCall("ListarContasPagar", {
        pagina: 1,
        registros_por_pagina: 50,
        apenas_importado_api: "N",
        filtrar_por_registro_de: dataBR(registro),
        filtrar_por_registro_ate: dataBR(registro),
        exibir_obs: "S",
      }).catch((e: unknown) => ({ erro: e instanceof Error ? e.message : String(e) }));

      const cadastros: any[] = (lista as any)?.conta_pagar_cadastro ?? [];
      /* Os três primeiros bastam: se a tag está em um, está em todos — e se não
         está em nenhum dos três, a data escolhida não é de folha da planilha e o
         que falta é trocar a data, não ler mais títulos. */
      const crus: any[] = [];
      for (const c of cadastros.slice(0, 3)) {
        const cod = Number(c?.codigo_lancamento_omie ?? 0);
        if (!cod) continue;
        const um = await omieCall("ConsultarContaPagar", { codigo_lancamento_omie: cod })
          .catch((e: unknown) => ({ erro: e instanceof Error ? e.message : String(e) }));
        crus.push({ codigo_lancamento_omie: cod, observacao: String(c?.observacao ?? ""), cru: um });
        await new Promise((r) => setTimeout(r, 600));
      }

      /* As chaves que CHEIRAM a departamento, destacadas da resposta crua. Não
         substituem o cru — só poupam a leitura de um registro de sessenta
         campos quando a resposta é obvia. */
      const suspeitas = crus.flatMap((c) => {
        const alvo = c?.cru && typeof c.cru === "object" ? c.cru : {};
        return Object.entries(alvo)
          .filter(([k]) => /dep|distrib|rateio|centro|custo/i.test(k))
          .map(([k, v]) => ({ codigo_lancamento_omie: c.codigo_lancamento_omie, tag: k, valor: v }));
      });

      /* Os candidatos vêm da nomenclatura que o Omie usa noutros lugares: o
         `cCodDep` da planilha, o `distribuicao` das contas a receber, o plural
         e o singular de cada um. A lista é curta de propósito — cada nome custa
         uma chamada e um respiro. */
      const candidatos = [
        "distribuicao", "departamentos", "departamento",
        "dep_conta_pagar", "distribuicao_departamento",
        "rateio", "rateios", "centro_custo", "centros_custo",
        // Controle: um nome que garantidamente não existe. Sem ele a sonda não
        // prova nada — foi o que classificou TUDO como "existe" na primeira
        // versão da sonda de métodos, em 09/09/2026.
        "tag_que_nao_existe_controle",
      ];
      const estrutura: Record<string, string> = {};
      for (const tag of candidatos) {
        try {
          await omieCall("AlterarContaPagar", {
            codigo_lancamento_integracao: `SONDA-DEP-${tag}`,
            [tag]: [{ cCodDep: "0", nPerDep: 100 }],
          });
          estrutura[tag] = "RESPONDEU SEM ERRO (investigar antes de usar)";
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          estrutura[tag] = /n.o faz parte da estrutura/i.test(m)
            ? "não existe"
            : `EXISTE → ${m.slice(0, 200)}`;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      return json({
        status: "ok",
        acao,
        registro,
        titulos_na_data: cadastros.length,
        /* A RESPOSTA está aqui: a tag e os nomes dos campos dos itens, lidos de
           um título que o Omie aceitou com departamento preenchido. */
        suspeitas,
        estrutura,
        crus,
        como_ler: "Se `suspeitas` trouxer uma tag com itens, o nome dela e os campos dos itens são a "
          + "resposta — escreva-os em `montarTituloFolha`, em `_shared/folha-envio.ts`, com a data da "
          + "medição. `estrutura` é a segunda opinião: a tag certa responde 'EXISTE → …' (em geral "
          + "'lançamento não encontrado', porque a sonda usa um código que não existe), e as erradas "
          + "respondem 'não existe'. O controle `tag_que_nao_existe_controle` TEM de aparecer como "
          + "'não existe' — se ele aparecer como EXISTE, a sonda não está provando nada.",
      });
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
    /* Segunda fonte: a varredura de chaves PIX, que já guarda o
       `codigo_cliente_omie` de cada um e é MUITO mais nova que o cache de
       clientes (7040 registros, sincronizado de vez em quando).
     *
     * Sem isto, o fornecedor do Sérgio — criado no Omie em 27/08/2026, com o
     * cache de clientes de 26/08 16:01 — aparecia como inexistente, e a recusa
     * "1 colaborador sem fornecedor" derrubava os cento e dois. Não custa
     * chamada nenhuma: o dado já está aqui. */
    for (const c of (chavesCache.data?.dados ?? []) as Record<string, unknown>[]) {
      const k = soDigitos(c?.doc);
      const cod = Number(c?.codigoOmie ?? 0);
      if (k && cod && !fornecedorPorCnpj.has(k)) fornecedorPorCnpj.set(k, cod);
    }

    const titulos: TituloDaFolha[] = [];
    const semPreparo: { codigo: string; nome: string; integracao: string; falta: string }[] = [];

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
    /* A validade é POR PESSOA, e não da varredura inteira.
     *
     * A tela reconfere só quem está pendente a cada abertura; quem foi
     * corrigido no Omie há dois minutos tem carimbo novo mesmo que a varredura
     * completa seja de ontem. Julgar pela linha do cache faria essa correção
     * ser ignorada — que é exatamente a queixa que originou isto. */
    const daVarredura = chavesCache.data?.atualizado_em
      ? new Date(String(chavesCache.data.atualizado_em)).getTime()
      : 0;
    for (const c of (chavesCache.data?.dados ?? []) as Record<string, unknown>[]) {
      const doc = soDigitos(c?.doc);
      if (!doc || cadastroCache.has(doc)) continue;
      const em = c?.em ? new Date(String(c.em)).getTime() : daVarredura;
      if (em > 0 && (Date.now() - em) < CHAVES_FRESCAS_MS) {
        cadastroCache.set(doc, { chave: String(c.chaveOmie ?? ""), existe: !!c.existe });
      }
    }

    let doCache = 0;
    let doOmie = 0;

    /* Passada 2: quem a varredura não cobre (ou varredura velha) vai ao Omie,
       um a um. Sem teto de tempo aqui: `TETO_DE_TEMPO_MS` no laço de criação é
       quem garante que a função responde. */
    /* A lista crua do `ListarClientes`, guardada à parte da chave reduzida: é
       dela que o degrau de cadastro tira o `codigo_cliente_omie` sem repetir a
       consulta. Fica vazia para quem veio da varredura `folha_chaves_pix` — e o
       degrau, se chegar até essa pessoa, consulta então. */
    const brutoCache = new Map<string, ClienteDoOmie[]>();

    const cadastroDe = async (doc: string): Promise<CadastroDoFornecedor | null> => {
      if (cadastroCache.has(doc)) { doCache++; return cadastroCache.get(doc) ?? null; }
      // Falha de rede não é "não existe": vira null, e a pessoa fica de fora
      // com o motivo escrito em vez de ir com uma chave inventada.
      try {
        const achados = await cadastrosDoCnpj(doc);
        brutoCache.set(doc, achados);
        cadastroCache.set(doc, cadastroQuePaga(achados));
      } catch (e) {
        if (e instanceof BloqueioDoOmie) throw e;  // trancou: não adianta seguir
        cadastroCache.set(doc, null);
      }
      doOmie++;
      return cadastroCache.get(doc) ?? null;
    };

    /**
     * O título de UMA pessoa — ou o que falta para ela.
     *
     * Era um laço; virou função porque agora roda DUAS vezes para quem passa
     * pelo degrau de cadastro abaixo: a primeira descobre que falta o
     * fornecedor, a segunda monta o título com o fornecedor recém-criado. Uma
     * segunda cópia da montagem é a receita conhecida para o caminho novo sair
     * com um campo diferente do caminho antigo.
     */
    const montar = async (i: (typeof itens)[number]): Promise<{ titulo?: TituloDaFolha; falta?: string }> => {
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
      if (falta) return { falta };
      return {
        titulo: {
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
        },
      };
    };

    for (const i of itens) {
      const r = await montar(i);
      if (r.falta) {
        semPreparo.push({ codigo: i.codigo, nome: i.nome, integracao: i.integracao, falta: r.falta });
        continue;
      }
      titulos.push(r.titulo!);
    }

    /* ------------------------------------------------------------------
     * O DEGRAU QUE FALTAVA: o fornecedor que o ERP ainda não tem
     * ------------------------------------------------------------------
     * "Cadastre o CNPJ no Omie antes de enviar" era um PRÉ-REQUISITO devolvido,
     * e a peça que o cumpre já existia: `_shared/colaborador-omie.ts` decide
     * (criar / gravar o PIX / não mexer / bloquear) e tem teste, e a
     * `omie-colaboradores-cadastrar` a usa por outra tela. Faltava só ser um
     * PASSO do envio em vez de uma mensagem — a pessoa era pulada, a folha das
     * outras cem seguia, e o salário dela esperava alguém abrir a outra tela.
     *
     * O MESMO MÓDULO, não uma cópia: chamar a outra função por HTTP custaria um
     * salto e uma autenticação, e reescrever a decisão aqui faria as duas
     * divergirem no primeiro ajuste (a lição do `_shared/folha-envio.ts`
     * colado à mão em 26/08/2026).
     *
     * TRÊS DESFECHOS RESOLVEM, e o terceiro é o mais comum e o mais barato:
     *
     *   • `criar`      → `IncluirCliente`. O fornecedor nasce com a chave PIX.
     *   • `alterar_pix`→ o cadastro existe sem chave; grava só a chave.
     *   • `ja_ok`      → NADA é escrito. O cadastro estava lá e era o nosso
     *     cache de clientes que não sabia — o caso do Sérgio em 27/08/2026,
     *     generalizado. Um `ListarClientes` de leitura destrava a pessoa.
     *
     * O QUE ELE NÃO DECIDE continua sendo de gente, e agora com o motivo certo
     * na tela: desligado, documento que é CPF de quem não é estagiário, PIX do
     * Omie divergindo do RH. "Sem fornecedor no Omie" dizia o sintoma; "PIX do
     * Omie (X) difere do RH (Y)" diz o que fazer.
     *
     * DOIS RELÓGIOS E UM TETO, porque são duas chamadas ao Omie por pessoa e o
     * laço de criação de títulos ainda precisa caber nos 150s do gateway (ver
     * `TETO_DE_TEMPO_MS`). Quem não couber fica em `semPreparo` como antes e
     * entra na chamada seguinte — a fila anda, só não termina numa tacada.
     */
    /* `escreveu` e `resolvido` são coisas diferentes, e juntá-las num `feito` só
       confundia o caso mais comum: `ja_ok` resolve a pessoa SEM escrever nada. */
    const cadastroFornecedor: {
      codigo: string; nome: string; acao: string;
      escreveu: boolean; resolvido: boolean; motivo?: string; erro?: string;
    }[] = [];
    let cadastroInterrompido: string | null = null;

    const pendentesDeCadastro = semPreparo.filter((p) => faltaEhDeCadastro(p.falta));

    /* AS TRAVAS DO MÊS, LIDAS ANTES DE ESCREVER CADASTRO — e isto é a ordem que
     * importa, não uma otimização.
     *
     * `recusaDaFolha` responde "este mês pode ir ao ERP?": a chave de envio, o
     * marco das folhas lançadas fora do Hub, a competência já enviada, e o CNPJ
     * dividido por mais de uma pessoa. Ela sempre foi consultada DEPOIS da
     * montagem dos títulos, porque até aqui nada escrevia antes dela. O degrau
     * de cadastro escreve — e criar fornecedor para uma folha que não vai ser
     * enviada é escrita que ninguém pediu, num cadastro que não se desfaz junto
     * com o lote recusado.
     *
     * COM RECUSA, O DEGRAU AINDA RODA — sem escrever. É o mesmo tratamento de
     * `simular`: a consulta é o que revela que o cadastro já existe e era o
     * cache que estava velho, e a prévia precisa dessa verdade mesmo num mês
     * travado. O que a recusa desliga é a escrita, não a leitura.
     *
     * E ELA É CALCULADA DUAS VEZES, de propósito. Esta lê o estado ANTES do
     * degrau e só governa a permissão de escrever; a do `enviar`, mais abaixo,
     * relê depois e é a que decide o envio. `recusaDaFolha` é pura, então a
     * segunda chamada não custa nada — e o dia em que ela voltar a olhar o
     * fornecedor de cada um (já olhou, até 27/08/2026), esta cópia estaria
     * julgando um estado que o degrau acabou de mudar. Uma só, aqui, barraria o
     * mês por falta do cadastro que o degrau ia criar. */
    const recusaAntesDoDegrau = recusaDaFolha({
      competencia,
      estado: ((envio.data?.estado as EstadoDaFolha) ?? null),
      itens: itens.map((i) => ({
        cnpj: i.cnpj,
        codigoFornecedor: fornecedorPorCnpj.get(i.cnpj) ?? null,
        codigoCategoria: i.categoria ? codCategoria(i.categoria) : null,
      })),
    });

    /* CNPJ repetido barra o degrau INTEIRO, e não só a escrita de uma pessoa:
       criar fornecedor para quatro que dividem um documento dá um cadastro só, e
       os quatro salários iriam para ele. Já está dentro de `recusaDaFolha`, e
       fica explícito aqui porque é a única das quatro travas que desqualifica a
       LEITURA também — não há o que aprender consultando o Omie sobre um lote
       cujo cadastro do RH está errado. */
    const repetidoNoLote = cnpjRepetidoNoLote(
      itens.map((i) => ({ cnpj: i.cnpj, codigoFornecedor: null, codigoCategoria: null })),
    );

    /** O degrau pode ESCREVER? Ler ele sempre pode. */
    const cadastroEscreve = !simular && !recusaAntesDoDegrau;

    /* `corrigir` fica de fora: ele mexe em título que JÁ existe, e quem não tem
       fornecedor não tem título para corrigir. Criar cadastro ali seria escrita
       que a ação não promete. */
    if (pendentesDeCadastro.length && !repetidoNoLote && acao !== "corrigir") {
      const pessoaPorCodigo = new Map(
        linhasRh.map((c) => [String(c.codigo), {
          codigo: String(c.codigo ?? ""),
          nome: String(c.nome ?? "").trim(),
          cnpj: (c.cnpj as string) ?? null,
          razao: (c.razao as string) ?? null,
          pix: (c.pix as string) ?? null,
          datadesl: (c.datadesl as string) ?? null,
          cargo: (c.cargo as string) ?? null,
        } satisfies ColaboradorParaOmie]),
      );

      let quantos = 0;
      for (const p of pendentesDeCadastro) {
        if (quantos >= CADASTRO_MAX_POR_CHAMADA) {
          cadastroInterrompido = `teto de ${CADASTRO_MAX_POR_CHAMADA} cadastros por chamada`;
          break;
        }
        if (Date.now() - comecou > CADASTRO_PRAZO_MS) {
          cadastroInterrompido = "o degrau de cadastro chegou no teto de tempo";
          break;
        }
        const pessoa = pessoaPorCodigo.get(p.codigo);
        if (!pessoa) continue;
        quantos++;

        let decisao: DecisaoDeCadastro;
        try {
          const cnpj = soDigitos(pessoa.cnpj);
          /* A lista que a montagem já leu, quando leu. Documento inválido nem
             chega a consultar — `decidirCadastro` o bloqueia sem o Omie. */
          const achados = brutoCache.get(cnpj)
            ?? (cnpj.length === 14 || cnpj.length === 11 ? await cadastrosDoCnpj(cnpj) : []);
          brutoCache.set(cnpj, achados);
          decisao = decidirCadastro(pessoa, achados);
        } catch (e) {
          /* Bloqueio por consumo tranca a API inteira por meia hora: seguir o
             laço só produz oito linhas de erro iguais e afunda o bloqueio. */
          if (e instanceof BloqueioDoOmie) {
            cadastroInterrompido = `o Omie bloqueou a API por ${Math.ceil(e.segundos / 60)} minuto(s)`;
            break;
          }
          cadastroFornecedor.push({
            codigo: p.codigo, nome: p.nome, acao: "erro", escreveu: false, resolvido: false,
            erro: e instanceof Error ? e.message : String(e),
          });
          continue;
        }

        if (decisao.acao === "bloqueado") {
          /* BLOQUEADO PARA ESCREVER NÃO É BLOQUEADO PARA PAGAR, e confundir os
           * dois tirava da folha justamente quem estava a um código de distância
           * de entrar nela.
           *
           * Dos quatro motivos de bloqueio, um só carrega `codigoClienteOmie`: o
           * PIX do Omie divergir do PIX do RH. Ele diz "não sobrescreva a chave
           * do ERP com a do RH" — e está certo. Mas o título da folha NUNCA paga
           * com a chave do RH: paga com a do cadastro do Omie, de propósito
           * desde 26/08/2026 (ver `chaveDoTitulo` e o comentário sobre os
           * noventa títulos). Então quem tem código é ligado no mapa e
           * `chaveDoTitulo` decide — é ela a autoridade sobre o que o título
           * pode pagar. O bloqueio segue no relatório, para o DH arrumar a
           * origem, sem segurar o salário por uma divergência de cadastro.
           *
           * Os outros três (desligado, CPF de quem não é estagiário, documento
           * incompleto) não têm código, não viram título, e agora dizem o motivo
           * no lugar do sintoma: "Desligado em 07/08 — rescisão é tratada em
           * Governança › Rescisões" em vez de "sem fornecedor no Omie". */
          const temCodigo = Number(decisao.codigoClienteOmie ?? 0) > 0;
          if (temCodigo) {
            fornecedorPorCnpj.set(soDigitos(pessoa.cnpj), Number(decisao.codigoClienteOmie));
          } else {
            const linha = semPreparo.find((s) => s.codigo === p.codigo);
            if (linha && decisao.motivo) linha.falta = decisao.motivo;
          }
          cadastroFornecedor.push({
            codigo: p.codigo, nome: p.nome, acao: "bloqueado",
            escreveu: false, resolvido: temCodigo, motivo: decisao.motivo,
          });
          continue;
        }

        /* `ja_ok` RESOLVE EM QUALQUER MODO, inclusive simulando: nada foi
         * escrito, a consulta só descobriu um cadastro que já estava lá. Deixar
         * de preencher o mapa aqui faria a prévia dizer "sem fornecedor no
         * Omie" sobre alguém que tem fornecedor no Omie — mentira, e a mentira
         * que originou este degrau.
         *
         * `criar`/`alterar_pix` simulando NÃO preenchem nada: ali o cadastro de
         * fato não existe até alguém clicar em enviar. */
        if (decisao.acao === "ja_ok") {
          fornecedorPorCnpj.set(soDigitos(pessoa.cnpj), decisao.codigoClienteOmie!);
          cadastroCache.set(soDigitos(pessoa.cnpj), { chave: decisao.chavePix ?? "", existe: true });
          cadastroFornecedor.push({
            codigo: p.codigo, nome: p.nome, acao: "ja_ok", escreveu: false, resolvido: true,
            motivo: "o fornecedor já existe no Omie — o cache de clientes é que estava velho",
          });
          continue;
        }

        if (!cadastroEscreve) {
          cadastroFornecedor.push({
            codigo: p.codigo, nome: p.nome, acao: decisao.acao,
            escreveu: false, resolvido: false,
            motivo: recusaAntesDoDegrau
              ? `não foi feito: ${recusaAntesDoDegrau}`
              : "seria feito no envio",
          });
          continue;
        }

        try {
          let codigoOmie = decisao.codigoClienteOmie ?? 0;
          if (decisao.acao === "criar") {
            const r = await omieCall("IncluirCliente", montarIncluirCliente(pessoa), "geral/clientes");
            codigoOmie = Number(r?.codigo_cliente_omie ?? 0);
          } else {
            await omieCall(
              "AlterarCliente",
              montarAlterarPix(decisao.codigoClienteOmie!, decisao.chavePix!),
              "geral/clientes",
            );
          }
          if (!codigoOmie) throw new Error("o Omie não devolveu o código do cliente");

          /* O MAPA E O CACHE DA CHAVE, atualizados juntos.
           *
           * A chave gravada é `decisao.chavePix` — não uma releitura. Sabemos o
           * que acabamos de escrever, e um `ConsultarCliente` colado no
           * `IncluirCliente` é justamente o que o Omie recusa por consumo
           * redundante. `chaveDoTitulo` ainda a valida na remontagem abaixo
           * (estagiário em CPF, documento de terceiro), então nada passa por
           * não ter sido conferido. */
          fornecedorPorCnpj.set(soDigitos(pessoa.cnpj), codigoOmie);
          cadastroCache.set(soDigitos(pessoa.cnpj), { chave: decisao.chavePix ?? "", existe: true });

          cadastroFornecedor.push({
            codigo: p.codigo, nome: p.nome, acao: decisao.acao, escreveu: true, resolvido: true,
          });
        } catch (e) {
          if (e instanceof BloqueioDoOmie) {
            cadastroInterrompido = `o Omie bloqueou a API por ${Math.ceil(e.segundos / 60)} minuto(s)`;
            break;
          }
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`folha-omie-enviar cadastro [${p.codigo} ${p.nome}]:`, msg);
          cadastroFornecedor.push({
            codigo: p.codigo, nome: p.nome, acao: decisao.acao,
            escreveu: false, resolvido: false, erro: msg,
          });
        }
        // Respiro: duas chamadas por pessoa, e o Omie derruba rajada.
        await new Promise((r) => setTimeout(r, 200));
      }

      /* REMONTA quem o degrau destravou — e é `montar` de novo, a mesma, e não
         um `titulos.push` local: o título de quem passou pelo cadastro tem de
         ser idêntico ao de quem já estava pronto. */
      const destravados = new Set(
        cadastroFornecedor.filter((c) => c.resolvido).map((c) => c.codigo),
      );
      for (const i of itens) {
        if (!destravados.has(i.codigo)) continue;
        const r = await montar(i);
        if (r.titulo) {
          titulos.push(r.titulo);
          const k = semPreparo.findIndex((s) => s.codigo === i.codigo);
          if (k >= 0) semPreparo.splice(k, 1);
        } else if (r.falta) {
          const linha = semPreparo.find((s) => s.codigo === i.codigo);
          if (linha) linha.falta = r.falta;
        }
      }

      /* O cache de clientes ficou velho no instante em que criamos alguém —
         marcar é mais honesto que reescrever 7.000 linhas aqui. */
      if (cadastroFornecedor.some((c) => c.escreveu)) {
        await supabase.from("omie_cache")
          .update({ atualizado_em: new Date(0).toISOString() })
          .eq("chave", "clientes")
          .then(() => {}, () => { /* o cadastro já foi criado; o carimbo não o desfaz */ });
      }
    }


    /* ---------- simular ---------- */
    // `corrigir` segue adiante: ele mexe em título que já existe, e a
    // simulação o devolveria antes de chegar lá.
    if (acao !== "enviar" && acao !== "corrigir") {
      return json({
        status: "ok",
        acao: "simular",
        competencia,
        parcial,
        titulos: titulos.length,
        sem_preparo: semPreparo,
        /* O que o envio FARIA de cadastro, e o que já estava resolvido sem
           ninguém saber (`ja_ok` = cache de clientes velho). */
        cadastro_de_fornecedor: cadastroFornecedor.length
          ? { resultados: cadastroFornecedor, interrompido: cadastroInterrompido }
          : null,
        contaCorrente: { nome: CONTA_CORRENTE_FOLHA, id: idContaCorrente },
        // O payload do primeiro título: é ele que se confere campo a campo
        // contra a planilha de importação antes de qualquer envio.
        payload: titulos[0] ? montarTituloFolha(titulos[0]) : null,
      });
    }

    /* ---------- o que NÃO entrou, gravado ---------- */

    /**
     * Registra (ou atualiza) uma recusa, para ela sobreviver ao fechar da aba.
     *
     * `tentativas` é somado à mão porque o upsert do supabase-js substitui a
     * linha inteira; ler antes é o preço de saber que alguém travou três vezes
     * seguidas — que é justamente o sinal de que o problema não é o envio, é o
     * cadastro.
     */
    const gravarRecusas = async (
      linhas: { codigo: string; nome: string; integracao: string; origem: string; motivo: string }[],
    ) => {
      if (!linhas.length) return;
      const { data: antes } = await supabase.from("folha_recusas")
        .select("codigo_rh, tentativas")
        .eq("competencia", `${competencia}-01`)
        .in("codigo_rh", linhas.map((l) => l.codigo));
      const vezes = new Map(
        ((antes ?? []) as Record<string, unknown>[]).map((r) => [String(r.codigo_rh), Number(r.tentativas) || 0]),
      );
      await supabase.from("folha_recusas").upsert(
        linhas.map((l) => ({
          competencia: `${competencia}-01`,
          codigo_rh: l.codigo,
          nome: l.nome,
          integracao: l.integracao,
          origem: l.origem,
          motivo: l.motivo,
          tentativas: (vezes.get(l.codigo) ?? 0) + 1,
          tentado_em: new Date().toISOString(),
          tentado_por: quem.userId,
          // Reabre: a pessoa voltou a falhar depois de já ter sido resolvida.
          resolvido_em: null,
        })),
        { onConflict: "competencia,codigo_rh" },
      );
    };

    /** Quem entrou agora deixa de constar como pendência. */
    const marcarResolvidos = async (codigos: string[]) => {
      if (!codigos.length) return;
      await supabase.from("folha_recusas")
        .update({ resolvido_em: new Date().toISOString() })
        .eq("competencia", `${competencia}-01`)
        .in("codigo_rh", codigos)
        .is("resolvido_em", null);
    };

    /* ---------- corrigir o que já está lá ---------- */

    /* Conserta título que JÁ existe, sem recriá-lo.
     *
     * Existe por dois defeitos dos títulos criados até 27/08/2026: saíram sem
     * `numero_documento` (e por isso procurar "FOLHA" na tela do Omie não
     * devolvia nada) e com a chave PIX do espelho do RH, que difere da do
     * cadastro na PONTUAÇÃO — `48.521.982/0001-93` contra `48521982000193`. É
     * a mesma chave para quem lê, e é divergência para quem compara literal.
     *
     * Recriar resolveria os dois, mas alguns desses títulos já têm NFS-e
     * anexada à mão por gente do financeiro, e apagar levaria isso junto.
     *
     * O bloco CNAB vai INTEIRO, e não só o campo torto: a documentação do Omie
     * não diz se `AlterarContaPagar` mescla ou substitui, e um bloco pela
     * metade pode zerar o resto dele. Fora do CNAB não vai nada — nem valor,
     * nem data, nem categoria —, que é o que limita o estrago se a semântica
     * for a que eu não espero. Por isso também aceita `codigos`: corrija UM,
     * confira no ERP, depois mande os cem. */
    if (acao === "corrigir") {
      const resultados: Record<string, unknown>[] = [];
      for (const t of titulos) {
        const payload = montarTituloFolha(t);
        try {
          await omieCall("AlterarContaPagar", {
            codigo_lancamento_integracao: t.integracao,
            numero_documento: payload.numero_documento,
            cnab_integracao_bancaria: payload.cnab_integracao_bancaria,
          });
          resultados.push({ integracao: t.integracao, nome: t.nome, corrigido: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          /* "não existe" aqui é normal: corrigir roda sobre o lote inteiro, e
             quem ainda não foi criado não tem o que corrigir. */
          const naoExiste = /não\s*(existe|foi\s*encontrad)|inexistente|not\s*found/i.test(msg);
          if (!naoExiste) console.error(`folha-omie-enviar corrigir [${t.integracao}]:`, msg);
          resultados.push({
            integracao: t.integracao, nome: t.nome,
            corrigido: false, ausente: naoExiste, erro: naoExiste ? undefined : msg,
          });
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return json({
        status: "ok", acao, competencia,
        corrigidos: resultados.filter((r) => r.corrigido).length,
        ausentes: resultados.filter((r) => r.ausente).length,
        resultados: resultados.filter((r) => !r.ausente),
      });
    }

    /* ---------- enviar ---------- */
    /* A recusa do MÊS (marco, estado, chave do código, CNPJ repetido) foi
     * calculada antes do degrau de cadastro, que precisava dela para não
     * escrever numa folha que não vai ser enviada. Aqui ela só decide.
     *
     * Ela NÃO olha o preparo de cada um: isso virou `semPreparo`, é anotado e a
     * pessoa é pulada — uma pessoa com cadastro errado não segura a folha de
     * outras cem. */
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
    /* Quem não está preparado é ANOTADO e pulado — não derruba o lote.
     *
     * Antes isto devolvia 409 e ninguém era criado: uma pessoa com o cadastro
     * errado segurava a folha de outras cem, que é exatamente o contrário do
     * que a tela promete no botão "Provisionar os N prontos". A trava que
     * importa continua de pé: a competência só é marcada como enviada se nada
     * ficou para trás. */
    await gravarRecusas(semPreparo.map((p) => ({
      codigo: p.codigo, nome: p.nome, integracao: p.integracao,
      origem: "preparo", motivo: p.falta,
    })));
    if (!titulos.length) {
      return json({
        status: "erro",
        erro: semPreparo.length
          ? `Ninguém está pronto para enviar. ${semPreparo.length} pendência(s): `
            + semPreparo.slice(0, 5).map((s) => `${s.nome} (${s.falta})`).join(", ")
            + (semPreparo.length > 5 ? "…" : "")
          : "Não há ninguém no lote desta competência.",
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

    /* O registro do que aconteceu, para sobreviver ao fechar da aba. */
    const porIntegracao = new Map(titulos.map((t) => [t.integracao, t]));
    await gravarRecusas(falharam.map((r) => ({
      codigo: porIntegracao.get(r.integracao)?.codigo ?? "",
      nome: r.nome,
      integracao: r.integracao,
      origem: "omie",
      motivo: r.erro ?? "recusado sem motivo informado",
    })).filter((l) => l.codigo));
    await gravarRecusas(restantes.map((t) => ({
      codigo: t.codigo, nome: t.nome, integracao: t.integracao,
      origem: interrompido?.motivo === "bloqueio" ? "bloqueio" : "tempo",
      motivo: interrompido?.motivo === "bloqueio"
        ? `o Omie bloqueou a API por consumo — tente de novo em `
          + `${Math.ceil((interrompido.segundos ?? 0) / 60)} minuto(s)`
        : "o lote parou no teto de tempo antes de chegar nesta pessoa — reenvie",
    })));
    await marcarResolvidos(
      criados.map((r) => porIntegracao.get(r.integracao)?.codigo ?? "").filter(Boolean),
    );

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
      /* O DEGRAU DE CADASTRO, contado à parte dos títulos. Um envio em que
         quatro pessoas entraram porque o Hub criou o fornecedor delas é um
         desfecho diferente de um envio em que quatro já estavam prontas — e a
         diferença é o que diz se a tela ainda precisa mandar alguém ao ERP. */
      cadastro_de_fornecedor: cadastroFornecedor.length
        ? {
          criados: cadastroFornecedor.filter((c) => c.acao === "criar" && c.escreveu).length,
          pix_gravado: cadastroFornecedor.filter((c) => c.acao === "alterar_pix" && c.escreveu).length,
          ja_existiam: cadastroFornecedor.filter((c) => c.acao === "ja_ok").length,
          /* Só os que de fato PARARAM. O bloqueio por PIX divergente segue em
             frente pagando com a chave do ERP — contá-lo aqui faria a resposta
             anunciar uma pendência que não existe. */
          bloqueados: cadastroFornecedor.filter((c) => c.acao === "bloqueado" && !c.resolvido).length,
          destravados: cadastroFornecedor.filter((c) => c.resolvido).length,
          com_erro: cadastroFornecedor.filter((c) => c.erro).length,
          interrompido: cadastroInterrompido,
          resultados: cadastroFornecedor,
        }
        : null,
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
