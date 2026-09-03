import { describe, it, expect } from "vitest";
import {
  norm, precosNoTexto, formasDaData, casarEmail, deveAvisar, linkGoogleFlights,
  aeroporto, rotaTexto, diasAte, PRECO_MIN_PLAUSIVEL,
  type ViagemParaCasar,
} from "./passagens";

/* As viagens que os testes de casamento usam. Duas para o mesmo destino em
   datas diferentes de propósito: é o caso que separa um casador honesto de um
   que chuta. */
const RECIFE: ViagemParaCasar = { id: "v-rec", origem: "VIX", destino: "REC", data_ida: "2026-11-14", data_volta: "2026-11-18" };
const RECIFE_2: ViagemParaCasar = { id: "v-rec2", origem: "VIX", destino: "REC", data_ida: "2026-12-02", data_volta: "2026-12-06" };
const SALVADOR: ViagemParaCasar = { id: "v-ssa", origem: "VIX", destino: "SSA", data_ida: "2026-11-20", data_volta: null };

describe("norm", () => {
  it("tira acento e caixa, que é como tudo aqui compara", () => {
    expect(norm("São Paulo")).toBe("sao paulo");
    expect(norm("Vitória")).toBe("vitoria");
    expect(norm("Belém  do   Pará")).toBe("belem do para");
  });

  it("PRESERVA os dígitos — a data depende deles", () => {
    // Esta é a regressão que um range de acentos escrito errado causaria:
    // `[0300-036f]` como classe literal comeria 0, 3, 6 do texto e a data
    // nunca mais casaria, sem erro nenhum aparecer.
    expect(norm("14 de novembro de 2026")).toBe("14 de novembro de 2026");
    expect(norm("R$ 1.036,30")).toBe("r 1 036 30");
  });
});

describe("precosNoTexto", () => {
  it("lê as formas que o Google escreve, na ordem", () => {
    expect(precosNoTexto("agora R$ 1.234 (era R$ 1.590)")).toEqual([1234, 1590]);
    expect(precosNoTexto("R$ 989")).toEqual([989]);
    expect(precosNoTexto("R$ 1.234,56")).toEqual([1234.56]);
    expect(precosNoTexto("R$989")).toEqual([989]);
  });

  it("ignora número sem R$ — senão data e número de voo viram preço", () => {
    expect(precosNoTexto("voo 1502 sai 14/11 às 0730")).toEqual([]);
  });

  it("descarta valor implausível para uma passagem", () => {
    expect(precosNoTexto(`R$ ${PRECO_MIN_PLAUSIVEL - 1}`)).toEqual([]);
    expect(precosNoTexto("R$ 45")).toEqual([]);   // taxa de bagagem
    expect(precosNoTexto("R$ 999.999")).toEqual([]);
  });
});

describe("formasDaData", () => {
  it("gera as escritas de uma data, em pt e en", () => {
    const f = formasDaData("2026-11-14");
    expect(f).toContain("14 de novembro");
    expect(f).toContain("14 de nov");
    expect(f).toContain("nov 14");
    expect(f).toContain("november 14");
  });

  it("devolve vazio para data inválida em vez de inventar", () => {
    expect(formasDaData("14/11/2026")).toEqual([]);
    expect(formasDaData("")).toEqual([]);
    expect(formasDaData("2026-13-01")).toEqual([]);
  });
});

describe("casarEmail", () => {
  it("casa com confiança alta quando destino e data conferem", () => {
    const r = casarEmail(
      "Alerta de preço: voos para Recife",
      "Os preços de Vitória para Recife em 14 de novembro caíram. Agora: R$ 1.234",
      [RECIFE, SALVADOR],
    );
    expect(r.viagem_id).toBe("v-rec");
    expect(r.preco).toBe(1234);
    expect(r.confianca).toBe("alta");
  });

  it("casa pelo código IATA quando o e-mail usa sigla", () => {
    const r = casarEmail("Preço caiu", "VIX para SSA em 20 de novembro por R$ 880", [RECIFE, SALVADOR]);
    expect(r.viagem_id).toBe("v-ssa");
    expect(r.preco).toBe(880);
  });

  it("NÃO casa quando duas viagens empatam — vai para a fila humana", () => {
    // Mesmo destino, e o texto não traz data: as duas pontuam igual. Chutar
    // aqui gravaria o preço de dezembro na curva de novembro.
    const r = casarEmail("Alerta", "Voos para Recife estão mais baratos: R$ 1.100", [RECIFE, RECIFE_2]);
    expect(r.viagem_id).toBeNull();
    expect(r.confianca).toBeNull();
    expect(r.motivo).toContain("mais de uma viagem");
    // O preço foi lido mesmo sem casar — a atribuição manual não precisa
    // redigitar o valor.
    expect(r.preco).toBe(1100);
  });

  it("a data desempata o mesmo destino", () => {
    const r = casarEmail("Alerta", "Recife, 2 de dezembro, por R$ 1.100", [RECIFE, RECIFE_2]);
    expect(r.viagem_id).toBe("v-rec2");
    expect(r.confianca).toBe("alta");
  });

  it("não casa por origem sozinha — ela é igual para a lista inteira", () => {
    const r = casarEmail("Alerta", "Saindo de Vitória, preços caíram. R$ 900", [RECIFE, SALVADOR]);
    expect(r.viagem_id).toBeNull();
    expect(r.motivo).toContain("não menciona destino nem data");
  });

  it("casou mas sem preço em reais: diz isso em vez de gravar nada", () => {
    const r = casarEmail("Alerta", "Flights to Recife on november 14 from $199", [RECIFE]);
    expect(r.viagem_id).toBe("v-rec");
    expect(r.preco).toBeNull();
    expect(r.confianca).toBeNull();
    expect(r.motivo).toContain("outra moeda");
  });

  it("sem viagem aberta, diz isso — e não estoura", () => {
    const r = casarEmail("Alerta", "R$ 1.234", []);
    expect(r.viagem_id).toBeNull();
    expect(r.motivo).toContain("não há viagem");
  });

  it("IATA não casa dentro de outra palavra", () => {
    // "REC" está dentro de "receber"; sem fronteira de palavra, todo e-mail
    // com "receber" casaria com a viagem para Recife.
    const r = casarEmail("Aviso", "Você vai receber um resumo. R$ 500", [RECIFE]);
    expect(r.viagem_id).toBeNull();
  });
});

describe("deveAvisar", () => {
  it("cala a boca acima do teto", () => {
    expect(deveAvisar(1500, 1200, null).avisar).toBe(false);
  });

  it("avisa no primeiro preço dentro do teto", () => {
    expect(deveAvisar(1100, 1200, null).avisar).toBe(true);
  });

  it("não repete quando já está barato e não melhorou", () => {
    expect(deveAvisar(1150, 1200, 1100).avisar).toBe(false);
  });

  it("avisa de novo quando bate um novo menor", () => {
    expect(deveAvisar(1050, 1200, 1100).avisar).toBe(true);
  });
});

describe("linkGoogleFlights", () => {
  it("monta ida e volta com o idioma e a moeda travados", () => {
    const u = linkGoogleFlights({ origem: "VIX", destino: "REC", data_ida: "2026-11-14", data_volta: "2026-11-18" });
    expect(u).toContain("hl=pt-BR");
    expect(u).toContain("curr=BRL");
    expect(decodeURIComponent(u)).toContain("Flights from VIX to REC on 2026-11-14 through 2026-11-18");
  });

  it("só ida quando não há volta", () => {
    const u = linkGoogleFlights({ origem: "VIX", destino: "SSA", data_ida: "2026-11-20", data_volta: null });
    expect(decodeURIComponent(u)).toContain("One way flights from VIX to SSA on 2026-11-20");
    expect(decodeURIComponent(u)).not.toContain("through");
  });
});

describe("aeroporto e rota", () => {
  it("acha pela IATA em qualquer caixa", () => {
    expect(aeroporto("gru")?.cidade).toBe("São Paulo");
    expect(aeroporto("VIX")?.uf).toBe("ES");
  });

  it("devolve null para o que não está na lista, sem estourar", () => {
    expect(aeroporto("XXX")).toBeNull();
    expect(aeroporto(null)).toBeNull();
  });

  it("rotaTexto sempre em maiúscula", () => {
    expect(rotaTexto("vix", "rec")).toBe("VIX → REC");
  });
});

describe("diasAte", () => {
  it("conta os dias até a ida", () => {
    expect(diasAte("2026-11-14", new Date("2026-11-04T12:00:00Z"))).toBe(10);
    expect(diasAte("2026-11-14", new Date("2026-11-14T23:00:00Z"))).toBe(0);
    expect(diasAte("2026-11-14", new Date("2026-11-20T00:00:00Z"))).toBe(-6);
  });
});
