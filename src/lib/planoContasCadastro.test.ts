import { describe, expect, it } from "vitest";
import {
  chaveDescricao, ehFolha, ehPosicaoLivre, limparDescricao, validarDescricao, validarGrupo,
  type CategoriaCadastro,
} from "../../supabase/functions/_shared/plano-contas.ts";
import {
  contarFiltros, passaNoFiltro, rubricaDasIrmas, situacaoCadastro,
  type CategoriaPlano, type NoPlano,
} from "./planoContas";

const cad: CategoriaCadastro[] = [
  { codigo: "2.04", descricao: "Despesas Administrativas", superior: "2", totalizadora: true, inativa: false },
  { codigo: "2.04.07", descricao: "3.1.2.19 Outros - Administrativo", superior: "2.04", totalizadora: false, inativa: false },
  { codigo: "2.03.96", descricao: "Transporte Comercial", superior: "2.03", totalizadora: false, inativa: true },
  { codigo: "2.08", descricao: "Capex", superior: "2", totalizadora: true, inativa: true },
];

describe("nome da categoria", () => {
  it("é a mesma chave do SQL: sem acento, sem caixa, espaço colapsado", () => {
    expect(chaveDescricao("  3.1.2.19   OUTROS - Administrativo ")).toBe(chaveDescricao("3.1.2.19 Outros - Administrativo"));
    expect(chaveDescricao("Água e Esgoto")).toBe("agua e esgoto");
  });

  it("vai em NFC — o Omie recusa acento decomposto", () => {
    const decomposto = "Café";
    expect(limparDescricao(decomposto)).toBe("Café");
    expect(limparDescricao(decomposto).length).toBe(4);
  });

  it("recusa duplicata mesmo com caixa e acento diferentes, e manda reativar a inativa", () => {
    const r = validarDescricao("3.1.2.19 outros -  administrativo", cad);
    expect(r.ok).toBe(false);
    const inativa = validarDescricao("transporte comercial", cad);
    expect("erro" in inativa ? inativa.erro : "").toContain("Reative");
  });

  it("no renomear, a própria categoria não conta como duplicata", () => {
    expect(validarDescricao("3.1.2.19 Outros - Administrativo", cad, "2.04.07").ok).toBe(true);
  });

  it("respeita o limite de 50 do Omie e recusa < >", () => {
    expect(validarDescricao("x".repeat(51), cad).ok).toBe(false);
    expect(validarDescricao("x".repeat(50), cad).ok).toBe(true);
    expect(validarDescricao("<Disponível>", cad).ok).toBe(false);
    expect(validarDescricao("ab", cad).ok).toBe(false);
  });

  it("reconhece a posição livre do Omie, escapada ou não", () => {
    expect(ehPosicaoLivre("<Disponível>")).toBe(true);
    expect(ehPosicaoLivre("&lt;Disponível&gt;")).toBe(true);
    expect(ehPosicaoLivre("Disponível para venda")).toBe(false);
  });
});

describe("grupo de destino", () => {
  it("só aceita grupo ativo", () => {
    expect(validarGrupo("2.04", cad).ok).toBe(true);
    expect(validarGrupo("2.04.07", cad).ok).toBe(false); // é categoria
    expect(validarGrupo("2.08", cad).ok).toBe(false);    // desativado
    expect(validarGrupo("9.99", cad).ok).toBe(false);
  });
});

describe("folha pelo nome — espelho de categoria_e_folha", () => {
  it("casa os mesmos padrões do SQL", () => {
    expect(ehFolha("3.1.1.1. Pessoal - Administrativo")).toBe(true);
    expect(ehFolha("3.1.1.5. Premiação - Comercial")).toBe(true);
    expect(ehFolha("3.2.7.5. Escala - Onboarding")).toBe(true);
    expect(ehFolha("3.1.1.10 Pro Labore")).toBe(true);
    expect(ehFolha("3.2.22 Diretores - Administrativo")).toBe(true);
    expect(ehFolha("3.1.1.9 Benefícios - Colaboradores")).toBe(false);
    expect(ehFolha("Pessoal")).toBe(false); // sem o hífen, o SQL também não casa
  });
});

const cat = (codigo: string, extra: Partial<CategoriaPlano> = {}): CategoriaPlano => ({
  codigo, descricao: codigo, superior: codigo.split(".").slice(0, 2).join("."), totalizadora: false,
  inativa: false, despesa: true, receita: false, rubrica_dre: null, rubrica_dfc: null,
  regra_nota: null, folha: false, usos: 0, ultimo_uso: null, ...extra,
});

const no = (c: CategoriaPlano, total = 0, serie: number[] = [0, 0]): NoPlano => ({
  codigo: c.codigo, descricao: c.descricao, categoria: c, despesa: true, filhos: [],
  stats: { total, anterior: null, variacao: null, lancamentos: total ? 1 : 0, serie },
});

describe("situação na árvore", () => {
  const folhas = [
    no(cat("2.04.01", { usos: 40 }), 500),
    no(cat("2.04.02", { usos: 12 })),                     // usada antes, parada agora
    no(cat("2.04.03", { usos: 0 })),                      // nunca usada
    no(cat("2.04.95", { inativa: true, usos: 0 })),       // <Disponível>
    no(cat("2.04.96", { inativa: true, usos: 3 }), 90),   // inativa COM lançamento
  ];

  it("classifica cada uma", () => {
    expect(folhas.map(situacaoCadastro)).toEqual(["movimento", "parada", "nunca_usada", "inativa", "movimento"]);
  });

  it("a inativa com lançamento aparece nos dois filtros — é a que mais precisa ser vista", () => {
    expect(passaNoFiltro(folhas[4], "movimento")).toBe(true);
    expect(passaNoFiltro(folhas[4], "inativas")).toBe(true);
  });

  it("conta cada filtro, e 'todas' é o plano inteiro", () => {
    expect(contarFiltros(folhas)).toEqual({ movimento: 2, sem_movimento: 2, inativas: 2, todas: 5 });
  });
});

describe("rubrica sugerida para a categoria nova", () => {
  it("vota pelas irmãs ativas, pesando pelo uso", () => {
    const cats = [
      cat("2.04.01", { rubrica_dre: "Administrativa", usos: 50 }),
      cat("2.04.02", { rubrica_dre: "Consultorias", usos: 3 }),
      cat("2.04.03", { rubrica_dre: "Consultorias", usos: 4 }),
      cat("2.04.04", { rubrica_dre: "Outra", usos: 900, inativa: true }),
      cat("2.07.01", { rubrica_dre: "Tecnologia", usos: 999 }),
    ];
    expect(rubricaDasIrmas(cats, "2.04", "dre")).toBe("Administrativa");
    expect(rubricaDasIrmas(cats, "2.04", "dfc")).toBeNull();
  });
});
