import { describe, it, expect } from "vitest";
import {
  motivoBloqueio, motivoCurto, podeEmitir, exigeAvulsa, resumoLote, xmlAindaVale, formatarDoc, statusAsaas, foiPaga,
  vereditoProntidao, oQueFazer, diasDoCadastro, clientesEmTexto, recadoDoCadastro,
  chaveNfseValida, linkPortalNacional, chaveEmBlocos,
  type LinhaNota, type Situacao, type ClienteFaltante, type CadastroNoOmie,
} from "./notasFiscais";

const linha = (over: Partial<LinhaNota> = {}): LinhaNota => ({
  id_asaas: "pay_1", descricao: "Takeat - Plano Básico", cliente_asaas: "Restaurante X",
  cnpj_cpf: "37511891000150", valor: 249, data_vencimento: "2026-08-10", data_pagamento: "2026-08-10",
  status_asaas: "RECEIVED", estornado: false, nf_asaas_status: null, nf_asaas_numero: null,
  n_cod_os: null, os_etapa: null, os_faturada: null,
  nfse_numero: null, nfse_status: null, nfse_xml: null, nfse_chave: null,
  nfse_mensagem: null, situacao: "falta",
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

  /* A confirmada é o caso que a tela deixava passar: o Asaas a dá como paga, o
   * painel a classifica como "falta nota", e ela some no meio das recebidas. Só
   * que autorização de cartão pode não liquidar — e a nota sobre ela é imposto
   * sobre receita que nunca existiu, desfeito só com cancelamento. */
  it("barra a confirmada: autorizada não é liquidada", () => {
    const m = motivoBloqueio(linha({ status_asaas: "CONFIRMED", situacao: "falta" }));
    expect(m).toMatch(/confirmada/i);
    expect(m).toMatch(/liquid/i);
    expect(podeEmitir(linha({ status_asaas: "CONFIRMED" }))).toBe(false);
  });

  it("recebida em dinheiro emite como recebida", () => {
    expect(motivoBloqueio(linha({ status_asaas: "RECEIVED_IN_CASH" }))).toBeNull();
  });

  /* O estorno tem três caras. O parcial NÃO tem status próprio — a cobrança
   * segue "RECEIVED" e o dinheiro devolvido só existe em refunds[] — e é a
   * coluna `estornado` do painel que soma as três. */
  it("as três caras do estorno barram, inclusive a parcial que segue recebida", () => {
    expect(motivoBloqueio(linha({ status_asaas: "REFUNDED", estornado: true }))).toMatch(/estornada/i);
    expect(motivoBloqueio(linha({ status_asaas: "RECEIVED", estornado: true }))).toMatch(/estornada/i);
    expect(motivoBloqueio(linha({ status_asaas: "CHARGEBACK_REQUESTED", estornado: true }))).toMatch(/estornada/i);
  });

  // Status novo do Asaas que ninguém mapeou não pode virar nota por omissão.
  it("status desconhecido não emite", () => {
    expect(podeEmitir(linha({ status_asaas: "STATUS_NOVO_DO_ASAAS" }))).toBe(false);
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

/* ---------------------------------------------------------------------------
 * A RÉGUA LARGA — o que a emissão avulsa alcança, e o muito que ela não.
 *
 * São duas réguas e não uma afrouxada, e o valor destes testes está quase todo
 * na segunda metade: a lista do que continua barrado. Uma implementação que
 * liberasse a confirmada passaria no primeiro caso e ainda assim seria o pior
 * defeito possível deste módulo se deixasse a estornada passar junto.
 * ------------------------------------------------------------------------- */
describe("motivoBloqueio — emissão avulsa", () => {
  it("a confirmada passa: é o único status que a avulsa acrescenta", () => {
    const l = linha({ status_asaas: "CONFIRMED", situacao: "falta" });
    expect(podeEmitir(l)).toBe(false);
    expect(podeEmitir(l, { avulsa: true })).toBe(true);
    expect(motivoBloqueio(l, { avulsa: true })).toBeNull();
  });

  it("a recebida continua passando — a avulsa amplia, não substitui", () => {
    expect(podeEmitir(linha({ status_asaas: "RECEIVED" }), { avulsa: true })).toBe(true);
    expect(podeEmitir(linha({ status_asaas: "RECEIVED_IN_CASH" }), { avulsa: true })).toBe(true);
  });

  /* O caso que não pode falhar nunca. Emitir sobre receita devolvida cria
   * imposto sobre dinheiro que voltou ao cliente, e a nota não se apaga:
   * cancela-se, com prazo e justificativa. Não há urgência que justifique. */
  it("ESTORNO barra na avulsa, nas três caras", () => {
    for (const l of [
      linha({ status_asaas: "REFUNDED", estornado: true }),
      linha({ status_asaas: "RECEIVED", estornado: true }),        // parcial: segue "recebida"
      linha({ status_asaas: "CONFIRMED", estornado: true }),       // confirmada E devolvida
      linha({ status_asaas: "CHARGEBACK_REQUESTED", estornado: true }),
    ]) {
      expect(motivoBloqueio(l, { avulsa: true })).toMatch(/estornada/i);
    }
  });

  it("a avulsa vai até a confirmada e não além", () => {
    for (const st of ["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS", "STATUS_NOVO_DO_ASAAS"]) {
      expect(podeEmitir(linha({ status_asaas: st }), { avulsa: true })).toBe(false);
    }
  });

  // As guardas de duplicata respondem "esta nota já saiu?", que é outra pergunta
  // — e nenhuma delas tem urgência do outro lado que a justifique ceder.
  it("nenhuma guarda contra nota duplicada cede", () => {
    expect(podeEmitir(linha({ situacao: "emitida_omie" }), { avulsa: true })).toBe(false);
    expect(podeEmitir(linha({ situacao: "emitida_asaas" }), { avulsa: true })).toBe(false);
    expect(podeEmitir(linha({ situacao: "em_processamento" }), { avulsa: true })).toBe(false);
    expect(podeEmitir(linha({ situacao: "nota_rejeitada" }), { avulsa: true })).toBe(false);
  });

  it("cadastro e valor continuam valendo — não é régua de dinheiro", () => {
    expect(podeEmitir(linha({ status_asaas: "CONFIRMED", cnpj_cpf: null }), { avulsa: true })).toBe(false);
    expect(podeEmitir(linha({ status_asaas: "CONFIRMED", valor: 0 }), { avulsa: true })).toBe(false);
    expect(podeEmitir(
      linha({ status_asaas: "CONFIRMED", data_vencimento: null, data_pagamento: null }),
      { avulsa: true },
    )).toBe(false);
  });

  // A régua estreita, desligada, tem de continuar sendo exatamente o que era —
  // é ela que a rodada diária das 13h usa.
  it("desligada, a régua é a de antes", () => {
    expect(podeEmitir(linha({ status_asaas: "CONFIRMED" }))).toBe(false);
    expect(motivoBloqueio(linha({ status_asaas: "CONFIRMED" }))).toMatch(/confirmada/i);
  });
});

describe("exigeAvulsa", () => {
  it("é verdade só para quem a chave resgata", () => {
    expect(exigeAvulsa(linha({ status_asaas: "CONFIRMED", situacao: "falta" }))).toBe(true);
  });

  it("é falso para quem já emitia sem ela", () => {
    expect(exigeAvulsa(linha({ status_asaas: "RECEIVED" }))).toBe(false);
  });

  it("é falso para quem nem a chave resgata — o selo não promete o impossível", () => {
    expect(exigeAvulsa(linha({ status_asaas: "CONFIRMED", estornado: true }))).toBe(false);
    expect(exigeAvulsa(linha({ status_asaas: "OVERDUE" }))).toBe(false);
    expect(exigeAvulsa(linha({ situacao: "emitida_omie" }))).toBe(false);
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

  /* `confirmadas` é o número que o aviso de confirmação precisa dizer em voz
   * alta: quantas do lote saem ANTES de o dinheiro entrar. Sem ele, "emitir 3
   * notas" seria a mesma frase para um lote todo recebido e para um metade
   * confirmado. */
  it("conta e soma à parte as que só saem como avulsa", () => {
    const mistas = [
      linha({ id_asaas: "r1", valor: 100 }),                                          // recebida
      linha({ id_asaas: "c1", valor: 200, status_asaas: "CONFIRMED" }),
      linha({ id_asaas: "c2", valor: 300, status_asaas: "CONFIRMED" }),
      linha({ id_asaas: "x1", valor: 999, estornado: true }),                          // barrada nas duas
    ];
    const todas = new Set(["r1", "c1", "c2", "x1"]);

    const estreita = resumoLote(mistas, todas);
    expect(estreita.emitiveis).toBe(1);
    expect(estreita.valor).toBe(100);
    expect(estreita.confirmadas).toBe(0);

    const larga = resumoLote(mistas, todas, { avulsa: true });
    expect(larga.emitiveis).toBe(3);
    expect(larga.valor).toBe(600);
    expect(larga.confirmadas).toBe(2);
    expect(larga.valorConfirmadas).toBe(500);
    // A estornada continua fora, e é o único motivo que sobra.
    expect(larga.bloqueadas).toBe(1);
    expect(larga.motivos[0][0]).toMatch(/estornada/i);
  });

  // `confirmadas` conta só entre as que VÃO sair: uma confirmada que a régua
  // larga também barra (estornada, sem CNPJ) inflaria o aviso com cobrança que
  // ninguém vai emitir.
  it("não conta como confirmada quem nem a avulsa emite", () => {
    const l = [
      linha({ id_asaas: "z1", status_asaas: "CONFIRMED", estornado: true }),
      linha({ id_asaas: "z2", status_asaas: "CONFIRMED", cnpj_cpf: null }),
    ];
    const r = resumoLote(l, new Set(["z1", "z2"]), { avulsa: true });
    expect(r.emitiveis).toBe(0);
    expect(r.confirmadas).toBe(0);
    expect(r.valorConfirmadas).toBe(0);
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

describe("linkPortalNacional", () => {
  // Chave real da NFS-e 16902, emitida em 20/08/26 (OS 5512255820). Ela se lê:
  // 3205309 (Vitória/ES) · 2 · 2 · 37511891000150 (nosso CNPJ) · 0000000016902
  // (o número da nota) · 2608 (a competência) · 794739071 · 0 (DV).
  const CHAVE = "32053092237511891000150000000001690226087947390710";

  it("os 50 dígitos abrem a nota, com a chave já preenchida", () => {
    expect(linkPortalNacional(CHAVE))
      .toBe(`https://www.nfse.gov.br/consultapublica/?tpc=1&chave=${CHAVE}`);
  });

  it("o código curto do padrão ABRASF antigo NÃO vira link", () => {
    // O campo é o mesmo (`cCodVerif`); só no padrão nacional ele traz a chave.
    // Oferecer link para "A1B2C3D4" levaria a pessoa a um formulário que recusa.
    expect(linkPortalNacional("A1B2C3D4")).toBeNull();
    expect(linkPortalNacional("123456789")).toBeNull();
  });

  it("chave com letra, ou com 49/51 dígitos, não vira link", () => {
    expect(linkPortalNacional(CHAVE.slice(0, 49))).toBeNull();
    expect(linkPortalNacional(CHAVE + "0")).toBeNull();
    expect(linkPortalNacional(CHAVE.slice(0, 49) + "X")).toBeNull();
  });

  it("sem chave, sem link — nota antiga ou OS ainda não relida", () => {
    expect(linkPortalNacional(null)).toBeNull();
    expect(linkPortalNacional("")).toBeNull();
    expect(linkPortalNacional(undefined)).toBeNull();
  });

  it("espaço em volta não invalida a chave", () => {
    expect(linkPortalNacional(` ${CHAVE} `)).toContain(CHAVE);
    expect(chaveNfseValida(` ${CHAVE} `)).toBe(true);
  });

  it("chaveEmBlocos deixa os 50 dígitos conferíveis a olho", () => {
    const b = chaveEmBlocos(CHAVE);
    expect(b.startsWith("3205 3092 2375")).toBe(true);
    expect(b.replace(/ /g, "")).toBe(CHAVE);
    // Sem espaço sobrando no fim: o último bloco tem 2 dígitos (50 = 12×4 + 2).
    expect(b.endsWith("10")).toBe(true);
    expect(chaveEmBlocos(null)).toBe("");
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
      .toBe("Cadastrar o cliente no Omie com este CNPJ/CPF — é o que o botão faz.");
  });

  // Guarda contra dado inconsistente: classe diz "divergente" mas o par não veio.
  // Sem isto a frase sairia com "undefined" no meio.
  it("classe divergente sem par vira a instrução de cadastrar", () => {
    expect(oQueFazer({ classe: "cadastro_divergente", via: null, omie_nome: null, omie_doc: null }))
      .toMatch(/^Cadastrar/);
  });
});

describe("recadoDoCadastro", () => {
  const cad = (over: Partial<CadastroNoOmie> = {}): CadastroNoOmie => ({
    doc: "42580372000184", nome: "Maya Tecsaúde", n_cod_cli: 5513230459,
    situacao: "criado", motivo: null, fonte_endereco: "receita",
    tentativas: 1, atualizado_em: "2026-08-24T17:00:00Z",
    ...over,
  });

  it("criado diz de onde veio o endereço — é o que se confere quando a nota é recusada", () => {
    const r = recadoDoCadastro(cad());
    expect(r.tom).toBe("ok");
    expect(r.ajuda).toMatch(/Receita Federal/);
    expect(r.ajuda).toMatch(/5513230459/);
  });

  /* `ja_existia` é sucesso, não erro, e a distinção não é cosmética: ela diz que
   * o cadastro sempre esteve no Omie e quem errou foi o espelho semanal. Tratar
   * como falha mandaria alguém cadastrar de novo — e aí sim viria o duplicado. */
  it("já existia é boa notícia, e a frase aponta o espelho e não o Omie", () => {
    const r = recadoDoCadastro(cad({ situacao: "ja_existia", n_cod_cli: null }));
    expect(r.tom).toBe("ok");
    expect(r.ajuda).toMatch(/espelho local/i);
  });

  // Bloqueio é dado ruim do cliente, e a frase tem de dizer onde consertar —
  // "tentar de novo" não conserta CEP que não existe.
  it("bloqueio vira a instrução de conserto, não uma mensagem de erro", () => {
    const r = recadoDoCadastro(cad({ situacao: "bloqueado", motivo: "cep_inexistente", fonte_endereco: null }));
    expect(r.tom).toBe("aviso");
    expect(r.ajuda).toMatch(/E0240/);
    expect(r.ajuda).toMatch(/corrija o CEP no Asaas/i);
  });

  // Motivo que ainda não tem tradução não pode virar "undefined" na tela.
  it("bloqueio desconhecido mostra o motivo cru em vez de sumir", () => {
    expect(recadoDoCadastro(cad({ situacao: "bloqueado", motivo: "motivo_novo" })).ajuda).toBe("motivo_novo");
  });

  it("recusa do Omie é erro e mostra o que ele respondeu", () => {
    const r = recadoDoCadastro(cad({ situacao: "falhou", motivo: "Omie IncluirCliente: campo inválido" }));
    expect(r.tom).toBe("erro");
    expect(r.ajuda).toMatch(/campo inválido/);
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

/* ---------------------------------------------------------------------------
 * Emissão em massa — a cadência que fecha o mês.
 * ------------------------------------------------------------------------- */

import {
  somarBloco, precisaEsperarOLote, tetoDoDiaAtingido,
  esperaAntesDeRepetir, PROGRESSO_ZERO, CABEM_NUMA_CHAMADA,
  type RespostaEmissao,
} from "./notasFiscais";

describe("CABEM_NUMA_CHAMADA", () => {
  it("e 20, e nao o teto_lote de 50 — quem manda e o relogio do worker", () => {
    // Medido em 27/08/2026: 20 OS = 116s dos 150s da Edge Function, com duas
    // chamadas Omie seriais por cobranca. Uma leva de 50 seria derrubada pelo
    // relogio DEPOIS de ja ter criado metade das OS no Omie — e OS criada e nao
    // faturada fica ocupando o corredor de isolamento e trava a rodada seguinte.
    expect(CABEM_NUMA_CHAMADA).toBe(20);
  });
});

describe("somarBloco", () => {
  it("conta `em_processamento` como despachada, que é o desfecho normal do lote", () => {
    const r: RespostaEmissao = {
      resultados: [
        { id_asaas: "pay_1", ok: false, em_processamento: true },
        { id_asaas: "pay_2", ok: false, em_processamento: true },
      ],
    };
    const p = somarBloco(PROGRESSO_ZERO(3), r);
    expect(p.despachadas).toBe(2);
    expect(p.falhas).toBe(0); // o erro que faria alguém emitir tudo de novo
    expect(p.blocosFeitos).toBe(1);
  });

  it("separa os quatro desfechos e não mistura barrada com falha", () => {
    const r: RespostaEmissao = {
      resultados: [
        { id_asaas: "a", ok: false, em_processamento: true },
        { id_asaas: "b", ok: true, ja_emitida: true, aviso: "já tem nota" },
        { id_asaas: "c", ok: false, bloqueado: true, erro: "Cobrança estornada" },
        { id_asaas: "d", ok: false, erro: "IncluirOS recusou" },
      ],
    };
    const p = somarBloco(PROGRESSO_ZERO(1), r);
    expect([p.despachadas, p.jaEmitidas, p.barradas, p.falhas]).toEqual([1, 1, 1, 1]);
  });

  it("acumula entre blocos e agrupa os motivos do mais frequente para o menos", () => {
    const bloq = (erro: string) => ({ id_asaas: "x", ok: false, bloqueado: true, erro });
    let p = PROGRESSO_ZERO(2);
    p = somarBloco(p, { resultados: [bloq("Cobrança estornada"), bloq("Cobrança estornada")] });
    p = somarBloco(p, { resultados: [bloq("Cobrança estornada"), bloq("Sem cadastro no Omie")] });
    expect(p.barradas).toBe(4);
    expect(p.blocosFeitos).toBe(2);
    expect(p.motivos[0]).toEqual(["Cobrança estornada", 3]);
    expect(p.motivos[1]).toEqual(["Sem cadastro no Omie", 1]);
  });

  it("rodada sem resultado nenhum ainda registra POR QUE não andou", () => {
    const p = somarBloco(PROGRESSO_ZERO(1), { pulada: "teto do dia atingido (400/400)." });
    expect(p.motivos[0][0]).toMatch(/teto do dia/);
  });
});

describe("precisaEsperarOLote", () => {
  // A frase é a que a edge function devolve de verdade (`limparCorredor`).
  it("reconhece o lote em voo e manda repetir o mesmo bloco", () => {
    expect(precisaEsperarOLote({
      pulada: "o lote 5514257733 ainda está em processamento no Omie, com 20 OS na etapa 20. Nada foi criado — chame de novo em alguns minutos.",
    })).toBe(true);
  });

  it("não confunde nota em processamento na PREFEITURA com lote em voo", () => {
    // Esta é a resposta de sucesso: as notas foram despachadas. Esperar aqui
    // faria a emissão travar justamente quando está dando certo.
    expect(precisaEsperarOLote({
      resultados: [{ id_asaas: "a", em_processamento: true, erro: "Lote 551 disparado com 20 OS." }],
    })).toBe(false);
  });

  it("resposta limpa não pede espera", () => {
    expect(precisaEsperarOLote({ despachadas: 20, resultados: [] })).toBe(false);
  });
});

describe("tetoDoDiaAtingido", () => {
  it("distingue o freio de calendário da espera do lote — um repete, o outro para", () => {
    const teto: RespostaEmissao = { pulada: "teto do dia atingido (400/400)." };
    expect(tetoDoDiaAtingido(teto)).toBe(true);
    expect(precisaEsperarOLote(teto)).toBe(false);
  });

  it("o lote em voo não é teto do dia", () => {
    expect(tetoDoDiaAtingido({ pulada: "o lote 55 ainda está em processamento no Omie" })).toBe(false);
  });
});

describe("esperaAntesDeRepetir", () => {
  it("cresce a cada tentativa e para em 60s", () => {
    expect(esperaAntesDeRepetir(1)).toBe(10_000);
    expect(esperaAntesDeRepetir(2)).toBe(20_000);
    expect(esperaAntesDeRepetir(3)).toBe(40_000);
    expect(esperaAntesDeRepetir(4)).toBe(60_000);
    expect(esperaAntesDeRepetir(99)).toBe(60_000);
  });
});
