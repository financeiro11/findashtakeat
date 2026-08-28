/* ---------------------------------------------------------------------------
 * A caixa `financeiro@takeat.app`, lida pelo Hub.
 *
 * POR QUE ISTO EXISTE, se os anexos já caíam no Drive: porque a automação que
 * os copiava PAROU em 10/08/2026 e ninguém percebeu. Entre 17 e 25/08 chegaram
 * quatro notas de fornecedor — FRACALOSSI, Exclusive (com XML), Acabamento,
 * Ingram Micro — que não estão em pasta nenhuma. Depender de uma caixa-preta
 * que morre em silêncio é o oposto do que a auditoria existe para fazer.
 *
 * E lendo direto vêm três coisas que o depósito no Drive nunca teve:
 *   • o CORPO do e-mail, onde metade dos fornecedores escreve CNPJ e valor em
 *     texto puro — às vezes melhor do que o anexo;
 *   • o e-mail que traz SÓ LINK (o Bling manda "Visualizar DANFE" e nada mais);
 *   • o histórico anterior a maio/2026, que o depósito nunca cobriu.
 *
 * CREDENCIAIS: OAuth de usuário, com refresh token. Não é service account com
 * delegação — isso exigiria admin do Workspace; aqui basta o dono da caixa
 * consentir uma vez, na `gmail-oauth`. Os três segredos moram em
 * `internal_secrets` (RLS ligado, zero policy: só a service_role lê), o mesmo
 * lugar da chave do Drive — e NUNCA no repositório.
 *
 * ESCOPO SOMENTE LEITURA (`gmail.readonly`). O Hub não marca, não move e não
 * apaga nada: o que ele faz com a caixa é ler.
 * ------------------------------------------------------------------------- */

type Cliente = { from: (t: string) => any };

export type Segredos = { clientId: string; clientSecret: string; refreshToken: string | null };

export async function segredosDoGmail(supabase: Cliente): Promise<Segredos> {
  const { data } = await supabase.from("internal_secrets")
    .select("nome,valor")
    .in("nome", ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]);
  const m = new Map<string, string>((data ?? []).map((r: { nome: string; valor: string }) => [r.nome, r.valor]));

  const clientId = m.get("GMAIL_CLIENT_ID") ?? Deno.env.get("GMAIL_CLIENT_ID") ?? "";
  const clientSecret = m.get("GMAIL_CLIENT_SECRET") ?? Deno.env.get("GMAIL_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET ausentes em internal_secrets");
  }
  return { clientId, clientSecret, refreshToken: m.get("GMAIL_REFRESH_TOKEN") ?? null };
}

/* O access token vale uma hora; o worker é reaproveitado entre chamadas, então
   guardá-lo em módulo poupa uma ida ao Google por rodada. A margem de 60s evita
   o token que expira no meio da varredura. */
let _token: { valor: string; expira: number } | null = null;

export async function tokenDeAcesso(s: Segredos): Promise<string> {
  if (_token && Date.now() < _token.expira - 60_000) return _token.valor;
  if (!s.refreshToken) {
    throw new Error("GMAIL_REFRESH_TOKEN ausente — rode a gmail-oauth e autorize a caixa uma vez");
  }

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: s.clientId,
      client_secret: s.clientSecret,
      refresh_token: s.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    /* `invalid_grant` aqui quer dizer que o refresh token morreu — a pessoa
       revogou o acesso, ou o app ficou em "Testing" no Google Cloud (nesse
       modo o Google mata o token em 7 dias). Publicar o app como "Interno" no
       Workspace resolve de vez, e não precisa de verificação do Google. */
    throw new Error(
      `Gmail OAuth ${r.status}: ${JSON.stringify(j).slice(0, 200)}` +
      (String(j.error ?? "").includes("invalid_grant")
        ? " — o refresh token expirou ou foi revogado; autorize de novo na gmail-oauth"
        : ""),
    );
  }
  _token = { valor: j.access_token, expira: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
  return _token.valor;
}

async function api(token: string, caminho: string): Promise<any> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) throw new Error(`Gmail API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

export type Referencia = { id: string; threadId: string };

/** Uma página de ids. A busca usa a MESMA sintaxe da caixa (`has:attachment …`). */
export async function listar(
  token: string, q: string, pageToken?: string, max = 100,
): Promise<{ ids: Referencia[]; proxima: string | null }> {
  const u = new URLSearchParams({ q, maxResults: String(Math.min(max, 500)) });
  if (pageToken) u.set("pageToken", pageToken);
  const j = await api(token, `messages?${u}`);
  return {
    ids: (j.messages ?? []) as Referencia[],
    proxima: j.nextPageToken ?? null,
  };
}

export type Anexo = { id: string; nome: string; mime: string; tamanho: number };
export type Mensagem = {
  id: string;
  threadId: string;
  data: string | null;
  remetente: string;
  remetenteEmail: string;
  assunto: string;
  corpo: string;
  /** os `href` do HTML, que a limpeza de tags apagaria — ver `hrefsDe` */
  links: string[];
  anexos: Anexo[];
  rotulos: string[];
};

const cabecalho = (h: { name: string; value: string }[], nome: string): string =>
  h.find((x) => x.name.toLowerCase() === nome.toLowerCase())?.value ?? "";

/** base64url do Gmail -> texto. `-` e `_` no lugar de `+` e `/`. */
export function deBase64Url(s: string): Uint8Array {
  const b64 = String(s ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * O corpo e os anexos, descendo a árvore de partes.
 *
 * O MIME de um e-mail é uma árvore, não uma lista: `multipart/mixed` com um
 * `multipart/alternative` dentro (texto e HTML) e os anexos ao lado. Ler só o
 * primeiro nível perde o texto na metade dos e-mails.
 *
 * Prefere `text/plain`; só cai no HTML quando não há alternativa, e aí tira as
 * tags — o que interessa é CNPJ, valor e a chave, que sobrevivem à limpeza.
 */
function percorrer(parte: any, alvo: { texto: string; html: string; anexos: Anexo[] }): void {
  if (!parte) return;
  const mime = String(parte.mimeType ?? "");
  const nome = String(parte.filename ?? "");
  const corpo = parte.body ?? {};

  if (nome && corpo.attachmentId) {
    alvo.anexos.push({
      id: corpo.attachmentId,
      nome,
      mime: mime || "application/octet-stream",
      tamanho: Number(corpo.size ?? 0),
    });
  } else if (mime === "text/plain" && corpo.data) {
    alvo.texto += new TextDecoder().decode(deBase64Url(corpo.data)) + "\n";
  } else if (mime === "text/html" && corpo.data) {
    alvo.html += new TextDecoder().decode(deBase64Url(corpo.data)) + "\n";
  }

  for (const p of parte.parts ?? []) percorrer(p, alvo);
}

const semTags = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();

/**
 * OS ENDEREÇOS QUE A LIMPEZA DO HTML APAGA.
 *
 * `semTags` tira a tag inteira — e o endereço mora DENTRO dela, no `href`. Num
 * e-mail só de HTML, que é o normal de quem emite por gateway, o corpo limpo
 * diz "Visualizar PDF - Baixar XML" e não diz para onde: quando o varredor de
 * links chega, não há mais nada para achar. Medido em 28/08/2026:
 * `link_documento` estava preenchido em 4 linhas de 306 no acervo, e as únicas
 * quatro vinham do e-mail da Davam — o raro que manda `text/plain`.
 *
 * POR QUE NÃO BASTA DEVOLVÊ-LOS DENTRO DO `corpo`, que seria uma linha só:
 * porque o corpo é lido por `lerCorpoDeEmail`, que procura CNPJ e valor nele.
 * Uma URL com catorze dígitos seguidos vira CNPJ (a guarda de fronteira só
 * recusa dígito colado em dígito, e `/file/12345678901234/` passa), e o
 * fornecedor da nota passaria a ser uma empresa que não existe. O endereço vai
 * por FORA, e cabe a quem lê decidir o que fazer com ele.
 *
 * O TETO DE 80 é contra o e-mail de marketing, que tem centenas de links. Quem
 * separa nota de rastreio é `linksDeNota`; aqui só se recolhe.
 */
function hrefsDe(html: string): string[] {
  const achados: string[] = [];
  const vistos = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/gi)) {
    /* `&amp;` EM LAÇO, e não uma passada só: o e-mail da prefeitura de São
       Paulo escreve `?ccm=…&amp;amp;nf=…` — a entidade codificada duas vezes.
       Uma substituição deixa `&amp;` no meio da URL, e o servidor recebe um
       parâmetro chamado "amp;nf". */
    let url = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    for (let i = 0; i < 3 && /&amp;/i.test(url); i++) url = url.replace(/&amp;/gi, "&");
    url = url.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
    if (!/^https?:\/\//i.test(url) || url.length > 900 || vistos.has(url)) continue;
    vistos.add(url);
    achados.push(url);
    if (achados.length >= 80) break;
  }
  return achados;
}

export async function mensagem(token: string, id: string): Promise<Mensagem> {
  const j = await api(token, `messages/${id}?format=full`);
  const h = (j.payload?.headers ?? []) as { name: string; value: string }[];

  const alvo = { texto: "", html: "", anexos: [] as Anexo[] };
  percorrer(j.payload, alvo);

  const de = cabecalho(h, "From");
  const email = de.match(/<([^>]+)>/)?.[1] ?? de.trim();
  const ms = Number(j.internalDate ?? 0);

  return {
    id: j.id,
    threadId: j.threadId,
    data: ms ? new Date(ms).toISOString().slice(0, 10) : null,
    remetente: de.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || email,
    remetenteEmail: email.toLowerCase(),
    assunto: cabecalho(h, "Subject"),
    // O texto puro manda; o HTML é o que sobra quando não há.
    corpo: (alvo.texto.trim() || semTags(alvo.html)).slice(0, 20_000),
    /* Os href saem SEMPRE do HTML, mesmo quando existe texto puro: os dois
       lados do e-mail não são obrigados a trazer os mesmos links, e o que se
       perde aqui não volta. */
    links: hrefsDe(alvo.html),
    anexos: alvo.anexos,
    rotulos: (j.labelIds ?? []) as string[],
  };
}

export async function baixarAnexo(token: string, msgId: string, anexoId: string): Promise<Uint8Array> {
  const j = await api(token, `messages/${msgId}/attachments/${anexoId}`);
  if (!j.data) throw new Error("anexo sem conteúdo");
  return deBase64Url(j.data);
}
