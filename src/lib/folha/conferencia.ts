/**
 * Conferência do que chega do Portal RH.
 *
 * O espelho é digitado por gente, e por gente diferente a cada admissão. Em
 * 26/08/2026, entre 102 pessoas ativas, havia quatro dividindo o CNPJ da
 * própria Takeat, três documentos que perderam o zero à esquerda, um truncado,
 * dois com chave PIX aleatória e seis pagando em CPF sem serem estagiários.
 * Nada disso dá erro em lugar nenhum: vira pagamento para a conta errada, ou
 * título que não existe.
 *
 * Este módulo não conserta nada — ele DIZ o que está errado, para virar recado
 * ao DH e sinalização na tela. Consertar é a camada de correção
 * (`folha_depara.documento_ajustado` e `valor_ajustado`), que é outra coisa e
 * exige decisão humana.
 */

/** O CNPJ da própria Takeat. Ninguém pode receber salário nele. */
export const CNPJ_TAKEAT = "37511891000150";

export type Gravidade = "erro" | "aviso";

export type Achado = {
  campo: "documento" | "pix" | "valor";
  gravidade: Gravidade;
  /** Curto o bastante para caber embaixo do nome, na tabela. */
  mensagem: string;
};

export const soDigitos = (s: unknown): string => String(s ?? "").replace(/\D/g, "");

/* ------------------------------------------------------------------
 * Documento
 * ------------------------------------------------------------------ */

/**
 * CNPJ com dígito verificador conferido.
 *
 * Conferir só o tamanho deixa passar documento digitado errado — e documento
 * errado que TEM 14 dígitos é pior que um truncado, porque parece válido e
 * ninguém olha duas vezes.
 */
export function cnpjValido(doc: string): boolean {
  const d = soDigitos(doc);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = (base: string, pesos: number[]) => {
    const soma = pesos.reduce((s, p, i) => s + Number(base[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  return digito(d, p1) === Number(d[12]) && digito(d, p2) === Number(d[13]);
}

/** CPF com dígito verificador conferido. */
export function cpfValido(doc: string): boolean {
  const d = soDigitos(doc);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

/* ------------------------------------------------------------------
 * Chave PIX
 * ------------------------------------------------------------------ */

export type TipoDeChave =
  | "cnpj" | "cpf" | "email" | "telefone" | "aleatoria"
  | "email_invalido" | "documento_incompleto" | "vazia" | "desconhecida";

/**
 * Que tipo de chave é esta.
 *
 * A ordem das checagens importa. `6500769400134` tem 13 dígitos: não é CNPJ
 * nem CPF nem telefone brasileiro — é um CNPJ que perdeu um dígito, e chamar
 * isso de "telefone" mandaria alguém procurar um problema que não existe.
 */
export function tipoDeChavePix(chave: string): TipoDeChave {
  const t = String(chave ?? "").trim();
  if (!t) return "vazia";

  // Aleatória (EVP): o formato UUID é inconfundível.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return "aleatoria";

  if (t.includes("@")) {
    // Domínio precisa de ponto e de TLD com pelo menos duas letras:
    // "scaetano.takeat@gnm" existe no cadastro e não recebe nada.
    return /^[^\s@]+@[^\s@.]+\.[a-z]{2,}$/i.test(t) ? "email" : "email_invalido";
  }

  const d = soDigitos(t);
  if (d.length === 14) return "cnpj";
  if (d.length === 11) {
    // Celular brasileiro sem DDI: 11 dígitos começando por DDD + 9.
    if (/^\+/.test(t) || /^[1-9]{2}9\d{8}$/.test(d)) return "telefone";
    return "cpf";
  }
  if (d.length === 12 || d.length === 13) {
    // 13 dígitos é quase sempre CNPJ sem o zero à esquerda.
    return /^\+?55/.test(t) ? "telefone" : "documento_incompleto";
  }
  return "desconhecida";
}

/** O que a empresa aceita pagar. CPF só para estagiário; aleatória, nunca. */
export function chavePermitida(tipo: TipoDeChave, estagiario: boolean): boolean {
  if (tipo === "cnpj" || tipo === "email") return true;
  if (tipo === "cpf") return estagiario;
  return false;
}

/** O cargo diz que é estágio? É o único caso em que CPF vale como chave. */
export const ehEstagiario = (cargo: string): boolean =>
  /estagi/i.test(String(cargo ?? ""));

/* ------------------------------------------------------------------
 * A conferência
 * ------------------------------------------------------------------ */

export type PessoaParaConferir = {
  nome: string;
  cargo: string | null;
  /** Documento como está no espelho do RH. */
  documento: string | null;
  pix: string | null;
  valor: number | null;
  /** Departamento padronizado, do de-para. Usado para comparar o salário. */
  departamento: string | null;
};

/**
 * Quanto se paga tipicamente em cada departamento.
 *
 * MEDIANA, e não média: um diretor de R$ 22.500 num time de R$ 2.400 puxa a
 * média para cima e faz o time inteiro parecer mal pago. A mediana ignora o
 * extremo, que é justamente o que se quer aqui.
 */
export function medianasPorDepartamento(
  pessoas: { departamento: string | null; valor: number | null }[],
): Map<string, { mediana: number; n: number }> {
  const porDep = new Map<string, number[]>();
  for (const p of pessoas) {
    const dep = String(p.departamento ?? "").trim();
    const v = Number(p.valor) || 0;
    if (!dep || v <= 0) continue;
    (porDep.get(dep) ?? porDep.set(dep, []).get(dep)!).push(v);
  }
  const out = new Map<string, { mediana: number; n: number }>();
  for (const [dep, vs] of porDep) {
    vs.sort((a, b) => a - b);
    const m = vs.length % 2
      ? vs[(vs.length - 1) / 2]
      : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
    out.set(dep, { mediana: m, n: vs.length });
  }
  return out;
}

/**
 * Quantas pessoas um departamento precisa ter para a mediana valer.
 *
 * Com duas pessoas, a "mediana" é a média delas e qualquer diferença entre as
 * duas vira alarme. Quatro é o mínimo em que o número diz alguma coisa.
 */
export const MINIMO_PARA_COMPARAR = 4;

/** Quantas vezes a mediana já é estranho o bastante para avisar. */
export const FATOR_DE_ESTRANHEZA = 3;

/**
 * O que está errado com esta pessoa. Lista vazia = nada a apontar.
 *
 * Erro é o que impede pagar; aviso é o que merece um olhar. A separação existe
 * para a tela poder barrar sem esconder — quem confere precisa ver os dois.
 */
export function conferir(
  p: PessoaParaConferir,
  medianas: Map<string, { mediana: number; n: number }> = new Map(),
): Achado[] {
  const achados: Achado[] = [];
  const doc = soDigitos(p.documento);
  const estagiario = ehEstagiario(p.cargo ?? "");

  /* ---- documento ---- */
  if (!doc) {
    achados.push({ campo: "documento", gravidade: "erro", mensagem: "sem CNPJ/CPF no cadastro" });
  } else if (doc === CNPJ_TAKEAT) {
    achados.push({
      campo: "documento", gravidade: "erro",
      mensagem: "está com o CNPJ da Takeat no lugar do próprio",
    });
  } else if (doc.length === 14) {
    if (!cnpjValido(doc)) {
      achados.push({ campo: "documento", gravidade: "erro", mensagem: `CNPJ ${doc} é inválido` });
    }
  } else if (doc.length === 11) {
    if (!cpfValido(doc)) {
      achados.push({ campo: "documento", gravidade: "erro", mensagem: `CPF ${doc} é inválido` });
    } else if (!estagiario) {
      achados.push({
        campo: "documento", gravidade: "aviso",
        mensagem: "cadastrado por CPF sem ser estagiário",
      });
    }
  } else {
    achados.push({
      campo: "documento", gravidade: "erro",
      mensagem: `documento com ${doc.length} dígitos — CNPJ tem 14, CPF tem 11`,
    });
  }

  /* ---- chave PIX ---- */
  const tipo = tipoDeChavePix(p.pix ?? "");
  const comoPix: Partial<Record<TipoDeChave, string>> = {
    vazia: "sem chave PIX cadastrada",
    aleatoria: "chave PIX aleatória — a empresa não paga nesse tipo",
    cpf: "chave PIX é CPF — só vale para estagiário",
    telefone: "chave PIX é telefone — a empresa paga em CNPJ ou e-mail",
    email_invalido: `chave PIX "${String(p.pix ?? "").trim()}" não é um e-mail válido`,
    documento_incompleto: `chave PIX ${soDigitos(p.pix)} parece CNPJ com dígito faltando`,
    desconhecida: "chave PIX em formato não reconhecido",
  };
  if (!chavePermitida(tipo, estagiario) && comoPix[tipo]) {
    achados.push({
      campo: "pix",
      gravidade: tipo === "vazia" ? "aviso" : "erro",
      mensagem: comoPix[tipo]!,
    });
  } else if (tipo === "cnpj" && doc.length === 14 && soDigitos(p.pix) !== doc) {
    // Pagar no CNPJ de outra PJ não é erro de digitação óbvio; é dinheiro indo
    // para outro CNPJ. Aviso, porque pode ser legítimo (holding, sócio).
    achados.push({
      campo: "pix", gravidade: "aviso",
      mensagem: "chave PIX é de um CNPJ diferente do dela",
    });
  }

  /* ---- salário ---- */
  const valor = Number(p.valor) || 0;
  const dep = String(p.departamento ?? "").trim();
  const ref = medianas.get(dep);
  if (valor > 0 && ref && ref.n >= MINIMO_PARA_COMPARAR && ref.mediana > 0) {
    if (valor >= ref.mediana * FATOR_DE_ESTRANHEZA) {
      achados.push({
        campo: "valor", gravidade: "aviso",
        mensagem: `salário ${vezes(valor / ref.mediana)} a mediana de ${dep}`,
      });
    } else if (valor <= ref.mediana / FATOR_DE_ESTRANHEZA) {
      achados.push({
        campo: "valor", gravidade: "aviso",
        mensagem: `salário ${vezes(ref.mediana / valor)} abaixo da mediana de ${dep}`,
      });
    }
  }

  return achados;
}

const vezes = (n: number) => `${n.toFixed(1).replace(".", ",")}×`;
