import { describe, it, expect } from "vitest";
import { montarMapaApelidos } from "@/lib/apelidos";
import {
  chaveLojista, semValorNoFim, nomeContraparte, textoDaBusca,
  type MapaLojistas,
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
