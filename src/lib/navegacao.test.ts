import { describe, it, expect } from "vitest";
import { Kanban } from "lucide-react";
import {
  GRUPOS_FINANCEIRO, GRUPO_FACILITIES, GRUPO_PARCERIAS, GRUPO_BUSCA_EXTRA,
  gruposVisiveis, itensDe, pontuarBusca, termosDeBusca, type NavGrupo, type NavItem,
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

/* A busca de verdade, com o catálogo de verdade — é como o ⌘K chama `pontuarBusca`. */
function buscar(consulta: string): string[] {
  return GRUPOS_FINANCEIRO
    .flatMap((g) => g.items.map((item) => ({
      titulo: item.title,
      pontos: pontuarBusca(`${g.label} ${item.title}`, consulta, termosDeBusca(g.label, item)),
    })))
    .filter((r) => r.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .map((r) => r.titulo);
}

describe("pontuarBusca (o filtro do ⌘K)", () => {
  /* O bug: o fuzzy padrão do cmdk casa por SUBSEQUÊNCIA, e digitar "monitoramento"
     trazia Caixa, Visão do Time, Anotações e Revisão Mensal — as letras estavam
     espalhadas pelos sinônimos de cada um. */
  it("'monitoramento' acha Monitoramento e mais nada", () => {
    expect(buscar("monitoramento")).toEqual(["Monitoramento"]);
  });

  it("não casa letras soltas espalhadas pelo item", () => {
    // "cxa" está em "Caixa" como subsequência, mas não como pedaço de palavra.
    expect(buscar("cxa")).not.toContain("Caixa");
    expect(buscar("caixa")).toContain("Caixa");
  });

  it("acha pelo sinônimo das três abas de Monitoramento", () => {
    for (const termo of ["cron", "gmail", "agente", "credencial", "esteira"]) {
      expect(buscar(termo)).toContain("Monitoramento");
    }
  });

  it("o que está escrito na linha vale mais que o sinônimo", () => {
    const naLinha = pontuarBusca("Configurações Monitoramento", "monitoramento", ["cron"]);
    const sinonimo = pontuarBusca("Início Caixa", "monitoramento", ["monitoramento"]);
    expect(naLinha).toBeGreaterThan(sinonimo);
    expect(sinonimo).toBeGreaterThan(0);
  });

  it("toda palavra da consulta precisa casar", () => {
    expect(pontuarBusca("Governança Auditoria", "auditoria bicicleta", [])).toBe(0);
    expect(pontuarBusca("Governança Auditoria", "governanca auditoria", [])).toBeGreaterThan(0);
  });

  it("ignora acento nos dois lados", () => {
    expect(buscar("orcamento")).toContain("Orçamento");
    expect(buscar("integrações")).toContain("Monitoramento");
  });

  it("consulta vazia deixa o menu inteiro passar", () => {
    expect(pontuarBusca("Início Caixa", "", [])).toBeGreaterThan(0);
  });

  it("consulta sem resposta devolve lista vazia", () => {
    expect(buscar("zimbabue")).toEqual([]);
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
