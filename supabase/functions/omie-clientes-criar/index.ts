// Edge Function: omie-clientes-criar
//
// Cadastra no Omie o cliente que só existe no Asaas — para que a nota dele possa
// sair.
//
// O PROBLEMA QUE ISTO FECHA. A fila de emissão casa cobrança com cadastro do
// Omie pelo MESMO CNPJ, com INNER JOIN: cliente que não está lá não entra na
// fila, não entra no log e não aparece em lugar nenhum. Ele não falha, ele some
// (ver a aba Auditoria e `notas_fiscais_auditoria`). Enquanto o Asaas emitiu, o
// buraco ficou tapado por fora; do corte em diante, cada faltante é uma nota que
// não sai. Esta função é o conserto, e o conserto é ESCRITA NO ERP — daí o
// cuidado que segue.
//
// ENDEREÇO É O ASSUNTO, NÃO O NOME. Criar o cadastro é a parte fácil; criar um
// cadastro que a PREFEITURA aceita é a difícil. Das 277 notas presas em status
// 003, 158 pararam em "E0240 — CEP do tomador não existe / não pertence ao
// município" e 24 em código de município errado: dois terços do problema é
// endereço de cliente. Copiar o endereço do Asaas sem conferir seria fabricar a
// mesma fila de notas presas, só que mais rápido. Por isso o endereço vem, nesta
// ordem:
//
//   1. RECEITA (BrasilAPI /cnpj) — a PJ tem endereço oficial, e é o mais
//      coerente com o que a prefeitura valida. Traz de brinde a RAZÃO SOCIAL,
//      que o Asaas não tem: lá o campo `name` é o nome fantasia ("Japamania -
//      Vila Food"), e nota fiscal se emite para a razão social.
//   2. CEP (BrasilAPI /cep) — para pessoa física e para quando a Receita não
//      responde. O CEP manda no município: um CEP pertence a exatamente uma
//      cidade, então quando o Asaas discorda do CEP quem está errado é o Asaas.
//      É EXATAMENTE o par que o E0240 recusa.
//   3. ASAAS puro — só quando as duas consultas caíram (rede), e só se o
//      endereço estiver completo. CEP que a consulta disse NÃO EXISTIR bloqueia:
//      cadastrar sabendo que a prefeitura vai recusar não ajuda ninguém.
//
// QUEM PODE SER CRIADO SOZINHO. A regra mora no Postgres
// (`omie_clientes_a_criar`), e o que ela bloqueia não é burocracia:
// `cadastro_divergente` é o cliente que JÁ existe no Omie sob outro documento
// (mesma raiz de CNPJ = outra filial). Cadastrar ali cria duplicado e emite a
// nota para o tomador errado — pior do que não emitir. Esses só saem com `docs`
// nomeando um a um e `forcar: true`, que é a tela pedindo por decisão humana.
// Nunca em lote.
//
// INCLUIRCLIENTE, E NÃO UPSERTCLIENTE, de propósito. O Upsert do Omie ALTERA o
// cadastro quando encontra o documento — e esta função não tem nada que dizer
// sobre o endereço de um cliente que já existe no ERP. Com IncluirCliente, o
// documento repetido volta como recusa ("já consta no cadastro"), que é
// justamente a resposta certa: o cadastro está lá, o espelho local é que estava
// velho. Isso vira `ja_existia`, não erro.
//
// Ações (body.action):
//   "previa" (default) → a fila, como o Postgres a vê. Não chama Omie nem
//                        Receita e não escreve nada.
//   "criar"            → cadastra de verdade. Params: { de, ate, teto, docs[], forcar }
//   "corrigir"         → remonta o endereço de cadastros QUE ESTA FUNÇÃO CRIOU.
//                        Params: { docs[] }. Não toca em cadastro alheio.
//   "molde"            → o cadastro de um cliente que já emitiu nota, cru. É
//                        diagnóstico: serve para conferir formato de campo do
//                        Omie sem ter de adivinhar (ver `sondar_metodos` na
//                        omie-nfse-sync, mesma ideia).
//
// Auth: usuário logado OU cron (x-cron-token), no padrão do repo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE = "https://app.omie.com.br/api/v1";
const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));
const limpo = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
/** "Vila Velha" → "VILA VELHA". O Omie guarda cidade sem acento e em caixa alta
 *  ("VITORIA (ES)", lido de um cadastro que já emitiu nota) — escrever no mesmo
 *  formato evita depender de o lado de lá normalizar. */
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/* --------------------------------- Omie ----------------------------------- */

/** Envelope RPC do Omie com o backoff de `_shared/omie.ts` para o rate limit.
 *  Reproduzido aqui pelo mesmo motivo da omie-clientes-sync: o módulo
 *  compartilhado tem 354 linhas de anexo/zip/MD5 que esta função não usa. */
async function omieCall(path: string, call: string, param: Record<string, unknown>): Promise<any> {
  const app_key = Deno.env.get("OMIE_APP_KEY");
  const app_secret = Deno.env.get("OMIE_APP_SECRET");
  if (!app_key || !app_secret) {
    throw new Error("Credenciais do Omie ausentes. Configure OMIE_APP_KEY e OMIE_APP_SECRET nos secrets.");
  }
  let ultimo: unknown = null;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
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

    const msg = fault || (typeof data === "string" ? data : JSON.stringify(data));
    ultimo = new Error(String(msg));
    const transitorio = /425|redundante|processando|5020|too many|bloqueada|soap-error|broken response|timeout|50[234]/i.test(String(msg));
    if (transitorio && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 1200 * 2 ** tentativa));
      continue;
    }
    throw ultimo;
  }
  throw ultimo;
}

/** O Omie recusa documento repetido dizendo qual cadastro já o tem. É a resposta
 *  mais útil que ele dá: o cliente existe, e o código dele vem junto. */
function codigoNaRecusa(msg: string): number | null {
  const nums = [...String(msg).matchAll(/\[(\d{6,})\]/g)].map((m) => Number(m[1]));
  return nums.length ? nums[nums.length - 1] : null;
}
const ehDocumentoRepetido = (msg: string) =>
  /j[áa] (consta|existe)|already|duplicad|cadastrado para o c[óo]digo/i.test(String(msg));

/** Bloqueios que nem a decisão de quem olhou destrava — ver o `forcar` na rota. */
const NAO_FORCAVEL = ["documento_invalido", "sem_cliente_no_espelho"];

/* ------------------------------ Receita / CEP ------------------------------ */

type Fonte = "receita" | "cep" | "asaas";

/** Consulta com prazo: BrasilAPI às vezes engasga, e a rodada não pode ficar
 *  presa num cliente. Devolve `null` na falha de rede/tempo e `404` explícito
 *  quando a base respondeu "não existe" — a diferença decide entre seguir com o
 *  que se tem e bloquear o cadastro. */
async function buscaJSON(url: string, ms = 12000): Promise<{ ok: boolean; naoExiste: boolean; dados: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (r.status === 404) return { ok: false, naoExiste: true, dados: null };
    if (!r.ok) return { ok: false, naoExiste: false, dados: null };
    return { ok: true, naoExiste: false, dados: await r.json() };
  } catch {
    return { ok: false, naoExiste: false, dados: null };
  } finally {
    clearTimeout(t);
  }
}

interface Fila {
  id_asaas: string; doc: string; nome: string; pessoa_fisica: boolean;
  email: string | null; telefone: string | null;
  endereco: string | null; endereco_numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; estado: string | null; cep: string | null;
  cobrancas: number; valor: number; ultima: string | null; sem_nota_hoje: number;
  bloqueio: string | null; omie_nome: string | null; omie_doc: string | null; via: string | null;
  situacao_anterior: string | null; motivo_anterior: string | null; tentativas: number;
}

interface Cadastro {
  razao_social: string;
  nome_fantasia: string;
  endereco: string; endereco_numero: string; complemento: string;
  bairro: string; cidade: string; estado: string; cep: string;
  /** Código IBGE do município. É o campo que resolve o E0921/E0922 ("código do
   *  município do tomador"), que prendeu 24 notas: com ele o Omie não precisa
   *  adivinhar a cidade a partir do texto que mandamos. */
  cidade_ibge?: string;
  fonte: Fonte;
  situacao_receita?: string;
}

/**
 * O logradouro completo, a partir do que a Receita separa em dois campos.
 *
 * Ela costuma mandar o tipo à parte (`descricao_tipo_de_logradouro` = "RUA",
 * `logradouro` = "JOSE FARIAS"), e sem juntar os dois a nota sai com o endereço
 * pela metade. MAS NEM SEMPRE: há cadastro em que o tipo já vem dentro do nome,
 * e concatenar cego produziu "RUA RUA MANOEL ROCHA PASSOS" (1 em 27, visto em
 * produção). Por isso a checagem antes de juntar.
 */
function logradouroDaReceita(d: any): string {
  const tipo = limpo(d?.descricao_tipo_de_logradouro).toUpperCase();
  const via = limpo(d?.logradouro);
  if (!via || !tipo) return via;
  const viaUp = via.toUpperCase();
  return viaUp === tipo || viaUp.startsWith(`${tipo} `) ? via : `${tipo} ${via}`;
}

/**
 * O endereço que vai para o cadastro, e de onde ele veio.
 *
 * Devolve `{ bloqueio }` quando o que existe não dá uma nota emitível — e é de
 * propósito que isso interrompe ANTES de escrever no Omie: cadastro ruim no ERP
 * não some, vira duplicado quando alguém arruma na mão.
 */
async function montarCadastro(c: Fila): Promise<{ cadastro?: Cadastro; bloqueio?: string }> {
  const nomeAsaas = limpo(c.nome);

  // 1. RECEITA — só PJ. Endereço oficial + razão social.
  if (!c.pessoa_fisica) {
    const r = await buscaJSON(`https://brasilapi.com.br/api/cnpj/v1/${c.doc}`);
    if (r.naoExiste) {
      // Passou no dígito verificador e a Receita não conhece: o número está
      // errado no Asaas. Cadastrar isso é criar lixo que vira nota recusada.
      return { bloqueio: "cnpj_nao_encontrado_na_receita" };
    }
    const d = r.dados;
    if (r.ok && d && limpo(d.municipio) && soDigitos(d.cep).length === 8) {
      return {
        cadastro: {
          razao_social: limpo(d.razao_social) || nomeAsaas,
          // O nome fantasia do Asaas vence o da Receita: é por ele que a equipe
          // reconhece o cliente na tela do Omie, e é o que o próprio cliente usa.
          nome_fantasia: nomeAsaas || limpo(d.nome_fantasia),
          endereco: logradouroDaReceita(d) || limpo(c.endereco),
          endereco_numero: limpo(d.numero) || limpo(c.endereco_numero) || "S/N",
          complemento: limpo(d.complemento) || limpo(c.complemento),
          bairro: limpo(d.bairro) || limpo(c.bairro),
          cidade: limpo(d.municipio),
          estado: limpo(d.uf).toUpperCase(),
          cep: soDigitos(d.cep),
          cidade_ibge: soDigitos(d.codigo_municipio_ibge) || undefined,
          fonte: "receita",
          situacao_receita: limpo(d.descricao_situacao_cadastral) || undefined,
        },
      };
    }
    // Receita fora do ar ou resposta sem endereço: cai no CEP, abaixo.
  }

  // 2. CEP — quem manda no município. Preenche o que o Asaas deixou em branco.
  const cep = soDigitos(c.cep);
  if (cep.length === 8) {
    const r = await buscaJSON(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    if (r.naoExiste) return { bloqueio: "cep_inexistente" };
    if (r.ok && r.dados) {
      const d = r.dados;
      return {
        cadastro: {
          razao_social: nomeAsaas,
          nome_fantasia: nomeAsaas,
          endereco: limpo(c.endereco) || limpo(d.street),
          endereco_numero: limpo(c.endereco_numero) || "S/N",
          complemento: limpo(c.complemento),
          bairro: limpo(c.bairro) || limpo(d.neighborhood),
          // Cidade e UF do CEP, não do Asaas: é este par que o E0240 confere.
          cidade: limpo(d.city),
          estado: limpo(d.state).toUpperCase(),
          cep,
          cidade_ibge: soDigitos(d?.ibge?.city) || undefined,
          fonte: "cep",
        },
      };
    }
  }

  // 3. ASAAS puro — rede caiu nas duas consultas. Só passa completo.
  const faltando = !limpo(c.endereco) || !limpo(c.cidade) || !limpo(c.estado) || cep.length !== 8;
  if (faltando) return { bloqueio: "endereco_incompleto" };
  return {
    cadastro: {
      razao_social: nomeAsaas,
      nome_fantasia: nomeAsaas,
      endereco: limpo(c.endereco),
      endereco_numero: limpo(c.endereco_numero) || "S/N",
      complemento: limpo(c.complemento),
      bairro: limpo(c.bairro),
      cidade: limpo(c.cidade),
      estado: limpo(c.estado).toUpperCase(),
      cep,
      fonte: "asaas",
    },
  };
}

/* -------------------------------- payload --------------------------------- */

/** "27997456386" → { ddd: "27", numero: "997456386" }. Fora do formato, nada:
 *  telefone é opcional no cadastro e não vale a pena mandar torto. */
function telefoneBR(bruto: string | null): { ddd: string; numero: string } | null {
  const d = soDigitos(bruto);
  if (d.length < 10 || d.length > 11) return null;
  return { ddd: d.slice(0, 2), numero: d.slice(2) };
}

/** "49669589000104" → "49.669.589/0001-04". O Omie guarda o documento pontuado
 *  (lido do cadastro-molde) e é assim que ele volta no ConsultarCliente. */
function docFormatado(d: string): string {
  if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  return d;
}

/**
 * O que vai para o `IncluirCliente`.
 *
 * O molde é um cadastro real que já emitiu nota autorizada (a mesma técnica que
 * a emissão usa para a Ordem de Serviço): dele saiu o formato de cada campo —
 * `cidade` em caixa alta sem acento e com a UF entre parênteses, documento
 * pontuado, `codigo_pais` "1058". Adivinhar formato de campo em escrita fiscal é
 * como se descobre, semanas depois, por que 158 notas ficaram presas.
 */
function payloadOmie(c: Fila, cad: Cadastro): Record<string, unknown> {
  const tel = telefoneBR(c.telefone);
  const p: Record<string, unknown> = {
    // O id do cliente no Asaas vira a chave de integração — mesma ideia do
    // `cCodIntOS` da Ordem de Serviço, que guarda o id da cobrança. É o que
    // permite, depois, saber que este cadastro nasceu daqui e de quem ele é.
    codigo_cliente_integracao: c.id_asaas,
    razao_social: cad.razao_social.slice(0, 60),
    nome_fantasia: (cad.nome_fantasia || cad.razao_social).slice(0, 60),
    cnpj_cpf: docFormatado(c.doc),
    pessoa_fisica: c.pessoa_fisica ? "S" : "N",
    endereco: cad.endereco.slice(0, 60),
    endereco_numero: cad.endereco_numero.slice(0, 10),
    bairro: cad.bairro.slice(0, 40),
    cidade: `${semAcento(cad.cidade).toUpperCase()} (${cad.estado})`,
    estado: cad.estado,
    cep: cad.cep,
    codigo_pais: "1058",
    // "Cliente" é a tag que os cadastros existentes têm. Tag nova poderia ser
    // recusada por não existir no Omie, e a procedência já está no
    // `codigo_cliente_integracao` (o `cus_` do Asaas) e em `omie_clientes_criados`.
    tags: [{ tag: "Cliente" }],
  };
  if (cad.cidade_ibge) p.cidade_ibge = cad.cidade_ibge;
  if (cad.complemento) p.complemento = cad.complemento.slice(0, 40);
  if (c.email) p.email = c.email.slice(0, 100);
  if (tel) { p.telefone1_ddd = tel.ddd; p.telefone1_numero = tel.numero; }
  return p;
}

/* ------------------------------ cache local -------------------------------- */

/**
 * Põe o cliente recém-criado no espelho do cadastro (`omie_cache`/"clientes").
 *
 * Sem isto o cadastro existiria no Omie e a emissão continuaria sem enxergá-lo:
 * o espelho é semanal (segunda, 05h), e a fila lê o espelho, não o Omie. Seria
 * cadastrar hoje para emitir só na semana que vem.
 *
 * `atualizado_em` NÃO é tocado de propósito. Ele responde "quando o cadastro
 * inteiro foi lido do Omie", e a aba Auditoria usa isso para avisar que a lista
 * pode estar velha. Carimbar aqui faria a leitura parecer nova sendo que só umas
 * poucas linhas foram acrescentadas.
 */
async function apendarNoEspelho(supabase: any, novos: { codigo: string; nome: string; cnpj_cpf: string }[]) {
  if (!novos.length) return;
  const { data } = await supabase.from("omie_cache").select("dados").eq("chave", "clientes").maybeSingle();
  const lista: any[] = Array.isArray(data?.dados) ? data.dados : [];
  const jaTem = new Set(lista.map((c: any) => String(c?.codigo)));
  for (const n of novos) if (!jaTem.has(n.codigo)) lista.push(n);
  await supabase.from("omie_cache")
    .update({ dados: lista, registros: lista.length })
    .eq("chave", "clientes");
}

/* --------------------------------- cron ----------------------------------- */

async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "omie-clientes-criar").eq("token", token).maybeSingle();
  return !!data;
}

/* --------------------------------- rota ----------------------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const ehCron = await chamadaDeCron(req, supabase);
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "previa";

    /* -------------------------------- molde -------------------------------- */
    if (action === "molde") {
      const cod = Number(body?.codigo ?? 0);
      if (!cod) return json({ status: "erro", erro: "Informe { codigo } de um cliente do Omie." }, 400);
      const r = await omieCall("geral/clientes", "ConsultarCliente", { codigo_cliente_omie: cod });
      return json({ status: "ok", cadastro: r });
    }

    /* ------------------------------- corrigir ------------------------------ */
    /* Reescreve o endereço de um cadastro QUE ESTA FUNÇÃO CRIOU.
     *
     * A regra de nunca alterar cadastro alheio continua de pé — e é por isso que
     * a busca começa em `omie_clientes_criados` e exige `situacao = 'criado'`:
     * cadastro que já existia no Omie não é assunto daqui, tenha ele o endereço
     * que tiver. O que isto conserta é o nosso próprio erro (um degrau de
     * montagem que mudou) e o dado do cliente que melhorou no Asaas depois. */
    if (action === "corrigir") {
      const docs: string[] = (Array.isArray(body?.docs) ? body.docs : []).map(soDigitos).filter(Boolean);
      if (!docs.length) return json({ status: "erro", erro: "Informe { docs: [...] }." }, 400);

      const { data: alvos } = await supabase
        .from("omie_clientes_criados")
        .select("doc, id_asaas, nome, n_cod_cli")
        .eq("situacao", "criado").in("doc", docs).not("n_cod_cli", "is", null);

      const { data: espelho } = await supabase
        .from("asaas_cache").select("id_asaas, dados")
        .eq("tipo", "customer")
        .in("id_asaas", (alvos ?? []).map((a: any) => a.id_asaas).filter(Boolean));
      const porId = new Map((espelho ?? []).map((c: any) => [c.id_asaas, c.dados]));

      const saida: any[] = [];
      for (const a of alvos ?? []) {
        const d: any = porId.get(a.id_asaas) ?? {};
        const c: Fila = {
          id_asaas: a.id_asaas, doc: a.doc, nome: a.nome ?? "",
          pessoa_fisica: a.doc.length === 11,
          email: d.email ?? null, telefone: d.mobilePhone ?? d.phone ?? null,
          endereco: d.address ?? null, endereco_numero: d.addressNumber ?? null,
          complemento: d.complement ?? null, bairro: d.province ?? null,
          cidade: d.cityName ?? null, estado: d.state ?? null, cep: d.postalCode ?? null,
          cobrancas: 0, valor: 0, ultima: null, sem_nota_hoje: 0,
          bloqueio: null, omie_nome: null, omie_doc: null, via: null,
          situacao_anterior: null, motivo_anterior: null, tentativas: 0,
        };
        const { cadastro, bloqueio } = await montarCadastro(c);
        if (!cadastro) { saida.push({ doc: a.doc, ok: false, motivo: bloqueio }); continue; }

        // A chave da alteração, e só ela: o resto do payload é o cadastro
        // remontado do zero, então o que estiver torto lá é reescrito inteiro.
        const payload = { ...payloadOmie(c, cadastro), codigo_cliente_omie: a.n_cod_cli };
        delete (payload as any).codigo_cliente_integracao;
        try {
          await omieCall("geral/clientes", "AlterarCliente", payload);
          await supabase.from("omie_clientes_criados")
            .update({ payload, fonte_endereco: cadastro.fonte, atualizado_em: new Date().toISOString() })
            .eq("doc", a.doc);
          saida.push({ doc: a.doc, ok: true, endereco: payload.endereco });
        } catch (e) {
          saida.push({ doc: a.doc, ok: false, motivo: e instanceof Error ? e.message : String(e) });
        }
        await dorme(400);
      }
      return json({ status: "ok", corrigidos: saida.filter((s) => s.ok).length, resultados: saida });
    }

    /* -------------------------------- fila --------------------------------- */
    const { data: fila, error } = await supabase.rpc("omie_clientes_a_criar", {
      p_de: body?.de ?? null,
      p_ate: body?.ate ?? null,
      p_limite: 500,
    });
    if (error) throw new Error(`Falha ao montar a fila: ${error.message}`);

    let lista: Fila[] = (fila ?? []) as Fila[];
    const docsPedidos: string[] = Array.isArray(body?.docs) ? body.docs.map(soDigitos).filter(Boolean) : [];
    if (docsPedidos.length) lista = lista.filter((c) => docsPedidos.includes(c.doc));

    if (action === "previa") {
      return json({
        status: "ok",
        total: lista.length,
        livres: lista.filter((c) => !c.bloqueio).length,
        clientes: lista,
      });
    }

    if (action !== "criar") return json({ status: "erro", erro: `Ação desconhecida: ${action}` }, 400);

    /* ------------------------------- criar --------------------------------- */
    // Forçar é a decisão de quem olhou o caso — e ela é sobre UM cliente, nunca
    // sobre a lista. Sem `docs` nomeando quem, `forcar` não vale nada.
    //
    // E há bloqueio que decisão nenhuma destrava: `cadastro_divergente` é uma
    // dúvida ("qual documento é o verdadeiro?") e alguém pode respondê-la;
    // documento que não fecha no dígito verificador não é dúvida, é número
    // errado, e cliente ausente do espelho não tem endereço para mandar.
    const forcar = body?.forcar === true && docsPedidos.length > 0;
    lista = forcar
      ? lista.filter((c) => !NAO_FORCAVEL.includes(c.bloqueio ?? ""))
      : lista.filter((c) => !c.bloqueio);

    const teto = Math.max(1, Math.min(Number(body?.teto ?? 25), 100));
    const restantes = Math.max(0, lista.length - teto);
    const rodada = lista.slice(0, teto);

    const resultados: any[] = [];
    const novosNoEspelho: { codigo: string; nome: string; cnpj_cpf: string }[] = [];
    const origem = ehCron ? "cron" : "tela";

    for (const c of rodada) {
      const registrar = async (
        situacao: string, motivo: string | null,
        extras: Record<string, unknown> = {},
      ) => {
        await supabase.from("omie_clientes_criados").upsert({
          doc: c.doc, id_asaas: c.id_asaas, nome: c.nome,
          situacao, motivo, origem,
          tentativas: (c.tentativas ?? 0) + 1,
          atualizado_em: new Date().toISOString(),
          ...extras,
        }, { onConflict: "doc" });
        resultados.push({ doc: c.doc, nome: c.nome, situacao, motivo, valor: c.valor });
      };

      const { cadastro, bloqueio } = await montarCadastro(c);
      if (!cadastro) {
        await registrar("bloqueado", bloqueio ?? "endereco_incompleto");
        continue;
      }

      const payload = payloadOmie(c, cadastro);
      try {
        const r = await omieCall("geral/clientes", "IncluirCliente", payload);
        const codigo = Number(r?.codigo_cliente_omie ?? 0);
        await registrar("criado", null, {
          n_cod_cli: codigo || null,
          fonte_endereco: cadastro.fonte,
          payload: { ...payload, situacao_receita: cadastro.situacao_receita ?? null },
        });
        if (codigo) {
          novosNoEspelho.push({
            codigo: String(codigo),
            nome: String(payload.nome_fantasia ?? payload.razao_social),
            cnpj_cpf: c.doc,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (ehDocumentoRepetido(msg)) {
          // O cadastro existe — o espelho é que estava velho. Não é erro.
          const codigo = codigoNaRecusa(msg);
          await registrar("ja_existia", msg.slice(0, 400), {
            n_cod_cli: codigo && String(codigo) !== c.doc ? codigo : null,
          });
          if (codigo && String(codigo) !== c.doc) {
            novosNoEspelho.push({ codigo: String(codigo), nome: limpo(c.nome), cnpj_cpf: c.doc });
          }
        } else {
          await registrar("falhou", msg.slice(0, 400), {
            fonte_endereco: cadastro.fonte,
            payload,
          });
        }
      }

      // O Omie tranca por MÉTODO: duas IncluirCliente coladas viram "consumo
      // redundante" e queimam as retentativas do backoff sem necessidade.
      await dorme(400);
    }

    await apendarNoEspelho(supabase, novosNoEspelho);

    const conta = (s: string) => resultados.filter((r) => r.situacao === s).length;
    return json({
      status: "ok",
      criados: conta("criado"),
      ja_existiam: conta("ja_existia"),
      bloqueados: conta("bloqueado"),
      falhas: conta("falhou"),
      restantes,
      resultados,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /autentic|permiss/i.test(msg) ? 401 : 500;
    return json({ status: "erro", erro: msg }, status);
  }
});
