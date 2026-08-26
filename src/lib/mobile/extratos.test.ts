import { describe, it, expect } from "vitest";
import {
  agruparPorDia, casaBusca, categoriasDe, filtrar, fmtDiaCurto, fmtDocumento, lerPaginado,
  limitesDoMes, mesDe, nomearContrapartes, normalizarBanco, normalizarCartao, PAGINA, rotuloDia,
  rotuloMes, rotuloMesLongo, somaMes, TETO, totais, ultimosMeses,
  type LinhaBanco, type LinhaCartao,
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
    // O Asaas não manda contraparte NEM documento — daí os dois nulos aqui.
    const asaas = normalizarBanco(
      banco({ contraparte_nome: null, contraparte_documento: null, historico: "Taxa de mensageria" }),
    );
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
    // A linha de apoio é o que identifica a contraparte, e aqui é o CNPJ — o histórico
    // ("PIX EMITIDO OUTRA IF") só repetiria a natureza que já está no card.
    expect(l.detalhe).toBe("08.335.789/0001-43");
    // O CNPJ estava escondido dentro do nome — a coluna própria vem nula.
    expect(l.campos).toContainEqual(["CPF/CNPJ", "08.335.789/0001-43"]);
    // A busca ainda varre o texto cru: se o parser errar, o lançamento continua achável.
    expect(casaBusca(l.busca, "08.335.789")).toBe(true);
    expect(casaBusca(l.busca, "coffe junina")).toBe(true);
  });

  it("Pix sem nome mostra o rótulo da operação, não o histórico do banco", () => {
    const l = normalizarBanco(
      banco({
        contraparte_nome: "Pagamento Pix|@62.457.707 0001-89|@",
        contraparte_documento: null,
        historico: "PIX EMITIDO OUTRA IF",
      }),
    );
    expect(l.titulo).toBe("Pagamento Pix");
    expect(l.documento).toBe("62.457.707/0001-89");
    expect(l.detalhe).toBe("62.457.707/0001-89");
    // "Pagamento Pix" descreve a operação — não pode ser gravado como contraparte.
    expect(l.campos).toContainEqual(["Operação", "Pagamento Pix"]);
    expect(l.campos.map(([k]) => k)).not.toContain("Contraparte");
  });

  it("formata o CNPJ que o Sicoob manda com espaço no lugar da barra", () => {
    expect(fmtDocumento("37.511.891 0001-50")).toBe("37.511.891/0001-50");
    expect(fmtDocumento("11222333000144")).toBe("11.222.333/0001-44");
    expect(fmtDocumento("12345678901")).toBe("123.456.789-01");
    expect(fmtDocumento("***.866.877-**")).toBe("***.866.877-**"); // mascarado vai como veio
    expect(fmtDocumento(null)).toBeNull();
  });

  it("classifica a natureza pelo histórico — imposto ganha de pix", () => {
    expect(normalizarBanco(banco({ historico: "PIX ENVIADO" })).cat).toBe("pix_out");
    expect(normalizarBanco(banco({ historico: "PAGAMENTO DARF VIA PIX" })).cat).toBe("imposto");
    expect(normalizarBanco(banco({ historico: "TARIFA PACOTE DE SERVICOS" })).cat).toBe("tarifa");
  });
});

describe("nomearContrapartes", () => {
  // Um cadastro de mentira: CNPJ (só dígitos) -> nome, como a Parametrização devolve.
  const cadastro = (mapa: Record<string, string>) => (nome: string, doc: string | null) =>
    mapa[(doc ?? "").replace(/\D/g, "")] ?? mapa[nome] ?? null;

  const pixSemNome = () =>
    normalizarBanco(
      banco({
        contraparte_nome: "Pagamento Pix|@32.223.020 0001-18|@",
        contraparte_documento: null,
        historico: "PIX EMITIDO OUTRA IF",
      }),
    );

  it("dá nome ao Pix que só trouxe CNPJ, e o CNPJ continua na linha de apoio", () => {
    const [l] = nomearContrapartes([pixSemNome()], cadastro({ "32223020000118": "Flash App" }));
    expect(l.titulo).toBe("Flash App");
    // O rótulo trocado não era nome de ninguém: quem identifica a linha segue sendo o CNPJ.
    expect(l.detalhe).toBe("32.223.020/0001-18");
    expect(l.campos[0]).toEqual(["Contraparte no cadastro", "Flash App"]);
  });

  it("o apelido entra no texto que a busca varre, sem tirar o que já estava lá", () => {
    const [l] = nomearContrapartes([pixSemNome()], cadastro({ "32223020000118": "Flash App" }));
    expect(casaBusca(l.busca, "flash")).toBe(true);
    expect(casaBusca(l.busca, "32.223.020")).toBe(true);
    expect(casaBusca(l.busca, "pagamento pix")).toBe(true);
  });

  it("com nome no extrato, o apelido sobe e o nome cru desce", () => {
    const linha = normalizarBanco(
      banco({
        contraparte_nome: "Recebimento Pix|@ATTA TECNOLOGIA LTDA.|@02.568.314 0001-10|@",
        contraparte_documento: null,
        tipo: "credito",
      }),
    );
    const [l] = nomearContrapartes([linha], cadastro({ "02568314000110": "Atta" }));
    expect(l.titulo).toBe("Atta");
    expect(l.detalhe).toBe("ATTA TECNOLOGIA LTDA.");
  });

  it("no cartão casa pelo nome, que é tudo o que o OFX manda", () => {
    const [l] = nomearContrapartes(
      [normalizarCartao(cartao({ estabelecimento: "COMARELLA PIZZA BURG" }))],
      cadastro({ "COMARELLA PIZZA BURG": "Comarella" }),
    );
    expect(l.titulo).toBe("Comarella");
    expect(l.detalhe).toBe("COMARELLA PIZZA BURG");
  });

  it("sem cadastro, ou com o mesmo nome, a linha não é mexida", () => {
    const original = pixSemNome();
    expect(nomearContrapartes([original], cadastro({}))[0]).toBe(original);

    const nomeada = normalizarBanco(banco({ contraparte_documento: null }));
    expect(nomearContrapartes([nomeada], cadastro({ "INGRAM MICRO BRASIL LTDA": "ingram micro brasil ltda" }))[0])
      .toBe(nomeada);
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

describe("lerPaginado", () => {
  /** Uma tabela de `n` linhas que responde a `.range()` como o PostgREST responde. */
  const tabela = (n: number, opts: { count?: boolean } = { count: true }) => {
    const todas = Array.from({ length: n }, (_, i) => ({ id: `l${i}` }));
    const chamadas: [number, number][] = [];
    const consulta = async (de: number, ate: number) => {
      chamadas.push([de, ate]);
      // O teto de mil é do servidor: ele corta a fatia pedida, não importa o que se peça.
      return {
        data: todas.slice(de, Math.min(ate + 1, de + PAGINA)),
        error: null,
        count: opts.count ? n : undefined,
      };
    };
    return { consulta, chamadas };
  };

  it("traz o mês inteiro, e não o primeiro milheiro — o bug de agosto/26 do Asaas", async () => {
    const { consulta } = tabela(6017);
    const { dados, truncado } = await lerPaginado(consulta);
    expect(dados.length).toBe(6017);
    expect(truncado).toBe(false);
  });

  it("um mês que cabe numa página faz UMA consulta só", async () => {
    const { consulta, chamadas } = tabela(640); // uma fatura de cartão real
    expect((await lerPaginado(consulta)).dados.length).toBe(640);
    expect(chamadas).toEqual([[0, PAGINA - 1]]);
  });

  it("as páginas voltam na ordem pedida, mesmo saindo em paralelo", async () => {
    const { dados } = await lerPaginado(tabela(2500).consulta);
    expect(dados.map((l) => l.id)).toEqual(Array.from({ length: 2500 }, (_, i) => `l${i}`));
  });

  it("linha repetida entre páginas é contada uma vez só", async () => {
    // O que acontece quando a sync insere durante a leitura: a janela inteira desliza um
    // degrau, e a última linha da página anterior reaparece na seguinte. Contada duas
    // vezes ela infla o total — o defeito que esta tela existe para não ter.
    const linha = (i: number) => ({ id: `l${i}` });
    const { dados } = await lerPaginado(async (de) =>
      de === 0
        ? { data: Array.from({ length: PAGINA }, (_, i) => linha(i)), error: null, count: 1500 }
        // desloca em 1: `l999` volta na segunda página
        : { data: Array.from({ length: 500 }, (_, i) => linha(de - 1 + i)), error: null, count: 1500 },
    );
    expect(dados.length).toBe(1499);
    expect(new Set(dados.map((l) => l.id)).size).toBe(1499);
  });

  it("erro estoura em vez de virar 'nenhum lançamento'", async () => {
    await expect(
      lerPaginado(async () => ({ data: null, error: { message: "permission denied" } })),
    ).rejects.toThrow("permission denied");
  });

  it("erro numa página do meio também estoura", async () => {
    await expect(
      lerPaginado(async (de) =>
        de === 0
          ? { data: Array.from({ length: PAGINA }, (_, i) => ({ id: `l${i}` })), error: null, count: 2500 }
          : { data: null, error: { message: "timeout" } },
      ),
    ).rejects.toThrow("timeout");
  });

  it("sem contagem, anda de página em página até vir uma incompleta", async () => {
    const { consulta, chamadas } = tabela(2500, { count: false });
    const { dados } = await lerPaginado(consulta);
    expect(dados.length).toBe(2500);
    expect(chamadas.length).toBe(3);
  });

  it("passar do teto corta a lista e avisa, em vez de fingir que coube", async () => {
    const { dados, truncado } = await lerPaginado(tabela(TETO + 500).consulta);
    expect(dados.length).toBe(TETO);
    expect(truncado).toBe(true);
  });
});
