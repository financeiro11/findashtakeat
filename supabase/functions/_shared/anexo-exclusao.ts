// O QUE SAI QUANDO ALGUÉM EXCLUI UM COMPROVANTE ERRADO — as regras, sem rede.
//
// Vive separado da `auditoria-excluir-comprovante` para ter teste: apagar no
// Omie não tem desfazer, e a pergunta "qual destes arquivos é o que o Hub
// mandou?" é exatamente o tipo de conta que parece óbvia até errar em silêncio.
//
// As guardas são as mesmas da `omie-anexo-remover`: nada sem lista explícita,
// casa pelo NOME e o nome tem de ser único no título. Id de anexo guardado
// envelhece; nome repetido é ambiguidade — nos dois casos recusa, em vez de
// escolher por conta.

import { classificarAnexo, nomeSeguroParaOmie } from "./anexo-tipo.ts";

export type AnexoNoTitulo = { id: string | null; nome: string | null };

/** Um anexo do título como a tela o oferece para marcar. */
export type AnexoParaEscolher = {
  nome: string;
  /** o nome bate com o arquivo que o Hub mandou — vem pré-marcado */
  do_hub: boolean;
  /** mais de um arquivo com este nome: não dá para apagar pelo Hub */
  repetido: boolean;
  /** o Omie não devolveu id: não dá para mandar o ExcluirAnexo */
  sem_id: boolean;
};

export type Recusa = { nome: string; motivo: "nao_achei" | "nome_repetido" | "sem_id" };

/**
 * O nome do arquivo a partir do caminho no bucket.
 *
 * Os dois caminhos que gravam no bucket prefixam um carimbo de tempo
 * (`hub/ACH-1/1787000000000_nota.pdf`) — ele é tirado para o nome voltar a ser
 * o que a pessoa subiu. URL não tem nome confiável: devolve nulo.
 */
export function nomeDoCaminho(valor: string | null | undefined): string | null {
  const v = String(valor ?? "").trim();
  if (!v || /^https?:\/\//i.test(v)) return null;
  const ultimo = v.split("/").pop() ?? "";
  return ultimo.replace(/^\d{10,}_/, "") || null;
}

/**
 * Os nomes com que o arquivo do Hub pode ter chegado ao título.
 *
 * O `incluirAnexo` não sobe o nome como veio: passa por `nomeSeguroParaOmie`
 * (sem acento, sem espaço) e foto vira PDF antes de subir. Comparar só com o
 * nome original deixaria de reconhecer quase todo arquivo com acento — e a tela
 * deixaria de pré-marcar justamente o que a pessoa quer apagar.
 */
export function nomesDoHubNoOmie(nome: string | null | undefined): Set<string> {
  const n = String(nome ?? "").trim();
  if (!n) return new Set();
  const semExt = n.replace(/\.[^.]+$/, "") || "comprovante";
  return new Set([n, nomeSeguroParaOmie(n), nomeSeguroParaOmie(`${semExt}.pdf`)]);
}

/** A lista do título pronta para a pessoa marcar o que sai. */
export function anexosParaEscolher(
  anexos: AnexoNoTitulo[],
  nomeDoHub: string | null | undefined,
): AnexoParaEscolher[] {
  const doHub = nomesDoHubNoOmie(nomeDoHub);
  const contagem = new Map<string, number>();
  for (const a of anexos) {
    const nome = a.nome ?? "";
    contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
  }
  return anexos.map((a) => {
    const nome = a.nome ?? "";
    return {
      nome,
      do_hub: !!nome && doHub.has(nome),
      repetido: (contagem.get(nome) ?? 0) > 1,
      sem_id: !a.id,
    };
  });
}

/**
 * Resolve os nomes pedidos contra UMA leitura do título.
 *
 * Tudo ou nada fica a cargo de quem chama: aqui só se separa o que dá para
 * apagar do que precisa ser recusado, e o motivo de cada recusa.
 */
export function resolverExclusao(
  anexos: AnexoNoTitulo[],
  pedidos: string[],
): { apagar: { nome: string; id: string }[]; recusas: Recusa[] } {
  const apagar: { nome: string; id: string }[] = [];
  const recusas: Recusa[] = [];
  for (const nome of new Set(pedidos.map((p) => String(p ?? "").trim()).filter(Boolean))) {
    const achados = anexos.filter((a) => (a.nome ?? "") === nome);
    if (achados.length === 0) recusas.push({ nome, motivo: "nao_achei" });
    else if (achados.length > 1) recusas.push({ nome, motivo: "nome_repetido" });
    else if (!achados[0].id) recusas.push({ nome, motivo: "sem_id" });
    else apagar.push({ nome, id: achados[0].id });
  }
  return { apagar, recusas };
}

/** A frase de uma recusa, para o toast. */
export function fraseDaRecusa(r: Recusa): string {
  if (r.motivo === "nao_achei") return `"${r.nome}" não está mais no título`;
  if (r.motivo === "nome_repetido") return `há mais de um "${r.nome}" no título — remova direto no Omie`;
  return `o Omie não informou o id de "${r.nome}"`;
}

/**
 * O que gravar em `omie_titulo_anexo` depois da releitura.
 *
 * A MESMA regra da `omie-anexos-varredura`: a melhor classe entre os anexos
 * vale, e `parece_nota` é nulo quando não sobrou nada — "não tem" não é "tem
 * coisa errada".
 */
export function leituraDoTitulo(anexos: AnexoNoTitulo[]): {
  qtd: number;
  parece_nota: boolean | null;
  classe: string | null;
} {
  if (!anexos.length) return { qtd: 0, parece_nota: null, classe: null };
  const classes = anexos.map((a) => classificarAnexo(a.nome));
  const classe = classes.includes("nota") ? "nota"
    : classes.includes("indefinido") ? "indefinido"
    : "duvidoso";
  return { qtd: anexos.length, parece_nota: classe === "nota", classe };
}

/**
 * O achado depois de perder o comprovante: volta para a fila.
 *
 * Decisão do usuário em 14/09/2026. A primeira versão só voltava a SEM NF se o
 * título do Omie ficasse sem anexo, e só desfazia aprovação automática — e o
 * Mage Burger ficou "COM NF · Reprovado" depois de ter o link excluído, sem
 * lixeira nenhuma para tentar de novo. Quem aprovou ou reprovou olhou para um
 * papel que acabou de ir para o lixo: a decisão cai junto, seja de gente ou
 * da conferência.
 *
 * FORA DE ESCOPO é a exceção — aquilo é sobre escopo, não sobre nota, e é a
 * mesma exceção que a tela já faz ao promover os anexados a COM NF.
 */
export function achadoSemComprovante(
  achado: { status?: string | null; categoria?: string | null },
): { status: string; categoria: string | null; mudancas: string[] } {
  const categoria = achado.categoria === "FORA DE ESCOPO" ? achado.categoria : "SEM NF";
  const mudancas: string[] = [];
  if (achado.categoria !== categoria) mudancas.push(`categoria → ${categoria}`);
  if (achado.status !== "Pendente") mudancas.push("status → Pendente");
  return { status: "Pendente", categoria, mudancas };
}
