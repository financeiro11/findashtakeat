import { describe, expect, it } from "vitest";
import {
  aprenderVotos, cobertura, comparar, sugerir, votosDoOmie,
  type EntradaMapa, type Mapa, type Origem, type TituloComTexto,
} from "./depara";

/** Um voto como `votosDoOmie` o produz, sem passar pelo texto do título. */
const voto = (chave: string, data: string, cat: string, desc: string | null = cat) =>
  ({ chave, estabelecimento: chave, data, codigoCategoria: cat, descricaoCategoria: desc });

describe("aprenderVotos", () => {
  it("elege a categoria dominante do lojista", () => {
    const mapa = aprenderVotos([
      { ...voto("ANTHROPIC", "2026-05-01", "2.01.03", "Software / SaaS"), estabelecimento: "ANTHROPICV" },
      { ...voto("ANTHROPIC", "2026-06-01", "2.01.03", "Software / SaaS"), estabelecimento: "ANTHROPIC* CLAUDE SU" },
      { ...voto("ANTHROPIC", "2026-07-01", "2.01.03", "Software / SaaS"), estabelecimento: "ANTHROPIC" },
    ]);
    const e = mapa.get("ANTHROPIC")!;
    expect(e.codigoCategoria).toBe("2.01.03");
    expect(e.votos).toBe(3);
    expect(e.examinados).toBe(3);
    expect(e.origem).toBe("historico");
    // Os três nomes crus que a fusão juntou ficam à vista para conferência.
    expect(e.exemplos).toHaveLength(3);
  });

  it("no empate, vale a decisão mais recente", () => {
    // Fornecedor que trocou de rubrica no meio do ano: a rubrica nova ganha.
    const mapa = aprenderVotos([
      voto("X", "2026-05-01", "2.01.03"),
      voto("X", "2026-07-01", "4.01.01"),
    ]);
    expect(mapa.get("X")!.codigoCategoria).toBe("4.01.01");
  });

  it("voto sem chave ou sem categoria não entra na conta", () => {
    const mapa = aprenderVotos([
      voto("", "2026-05-01", "2.01.03"),
      voto("X", "2026-05-01", ""),
    ]);
    expect(mapa.size).toBe(0);
  });
});

describe("sugerir", () => {
  const mapa = aprenderVotos([
    voto("ANTHROPIC", "2026-05-01", "2.01.03"),
    voto("ANTHROPIC", "2026-06-01", "2.01.03"),
    voto("ANTHROPIC", "2026-07-01", "2.01.03"),
    voto("SOZINHO", "2026-07-01", "4.01.01"),
  ]);

  it("histórico unânime e repetido é confiança alta", () => {
    expect(sugerir(mapa, "ANTHROPIC")!.confianca).toBe("alta");
  });

  it("um título só não vira confiança alta", () => {
    expect(sugerir(mapa, "SOZINHO")!.confianca).toBe("baixa");
  });

  it("lojista desconhecido não recebe sugestão", () => {
    expect(sugerir(mapa, "LOJA NOVA")).toBeNull();
  });

  it("escolha manual sempre vence", () => {
    const m = new Map(mapa);
    m.set("ANTHROPIC", { ...m.get("ANTHROPIC")!, origem: "manual", codigoCategoria: "9.99.99" });
    const s = sugerir(m, "ANTHROPIC")!;
    expect(s.codigoCategoria).toBe("9.99.99");
    expect(s.confianca).toBe("alta");
  });
});

describe("cobertura", () => {
  it("conta lojistas distintos, não títulos", () => {
    const mapa = aprenderVotos([voto("ANTHROPIC", "2026-07-01", "2.01.03")]);
    const c = cobertura(mapa, ["ANTHROPIC", "ANTHROPIC", "ANTHROPIC", "LOJA NOVA"]);
    expect(c).toEqual({ total: 2, cobertas: 1, faltando: ["LOJA NOVA"] });
  });
});

/* ==================================================================
 * O caminho novo: aprender lendo o nome, não adivinhando pelo valor
 * ================================================================== */

const CARTAO = "Lancamento Fatura Cartao";

/**
 * MEMO com as colunas certas: 22 de nome, a parcela em 22..27, cauda a partir de
 * 30. `lerMemo` corta por POSIÇÃO — fixture desalinhada testa outra coisa.
 */
const memo = (nome: string, cauda = "SAO PAULO", parcela = "     ") =>
  nome.padEnd(22, " ").slice(0, 22) + parcela.padEnd(8, " ") + cauda;

/** Observação como o Omie a devolve na importação automática (com o "|"). */
const obsImportada = (m: string) =>
  `Conta a Pagar importada automaticamente em 04/08/2026 às 12:51.\n|${m}`;

const comTexto = (
  codTitulo: string, data: string | null, cat: string | null,
  observacao: string | null, contraparte: string | null = CARTAO,
): TituloComTexto => ({
  codTitulo, data, codigoCategoria: cat, descricaoCategoria: cat, observacao, contraparte,
});

describe("votosDoOmie", () => {
  it("lê o lojista da observação e funde as variantes na mesma chave", () => {
    const votos = votosDoOmie([
      comTexto("t1", "2026-06-01", "2.02.95", obsImportada(memo("DL *GOOGLE ADS786089"))),
      comTexto("t2", "2026-07-01", "2.02.95", obsImportada(memo("Google ADS7860896678"))),
    ]);
    expect(votos).toHaveLength(2);
    expect(new Set(votos.map((v) => v.chave))).toEqual(new Set(["GOOGLE ADS"]));
    expect(votos[0].codigoCategoria).toBe("2.02.95");
  });

  it("aceita a observação SEM o '|' — é o formato do parcelado lançado à mão", () => {
    // 793 dos 2.639 títulos aproveitáveis são assim (medido em 27/08/2026):
    // a observação inteira é o MEMO, sem prefixo de importação nenhum.
    const votos = votosDoOmie([
      comTexto("t1", "2026-06-01", "2.01.91", "MERCADOLIVRE*MERCADO  01/12   LIMEIRA"),
    ]);
    expect(votos).toHaveLength(1);
    expect(votos[0].chave).toBe("MERCADOLIVRE");
  });

  /* O "|" quer dizer coisas opostas nos dois formatos do Omie. Cortar pelo
     último (o que `memoDaObservacao` faz, e continua fazendo para a DRE) acerta
     o importado e destrói o digitado à mão: dos 2.649 títulos do cache em
     27/08/2026, 148 terminam em "|" e 8 trazem anotação depois dele. */
  it("MEMO digitado que TERMINA em '|' não perde o voto", () => {
    const votos = votosDoOmie([
      comTexto("t1", "2026-06-01", "2.02.98", "LATAM AIR*KIMISQV     01/04   SAO PAULO|"),
    ]);
    expect(votos).toHaveLength(1);
    expect(votos[0].chave).toBe("LATAM AIR");
  });

  it("anotação depois do MEMO não vira o nome do lojista", () => {
    const votos = votosDoOmie([
      comTexto("t1", "2026-06-01", "2.02.93", "PRINTIV               01/04   Sao Paulo|grafica"),
    ]);
    expect(votos).toHaveLength(1);
    expect(votos[0].chave).toBe("PRINTI");
  });

  it("no formato importado o MEMO é o que vem DEPOIS do carimbo, pipes e tudo", () => {
    const votos = votosDoOmie([
      comTexto("t1", "2026-06-01", "2.04.96", obsImportada(memo("SYMPLA*EVENTO", "SAO PAULO|obs"))),
    ]);
    expect(votos).toHaveLength(1);
    expect(votos[0].chave).toBe("SYMPLA");
  });

  it("carimbo truncado, sem pipe, não ensina nada", () => {
    expect(votosDoOmie([
      comTexto("t1", "2026-06-01", "2.01.91",
        "Conta a Pagar importada automaticamente em 04/08/2026 às 12:51."),
    ])).toHaveLength(0);
  });

  it("ignora título que não é de cartão, por mais que a observação pareça um MEMO", () => {
    // A trava mora em `ehCartao`, dentro de `lojistaDoTitulo`. Sem ela, o texto
    // que o fornecedor escreveu vira "estabelecimento" e o de-para aprende lixo.
    expect(votosDoOmie([
      comTexto("t1", "2026-06-01", "2.01.91", obsImportada(memo("QUALQUER COISA")), "Fornecedor Comum LTDA"),
    ])).toHaveLength(0);
  });

  it("descarta o que não ensina nada: sem categoria, sem data, sem observação", () => {
    expect(votosDoOmie([
      comTexto("t1", "2026-06-01", null, obsImportada(memo("ANTHROPIC"))),
      comTexto("t2", null, "2.01.91", obsImportada(memo("ANTHROPIC"))),
      comTexto("t3", "2026-06-01", "2.01.91", null),
      comTexto("t4", "2026-06-01", "2.01.91", "   "),
    ])).toHaveLength(0);
  });

  it("a maioria decide, e o de-para sai com a força do voto", () => {
    const votos = votosDoOmie([
      ...Array.from({ length: 5 }, (_, i) =>
        comTexto(`a${i}`, "2026-06-01", "2.02.95", obsImportada(memo("GOOGLE ADS786089")))),
      comTexto("b", "2026-05-01", "2.02.92", obsImportada(memo("GOOGLE ADS786089"))),
    ]);
    const mapa = aprenderVotos(votos);
    const e = mapa.get("GOOGLE ADS")!;
    expect(e.codigoCategoria).toBe("2.02.95");
    expect(e.votos).toBe(5);
    expect(e.examinados).toBe(6);
    expect(sugerir(mapa, "GOOGLE ADS")!.confianca).toBe("media");
  });
});

describe("comparar", () => {
  const entrada = (chave: string, cod: string, origem: Origem = "historico"): EntradaMapa =>
    ({ chave, codigoCategoria: cod, descricaoCategoria: cod, origem, votos: 3, examinados: 3, exemplos: [] });

  it("separa o que nasce, o que troca de rubrica e o que só confirma", () => {
    const atual: Mapa = new Map([
      ["A", entrada("A", "1.00")],
      ["B", entrada("B", "1.00")],
      ["SO_NO_ANTIGO", entrada("SO_NO_ANTIGO", "1.00")],
    ]);
    const novo: Mapa = new Map([
      ["A", entrada("A", "1.00")],   // confirma
      ["B", entrada("B", "2.00")],   // troca
      ["C", entrada("C", "3.00")],   // nasce
    ]);

    const p = comparar(atual, novo);
    expect(p.iguais).toBe(1);
    expect(p.trocam.map((m) => m.chave)).toEqual(["B"]);
    expect(p.trocam[0].de!.codigo).toBe("1.00");
    expect(p.trocam[0].para.codigo).toBe("2.00");
    expect(p.novas.map((m) => m.chave)).toEqual(["C"]);
    expect(p.novas[0].de).toBeNull();
    expect(p.intocadas).toEqual(["SO_NO_ANTIGO"]);
  });

  it("não conta como troca o que a RPC vai recusar sobrescrever", () => {
    // `cartao_omie_map_gravar` protege `origem='manual'`. Anunciar uma troca que
    // não vai acontecer assustaria quem confere pelo motivo errado.
    const atual: Mapa = new Map([["A", entrada("A", "1.00", "manual")]]);
    const novo: Mapa = new Map([["A", entrada("A", "9.99")]]);

    const p = comparar(atual, novo);
    expect(p.trocam).toHaveLength(0);
    expect(p.manuaisPreservadas).toBe(1);
  });

  it("ordena por volume — a troca que mais pesa aparece primeiro", () => {
    const forte = { ...entrada("FORTE", "2.00"), examinados: 40 };
    const fraca = { ...entrada("FRACA", "2.00"), examinados: 1 };
    const p = comparar(
      new Map([["FORTE", entrada("FORTE", "1.00")], ["FRACA", entrada("FRACA", "1.00")]]),
      new Map([["FORTE", forte], ["FRACA", fraca]]),
    );
    expect(p.trocam.map((m) => m.chave)).toEqual(["FORTE", "FRACA"]);
  });
});
