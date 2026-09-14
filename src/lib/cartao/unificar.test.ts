import { describe, expect, it } from "vitest";
import { raizDoMemo, unificarEstabelecimentos } from "./unificar";
import { analisar, type Fatura, type Lancamento } from "@/pages/cartao/analise";

/* MEMO de largura fixa: 22 colunas de nome, faixa em branco até a 30, cidade. */
const memo = (nome: string, cidade = "SAO PAULO") => nome.padEnd(30) + cidade;

let seq = 0;
const l = (competencia: string, estabelecimento: string, descricao: string | null, valor = 1_000): Lancamento => ({
  id: `l${seq++}`, competencia, data: competencia, estabelecimento, categoria: "Mídia / Tráfego pago",
  descricao, parcela: null, cidade: null, valor, tipo: "gasto",
});

describe("unificarEstabelecimentos", () => {
  it("lê a mesma raiz nos dois jeitos que o Sicoob escreve o Facebook", () => {
    // Linhas reais de jan/26 e set/26.
    expect(raizDoMemo(memo("FACEBK *64SXQ6M282V"))).toBe(raizDoMemo(memo("FACEBK* HYLE975282V", "ITAIM BIBI")));
    expect(raizDoMemo(memo("FACEBK *6WVGSZRZ72V"))).toBe(raizDoMemo(memo("FACEBK *64SXQ6M282V")));
    expect(raizDoMemo(null)).toBeNull();
  });

  it("funde o nome que outro importador deu em outra fatura, e o histórico vence", () => {
    const lancs = [
      l("2026-07-01", "META ADS", memo("FACEBK *2Z2P6QZZ72V")),
      l("2026-08-01", "META ADS", memo("FACEBK* STRTLVMZ72V", "ITAIM BIBI")),
      l("2026-09-01", "META / FACEBOOK ADS", memo("FACEBK *6WVGSZRZ72V")),
    ];
    expect(unificarEstabelecimentos(lancs).map((x) => x.estabelecimento)).toEqual(["META ADS", "META ADS", "META ADS"]);
  });

  it("no empate de faturas, fica o nome que chegou primeiro", () => {
    const lancs = [
      l("2026-09-01", "META / FACEBOOK ADS", memo("FACEBK *6WVGSZRZ72V")),
      l("2026-08-01", "META ADS", memo("FACEBK *49GFAT5282V")),
    ];
    expect(unificarEstabelecimentos(lancs).map((x) => x.estabelecimento)).toEqual(["META ADS", "META ADS"]);
  });

  it("não funde dois nomes que convivem na MESMA fatura — ali a separação foi de propósito", () => {
    const lancs = [
      l("2026-08-01", "GOOGLE ADS", memo("DL     *GOOGLE ADS78")),
      l("2026-08-01", "GOOGLE (outros)", memo("DL     *GOOGLE XY12")),
      l("2026-09-01", "GOOGLE ADS", memo("DL     *GOOGLE ADS91")),
    ];
    expect(raizDoMemo(lancs[0].descricao)).toBe(raizDoMemo(lancs[1].descricao)); // raiz grossa de verdade
    expect(unificarEstabelecimentos(lancs).map((x) => x.estabelecimento))
      .toEqual(["GOOGLE ADS", "GOOGLE (outros)", "GOOGLE ADS"]);
  });

  it("com raiz igual e nome que não contém o outro, não funde — o caso real do Google Ads", () => {
    // Em jul/ago a raiz "GOOGLE" era de "GOOGLE (outros)"; em set/26 a mesma raiz
    // veio como GOOGLE ADS, que é outra rubrica. Meses separados, nome diferente.
    const lancs = [
      l("2026-08-01", "GOOGLE (outros)", memo("DL     *GOOGLE XY12")),
      l("2026-09-01", "GOOGLE ADS", memo("DL     *GOOGLE ADS78")),
      l("2026-08-01", "DM", memo("DM*hostingercombV")),
      l("2026-09-01", "HOSTINGER", memo("DM*hostingercombV")),
    ];
    expect(unificarEstabelecimentos(lancs)).toBe(lancs);
  });

  it("funde quando o nome novo só acrescenta palavras ao antigo", () => {
    const lancs = [
      l("2026-08-01", "DATADOG", memo("DATADOG, INC.V")),
      l("2026-09-01", "DATADOG, INC.V", memo("DATADOG, INC.V")),
      l("2026-08-01", "ANTHROPIC", memo("ANTHROPIC")),
      l("2026-09-01", "CLAUDE.AI / ANTHROPIC", memo("ANTHROPIC")),
    ];
    expect(unificarEstabelecimentos(lancs).map((x) => x.estabelecimento))
      .toEqual(["DATADOG", "DATADOG", "ANTHROPIC", "ANTHROPIC"]);
  });

  it("não encosta em lojista de raiz diferente nem em linha sem MEMO", () => {
    const lancs = [
      l("2026-08-01", "HUBSPOT", memo("Hubspot Inc.V")),
      l("2026-09-01", "META / FACEBOOK ADS", memo("FACEBK *6WVGSZRZ72V")),
      l("2026-09-01", "AJUSTE MANUAL", null),
    ];
    expect(unificarEstabelecimentos(lancs)).toBe(lancs);
  });

  it("na matriz, a Meta volta a ser UMA linha, sem 'novo' nem −100%", () => {
    const faturas: Fatura[] = ["2026-07-01", "2026-08-01", "2026-09-01"].map((c) => ({
      competencia: c, mes_label: c, fechamento: null, arquivo: null,
    }));
    const lancs = unificarEstabelecimentos([
      l("2026-07-01", "META ADS", memo("FACEBK *2Z2P6QZZ72V"), 130_900),
      l("2026-08-01", "META ADS", memo("FACEBK *49GFAT5282V"), 148_700),
      l("2026-09-01", "META / FACEBOOK ADS", memo("FACEBK *6WVGSZRZ72V"), 120_900),
    ]);
    const a = analisar(faturas, lancs);
    expect(a.estabelecimentos).toHaveLength(1);
    const meta = a.estabelecimentos[0];
    expect(meta.chave).toBe("META ADS");
    expect(meta.novo).toBe(false);
    expect(meta.sumiu).toBe(false);
    expect(meta.deltaPenultimo).toBe(120_900 - 148_700);
  });
});
