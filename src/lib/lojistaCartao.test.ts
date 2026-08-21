import { describe, it, expect } from "vitest";
import { montarMapaApelidos } from "@/lib/apelidos";
import {
  chaveLojista, semValorNoFim, nomeContraparte, textoDaBusca,
  fraseDaNota, compraDe, itensDaNota,
  type MapaLojistas, type MapaCompras,
} from "@/lib/lojistaCartao";

const apelidos = montarMapaApelidos([
  { id: "1", nome: "LATAM", apelido: "Latam", oQueE: "Passagens do time" },
  { id: "2", nome: "LEROY MERLIN", apelido: "Material - Obra" },
  { id: "3", nome: "UBER", apelido: "Uber" },
]);

/* Recortes reais das duas bases: a chave é data + centavos. */
const lojistas: MapaLojistas = {
  "2026-07-31|61399": "LATAM",
  "2026-07-28|19075": "LEROY MERLIN",
  "2026-07-15|3913": "CENTRAL DE AVIAMENTO",
};

describe("chaveLojista", () => {
  it("junta data e valor em centavos", () => {
    expect(chaveLojista("2026-07-31", 613.99)).toBe("2026-07-31|61399");
  });

  it("ignora o sinal — a fatura é despesa e a auditoria guarda positivo", () => {
    expect(chaveLojista("2026-07-31", -613.99)).toBe("2026-07-31|61399");
  });

  it("corta o carimbo de hora quando a data vem com ele", () => {
    expect(chaveLojista("2026-07-31T00:00:00Z", 613.99)).toBe("2026-07-31|61399");
  });

  it("arredonda em centavos em vez de comparar float", () => {
    // 0.1 + 0.2 = 0.30000000000000004; sem o round a chave nunca casaria.
    expect(chaveLojista("2026-07-31", 0.1 + 0.2)).toBe("2026-07-31|30");
  });

  it("devolve null sem data ou sem valor", () => {
    expect(chaveLojista(null, 10)).toBeNull();
    expect(chaveLojista("2026-07-31", null)).toBeNull();
    expect(chaveLojista("31/07/2026", 10)).toBeNull();
  });
});

describe("semValorNoFim", () => {
  it("tira o valor que a esteira cola no título do achado", () => {
    expect(semValorNoFim("LATAM AIR*0000V SAO PAULO R$ 613,99")).toBe("LATAM AIR*0000V SAO PAULO");
    expect(semValorNoFim("ELETRO TINTASV VILA VELHA R$ 1.603,65")).toBe("ELETRO TINTASV VILA VELHA");
  });

  it("não mexe no nome que não termina em valor", () => {
    expect(semValorNoFim("IOF OPERACAO EXTERIOR")).toBe("IOF OPERACAO EXTERIOR");
    // "R$" no meio do nome não é o carimbo do fim.
    expect(semValorNoFim("CASA DO R$ 10 VITORIA")).toBe("CASA DO R$ 10 VITORIA");
  });

  it("aguenta nulo", () => {
    expect(semValorNoFim(null)).toBe("");
  });
});

describe("nomeContraparte", () => {
  it("MEMO cru vira lojista limpo e depois apelido", () => {
    const n = nomeContraparte(apelidos, lojistas, {
      nome: "LATAM AIR*0000V SAO PAULO R$ 613,99",
      data: "2026-07-31",
      valor: 613.99,
    });
    expect(n.exibido).toBe("Latam");
    expect(n.cru).toBe("LATAM AIR*0000V SAO PAULO");
    expect(n.oQueE).toBe("Passagens do time");
    expect(n.temApelido).toBe(true);
  });

  it("sem apelido cadastrado, mostra o lojista limpo — nunca o MEMO", () => {
    const n = nomeContraparte(apelidos, lojistas, {
      nome: "CENTRAL DE AVIAMENTO VITORIA R$ 39,13",
      data: "2026-07-15",
      valor: 39.13,
    });
    expect(n.exibido).toBe("CENTRAL DE AVIAMENTO");
    expect(n.temApelido).toBe(false);
  });

  it("sem lojista casado, ainda tenta o apelido pelo nome cru", () => {
    // É o caso da esteira de junho, que já gravava alguns nomes limpos.
    const n = nomeContraparte(apelidos, lojistas, {
      nome: "UBER",
      data: "2026-05-30",
      valor: 11.31,
    });
    expect(n.exibido).toBe("Uber");
    expect(n.temApelido).toBe(true);
  });

  it("sem lojista e sem apelido, o nome cru é o que sobra", () => {
    const n = nomeContraparte(apelidos, lojistas, {
      nome: "GGJJKV OSASCO R$ 189,34",
      data: "2026-01-02",
      valor: 189.34,
    });
    expect(n.exibido).toBe("GGJJKV OSASCO");
    expect(n.cru).toBe("GGJJKV OSASCO");
    expect(n.temApelido).toBe(false);
  });

  it("o lojista tem precedência sobre o cru na hora de achar o apelido", () => {
    // O cru diz "LEROY MERLINV SAO PAULO", que não casa com cadastro nenhum;
    // quem acha "Material - Obra" é o lojista limpo.
    const n = nomeContraparte(apelidos, lojistas, {
      nome: "LEROY MERLINV SAO PAULO R$ 190,75",
      data: "2026-07-28",
      valor: 190.75,
    });
    expect(n.exibido).toBe("Material - Obra");
  });

  it("sem mapa nenhum não quebra — devolve o nome como veio", () => {
    const n = nomeContraparte(null, null, {
      nome: "LATAM AIR*0000V SAO PAULO R$ 613,99",
      data: "2026-07-31",
      valor: 613.99,
    });
    expect(n.exibido).toBe("LATAM AIR*0000V SAO PAULO");
    expect(n.temApelido).toBe(false);
  });
});

describe("textoDaBusca", () => {
  it("varre apelido, nome cru e a frase do cadastro", () => {
    const n = nomeContraparte(apelidos, lojistas, {
      nome: "LATAM AIR*0000V SAO PAULO R$ 613,99",
      data: "2026-07-31",
      valor: 613.99,
    });
    const hay = textoDaBusca(n);
    // Procurar pelo nome que ESTÁ na tela precisa funcionar tanto quanto
    // procurar pelo que está no extrato.
    expect(hay).toContain("latam");
    expect(hay).toContain("latam air*0000v sao paulo");
    expect(hay).toContain("passagens do time");
  });
});

/* ---------------------------------------------------------------------------
 * O que foi comprado
 *
 * A frase da nota é por LANÇAMENTO. O teste que importa é o de baixo: seis
 * compras no mesmo Mercado Livre continuam sendo um fornecedor só.
 * ------------------------------------------------------------------------- */

const compras: MapaCompras = {
  "2026-08-03|200051": "Cadeira de escritório e 2 monitores",
  "2026-08-11|17900": "Cabo HDMI",
};

describe("fraseDaNota", () => {
  it("devolve a frase que a IA escreveu", () => {
    expect(fraseDaNota({ descricao: "Cadeira de escritório" })).toBe("Cadeira de escritório");
  });

  it("sem leitura devolve null, não string vazia — é o null que some da tela", () => {
    expect(fraseDaNota(null)).toBeNull();
    expect(fraseDaNota(undefined)).toBeNull();
    expect(fraseDaNota({ descricao: "   " })).toBeNull();
  });
});

describe("compraDe", () => {
  it("acha pela mesma chave data + centavos do lojista", () => {
    expect(compraDe(compras, "2026-08-03", 2000.51)).toBe("Cadeira de escritório e 2 monitores");
  });

  it("linha sem nota lida devolve null — é a maioria, e está certo", () => {
    expect(compraDe(compras, "2026-08-04", 2000.51)).toBeNull();
    expect(compraDe(null, "2026-08-03", 2000.51)).toBeNull();
  });
});

describe("a compra não vira nome", () => {
  it("duas compras no mesmo lojista continuam UM fornecedor", () => {
    const a = nomeContraparte(apelidos, lojistas, {
      nome: "MERCADO LIVRE", data: "2026-08-03", valor: 2000.51,
      compra: compraDe(compras, "2026-08-03", 2000.51),
    });
    const b = nomeContraparte(apelidos, lojistas, {
      nome: "MERCADO LIVRE", data: "2026-08-11", valor: 179,
      compra: compraDe(compras, "2026-08-11", 179),
    });
    // O que agrupa a DRE e o Pareto é `exibido`, e ele não se mexe.
    expect(a.exibido).toBe(b.exibido);
    // O que muda é só a linha de apoio.
    expect(a.oQueComprou).toBe("Cadeira de escritório e 2 monitores");
    expect(b.oQueComprou).toBe("Cabo HDMI");
  });

  it("a busca varre o que foi comprado", () => {
    const n = nomeContraparte(apelidos, lojistas, {
      nome: "MERCADO LIVRE", data: "2026-08-03", valor: 2000.51,
      compra: compraDe(compras, "2026-08-03", 2000.51),
    });
    expect(textoDaBusca(n)).toContain("monitores");
  });
});

describe("itensDaNota", () => {
  const naoPagavel = (r: string) => /icms|base de calculo|desconto/i.test(r);

  it("tira imposto, desconto e o total — sobra o que alguém comprou", () => {
    const itens = itensDaNota(
      {
        valores: [
          { rotulo: "Cadeira", valor: 1200 },
          { rotulo: "Monitor", valor: 800.51 },
          { rotulo: "Valor do ICMS", valor: 160.04 },
          { rotulo: "Desconto", valor: 10 },
          { rotulo: "Total", valor: 2000.51 },
        ],
      },
      naoPagavel,
      2000.51,
    );
    expect(itens.map((i) => i.rotulo)).toEqual(["Cadeira", "Monitor"]);
  });

  it("sem leitura devolve lista vazia", () => {
    expect(itensDaNota(null, naoPagavel, 100)).toEqual([]);
  });
});
