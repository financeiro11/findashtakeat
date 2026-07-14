// Download de arquivos do Google Drive via gateway de conectores do Lovable.
//
// Mesmo esquema que sheets-mirror / proporcionais-sheet já usam para o Sheets:
//   Authorization: Bearer <LOVABLE_API_KEY>       ← chave do projeto no Lovable
//   X-Connection-Api-Key: <GOOGLE_DRIVE_API_KEY>  ← chave da CONEXÃO com o Google
//
// Atenção: a conexão de Sheets NÃO serve aqui. São conectores diferentes, com escopos
// diferentes — o de Sheets lê células, e não entrega o binário de um arquivo. É preciso
// conectar o Google Drive no Lovable e guardar a chave dele no secret GOOGLE_DRIVE_API_KEY.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_drive/v3";

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

async function gw(path: string, init: RequestInit = {}, retries = 3): Promise<Response> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GOOGLE_DRIVE_API_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada nos secrets do Supabase.");
  if (!GOOGLE_DRIVE_API_KEY) {
    throw new Error(
      "GOOGLE_DRIVE_API_KEY não configurada. Conecte o Google Drive no Lovable e guarde a chave da conexão nesse secret " +
      "(a chave do Sheets não serve — é outro conector).",
    );
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
        ...(init.headers || {}),
      },
    });
    if (res.ok) return res;

    const corpo = (await res.text().catch(() => "")).slice(0, 400);

    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await new Promise((r) => setTimeout(r, Math.min(8000, 600 * 2 ** attempt)));
      continue;
    }

    // NÃO interpretamos o status aqui. Um 404 pode ser "a rota do gateway não existe" OU
    // "o arquivo não existe / a conta conectada não enxerga ele" — a API do Drive usa 404
    // para os dois. Quem chama decide, com o contexto que tem (ver sondarDrive).
    lastErr = new ErroDrive(res.status, corpo, `Drive [${res.status}]: ${corpo || res.statusText}`);
    throw lastErr;
  }
  throw lastErr;
}

/**
 * Confere se o conector responde e diz QUAL conta Google está conectada.
 *
 * É o que separa as duas causas de um 404 ao baixar um arquivo:
 *   • se esta sonda falhar    → a rota do gateway está errada / o Drive não está ligado no projeto;
 *   • se esta sonda funcionar → o conector está OK, e o 404 do arquivo significa que a conta
 *     conectada não tem acesso àquele arquivo (o Drive responde 404, não 403, para o que
 *     você não pode ver).
 */
export async function sondarDrive(): Promise<{ email: string; nome: string }> {
  const res = await gw(`/about?fields=user`);
  const j = await res.json().catch(() => ({}));
  return {
    email: String(j?.user?.emailAddress ?? "(desconhecido)"),
    nome: String(j?.user?.displayName ?? ""),
  };
}

/** Metadados (nome e tipo) — usados para nomear o anexo no Omie. */
async function metadados(id: string): Promise<{ nome: string; mime: string }> {
  const res = await gw(`/files/${id}?fields=name,mimeType&supportsAllDrives=true`);
  const j = await res.json().catch(() => ({}));
  return { nome: String(j?.name ?? "comprovante"), mime: String(j?.mimeType ?? "") };
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
    // 404 aqui quase sempre é acesso, não rota: o Drive responde 404 (e não 403) para
    // arquivo que a conta conectada não pode ver. Dizemos isso em vez de "não existe".
    if (e instanceof ErroDrive && e.status === 404) {
      const quem = await sondarDrive().then((u) => u.email).catch(() => null);
      throw new Error(
        quem
          ? `A conta conectada no Lovable (${quem}) não tem acesso a este arquivo do Drive. ` +
            `Compartilhe a pasta dos comprovantes com ela (ou conecte a conta dona dos arquivos).`
          : `O conector do Google Drive não respondeu (404). Confirme que ele está vinculado a ESTE projeto no Lovable ` +
            `(na tela de conectores, a coluna "Projects" precisa estar em 1, não 0).`,
      );
    }
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
