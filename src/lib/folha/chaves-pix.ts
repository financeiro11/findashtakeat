/**
 * A chave PIX do RH contra a chave PIX do fornecedor no Omie.
 *
 * São duas verdades diferentes sobre o mesmo pagamento. O espelho do RH é o
 * que alguém digitou no portal; o cadastro do Omie é o que o banco usa quando
 * o título vira pagamento. Quando divergem, quem manda é o Omie — e ninguém
 * na tela do RH tinha como saber disso.
 *
 * Em 26/08/2026, entre 101 ativos: 85 batiam, 44 batiam a menos de pontuação,
 * dez divergiam de verdade e três não tinham chave utilizável de nenhum lado.
 * Das dez, seis eram digitação no portal que o Omie já tinha certa — o envio
 * ia funcionar, e a tela dizia que estava quebrado.
 *
 * Este módulo não escolhe nem conserta: ele DIZ qual é a diferença, com as
 * duas chaves à vista, porque quem confere precisa das duas para decidir.
 */

/**
 * A forma da chave que serve para comparar.
 *
 * `65.134.410/0001-70` e `65134410000170` são a mesma chave — o RH grava com
 * pontuação e o Omie sem, e comparar cru transformaria metade do quadro em
 * divergência. Só reduz a dígitos o que é SÓ dígito e pontuação: um e-mail
 * com número no meio (`thyago0@gmail.com`) tem de continuar e-mail.
 */
export function chaveComparavel(chave: string | null | undefined): string {
  const t = String(chave ?? "").trim();
  if (!t) return "";
  const digitos = t.replace(/[^0-9]/g, "");
  const alfanumerico = t.replace(/[^0-9a-zA-Z]/g, "");
  return digitos && alfanumerico === digitos ? digitos : t.toLowerCase();
}

/** A mesma chave, ignorando o `+55` que o Omie exige e o portal do RH omite. */
const semDdi = (k: string) => k.replace(/^55/, "");

export type SituacaoDaChave =
  /** As duas chaves são a mesma (podendo diferir só em pontuação). */
  | "iguais"
  /** Mesma chave, mas o Omie tem o `+55` que falta no RH. É o Omie que paga. */
  | "so_ddi"
  /** Chaves diferentes. O pagamento sai pela do Omie. */
  | "divergente"
  /** O fornecedor existe no Omie, mas está sem chave PIX cadastrada. */
  | "omie_sem_chave"
  /** Não há fornecedor no Omie para este documento. */
  | "sem_fornecedor"
  /** Nem o RH nem o Omie têm chave. */
  | "sem_chave_nos_dois"
  /** A consulta ao Omie falhou — não dá para afirmar nada. */
  | "erro";

export type ComparacaoDeChave = {
  situacao: SituacaoDaChave;
  /** Nada a mostrar na tela? (as duas concordam) */
  ok: boolean;
  gravidade: "erro" | "aviso";
  mensagem: string;
};

export type ChaveDoOmie = {
  /** A chave como está no cadastro do fornecedor. Vazio = cadastrado sem chave. */
  chaveOmie: string;
  /** O fornecedor foi encontrado no Omie? */
  existe: boolean;
  /** Mensagem da falha, quando a consulta não completou. */
  erro?: string | null;
};

/**
 * O que dizer sobre esta pessoa.
 *
 * A gravidade segue o que trava o pagamento, não o que é feio: chave do RH
 * torta com o Omie certo é AVISO, porque o título sai — o envio cai para a
 * chave do fornecedor. Sem fornecedor ou sem chave nenhuma é ERRO, porque aí
 * não sai.
 */
export function compararChavePix(pixRh: string | null | undefined, omie: ChaveDoOmie): ComparacaoDeChave {
  const rh = String(pixRh ?? "").trim();
  const noOmie = String(omie.chaveOmie ?? "").trim();

  if (omie.erro) {
    return {
      situacao: "erro", ok: false, gravidade: "erro",
      mensagem: `não deu para consultar o fornecedor no Omie: ${omie.erro}`,
    };
  }
  if (!omie.existe) {
    return {
      situacao: "sem_fornecedor", ok: false, gravidade: "erro",
      mensagem: "não tem fornecedor cadastrado no Omie",
    };
  }
  if (!noOmie && !rh) {
    return {
      situacao: "sem_chave_nos_dois", ok: false, gravidade: "erro",
      mensagem: "sem chave PIX nem no RH nem no cadastro do Omie",
    };
  }
  if (!noOmie) {
    return {
      situacao: "omie_sem_chave", ok: false, gravidade: "erro",
      mensagem: `fornecedor no Omie está sem chave PIX (no RH: ${rh})`,
    };
  }

  const kRh = chaveComparavel(rh);
  const kOmie = chaveComparavel(noOmie);

  if (kRh === kOmie) return { situacao: "iguais", ok: true, gravidade: "aviso", mensagem: "" };

  /* Só faz sentido falar em DDI entre chaves numéricas: `55` no começo de um
     e-mail não é código de país. */
  if (kRh && /^[0-9]+$/.test(kRh) && /^[0-9]+$/.test(kOmie) && semDdi(kRh) === semDdi(kOmie)) {
    return {
      situacao: "so_ddi", ok: false, gravidade: "aviso",
      mensagem: `no Omie a mesma chave está como ${noOmie} — é por ela que o pagamento sai`,
    };
  }

  return {
    situacao: "divergente", ok: false, gravidade: "aviso",
    mensagem: rh
      ? `chave no RH é ${rh}, mas o Omie paga em ${noOmie}`
      : `sem chave no RH; o Omie paga em ${noOmie}`,
  };
}
