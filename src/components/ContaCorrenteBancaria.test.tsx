import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ContaCorrenteBancaria from "./ContaCorrenteBancaria";

/* Garante que todos os controles do extrato respondem: períodos, tipo, busca,
   carregar mais, exportar CSV e sincronizar. */

const hoje = new Date().toLocaleDateString("en-CA");
const lancamentos = Array.from({ length: 45 }, (_, i) => ({
  id: `l${i}`,
  id_transacao: `t${i}`,
  data_movimento: hoje,
  tipo: i % 2 === 0 ? "credito" : "debito",
  valor: 100 + i,
  historico: i % 2 === 0 ? "Cobrança recebida" : "Taxa do Pix",
  contraparte_nome: i % 2 === 0 ? "Cliente A" : "Cliente B",
  contraparte_documento: null,
  numero_documento: `${i}`,
}));

const invoke = vi.fn().mockResolvedValue({ data: { novos_gravados: 2 }, error: null });

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const api: any = {
      select: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: () =>
        Promise.resolve({
          data: { conta: "Asaas", saldo: 1000, saldo_disponivel: 1000, saldo_bloqueado: 0, atualizado_em: new Date().toISOString() },
          error: null,
        }),
      then: (r: any) => Promise.resolve({ data: lancamentos, error: null }).then(r),
    };
    if (table.includes("extrato")) delete api.maybeSingle;
    return api;
  };
  return { supabase: { from: (t: string) => builder(t), functions: { invoke: (...a: any[]) => invoke(...a) } } };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

describe("ContaCorrenteBancaria", () => {
  beforeEach(() => {
    invoke.mockClear();
    (URL as any).createObjectURL = vi.fn(() => "blob:x");
    (URL as any).revokeObjectURL = vi.fn();
  });

  it("todos os botões respondem", async () => {
    render(<ContaCorrenteBancaria banco="asaas" />);
    await waitFor(() => expect(screen.getAllByText("Cobrança recebida").length).toBeGreaterThan(0));

    // paginação: 30 iniciais → 45 após "Carregar mais"
    expect(screen.getAllByText("30").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Carregar mais"));
    await waitFor(() => expect(screen.getAllByText("45").length).toBeGreaterThan(0));

    // filtro por tipo
    fireEvent.click(screen.getByText("Débito"));
    await waitFor(() => expect(screen.queryByText("Cobrança recebida")).toBeNull());
    fireEvent.click(screen.getByText("Todos"));
    await waitFor(() => expect(screen.getAllByText("Cobrança recebida").length).toBeGreaterThan(0));

    // períodos
    for (const rot of ["Hoje", "7 dias", "30 dias", "Mês atual", "Tudo"]) {
      fireEvent.click(screen.getByText(rot));
      await waitFor(() => expect(screen.getAllByText("Cobrança recebida").length).toBeGreaterThan(0));
    }

    // busca
    fireEvent.change(screen.getByPlaceholderText("Buscar histórico, cliente ou fatura"), { target: { value: "Cliente B" } });
    await waitFor(() => expect(screen.queryByText("Cobrança recebida")).toBeNull());
    fireEvent.change(screen.getByPlaceholderText("Buscar histórico, cliente ou fatura"), { target: { value: "" } });

    // exportar CSV
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByText("Exportar CSV"));
    expect(clickSpy).toHaveBeenCalled();

    // sincronizar
    fireEvent.click(screen.getByText("Sincronizar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("asaas-extrato-sync", { body: { action: "sync" } }));
  });
});
