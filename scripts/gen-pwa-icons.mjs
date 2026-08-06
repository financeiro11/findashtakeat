// Gera os ícones do PWA a partir do símbolo da marca (src/assets/takeat-symbol-white.png).
//
// Por que um script e não um PNG commitado à mão: os tamanhos que o manifest declara
// precisam bater com o pixel real do arquivo (o Chrome checa antes de oferecer a
// instalação), e o ícone que existia (`public/apple-touch-icon.png`) é 142×180 com fundo
// transparente — no iOS a transparência vira preto e a proporção quebra. Aqui todos saem
// quadrados, no vermelho da marca, no tamanho exato.
//
// Rodar:  node scripts/gen-pwa-icons.mjs
// Saída:  public/icon-192.png, icon-512.png, icon-512-maskable.png, icon-180.png

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* --takeat-red: 0 78% 47% (src/styles/tokens.css) → #D51A1A */
const FUNDO = [0xd5, 0x1a, 0x1a];

/* ------------------------------- PNG: leitura ------------------------------- */
/** Só o subconjunto que o arquivo de origem usa: 8 bits, RGBA, sem entrelaçamento. */
function lerPNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("não é PNG");
  let pos = 8;
  const idat = [];
  let largura = 0, altura = 0;
  while (pos < buf.length) {
    const tam = buf.readUInt32BE(pos);
    const tipo = buf.toString("ascii", pos + 4, pos + 8);
    const dados = buf.subarray(pos + 8, pos + 8 + tam);
    if (tipo === "IHDR") {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      if (dados[8] !== 8) throw new Error(`profundidade ${dados[8]} não suportada`);
      if (dados[9] !== 6) throw new Error(`color type ${dados[9]} não suportado`);
      if (dados[12] !== 0) throw new Error("PNG entrelaçado não suportado");
    } else if (tipo === "IDAT") idat.push(dados);
    else if (tipo === "IEND") break;
    pos += tam + 12;
  }

  const bruto = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const passo = largura * bpp;
  const px = Buffer.alloc(altura * passo);
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * (passo + 1)];
    const linha = bruto.subarray(y * (passo + 1) + 1, (y + 1) * (passo + 1));
    for (let x = 0; x < passo; x++) {
      const a = x >= bpp ? px[y * passo + x - bpp] : 0;      // esquerda
      const b = y > 0 ? px[(y - 1) * passo + x] : 0;          // acima
      const c = x >= bpp && y > 0 ? px[(y - 1) * passo + x - bpp] : 0; // diagonal
      let v = linha[x];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * passo + x] = v & 0xff;
    }
  }
  return { largura, altura, px };
}

/* ------------------------------- PNG: escrita ------------------------------- */
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(tipo, dados) {
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const saida = Buffer.alloc(corpo.length + 8);
  saida.writeUInt32BE(dados.length, 0);
  corpo.copy(saida, 4);
  saida.writeUInt32BE(crc32(corpo), corpo.length + 4);
  return saida;
}
/** RGB opaco (color type 2) — o ícone é sempre full-bleed, não precisa de alfa. */
function escreverPNG(largura, altura, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const passo = largura * 3;
  const bruto = Buffer.alloc(altura * (passo + 1));
  for (let y = 0; y < altura; y++) {
    bruto[y * (passo + 1)] = 0; // filtro "none"
    rgb.copy(bruto, y * (passo + 1) + 1, y * passo, (y + 1) * passo);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(bruto, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------- composição do ícone --------------------------- */
/** Amostra bilinear da origem RGBA em (fx, fy) contínuos. */
function amostrar(src, fx, fy) {
  const { largura: w, altura: h, px } = src;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const canal = (c) => {
    const p00 = px[(y0 * w + x0) * 4 + c], p10 = px[(y0 * w + x1) * 4 + c];
    const p01 = px[(y1 * w + x0) * 4 + c], p11 = px[(y1 * w + x1) * 4 + c];
    return (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
  };
  return [canal(0), canal(1), canal(2), canal(3)];
}

/**
 * Desenha o símbolo centralizado sobre o fundo da marca.
 * `ocupacao` = fração do lado que o símbolo ocupa (o maskable usa menos, porque o
 * Android recorta até 20% de cada borda).
 */
function compor(src, lado, ocupacao) {
  const rgb = Buffer.alloc(lado * lado * 3);
  for (let i = 0; i < lado * lado; i++) {
    rgb[i * 3] = FUNDO[0]; rgb[i * 3 + 1] = FUNDO[1]; rgb[i * 3 + 2] = FUNDO[2];
  }

  const escala = (lado * ocupacao) / Math.max(src.largura, src.altura);
  const destW = Math.round(src.largura * escala);
  const destH = Math.round(src.altura * escala);
  const offX = Math.round((lado - destW) / 2);
  const offY = Math.round((lado - destH) / 2);

  // Supersampling 2×2: sem isso a borda do símbolo serrilha nos tamanhos pequenos.
  for (let y = 0; y < destH; y++) {
    for (let x = 0; x < destW; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const [sr, sg, sb, sa] = amostrar(src, ((x + dx) / destW) * src.largura, ((y + dy) / destH) * src.altura);
        r += sr; g += sg; b += sb; a += sa;
      }
      r /= 4; g /= 4; b /= 4; a /= 4;
      const alfa = a / 255;
      const i = ((offY + y) * lado + (offX + x)) * 3;
      rgb[i] = Math.round(r * alfa + FUNDO[0] * (1 - alfa));
      rgb[i + 1] = Math.round(g * alfa + FUNDO[1] * (1 - alfa));
      rgb[i + 2] = Math.round(b * alfa + FUNDO[2] * (1 - alfa));
    }
  }
  return escreverPNG(lado, lado, rgb);
}

/* ---------------------------------- main ---------------------------------- */
const simbolo = lerPNG(readFileSync(resolve(raiz, "src/assets/takeat-symbol-white.png")));

const saidas = [
  ["public/icon-192.png", 192, 0.62],
  ["public/icon-512.png", 512, 0.62],
  ["public/icon-512-maskable.png", 512, 0.44], // dentro da zona segura (círculo de 80%)
  ["public/icon-180.png", 180, 0.62],          // apple-touch-icon
];

for (const [arquivo, lado, ocupacao] of saidas) {
  writeFileSync(resolve(raiz, arquivo), compor(simbolo, lado, ocupacao));
  console.log(`${arquivo} · ${lado}×${lado}`);
}
