/* ---------------------------------------------------------------------------
 * Os links entre Governança › Plano de contas e as telas de DRE e DFC.
 *
 * Um lugar só para os dois lados montarem e lerem o mesmo endereço: se a DRE
 * lesse `?mes=` num formato e o plano de contas escrevesse noutro, o link abriria
 * a tela certa na célula errada — ou em nenhuma, sem erro.
 *
 * DOIS FORMATOS DE MÊS convivem no Hub e é aqui que um vira o outro:
 *   • a chave da demonstração é "Aug-26" — mês EM INGLÊS (armadilha conhecida:
 *     "Ago-26" devolve vazio calado);
 *   • o plano de contas trabalha em "2026-08".
 * ------------------------------------------------------------------------- */

export type TipoDemonstracao = "dre" | "dfc";
export type BaseDemonstracao = "competencia" | "caixa";

const MES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A DRE é por competência, a DFC por caixa — é a mesma régua do plano de contas. */
export const baseDoTipo = (t: TipoDemonstracao): BaseDemonstracao => (t === "dre" ? "competencia" : "caixa");
export const tipoDaBase = (b: BaseDemonstracao): TipoDemonstracao => (b === "competencia" ? "dre" : "dfc");

const CHAVE = /^([A-Za-z]{3})-(\d{2})$/;

/** "2026-08" → "Aug-26". Uma chave já no formato da demonstração passa direto. */
export function chaveDoMes(mes: string): string {
  if (CHAVE.test(mes)) return mes;
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) return mes;
  return `${MES_EN[Number(m[2]) - 1]}-${m[1].slice(2)}`;
}

/** "Aug-26" → "2026-08". Aceita o mês em português por engano ("Ago-26"). */
export function mesDaChave(chave: string): string | null {
  const m = CHAVE.exec(chave);
  if (!m) return null;
  const pt = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const nome = m[1].toLowerCase();
  let i = MES_EN.findIndex((x) => x.toLowerCase() === nome);
  if (i < 0) i = pt.indexOf(nome);
  if (i < 0) return null;
  return `20${m[2]}-${String(i + 1).padStart(2, "0")}`;
}

const ROTA_PLANO = "/governanca/plano-de-contas";
const ROTA_DEMONSTRACAO: Record<TipoDemonstracao, string> = { dre: "/demonstracoes/dre", dfc: "/demonstracoes/dfc" };

function comParametros(rota: string, pares: [string, string | null | undefined][]): string {
  const p = new URLSearchParams();
  for (const [k, v] of pares) if (v) p.set(k, v);
  const q = p.toString();
  return q ? `${rota}?${q}` : rota;
}

/** Abre o plano de contas numa categoria, num departamento ou na conferência de uma rubrica. */
export function linkPlanoContas(o: {
  categoria?: string | null;
  departamento?: string | null;
  base?: BaseDemonstracao;
  visao?: "conferencia";
  rubrica?: string | null;
}): string {
  return comParametros(ROTA_PLANO, [
    ["visao", o.visao],
    ["categoria", o.categoria],
    ["departamento", o.departamento],
    ["rubrica", o.rubrica],
    ["base", o.base],
  ]);
}

/**
 * Abre a célula da DRE/DFC — o painel de lançamentos — já filtrado nas categorias
 * de onde a pessoa veio. Sem categorias, abre a célula inteira.
 */
export function linkCelula(o: { tipo: TipoDemonstracao; rubrica: string; mes: string; categorias?: string[] }): string {
  return comParametros(ROTA_DEMONSTRACAO[o.tipo], [
    ["rubrica", o.rubrica],
    ["mes", chaveDoMes(o.mes)],
    ["categoria", o.categorias?.filter(Boolean).join(",")],
  ]);
}

export type AlvoDaUrl = { rubrica: string; mes: string; categorias: string[] };

/** O que a DRE/DFC precisa para abrir a célula pedida no endereço. Nulo se o link está incompleto. */
export function lerAlvoDaUrl(p: URLSearchParams): AlvoDaUrl | null {
  const rubrica = p.get("rubrica")?.trim();
  const mesBruto = p.get("mes")?.trim();
  if (!rubrica || !mesBruto) return null;
  const mes = mesDaChave(chaveDoMes(mesBruto));
  if (!mes) return null;
  const categorias = (p.get("categoria") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  return { rubrica, mes: chaveDoMes(mes), categorias };
}

/** O endereço sem o pedido de célula — para recarregar a página não reabrir o painel. */
export function limparAlvoDaUrl(p: URLSearchParams): URLSearchParams {
  const n = new URLSearchParams(p);
  n.delete("rubrica");
  n.delete("mes");
  n.delete("categoria");
  return n;
}
