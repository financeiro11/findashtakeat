// Imagens no Assistente: preparar, guardar e reabrir.
//
// Por que este módulo existe fora das telas: o painel do desktop (components/AIAssistant.tsx)
// e a aba do celular (pages/mobile/Chat.tsx) continuam mandando a pergunta cada um pelo seu
// caminho — isso não mudou. O que elas passam a dividir é só o tratamento do ARQUIVO. E é
// justamente aí que mora o erro caro: uma foto de 12 MP colada direto na requisição estoura
// o payload e a pessoa só vê "não foi possível obter resposta".
//
// A imagem faz DUAS viagens, de propósito:
//   1. base64 na requisição — é o que a IA lê. Não fica em lugar nenhum depois.
//   2. arquivo no bucket privado `assistente-imagens` — é o que a conversa reabre e mostra.
// Sem a primeira a IA não vê nada; sem a segunda, reabrir a conversa deixa uma pergunta
// solta sobre uma imagem que sumiu.
//
// Imagem NUNCA vai pelo caminho conferido (`assistente-responder`): as consultas nomeadas
// leem o banco, não figuras. Quem responde é sempre o `ai-chat`, e a resposta é marcada
// como lida da imagem.

import { supabase } from "@/integrations/supabase/client";

export const BUCKET_IMAGENS = "assistente-imagens";

/** Quantas imagens cabem numa pergunta. Mais que isso é álbum, não pergunta. */
export const LIMITE_POR_MENSAGEM = 4;
/** Teto do arquivo ORIGINAL escolhido — depois da redução ele fica muito menor. */
export const TAMANHO_MAX_ARQUIVO = 25 * 1024 * 1024;
/** Quantas imagens do histórico voltam a ser enviadas num acompanhamento. */
export const LIMITE_NO_HISTORICO = 4;

/** 1600px é o suficiente para a IA ler texto de print e nota; acima disso só pesa. */
const LADO_MAX = 1600;
const QUALIDADE = 0.85;
/** Abaixo disto, e já dentro do lado máximo, recomprimir só borra o texto da imagem. */
const JA_PEQUENA = 400 * 1024;

const MIMES_DIRETOS = new Set(["image/jpeg", "image/png", "image/webp"]);
const TTL_ASSINATURA = 60 * 60; // 1h: a conversa é lida na sessão, não guardada

/** Imagem escolhida e pronta para enviar, ainda não gravada. */
export type ImagemAnexada = {
  id: string;
  nome: string;
  mime: string;
  /** base64 puro, sem o prefixo `data:...;base64,` — é o que a IA recebe. */
  base64: string;
  /** `data:` URL para o <img> da tela. */
  previa: string;
};

/** Imagem já pendurada numa mensagem da conversa. */
export type ImagemMsg = {
  /** O que o <img> exibe: `data:` no envio, URL assinada quando vem do histórico. */
  url: string;
  mime: string;
  /** Presente enquanto a imagem está na conversa viva. Reabrindo, vem do bucket. */
  base64?: string;
  /** Caminho no bucket. Ausente se a gravação falhou — a conversa continua, a imagem não. */
  path?: string;
};

type ArquivoBasico = { name: string; type: string; size: number };

export type Triagem<T> = { aceitas: T[]; recusadas: string[] };

/**
 * Decide o que entra antes de qualquer trabalho pesado.
 *
 * Separado do resto porque é a única parte testável sem navegador — e é a que decide o que
 * a pessoa vê quando arrasta a pasta inteira para dentro do painel. Recusar em silêncio
 * seria pior que recusar: o arquivo simplesmente não apareceria e ninguém saberia por quê.
 */
export function triarArquivos<T extends ArquivoBasico>(
  arquivos: T[],
  jaAnexadas = 0,
): Triagem<T> {
  const aceitas: T[] = [];
  const recusadas: string[] = [];
  let vagas = Math.max(0, LIMITE_POR_MENSAGEM - jaAnexadas);

  for (const a of arquivos) {
    if (!a.type?.startsWith("image/")) {
      recusadas.push(`${a.name}: só imagem por enquanto (PNG, JPG, WEBP).`);
      continue;
    }
    if (a.size > TAMANHO_MAX_ARQUIVO) {
      recusadas.push(`${a.name}: acima de ${Math.round(TAMANHO_MAX_ARQUIVO / 1024 / 1024)} MB.`);
      continue;
    }
    if (vagas === 0) {
      recusadas.push(`${a.name}: são no máximo ${LIMITE_POR_MENSAGEM} imagens por pergunta.`);
      continue;
    }
    aceitas.push(a);
    vagas--;
  }
  return { aceitas, recusadas };
}

function idAleatorio(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function lerComoDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    r.readAsDataURL(blob);
  });
}

const semPrefixo = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/**
 * Reduz e converte. Um print de monitor 4K sai daqui com algumas centenas de KB, legível.
 *
 * O fundo branco antes do desenho não é detalhe: PNG com transparência (o print recortado
 * de sempre) vira JPEG com fundo PRETO, e texto escuro em fundo preto some — a IA
 * responderia sobre uma imagem que a pessoa não mandou.
 */
export async function prepararImagem(arquivo: File): Promise<ImagemAnexada> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(arquivo);
  } catch {
    // HEIC do iPhone em navegador de desktop cai aqui.
    throw new Error(`${arquivo.name}: não consegui abrir essa imagem. Salve como JPG ou PNG.`);
  }

  const maiorLado = Math.max(bitmap.width, bitmap.height);
  const cabeInteira =
    maiorLado <= LADO_MAX && arquivo.size <= JA_PEQUENA && MIMES_DIRETOS.has(arquivo.type);

  if (cabeInteira) {
    bitmap.close?.();
    const previa = await lerComoDataUrl(arquivo);
    return {
      id: idAleatorio(), nome: arquivo.name, mime: arquivo.type,
      base64: semPrefixo(previa), previa,
    };
  }

  const escala = Math.min(1, LADO_MAX / maiorLado);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new Error(`${arquivo.name}: este navegador não conseguiu processar a imagem.`);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const previa = canvas.toDataURL("image/jpeg", QUALIDADE);
  return {
    id: idAleatorio(), nome: arquivo.name, mime: "image/jpeg",
    base64: semPrefixo(previa), previa,
  };
}

/** Prepara várias sem que uma quebrada derrube as outras. */
export async function prepararImagens(
  arquivos: File[],
): Promise<{ prontas: ImagemAnexada[]; erros: string[] }> {
  const resultados = await Promise.all(
    arquivos.map((a) => prepararImagem(a).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))))),
  );
  return {
    prontas: resultados.filter((r): r is ImagemAnexada => !(r instanceof Error)),
    erros: resultados.filter((r): r is Error => r instanceof Error).map((e) => e.message),
  };
}

function base64ParaBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Grava no bucket e devolve os caminhos.
 *
 * A pasta é o user_id porque é o que a política do storage confere — arquivo fora dela é
 * recusado. Falha aqui NÃO derruba a pergunta: quem falhou foi o histórico da imagem, não
 * a resposta, e a conversa segue sem ela.
 */
export async function guardarImagens(imagens: ImagemAnexada[]): Promise<string[]> {
  if (imagens.length === 0) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const caminhos = await Promise.all(
    imagens.map(async (img) => {
      const ext = img.mime === "image/png" ? "png" : img.mime === "image/webp" ? "webp" : "jpg";
      const path = `${user.id}/${idAleatorio()}.${ext}`;
      const { error } = await supabase.storage
        .from(BUCKET_IMAGENS)
        .upload(path, base64ParaBlob(img.base64, img.mime), { contentType: img.mime, upsert: false });
      return error ? null : path;
    }),
  );
  return caminhos.filter((c): c is string => !!c);
}

/**
 * Pendura os caminhos numa mensagem JÁ gravada.
 *
 * Em duas etapas de propósito. Se a linha da pergunta só fosse inserida depois do upload,
 * uma foto grande em rede ruim seria gravada DEPOIS da resposta — e a conversa reabriria
 * com o assistente respondendo antes de a pergunta existir. A linha entra na hora; a
 * imagem alcança.
 */
export async function anexarImagens(mensagemId: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.from("ai_messages" as any).update({ imagens: paths }).eq("id", mensagemId);
}

/** Caminhos gravados → imagens exibíveis. Bucket privado: precisa de URL assinada. */
export async function abrirImagens(paths: string[]): Promise<Map<string, ImagemMsg>> {
  const mapa = new Map<string, ImagemMsg>();
  const unicos = [...new Set(paths.filter(Boolean))];
  if (unicos.length === 0) return mapa;

  const { data } = await supabase.storage.from(BUCKET_IMAGENS).createSignedUrls(unicos, TTL_ASSINATURA);
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) {
      mapa.set(item.path, { url: item.signedUrl, mime: "image/jpeg", path: item.path });
    }
  }
  return mapa;
}

/**
 * Deixa o histórico legível para a IA antes de enviar.
 *
 * Duas coisas ao mesmo tempo, e as duas importam:
 *   • imagem reaberta do histórico só tem URL assinada — sem os bytes, o acompanhamento
 *     ("e o total dessa nota?") seria respondido por um modelo que não está vendo nada;
 *   • conversa comprida com print em toda mensagem reenviaria tudo a cada turno, então só
 *     as MAIS RECENTES seguem. As antigas saem da requisição, não da tela.
 */
export async function comImagensLegiveis<T extends { imagens?: ImagemMsg[] }>(
  mensagens: T[],
  limite = LIMITE_NO_HISTORICO,
): Promise<T[]> {
  if (!mensagens.some((m) => (m.imagens?.length ?? 0) > 0)) return mensagens;

  let vagas = limite;
  const deTras = [...mensagens].reverse().map((m) => {
    const imagens = (m.imagens ?? []).slice(0, Math.max(0, vagas));
    vagas -= imagens.length;
    return { ...m, imagens };
  });

  const resolvidas = await Promise.all(
    deTras.map(async (m) => ({
      ...m,
      imagens: await Promise.all(
        m.imagens.map(async (img) => {
          if (img.base64 || !img.path) return img;
          const { data } = await supabase.storage.from(BUCKET_IMAGENS).download(img.path);
          if (!data) return img;
          const url = await lerComoDataUrl(data);
          return { ...img, base64: semPrefixo(url), mime: data.type || img.mime };
        }),
      ),
    })),
  );
  return resolvidas.reverse();
}

/** As imagens de uma mensagem no formato que o `ai-chat` espera. */
export function paraRequisicao(imagens?: ImagemMsg[]): { mimeType: string; data: string }[] {
  return (imagens ?? [])
    .filter((i) => !!i.base64)
    .map((i) => ({ mimeType: i.mime || "image/jpeg", data: i.base64! }));
}
