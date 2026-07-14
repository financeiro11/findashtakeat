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

/** Metadados (nome e tipo) — usados para nomear o anexo no Omie. */
async function metadados(id: string): Promise<{ nome: string; mime: string }> {
  const res = await gw(`/files/${id}?fields=name,mimeType&supportsAllDrives=true`);
  const j = await res.json().catch(() => ({}));
  return { nome: String(j?.name ?? "comprovante"), mime: String(j?.mimeType ?? "") };
}

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
  try {
    const m = await metadados(id);
    if (m.mime.startsWith("application/vnd.google-apps")) {
      return { ok: false, erro: `É um documento Google nativo (${m.mime}), não um arquivo anexável.` };
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof ErroDrive && e.status === 404) return { ok: false, erro: await semAcesso() };
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Baixa o conteúdo binário do arquivo.
 *
 * `supportsAllDrives=true` é necessário quando o arquivo está num Drive compartilhado
 * (unidade de equipe) — sem isso o Google finge que ele não existe e devolve 404.
 */
export async function baixarDoDrive(idOuUrl: string): Promise<ArquivoDrive> {
  const id = extrairIdDrive(idOuUrl) ?? idOuUrl;

  let meta: { nome: string; mime: string };
  try {
    meta = await metadados(id);
  } catch (e) {
    // Com a base já validada pela sonda, um 404 aqui é ACESSO, não rota: o Drive responde
    // 404 (e não 403) para arquivo que a conta conectada não pode ver.
    if (e instanceof ErroDrive && e.status === 404) throw new Error(await semAcesso());
    throw e;
  }

  // Google Docs/Sheets/Slides nativos não têm binário — teriam que ser exportados. Um
  // comprovante nunca deveria ser um desses; se for, é sinal de que o link está errado.
  if (meta.mime.startsWith("application/vnd.google-apps")) {
    throw new Error(`O link do Drive aponta para um documento Google (${meta.mime}), não para um arquivo anexável.`);
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
