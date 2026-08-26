import { describe, expect, it } from "vitest";
import { raizSupabase, urlDaFuncao } from "./urlFuncao";

describe("raizSupabase", () => {
  it("tira o sufixo do PostgREST — o valor que derrubou o chat na Vercel", () => {
    expect(raizSupabase("https://lgcxyxyidoirqmbdlldh.supabase.co/rest/v1/"))
      .toBe("https://lgcxyxyidoirqmbdlldh.supabase.co");
  });

  it("tira os outros sufixos de API e a barra final", () => {
    expect(raizSupabase("https://x.supabase.co/auth/v1")).toBe("https://x.supabase.co");
    expect(raizSupabase("https://x.supabase.co/storage/v1/")).toBe("https://x.supabase.co");
    expect(raizSupabase("https://x.supabase.co/functions/v1")).toBe("https://x.supabase.co");
    expect(raizSupabase("https://x.supabase.co//")).toBe("https://x.supabase.co");
  });

  it("não mexe no endereço já certo", () => {
    expect(raizSupabase("https://x.supabase.co")).toBe("https://x.supabase.co");
  });

  it("aguenta valor vazio sem estourar", () => {
    expect(raizSupabase("")).toBe("");
    expect(raizSupabase(undefined as unknown as string)).toBe("");
  });
});

describe("urlDaFuncao", () => {
  it("monta o endereço da função a partir do cliente, não da variável de ambiente", () => {
    const url = urlDaFuncao("ai-chat");
    expect(url).toBe("https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/ai-chat");
    // A regressão de 25/08/26: qualquer sufixo de outra API aqui manda o fetch ao
    // PostgREST, que responde 401 e a tela culpa o assistente.
    expect(url).not.toContain("/rest/v1");
    expect(url).not.toContain("//functions");
  });

  it("não duplica barra quando o nome vem com uma", () => {
    expect(urlDaFuncao("/ai-chat")).toBe("https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/ai-chat");
  });
});
