// A régua do que vira aviso na vigilância de páginas.
//
// Testa o módulo do servidor direto (`_shared/vigilancia-diff.ts`, sem imports),
// como já fazem os testes do radar de preços. O que está em jogo aqui é o
// equilíbrio entre dois erros de sinais opostos: avisar demais mata a tela pelo
// tédio, avisar de menos perde o reajuste — que é a única coisa que a
// vigilância existe para pegar.

import { describe, expect, it } from "vitest";
import {
  classificarDiff, linhasAlteradas, vaiVirarAviso,
} from "../../supabase/functions/_shared/vigilancia-diff";

const diff = (...linhas: string[]) => linhas.join("\n");

describe("linhasAlteradas", () => {
  it("ignora o cabeçalho do formato", () => {
    // `+++`/`---` são metadados do git diff. Contá-los faria todo diff parecer
    // ter duas alterações a mais do que tem — e o corte de 3 linhas dispararia
    // com uma mudança só.
    const d = diff("--- a/pagina", "+++ b/pagina", "@@ -1 +1 @@", "-antigo", "+novo");
    expect(linhasAlteradas(d)).toEqual(["-antigo", "+novo"]);
  });

  it("diff vazio não tem linha alterada", () => {
    expect(linhasAlteradas("")).toEqual([]);
  });
});

describe("classificarDiff", () => {
  it("reconhece real, dólar e euro", () => {
    expect(classificarDiff(diff("-R$ 89,90 por mês", "+R$ 109,90 por mês"))).toBe("preco");
    expect(classificarDiff(diff("-$20/user", "+$25/user"))).toBe("preco");
    expect(classificarDiff(diff("+€ 15"))).toBe("preco");
  });

  it("reconhece o número antes da palavra", () => {
    expect(classificarDiff(diff("+custa 199 reais"))).toBe("preco");
  });

  it("mudar a periodicidade é mudar o preço, mesmo sem número novo", () => {
    // "R$ 1.200/ano" virando "R$ 1.200/mês" é um aumento de 12×, e nenhum
    // número mudou. Se a régua olhasse só para dígitos, passaria batido.
    expect(classificarDiff(diff("-Plano Pro /ano", "+Plano Pro /mês"))).toBe("preco");
  });

  it("texto sem dinheiro não é mudança de preço", () => {
    expect(classificarDiff(diff("-Junte-se a 10.000 empresas", "+Junte-se a 12.000 empresas"))).toBe("outro");
  });
});

describe("vaiVirarAviso", () => {
  it("uma linha só, mas com dinheiro, vira aviso", () => {
    expect(vaiVirarAviso(diff("+R$ 129,90/mês"))).toBe(true);
  });

  it("uma ou duas linhas sem dinheiro é ruído de página viva", () => {
    // O caso real que motivou o corte: contador de clientes e banner rotativo
    // mudam sozinhos todo dia. Virando aviso, em duas semanas ninguém abre mais
    // a tela — e o reajuste chega enterrado no meio do ruído.
    expect(vaiVirarAviso(diff("-Mais de 10.000 clientes", "+Mais de 12.000 clientes"))).toBe(false);
  });

  it("reescrita de seção passa mesmo sem número", () => {
    // Mudança de política (limite de uso, o que o plano inclui) importa e não
    // traz cifrão nenhum.
    expect(vaiVirarAviso(diff("-uso ilimitado", "+até 500 chamadas", "+excedente cobrado à parte"))).toBe(true);
  });

  it("página que não mudou não vira aviso", () => {
    expect(vaiVirarAviso("")).toBe(false);
    expect(vaiVirarAviso(diff("--- a/x", "+++ b/x"))).toBe(false);
  });
});
