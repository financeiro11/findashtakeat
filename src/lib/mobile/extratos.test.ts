import { describe, it, expect } from "vitest";
import {
  agruparPorDia, casaBusca, categoriasDe, filtrar, fmtDiaCurto, limitesDoMes,
  mesDe, normalizarBanco, normalizarCartao, rotuloDia, rotuloMes, rotuloMesLongo,
  somaMes, totais, ultimosMeses, type LinhaBanco, type LinhaCartao,
} from "./extratos";

const cartao = (over: Partial<LinhaCartao> = {}): LinhaCartao => ({
  id: "c1", data: "2026-08-14", estabelecimento: "META ADS", categoria: "Marketing",
  descricao: "FACEBK *ADS 8817", parcela: null, cidade: "SAO PAULO",
  valor: 1240, tipo: "gasto", ...over,
});

const banco = (over: Partial<LinhaBanco> = {}): LinhaBanco => ({
  id: "b1", data_movimento: "2026-08-14", tipo: "debito", valor: 300,
  historico: "PIX ENVIADO", contraparte_nome: "INGRAM MICRO BRASIL LTDA",
  contraparte_documento: "11.222.333/0001-44", numero_documento: "998877", ...over,
});

describe("meses", () => {
  it("anda para trás e para frente sem escorregar na virada de ano", () => {
    expect(somaMes("2026-08", -1)).toBe("2026-07");
    expect(somaMes("2026-01", -1)).toBe("2025-12");
    expect(somaMes("2026-12", 1)).toBe("2027-01");
    expect(somaMes("2026-08", -14)).toBe("2025-06");
  });

  it("lista os últimos meses do mais novo para o mais velho", () => {
    expect(ultimosMeses("2026-08", 3)).toEqual(["2026-08", "2026-07", "2026-06"]);
  });

  it("acha o último dia do mês, inclusive em fevereiro bissexto", () => {
    expect(limitesDoMes("2026-08")).toEqual({ de: "2026-08-01", ate: "2026-08-31" });
    expect(limitesDoMes("2026-02")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(limitesDoMes("2028-02")).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
    expect(limitesDoMes("2026-04")).toEqual({ de: "2026-04-01", ate: "2026-04-30" });
  });

  it("rotula", () => {
    expect(rotuloMes("2026-08")).toBe("ago/26");
    expect(rotuloMesLongo("2026-03")).toBe("março de 2026");
    expect(mesDe("2026-08-14")).toBe("2026-08");
    expect(fmtDiaCurto("2026-08-14")).toBe("14/08");
    expect(rotuloDia("2026-08-14")).toContain("14/08");
    expect(rotuloDia("—")).toBe("Sem data");
  });
});

describe("normalizarCartao", () => {
  it("gasto é saída; pagamento e estorno abatem a fatura", () => {
    expect(normalizarCartao(cartao()).entrada).toBe(false);
    expect(normalizarCartao(cartao({ tipo: "pagamento" })).entrada).toBe(true);
    expect(normalizarCartao(cartao({ tipo: "estorno" })).entrada).toBe(true);
  });

  it("o valor fica positivo e a categoria vira a chave do filtro", () => {
    const l = normalizarCartao(cartao({ valor: "1240.50" }));
    expect(l.valor).toBe(1240.5);
    expect(l.cat).toBe("Marketing");
    expect(l.titulo).toBe("META ADS");
  });

  it("guarda o texto cru da fatura como detalhe, mas não repete o próprio nome", () => {
    expect(normalizarCartao(cartao()).detalhe).toBe("FACEBK *ADS 8817");
    expect(normalizarCartao(cartao({ descricao: "meta ads" })).detalhe).toBeNull();
  });

  it("a folha de detalhe mostra a parcela quando ela existe", () => {
    const rotulos = (l: LinhaCartao) => normalizarCartao(l).campos.map(([k]) => k);
    expect(rotulos(cartao({ parcela: "2/10" }))).toContain("Parcela");
    expect(rotulos(cartao())).not.toContain("Parcela");
  });
});

describe("normalizarBanco", () => {
  it("credito/debito viram entrada e o valor continua positivo", () => {
    expect(normalizarBanco(banco({ tipo: "credito" })).entrada).toBe(true);
    expect(normalizarBanco(banco({ tipo: "debito" })).entrada).toBe(false);
    expect(normalizarBanco(banco({ valor: -300 })).valor).toBe(300);
  });

  it("o título é a contraparte; sem ela (Asaas) cai no histórico", () => {
    expect(normalizarBanco(banco()).titulo).toBe("INGRAM MICRO BRASIL LTDA");
    const asaas = normalizarBanco(banco({ contraparte_nome: null, historico: "Taxa de mensageria" }));
    expect(asaas.titulo).toBe("Taxa de mensageria");
    expect(asaas.detalhe).toBeNull(); // não repete o título embaixo dele
  });

  it("desembrulha o pacote do Sicoob em vez de pôr a string crua no card", () => {
    const l = normalizarBanco(
      banco({
        contraparte_nome: "Pagamento Pix|@08.335.789 0001-43|@coffe festa junina",
        contraparte_documento: null,
        historico: "PIX EMITIDO OUTRA IF",
      }),
    );
    expect(l.titulo).toBe("coffe festa junina");
    expect(l.detalhe).toBe("PIX EMITIDO OUTRA IF");
    // O CNPJ estava escondido dentro do nome — a coluna própria vem nula.
    expect(l.campos).toContainEqual(["CPF/CNPJ", "08.335.789 0001-43"]);
    // A busca ainda varre o texto cru: se o parser errar, o lançamento continua achável.
    expect(casaBusca(l.busca, "08.335.789")).toBe(true);
    expect(casaBusca(l.busca, "coffe junina")).toBe(true);
  });

  it("classifica a natureza pelo histórico — imposto ganha de pix", () => {
    expect(normalizarBanco(banco({ historico: "PIX ENVIADO" })).cat).toBe("pix_out");
    expect(normalizarBanco(banco({ historico: "PAGAMENTO DARF VIA PIX" })).cat).toBe("imposto");
    expect(normalizarBanco(banco({ historico: "TARIFA PACOTE DE SERVICOS" })).cat).toBe("tarifa");
  });
});

describe("busca", () => {
  it("acha por termo em qualquer ordem, não por substring", () => {
    const l = normalizarBanco(banco());
    expect(casaBusca(l.busca, "ingram brasil")).toBe(true);
    expect(casaBusca(l.busca, "brasil ingram")).toBe(true);
    expect(casaBusca(l.busca, "ingram xpto")).toBe(false);
  });

  it("ignora acento e caixa", () => {
    const l = normalizarBanco(banco({ contraparte_nome: "JOSÉ DA SILVA SERVIÇOS" }));
    expect(casaBusca(l.busca, "jose servicos")).toBe(true);
  });

  it("acha pelo valor, redondo ou com centavos", () => {
    const l = normalizarCartao(cartao({ valor: 1240.5 }));
    expect(casaBusca(l.busca, "1241")).toBe(true); // arredondado
    expect(casaBusca(l.busca, "1240.50")).toBe(true);
  });

  it("busca vazia não filtra nada", () => {
    expect(casaBusca(normalizarCartao(cartao()).busca, "   ")).toBe(true);
  });

  it("acha o lançamento do cartão pela categoria digitada", () => {
    expect(casaBusca(normalizarCartao(cartao()).busca, "marketing")).toBe(true);
  });
});

describe("filtrar", () => {
  const linhas = [
    normalizarCartao(cartao({ id: "a", estabelecimento: "META ADS", categoria: "Marketing", valor: 1000 })),
    normalizarCartao(cartao({ id: "b", estabelecimento: "CURSOR", categoria: "Software", valor: 200 })),
    normalizarCartao(cartao({ id: "c", estabelecimento: "UBER", categoria: "Transporte", valor: 50 })),
  ];

  it("conjunto de categorias vazio significa TODAS", () => {
    expect(filtrar(linhas, "", new Set()).length).toBe(3);
  });

  it("combina categoria e busca", () => {
    expect(filtrar(linhas, "", new Set(["Software"])).map((l) => l.id)).toEqual(["b"]);
    expect(filtrar(linhas, "uber", new Set()).map((l) => l.id)).toEqual(["c"]);
    expect(filtrar(linhas, "uber", new Set(["Software"])).length).toBe(0);
  });
});

describe("totais e agrupamento", () => {
  it("separa entrada de saída em vez de somar com sinal misturado", () => {
    const t = totais([
      normalizarCartao(cartao({ id: "a", valor: 1000, tipo: "gasto" })),
      normalizarCartao(cartao({ id: "b", valor: 300, tipo: "pagamento" })),
    ]);
    expect(t).toEqual({ entradas: 300, saidas: 1000, saldo: -700, n: 2 });
  });

  it("categorias saem da que mais pesa para a que menos pesa", () => {
    const cats = categoriasDe([
      normalizarCartao(cartao({ id: "a", categoria: "Software", valor: 200 })),
      normalizarCartao(cartao({ id: "b", categoria: "Marketing", valor: 1000 })),
      normalizarCartao(cartao({ id: "c", categoria: "Software", valor: 100 })),
    ]);
    expect(cats.map((c) => c.chave)).toEqual(["Marketing", "Software"]);
    expect(cats[1]).toMatchObject({ n: 2, total: 300 });
  });

  it("agrupa por dia preservando a ordem de chegada", () => {
    const dias = agruparPorDia([
      normalizarCartao(cartao({ id: "a", data: "2026-08-14", valor: 100 })),
      normalizarCartao(cartao({ id: "b", data: "2026-08-12", valor: 40 })),
      normalizarCartao(cartao({ id: "c", data: "2026-08-14", valor: 60, tipo: "estorno" })),
    ]);
    expect(dias.map((d) => d.dia)).toEqual(["2026-08-14", "2026-08-12"]);
    expect(dias[0]).toMatchObject({ saidas: 100, entradas: 60 });
    expect(dias[0].linhas.map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("lançamento sem data cai num grupo próprio em vez de sumir", () => {
    const dias = agruparPorDia([normalizarCartao(cartao({ id: "a", data: null }))]);
    expect(dias[0].dia).toBe("—");
  });
});
