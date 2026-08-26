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

/* As regras que a TELA e o SERVIDOR precisam concordar moram em
   `_shared/documento.ts`. Enquanto estavam só aqui, a prévia sabia que dez
   chaves PIX eram inválidas e o envio mandava as dez assim mesmo — o Omie
   recusou uma a uma, com mensagens que ninguém liga à pessoa ("não parece ser
   um telefone válido", para um CPF). Este arquivo fica com o que é de tela:
   montar a mensagem e comparar salário com o departamento. */

import {
  CNPJ_TAKEAT, chaveMenosBoa, chavePermitida, cnpjValido, cpfValido, ehEstagiario,
  soDigitos, tipoDeChavePix,
  type Achado, type Gravidade, type TipoDeChave,
} from "../../../supabase/functions/_shared/documento";

export {
  CNPJ_TAKEAT, chaveMenosBoa, chavePermitida, cnpjValido, cpfValido, ehEstagiario,
  soDigitos, tipoDeChavePix,
};
export type { Achado, Gravidade, TipoDeChave };

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
    } else if (estagiario) {
      /* Estagiário não presta serviço como PJ: o cadastro, a chave PIX e o
         título saem no CPF. Um CNPJ aqui é vínculo errado, não só campo
         errado — decidido com o financeiro em 26/08/2026. */
      achados.push({
        campo: "documento", gravidade: "erro",
        mensagem: "estagiário cadastrado com CNPJ — deve ser o CPF",
      });
    }
  } else if (doc.length === 11) {
    if (!cpfValido(doc)) {
      achados.push({ campo: "documento", gravidade: "erro", mensagem: `CPF ${doc} é inválido` });
    } else if (!estagiario) {
      /* O contrário do caso acima: quem não é estagiário deveria ter PJ.
         Aviso e não erro porque existe gente pagando assim hoje, e barrar
         tiraria da folha quem já vem recebendo. */
      achados.push({
        campo: "documento", gravidade: "aviso",
        mensagem: "cadastrado por CPF sem ser estagiário — prestador PJ deveria ter CNPJ",
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
    cpf: "",  // montada abaixo, com o CPF à vista
    telefone: "",  // aceita; vira aviso de preferência, não erro
    telefone_sem_ddi: "",  // montada abaixo, com o número à vista
    email_invalido: `chave PIX "${String(p.pix ?? "").trim()}" não é um e-mail válido`,
    documento_incompleto: `chave PIX ${soDigitos(p.pix)} não é um CNPJ válido `
      + "— dígito faltando ou trocado",
    desconhecida: "chave PIX em formato não reconhecido",
  };
  if (tipo === "documento_incompleto" && distanciaDeUmDigito(doc, soDigitos(p.pix))) {
    /* Chave inválida que difere do documento em UM dígito é digitação, e dizer
       isso poupa a busca por um erro que não existe. Stheferson e Emanuelle,
       no espelho real. */
    achados.push({
      campo: "pix", gravidade: "erro",
      mensagem: `chave PIX ${soDigitos(p.pix)} difere do documento em 1 dígito `
        + "— provável digitação",
    });
  } else if (tipo === "telefone_sem_ddi") {
    /* O Omie lê onze dígitos com cara de celular como telefone e exige o +55.
       Vale tanto para telefone de verdade quanto para CPF que por acaso tem
       essa forma — e o texto diz as duas saídas, porque quem confere não sabe
       de antemão qual dos dois é. */
    achados.push({
      campo: "pix", gravidade: "erro",
      mensagem: `chave PIX ${soDigitos(p.pix)} o Omie lê como telefone e recusa `
        + "— use +55 na frente, ou troque pelo CNPJ",
    });
  } else if (tipo === "cpf" && !estagiario) {
    // O CPF vai escrito na mensagem: quem for cobrar o DH precisa dizer QUAL
    // chave está lá, não que "existe uma chave errada".
    achados.push({
      campo: "pix", gravidade: "erro",
      mensagem: `chave PIX é o CPF ${formatarCpf(soDigitos(p.pix))} — só vale para estagiário`,
    });
  } else if (estagiario && tipo === "cnpj") {
    achados.push({
      campo: "pix", gravidade: "erro",
      mensagem: "estagiário com chave PIX de CNPJ — deve ser o CPF",
    });
  } else if (!chavePermitida(tipo, estagiario) && comoPix[tipo]) {
    achados.push({
      campo: "pix",
      gravidade: tipo === "vazia" ? "aviso" : "erro",
      mensagem: comoPix[tipo]!,
    });
  } else if (chaveMenosBoa(tipo)) {
    /* Telefone recebe, então não impede o pagamento. Mas a preferência da
       empresa é CNPJ, e um aviso aqui é o que faz alguém trocar antes de o
       número mudar de dono — telefone é a única chave PIX que troca de mãos. */
    achados.push({
      campo: "pix", gravidade: "aviso",
      mensagem: "chave PIX é telefone — funciona, mas o ideal é usar o CNPJ",
    });
  } else if (tipo === "cnpj" && doc.length === 14 && soDigitos(p.pix) !== doc) {
    /* A empresa não paga em CNPJ de terceiro — confirmado pelo financeiro em
       26/08/2026. Mas o MOTIVO muda o que fazer, então a mensagem distingue:

       doc é o CNPJ da Takeat → é o documento que está errado, e o PIX é
       provavelmente o CNPJ verdadeiro da pessoa. Foi o caso de duas, e a
       planilha Dados Pessoal confirmou o PIX nas duas.

       diferença de um dígito só → digitação, não outra empresa. Dizer "CNPJ
       diferente" faria alguém procurar uma segunda PJ que não existe. */
    const pixd = soDigitos(p.pix);
    const mensagem = doc === CNPJ_TAKEAT
      ? `documento é o CNPJ da Takeat; o PIX (${formatarCnpj(pixd)}) parece ser o CNPJ correto`
      : distanciaDeUmDigito(doc, pixd)
        ? `PIX ${formatarCnpj(pixd)} difere do documento em 1 dígito — provável digitação`
        : `PIX é o CNPJ ${formatarCnpj(pixd)}, diferente do dela — a empresa não paga em CNPJ de terceiro`;
    achados.push({ campo: "pix", gravidade: "erro", mensagem });
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

/**
 * Os dois documentos diferem em exatamente um caractere?
 *
 * Separa digitação de "é outra empresa". Só compara documentos do mesmo
 * tamanho: um truncado difere em muita coisa e já é apontado por outra regra.
 */
export function distanciaDeUmDigito(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  let diferencas = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diferencas > 1) return false;
  return diferencas === 1;
}

export const formatarCnpj = (d: string) =>
  d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : d;

export const formatarCpf = (d: string) =>
  d.length === 11
    ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    : d;
