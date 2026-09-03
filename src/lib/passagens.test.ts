import { describe, it, expect } from "vitest";
import {
  norm, precosNoTexto, formasDaData, casarEmail, deveAvisar, linkGoogleFlights,
  aeroporto, rotaTexto, diasAte, lerTeto, janelaDeCompra, pendenciasDaViagem, PRECO_MIN_PLAUSIVEL,
  type ViagemParaCasar,
} from "./passagens";
import { sugerirTeto } from "./radarPrecos";

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

describe("lerTeto", () => {
  it("traduz o teto em distância do preço de hoje", () => {
    const r = lerTeto(3000, 3793);
    expect(r.dispara_agora).toBe(false);
    expect(r.frase).toContain("21% abaixo do preço de hoje");
  });

  it("ACUSA o teto acima do preço de hoje — o erro que ninguém percebe sozinho", () => {
    const r = lerTeto(4200, 3793);
    expect(r.dispara_agora).toBe(true);
    expect(r.frase).toContain("acima do preço de hoje");
    expect(r.frase).toContain("não diria nada");
  });

  it("teto igual ao preço de hoje também dispara à toa", () => {
    expect(lerTeto(3793, 3793).dispara_agora).toBe(true);
  });

  it("avisa quando a margem é pequena demais ou grande demais", () => {
    expect(lerTeto(3700, 3793).frase).toContain("pouca margem");
    expect(lerTeto(1500, 3793).frase).toContain("nunca ser alcançado");
  });

  it("sem âncora, pede a âncora em vez de opinar", () => {
    const r = lerTeto(3000, null);
    expect(r.folga).toBeNull();
    expect(r.frase).toContain("quanto o Google está pedindo");
  });

  it("o veredito do Google entra como contexto, não como número", () => {
    expect(lerTeto(3000, 3793, "alto").frase).toContain("caro para esta rota");
    expect(lerTeto(3000, 3793, "baixo").frase).toContain("barato para esta rota");
  });
});

/* A camada 2 é reaproveitamento: `passagens_curva_diaria` entrega no formato que
   `sugerirTeto` (do Radar) consome. Este teste guarda a JUNTA — se alguém mudar
   o formato de um lado, é aqui que quebra, e não em silêncio na tela. */
describe("a curva de passagens alimenta o sugerirTeto do Radar", () => {
  // Exatamente o que a RPC devolveu no banco para uma viagem de teste VIX–SSA.
  const curva = [
    { dia: "2026-08-25", menor: 2200, mediana: 2200, ofertas: 1 },
    { dia: "2026-08-27", menor: 2100, mediana: 2100, ofertas: 1 },
    { dia: "2026-08-29", menor: 1950, mediana: 1950, ofertas: 1 },
    { dia: "2026-08-31", menor: 2050, mediana: 2050, ofertas: 1 },
    { dia: "2026-09-02", menor: 1880, mediana: 1880, ofertas: 1 },
  ];

  it("lê mínimo, típico e sugestão da curva de uma viagem", () => {
    const s = sugerirTeto(curva, 2000);
    expect(s.minimo).toBe(1880);
    expect(s.tipico).toBe(2050);
    expect(s.teto).toBe(2000);   // ate50(1880 × 1,05)
    expect(s.veredito).toBe("bom");
  });

  it("com poucos pontos NÃO se declara firme — a amostra de passagem é rala", () => {
    // O Radar mede ~28 vezes em 14 dias; aqui os pontos chegam quando o Google
    // escreve. `pode: false` é o que faz a tela dizer "é indício".
    expect(sugerirTeto(curva, 2000).pode).toBe(false);
    expect(sugerirTeto(curva, 2000).dias).toBe(5);
  });

  it("acusa o teto folgado, que dispararia no preço de sempre", () => {
    expect(sugerirTeto(curva, 2600).veredito).toBe("folgado");
  });

  it("acusa o teto abaixo de tudo o que já se viu", () => {
    expect(sugerirTeto(curva, 1500).veredito).toBe("abaixo_do_minimo");
  });
});

describe("janelaDeCompra", () => {
  it("classifica a antecedência", () => {
    expect(janelaDeCompra(120).janela).toBe("cedo");
    expect(janelaDeCompra(77).janela).toBe("boa");
    expect(janelaDeCompra(22).janela).toBe("encurtando");
    expect(janelaDeCompra(9).janela).toBe("tarde");
    expect(janelaDeCompra(-1).janela).toBe("passou");
  });

  it("nas bordas, o lado mais conservador ganha", () => {
    expect(janelaDeCompra(90).janela).toBe("boa");
    expect(janelaDeCompra(30).janela).toBe("encurtando");
    expect(janelaDeCompra(14).janela).toBe("tarde");
    expect(janelaDeCompra(0).janela).toBe("tarde");
  });
});

describe("pendenciasDaViagem", () => {
  const hoje = new Date("2026-09-03T12:00:00Z");
  const base = {
    status: "rastreando", data_ida: "2026-11-19", teto: 3000,
    rastreando_em: "2026-09-03T00:00:00Z", ultimo_preco: null as number | null,
    ultimo_em: null as string | null, pontos: 0,
  };

  it("viagem saudável e longe não pede nada", () => {
    expect(pendenciasDaViagem({ ...base, ultimo_preco: 3500, ultimo_em: "2026-09-02T00:00:00Z", pontos: 1 }, hoje)).toEqual([]);
  });

  it("preço no teto pede COMPRAR, e cala o resto", () => {
    const p = pendenciasDaViagem({ ...base, ultimo_preco: 2800, ultimo_em: "2026-09-02T00:00:00Z", pontos: 1 }, hoje);
    expect(p).toHaveLength(1);
    expect(p[0].tipo).toBe("comprar");
    expect(p[0].urgencia).toBe("alta");
  });

  it("A METADE QUE FALTAVA: prazo acabando sem preço no teto pede DECIDIR", () => {
    // Antes disto, esta viagem não gerava aviso nenhum — ela só expirava.
    const p = pendenciasDaViagem(
      { ...base, data_ida: "2026-09-10", ultimo_preco: 4200, ultimo_em: "2026-09-02T00:00:00Z", pontos: 3 }, hoje,
    );
    expect(p[0].tipo).toBe("decidir");
    expect(p[0].urgencia).toBe("alta");
  });

  it("prazo encurtando é média, não alta", () => {
    const p = pendenciasDaViagem(
      { ...base, data_ida: "2026-09-25", ultimo_preco: 4200, ultimo_em: "2026-09-02T00:00:00Z", pontos: 3 }, hoje,
    );
    expect(p[0].tipo).toBe("decidir");
    expect(p[0].urgencia).toBe("media");
  });

  it("alerta nunca ligado é pendência própria", () => {
    const p = pendenciasDaViagem({ ...base, rastreando_em: null }, hoje);
    expect(p.some((x) => x.tipo === "ligar_alerta")).toBe(true);
  });

  it("alerta ligado e mudo há muito tempo levanta suspeita", () => {
    // O modo de falha invisível: tudo responde 2xx, o painel fica verde, e a
    // curva nunca anda porque o casador não reconhece os e-mails da rota.
    const p = pendenciasDaViagem({ ...base, rastreando_em: "2026-08-01T00:00:00Z" }, hoje);
    expect(p.some((x) => x.tipo === "sem_preco")).toBe(true);
  });

  it("poucos dias de silêncio ainda é normal", () => {
    const p = pendenciasDaViagem({ ...base, rastreando_em: "2026-08-30T00:00:00Z" }, hoje);
    expect(p.some((x) => x.tipo === "sem_preco")).toBe(false);
  });

  it("viagem fechada só cobra o desligamento lá fora", () => {
    const p = pendenciasDaViagem({ ...base, status: "comprada" }, hoje);
    expect(p).toHaveLength(1);
    expect(p[0].tipo).toBe("desligar_alerta");
  });

  it("viagem fechada com o alerta já desligado não pede nada", () => {
    expect(pendenciasDaViagem({ ...base, status: "comprada", rastreando_em: null }, hoje)).toEqual([]);
  });
});

describe("diasAte", () => {
  it("conta os dias até a ida", () => {
    expect(diasAte("2026-11-14", new Date("2026-11-04T12:00:00Z"))).toBe(10);
    expect(diasAte("2026-11-14", new Date("2026-11-14T23:00:00Z"))).toBe(0);
    expect(diasAte("2026-11-14", new Date("2026-11-20T00:00:00Z"))).toBe(-6);
  });
});
