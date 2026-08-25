// Fumaça das seis abas: monta cada tela e confere que a árvore renderiza.
//
// Não substitui abrir no celular — efeitos não rodam no renderToStaticMarkup, então o que
// se vê aqui é o estado inicial. O que ele pega, e que já custou caro, é o erro estrutural:
// componente indefinido, import faltando, elemento inválido. Numa árvore montada por
// rota condicional, esse erro só apareceria no aparelho de alguém.

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

/* --- dublês: as telas só leem dados dentro de useEffect, que não roda aqui --- */
const consultaVazia: any = new Proxy(
  {},
  {
    get: (_alvo, prop) => {
      if (prop === "then") return undefined; // não é thenable
      return () => consultaVazia;
    },
  },
);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => consultaVazia,
    auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    profile: { id: "p1", user_id: "u1", nome: "Júlia Rodrigues", cargo: "financeiro", email: "julia@takeat.app" },
    loading: false,
    session: null,
    signIn: async () => ({}),
    signOut: async () => {},
    refreshProfile: async () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MobileInicio from "./Inicio";
import MobileTarefas from "./Tarefas";
import MobileExtratos from "./Extratos";
import MobileNotas from "./Notas";
import MobileChat from "./Chat";
import MobilePerfil from "./Perfil";
import MobileLayout from "@/components/mobile/MobileLayout";
import { DesktopOnly } from "@/components/mobile/DesktopOnly";
import { ABAS, tituloDaAba } from "@/components/mobile/MobileBottomNav";

const monta = (elemento: React.ReactElement, rota = "/") =>
  renderToStaticMarkup(<MemoryRouter initialEntries={[rota]}>{elemento}</MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
});

/* O Radix/vaul usa useLayoutEffect, que o renderizador de servidor avisa não rodar. É
   ruído esperado deste teste — sem o filtro, `npm test` cospe dezenas de linhas. */
const erroOriginal = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
    erroOriginal(...args);
  };
});
afterAll(() => { console.error = erroOriginal; });

describe("shell", () => {
  it("monta o layout com as seis abas", () => {
    const html = monta(<MobileLayout />);
    for (const aba of ABAS) expect(html).toContain(`>${aba.curto}<`);
    expect(ABAS).toHaveLength(6);
  });

  it("o título do cabeçalho segue a rota, inclusive nas rotas filhas", () => {
    expect(tituloDaAba("/")).toBe("Início");
    expect(tituloDaAba("/tarefas")).toBe("Tarefas");
    expect(tituloDaAba("/extratos")).toBe("Extratos");
    expect(tituloDaAba("/notas/abc-123")).toBe("Notas");
    expect(tituloDaAba("/chat")).toBe("Assistente");
    expect(tituloDaAba("/perfil")).toBe("Perfil");
  });

  it("DesktopOnly explica e oferece a volta", () => {
    const html = monta(<DesktopOnly />);
    expect(html).toContain("Disponível no computador");
    expect(html).toContain("Voltar ao início");
    expect(html).toContain('href="/"');
  });
});

describe("abas", () => {
  const telas: [string, React.ReactElement, string][] = [
    ["Início", <MobileInicio />, "/"],
    ["Tarefas", <MobileTarefas />, "/tarefas"],
    ["Extratos", <MobileExtratos />, "/extratos"],
    ["Notas", <MobileNotas />, "/notas"],
    ["Chat", <MobileChat />, "/chat"],
    ["Perfil", <MobilePerfil />, "/perfil"],
  ];

  it.each(telas)("%s monta sem quebrar", (_nome, elemento, rota) => {
    const html = monta(elemento, rota);
    expect(html.length).toBeGreaterThan(0);
  });

  it("Perfil mostra quem está logado e o botão de sair", () => {
    const html = monta(<MobilePerfil />, "/perfil");
    expect(html).toContain("Júlia Rodrigues");
    expect(html).toContain("julia@takeat.app");
    expect(html).toContain("Sair da conta");
  });

  it("Chat abre com sugestões e o campo de digitar", () => {
    const html = monta(<MobileChat />, "/chat");
    expect(html).toContain("Pergunte algo");
    expect(html).toContain("<textarea");
  });

  it("Tarefas abre nos três chips de filtro", () => {
    const html = monta(<MobileTarefas />, "/tarefas");
    expect(html).toContain(">Minhas<");
    expect(html).toContain(">Todas<");
    expect(html).toContain("Atrasadas");
  });

  it("Extratos abre nas três fontes, com busca", () => {
    const html = monta(<MobileExtratos />, "/extratos");
    expect(html).toContain(">Cartão<");
    expect(html).toContain(">Sicoob<");
    expect(html).toContain(">Asaas<");
    expect(html).toContain('type="search"');
  });
});
