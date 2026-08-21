import { describe, it, expect } from "vitest";
import {
  motivoBloqueio, motivoCurto, podeEmitir, resumoLote, xmlAindaVale, formatarDoc, statusAsaas, foiPaga,
  vereditoProntidao, oQueFazer, diasDoCadastro, clientesEmTexto,
  type LinhaNota, type Situacao, type ClienteFaltante,
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

/* ---------------------------------------------------------------------------
 * Auditoria
 * ------------------------------------------------------------------------- */

const faltante = (over: Partial<ClienteFaltante> = {}): ClienteFaltante => ({
  doc: "37372287000271", nome: "Top Mix", cobrancas: 3, valor: 1393, ultima: "2026-07-28",
  sem_nota_hoje: 1, classe: "cadastro_divergente",
  omie_nome: "Top Mix", omie_doc: "37372287000190", forca: 1, via: "raiz",
  ...over,
});

describe("vereditoProntidao", () => {
  it("soma só o que NÃO está pronto, e conta clientes junto", () => {
    const v = vereditoProntidao([
      { classe: "ok", cobrancas: 3137, valor: 1349062.47, clientes: 2317 },
      { classe: "cadastro_divergente", cobrancas: 53, valor: 20831.01, clientes: 35 },
      { classe: "sem_cadastro_omie", cobrancas: 40, valor: 22040.6, clientes: 35 },
    ]);
    expect(v.total).toBe(3230);
    expect(v.cobrancas).toBe(93);
    expect(v.clientes).toBe(70);
    expect(v.valor).toBeCloseTo(42871.61, 2);
    expect(v.pronto).toBe(false);
    // Cobertura em fração, não em porcentagem — quem formata é a tela.
    expect(v.cobertura).toBeCloseTo(3137 / 3230, 6);
  });

  it("período inteiro cadastrado é `pronto`, e não 'zero de zero'", () => {
    const v = vereditoProntidao([{ classe: "ok", cobrancas: 100, valor: 5000, clientes: 40 }]);
    expect(v.pronto).toBe(true);
    expect(v.cobertura).toBe(1);
  });

  // Sem cobranças no período a divisão da cobertura seria 0/0 = NaN, e NaN na
  // tela vira "NaN%". Período vazio é período sem problema.
  it("período sem cobrança nenhuma não vira NaN", () => {
    const v = vereditoProntidao([]);
    expect(v.total).toBe(0);
    expect(v.pronto).toBe(true);
    expect(v.cobertura).toBe(1);
  });
});

describe("oQueFazer", () => {
  // A distinção que muda a ação: raiz igual é a MESMA empresa noutro
  // estabelecimento, e mandar cadastrar seria errado duas vezes.
  it("raiz igual manda conferir a filial, nunca cadastrar", () => {
    const t = oQueFazer(faltante());
    expect(t).toMatch(/mesma empresa/i);
    expect(t).toMatch(/37\.372\.287\/0001-90/);
    expect(t).not.toMatch(/cadastrar o cliente/i);
  });

  it("nome parecido com documento sem relação manda corrigir na origem", () => {
    const t = oQueFazer(faltante({ via: "nome", forca: 0.87, omie_nome: "Japamania - Vila Food", omie_doc: "52662815000130" }));
    expect(t).toMatch(/documento diferente/i);
    expect(t).toMatch(/corrija na origem/i);
  });

  it("sem nada equivalente no Omie, aí sim é cadastrar", () => {
    expect(oQueFazer(faltante({ classe: "sem_cadastro_omie", omie_nome: null, omie_doc: null, via: null, forca: null })))
      .toBe("Cadastrar o cliente no Omie com este CNPJ/CPF.");
  });

  // Guarda contra dado inconsistente: classe diz "divergente" mas o par não veio.
  // Sem isto a frase sairia com "undefined" no meio.
  it("classe divergente sem par vira a instrução de cadastrar", () => {
    expect(oQueFazer({ classe: "cadastro_divergente", via: null, omie_nome: null, omie_doc: null }))
      .toMatch(/^Cadastrar/);
  });
});

describe("diasDoCadastro", () => {
  const agora = Date.parse("2026-08-21T12:00:00Z");

  it("conta os dias inteiros desde a leitura", () => {
    expect(diasDoCadastro("2026-08-17T08:00:28.112+00:00", agora)).toBe(4);
    expect(diasDoCadastro("2026-08-21T08:00:00Z", agora)).toBe(0);
  });

  it("cadastro nunca lido não inventa número", () => {
    expect(diasDoCadastro(null, agora)).toBeNull();
    expect(diasDoCadastro("qualquer coisa", agora)).toBeNull();
  });

  // Relógio do banco adiantado em relação ao do navegador daria dias negativos,
  // que na frase viraria "lido há -1 dias".
  it("leitura no futuro não devolve dia negativo", () => {
    expect(diasDoCadastro("2026-08-22T08:00:00Z", agora)).toBe(0);
  });
});

describe("clientesEmTexto", () => {
  it("sai com cabeçalho e uma linha por cliente, separado por tabulação", () => {
    const txt = clientesEmTexto([faltante(), faltante({ doc: "42580372000184", nome: "Maya", classe: "sem_cadastro_omie", omie_nome: null, omie_doc: null, via: null, cobrancas: 1, valor: 4000 })]);
    const linhas = txt.split("\n");
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toMatch(/^Cliente\t/);
    // O documento sai formatado: quem cola isto vai procurar no Omie, que mostra
    // com pontuação.
    expect(linhas[1]).toContain("37.372.287/0002-71");
    expect(linhas[1]).toContain("Top Mix (37.372.287/0001-90)");
    // Sem par no Omie, a coluna fica vazia em vez de "null".
    expect(linhas[2].split("\t")[3]).toBe("");
    expect(linhas[2]).toContain("R$ 4.000,00");
  });

  it("lista vazia devolve só o cabeçalho", () => {
    expect(clientesEmTexto([]).split("\n")).toHaveLength(1);
  });
});
