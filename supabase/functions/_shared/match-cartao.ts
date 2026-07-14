// Casamento lançamento do cartão ↔ movimento financeiro do Omie.
//
// Não existe id compartilhado entre a fatura do cartão e o Omie, então o casamento é
// por VALOR (exato) + DATA (mais próxima, dentro de uma janela) e desempate por
// SEMELHANÇA de texto.
//
// Este módulo é compartilhado de propósito: `omie-match-cartao` usa para gravar a
// CATEGORIA do gasto e `omie-anexar-comprovante` usa para achar o TÍTULO onde o
// comprovante será anexado. Se cada um tivesse sua cópia, o anexo poderia acabar num
// título diferente daquele cuja categoria a tela está mostrando.

export function normalize(s: string): string {
  return (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function similarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na.includes(nb) || nb.includes(na)) return 1;
  const ca = na.replace(/ /g, ""), cb = nb.replace(/ /g, "");
  if (ca.includes(cb) || cb.includes(ca)) return 0.95;
  const ta = new Set(na.split(" ")), tb = new Set(nb.split(" "));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

export function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // dd/mm/aaaa (Omie)
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    return isNaN(d.getTime()) ? null : d;
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/); // aaaa-mm-dd (Supabase)
  if (iso) { const d = new Date(+iso[1], +iso[2] - 1, +iso[3]); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

export function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

const days = (a: Date, b: Date) => Math.abs((a.getTime() - b.getTime()) / 86400000);

export interface OmieItem {
  valor: number;
  dates: Date[];
  /** código da categoria (rateio principal) */
  codigo: string;
  text: string;
  /** nCodTitulo — é ele que o geral/anexo/IncluirAnexo exige */
  codTitulo: string;
  /** só para exibir na confirmação */
  fornecedor: string;
  dataLabel: string;
}

export interface MatchResult {
  codigo: string;
  descricao: string;
  codTitulo: string;
  fornecedor: string;
  dataLabel: string;
  conf: "alta" | "media" | "baixa";
  dias: number;
  sim: number;
}

/** Índice dos movimentos do Omie, pronto para buscar por valor. */
export function indexarMovimentos(movimentos: any[]): Map<number, OmieItem[]> {
  const byValue = new Map<number, OmieItem[]>();
  for (const mov of movimentos) {
    const det = (mov as any)?.detalhes ?? {};
    const valor = Math.abs(toNum(det.nValorTitulo ?? det.nValorMovimento ?? det.nValorPago));
    if (!valor) continue;

    const dates = ["dDtEmissao", "dDtRegistro", "dDtVencimento", "dDtPagamento", "dDtInclusao"]
      .map((k) => parseDate(det[k])).filter(Boolean) as Date[];

    const cats = Array.isArray((mov as any)?.categorias) && (mov as any).categorias.length
      ? (mov as any).categorias
      : [{ cCodCateg: det.cCodCateg, nValor: det.nValorTitulo }];
    // categoria principal = maior parcela do rateio
    const mainCat = [...cats].sort((a, b) => Math.abs(toNum(b.nValor)) - Math.abs(toNum(a.nValor)))[0];
    const codigo = String(mainCat?.cCodCateg ?? "");
    if (!codigo) continue;

    const codTitulo = String(det.nCodTitulo ?? det.cCodIntTitulo ?? "");
    const text = [det.cObs, det.cNumDocFiscal, det.cNumTitulo, det.observacao, det.cCodIntTitulo]
      .filter(Boolean).join(" ");

    const arr = byValue.get(Math.round(valor * 100)) ?? [];
    arr.push({
      valor, dates, codigo, text, codTitulo,
      fornecedor: String(det.cRazaoCliente ?? det.cNomeCliente ?? "").trim(),
      dataLabel: String(det.dDtPagamento ?? det.dDtEmissao ?? det.dDtRegistro ?? ""),
    });
    byValue.set(Math.round(valor * 100), arr);
  }
  return byValue;
}

/**
 * Acha o movimento do Omie que corresponde a um lançamento do cartão.
 * `conf` = "alta" só quando a data bate em até 2 dias E (a descrição bate OU o valor
 * é único no período) — é o único nível em que enviar um anexo sem revisão é seguro.
 */
export function casarComOmie(
  card: { valor: unknown; data?: string | null; estabelecimento?: string | null; descricao_original?: string | null },
  byValue: Map<number, OmieItem[]>,
  codToDesc: Map<string, string>,
  maxDias = 10,
): MatchResult | null {
  const cValor = Math.abs(toNum(card.valor));
  const cData = parseDate(card.data);
  const cText = normalize(`${card.estabelecimento ?? ""} ${card.descricao_original ?? ""}`);
  const cands = byValue.get(Math.round(cValor * 100)) ?? [];

  let best: { cand: OmieItem; dias: number; sim: number } | null = null;
  let bestScore = -Infinity;
  for (const cand of cands) {
    const dd = cData && cand.dates.length ? Math.min(...cand.dates.map((d) => days(cData, d))) : 999;
    if (dd > maxDias) continue;
    const sim = cand.text ? similarity(cText, cand.text) : 0;
    const score = -dd + sim * 10; // prioriza data próxima, com boost por semelhança
    if (score > bestScore) { bestScore = score; best = { cand, dias: dd, sim }; }
  }
  if (!best) return null;

  const conf: MatchResult["conf"] =
    best.dias <= 2 && (best.sim >= 0.5 || cands.length === 1) ? "alta"
      : best.dias <= 7 ? "media"
        : "baixa";

  return {
    codigo: best.cand.codigo,
    descricao: codToDesc.get(best.cand.codigo) || best.cand.codigo,
    codTitulo: best.cand.codTitulo,
    fornecedor: best.cand.fornecedor,
    dataLabel: best.cand.dataLabel,
    conf,
    dias: best.dias,
    sim: Math.round(best.sim * 100) / 100,
  };
}
