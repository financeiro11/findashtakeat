import { describe, expect, it } from "vitest";
import { destinoSugerido, tipoEFamilia, type CategoriaDestino } from "./cac";

/* As categorias de folha lançáveis em 14/09/2026 (`omie_categorias_disponiveis`). */
const cat = (codigo: string, descricao: string): CategoriaDestino => ({ codigo, descricao, rubrica_dre: null });
const PLANO: CategoriaDestino[] = [
  cat("2.03.11", "3.1.1.2. Pessoal - Comercial"),
  cat("2.03.13", "3.1.1.4. Pessoal - Tecnologia"),
  cat("2.03.99", "3.1.1.5. Premiação - Comercial"),
  cat("2.03.98", "3.1.1.6. Premiação - Onboarding"),
  cat("2.03.07", "3.1.1.15 Premiação - Novos Canais"),
  cat("2.03.08", "3.1.1.10 Pessoal - Novos Canais"),
  cat("2.01.95", "3.1.1.10 Premiação - Suporte"),
  cat("2.03.03", "3.1.1.11 Premiação - Sucesso"),
  cat("2.02.92", "3.2.7.1. Pessoal - Onboarding"),
  cat("2.01.98", "3.2.7.2. Pessoal - Suporte"),
  cat("2.01.97", "3.2.7.3. Pessoal - Sucesso"),
  cat("2.01.96", "3.2.7.4. Escala - Suporte"),
  cat("2.01.90", "3.2.7.5. Escala - Onboarding"),
];

describe("tipoEFamilia", () => {
  it("separa o tipo (sem acento) da família", () => {
    expect(tipoEFamilia("3.1.1.6. Premiação - Onboarding")).toEqual({ tipo: "premiacao", familia: "Onboarding" });
    expect(tipoEFamilia("3.1.1.10 Pessoal - Novos Canais")).toEqual({ tipo: "pessoal", familia: "Novos Canais" });
  });

  it("categoria que não é de pessoa não tem família", () => {
    expect(tipoEFamilia("3.2.22 Diretores - Administrativo")).toBeNull();
    expect(tipoEFamilia("3.1.3.4 Transportes e Viagens - Marketing")).toBeNull();
    expect(tipoEFamilia(null)).toBeNull();
  });
});

describe("destinoSugerido", () => {
  it("conserva o tipo: Pessoal - Suporte de Onboarding vai para Pessoal - Onboarding", () => {
    const d = destinoSugerido(
      { categoria: "2.01.98", categoria_descricao: "3.2.7.2. Pessoal - Suporte", familias_esperadas: ["Onboarding"] },
      PLANO,
    );
    expect(d.sugerida?.codigo).toBe("2.02.92");
    expect(d.mudaTipo).toBe(false);
  });

  it("Escala vai para Escala, não para Pessoal", () => {
    const d = destinoSugerido(
      { categoria: "2.01.96", categoria_descricao: "3.2.7.4. Escala - Suporte", familias_esperadas: ["Onboarding"] },
      PLANO,
    );
    expect(d.sugerida?.codigo).toBe("2.01.90");
  });

  it("sem o mesmo tipo na família certa, não sugere e avisa que muda a natureza", () => {
    // Não existe "Escala - Sucesso".
    const d = destinoSugerido(
      { categoria: "2.01.90", categoria_descricao: "3.2.7.5. Escala - Onboarding", familias_esperadas: ["Sucesso"] },
      PLANO,
    );
    expect(d.sugerida).toBeNull();
    expect(d.mudaTipo).toBe(true);
    expect(d.candidatas.map((c) => c.codigo).sort()).toEqual(["2.01.97", "2.03.03"]);
  });

  it("mais de uma família possível: oferece todas e não escolhe", () => {
    const d = destinoSugerido(
      { categoria: "2.03.11", categoria_descricao: "3.1.1.2. Pessoal - Comercial", familias_esperadas: ["Onboarding", "Sucesso", "Suporte"] },
      PLANO,
    );
    expect(d.sugerida).toBeNull();
    expect(d.candidatas.map((c) => c.codigo).sort()).toEqual(["2.01.97", "2.01.98", "2.02.92"]);
  });

  it("família sem nenhuma categoria de pessoa: nada a oferecer", () => {
    const d = destinoSugerido(
      { categoria: "2.01.98", categoria_descricao: "3.2.7.2. Pessoal - Suporte", familias_esperadas: ["Automações"] },
      PLANO,
    );
    expect(d).toEqual({ sugerida: null, candidatas: [], mudaTipo: false });
  });
});
