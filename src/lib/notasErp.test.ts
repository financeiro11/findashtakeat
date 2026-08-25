import { describe, expect, it } from "vitest";
import {
  brlStr, categoriasCriticas, fatias, formatarDoc, frasePanorama, mesCurto,
  pctStr, periodoPadrao, nomeDaLinha, GRAVIDADE, GRAVIDADES,
  SITUACOES_EXIGIVEIS, SITUACOES_FALTANDO, SITUACAO,
  type ResumoNotas,
} from "./notasErp";

const resumo = (meta: Partial<ResumoNotas["meta"]>, extra: Partial<ResumoNotas> = {}): ResumoNotas => ({
  meta: {
    de: "2026-04-01", ate: "2026-08-31",
    limiares: { medio: 150, grave: 500, urgente: 1000 },
    titulos: 0, valor: 0, exigivel_titulos: 0, exigivel_valor: 0,
    cobertura_valor: null, cobertura_titulos: null, nao_verificado_valor: 0,
    a_revisar: 0, cartao_titulos: 0, cartao_valor: 0, atualizado_em: null, ...meta,
  },
  gravidade: [], situacoes: [], meses: [], contas: [], categorias: [], fornecedores: [], ...extra,
});

describe("frasePanorama", () => {
  it("avisa que a cobertura é um PISO enquanto houver título não verificado", () => {
    const f = frasePanorama(resumo({
      exigivel_valor: 1_000_000, cobertura_valor: 40, nao_verificado_valor: 250_000,
    }));
    expect(f).toContain("40,0%");
    expect(f).toContain("piso");
    expect(f).toContain("25,0%");
  });

  it("só afirma o número quando todo o período foi verificado", () => {
    const f = frasePanorama(resumo({
      exigivel_valor: 1_000_000, cobertura_valor: 88.5, nao_verificado_valor: 0,
    }));
    expect(f).toContain("88,5%");
    expect(f).not.toContain("piso");
    expect(f).toContain("verificado contra o ERP");
  });

  it("não inventa cobertura quando ninguém leu o ERP", () => {
    expect(frasePanorama(resumo({ exigivel_valor: 500, cobertura_valor: null })))
      .toBe("Ainda não há leitura do ERP para este período.");
  });

  it("diz o óbvio quando não há despesa que exige nota", () => {
    expect(frasePanorama(resumo({ exigivel_valor: 0 }))).toContain("Nenhuma despesa");
  });

  it("aguenta resumo ausente", () => {
    expect(frasePanorama(null)).toBe("");
  });
});

describe("fatias", () => {
  it("reparte a barra em percentuais que somam 100", () => {
    const f = fatias({ com_nota: 25, pronta: 25, sem_nota: 25, nao_verificado: 25, total: 100 });
    expect(f).toEqual({ com_nota: 25, pronta: 25, sem_nota: 25, nao_verificado: 25 });
  });

  it("não divide por zero", () => {
    expect(fatias({ com_nota: 0, pronta: 0, sem_nota: 0, nao_verificado: 0, total: 0 }))
      .toEqual({ com_nota: 0, pronta: 0, sem_nota: 0, nao_verificado: 0 });
  });
});

describe("categoriasCriticas", () => {
  const r = resumo({}, {
    categorias: [
      { categoria: "Software", codigo: "2.01.91", titulos: 60, valor: 187556, com_nota: 10, sem_nota: 50, pronta: 0, nao_verificado: 0, urgentes: 40, valor_faltante: 150000, cobertura: 20 },
      { categoria: "Café", codigo: "2.04.94", titulos: 1, valor: 12, com_nota: 0, sem_nota: 1, pronta: 0, nao_verificado: 0, urgentes: 0, valor_faltante: 12, cobertura: 0 },
      { categoria: "Aluguel", codigo: "2.04.01", titulos: 11, valor: 141857, com_nota: 11, sem_nota: 0, pronta: 0, nao_verificado: 0, urgentes: 0, valor_faltante: 0, cobertura: 100 },
    ],
  });

  it("ordena por valor faltante, não por percentual", () => {
    // A categoria de R$ 12 tem 0% de cobertura e não é problema de ninguém.
    const c = categoriasCriticas(r);
    expect(c.map((x) => x.categoria)).toEqual(["Software", "Café"]);
  });

  it("tira quem já está coberto", () => {
    expect(categoriasCriticas(r).find((c) => c.categoria === "Aluguel")).toBeUndefined();
  });

  it("aceita um mínimo para calar o troco", () => {
    expect(categoriasCriticas(r, 100).map((c) => c.categoria)).toEqual(["Software"]);
  });
});

describe("o vocabulário das situações", () => {
  it("só as situações exigíveis entram na cobertura", () => {
    expect(SITUACOES_EXIGIVEIS).not.toContain("dispensa");
    expect(SITUACOES_EXIGIVEIS).not.toContain("conferir");
    expect(SITUACOES_EXIGIVEIS).toContain("com_nota");
    expect(SITUACOES_EXIGIVEIS).toContain("anexo_suspeito");
  });

  it("anexo a conferir NÃO conta como coberto — tem arquivo, não se sabe se é a nota", () => {
    expect(SITUACAO.anexo_suspeito.tom).not.toBe("ok");
    expect(SITUACOES_FALTANDO).toContain("anexo_suspeito");
  });

  it("a gravidade ordena a cobrança e não dispensa ninguém", () => {
    expect(GRAVIDADES).toEqual(["urgente", "grave", "medio", "irrelevante"]);
    // "irrelevante" continua faltando: é prioridade, não perdão.
    expect(SITUACOES_EXIGIVEIS).not.toContain("irrelevante" as never);
    expect(GRAVIDADE.urgente.ordem).toBeLessThan(GRAVIDADE.irrelevante.ordem);
  });

  it("com_nota é o único estado verde", () => {
    const verdes = Object.entries(SITUACAO).filter(([, v]) => v.tom === "ok").map(([k]) => k);
    expect(verdes).toEqual(["com_nota"]);
  });

  it("toda situação tem rótulo e explicação", () => {
    for (const [k, v] of Object.entries(SITUACAO)) {
      expect(v.rotulo, k).toBeTruthy();
      expect(v.ajuda.length, k).toBeGreaterThan(20);
    }
  });
});

describe("formatação", () => {
  it("brlStr arredonda e usa separador brasileiro", () => {
    expect(brlStr(1234567.89)).toBe("R$ 1.234.568");
    expect(brlStr(null)).toBe("R$ 0");
  });

  it("pctStr usa vírgula e não mente sobre nulo", () => {
    expect(pctStr(62.64)).toBe("62,6%");
    expect(pctStr(0)).toBe("0,0%");
    expect(pctStr(null)).toBe("—");
    expect(pctStr(undefined)).toBe("—");
  });

  it("mesCurto vira ago/26", () => {
    expect(mesCurto("2026-08")).toBe("ago/26");
    expect(mesCurto("2026-01")).toBe("jan/26");
  });

  it("formatarDoc aceita CNPJ e CPF", () => {
    expect(formatarDoc("17339545000120")).toBe("17.339.545/0001-20");
    expect(formatarDoc("12345678901")).toBe("123.456.789-01");
    expect(formatarDoc(null)).toBe("—");
  });
});

describe("periodoPadrao", () => {
  it("abre nos últimos seis meses, terminando no fim do mês corrente", () => {
    const p = periodoPadrao(new Date(Date.UTC(2026, 7, 25)));   // 25/08/2026
    expect(p.de).toBe("2026-03-01");
    expect(p.ate).toBe("2026-08-31");
  });

  it("atravessa a virada do ano sem se perder", () => {
    const p = periodoPadrao(new Date(Date.UTC(2026, 1, 10)), 6); // fev/2026
    expect(p.de).toBe("2025-09-01");
    expect(p.ate).toBe("2026-02-28");
  });
});

describe("nomeDaLinha", () => {
  const semApelido = (n: string) => n;
  const OBS_CARTAO = "Conta a Pagar importada automaticamente em 04/08/2026 às 12:51.|";

  const linha = (over: Partial<Parameters<typeof nomeDaLinha>[0]> = {}) => ({
    favorecido: "Lancamento Fatura Cartao",
    favorecido_cru: "Lancamento Fatura Cartao",
    observacao: null as string | null,
    doc: null as string | null,
    ...over,
  });

  it("tira o lojista da observação quando o título é do cartão", () => {
    const r = nomeDaLinha(
      linha({ observacao: OBS_CARTAO + "Hubspot Inc.V                 888-48" }),
      semApelido,
    );
    expect(r.deCartao).toBe(true);
    expect(r.nome).toMatch(/Hubspot/i);
  });

  it("aplica o apelido SOBRE o lojista extraído", () => {
    const r = nomeDaLinha(
      linha({ observacao: OBS_CARTAO + "APPLE.COM/BILL                SAO PAULO" }),
      (n) => (/apple/i.test(n) ? "Apple" : n),
    );
    expect(r.nome).toBe("Apple");
    expect(r.cru).toMatch(/APPLE/i);   // o cru continua sendo o que está no ERP
  });

  it("NÃO lê a observação de um título comum — ela é do fornecedor, não da fatura", () => {
    // A armadilha documentada em observacaoTitulo.ts: lida como MEMO posicional,
    // "Link para visualizar a NFS-e…" viraria um estabelecimento plausível.
    const r = nomeDaLinha(
      linha({
        favorecido: "Flash App",
        favorecido_cru: "FLASH APP",
        observacao: "Flash Beneficio agosto|Link para visualizar a NFS-e: https://www.nfse.gov.br",
      }),
      semApelido,
    );
    expect(r.deCartao).toBe(false);
    expect(r.nome).toBe("Flash App");
  });

  it("usa o apelido que o servidor já resolveu quando não é cartão", () => {
    const r = nomeDaLinha(
      linha({ favorecido: "Ingram Micro Brasil", favorecido_cru: "INGRAM MICRO BRASIL LTDA" }),
      semApelido,
    );
    expect(r.nome).toBe("Ingram Micro Brasil");
    expect(r.cru).toBe("INGRAM MICRO BRASIL LTDA");
  });

  it("aguenta cartão sem observação — a tela mostra o que já mostrava", () => {
    const r = nomeDaLinha(linha({ observacao: null }), semApelido);
    expect(r.deCartao).toBe(false);
    expect(r.nome).toBe("Lancamento Fatura Cartao");
  });
});
