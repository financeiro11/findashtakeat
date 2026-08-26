/* A regra que decide se o anexo do ERP é a nota daquele título.
 *
 * A IA TRANSCREVE, ISTO DECIDE. Mesma divisão de `conferencia-comprovante.ts`, e
 * pelo mesmo motivo: na conferência de comprovantes o modelo afirmou que a
 * tarifa de um bilhete batia com a cobrança, e nenhuma linha do documento valia
 * aquele número. Veredito de modelo é ponteiro; a conta se refaz aqui, em cima
 * do que ele mesmo disse ter lido.
 *
 * O QUE ESTA REGRA NÃO FAZ é decidir o caso duvidoso. "revisar" não é fracasso —
 * é o desfecho certo quando o documento é nota mas o valor não bate, quando o
 * modelo não conseguiu ler, ou quando o tipo ficou incerto. Uma triagem que
 * responde tudo esconde exatamente as linhas que valem o olho de alguém.
 */

/** O que o modelo devolve. Só transcrição — nenhum campo pede julgamento. */
export type LeituraAnexo = {
  /** nota_fiscal | cupom_fiscal | boleto | recibo | comprovante_pagamento |
   *  contrato | proposta | extrato | print_de_tela | foto_sem_documento | outro */
  tipo: string;
  emitente: string | null;
  cnpj_emitente: string | null;
  numero: string | null;
  valor_total: number | null;
  data: string | null;
  /** O modelo conseguiu ler o documento? Ilegível/escuro/cortado = false. */
  legivel: boolean;
  /** Uma linha sobre o que é o papel, para a pessoa ler sem abrir o arquivo. */
  resumo: string | null;
};

export type ContextoTitulo = {
  favorecido: string;
  valor: number;
  competencia: string | null;
  categoria: string | null;
};

export type Veredito = "nota" | "nao_e_nota" | "revisar";
export type Triagem = { veredito: Veredito; motivo: string };

/* Os tipos que SÃO documento fiscal de fornecedor. NFS-e, NF-e, NFC-e e cupom
   entram; o resto, não. Boleto e comprovante de pagamento são a confusão mais
   comum da fila — provam que se pagou, não o que se comprou, e é a nota que o
   contador precisa ter. */
const FISCAIS = new Set(["nota_fiscal", "cupom_fiscal"]);

/* Os tipos que claramente NÃO respondem "cadê a nota". Aqui a recusa é segura:
   nenhum deles vira nota depois de alguém olhar. */
const NAO_SAO = new Set([
  "boleto", "comprovante_pagamento", "contrato", "proposta",
  "extrato", "print_de_tela", "foto_sem_documento",
]);

/** Centavos inteiros — comparar float de dinheiro é como não comparar. */
const cents = (v: number) => Math.round(v * 100);

const brl = (v: number) =>
  `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/**
 * Tolerância do valor: 2 centavos ou 1%, o que for maior.
 *
 * O 1% não é frouxidão — é retenção. Uma NFS-e de R$ 3.181,52 costuma ser paga
 * com ISS/IR retidos, e o título no ERP fica alguns reais abaixo do documento.
 * Exigir igualdade ao centavo mandaria para a fila humana justamente as notas
 * de serviço, que são a maioria aqui.
 */
function valorBate(nota: number, titulo: number): boolean {
  const folga = Math.max(2, Math.round(cents(titulo) * 0.01));
  return Math.abs(cents(nota) - cents(titulo)) <= folga;
}

export function triar(l: LeituraAnexo, t: ContextoTitulo): Triagem {
  const tipo = String(l?.tipo ?? "").trim().toLowerCase();

  /* ILEGÍVEL VEM ANTES DE TUDO. Um documento que o modelo não leu não tem tipo
     confiável — aceitar o `tipo` dele aqui seria decidir por um chute. */
  if (l?.legivel === false) {
    return { veredito: "revisar", motivo: "o modelo não conseguiu ler o documento" };
  }

  if (NAO_SAO.has(tipo)) {
    const comoSeChama: Record<string, string> = {
      boleto: "é um boleto",
      comprovante_pagamento: "é comprovante de pagamento, não a nota",
      contrato: "é um contrato",
      proposta: "é uma proposta/orçamento",
      extrato: "é um extrato",
      print_de_tela: "é um print de tela",
      foto_sem_documento: "é uma foto que não mostra documento",
    };
    return { veredito: "nao_e_nota", motivo: comoSeChama[tipo] ?? "não é documento fiscal" };
  }

  if (!FISCAIS.has(tipo)) {
    return { veredito: "revisar", motivo: `tipo de documento incerto${tipo ? ` (${tipo})` : ""}` };
  }

  /* Daqui para baixo é documento fiscal. Falta saber se é o DESTE título. */

  if (l.valor_total == null || !(l.valor_total > 0)) {
    return { veredito: "revisar", motivo: "é nota fiscal, mas o valor não foi transcrito" };
  }

  if (!(t.valor > 0)) {
    return { veredito: "revisar", motivo: "é nota fiscal, mas o título não tem valor para comparar" };
  }

  if (valorBate(l.valor_total, t.valor)) {
    return {
      veredito: "nota",
      motivo: `nota fiscal de ${brl(l.valor_total)}${l.emitente ? ` — ${l.emitente}` : ""}`,
    };
  }

  /* Nota de verdade, valor diferente. NÃO é "não é a nota": pode ser a nota
     cheia de um pagamento parcelado, ou o título pode ter retenção maior que a
     folga. É o caso que mais precisa de gente — e o que a leitura já deixou
     pronto para decidir em dois segundos. */
  return {
    veredito: "revisar",
    motivo: `nota fiscal de ${brl(l.valor_total)}, e o título é de ${brl(t.valor)}`,
  };
}

/** O texto que vai ao modelo. Só o que ele precisa para transcrever e situar. */
export function perguntaDaTriagem(t: ContextoTitulo, nomeArquivo: string): string {
  return (
    `Título do contas a pagar a que este arquivo está anexado:\n` +
    `- favorecido: ${t.favorecido || "(não informado)"}\n` +
    `- valor do título: ${brl(t.valor)}\n` +
    (t.competencia ? `- competência: ${String(t.competencia).slice(0, 10)}\n` : "") +
    (t.categoria ? `- categoria: ${t.categoria}\n` : "") +
    `- nome do arquivo no ERP: ${nomeArquivo}\n` +
    `\nTranscreva o documento anexo. Não julgue se ele "serve": só diga o que está escrito nele.`
  );
}

export const SISTEMA_TRIAGEM =
  `Você lê documentos anexados a contas a pagar de uma empresa brasileira e TRANSCREVE o que está neles.\n` +
  `\n` +
  `Devolva SOMENTE os campos pedidos, com o que está escrito no documento. Regras:\n` +
  `- "tipo": escolha um de nota_fiscal, cupom_fiscal, boleto, recibo, comprovante_pagamento, contrato, proposta, extrato, print_de_tela, foto_sem_documento, outro.\n` +
  `  NF-e, NFS-e, NFC-e e DANFE são nota_fiscal. Comprovante de PIX/TED e recibo de pagamento NÃO são nota_fiscal.\n` +
  `  Boleto bancário é boleto mesmo quando traz o número da nota impresso nele.\n` +
  `- "valor_total": o valor TOTAL do documento, em número. Numa NF-e é o "Valor Total da Nota";\n` +
  `  numa NFS-e é o valor do serviço ANTES das retenções. Nunca some linhas por conta própria.\n` +
  `- "cnpj_emitente": só dígitos, de QUEM EMITIU. Não confunda com o do destinatário.\n` +
  `- "legivel": false quando o arquivo está escuro, cortado, borrado ou não mostra documento nenhum.\n` +
  `- Campo que não aparece no documento vai como null. Não invente e não deduza.`;

/** O formato da resposta, no jeito que o Gemini aceita. */
export const SCHEMA_TRIAGEM = {
  type: "object",
  properties: {
    tipo: { type: "string" },
    emitente: { type: "string", nullable: true },
    cnpj_emitente: { type: "string", nullable: true },
    numero: { type: "string", nullable: true },
    valor_total: { type: "number", nullable: true },
    data: { type: "string", nullable: true },
    legivel: { type: "boolean" },
    resumo: { type: "string", nullable: true },
  },
  required: ["tipo", "legivel"],
};
