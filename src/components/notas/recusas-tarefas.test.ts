import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: any[]) => invoke(...a) } } }));

import { iniciarConserto, iniciarDevolucao, type DadosConsertar, type DadosDevolver } from "./recusas-tarefas";
import { _zerar, type Tarefa } from "@/lib/segundo-plano";

beforeEach(() => invoke.mockReset());
afterEach(() => _zerar());

describe("recusas em segundo plano", () => {
  it("devolver soma as levas e para quando não falta nada", async () => {
    invoke
      .mockResolvedValueOnce({ data: { devolvidas: 50, faltam: 10, detalhe: { devolvidas: [{ id_cobranca: "pay_1" }, { id_cobranca: "pay_2" }] } }, error: null })
      .mockResolvedValueOnce({ data: { devolvidas: 10, faltam: 0, detalhe: { devolvidas: [{ id_cobranca: "pay_2" }] } }, error: null });
    const t = await new Promise<Tarefa>((ok) => { iniciarDevolucao(45, ok); });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(t.estado).toBe("ok");
    expect(t.dados as DadosDevolver).toEqual({ devolvidas: 60, cobrancas: 2, faltam: 0 });
  });

  it("devolver para se o servidor deixa de avançar, em vez de rodar em círculo", async () => {
    invoke.mockResolvedValue({ data: { devolvidas: 0, faltam: 7 }, error: null });
    const t = await new Promise<Tarefa>((ok) => { iniciarDevolucao(45, ok); });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(t.estado).toBe("atencao");
  });

  it("consertar para na fila vazia e manda para gente o que a máquina não resolveu", async () => {
    invoke
      .mockResolvedValueOnce({ data: { alvos: 15, corrigidos: 12, precisam_de_gente: 3 }, error: null })
      .mockResolvedValueOnce({ data: { alvos: 0, corrigidos: 0, precisam_de_gente: 0 }, error: null });
    const t = await new Promise<Tarefa>((ok) => { iniciarConserto(ok); });
    expect(t.dados as DadosConsertar).toEqual({ corrigidos: 12, alvos: 15, precisam: 3 });
    expect(t.estado).toBe("atencao");
    expect(t.resumo).toMatch(/não emite nota/);
  });

  it("rodada pulada pelo servidor vira falha com o motivo, não silêncio", async () => {
    invoke.mockResolvedValue({ data: { pulada: "cadastro_auto desligado" }, error: null });
    const t = await new Promise<Tarefa>((ok) => { iniciarConserto(ok); });
    expect(t.estado).toBe("falhou");
    expect(t.resumo).toBe("cadastro_auto desligado");
  });
});
