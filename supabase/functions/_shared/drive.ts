// Download de arquivos do Google Drive via gateway de conectores do Lovable.
//
// Mesmo esquema que sheets-mirror / proporcionais-sheet já usam para o Sheets:
//   Authorization: Bearer <LOVABLE_API_KEY>       ← chave do projeto no Lovable
//   X-Connection-Api-Key: <GOOGLE_DRIVE_API_KEY>  ← chave da CONEXÃO com o Google
//
// Atenção: a conexão de Sheets NÃO serve aqui. São conectores diferentes, com escopos
// diferentes — o de Sheets lê células, e não entrega o binário de um arquivo. É preciso
// conectar o Google Drive no Lovable e guardar a chave dele no secret GOOGLE_DRIVE_API_KEY.

// O slug do conector é `google_drive` — descoberto empiricamente, porque a documentação
// do Lovable não publica isso. As sondas provaram:
//   • /googledrive/* e /drive/*  → 400 "connector_type_mismatch" (a credencial é de OUTRO
//     tipo, logo esses slugs existem mas não são o nosso);
//   • /google-drive/*            → 404 "connector_not_found" (não existe);
//   • /google_drive/*            → 404 com o HTML de erro DO GOOGLE — ou seja, o gateway
//     encaminhou de verdade para o Google. A rota do conector está certa; o que estava
//     errado era o caminho DEPOIS dela (/about não é o que ele expõe).
//
// Como o mapeamento do prefixo também não é documentado, testamos os candidatos com uma
// sonda que usa a capacidade central do conector (listar arquivos), e não /about — que
// pode simplesmente não estar no escopo concedido.
import { segredosDoGmail, tokenDeAcesso } from "./gmail.ts";

const PREFIXOS_CANDIDATOS = [
  "https://connector-gateway.lovable.dev/google_drive/v3",
  "https://connector-gateway.lovable.dev/google_drive",
  "https://connector-gateway.lovable.dev/google_drive/v3/drive/v3",
  "https://connector-gateway.lovable.dev/google_drive/drive/v3",
];

/** Sonda barata: lista 1 arquivo. Só depende da credencial, não de um arquivo específico. */
const SONDA = "/files?pageSize=1&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true";

let baseOk: string | null = null;

/** Qual prefixo o gateway aceitou (para o diagnóstico dizer o que funcionou). */
export const baseDoDrive = (): string | null => baseOk;

/** Quais secrets existem. Booleano apenas — o valor da chave nunca sai daqui. */
export const statusDrive = (): { lovable: boolean; drive: boolean } => ({
  lovable: !!Deno.env.get("LOVABLE_API_KEY"),
  drive: !!Deno.env.get("GOOGLE_DRIVE_API_KEY"),
});

export const driveConfigurado = (): boolean => {
  const s = statusDrive();
  return s.lovable && s.drive;
};

/**
 * Extrai o ID do arquivo de uma URL do Drive. Cobre os formatos que aparecem no banco:
 *   https://drive.google.com/file/d/<ID>/view
 *   https://drive.google.com/open?id=<ID>
 *   https://drive.google.com/uc?export=download&id=<ID>
 */
export function extrairIdDrive(url: string): string | null {
  const u = String(url ?? "");
  if (!/drive\.google\.com|docs\.google\.com/i.test(u)) return null;
  const porPath = u.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (porPath) return porPath[1];
  const porQuery = u.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (porQuery) return porQuery[1];
  return null;
}

/** Começa com HTML? É a tela de login do Google, não o arquivo. */
export function ehHtml(bytes: Uint8Array): boolean {
  const cab = new TextDecoder().decode(bytes.subarray(0, 64)).trim().toLowerCase();
  return cab.startsWith("<!doctype html") || cab.startsWith("<html");
}

export interface ArquivoDrive {
  bytes: Uint8Array;
  nome: string;
  mime: string;
}

export class ErroDrive extends Error {
  constructor(readonly status: number, readonly corpo: string, msg: string) {
    super(msg);
  }
}

function chaves(): { lovable: string; drive: string } {
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  const drive = Deno.env.get("GOOGLE_DRIVE_API_KEY");
  if (!lovable) throw new Error("LOVABLE_API_KEY não configurada nos secrets do Supabase.");
  if (!drive) {
    throw new Error(
      "GOOGLE_DRIVE_API_KEY não configurada. Conecte o Google Drive no Lovable e guarde a chave da conexão nesse secret " +
      "(a chave do Sheets não serve — é outro conector).",
    );
  }
  return { lovable, drive };
}

async function chamar(base: string, path: string, init: RequestInit = {}): Promise<Response> {
  const { lovable, drive } = chaves();
  return await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${lovable}`,
      "X-Connection-Api-Key": drive,
      ...(init.headers || {}),
    },
  });
}

/**
 * Descobre qual prefixo do gateway o Drive atende, usando a SONDA (listar 1 arquivo) —
 * que só depende da credencial, nunca de um arquivo específico. Roda uma vez e memoriza.
 *
 * Se nenhum responder, o erro carrega o status e o corpo de CADA tentativa. Foi assim que
 * descobrimos o slug: os corpos distinguem "conector não existe" de "credencial de outro
 * tipo" de "o gateway encaminhou e quem recusou foi o Google".
 */
async function descobrirBase(): Promise<string> {
  if (baseOk) return baseOk;

  const tentativas: string[] = [];
  for (const base of PREFIXOS_CANDIDATOS) {
    try {
      const res = await chamar(base, SONDA);
      if (res.ok) {
        baseOk = base;
        return base;
      }
      const corpo = (await res.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " ");
      tentativas.push(`${base.replace("https://connector-gateway.lovable.dev", "")} → ${res.status} ${corpo}`);
    } catch (e) {
      tentativas.push(`${base} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new ErroDrive(404, tentativas.join(" | "), `Nenhum prefixo do gateway respondeu. Tentativas: ${tentativas.join(" | ")}`);
}

async function gw(path: string, init: RequestInit = {}, retries = 3): Promise<Response> {
  const base = await descobrirBase();

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await chamar(base, path, init);
    if (res.ok) return res;

    const corpo = (await res.text().catch(() => "")).slice(0, 400);

    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await new Promise((r) => setTimeout(r, Math.min(8000, 600 * 2 ** attempt)));
      continue;
    }

    // NÃO interpretamos o status aqui. Com a base já validada por /about, um 404 significa
    // "o arquivo não existe ou a conta conectada não o enxerga" — o Drive usa 404, e não
    // 403, para o que você não pode ver. Quem chama decide (ver baixarDoDrive).
    lastErr = new ErroDrive(res.status, corpo, `Drive [${res.status}]: ${corpo || res.statusText}`);
    throw lastErr;
  }
  throw lastErr;
}

/**
 * Confere se o conector responde e, se der, diz qual conta Google está conectada.
 *
 * O e-mail é BÔNUS: `/about` pode não estar no escopo concedido ao conector, e isso não
 * é motivo para considerar o Drive quebrado — o que importa é conseguir listar/ler
 * arquivos. Se o /about falhar, seguimos com a conta "(desconhecida)".
 */
export async function sondarDrive(): Promise<{ email: string; nome: string }> {
  await descobrirBase();   // lança se nenhum prefixo responder — este é o teste de verdade

  try {
    const res = await gw(`/about?fields=user`);
    const j = await res.json().catch(() => ({}));
    return {
      email: String(j?.user?.emailAddress ?? "(desconhecida)"),
      nome: String(j?.user?.displayName ?? ""),
    };
  } catch {
    return { email: "(desconhecida)", nome: "" };
  }
}

/**
 * Metadados (nome, tipo e TAMANHO) — usados para nomear o anexo no Omie e para
 * recusar o arquivo grande demais antes de baixá-lo.
 *
 * `size` vem do Drive como string de bytes e NÃO existe para documento Google
 * nativo (que não tem binário) — por isso `tamanho` é `null` quando falta, e
 * quem chama trata ausência como "não sei", nunca como zero.
 */
async function metadados(id: string): Promise<{ nome: string; mime: string; tamanho: number | null }> {
  const res = await gw(`/files/${id}?fields=name,mimeType,size&supportsAllDrives=true`);
  const j = await res.json().catch(() => ({}));
  const bruto = Number(j?.size ?? NaN);
  return {
    nome: String(j?.name ?? "comprovante"),
    mime: String(j?.mimeType ?? ""),
    tamanho: Number.isFinite(bruto) && bruto > 0 ? bruto : null,
  };
}

/** A recusa por tamanho, escrita uma vez só — os dois caminhos do Drive usam. */
export const erroDeTamanho = (bytes: number, teto: number): Error =>
  new Error(
    `Arquivo de ${(bytes / 1048576).toFixed(1)} MB — acima do limite de ${(teto / 1048576).toFixed(0)} MB ` +
    "para anexar automaticamente. Costuma ser foto em resolução cheia: reenviar o comprovante " +
    "como PDF (ou uma foto menor) resolve, e aí ele sobe na próxima rodada.",
  );

/** Mensagem de um 404 já com a base validada: é acesso ao arquivo, não rota. */
async function semAcesso(): Promise<string> {
  const quem = await sondarDrive().then((u) => u.email).catch(() => null);
  const conta = quem && quem !== "(desconhecida)" ? ` (${quem})` : "";
  return `A conta do Google conectada ao Lovable${conta} não tem acesso a este arquivo. ` +
    `Compartilhe a pasta dos comprovantes com ela, ou conecte a conta dona dos arquivos.`;
}

/**
 * A conta conectada consegue LER este arquivo? Só metadados — não baixa o conteúdo.
 *
 * Existe para o preview não prometer o que não pode cumprir: antes, um item do Drive era
 * liberado só porque o conector estava configurado, e o erro só aparecia no envio.
 */
export async function podeLerNoDrive(idOuUrl: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const id = extrairIdDrive(idOuUrl);
  if (!id) return { ok: false, erro: "O link não é um arquivo do Google Drive." };

  if (!driveConfigurado()) return await podeLerPublico(id);

  try {
    const m = await metadados(id);
    if (m.mime.startsWith("application/vnd.google-apps")) {
      return { ok: false, erro: `É um documento Google nativo (${m.mime}), não um arquivo anexável.` };
    }
    return { ok: true };
  } catch (e) {
    const publico = await podeLerPublico(id);
    if (publico.ok) return publico;
    if (e instanceof ErroDrive && e.status === 404) return { ok: false, erro: await semAcesso() };
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * O link público abre? Pede só o primeiro KB — o bastante para saber se vem binário ou a
 * página de "peça acesso". Barato o suficiente para rodar sobre a lista inteira do preview.
 */
export async function podeLerPublico(idOuUrl: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const id = extrairIdDrive(idOuUrl) ?? String(idOuUrl).trim();
  try {
    const res = await fetch(
      `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
      { redirect: "follow", headers: { Range: "bytes=0-1023" } },
    );
    if (!res.ok && res.status !== 206) return { ok: false, erro: `Drive público respondeu ${res.status}.` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return { ok: false, erro: "O Drive devolveu um arquivo vazio." };
    if (ehHtml(bytes)) return { ok: false, erro: "O link não está compartilhado como \"qualquer pessoa com o link\"." };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Baixa pelo link PÚBLICO — sem conector, sem chave, sem conta conectada.
 *
 * Por que existe: os comprovantes que a auditoria recebe são links "qualquer pessoa com o
 * link" (`/file/d/<ID>/view`) colados na planilha pelo próprio gestor. Para ESSES, o
 * conector do Lovable é um intermediário caro que só atrapalha — enquanto ele não está
 * configurado, o arquivo continua público e baixável. Foi assim que a transcrição dos 40
 * comprovantes que faltavam rodou pelo navegador.
 *
 * O endpoint é o `drive.usercontent.google.com/download`, e não o velho `uc?export=download`:
 * o antigo responde 200 com a PÁGINA de aviso de vírus para arquivos maiores, e teríamos
 * que garimpar o token de confirmação no HTML. Com `confirm=t` o novo entrega o binário
 * direto. Se ainda assim vier HTML, o arquivo não é público — e aí é erro de verdade.
 */
export async function baixarPublicoDoDrive(
  idOuUrl: string,
  opts: { maxBytes?: number } = {},
): Promise<ArquivoDrive> {
  const id = extrairIdDrive(idOuUrl) ?? String(idOuUrl).trim();
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) throw new Error("O link não é um arquivo do Google Drive.");

  const res = await fetch(
    `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
    { redirect: "follow" },
  );
  if (!res.ok) {
    throw new ErroDrive(res.status, "", `Drive público [${res.status}]: ${res.statusText}`);
  }

  // O content-length chega no cabeçalho, antes do corpo: dá para desistir sem
  // ler os megabytes. Abandonar o corpo explicitamente evita deixar o stream
  // pendurado no worker.
  const declarado = Number(res.headers.get("content-length") ?? NaN);
  if (opts.maxBytes && Number.isFinite(declarado) && declarado > opts.maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw erroDeTamanho(declarado, opts.maxBytes);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new Error("O Drive devolveu um arquivo vazio.");
  if (ehHtml(bytes)) {
    throw new Error(
      "O Drive devolveu uma página HTML em vez do arquivo — este link não está compartilhado " +
      "como \"qualquer pessoa com o link\". Abra o arquivo no Drive e libere o acesso, ou " +
      "configure o conector (GOOGLE_DRIVE_API_KEY).",
    );
  }

  // O nome vem no content-disposition; o Google usa as duas formas (filename= e filename*=).
  const cd = res.headers.get("content-disposition") ?? "";
  const nome =
    decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? "").trim()) ||
    (cd.match(/filename="([^"]+)"/i)?.[1] ?? "").trim() ||
    `comprovante-${id.slice(0, 8)}.pdf`;

  return { bytes, nome, mime: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0] };
}

/**
 * Baixa o binário com o OAUTH DO financeiro@ — a mesma credencial que lê a caixa
 * (`_shared/gmail.ts`), que já tem escopo `drive.readonly` concedido.
 *
 * POR QUE EXISTE, tendo conector e link público: é o caminho autenticado que NÃO
 * depende do Lovable nem de "qualquer pessoa com o link". Para um arquivo que
 * mora no Drive da empresa e alimenta uma tela todo mês (a planilha de
 * assinaturas), essa é a porta certa — o link público é uma configuração que
 * qualquer pessoa desliga sem saber o que quebra, como se descobriu em
 * 29/08/2026 com a planilha de churn.
 *
 * O TAMANHO VEM ANTES DOS BYTES, pela mesma razão de `baixarDoDrive`: recusar um
 * arquivo grande depois de baixá-lo custa o orçamento do worker inteiro.
 */
export async function baixarComOAuthDoDrive(
  supabase: { from: (t: string) => any },
  idOuUrl: string,
  opts: { maxBytes?: number } = {},
): Promise<ArquivoDrive> {
  const id = extrairIdDrive(idOuUrl) ?? String(idOuUrl).trim();
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) throw new Error("O link não é um arquivo do Google Drive.");

  const token = await tokenDeAcesso(await segredosDoGmail(supabase));
  const cabecalho = { Authorization: `Bearer ${token}` };

  const m = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,size&supportsAllDrives=true`,
    { headers: cabecalho, signal: AbortSignal.timeout(30_000) },
  );
  if (!m.ok) {
    const corpo = (await m.text().catch(() => "")).slice(0, 200);
    /* 404 no Drive é "não posso ver", e não "não existe" — a diferença importa
       para quem vai consertar: o conserto é compartilhar com a conta. */
    throw new ErroDrive(
      m.status, corpo,
      m.status === 404 || m.status === 403
        ? "A conta financeiro@ não enxerga este arquivo no Drive — compartilhe com ela."
        : `Drive [${m.status}]: ${corpo || m.statusText}`,
    );
  }
  const meta = await m.json().catch(() => ({}));
  const bruto = Number(meta?.size ?? NaN);
  const tamanho = Number.isFinite(bruto) && bruto > 0 ? bruto : null;
  if (opts.maxBytes && tamanho && tamanho > opts.maxBytes) throw erroDeTamanho(tamanho, opts.maxBytes);

  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`,
    { headers: cabecalho, signal: AbortSignal.timeout(120_000) },
  );
  if (!r.ok) {
    const corpo = (await r.text().catch(() => "")).slice(0, 200);
    throw new ErroDrive(r.status, corpo, `Drive [${r.status}] ao baixar: ${corpo || r.statusText}`);
  }

  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.length) throw new Error("O Drive devolveu um arquivo vazio.");
  if (ehHtml(bytes)) throw new Error("O Drive devolveu HTML em vez do arquivo (token sem escopo de Drive?).");

  return {
    bytes,
    nome: String(meta?.name ?? `arquivo-${id.slice(0, 8)}`),
    mime: String(meta?.mimeType ?? "application/octet-stream"),
  };
}

/**
 * Baixa o conteúdo binário do arquivo.
 *
 * `supportsAllDrives=true` é necessário quando o arquivo está num Drive compartilhado
 * (unidade de equipe) — sem isso o Google finge que ele não existe e devolve 404.
 *
 * Sem conector configurado (ou quando ele falha), cai no link público. A ordem é essa
 * porque o conector é o único que enxerga arquivo restrito; o público é o que sempre
 * funciona para o que já está compartilhado.
 */
export async function baixarDoDrive(
  idOuUrl: string,
  opts: { maxBytes?: number } = {},
): Promise<ArquivoDrive> {
  const id = extrairIdDrive(idOuUrl) ?? idOuUrl;

  if (!driveConfigurado()) return await baixarPublicoDoDrive(id, opts);

  let meta: { nome: string; mime: string; tamanho: number | null };
  try {
    meta = await metadados(id);
  } catch (e) {
    // Com a base já validada pela sonda, um 404 aqui é ACESSO, não rota: o Drive responde
    // 404 (e não 403) para arquivo que a conta conectada não pode ver. Antes de desistir,
    // tenta o link público: "a conta conectada não vê" não quer dizer "ninguém vê".
    try {
      return await baixarPublicoDoDrive(id, opts);
    } catch (_) {
      if (e instanceof ErroDrive && e.status === 404) throw new Error(await semAcesso());
      throw e;
    }
  }

  // Google Docs/Sheets/Slides nativos não têm binário — teriam que ser exportados. Um
  // comprovante nunca deveria ser um desses; se for, é sinal de que o link está errado.
  if (meta.mime.startsWith("application/vnd.google-apps")) {
    throw new Error(`O link do Drive aponta para um documento Google (${meta.mime}), não para um arquivo anexável.`);
  }

  /* O TAMANHO VEM ANTES DOS BYTES.
   *
   * Medido em 25/08/2026: um comprovante de 9,7 MB na cabeça da fila derrubou
   * CINCO rodadas seguidas do cron com "CPU Time exceeded". O arquivo era
   * recusado — corretamente — pelo teto de quem chama, mas só DEPOIS de baixado
   * e copiado para a memória do worker, e o que sobrava do orçamento não dava
   * para o item seguinte. Um arquivo grande demais parava a fila inteira, e a
   * fila não tinha como saber que era sempre o mesmo culpado.
   *
   * O Drive informa o tamanho no próprio metadado que já buscamos para saber o
   * nome: a recusa passa a custar zero byte.
   */
  if (opts.maxBytes && meta.tamanho && meta.tamanho > opts.maxBytes) {
    throw erroDeTamanho(meta.tamanho, opts.maxBytes);
  }

  const res = await gw(`/files/${id}?alt=media&supportsAllDrives=true`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (!bytes.length) throw new Error("O Drive devolveu um arquivo vazio.");
  // Se a credencial não valer, o Google responde 200 com a PÁGINA DE LOGIN. Sem esta
  // checagem, anexaríamos uma tela de login no Omie com nome de nota fiscal.
  if (ehHtml(bytes)) {
    throw new Error("O Drive devolveu uma página HTML (provavelmente tela de login) em vez do arquivo.");
  }

  return { bytes, nome: meta.nome, mime: meta.mime };
}
