import { describe, it, expect } from "vitest";
import {
  motivoBloqueio, motivoCurto, podeEmitir, resumoLote, xmlAindaVale, formatarDoc, statusAsaas, foiPaga,
  type LinhaNota, type Situacao,
} from "./notasFiscais";

const linha = (over: Partial<LinhaNota> = {}): LinhaNota => ({
  id_asaas: "pay_1", descricao: "Takeat - Plano Básico", cliente_asaas: "Restaurante X",
  cnpj_cpf: "37511891000150", valor: 249, data_vencimento: "2026-08-10", data_pagamento: "2026-08-10",
  status_asaas: "RECEIVED", estornado: false, nf_asaas_status: null, nf_asaas_numero: null,
  n_cod_os: null, os_etapa: null, os_faturada: null,
  nfse_numero: null, nfse_status: null, nfse_xml: null, nfse_mensagem: null, situacao: "falta",
  ...over,
});

describe("motivoCurto", () => {
  // As frases são as que a prefeitura devolveu de verdade nas 277 OS presas.
  it("reduz o E0240 ao que a pessoa precisa consertar", () => {
    const m = motivoCurto("E0240 : O CEP informado para o endereço nacional do tomador do serviço não existe ou não pertence ao município do endereço do tomador.");
    expect(m).toBe("CEP do tomador não confere com o município");
  });

  it("reconhece a recusa de conexão, que não é crítica da nota", () => {
    expect(motivoCurto('A prefeitura respondeu "403 - Forbidden: Access is denied." (recusa do webservice, não crítica da nota).'))
      .toMatch(/403/);
  });

  it("mensagem desconhecida volta sem o código, e não vazia", () => {
    const m = motivoCurto("E0999 : Alguma crítica nova que ninguém mapeou ainda.");
    expect(m).toBe("Alguma crítica nova que ninguém mapeou ainda.");
  });

  it("sem mensagem, nada a mostrar", () => {
    expect(motivoCurto(null)).toBeNull();
    expect(motivoCurto("")).toBeNull();
  });
});

describe("motivoBloqueio", () => {
  it("libera a cobrança recebida, com documento e sem nota", () => {
    expect(motivoBloqueio(linha())).toBeNull();
    expect(podeEmitir(linha())).toBe(true);
  });

  it("o estorno vence qualquer outra condição", () => {
    // A linha abaixo passaria em tudo o mais; o estorno é que a barra, e a
    // mensagem tem de ser a do estorno — não a de 'já tem nota'.
    const l = linha({ estornado: true, situacao: "nota_a_cancelar", nfse_status: "004" });
    expect(motivoBloqueio(l)).toMatch(/estornada/i);
  });

  it("barra o que já tem nota, dos dois lados", () => {
    expect(motivoBloqueio(linha({ situacao: "emitida_omie" }))).toMatch(/Omie/);
    expect(motivoBloqueio(linha({ situacao: "emitida_asaas" }))).toMatch(/Asaas/);
  });

  it("barra a OS já faturada esperando o RPS", () => {
    expect(motivoBloqueio(linha({ situacao: "em_processamento" }))).toMatch(/RPS/);
  });

  it("barra a rejeitada — a OS já existe, emitir aqui duplicaria", () => {
    const m = motivoBloqueio(linha({ situacao: "nota_rejeitada", nfse_status: "003", n_cod_os: 123 }));
    expect(m).toMatch(/rejeitou/i);
    expect(m).toMatch(/duplicaria/i);
  });

  it("barra cobrança não recebida", () => {
    expect(motivoBloqueio(linha({ situacao: "nao_exige", status_asaas: "PENDING" }))).toMatch(/não foi recebida/i);
  });

  it("barra cliente sem documento — é ele que casa com o Omie", () => {
    expect(motivoBloqueio(linha({ cnpj_cpf: null }))).toMatch(/CNPJ/);
    expect(motivoBloqueio(linha({ cnpj_cpf: "" }))).toMatch(/CNPJ/);
  });

  it("barra valor não positivo e cobrança sem data", () => {
    expect(motivoBloqueio(linha({ valor: 0 }))).toMatch(/zerado/i);
    expect(motivoBloqueio(linha({ valor: -10 }))).toMatch(/zerado/i);
    expect(motivoBloqueio(linha({ data_vencimento: null, data_pagamento: null }))).toMatch(/sem data/i);
  });

  it("uma data basta — o Asaas limpa o paymentDate em certos casos", () => {
    expect(motivoBloqueio(linha({ data_pagamento: null }))).toBeNull();
    expect(motivoBloqueio(linha({ data_vencimento: null }))).toBeNull();
  });
});

describe("resumoLote", () => {
  const linhas = [
    linha({ id_asaas: "a" }),
    linha({ id_asaas: "b", valor: 100 }),
    linha({ id_asaas: "c", situacao: "emitida_asaas" }),
    linha({ id_asaas: "d", estornado: true }),
    linha({ id_asaas: "e", cnpj_cpf: null }),
  ];

  it("separa o que vai do que fica, e soma só o que vai", () => {
    const r = resumoLote(linhas, new Set(["a", "b", "c", "d", "e"]));
    expect(r.selecionadas).toBe(5);
    expect(r.emitiveis).toBe(2);
    expect(r.bloqueadas).toBe(3);
    expect(r.valor).toBe(349);
  });

  it("ignora id selecionado que não está na lista", () => {
    const r = resumoLote(linhas, new Set(["a", "zzz"]));
    expect(r.selecionadas).toBe(1);
    expect(r.emitiveis).toBe(1);
  });

  it("agrupa os motivos, do mais frequente para o menos", () => {
    const muitos = [
      linha({ id_asaas: "x1", estornado: true }),
      linha({ id_asaas: "x2", estornado: true }),
      linha({ id_asaas: "x3", cnpj_cpf: null }),
    ];
    const r = resumoLote(muitos, new Set(["x1", "x2", "x3"]));
    expect(r.motivos[0][1]).toBe(2);
    expect(r.motivos[0][0]).toMatch(/estornada/i);
  });

  it("lote vazio não quebra", () => {
    const r = resumoLote(linhas, new Set());
    expect(r).toMatchObject({ selecionadas: 0, emitiveis: 0, bloqueadas: 0, valor: 0 });
  });
});

describe("xmlAindaVale", () => {
  const agora = Date.parse("2026-08-18T12:00:00Z");

  it("a URL assinada do Omie expira e o link morto não deve ser oferecido", () => {
    // 1700000000 = nov/2023. 1787170863 é o Expires real que o Omie devolveu em
    // 18/08/26 — cerca de 24h de validade, e por isso ainda vale às 12h daquele dia.
    const vencido = "https://cdn.omie.com.br/x.xml?Expires=1700000000&Signature=abc";
    const valido = "https://cdn.omie.com.br/x.xml?Expires=1787170863&Signature=abc";
    expect(xmlAindaVale(vencido, agora)).toBe(false);
    expect(xmlAindaVale(valido, agora)).toBe(true);
  });

  it("sem carimbo de validade, deixa tentar", () => {
    expect(xmlAindaVale("https://cdn.omie.com.br/x.xml", agora)).toBe(true);
  });

  it("sem URL, não vale", () => {
    expect(xmlAindaVale(null)).toBe(false);
    expect(xmlAindaVale("")).toBe(false);
  });
});

describe("statusAsaas", () => {
  it("separa recebida de confirmada — confirmada é dinheiro que ainda não caiu", () => {
    expect(statusAsaas("RECEIVED")).toMatchObject({ rotulo: "Recebida", tom: "ok" });
    expect(statusAsaas("CONFIRMED")).toMatchObject({ rotulo: "Confirmada", tom: "aviso" });
    expect(statusAsaas("CONFIRMED").ajuda).toMatch(/liquida/i);
  });

  it("recebida em dinheiro conta como recebida", () => {
    expect(statusAsaas("RECEIVED_IN_CASH").rotulo).toBe("Recebida");
  });

  it("aceita minúscula", () => {
    expect(statusAsaas("received").rotulo).toBe("Recebida");
  });

  it("status desconhecido volta cru em vez de sumir", () => {
    expect(statusAsaas("STATUS_NOVO_DO_ASAAS")).toMatchObject({ rotulo: "STATUS_NOVO_DO_ASAAS", tom: "neutro" });
    expect(statusAsaas(null).rotulo).toBe("—");
  });

  it("as três formas de pago contam; as demais não", () => {
    expect(foiPaga("RECEIVED")).toBe(true);
    expect(foiPaga("CONFIRMED")).toBe(true);
    expect(foiPaga("RECEIVED_IN_CASH")).toBe(true);
    expect(foiPaga("PENDING")).toBe(false);
    expect(foiPaga("REFUNDED")).toBe(false);
    expect(foiPaga(null)).toBe(false);
  });
});

describe("formatarDoc", () => {
  it("formata CNPJ e CPF", () => {
    expect(formatarDoc("37511891000150")).toBe("37.511.891/0001-50");
    expect(formatarDoc("06419108195")).toBe("064.191.081-95");
  });
  it("devolve o que veio quando não é nem um nem outro", () => {
    expect(formatarDoc("123")).toBe("123");
    expect(formatarDoc(null)).toBe("");
  });
});
