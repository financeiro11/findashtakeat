import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AREAS, NATUREZAS, corDaArea, rotuloClassificacao } from "./classificacao";

/**
 * O vocabulário vive em três lugares que PRECISAM concordar:
 *   1. aqui (o seletor da tela e o filtro do quadro),
 *   2. supabase/functions/tarefas-classificar (o que a IA pode responder),
 *   3. fn_classifica_texto na migration (o carimbo automático de toda tarefa nova).
 *
 * Divergir não quebra nada — é esse o problema. A área extra simplesmente vira
 * uma fatia órfã no gráfico da aba Análise (que agrupa por igualdade EXATA da
 * string) ou um valor que o seletor não oferece e ninguém consegue corrigir.
 * Um acento a menos basta. Estes testes leem os três arquivos e comparam.
 */

const raiz = resolve(__dirname, "../../..");
const fonteIA = readFileSync(
  resolve(raiz, "supabase/functions/tarefas-classificar/index.ts"),
  "utf8",
);
const fonteSQL = readFileSync(
  resolve(raiz, "supabase/migrations/20260827270000_tarefas_classificacao_modulos_do_hub.sql"),
  "utf8",
);

/** Os itens de um `const X = [ ... ] as const` na fonte da Edge Function. */
function listaTS(fonte: string, nome: string): string[] {
  const m = new RegExp(`const ${nome} = \\[([\\s\\S]*?)\\] as const`).exec(fonte);
  if (!m) throw new Error(`não achei a lista ${nome} na Edge Function`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("vocabulário de classificação", () => {
  it("a Edge Function oferece exatamente as mesmas áreas que a tela", () => {
    expect(listaTS(fonteIA, "AREAS")).toEqual([...AREAS]);
  });

  it("a Edge Function oferece exatamente as mesmas naturezas que a tela", () => {
    expect(listaTS(fonteIA, "NATUREZAS")).toEqual([...NATUREZAS]);
  });

  it("o carimbo do banco só produz áreas que a tela conhece", () => {
    // `a := 'Tesouraria';` — os destinos possíveis de fn_classifica_texto.
    const doBanco = new Set([...fonteSQL.matchAll(/a := '([^']+)'/g)].map((m) => m[1]));
    expect(doBanco.size).toBeGreaterThan(5); // se o regex parar de casar, o teste não pode passar vazio
    for (const area of doBanco) expect(AREAS).toContain(area as never);
  });

  it("o carimbo do banco só produz naturezas que a tela conhece", () => {
    const doBanco = new Set([...fonteSQL.matchAll(/n := '([^']+)'/g)].map((m) => m[1]));
    expect([...doBanco].sort()).toEqual([...NATUREZAS].sort());
  });
});

describe("corDaArea", () => {
  it("dá uma cor a cada área conhecida, sem repetir", () => {
    const cores = AREAS.map(corDaArea);
    expect(new Set(cores).size).toBe(AREAS.length);
  });

  it("não quebra com área desconhecida — devolve o cinza neutro", () => {
    // Semanas antigas do resumo trazem áreas do vocabulário anterior ("Processos").
    // O gráfico precisa desenhar mesmo assim, e não com `background: undefined`.
    expect(corDaArea("Processos")).toBe("#64748b");
  });
});

describe("rotuloClassificacao", () => {
  it("junta o que a busca precisa varrer", () => {
    expect(rotuloClassificacao({ cat_natureza: "Operacional", cat_area: "Tesouraria", rotina: true }))
      .toBe("Operacional Tesouraria rotina");
  });

  it("omite o que não existe, sem deixar espaço solto", () => {
    expect(rotuloClassificacao({ cat_natureza: null, cat_area: "Auditoria", rotina: false }))
      .toBe("Auditoria");
  });
});
