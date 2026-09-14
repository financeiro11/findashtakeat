/* ---------------------------------------------------------------------------
 * NOTA SEM COBRANÇA — a NFS-e que não nasce de uma cobrança do Asaas.
 *
 * O PEDIDO (14/09/2026): emitir nota avulsa puxando o cliente do Asaas sem ter
 * cobrança lá, e também digitando o tomador inteiro no Hub, sem relação nenhuma
 * com o Asaas.
 *
 * AS DUAS ORIGENS DÃO NO MESMO FORMULÁRIO. "Puxar do Asaas" só PREENCHE; o que
 * sai daqui é sempre um `Tomador` conferido pela mesma régua. Duas réguas — uma
 * para quem veio do Asaas, outra para quem foi digitado — divergiriam no
 * primeiro conserto que alguém esquecesse de repetir.
 *
 * O servidor refaz a conferência (`sem_cobranca_preparar` no `omie-nfse-sync`):
 * guarda de tela vale só para quem passa pela tela.
 * ------------------------------------------------------------------------- */

/** O que cabe no corpo da NFS-e. O Omie recusa `cDescServ` acima disso. */
export const CABE_NA_NOTA = 200;

export interface Tomador {
  doc: string;
  nome: string;
  email: string;
  telefone: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export const TOMADOR_VAZIO: Tomador = {
  doc: "", nome: "", email: "", telefone: "", cep: "", endereco: "", numero: "",
  complemento: "", bairro: "", cidade: "", uf: "",
};

export const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** CPF ou CNPJ com dígito verificador certo. Documento torto vira nota para ninguém. */
export function docValido(doc: string): boolean {
  const d = soDigitos(doc);
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const dv = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const dv = (n: number) => {
      const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const s = pesos.reduce((t, p, i) => t + Number(d[i]) * p, 0);
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
  }
  return false;
}

/**
 * "R$ 1.234,56", "1234,56", "1234.56", "350" → número. `null` quando não é valor.
 *
 * O ponto é ambíguo e a regra é a do teclado brasileiro: com vírgula presente, o
 * ponto é milhar; sem vírgula, um ponto seguido de exatamente três dígitos também
 * é milhar ("1.500" é mil e quinhentos, não um e meio). Errar aqui é nota com o
 * valor mil vezes menor, e nota não se corrige.
 */
export function lerValorBRL(txt: string): number | null {
  const s = String(txt ?? "").replace(/R\$|\s/g, "");
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  let normal: string;
  if (s.includes(",")) normal = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normal = s.replace(/\./g, "");
  else normal = s;
  if ((normal.match(/\./g) ?? []).length > 1) return null;
  const n = Number(normal);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** O cliente do espelho do Asaas (`asaas_cache.dados`) no formato do formulário. */
export function tomadorDoAsaas(d: any): Tomador {
  return {
    doc: soDigitos(d?.cpfCnpj),
    nome: String(d?.name ?? d?.company ?? "").trim(),
    email: String(d?.email ?? "").split(/[,;\s]+/)[0]?.trim() ?? "",
    telefone: soDigitos(d?.mobilePhone ?? d?.phone ?? ""),
    cep: soDigitos(d?.postalCode),
    endereco: String(d?.address ?? "").trim(),
    numero: String(d?.addressNumber ?? "").trim(),
    complemento: String(d?.complement ?? "").trim(),
    bairro: String(d?.province ?? "").trim(),
    cidade: String(d?.cityName ?? "").trim(),
    uf: String(d?.state ?? "").trim().toUpperCase(),
  };
}

/**
 * O formulário no formato de cliente do Asaas — que é o que o cadastro do Omie
 * (`montarCadastro` no `omie-clientes-criar`) já sabe ler. Assim o tomador
 * digitado passa pela MESMA conferência na Receita e nos Correios que todo
 * tomador passa, em vez de ganhar um atalho próprio.
 */
export function tomadorParaAsaas(t: Tomador): Record<string, string> {
  return {
    name: t.nome.trim(),
    cpfCnpj: soDigitos(t.doc),
    email: t.email.trim(),
    mobilePhone: soDigitos(t.telefone),
    postalCode: soDigitos(t.cep),
    address: t.endereco.trim(),
    addressNumber: t.numero.trim(),
    complement: t.complemento.trim(),
    province: t.bairro.trim(),
    cityName: t.cidade.trim(),
    state: t.uf.trim().toUpperCase(),
  };
}

/** Campos que a consulta por documento/CEP pode preencher (o documento não). */
export type CampoConsultado = Exclude<keyof Tomador, "doc">;

/**
 * O que a consulta achou (`consultar_tomador`) sobre o que está no formulário.
 *
 * Duas regras, e as duas protegem o que a pessoa digitou:
 *   • `sobrescrever` só vale para o CNPJ recém-digitado no modo "digitar tudo":
 *     ali a pessoa pediu o preenchimento. Nos outros casos (cliente puxado do
 *     Asaas, CEP) só se preenche BURACO.
 *   • `herdados` são os campos que a consulta ANTERIOR preencheu. Trocar de CNPJ
 *     tem de limpá-los — senão o endereço do cliente de antes fica embaixo do
 *     nome do cliente de agora, que é nota para o tomador errado.
 */
export function mesclarConsulta(
  atual: Tomador,
  achado: Partial<Record<CampoConsultado, string>>,
  opts: { sobrescrever: boolean; herdados?: CampoConsultado[] },
): Tomador {
  const base: Tomador = { ...atual };
  for (const k of opts.herdados ?? []) base[k] = "";
  for (const [k, v] of Object.entries(achado) as Array<[CampoConsultado, string | undefined]>) {
    const valor = String(v ?? "").trim();
    if (!valor || !(k in base) || (k as string) === "doc") continue;
    if (opts.sobrescrever || !base[k].trim()) base[k] = valor;
  }
  return base;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * O que falta para emitir — em frases, não em campos vermelhos soltos.
 *
 * `temCadastroOmie` afrouxa o ENDEREÇO e só ele: quando o documento já tem
 * cadastro no Omie, a nota sai para o cadastro de lá (o Hub não escreve por cima
 * de cadastro existente), então exigir endereço aqui seria pedir um dado que não
 * vai a lugar nenhum.
 */
export function faltasDaNota(
  f: { tomador: Tomador; valor: string; descricao: string; vencimento: string },
  opts: { temCadastroOmie: boolean },
): string[] {
  const t = f.tomador;
  const faltas: string[] = [];
  if (!docValido(t.doc)) faltas.push("CPF/CNPJ válido do tomador");
  if (t.nome.trim().length < 2) faltas.push("nome do tomador");
  if (!opts.temCadastroOmie) {
    if (!EMAIL.test(t.email.trim())) faltas.push("e-mail do tomador (a prefeitura recusa sem ele)");
    if (soDigitos(t.cep).length !== 8) faltas.push("CEP com 8 dígitos");
    if (!t.endereco.trim()) faltas.push("logradouro");
    if (!t.numero.trim()) faltas.push("número do endereço (use S/N se não houver)");
    if (!t.bairro.trim()) faltas.push("bairro");
    if (!t.cidade.trim()) faltas.push("cidade");
    if (!/^[A-Za-z]{2}$/.test(t.uf.trim())) faltas.push("UF");
  }
  if (lerValorBRL(f.valor) == null) faltas.push("valor da nota");
  const desc = f.descricao.replace(/\s+/g, " ").trim();
  if (desc.length < 3) faltas.push("descrição do serviço");
  if (desc.length > CABE_NA_NOTA) faltas.push(`descrição com até ${CABE_NA_NOTA} caracteres`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.vencimento)) faltas.push("vencimento");
  return faltas;
}
