/**
 * A LEITURA DAS RECUSAS DO OMIE que decidem o destino de um cadastro.
 *
 * O Omie responde em texto livre, e o texto muda sem aviso. Em 16/09/2026 a
 * recusa de documento repetido passou a ser "Cliente já cadastrado para o
 * CPF/CNPJ [..] com o Id [..] e código de integração [..]" — a regex antiga não
 * casava, doze clientes que EXISTIAM viraram `falhou`, voltaram à fila todo dia,
 * e as recusas repetidas renderam o bloqueio de API que travou os outros.
 *
 * Puro e testado (`src/lib/nfse/omieRecusas.test.ts`) porque o erro aqui não
 * aparece como erro: aparece como "o Omie recusou" sobre um cadastro que está lá.
 */

/** O Omie recusou porque o documento já tem cadastro. */
export const ehDocumentoRepetido = (msg: string): boolean =>
  /j[áa] (consta|existe|cadastrad)|already|duplicad|cadastrad[oa] para o (c[óo]digo|cpf|cnpj)/i.test(String(msg));

/**
 * O código do cadastro que já tem o documento. No formato atual o último número
 * entre colchetes é o código de INTEGRAÇÃO, não o do cliente — o `Id [..]`
 * nomeado vem primeiro.
 */
export function codigoNaRecusa(msg: string): number | null {
  const s = String(msg);
  const porId = s.match(/\bId \[(\d{6,})\]/i);
  if (porId) return Number(porId[1]);
  const nums = [...s.matchAll(/(integra[çc][ãa]o )?\[(\d{6,})\]/gi)]
    .filter((m) => !m[1])
    .map((m) => Number(m[2]));
  return nums.length ? nums[nums.length - 1] : null;
}

/**
 * "API bloqueada por consumo indevido" / "Consumo redundante detectado": não é
 * defeito do cadastro, é o Omie pedindo espera. Repetir dentro da janela a
 * reinicia, e o 10º erro no mesmo método tranca por 30 minutos.
 */
export const omiePediuPausa = (msg: string): boolean =>
  /bloquead[ao] por consumo|consumo (indevido|redundante)|redundant/i.test(String(msg));

export const segundosDePausa = (msg: string): number | null =>
  Number(String(msg).match(/(\d+)\s*segundos?/i)?.[1] ?? 0) || null;
