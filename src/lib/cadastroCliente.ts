/* ---------------------------------------------------------------------------
 * O CADASTRO DO CLIENTE DIGITADO À MÃO — os campos, o que é válido, o que mudou.
 *
 * POR QUE ISTO EXISTE. `CorrigirCadastro` conserta o endereço com o que a Receita
 * ou o CEP respondem, e isso resolve o caso comum. Mas há um caso que nenhuma
 * consulta resolve, e ele aparece na própria tela: "O cadastro do Omie já bate
 * com a Receita/CEP — não há campo a corrigir daqui, e mesmo assim a nota não
 * saiu". O exemplo que motivou este arquivo é o mais simples possível: o Omie
 * recusa com "falta preencher o E-mail", e e-mail não está em cadastro federal
 * nenhum. Sem um lugar para digitar, o conserto sai do Hub — abre o Omie, acha o
 * cliente, digita, volta, reemite — e o Asaas (que é a origem) continua torto.
 *
 * A LÓGICA MORA AQUI, E NÃO NA TELA, por dois motivos: ela é testável sem montar
 * componente (ver `cadastroCliente.test.ts`), e as duas pontas precisam da MESMA
 * régua — a tela para dizer "3 campos alterados" antes do clique, e a Edge
 * Function para decidir o que escreve. Régua em dois lugares vira duas réguas.
 *
 * TRÊS DECISÕES QUE ESTE ARQUIVO CARREGA:
 *
 *   • CAMPO VAZIO NÃO APAGA. Deixar um campo em branco significa "não mexi
 *     nele", nunca "apague o que está lá". Esta tela existe para PREENCHER o que
 *     falta; apagar cadastro de terceiro por distração não pode estar a um
 *     backspace de distância. Quem precisa esvaziar um campo faz no Omie.
 *   • CADA CAMPO SABE ONDE CABE. E-mail, telefone e endereço são o mesmo dado
 *     nos dois sistemas. Razão social não: no Asaas o nome é o fantasia que a
 *     equipe de cobrança reconhece na tela, e sobrescrevê-lo com a razão social
 *     torna a cobrança irreconhecível para quem cobra. Cidade e UF também não: o
 *     Asaas as deriva do CEP.
 *   • COMPARAR É POR CAMPO. "VITÓRIA" e "VITORIA (ES)" são o mesmo município;
 *     "27 99745-6386" e "27997456386" são o mesmo telefone. Comparar cru diria
 *     que todo cliente mudou, e a tela pediria para escrever o que já está lá.
 * ------------------------------------------------------------------------- */

export type CampoCadastro =
  | "razao_social" | "nome_fantasia" | "email" | "telefone"
  | "endereco" | "endereco_numero" | "complemento" | "bairro"
  | "cidade" | "estado" | "cep";

/** Onde o campo é escrito quando a pessoa pede os dois sistemas. */
export type OndeCabe = "ambos" | "omie";

export interface CampoDef {
  campo: CampoCadastro;
  rotulo: string;
  onde: OndeCabe;
  /** Quanto espaço o campo ocupa na grade da tela. */
  largura: "curta" | "media" | "larga";
  /** O que o Omie corta — escrever mais é perder o resto em silêncio. */
  limite: number;
  ajuda?: string;
}

/**
 * A ORDEM É A DA URGÊNCIA, não a do formulário do Omie.
 *
 * E-mail vem primeiro porque é a recusa que traz a pessoa até aqui; o endereço
 * vem depois porque, quando ele é o problema, o botão automático (Receita/CEP)
 * costuma resolver antes de alguém precisar digitar.
 */
export const CAMPOS_CADASTRO: CampoDef[] = [
  {
    campo: "email", rotulo: "E-mail", onde: "ambos", largura: "larga", limite: 100,
    ajuda: "O Omie exige e-mail para emitir a NFS-e — é esta a recusa \"falta preencher o E-mail\". " +
      "Mais de um endereço, separados por ponto-e-vírgula; no Asaas entra só o primeiro, que é o que ele aceita.",
  },
  {
    campo: "telefone", rotulo: "Telefone", onde: "ambos", largura: "curta", limite: 11,
    ajuda: "DDD + número, só dígitos. Algumas prefeituras recusam a nota por telefone do tomador.",
  },
  {
    campo: "razao_social", rotulo: "Razão social", onde: "omie", largura: "larga", limite: 60,
    ajuda: "É o nome que sai na nota. Não vai para o Asaas de propósito: lá o nome é o fantasia " +
      "que a equipe reconhece na tela de cobrança.",
  },
  { campo: "nome_fantasia", rotulo: "Nome fantasia", onde: "omie", largura: "larga", limite: 60 },
  { campo: "endereco", rotulo: "Logradouro", onde: "ambos", largura: "larga", limite: 60 },
  { campo: "endereco_numero", rotulo: "Número", onde: "ambos", largura: "curta", limite: 10 },
  { campo: "complemento", rotulo: "Complemento", onde: "ambos", largura: "media", limite: 40 },
  { campo: "bairro", rotulo: "Bairro", onde: "ambos", largura: "media", limite: 40 },
  {
    campo: "cidade", rotulo: "Cidade", onde: "omie", largura: "media", limite: 40,
    ajuda: "Só no Omie: no Asaas a cidade vem do CEP, então é o CEP que a muda lá.",
  },
  { campo: "estado", rotulo: "UF", onde: "omie", largura: "curta", limite: 2 },
  {
    campo: "cep", rotulo: "CEP", onde: "ambos", largura: "curta", limite: 8,
    ajuda: "CEP que não existe na base dos Correios é o erro E0240 da prefeitura — o servidor recusa escrever um.",
  },
];

export const DEF_DO_CAMPO: Record<CampoCadastro, CampoDef> =
  Object.fromEntries(CAMPOS_CADASTRO.map((d) => [d.campo, d])) as Record<CampoCadastro, CampoDef>;

export type ValoresCadastro = Partial<Record<CampoCadastro, string>>;

export interface Mudanca {
  campo: CampoCadastro;
  /** O que está no cadastro hoje; "" quando está vazio (a tela mostra "(vazio)"). */
  de: string;
  para: string;
  /** Preencher buraco não desfaz decisão de ninguém; substituir valor pode. */
  vazio: boolean;
  /** Este campo também vai para o Asaas? */
  noAsaas: boolean;
}

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const limpo = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Um endereço de e-mail, na régua frouxa que serve para pegar erro de digitação
 *  (espaço no meio, domínio sem ponto) sem brigar com endereço exótico válido. */
const UM_EMAIL = /^[^\s@;,]+@[^\s@;,.]+(\.[^\s@;,.]+)+$/;

/** Os e-mails de um campo que aceita vários. O Omie guarda separado por ";". */
export function listaDeEmails(v: string): string[] {
  return String(v ?? "").split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * "VITORIA (ES)" → "VITORIA". O Omie guarda a cidade com a UF entre parênteses;
 * quem digita não deve ter de repetir a UF que já tem campo próprio — e nem
 * adivinhar esse formato, que é justamente o tipo de detalhe que faz a escrita
 * fiscal falhar semanas depois.
 */
export function cidadeSemUf(v: string): string {
  return limpo(String(v ?? "").replace(/\s*\([A-Za-z]{2}\)\s*$/, ""));
}

/** O valor como ele deve ser guardado — o que sobra do que a pessoa digitou. */
export function normalizarCampo(campo: CampoCadastro, valor: string): string {
  const v = String(valor ?? "");
  switch (campo) {
    case "cep": return soDigitos(v).slice(0, 8);
    case "telefone": return soDigitos(v).slice(0, 11);
    case "estado": return semAcento(v).replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2);
    // E-mail não vira caixa baixa: a parte antes do @ é sensível a caixa pela
    // norma, e "consertar" o que a pessoa digitou é mexer sem ser pedido.
    case "email": return listaDeEmails(v).join(";").slice(0, 100);
    case "cidade": return cidadeSemUf(v).slice(0, 40);
    default: return limpo(v).slice(0, DEF_DO_CAMPO[campo].limite);
  }
}

/** O que impede de gravar este campo — `null` quando está bom (ou vazio). */
export function erroDoCampo(campo: CampoCadastro, valor: string): string | null {
  const v = normalizarCampo(campo, valor);
  if (!v) return null;                       // vazio é "não mexi", não é erro
  switch (campo) {
    case "cep":
      return v.length === 8 ? null : "O CEP tem 8 dígitos.";
    case "telefone":
      return v.length >= 10 && v.length <= 11 ? null : "O telefone é DDD + 8 ou 9 dígitos.";
    case "estado":
      return v.length === 2 ? null : "A UF tem 2 letras.";
    case "email": {
      const ruins = listaDeEmails(v).filter((e) => !UM_EMAIL.test(e));
      return ruins.length ? `E-mail inválido: ${ruins.join(", ")}.` : null;
    }
    default:
      return null;
  }
}

/** Todos os erros de uma vez, para a tela poder desabilitar o botão. */
export function errosDoCadastro(valores: ValoresCadastro): Partial<Record<CampoCadastro, string>> {
  const out: Partial<Record<CampoCadastro, string>> = {};
  for (const d of CAMPOS_CADASTRO) {
    const erro = erroDoCampo(d.campo, valores[d.campo] ?? "");
    if (erro) out[d.campo] = erro;
  }
  return out;
}

/**
 * A comparação, por campo — é ela que decide o que é escrita e o que é ruído.
 *
 * Telefone e CEP comparam só os dígitos (a pontuação é enfeite de tela); e-mail
 * ignora a caixa (o protocolo trata o domínio assim, e ninguém quer reescrever
 * um cadastro porque alguém digitou o domínio em maiúscula); o resto compara sem
 * acento e sem caixa, pelo mesmo motivo que o `diffCadastro` do servidor: o Omie
 * guarda "VITORIA" onde a Receita diz "Vitória", e isso não é diferença.
 */
function mesmoValor(campo: CampoCadastro, a: string, b: string): boolean {
  if (campo === "telefone" || campo === "cep") return soDigitos(a) === soDigitos(b);
  if (campo === "email") return a.trim().toLowerCase() === b.trim().toLowerCase();
  return semAcento(limpo(a)).toUpperCase() === semAcento(limpo(b)).toUpperCase();
}

/**
 * O que a pessoa mudou de verdade.
 *
 * `atual` é o cadastro como está hoje (o do Omie, ou o do Asaas quando não há
 * cadastro no ERP); `editado` é o formulário. Campo em branco no formulário sai
 * da lista — ver a decisão "campo vazio não apaga" no cabeçalho.
 */
export function mudancas(atual: ValoresCadastro, editado: ValoresCadastro): Mudanca[] {
  const out: Mudanca[] = [];
  for (const d of CAMPOS_CADASTRO) {
    const para = normalizarCampo(d.campo, editado[d.campo] ?? "");
    if (!para) continue;
    const de = d.campo === "cidade"
      ? cidadeSemUf(atual.cidade ?? "")
      : limpo(atual[d.campo] ?? "");
    if (mesmoValor(d.campo, de, para)) continue;
    out.push({ campo: d.campo, de, para, vazio: !de, noAsaas: d.onde === "ambos" });
  }
  return out;
}

/** Só o que muda deste lado da ponte — o que a tela promete em cada botão. */
export function mudancasNoAsaas(lista: Mudanca[]): Mudanca[] {
  return lista.filter((m) => m.noAsaas);
}

/**
 * O corpo que vai para o servidor: só os campos alterados.
 *
 * MANDAR O FORMULÁRIO INTEIRO SERIA PIOR, e o motivo não é economia de bytes. O
 * servidor compara campo a campo de cada lado, então o Omie não receberia nada
 * de novo — mas o ASAAS receberia. Um cadastro cujo endereço no Asaas difere do
 * que está no Omie teria esse endereço sobrescrito por alguém que abriu a tela
 * para digitar um e-mail e nunca olhou para o resto. Escrita que a pessoa não
 * viu é exatamente o que esta tela existe para não fazer.
 */
export function camposAEnviar(lista: Mudanca[]): ValoresCadastro {
  return Object.fromEntries(lista.map((m) => [m.campo, m.para])) as ValoresCadastro;
}
