import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import SimuladorTab from "./SimuladorTab";

// Mesma fumaça da página do flip: a aba monta e mostra a conta com a base
// documentada, sem depender de rede nem de localStorage preenchido.
describe("SimuladorTab", () => {
  it("renderiza com a base do fechamento e um cenário em branco", () => {
    const html = renderToString(
      <MemoryRouter>
        <SimuladorTab baseLedger={[{ id: "a", nome: "Alguém", acoes: 100 }]} />
      </MemoryRouter>,
    );
    expect(html).toContain("Simulador de rodadas");
    expect(html).toContain("100.000");   // ações da base do fechamento
    expect(html).toContain("Series B");  // a rodada em branco já vem nomeada
  });
});
