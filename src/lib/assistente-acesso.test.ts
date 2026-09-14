// As portas do Assistente fecham por OMISSÃO — e é por isso que elas precisam de teste.
//
// Fechar por omissão é a direção certa de errar, mas tem um custo: o esquecimento não
// aparece como erro, aparece como uma consulta que simplesmente não roda, para todo mundo,
// em silêncio. Quem escreveu a consulta testa com a própria conta de admin (que passa por
// tudo) e não vê nada. Estes testes transformam esse silêncio em vermelho no CI.
//
// Duas listas, dois arquivos, um invariante cada:
//   • toda fonte do catálogo tem área mapeada para uma capacidade;
//   • toda consulta do roteador tem entrada no mapa de capacidades.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGO, capacidadeDaFonte, catalogoParaPrompt } from "../../supabase/functions/_shared/assistente/catalogo.ts";
import { CAPACIDADES } from "./modules";

const RAIZ = process.cwd();
const ROTEADOR = readFileSync(
  join(RAIZ, "supabase/functions/assistente-responder/index.ts"), "utf8",
);

/** Os nomes dentro de um array literal `const NOME = [ "a", "b" ]`. */
function nomesDoArray(fonte: string, nome: string): string[] {
  const bloco = new RegExp(`const ${nome}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(fonte);
  if (!bloco) throw new Error(`Não achei o array ${nome} no roteador.`);
  return [...bloco[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** As chaves de um objeto literal `const NOME: T = { a: ..., b: ... }`. */
function chavesDoObjeto(fonte: string, nome: string): string[] {
  const bloco = new RegExp(`const ${nome}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(fonte);
  if (!bloco) throw new Error(`Não achei o objeto ${nome} no roteador.`);
  return [...bloco[1].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
}

describe("catálogo de fontes × capacidades", () => {
  it("toda fonte tem uma capacidade — nenhuma cai no fechado por esquecimento", () => {
    const semPorta = CATALOGO.filter((f) => capacidadeDaFonte(f.id) === null)
      .map((f) => `${f.id} (área "${f.area}")`);
    expect(
      semPorta,
      "Fonte sem capacidade não abre para ninguém e falha calada. Acrescente a ÁREA dela em " +
      "CAPACIDADE_POR_AREA, em supabase/functions/_shared/assistente/catalogo.ts.",
    ).toEqual([]);
  });

  it("as capacidades usadas existem de verdade", () => {
    const validas = new Set(Object.keys(CAPACIDADES));
    const inventadas = [...new Set(CATALOGO.map((f) => capacidadeDaFonte(f.id)))]
      .filter((c): c is string => !!c && !validas.has(c));
    expect(inventadas, "Capacidade que não existe em modules.ts nunca casa: a fonte fica fechada.")
      .toEqual([]);
  });

  it("o catálogo do prompt encolhe com o crachá", () => {
    const soFacilities = catalogoParaPrompt((c) => c === "facilities");
    expect(soFacilities).toContain("facilities_solicitacoes");
    expect(soFacilities).not.toContain("historico_financeiro");
    expect(soFacilities).not.toContain("cap_titulos");
    // Sem filtro (chamada de sistema), continua vindo tudo.
    expect(catalogoParaPrompt()).toContain("historico_financeiro");
  });

  it("sem capacidade nenhuma, o prompt não oferece fonte alguma", () => {
    expect(catalogoParaPrompt(() => false).trim()).toBe("");
  });
});

describe("consultas do roteador × capacidades", () => {
  it("toda consulta tem entrada no mapa de capacidades", () => {
    const consultas = nomesDoArray(ROTEADOR, "CONSULTAS");
    const mapeadas = new Set(chavesDoObjeto(ROTEADOR, "CAPACIDADE_DA_CONSULTA"));
    expect(consultas.length).toBeGreaterThan(10); // o regex achou o array certo

    const orfas = consultas.filter((c) => !mapeadas.has(c));
    expect(
      orfas,
      "Consulta sem entrada em CAPACIDADE_DA_CONSULTA não roda para ninguém além da service " +
      "role — e falha calada, porque `podeConsulta` fecha por omissão. Acrescente a linha em " +
      "supabase/functions/assistente-responder/index.ts.",
    ).toEqual([]);
  });

  it("o mapa não guarda consulta que não existe mais", () => {
    const consultas = new Set(nomesDoArray(ROTEADOR, "CONSULTAS"));
    const sobrando = chavesDoObjeto(ROTEADOR, "CAPACIDADE_DA_CONSULTA")
      .filter((c) => !consultas.has(c));
    expect(sobrando).toEqual([]);
  });
});
