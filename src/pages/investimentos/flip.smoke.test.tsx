import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import Flip from "./Flip";

// Fumaça: a página inteira renderiza sem estourar? É o que o `npm run build`
// NÃO responde — ele descarta os tipos e entrega uma tela branca sem reclamar.
// renderToString basta: não precisa de DOM e quebra no mesmo lugar que o
// navegador quebraria.
describe("Flip", () => {
  it("renderiza sem erro e mostra os números do fechamento", () => {
    const html = renderToString(
      <MemoryRouter>
        <TooltipProvider>
          <Flip />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(html).toContain("Flip");
    expect(html).toContain("Takeat Holding Ltd.");
    expect(html).toContain("42,97%");     // participação do fundador
    expect(html).toContain("100.000");    // capital totalmente diluído
  });
});
