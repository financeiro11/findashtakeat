import { describe, it, expect } from "vitest";
import { Kanban } from "lucide-react";
import {
  GRUPOS_FINANCEIRO, GRUPO_FACILITIES, GRUPO_PARCERIAS, GRUPO_BUSCA_EXTRA,
  gruposVisiveis, itensDe, termosDeBusca, type NavGrupo, type NavItem,
} from "./navegacao";
import { ROTAS, resolverDinamica } from "./rotas";
import { moduleAccess } from "./modules";

const TODOS: { grupo: string; item: NavItem }[] = [
  ...GRUPOS_FINANCEIRO, GRUPO_FACILITIES, GRUPO_BUSCA_EXTRA,
].flatMap((g) => g.items.map((item) => ({ grupo: g.label, item })));

describe("catálogo de navegação", () => {
  it("não repete rota dentro do Hub Financeiro", () => {
    const urls = itensDe(GRUPOS_FINANCEIRO).map((i) => i.url);
    expect(urls).toHaveLength(new Set(urls).size);
  });

  // O bug que originou este arquivo: o menu tinha Parceiros, a busca não. Eram duas
  // listas. Agora é uma só — e o teste garante que continue sendo.
  it("a busca enxerga tudo que está no menu", () => {
    const conjuntos: NavGrupo[][] = [GRUPOS_FINANCEIRO, [GRUPO_FACILITIES], [GRUPO_PARCERIAS]];
    for (const grupos of conjuntos) {
      for (const item of itensDe(grupos)) {
        expect(item.title.trim()).not.toBe("");
        expect(item.url.startsWith("/")).toBe(true);
      }
    }
    const urls = itensDe(GRUPOS_FINANCEIRO).map((i) => i.url);
    expect(urls).toContain("/operacional/parceiros");
  });

  // Rota sem entrada no ROTAS mostra o próprio caminho como breadcrumb ("/orcamento")
  // e o Assistente não sabe dizer de onde a pergunta veio.
  it("toda tela do menu tem breadcrumb em ROTAS", () => {
    const orfas = TODOS
      .filter(({ item }) => !ROTAS[item.url] && !resolverDinamica(item.url))
      .map(({ item }) => item.url);
    expect(orfas).toEqual([]);
  });
});

describe("termosDeBusca", () => {
  it("aceita o texto sem acento", () => {
    const termos = termosDeBusca("Facilities", { title: "Solicitações", url: "/facilities/solicitacoes", icon: Kanban });
    expect(termos).toContain("solicitacoes");
  });

  it("aceita o caminho da rota e os sinônimos", () => {
    const parceiros = GRUPOS_FINANCEIRO[0].items.find((i) => i.url === "/operacional/parceiros")!;
    const termos = termosDeBusca("Início", parceiros);
    expect(termos).toContain("Parceiros");
    expect(termos).toContain("parceiros");                 // sem acento, minúsculo
    expect(termos).toContain("/operacional/parceiros");    // quem decora o caminho
    expect(termos).toContain("embaixadores");              // sinônimo do catálogo
  });

  it("não repete termo", () => {
    for (const { grupo, item } of TODOS) {
      const termos = termosDeBusca(grupo, item);
      expect(termos).toHaveLength(new Set(termos).size);
    }
  });
});

describe("gruposVisiveis", () => {
  it("cargo de parcerias só enxerga Parceiros", () => {
    const grupos = gruposVisiveis(moduleAccess("parcerias"), "financeiro");
    expect(itensDe(grupos).map((i) => i.url)).toEqual(["/operacional/parceiros"]);
  });

  it("cargo de facilities não enxerga o Hub Financeiro", () => {
    const grupos = gruposVisiveis(moduleAccess("facilities"), "facilities");
    expect(grupos).toEqual([GRUPO_FACILITIES]);
    expect(itensDe(grupos).every((i) => i.url.startsWith("/facilities"))).toBe(true);
  });

  it("admin no módulo financeiro enxerga o menu inteiro", () => {
    const grupos = gruposVisiveis(moduleAccess("financeiro"), "financeiro");
    expect(grupos).toEqual(GRUPOS_FINANCEIRO);
    expect(itensDe(grupos).length).toBeGreaterThan(30);
  });
});
