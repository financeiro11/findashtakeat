// _shared/pdf.ts
//
// Extrair o texto de um PDF — inclusive dos que vêm com senha.
//
// POR QUE ISTO EXISTE. Os dois lugares que liam PDF faziam
// `try { getDocumentProxy(bytes) } catch { /* cai no OCR */ }`. O catch mudo
// escondia a única coisa que importava saber: **o arquivo pedia senha**. O
// documento seguia para o OCR do Gemini, que respondia `400 INVALID_ARGUMENT`
// — um erro que parece defeito de OCR e não é.
//
// Medido em 26/08/2026: cinco arquivos travados na fila do Drive por isso, de
// dois emissores que mandam todo mês:
//   • INFORMA MARKETS  — "Boleto.pdf", 19 mensagens na caixa (senha de USUÁRIO)
//   • VERISURE         — "SUA FATURA.PDF", 5 mensagens (senha de DONO)
// Nos dois a senha é a mesma, e é a convenção de boleto no Brasil: **os cinco
// primeiros dígitos do CNPJ de quem paga**. Não é segredo — é o que o emissor
// imprime no corpo do e-mail. Por isso fica no código, e não em
// `internal_secrets`: quem lê este arquivo precisa entender a regra, e a regra
// é o CNPJ da casa.
//
// Se um emissor novo aparecer com outra convenção (CNPJ inteiro, CPF de alguém),
// some à lista — a tentativa é barata e só acontece quando o PDF pede senha.

import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

/** CNPJ da Takeat: 37.511.891/0001-50 — os cinco primeiros dígitos. */
export const SENHAS_PDF = ["37511"];

export type LeituraPdf = {
  /** O texto extraído. Vazio quando o PDF é só imagem (aí o OCR resolve). */
  texto: string;
  /** Qual senha abriu, ou `null` se não precisou de nenhuma. */
  senha: string | null;
  /** Por que não deu, quando não deu. `null` em caso de sucesso. */
  erro: string | null;
};

/**
 * O texto do PDF, tentando as senhas conhecidas se ele pedir.
 *
 * `bytes.slice()` a cada tentativa não é paranoia: o pdf.js pode se apropriar do
 * buffer que recebe, e a segunda tentativa leria um array já esvaziado.
 */
export async function textoDePdf(bytes: Uint8Array): Promise<LeituraPdf> {
  const abrir = async (senha?: string) => {
    const pdf = await getDocumentProxy(bytes.slice(), senha ? { password: senha } : undefined);
    return (await extractText(pdf, { mergePages: true })).text ?? "";
  };

  try {
    return { texto: await abrir(), senha: null, erro: null };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    /* O pdf.js sinaliza senha pela PasswordException, cuja mensagem é
       "No password given" ou "Incorrect Password". Qualquer outro erro aqui é
       PDF quebrado ou só imagem, e quem resolve é o OCR — não adianta insistir. */
    if (!/password/i.test(msg) && (e as { name?: string })?.name !== "PasswordException") {
      return { texto: "", senha: null, erro: msg.slice(0, 200) };
    }
    for (const senha of SENHAS_PDF) {
      try {
        return { texto: await abrir(senha), senha, erro: null };
      } catch { /* senha errada para este emissor — tenta a próxima */ }
    }
    return {
      texto: "",
      senha: null,
      erro: `PDF com senha: nenhuma das ${SENHAS_PDF.length} conhecidas abriu`,
    };
  }
}
