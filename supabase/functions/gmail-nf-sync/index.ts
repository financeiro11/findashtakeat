// Edge Function: gmail-nf-sync
//
// Lê a caixa `financeiro@` e transforma em nota fiscal da auditoria o que chega
// por e-mail — anexo e corpo.
//
// POR QUE NÃO BASTA A PASTA DO DRIVE (que a `comprovantes-drive-sync` já lê):
// aquele depósito é feito por uma automação de fora, que PAROU em 10/08/2026
// sem avisar ninguém. Quatro notas de fornecedor entre 17 e 25/08 não existem
// em pasta nenhuma. Além disso, o depósito só guarda ARQUIVO — e três coisas
// valiosas não são arquivo:
//   • o CORPO do e-mail, onde metade dos fornecedores escreve CNPJ e valor em
//     texto puro (a FRACALOSSI escreve os dois; o anexo é só a confirmação);
//   • o e-mail que traz SÓ LINK — o Bling manda "Visualizar DANFE" e nada mais;
//   • o histórico anterior a maio/2026, que o depósito nunca cobriu.
//
// A DIVISÃO DE TRABALHO é a mesma das outras esteiras: aqui só se BAIXA e
// EXTRAI; quem casa é o Postgres (`notas_externas_casar`), e quem manda ao ERP
// é a `omie-anexar-comprovante`, depois de alguém clicar.
//
// O QUE ELE NÃO FAZ: escrever na caixa. O escopo é `gmail.readonly` — não
// marca, não move, não apaga. O rastro do que foi lido é `email_mensagens`.
//
// Body: { action?: 'sync' | 'previa', dias?: number, limite?: number, consulta?: string,
//         reler?: boolean }
// Cron: header `x-cron-token`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { baixarAnexo, listar, mensagem, segredosDoGmail, tokenDeAcesso, type Anexo, type Mensagem } from "../_shared/gmail.ts";
import { tipoQueVale } from "../_shared/mime.ts";
import { textoDePdf } from "../_shared/pdf.ts";
import {
  chaveDeAcesso, dadosDaChave, descricaoDaNota, ehAvisoDeCobranca, lerCorpoDeEmail, lerDanfes, lerEmailOmie,
  linksDeNota, lerNomeDeArquivo, lerXmlFiscal, tipoDoDocumento, type TipoDocumento,
} from "../_shared/nota-fiscal.ts";
import { comprovanteEmailPdf } from "../_shared/danfse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
const CNPJ_TAKEAT = "37511891000150";
/** Teto de relógio. O worker morre sem devolver relatório; melhor parar antes. */
const ORCAMENTO_MS = 55_000;
/** Acima disto o anexo não sobe ao Omie de qualquer jeito (o teto de lá é 8 MB). */
const MAX_ANEXO = 10 * 1024 * 1024;

const EXT_OK = /\.(pdf|xml|jpe?g|png|webp)$/i;

/**
 * A ASSINATURA DO REMETENTE NÃO É UM DOCUMENTO.
 *
 * O Outlook e o Gmail mandam as imagens embutidas na assinatura como anexos de
 * verdade, com os nomes que eles mesmos inventam: `image001.png`, `logotipo.jpg`,
 * `outlook-abc123.png`. Elas passavam por `EXT_OK` (são png), viravam linha em
 * `notas_externas` e — o pior — HERDAVAM O VALOR lido no corpo da mensagem.
 *
 * Medido em 27/08/2026: 250 documentos assim no acervo, R$ 1,43 M de valor
 * fantasma. Os R$ 2,17 M que fevereiro exibia eram doze cópias do mesmo e-mail
 * da Baptista Luz, seis delas logotipos de R$ 102.000 cada — e ninguém percebeu
 * porque o acervo contava documentos, nunca dinheiro.
 *
 * A GUARDA É A CHAVE DE ACESSO. Um emissor pode, em tese, nomear a nota de
 * qualquer jeito; se o nome tiver os 44 dígitos com DV válido, é nota e entra —
 * a mesma inversão que `_shared/nota-fiscal.ts` já faz para o Bling, que despeja
 * um MD5 como nome de arquivo.
 */
const DECORACAO = /^(image|imagem|logo(tipo|marca)?|assinatura|signature|outlook|inline)[-_ ]?[0-9a-f]*\.(jpe?g|png|webp|gif)$/i;
const ehDecoracao = (nome: string) => DECORACAO.test(nome.trim()) && !chaveDeAcesso(nome);

/** O link que abre a mensagem na caixa — serve quando não há arquivo nenhum. */
const linkDoEmail = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`;

/* -------------------------------------------------------------------------
 * O que é documento fiscal, e o que é ruído
 * ---------------------------------------------------------------------- */

/**
 * A caixa tem 8.398 mensagens na entrada e 13.007 só de cobrança a cliente.
 * A busca do Gmail traz o que TEM ANEXO; quem decide o que é nota é isto aqui,
 * onde dá para testar e para explicar por que uma mensagem entrou.
 *
 * Três provas, em ordem de força:
 *   1. chave de acesso (no corpo ou no nome do anexo) — identidade, com DV;
 *   2. CNPJ de terceiro + valor em reais no corpo;
 *   3. o nome do anexo dizendo que é nota/boleto/recibo;
 *   4. um LINK de documento no corpo OU nos `href` do HTML — quem manda "Segue
 *      o Link da Nota Fiscal" está entregando a nota, só que por endereço. Sem
 *      esta prova o e-mail da Davam (que fatura a BuzzLead) era descartado como
 *      recado, e com ele a nota de nove títulos abertos. Os `href` entram junto
 *      porque num e-mail só de HTML o endereço não está no corpo limpo — ver
 *      `hrefsDe` em `_shared/gmail.ts`.
 *   5. o QUADRO do e-mail de emissão do Omie, que é a nota escrita em texto.
 *      Ele não deixa link nem anexo, e a prova nº 2 não o alcança porque o
 *      valor vem à americana (`Valor da Nota R$ 12000.00`) — ver `lerEmailOmie`.
 *
 * Sem nenhuma delas, a mensagem fica registrada em `email_mensagens` com
 * `fiscal = false` — visível, e fora da auditoria. Registrar o descarte é o que
 * permite descobrir, depois, o fornecedor cujo formato ninguém previu.
 */
function ehFiscal(m: Mensagem, corpo: ReturnType<typeof lerCorpoDeEmail>): boolean {
  if (corpo.chave) return true;
  if (lerEmailOmie(m.corpo)) return true;
  if (corpo.cnpj && corpo.valor) return true;
  if (linksDeNota(m.corpo, m.links).length) return true;
  const nomes = m.anexos.map((a) => a.nome).join(" ");
  if (m.anexos.some((a) => chaveDeAcesso(a.nome))) return true;
  const tipo = tipoDoDocumento(`${nomes} ${m.assunto}`);
  return tipo === "nota" || tipo === "boleto" || tipo === "recibo";
}

type Achado = {
  nome: string | null;
  cnpj: string | null;
  valor: number | null;
  data: string | null;
  chave: string | null;
  tipo: TipoDocumento;
  descricao: string | null;
  lido_como: string;
};

/** Lê o anexo pelo que ele é: XML é campo, PDF é texto, o resto é o nome. */
async function lerAnexo(a: Anexo, bytes: Uint8Array): Promise<Achado> {
  const doNome = lerNomeDeArquivo(a.nome);
  const tipo = tipoDoDocumento(a.nome);

  if (a.mime.includes("xml") || /\.xml$/i.test(a.nome)) {
    const inicio = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 120));
    const latin = /encoding\s*=\s*["'](?:iso-8859-1|latin1|windows-1252)["']/i.test(inicio);
    const x = lerXmlFiscal(new TextDecoder(latin ? "iso-8859-1" : "utf-8").decode(bytes), CNPJ_TAKEAT);
    if (x) {
      return {
        nome: x.emitente, cnpj: x.cnpj, valor: x.valor, data: x.data, chave: x.chave,
        tipo: "nota", lido_como: "xml",
        descricao: [x.emitente, x.numero ? `NF ${x.numero}` : null].filter(Boolean).join(" · ") || a.nome,
      };
    }
  }

  if (a.mime === "application/pdf" || /\.pdf$/i.test(a.nome)) {
    /* PDF escaneado ou quebrado — sobra o nome e o corpo do e-mail. PDF com
       senha é tentado com as conhecidas primeiro; ver `_shared/pdf.ts`. */
    const texto = (await textoDePdf(bytes)).texto;
    const danfes = lerDanfes(texto);
    if (danfes.length) {
      return {
        nome: danfes.map((d) => d.emitente).join(" + "),
        cnpj: danfes[0].cnpjEmitente,
        valor: danfes.map((d) => d.valor).find((v) => !!v) ?? null,
        data: danfes.find((d) => d.data)?.data ?? null,
        chave: danfes[0].chave ?? doNome.chave,
        tipo: "nota", lido_como: "danfe",
        descricao: danfes.map((d) => descricaoDaNota(d, 60)).join(" · ").slice(0, 180),
      };
    }
    /* PDF sem DANFE legível NÃO vai para o OCR aqui, de propósito: quem tem o
       orçamento de OCR (e a fila, e o teto por rodada) é a esteira do Drive. O
       que este caminho garante é o CNPJ pela chave e pelo corpo — que é a chave
       forte do casamento. Se um dia faltar valor demais, o OCR entra depois. */
    return {
      nome: null, cnpj: doNome.cnpj, valor: doNome.valor, data: doNome.data,
      chave: doNome.chave, tipo, lido_como: "nome_arquivo",
      descricao: doNome.descricao ?? a.nome,
    };
  }

  return {
    nome: null, cnpj: doNome.cnpj, valor: doNome.valor, data: doNome.data,
    chave: doNome.chave, tipo, lido_como: "nome_arquivo",
    descricao: doNome.descricao ?? a.nome,
  };
}

/** O corpo completa o anexo — nunca o contrário, e nunca inventa. */
function juntar(a: Achado, corpo: ReturnType<typeof lerCorpoDeEmail>, m: Mensagem): Achado {
  const chave = a.chave ?? corpo.chave;
  const daChave = dadosDaChave(chave);
  return {
    ...a,
    chave,
    cnpj: a.cnpj ?? corpo.cnpj ?? daChave?.cnpj ?? null,
    valor: a.valor ?? corpo.valor,
    data: a.data ?? corpo.data ?? m.data,
    /* Quem emitiu, na ordem em que se confia: o documento (XML e DANFE trazem
       o nome em campo próprio), depois o quadro do e-mail, e só então quem
       mandou a mensagem — que num gateway é "Nota Gateway", não o fornecedor. */
    nome: a.nome ?? corpo.nome ?? m.remetente,
    descricao: a.descricao ?? m.assunto,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "gmail-nf-sync").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const previa = body?.action === "previa";
    const dias = Math.min(Math.max(Number(body?.dias ?? 30), 1), 3650);
    const limite = Math.min(Math.max(Number(body?.limite ?? 12), 1), 40);

    const s = await segredosDoGmail(supabase);
    const token = await tokenDeAcesso(s);

    /* ---------- 1. o que a caixa tem ----------
       Duas buscas de propósito. A primeira é larga (tudo com anexo) porque
       adivinhar a palavra que o fornecedor usou no assunto é como o filtro
       erra; quem decide o que é nota é `ehFiscal`, em código testável. A
       segunda pega o e-mail que fala de nota e NÃO traz arquivo — o do Bling,
       que manda só o link. */
    const consultas: string[] = body?.consulta ? [String(body.consulta)] : [
      `has:attachment newer_than:${dias}d -in:sent -in:draft -in:trash`,
      `-has:attachment (danfe OR "nota fiscal" OR nfs-e OR nfe) newer_than:${dias}d -in:sent -in:draft -in:trash`,
    ];

    const vistos: string[] = [];
    for (const q of consultas) {
      let pageToken: string | undefined;
      let paginas = 0;
      do {
        const { ids, proxima } = await listar(token, q, pageToken, 100);
        vistos.push(...ids.map((x) => x.id));
        pageToken = proxima ?? undefined;
      } while (pageToken && ++paginas < 10);
    }
    const unicos = [...new Set(vistos)];

    /* ---------- 2. o que já foi lido ---------- */
    const conhecidos = new Set<string>();
    for (let i = 0; i < unicos.length; i += 300) {
      const { data } = await supabase.from("email_mensagens")
        .select("gmail_id").in("gmail_id", unicos.slice(i, i + 300));
      for (const r of data ?? []) conhecidos.add(r.gmail_id as string);
    }
    /* `reler` existe para quando a LEITURA muda, não a caixa: ao ensinar o
       varredor a enxergar algo novo no corpo (foi o caso do link da nota), as
       mensagens já lidas continuariam com a leitura velha para sempre, porque
       elas nunca mais voltam para a fila. */
    const reler = body?.reler === true;
    const novos = reler ? unicos : unicos.filter((id) => !conhecidos.has(id));

    if (previa) {
      return json({
        ok: true, previa: true, consultas,
        na_caixa: unicos.length, ja_lidos: conhecidos.size, novos: novos.length,
      });
    }

    /* ---------- 3. ler, guardar o arquivo, extrair ---------- */
    const inicio = Date.now();
    const linhasEmail: Record<string, unknown>[] = [];
    const linhasNota: Record<string, unknown>[] = [];
    let lidas = 0, comNota = 0, semArquivo = 0, ignoradas = 0, falhas = 0, parou = 0;
    const agora = new Date().toISOString();

    for (const [i, id] of novos.slice(0, limite).entries()) {
      if (Date.now() - inicio > ORCAMENTO_MS) { parou = Math.min(novos.length, limite) - i; break; }
      try {
        const m = await mensagem(token, id);
        const corpo = lerCorpoDeEmail(m.corpo, CNPJ_TAKEAT);
        const fiscal = ehFiscal(m, corpo);
        lidas++;

        const base = {
          gmail_id: m.id, thread_id: m.threadId, data: m.data,
          remetente: m.remetente, remetente_email: m.remetenteEmail, assunto: m.assunto,
          anexos: m.anexos.map((a) => ({ nome: a.nome, mime: a.mime, tamanho: a.tamanho })),
          corpo_chave: corpo.chave, corpo_cnpj: corpo.cnpj, corpo_valor: corpo.valor,
          corpo_data: corpo.data, fiscal, lido_em: agora, erro: null as string | null,
        };

        if (!fiscal) { linhasEmail.push(base); ignoradas++; continue; }

        const uteis = m.anexos.filter(
          (a) => EXT_OK.test(a.nome) && a.tamanho <= MAX_ANEXO && !ehDecoracao(a.nome),
        );
        if (!uteis.length) {
          /* A NOTA QUE VEIO COMO QUADRO, E NÃO COMO ARQUIVO.
           *
           * O e-mail de emissão do Omie — o mesmo template para todo fornecedor
           * que emite por lá — traz emitente, CNPJ, número, valor, código de
           * verificação, emissão e parcelas em texto rotulado, e manda um botão
           * para o Portal Omie no lugar do anexo.
           *
           * O BOTÃO NÃO DÁ ARQUIVO, e isso foi MEDIDO em 28/08/2026, não suposto:
           *   • `portal.omie.com.br/view/…` devolve 3 KB de HTML vazio — é uma
           *     SPA — e a API dela, `portalapi.omie.com.br/api/portal/payment/
           *     <data>/<hash>`, responde 403 `recaptcha_challenge_required`;
           *   • aberta num navegador de verdade (Firecrawl, 7 créditos gastos
           *     entre proxy de datacenter e residencial), a página renderiza
           *     "reCAPTCHA requer verificação" nos DOIS casos, e atrás disso
           *     ainda pede "os 5 primeiros dígitos do CNPJ do destinatário";
           *   • o outro link do e-mail vai a `nfse.gov.br/ConsultaPublica?chave=`,
           *     que pede hCaptcha, e a API do ADN exige certificado (403/496 —
           *     já registrado no cabeçalho de `_shared/danfse.ts`).
           * São freios antiautomação de terceiro, e a resposta a eles é parar.
           * O caminho que RESOLVE de vez é humano: pedir a estes cinco
           * fornecedores que anexem o PDF/XML ao e-mail — esta função já lê
           * anexo, e o XML é o melhor documento que a esteira recebe.
           *
           * Então o papel se desenha do que o e-mail escreveu — e se chama pelo
           * que é, comprovante de emissão, com a chave e o QR que levam à nota
           * na fonte. Ver `_shared/danfse.ts`. São 101 mensagens paradas assim
           * na caixa, de cinco fornecedores; a Victoria Partners sozinha tem
           * nove títulos e R$ 101.358 com um anexo só entre eles.
           *
           * SÓ A ENTREGA VIRA PAPEL. O aviso de vencimento e o lembrete repetem
           * o MESMO quadro, campo por campo — e sem esta guarda a primeira
           * rodada gerou 97 comprovantes para ~30 notas, seis deles idênticos
           * para a NFS-e 927, todos disputando um título só. O recado segue pelo
           * caminho de baixo, sem arquivo, como sempre foi. */
          const omie = lerEmailOmie(m.corpo);
          if (omie?.entrega && omie.numero && omie.cnpj) {
            const parcela = omie.parcelas[0] ?? null;
            const emitente = omie.emitente ?? m.remetente;
            const bytes = await comprovanteEmailPdf({
              emitente, cnpj: omie.cnpj, numero: omie.numero, chave: omie.chave,
              emissao: omie.emissao, valor: omie.valor,
              inscricaoMunicipal: omie.inscricaoMunicipal, rps: omie.rps,
              ordemServico: omie.ordemServico, parcelas: omie.parcelas,
              tomador: { nome: "TAKEAT TECNOLOGIA LTDA", cnpj: CNPJ_TAKEAT },
              origem:
                `Reproduzido pela Central do Financeiro a partir do e-mail "${m.assunto}", ` +
                `enviado por ${m.remetenteEmail} em ${m.data ?? "data desconhecida"} para financeiro@takeat.app. ` +
                `O emitente nao anexou arquivo: o link do e-mail leva ao Portal Omie, que exige captcha.`,
            });
            /* O CAMINHO É DA NOTA, não da mensagem: se o Omie reenviar a mesma
               emissão, o papel é reescrito no lugar em vez de virar um segundo
               arquivo com o mesmo conteúdo. */
            const caminho = `email/${(omie.emissao ?? m.data ?? agora).slice(0, 7)}/nfse-${omie.cnpj}-${omie.numero}.pdf`;
            const { error: erroUp } = await supabase.storage.from(BUCKET)
              .upload(caminho, bytes, { contentType: "application/pdf", upsert: true });
            if (erroUp) throw new Error(`storage: ${erroUp.message}`);

            linhasEmail.push(base);
            linhasNota.push({
              chave: `email|${m.id}`, fonte: "email", linha: null, ordem: 1,
              /* A EMISSÃO, e não a data do e-mail: o aviso de vencimento chega
                 três semanas depois e jogaria a janela do casador para o mês
                 seguinte. */
              enviado_em: omie.emissao ?? m.data,
              nome: emitente, cnpj: omie.cnpj, documento: omie.numero,
              /* OS DOIS VALORES, e os dois estão certos: R$ 12.000,00 de
                 serviço e R$ 11.262,00 a pagar, quando há imposto retido. O
                 casador tenta os dois (`unnest(array[valor, valor_parcela])`) e
                 é o líquido que vira título no contas a pagar. */
              valor: omie.valor, valor_parcela: parcela?.valor ?? null,
              vencimento: parcela?.vencimento ?? null,
              forma_pagamento: null,
              competencia: omie.emissao?.slice(0, 7) ?? null,
              o_que_e: `NFS-e ${omie.numero} · ${emitente}`,
              detalhe: `${m.remetenteEmail} · comprovante de emissão lido do corpo do e-mail`,
              status_planilha: null, diz_anexado: false,
              drive_id: null, link: caminho, link_documento: null,
              chave_fiscal: omie.chave, tipo_documento: "nota", tem_arquivo: true,
              arquivo_bytes: bytes.length, arquivo_em: agora, arquivo_erro: null,
              visto_em: agora, atualizado_em: agora,
            });
            comNota++;
            continue;
          }

          /* NOTA SEM ARQUIVO. O e-mail diz que a nota existe (chave, CNPJ,
             valor) mas não a manda — é o caso do Bling. Vale registrar assim
             mesmo: casa com o lançamento e diz onde está. `tem_arquivo=false`
             mantém isso fora da fila do ERP, que precisa de um arquivo. */
          semArquivo++;
          linhasEmail.push(base);
          linhasNota.push({
            chave: `email|${m.id}`, fonte: "email", linha: null, ordem: 1,
            enviado_em: corpo.data ?? m.data,
            /* O REMETENTE NÃO É O FORNECEDOR quando a nota vem por gateway.
               As 39 notas do eNotas entraram no acervo assinadas por "Nota
               Gateway" e "eNotas" — GetDemo, ZapSign, ContaAzul, NALK, Hult e
               Reportei viravam todas a mesma empresa na linha do ERP e na busca
               por fornecedor. O nome está escrito no e-mail, colado no CNPJ. */
            nome: corpo.nome ?? m.remetente, cnpj: corpo.cnpj,
            /* O número da NFS-e, que o quadro escreve ("NFS-e No. 1789"). É o
               que alguém digita para achar a nota no portal do emissor. */
            documento: corpo.numero, valor: corpo.valor, valor_parcela: null, forma_pagamento: null,
            competencia: dadosDaChave(corpo.chave)?.competencia ?? null,
            o_que_e: m.assunto, detalhe: `${m.remetenteEmail} · sem arquivo anexado`,
            status_planilha: null, diz_anexado: false,
            drive_id: null, link: linkDoEmail(m.id),
            /* O TIPO NÃO É "nota" POR DECRETO.
               Estava fixo aqui, e o resultado foi 489 linhas sem arquivo TODAS
               gravadas como nota — inflando a biblioteca com 489 documentos que
               não existem. Pelo menos 101 são recado puro: "Aviso de Vencimento
               do Pix da NFS-e", "Lembrete de Fatura vencendo hoje", "Recebemos
               seu pagamento!". Não há arquivo para buscar porque nunca houve.
               `ehAvisoDeCobranca` separa o recado da entrega; o que sobra segue
               como nota faltando, que é o caso do Bling — e esse alguém precisa
               mesmo ir atrás. */
            chave_fiscal: corpo.chave,
            tipo_documento: ehAvisoDeCobranca(m.assunto) ? "outro" : "nota",
            tem_arquivo: false,
            /* O ENDEREÇO DA NOTA, quando o e-mail manda link em vez de arquivo.
               É a metade que faltava do parágrafo acima: "esse alguém precisa
               mesmo ir atrás" virava trabalho de gente para algo que é um GET.
               A Davam (que fatura a BuzzLead) escreve "Segue o Link da Nota
               Fiscal" e o link responde 200 com PDF, sem login. Quem baixa é a
               `nota-baixar-link`; aqui só se guarda o endereço.
               OS `href` VÊM JUNTO desde 28/08/2026: o e-mail do eNotas é só
               HTML, e o endereço do PDF morria dentro da tag antes de qualquer
               regex vê-lo. Eram 39 notas a um GET de distância. */
            link_documento: linksDeNota(m.corpo, m.links)[0] ?? null,
            visto_em: agora, atualizado_em: agora,
          });
          continue;
        }

        for (const [ordem, a] of uteis.entries()) {
          const bytes = await baixarAnexo(token, m.id, a.id);
          const achado = juntar(await lerAnexo(a, bytes), corpo, m);

          /* O arquivo vai para o MESMO bucket privado que o resto da auditoria
             já usa — é de lá que a `omie-anexar-comprovante` sabe baixar, sem
             precisar de conector nenhum. */
          const caminho = `email/${(m.data ?? agora).slice(0, 7)}/${m.id}_${a.nome.replace(/[^\w.\- ]+/g, "_")}`;

          /* O TIPO VEM DO ARQUIVO, NÃO DO QUE O GMAIL DISSE.
             O bucket tem allowlist de mime, e o remetente escolhe o rótulo: o
             MESMO XML de NFS-e chegava ora como `text/xml`, ora como
             `application/xml`, ora como `application/octet-stream`, conforme o
             cliente de e-mail de quem mandou. Como o upload lança, a mensagem
             inteira morria por causa do rótulo — e não do conteúdo.
             Medido em 26/08/2026, na primeira leitura do histórico da caixa:
             234 mensagens recusadas, 104 delas sem gerar nota nenhuma, sendo
             196 anexos XML — justamente o documento de melhor qualidade que
             esta esteira tem, o único onde CNPJ, valor, data e chave vêm em
             campo próprio, sem OCR e sem palpite. */
          const { error: erroUp } = await supabase.storage.from(BUCKET)
            .upload(caminho, bytes, { contentType: tipoQueVale(a.nome, a.mime, bytes) ?? a.mime, upsert: true });
          if (erroUp) throw new Error(`storage: ${erroUp.message}`);

          linhasNota.push({
            chave: `email|${m.id}|${a.id.slice(0, 24)}`, fonte: "email",
            linha: null, ordem: ordem + 1,
            enviado_em: achado.data, nome: achado.nome ?? m.remetente, cnpj: achado.cnpj,
            documento: null, valor: achado.valor, valor_parcela: null, forma_pagamento: null,
            competencia: dadosDaChave(achado.chave)?.competencia ?? null,
            o_que_e: achado.descricao ?? m.assunto,
            detalhe: `${m.remetenteEmail} · ${a.nome} · lido por ${achado.lido_como}`,
            status_planilha: null, diz_anexado: false,
            drive_id: null, link: caminho,
            chave_fiscal: achado.chave, tipo_documento: achado.tipo, tem_arquivo: true,
            visto_em: agora, atualizado_em: agora,
          });
          comNota++;
        }
        linhasEmail.push(base);
      } catch (e) {
        falhas++;
        linhasEmail.push({
          gmail_id: id, thread_id: null, data: null, remetente: null, remetente_email: null,
          assunto: null, anexos: [], corpo_chave: null, corpo_cnpj: null, corpo_valor: null,
          corpo_data: null, fiscal: null, lido_em: agora,
          erro: String((e as Error)?.message ?? e).slice(0, 300),
        });
      }
    }

    /* ---------- 3.5 quem já tem arquivo não volta a ser "sem arquivo" ----------
     *
     * `reler` reescreve a linha inteira pela chave, e a linha sem arquivo diz
     * `tem_arquivo = false` com o `link` apontando para a mensagem no Gmail.
     * Numa releitura isso APAGARIA o arquivo que a `nota-baixar-link` já tinha
     * baixado e guardado no bucket: o acervo perderia o papel sem erro nenhum,
     * o título voltaria a dever nota, e a única pista seria o número da tela
     * mudando sozinho. Quem já tem arquivo mantém o que tem — o que a releitura
     * acrescenta é o `link_documento`, que é o motivo de ela existir.
     */
    const jaTemArquivo = new Map<string, string | null>();
    const chavesNota = linhasNota
      .filter((l) => l.tem_arquivo !== true)
      .map((l) => String(l.chave));
    for (let i = 0; i < chavesNota.length; i += 200) {
      const { data } = await supabase.from("notas_externas")
        .select("chave, link")
        .in("chave", chavesNota.slice(i, i + 200))
        .eq("tem_arquivo", true);
      for (const r of data ?? []) jaTemArquivo.set(r.chave as string, (r.link as string) ?? null);
    }
    let preservadas = 0;
    for (const l of linhasNota) {
      if (l.tem_arquivo === true) continue;
      const link = jaTemArquivo.get(String(l.chave));
      if (link === undefined) continue;
      l.tem_arquivo = true;
      l.link = link;
      preservadas++;
    }

    /* ---------- 4. gravar ---------- */
    for (let i = 0; i < linhasEmail.length; i += 100) {
      const { error } = await supabase.from("email_mensagens")
        .upsert(linhasEmail.slice(i, i + 100), { onConflict: "gmail_id" });
      if (error) throw new Error(`email_mensagens: ${error.message}`);
    }
    for (let i = 0; i < linhasNota.length; i += 100) {
      const { error } = await supabase.from("notas_externas")
        .upsert(linhasNota.slice(i, i + 100), { onConflict: "chave" });
      if (error) throw new Error(`notas_externas: ${error.message}`);
    }

    /* ---------- 5. quem casa é o cron, e não cabia aqui ----------
     *
     * Esta função chamava `notas_externas_casar()` no fim, e era ela quem
     * pintava a faixa do header de vermelho todo dia: HTTP 500 com
     * `casar: canceling statement due to statement timeout`. O casador demora
     * 20 a 27 segundos (medido em `cron.job_run_details` do job 55) e o teto do
     * PostgREST é de 8 — o papel de `authenticator` traz `statement_timeout=8s`
     * e o `service_role` não o levanta.
     *
     * O estrago não era o casamento: `notas-acervo-casar` roda às :00 e às :30
     * direto no Postgres, sem teto nenhum, e refaz o alvo de TUDO que ainda não
     * subiu — inclusive o que acabou de chegar aqui. O estrago era o 500 em
     * cima de um sync que já tinha gravado tudo no passo 4: a leitura da caixa
     * dava certo e a tela dizia que tinha falhado.
     *
     * Insistir custaria 8 segundos de espera e uma consulta pesada abortada a
     * cada hora, para nada. A esteira inteira é assim — cada etapa tem cron
     * próprio e a nota espera a vez —, e esta passa a ser só o que o nome diz:
     * trazer o e-mail para dentro. Ver `_shared/` e o painel /automacoes/painel.
     */
    return json({
      ok: true, na_caixa: unicos.length, novos: novos.length,
      lidas, notas: comNota, sem_arquivo: semArquivo, ignoradas, falhas,
      com_link: linhasNota.filter((l) => l.link_documento).length,
      arquivo_preservado: preservadas,
      restante: Math.max(0, novos.length - lidas), parou_por_tempo: parou,
      casar: linhasNota.length ? "o casador das :00 e :30 pega" : "nada novo para casar",
    });
  } catch (e) {
    console.error("gmail-nf-sync", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
