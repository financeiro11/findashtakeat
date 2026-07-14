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

    const texto = await res.text().catch(() => "");
    lastErr = new Error(`Drive [${res.status}]: ${texto.slice(0, 300) || res.statusText}`);

    // 404 no gateway costuma significar "esse conector não existe/não está conectado".
    if (res.status === 404) {
      throw new Error(
        `O gateway do Lovable não respondeu ao conector do Google Drive (404). ` +
        `Confirme que o Drive está conectado no Lovable — o conector de Sheets não cobre arquivos.`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Sem permissão no Drive [${res.status}]. Compartilhe a pasta dos comprovantes com a conta Google conectada ao Lovable.`,
      );
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await new Promise((r) => setTimeout(r, Math.min(8000, 600 * 2 ** attempt)));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

/** Metadados (nome e tipo) — usados para nomear o anexo no Omie. */
async function metadados(id: string): Promise<{ nome: string; mime: string }> {
  const res = await gw(`/files/${id}?fields=name,mimeType`);
  const j = await res.json().catch(() => ({}));
  return { nome: String(j?.name ?? "comprovante"), mime: String(j?.mimeType ?? "") };
}

/** Baixa o conteúdo binário do arquivo. */
export async function baixarDoDrive(idOuUrl: string): Promise<ArquivoDrive> {
  const id = extrairIdDrive(idOuUrl) ?? idOuUrl;

  const meta = await metadados(id).catch(() => ({ nome: "comprovante", mime: "" }));

  // Google Docs/Sheets/Slides nativos não têm binário — teriam que ser exportados. Um
  // comprovante nunca deveria ser um desses; se for, é sinal de que o link está errado.
  if (meta.mime.startsWith("application/vnd.google-apps")) {
    throw new Error(`O link do Drive aponta para um documento Google (${meta.mime}), não para um arquivo anexável.`);
  }

  const res = await gw(`/files/${id}?alt=media`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (!bytes.length) throw new Error("O Drive devolveu um arquivo vazio.");
  // Se a credencial não valer, o Google responde 200 com a PÁGINA DE LOGIN. Sem esta
  // checagem, anexaríamos uma tela de login no Omie com nome de nota fiscal.
  if (ehHtml(bytes)) {
    throw new Error("O Drive devolveu uma página HTML (provavelmente tela de login) em vez do arquivo.");
  }

  return { bytes, nome: meta.nome, mime: meta.mime };
}
