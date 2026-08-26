// _shared/mime.ts
//
// De que TIPO é este arquivo, quando quem o entregou não sabe dizer.
//
// A lição é sempre a mesma e já custou caro três vezes:
//   • o download do Drive responde "application/octet-stream" e um PDF perfeito
//     era recusado com "não sei ler" antes de chegar ao modelo;
//   • em 26/08/2026 um arquivo chamado "HH", sem extensão nenhuma, foi tipado
//     pelo Drive como `text/x-c` e descartado pela comprovantes-drive-sync. Era
//     uma NFC-e boa: Extrabom Praia do Suá, R$ 336,68, 31/03/2026, no cartão
//     corporativo. Ela sumiu da auditoria por causa do palpite do Drive;
//   • no mesmo dia, 196 anexos XML da caixa financeiro@ foram recusados pelo
//     bucket porque o Gmail os declarava ora `text/xml`, ora `application/xml`,
//     ora `application/octet-stream` — três nomes para o mesmo documento.
//
// Daí as duas funções, e a ordem entre elas: a ASSINATURA DOS BYTES não mente e
// ganha de todo mundo; quando ela se cala (XML é texto, não tem assinatura), a
// EXTENSÃO decide; o mime declarado por quem entregou é o último a ser ouvido.

/** O que o arquivo É, lido dos primeiros bytes. `null` quando não há assinatura. */
export function mimeDosBytes(b: Uint8Array): string | null {
  const comeca = (...xs: number[]) => xs.length <= b.length && xs.every((x, i) => b[i] === x);
  if (comeca(0x25, 0x50, 0x44, 0x46)) return "application/pdf";                    // %PDF
  if (comeca(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (comeca(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  // RIFF????WEBP — o tamanho fica nos 4 bytes do meio, que não se conferem.
  if (comeca(0x52, 0x49, 0x46, 0x46) && b.length >= 12 &&
      [0x57, 0x45, 0x42, 0x50].every((x, i) => b[8 + i] === x)) return "image/webp";
  return null;
}

const POR_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  xml: "application/xml",
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** O tipo pela extensão do nome. `null` quando não há extensão conhecida. */
export function mimeDoNome(nome: string): string | null {
  const ext = nome.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext ? POR_EXTENSAO[ext] ?? null : null;
}

/**
 * O tipo que vale, na ordem em que se confia: bytes, extensão, declarado.
 *
 * `bytes` é opcional porque nem sempre se tem o conteúdo na mão na hora de
 * decidir — no upload do anexo de e-mail, por exemplo, o nome basta.
 */
export function tipoQueVale(nome: string, declarado?: string | null, bytes?: Uint8Array): string | null {
  return (bytes && mimeDosBytes(bytes)) || mimeDoNome(nome) || declarado || null;
}
