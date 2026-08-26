/**
 * Documento e chave PIX: as regras que a TELA e o SERVIDOR precisam concordar.
 *
 * Mora em `_shared` pelo mesmo motivo que `folha-envio.ts`: a prévia marca a
 * chave inválida em vermelho e o envio tem de recusar a MESMA chave. Enquanto
 * isto estava só no frontend, a tela sabia que dez chaves eram inválidas e
 * mandava as dez assim mesmo — o Omie recusou uma a uma, com mensagens que
 * ninguém liga à pessoa ("não parece ser um telefone válido", para um CPF).
 *
 * A camada de conferência que monta a mensagem para o DH continua em
 * `src/lib/folha/conferencia.ts`, que importa daqui.
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
  | "telefone_sem_ddi" | "email_invalido" | "documento_incompleto"
  | "vazia" | "desconhecida";

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
  /* CNPJ com dígito verificador conferido, não só com 14 dígitos.
     O PIX 42.026.075/0001-80 tem o tamanho certo e é inválido — o Omie recusou
     com "Esta não parece ser uma chave pix válida". Aceitar pelo tamanho faria
     o Hub aprovar o que o ERP nega. */
  if (d.length === 14) return cnpjValido(d) ? "cnpj" : "documento_incompleto";

  /* Telefone SÓ vale com +55 na frente — é o que o Omie exige, e é o que ele
     responde quando falta: "Ela deve iniciar com +55 e DDD (não use traços)".
     Não é preciosismo de formato: onze dígitos soltos com cara de celular são
     lidos como telefone pelo ERP, e recusados. */
  if (/^\+55/.test(t.replace(/\s/g, "")) && (d.length === 12 || d.length === 13)) return "telefone";

  if (d.length === 11) {
    /* Onze dígitos sem DDI. O Omie desambigua pela FORMA: DDD + 9 + oito
       dígitos ele lê como celular, mesmo sendo um CPF de verdade — foi o que
       aconteceu com quatro chaves em 26/08/2026 (11957054393, 21992197625,
       27998814130, 27992360017). Chamá-las de CPF aqui faria o Hub aprovar o
       que o ERP recusa, que é o pior lugar para divergir. */
    if (/^[1-9]{2}9\d{8}$/.test(d)) return "telefone_sem_ddi";
    return "cpf";
  }
  // 12 ou 13 dígitos sem o +55 é quase sempre CNPJ que perdeu um dígito.
  if (d.length === 12 || d.length === 13) return "documento_incompleto";
  return "desconhecida";
}

/**
 * O que a empresa aceita pagar, em ordem de preferência (26/08/2026):
 *
 *   CNPJ      preferido — é o documento da PJ que presta o serviço
 *   e-mail    aceito
 *   telefone  aceito SÓ com +55 na frente; o ideal é trocar por CNPJ
 *   CPF       só para estagiário
 *   aleatória nunca
 *
 * `email_invalido` e `documento_incompleto` ficam de fora de propósito: são
 * chave quebrada, não tipo de chave. Não recebem nada.
 */
export function chavePermitida(tipo: TipoDeChave, estagiario: boolean): boolean {
  if (tipo === "cnpj" || tipo === "email" || tipo === "telefone") return true;
  if (tipo === "cpf") return estagiario;
  return false;
}

/** Aceita, mas dá para melhorar. Hoje só o telefone. */
export const chaveMenosBoa = (tipo: TipoDeChave): boolean => tipo === "telefone";

/** O cargo diz que é estágio? É o único caso em que CPF vale como chave. */
export const ehEstagiario = (cargo: string): boolean =>
  /estagi/i.test(String(cargo ?? ""));
