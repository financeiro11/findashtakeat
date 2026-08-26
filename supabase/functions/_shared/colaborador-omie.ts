/**
 * Colaborador → fornecedor no Omie.
 *
 * Antes de existir título, tem de existir fornecedor: `IncluirContaPagar` quer
 * um `codigo_cliente_fornecedor`, e ele só existe se a PJ da pessoa estiver
 * cadastrada no ERP. Em 26/08/2026, 12 dos 102 do lote da folha não tinham
 * cadastro — quase todos admitidos em agosto.
 *
 * A decisão espelha o switch do fluxo n8n que já faz isto para parceiros:
 *
 *   não existe             → IncluirCliente
 *   existe, sem chave PIX  → AlterarCliente gravando a chave
 *   existe, com chave PIX  → nada a fazer
 *
 * DUAS DIFERENÇAS DELIBERADAS em relação ao fluxo de parceiro:
 *
 * 1. A CHAVE PIX. O fluxo de parceiro grava o CNPJ como chave, porque é a
 *    convenção de lá. O espelho do RH guarda a chave DE VERDADE de cada
 *    pessoa — e ela nem sempre é o CNPJ: aparecem e-mail, CPF e telefone.
 *    Gravar o CNPJ por cima de quem usa e-mail manda o dinheiro para uma chave
 *    que o banco pode nem reconhecer. Aqui a chave do RH vem primeiro, e o
 *    CNPJ é só a reserva de quem não tem nada cadastrado.
 *
 * 2. PIX DIVERGENTE NÃO É SOBRESCRITO. Quando o cadastro do Omie já tem uma
 *    chave e ela difere da do RH, isto aqui NÃO altera nada — devolve o aviso
 *    para uma pessoa decidir. Trocar chave PIX em silêncio é mudar para onde
 *    o salário vai.
 */

export const soDigitos = (s: unknown): string => String(s ?? "").replace(/\D/g, "");

/**
 * É estágio? Estagiário é cadastrado por CPF, não por CNPJ — decidido com o
 * financeiro em 26/08/2026. Vale para o cadastro no Omie, para a chave PIX e
 * para o provisionamento.
 */
export const ehEstagiario = (cargo: unknown): boolean =>
  /estagi/i.test(String(cargo ?? ""));

/** O que o cadastro precisa saber de um colaborador. Espelha `rh_colaboradores`. */
export type ColaboradorParaOmie = {
  /** `codigo` do RH ("COL-003057") — a identidade estável da pessoa. */
  codigo: string;
  nome: string;
  cnpj: string | null;
  razao: string | null;
  /** Chave PIX como o RH cadastrou: pode ser CNPJ, CPF, e-mail ou telefone. */
  pix: string | null;
  /** Cargo. Só serve para saber se é estágio — estagiário usa CPF, não CNPJ. */
  cargo?: string | null;
  /** Data de desligamento ('AAAA-MM-DD'); vazio ou nulo = ativo. */
  datadesl?: string | null;
};

/** Um cadastro do Omie, como `ListarClientes` devolve (só o que importa aqui). */
export type ClienteDoOmie = {
  codigo_cliente_omie: number;
  cnpj_cpf?: string | null;
  razao_social?: string | null;
  dadosBancarios?: { cChavePix?: string | null } | null;
};

export type AcaoDeCadastro = "criar" | "alterar_pix" | "ja_ok" | "bloqueado";

export type DecisaoDeCadastro = {
  codigo: string;
  nome: string;
  acao: AcaoDeCadastro;
  /** Por que está bloqueado, ou o que chamou atenção. */
  motivo?: string;
  /** Preenchido quando a pessoa já existe no Omie. */
  codigoClienteOmie?: number;
  /** A chave que será gravada (em "criar" e "alterar_pix"). */
  chavePix?: string;
};

/**
 * A chave PIX que vale para esta pessoa.
 *
 * Para estagiário, o padrão é o CPF — é o documento dele, e é nele que a
 * empresa paga.
 *
 * A do RH primeiro; o CNPJ só quando não há nada. Note que NÃO normaliza para
 * dígitos: e-mail e chave aleatória são chaves válidas e morreriam nesse
 * filtro. Quem compara chaves para ver se divergem usa `mesmaChavePix`.
 */
export function chavePixDe(p: ColaboradorParaOmie): string {
  const doc = soDigitos(p.cnpj);
  /* Estagiário recebe no CPF, e o CPF é o documento dele. Se o RH tiver posto
     um CNPJ na chave, é engano de cadastro — usar aquilo mandaria o pagamento
     para uma PJ que não é dele. A conferência aponta o engano na tela; aqui o
     que importa é não pagar errado enquanto ninguém arruma. */
  if (ehEstagiario(p.cargo) && doc.length === 11) return doc;

  const doRh = String(p.pix ?? "").trim();
  return doRh || doc;
}

/**
 * Duas chaves são a mesma?
 *
 * Compara sem caixa e sem pontuação para documento, porque o mesmo CNPJ vem
 * escrito de três jeitos entre RH e Omie. Se as duas são só dígitos, compara
 * dígito a dígito; senão, texto normalizado (e-mail não tem dígito nenhum).
 */
export function mesmaChavePix(a: string, b: string): boolean {
  const na = String(a ?? "").trim();
  const nb = String(b ?? "").trim();
  if (!na || !nb) return false;
  const da = soDigitos(na);
  const db = soDigitos(nb);
  if (da && db && da.length >= 11 && db.length >= 11) return da === db;
  return na.toLowerCase() === nb.toLowerCase();
}

/**
 * O que fazer com esta pessoa, dado o que o Omie já tem para o CNPJ dela.
 *
 * `cadastros` é o resultado de `ListarClientes` filtrado pelo CNPJ. Vazio =
 * ninguém cadastrado.
 */
export function decidirCadastro(
  p: ColaboradorParaOmie,
  cadastros: ClienteDoOmie[],
): DecisaoDeCadastro {
  const base = { codigo: p.codigo, nome: p.nome };
  const cnpj = soDigitos(p.cnpj);

  /* Quem já saiu não vira fornecedor.
   *
   * Vale inclusive para quem entrou E saiu no mesmo mês — o caso do Pedro
   * Henrique, que entrou em 03/08/2026 e saiu em 07/08. Ele aparece em
   * "entraram em ago" porque de fato entrou, mas criar cadastro para alguém
   * que já foi embora só enche o Omie de fornecedor morto.
   *
   * O que ele tem a receber não some: rescisão é processo à parte, em
   * /governanca/rescisoes, que calcula as parcelas e controla o pagamento.
   * Esta trava tira a pessoa do CADASTRO da folha, não do dinheiro dela.
   */
  if (String(p.datadesl ?? "").trim()) {
    return {
      ...base,
      acao: "bloqueado",
      motivo: `Desligado em ${String(p.datadesl).slice(0, 10).split("-").reverse().join("/")}`
        + " — rescisão é tratada em Governança › Rescisões.",
    };
  }

  /* Documento válido é CNPJ de 14, ou CPF de 11 QUANDO é estagiário.
   *
   * Sem esta distinção o estagiário nunca seria cadastrado: ele não tem CNPJ,
   * e a checagem de 14 dígitos o barrava sem dizer por quê. Já um CPF de quem
   * não é estagiário é o contrário — a pessoa deveria ter PJ, e cadastrar por
   * CPF esconderia isso. */
  const estagiario = ehEstagiario(p.cargo);
  if (cnpj.length === 11 && !estagiario) {
    return {
      ...base,
      acao: "bloqueado",
      motivo: "Documento é CPF, e a pessoa não é estagiária — prestador PJ precisa de CNPJ",
    };
  }
  if (!(cnpj.length === 14 || (cnpj.length === 11 && estagiario))) {
    return {
      ...base,
      acao: "bloqueado",
      motivo: cnpj
        ? `Documento incompleto (${cnpj.length} dígitos)`
        : "Sem CNPJ nem CPF no cadastro do RH",
    };
  }

  const chavePix = chavePixDe(p);

  // Preferido: o cadastro que já tem chave PIX. Sem nenhum, o primeiro.
  const existente =
    cadastros.find((c) => String(c?.dadosBancarios?.cChavePix ?? "").trim()) ?? cadastros[0] ?? null;

  if (!existente) return { ...base, acao: "criar", chavePix };

  const codigoClienteOmie = Number(existente.codigo_cliente_omie);
  const pixNoOmie = String(existente.dadosBancarios?.cChavePix ?? "").trim();

  if (!pixNoOmie) return { ...base, acao: "alterar_pix", codigoClienteOmie, chavePix };

  if (!mesmaChavePix(pixNoOmie, chavePix)) {
    // Não sobrescreve: decide gente, não código.
    return {
      ...base,
      acao: "bloqueado",
      codigoClienteOmie,
      motivo: `PIX do Omie (${pixNoOmie}) difere do RH (${chavePix}). Confira antes de trocar.`,
    };
  }

  return { ...base, acao: "ja_ok", codigoClienteOmie, chavePix: pixNoOmie };
}

/**
 * Barra o lote inteiro quando o mesmo CNPJ aparece em mais de uma pessoa.
 *
 * Criar fornecedor para quatro pessoas que dividem um CNPJ dá um cadastro só
 * (o Omie recusa CNPJ repetido) e, pior, os quatro títulos de folha iriam
 * todos para esse fornecedor. É defeito de cadastro do RH, não coisa que o
 * envio deva resolver sozinho.
 */
export function cnpjsRepetidos(pessoas: ColaboradorParaOmie[]): string[] {
  const conta = new Map<string, number>();
  for (const p of pessoas) {
    const c = soDigitos(p.cnpj);
    // CPF entra na conta também: dois estagiários com o mesmo CPF é o mesmo
    // problema, e o Omie recusaria o segundo cadastro igual.
    if (c.length === 14 || c.length === 11) conta.set(c, (conta.get(c) ?? 0) + 1);
  }
  return [...conta.entries()].filter(([, n]) => n > 1).map(([c]) => c);
}

/* ------------------------------------------------------------------
 * Os payloads
 * ------------------------------------------------------------------ */

/**
 * `codigo_cliente_integracao` — a trava de idempotência do cadastro.
 *
 * Usa o CNPJ e não o código do RH de propósito: o cadastro é da PJ, não da
 * pessoa, e é pelo CNPJ que o Omie recusa duplicata. O prefixo separa quem
 * este Hub criou do que veio de outro lugar.
 */
export const integracaoClienteDe = (cnpj: string): string => `COLAB-${soDigitos(cnpj)}`;

/** O `param` do `IncluirCliente`. */
export function montarIncluirCliente(p: ColaboradorParaOmie): Record<string, unknown> {
  const cnpj = soDigitos(p.cnpj);
  const nome = String(p.nome ?? "").trim();
  const razao = String(p.razao ?? "").trim() || nome;
  return {
    codigo_cliente_integracao: integracaoClienteDe(cnpj),
    razao_social: razao,
    // O nome fantasia leva o nome da PESSOA: é o que aparece no extrato e na
    // conferência, e razão social de PJ de uma pessoa só ninguém reconhece.
    nome_fantasia: nome,
    cnpj_cpf: cnpj,
    dadosBancarios: { cChavePix: chavePixDe(p) },
  };
}

/** O `param` do `AlterarCliente` que só grava a chave PIX. */
export function montarAlterarPix(codigoClienteOmie: number, chavePix: string): Record<string, unknown> {
  return {
    codigo_cliente_omie: codigoClienteOmie,
    dadosBancarios: { cChavePix: chavePix },
  };
}
