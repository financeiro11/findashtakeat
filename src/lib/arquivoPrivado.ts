import { supabase } from "@/integrations/supabase/client";

/**
 * Exibir arquivo que mora em bucket PRIVADO.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE (30/08/2026)
 *
 * `playbook-assets`, `workspace-assets` e `facilities-contratos` eram buckets
 * PÚBLICOS: qualquer pessoa da internet listava as pastas e baixava o arquivo.
 * Foi medido, não suposto — o PDI de uma colaboradora voltou 200 com 34.915
 * bytes para um `curl` sem login. Os três viraram privados na migration
 * `20260831090000`, e este módulo devolve a exibição para quem ESTÁ logado.
 *
 * ---------------------------------------------------------------------------
 * O QUE FICA GRAVADO NÃO MUDA — e este é o ponto do arquivo
 *
 * O `content` do Playbook e do Workspace é JSON do TipTap, com a imagem gravada
 * como `attrs.src = "https://…/object/public/workspace-assets/<pasta>/<arq>"`.
 * Há centenas dessas dentro de páginas já escritas.
 *
 * A tentação é migrar o banco e trocar tudo por URL assinada. Seria errado:
 * **URL assinada expira**. Gravar uma é gravar um link que morre — o documento
 * apodreceria sozinho, com a falha aparecendo semanas depois e longe da causa.
 *
 * Então o que está gravado continua na forma pública. Ela não resolve mais
 * sozinha (o bucket é privado), mas continua sendo o melhor IDENTIFICADOR que
 * existe: carrega bucket e caminho, é estável, e já está lá. Assinar é trabalho
 * de EXIBIÇÃO. Nenhuma linha do banco precisou ser tocada.
 *
 * ---------------------------------------------------------------------------
 * POR ISSO SÃO DOIS SENTIDOS, e faltar o segundo estragaria o banco devagar
 *
 * O editor é o problema: se a página é aberta com as URLs assinadas, o
 * `onChange` do TipTap grava DE VOLTA o que está na tela — ou seja, gravaria a
 * assinatura no banco, e a imagem morreria dez minutos depois. Quem editasse
 * uma página apodreceria as imagens dela sem perceber.
 *
 * Daí o par:
 *   • `assinarConteudo`   — na hora de MOSTRAR
 *   • `normalizarConteudo`— na hora de GRAVAR, desfazendo a assinatura
 *
 * `normalizar` é barato e idempotente, então roda em todo save, inclusive nos
 * que nunca passaram por `assinar`.
 */

/** 10 minutos: tempo de olhar uma página, não de guardar num favorito. */
const TTL_SEGUNDOS = 60 * 10;

/**
 * Quais buckets este módulo assina. Lista fechada de propósito: um `src` que
 * aponta para fora (imagem hotlinkada, gráfico do Google) passa intacto em vez
 * de virar uma tentativa de assinatura que falha.
 */
const BUCKETS = ["playbook-assets", "workspace-assets", "facilities-contratos"] as const;
export type BucketPrivado = (typeof BUCKETS)[number];

const ehBucketNosso = (b: string): b is BucketPrivado => (BUCKETS as readonly string[]).includes(b);

/** Casa as duas formas que aparecem gravadas: `/object/public/…` e `/object/sign/…?token=`. */
const RE_URL_STORAGE = /https?:\/\/[^"'\s)<>]*?\/storage\/v1\/object\/(?:public|sign)\/[^"'\s)<>]+/g;

/** Pega bucket + caminho de uma URL do storage (pública ou já assinada). */
export function partesDoUrl(url: string): { bucket: BucketPrivado; caminho: string } | null {
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/?#]+)\/([^?#]+)/);
  if (!m || !ehBucketNosso(m[1])) return null;
  // O caminho vem percent-encoded na URL; o storage quer ele cru.
  let caminho: string;
  try { caminho = decodeURIComponent(m[2]); } catch { caminho = m[2]; }
  return { bucket: m[1], caminho };
}

/* ============================================================ MOSTRAR */

/**
 * Cache em nível de módulo, com validade um pouco menor que a da assinatura.
 *
 * Sem ele, uma página com trinta imagens dispara trinta assinaturas a cada
 * render — e o React re-renderiza por qualquer motivo. A margem de 30s evita
 * entregar do cache um link que expira no caminho.
 */
const cache = new Map<string, { url: string; ate: number }>();
const MARGEM_MS = 30_000;

/** Uma URL → assinada. Devolve a original quando não é bucket nosso. */
export async function assinarUrl(url: string | null | undefined): Promise<string> {
  if (!url) return "";
  const partes = partesDoUrl(url);
  if (!partes) return url;

  const chave = `${partes.bucket}/${partes.caminho}`;
  const guardado = cache.get(chave);
  if (guardado && guardado.ate > Date.now()) return guardado.url;

  const { data, error } = await supabase.storage
    .from(partes.bucket).createSignedUrl(partes.caminho, TTL_SEGUNDOS);

  // Falhou? Devolve a original. Uma imagem quebrada é melhor que a página
  // inteira caindo por causa de um anexo que alguém apagou do bucket.
  if (error || !data?.signedUrl) return url;

  cache.set(chave, { url: data.signedUrl, ate: Date.now() + TTL_SEGUNDOS * 1000 - MARGEM_MS });
  return data.signedUrl;
}

/**
 * Assina todas as URLs de storage dentro de um texto — serve tanto para HTML
 * quanto para o JSON do TipTap serializado, porque nos dois a URL é só um
 * pedaço de texto entre aspas.
 *
 * Assina em LOTE por bucket (`createSignedUrls`, plural): uma página com vinte
 * imagens seriam vinte viagens de rede em série, e ela apareceria aos pedaços.
 */
export async function assinarTexto(texto: string | null | undefined): Promise<string> {
  if (!texto) return texto ?? "";

  // Sem repetir: a mesma imagem costuma aparecer 2x (miniatura e corpo).
  const achados = new Map<string, { bucket: BucketPrivado; caminho: string }>();
  for (const [url] of texto.matchAll(RE_URL_STORAGE)) {
    if (achados.has(url)) continue;
    const partes = partesDoUrl(url);
    if (partes) achados.set(url, partes);
  }
  if (achados.size === 0) return texto;

  const porBucket = new Map<BucketPrivado, string[]>();
  for (const { bucket, caminho } of achados.values()) {
    const lista = porBucket.get(bucket) ?? [];
    if (!lista.includes(caminho)) lista.push(caminho);
    porBucket.set(bucket, lista);
  }

  const assinadas = new Map<string, string>(); // "bucket/caminho" → assinada
  await Promise.all([...porBucket].map(async ([bucket, caminhos]) => {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(caminhos, TTL_SEGUNDOS);
    for (const item of data ?? []) {
      // `signedUrl` vem null no item que falhou; `path` volta como foi pedido.
      if (item?.path && item.signedUrl) assinadas.set(`${bucket}/${item.path}`, item.signedUrl);
    }
  }));

  let saida = texto;
  for (const [original, { bucket, caminho }] of achados) {
    const nova = assinadas.get(`${bucket}/${caminho}`);
    if (nova) saida = saida.split(original).join(nova);
  }
  return saida;
}

/** O JSON do TipTap com as imagens exibíveis. Só para MOSTRAR — ver o cabeçalho. */
export async function assinarConteudo<T>(doc: T): Promise<T> {
  if (doc == null) return doc;
  const texto = JSON.stringify(doc);
  const assinado = await assinarTexto(texto);
  return assinado === texto ? doc : (JSON.parse(assinado) as T);
}

/* ============================================================= GRAVAR */

/**
 * Devolve uma URL assinada à forma pública canônica. É o que impede o editor de
 * gravar assinatura no banco.
 *
 * Idempotente: URL já pública, ou de fora, sai igual.
 */
export function normalizarUrl(url: string): string {
  const partes = partesDoUrl(url);
  if (!partes) return url;
  const { data } = supabase.storage.from(partes.bucket).getPublicUrl(partes.caminho);
  return data.publicUrl;
}

/** O mesmo, para qualquer texto (HTML ou JSON serializado). */
export function normalizarTexto(texto: string | null | undefined): string {
  if (!texto) return texto ?? "";
  return texto.replace(RE_URL_STORAGE, (url) => normalizarUrl(url));
}

/**
 * O JSON do TipTap pronto para GRAVAR. Roda em todo save — é barato e
 * idempotente, então não custa nada nos saves que nunca viram uma assinatura.
 */
export function normalizarConteudo<T>(doc: T): T {
  if (doc == null) return doc;
  const texto = JSON.stringify(doc);
  const limpo = normalizarTexto(texto);
  return limpo === texto ? doc : (JSON.parse(limpo) as T);
}
