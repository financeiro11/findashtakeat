import { describe, expect, it, vi } from "vitest";

// O módulo importa o client do Supabase no topo. O que se testa aqui é o
// PARSER — a parte que não fala com a rede —, então o client entra mockado só
// para o import resolver.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({}) } },
}));

const { partesDoUrl } = await import("./arquivoPrivado");

const BASE = "https://lgcxyxyidoirqmbdlldh.supabase.co/storage/v1/object";

describe("partesDoUrl", () => {
  it("lê bucket e caminho da forma pública, que é a gravada no banco", () => {
    expect(partesDoUrl(`${BASE}/public/workspace-assets/pasta/1787084662767-image.png`))
      .toEqual({ bucket: "workspace-assets", caminho: "pasta/1787084662767-image.png" });
  });

  it("lê também a forma assinada — é o que permite desfazer a assinatura ao gravar", () => {
    expect(partesDoUrl(`${BASE}/sign/playbook-assets/x/y.docx?token=eyJhbGciOi.abc`))
      .toEqual({ bucket: "playbook-assets", caminho: "x/y.docx" });
  });

  it("devolve o caminho DECODIFICADO, que é como o storage o quer", () => {
    // O nome com espaço chega percent-encoded na URL; pedir assinatura com o
    // %20 literal devolve "não encontrado" — e a imagem some sem erro visível.
    expect(partesDoUrl(`${BASE}/public/playbook-assets/pasta/Nota%20fiscal.pdf`)?.caminho)
      .toBe("pasta/Nota fiscal.pdf");
  });

  it("ignora bucket que não é destes três", () => {
    // `comprovantes-auditoria` tem resolvedor próprio (lib/comprovante.ts).
    expect(partesDoUrl(`${BASE}/public/comprovantes-auditoria/a/b.pdf`)).toBeNull();
  });

  it("ignora URL que não é do storage", () => {
    expect(partesDoUrl("https://drive.google.com/file/d/abc/view")).toBeNull();
    expect(partesDoUrl("")).toBeNull();
  });
});
