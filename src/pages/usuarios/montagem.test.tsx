// Fumaça da tela de Usuários e das suas duas abas.
//
// Mesmo espírito de `pages/mobile/telas.test.tsx`: efeitos não rodam no
// renderToStaticMarkup, então o que se vê aqui é o estado inicial. O que ele
// pega — e que o typecheck não pega — é o erro estrutural em runtime: um import
// que resolve para `undefined`, um componente que virou default quando era
// named, uma árvore de Tabs mal fechada. Numa aba que só monta depois de um
// clique, esse erro apareceria primeiro para quem está usando.

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

const consultaVazia: any = new Proxy({}, {
  get: (_alvo, prop) => {
    if (prop === "then") return undefined; // não é thenable
    return () => consultaVazia;
  },
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => consultaVazia,
    auth: { getUser: async () => ({ data: { user: null } }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

vi.mock("@/hooks/useAuth", async () => {
  const { acessoDe } = await import("@/lib/modules");
  return {
    useAuth: () => ({
      user: { id: "u1" },
      profile: { id: "p1", user_id: "u1", nome: "Admin", cargo: "Financeiro", perfil: "admin", email: "a@takeat.app" },
      loading: false,
      session: null,
      acesso: acessoDe({ perfil: "admin" }),
      signOut: async () => {},
      refreshProfile: async () => {},
      recarregarMatriz: async () => {},
    }),
    useAcesso: () => acessoDe({ perfil: "admin" }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import Usuarios from "@/pages/Usuarios";
import PerfisAcesso from "./PerfisAcesso";

const monta = (el: React.ReactElement) =>
  renderToStaticMarkup(<MemoryRouter initialEntries={["/usuarios"]}>{el}</MemoryRouter>);

describe("tela de Usuários", () => {
  it("monta com as duas abas", () => {
    const html = monta(<Usuarios />);
    expect(html).toContain("Pessoas");
    expect(html).toContain("Perfis de acesso");
  });

  /* A aba de perfis mexe em todo mundo que tem aquele perfil, não numa conta —
     por isso ela é aba, e não um campo dentro do diálogo de editar usuário. */
  it("a aba de perfis monta sozinha", () => {
    expect(() => monta(<PerfisAcesso />)).not.toThrow();
  });
});
