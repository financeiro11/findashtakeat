import { describe, it, expect } from "vitest";
import {
  trocarEmLote,
  resumoLote,
  categoriasDaSelecao,
  podeTrocarCategoria,
  motivoNaoAlteravel,
  RECUSAS_ATE_DESISTIR,
  type ItemLote,
} from "./loteCategoria";

const item = (codTitulo: string, categoria = "3.1.2.1"): ItemLote => ({
  codTitulo,
  contraparte: `FORNECEDOR ${codTitulo}`,
  valor: -550,
  categoriaCodigo: categoria,
  categoriaDescricao: `Categoria ${categoria}`,
});

const seis = ["1", "2", "3", "4", "5", "6"].map((c) => item(c));

describe("podeTrocarCategoria", () => {
  it("só título financeiro de verdade — é a regra que o servidor aplica", () => {
    expect(podeTrocarCategoria("CONTA_A_PAGAR")).toBe(true);
    expect(podeTrocarCategoria("CONTA_A_RECEBER")).toBe(true);
  });

  it("previsão de OS/contrato e perna bancária ficam de fora, com o porquê", () => {
    for (const g of ["PREVISAO_ORDEM_SERVICO", "PREVISAO_CONTRATO", "CONTA_CORRENTE_PAG", "CONTA_CORRENTE_REC", null]) {
      expect(podeTrocarCategoria(g)).toBe(false);
    }
    expect(motivoNaoAlteravel("PREVISAO_CONTRATO")).toMatch(/ordem de serviço|contrato/i);
    expect(motivoNaoAlteravel("CONTA_CORRENTE_PAG")).toMatch(/perna bancária/i);
  });
});

describe("trocarEmLote", () => {
  it("chama um de cada vez, em ordem — a API do Omie recusa simultâneo", async () => {
    let emVoo = 0;
    const ordem: string[] = [];
    await trocarEmLote(seis, async (it) => {
      expect(emVoo).toBe(0);
      emVoo++;
      await new Promise((r) => setTimeout(r, 1));
      ordem.push(it.codTitulo);
      emVoo--;
      return { ok: true };
    });
    expect(ordem).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("uma recusa isolada não derruba o resto do lote", async () => {
    const r = await trocarEmLote(seis, async (it) =>
      it.codTitulo === "2" ? { ok: false, erro: "título rateado" } : { ok: true });
    expect(r.resultados).toHaveLength(6);
    expect(resumoLote(r)).toMatchObject({ ok: 5, falhas: 1, naoTentados: 0 });
    expect(r.interrompidoPor).toBeNull();
  });

  it("exceção da rede vira falha DESTE item, não do lote", async () => {
    const r = await trocarEmLote(seis, async (it) => {
      if (it.codTitulo === "3") throw new Error("Failed to fetch");
      return { ok: true };
    });
    expect(r.resultados.find((x) => x.item.codTitulo === "3")).toMatchObject({ ok: false, erro: "Failed to fetch" });
    expect(resumoLote(r).ok).toBe(5);
  });

  it("desiste depois de três recusas IGUAIS — o ERP está recusando todos, não este", async () => {
    let chamadas = 0;
    const r = await trocarEmLote(seis, async () => {
      chamadas++;
      return { ok: false, erro: "Período contábil fechado" };
    });
    expect(chamadas).toBe(RECUSAS_ATE_DESISTIR);
    expect(r.interrompidoPor).toBe("Período contábil fechado");
    expect(r.naoTentados.map((x) => x.codTitulo)).toEqual(["4", "5", "6"]);
    expect(resumoLote(r).frase).toContain("Nenhum lançamento foi alterado");
  });

  it("recusas DIFERENTES não interrompem: são problemas de títulos diferentes", async () => {
    let n = 0;
    const r = await trocarEmLote(seis, async () => ({ ok: false, erro: `erro ${++n}` }));
    expect(r.resultados).toHaveLength(6);
    expect(r.interrompidoPor).toBeNull();
  });

  it("um sucesso no meio zera a conta: duas recusas, acerto, duas recusas vai até o fim", async () => {
    const r = await trocarEmLote(seis, async (it) =>
      it.codTitulo === "3" || it.codTitulo === "6" ? { ok: true } : { ok: false, erro: "mesmo erro" });
    expect(r.resultados).toHaveLength(6);
    expect(r.interrompidoPor).toBeNull();
    expect(r.naoTentados).toHaveLength(0);
  });

  it("trinca no ÚLTIMO item não é interrupção — não sobrou nada para pular", async () => {
    const r = await trocarEmLote(seis, async (it) =>
      Number(it.codTitulo) <= 3 ? { ok: true } : { ok: false, erro: "mesmo erro" });
    expect(r.resultados).toHaveLength(6);
    expect(r.naoTentados).toHaveLength(0);
    expect(r.interrompidoPor).toBeNull();
  });

  it("mas a trinca no meio pula o resto", async () => {
    const dez = Array.from({ length: 10 }, (_, i) => item(String(i + 1)));
    const r = await trocarEmLote(dez, async (it) =>
      Number(it.codTitulo) <= 2 ? { ok: true } : { ok: false, erro: "mesmo erro" });
    expect(r.resultados).toHaveLength(5);
    expect(r.interrompidoPor).toBe("mesmo erro");
    expect(r.naoTentados).toHaveLength(5);
  });

  it("cancelar para antes do próximo, e o que já foi continua feito", async () => {
    let parar = false;
    const r = await trocarEmLote(seis, async (it) => {
      if (it.codTitulo === "2") parar = true;
      return { ok: true };
    }, { cancelado: () => parar });
    expect(r.cancelado).toBe(true);
    expect(r.resultados).toHaveLength(2);
    expect(r.naoTentados.map((x) => x.codTitulo)).toEqual(["3", "4", "5", "6"]);
    expect(resumoLote(r).frase).toContain("2 alterados");
  });

  it("informa o progresso a cada item, com o total", async () => {
    const passos: string[] = [];
    await trocarEmLote(seis.slice(0, 3), async () => ({ ok: true }), {
      onProgresso: (feitos, total) => passos.push(`${feitos}/${total}`),
    });
    expect(passos).toEqual(["1/3", "2/3", "3/3"]);
  });

  it("lista vazia não chama nada nem inventa erro", async () => {
    const r = await trocarEmLote([], async () => ({ ok: true }));
    expect(r.resultados).toHaveLength(0);
    expect(r.naoTentados).toHaveLength(0);
    expect(r.interrompidoPor).toBeNull();
  });
});

describe("resumoLote", () => {
  it("tudo certo, uma frase só", async () => {
    const r = await trocarEmLote(seis.slice(0, 2), async () => ({ ok: true }));
    expect(resumoLote(r).frase).toBe("2 lançamentos alterados no Omie.");
  });

  it("um só, no singular", async () => {
    const r = await trocarEmLote(seis.slice(0, 1), async () => ({ ok: true }));
    expect(resumoLote(r).frase).toBe("1 lançamento alterado no Omie.");
  });
});

describe("categoriasDaSelecao", () => {
  it("mostra de onde os selecionados estão saindo, do mais comum ao menos", () => {
    const cats = categoriasDaSelecao([item("1"), item("2"), item("3", "2.04.12"), item("4")]);
    expect(cats.map((c) => [c.codigo, c.n])).toEqual([["3.1.2.1", 3], ["2.04.12", 1]]);
  });

  it("lançamento sem categoria não some da conta", () => {
    const semCat: ItemLote = { ...item("9"), categoriaCodigo: null, categoriaDescricao: null };
    expect(categoriasDaSelecao([semCat])).toEqual([{ codigo: "—", descricao: "—", n: 1 }]);
  });
});
