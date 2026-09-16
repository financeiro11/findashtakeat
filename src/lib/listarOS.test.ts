import { describe, it, expect } from "vitest";
import {
  FIM_DA_LISTA,
  conferirLeituraCompleta,
  janelaDeAlteracao,
  osAindaNoForno,
  statusPendenteDoEspelho,
  tamanhoDePagina,
} from "../../supabase/functions/_shared/listar-os.ts";

/* 15/09/2026: a guarda contava PÁGINAS supondo 500 OS por página, o Omie devolve
   100, e a esteira de emissão parou quando o acervo passou de 4.000 OS. Estes
   testes fixam a pergunta certa — "li a lista inteira?" — em registros. */

describe("conferirLeituraCompleta", () => {
  it("41 páginas de 100 não é problema: o que importa é ter lido os 4.016", () => {
    expect(conferirLeituraCompleta({ lidos: 4016, totalDeRegistros: 4016 })).toBeNull();
  });

  it("não tem teto de tamanho: acervo grande lido inteiro passa", () => {
    expect(conferirLeituraCompleta({ lidos: 25_000, totalDeRegistros: 25_000 })).toBeNull();
  });

  it("lista cortada é recusada, com os dois números na frase", () => {
    const erro = conferirLeituraCompleta({ lidos: 3900, totalDeRegistros: 4016, etapa: "20" });
    expect(erro).toMatch(/3900/);
    expect(erro).toMatch(/4016/);
    expect(erro).toMatch(/etapa 20/);
  });

  it("ler mais do que o total é normal (OS criada no meio da leitura)", () => {
    expect(conferirLeituraCompleta({ lidos: 17, totalDeRegistros: 16 })).toBeNull();
  });

  it("etapa vazia confirmada pelo Omie é lista completa", () => {
    expect(conferirLeituraCompleta({ lidos: 0, totalDeRegistros: null, etapa: "20" })).toBeNull();
  });

  it("sem total informado não se confia na lista", () => {
    expect(conferirLeituraCompleta({ lidos: 100, totalDeRegistros: Number.NaN })).toMatch(/total_de_registros/);
  });
});

describe("FIM_DA_LISTA", () => {
  it("reconhece a frase do Omie, com e sem acento", () => {
    expect(FIM_DA_LISTA.test("ERROR: Não existem registros para a página [42]!")).toBe(true);
    expect(FIM_DA_LISTA.test("nao existem registros")).toBe(true);
    expect(FIM_DA_LISTA.test("Consumo redundante detectado")).toBe(false);
  });
});

describe("tamanhoDePagina", () => {
  it("duas varreduras seguidas nunca mandam o mesmo corpo", () => {
    for (let i = 0; i < 200; i++) expect(tamanhoDePagina(i)).not.toBe(tamanhoDePagina(i + 1));
  });

  it("fica sempre acima dos 100 que o Omie devolve — a página efetiva não muda", () => {
    for (let i = 0; i < 200; i++) {
      expect(tamanhoDePagina(i)).toBeGreaterThan(100);
      expect(tamanhoDePagina(i)).toBeLessThanOrEqual(500);
    }
  });
});

describe("osAindaNoForno", () => {
  const T = (h: number) => new Date(Date.UTC(2026, 8, 15, h)).toISOString();

  it("a OS disparada sem desfecho está no forno (o caso da AEVO)", () => {
    expect(osAindaNoForno([{ n_cod_os: 5522429961, criado_em: T(2) }], [], 40)).toEqual([5522429961]);
  });

  it("desfecho DEPOIS do disparo tira do forno", () => {
    expect(osAindaNoForno(
      [{ n_cod_os: 1, criado_em: T(2) }],
      [{ n_cod_os: 1, criado_em: T(3) }],
      40,
    )).toEqual([]);
  });

  it("desfecho ANTES do disparo não conta: redisparo volta ao forno", () => {
    expect(osAindaNoForno(
      [{ n_cod_os: 1, criado_em: T(5) }],
      [{ n_cod_os: 1, criado_em: T(3) }],
      40,
    )).toEqual([1]);
  });

  it("uma vez cada, a mais recente primeiro, e respeita o teto", () => {
    const abertas = [
      { n_cod_os: 1, criado_em: T(1) },
      { n_cod_os: 2, criado_em: T(4) },
      { n_cod_os: 1, criado_em: T(3) },
      { n_cod_os: 3, criado_em: T(2) },
    ];
    expect(osAindaNoForno(abertas, [], 40)).toEqual([2, 1, 3]);
    expect(osAindaNoForno(abertas, [], 2)).toEqual([2, 1]);
  });

  it("linha sem OS é ignorada", () => {
    expect(osAindaNoForno([{ n_cod_os: null, criado_em: T(1) }], [], 40)).toEqual([]);
  });
});

describe("janelaDeAlteracao", () => {
  it("usa o dia de Brasília: 02h UTC do dia 15 ainda é dia 14 aqui", () => {
    expect(janelaDeAlteracao(Date.parse("2026-09-15T02:00:00Z"), 3)).toEqual({ de: "11/09/2026", ate: "14/09/2026" });
  });

  it("atravessa a virada do mês", () => {
    expect(janelaDeAlteracao(Date.parse("2026-10-02T15:00:00Z"), 3)).toEqual({ de: "29/09/2026", ate: "02/10/2026" });
  });

  it("zero dias é só hoje", () => {
    expect(janelaDeAlteracao(Date.parse("2026-09-15T15:00:00Z"), 0)).toEqual({ de: "15/09/2026", ate: "15/09/2026" });
  });
});

describe("statusPendenteDoEspelho", () => {
  const AGORA = Date.parse("2026-09-15T15:00:00Z");
  const regra = { carenciaH: 12, nascendoDias: 2 };
  const h = (horas: number) => new Date(AGORA - horas * 3_600_000).toISOString();

  it("faturada e nunca lida entra", () => {
    expect(statusPendenteDoEspelho([{ n_cod_os: 1, faturada: true, status_lido_em: null }], AGORA, regra)).toEqual([1]);
  });

  it("não faturada ou já com nota não entra", () => {
    expect(statusPendenteDoEspelho([
      { n_cod_os: 1, faturada: false, status_lido_em: null },
      { n_cod_os: 2, faturada: true, nfse_status: "004", status_lido_em: h(100) },
    ], AGORA, regra)).toEqual([]);
  });

  it("presa de junho: relida só depois da carência — é o que a janela do Omie não traz mais", () => {
    const presa = { n_cod_os: 9, faturada: true, nfse_status: "003", data_faturamento: "2026-06-10" };
    expect(statusPendenteDoEspelho([{ ...presa, status_lido_em: h(3) }], AGORA, regra)).toEqual([]);
    expect(statusPendenteDoEspelho([{ ...presa, status_lido_em: h(13) }], AGORA, regra)).toEqual([9]);
  });

  it("OS apagada no Omie não é relida — cada uma era um 'OS não cadastrada' que derrubava o laço", () => {
    expect(statusPendenteDoEspelho([
      { n_cod_os: 7, faturada: true, nfse_status: "003", status_lido_em: h(200), cancelada: true, excluida_em: h(120) },
      { n_cod_os: 8, faturada: true, status_lido_em: null, cancelada: true },
    ], AGORA, regra)).toEqual([]);
  });

  it("recém-nascida fura a carência", () => {
    expect(statusPendenteDoEspelho([
      { n_cod_os: 5, faturada: true, nfse_status: "001", status_lido_em: h(0.1), data_faturamento: "2026-09-15" },
    ], AGORA, regra)).toEqual([5]);
  });
});
