import { describe, expect, it } from "vitest";
import {
  SEM_DEPARTAMENTO, categoriasDoDepartamento, coberturaDepartamento, departamentosDaCategoria, montarDepartamentos,
  montarRecorte, rotularLancamento,
  type CategoriaPlano, type ResumoPlano,
} from "./planoContas";

const cat = (codigo: string, descricao: string): CategoriaPlano => ({
  codigo, descricao, superior: codigo.split(".").slice(0, 2).join("."), totalizadora: false, inativa: false,
  despesa: codigo.startsWith("2"), receita: codigo.startsWith("1"), rubrica_dre: null, rubrica_dfc: null,
  regra_nota: null, folha: false, usos: 1, ultimo_uso: null,
});

/* Ago/26 com dois departamentos e o resto sem; uma receita sem departamento, que a
   visão por departamento não pode contar. */
const resumo: ResumoPlano = {
  base: "competencia",
  hoje: "2026-09-15",
  categorias_atualizado_em: null,
  movimentos_atualizado_em: null,
  categorias: [
    cat("2.03.11", "3.1.1.2. Pessoal - Comercial"),
    cat("2.07.01", "3.1.5.1 Softwares - Tecnologia"),
    cat("1.01.03", "1.1.1. Receita Assinaturas"),
  ],
  mensal: [
    ["2.03.11", "2026-08", -10000, 10, 5],
    ["2.07.01", "2026-08", -3000, 30, 12],
    ["1.01.03", "2026-08", 90000, 900, 800],
    // o volume dos meses anteriores só existe para o recorte ter começo de dados
    ["1.01.03", "2026-04", 80000, 800, 700],
    ["1.01.03", "2026-05", 80000, 800, 700],
    ["1.01.03", "2026-06", 80000, 800, 700],
    ["1.01.03", "2026-07", 80000, 800, 700],
  ],
  mensal_dep: [
    ["2.03.11", "5455967142", "2026-08", -6000, 6],   // Field Sales
    ["2.03.11", "5457969523", "2026-08", -1000, 1],   // Sucesso
    ["2.03.11", null, "2026-08", -3000, 3],
    ["2.07.01", null, "2026-08", -3000, 30],
    ["2.07.01", "5457969523", "2026-07", -500, 1],
    ["1.01.03", null, "2026-08", 90000, 900],
  ],
  departamentos: [
    { codigo: "5455967142", descricao: "Field Sales", inativo: false },
    { codigo: "5457969523", descricao: "Sucesso", inativo: false },
    { codigo: "5455967569", descricao: "Eventos", inativo: false },
  ],
  departamentos_carregados: true,
};

const recorte = montarRecorte(resumo, "mes"); // ago/26

describe("visão por departamento", () => {
  const deps = montarDepartamentos(resumo, recorte);
  const por = (codigo: string) => deps.find((d) => d.codigo === codigo)!;

  it("só conta despesa — a receita sem departamento não entra", () => {
    expect(por(SEM_DEPARTAMENTO).stats.total).toBe(6000);
  });

  it("lê despesa em módulo e soma as categorias de cada departamento", () => {
    expect(por("5455967142").stats.total).toBe(6000);
    expect(por("5457969523").stats.total).toBe(1000);
    expect(por("5457969523").categorias).toBe(1); // 2.07.01 só em julho, fora do mês
  });

  it("mostra o departamento cadastrado sem lançamento, zerado, e 'sem departamento' por último", () => {
    expect(por("5455967569").stats.total).toBe(0);
    expect(deps[deps.length - 1].codigo).toBe(SEM_DEPARTAMENTO);
    expect(deps[0].descricao).toBe("Field Sales");
  });

  it("abre as categorias de um departamento", () => {
    const cats = categoriasDoDepartamento(resumo, recorte, SEM_DEPARTAMENTO);
    expect(cats.map((c) => [c.codigo, c.stats.total])).toEqual([["2.03.11", 3000], ["2.07.01", 3000]]);
  });

  it("divide uma categoria entre departamentos, e a cobertura é a parte com departamento", () => {
    const linhas = departamentosDaCategoria(resumo, recorte, ["2.03.11"], true);
    expect(linhas.map((l) => [l.descricao, l.total])).toEqual([["Field Sales", 6000], ["Sucesso", 1000], ["Sem departamento", 3000]]);
    expect(linhas[0].participacao).toBeCloseTo(0.6, 6);
    expect(coberturaDepartamento(linhas)).toBeCloseTo(0.7, 6);
  });

  it("código que não está no cadastro aparece pelo código, não some", () => {
    const outro: ResumoPlano = { ...resumo, mensal_dep: [["2.03.11", "999", "2026-08", -10, 1]] };
    expect(montarDepartamentos(outro, recorte).find((d) => d.codigo === "999")?.descricao).toBe("Departamento 999");
  });

  it("sem valor, a cobertura é nula", () => {
    expect(coberturaDepartamento([])).toBeNull();
  });
});

describe("nome do lançamento", () => {
  it("sem apelido e sem cartão, é a contraparte do Omie", () => {
    expect(rotularLancamento({ contraparte: "ACME LTDA", observacao: null, cnpj_cpf: null }, null))
      .toEqual({ nome: "ACME LTDA", cru: "ACME LTDA", cartao: false, detalhe: null });
  });

  it("sem contraparte, diz isso", () => {
    expect(rotularLancamento({ contraparte: null, observacao: null, cnpj_cpf: null }, null).nome).toBe("Sem contraparte");
  });
});
