import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), functions: { invoke: (...a: any[]) => invoke(...a) } } }));

import { iniciarEmissaoEmMassa, type DadosMassa } from "./massa-tarefa";
import { _zerar, type Tarefa } from "@/lib/segundo-plano";

const fila = (n: number) => ({ data: Array.from({ length: n }, (_, i) => ({ id_asaas: `pay_${i}` })), error: null });
const despachou = (n: number) => ({
  data: { resultados: Array.from({ length: n }, (_, i) => ({ id_asaas: `pay_${i}`, ok: true, em_processamento: true })) },
  error: null,
});
const rodar = (total: number) => new Promise<Tarefa>((ok) => { iniciarEmissaoEmMassa(total, ok); });

beforeEach(() => { vi.useFakeTimers(); rpc.mockReset(); invoke.mockReset(); });
afterEach(() => { vi.useRealTimers(); _zerar(); });

describe("emissão em massa em segundo plano", () => {
  it("relê a fila a cada leva e termina quando ela esvazia", async () => {
    rpc.mockResolvedValueOnce(fila(20)).mockResolvedValueOnce(fila(5)).mockResolvedValueOnce(fila(0));
    invoke.mockResolvedValueOnce(despachou(20)).mockResolvedValueOnce(despachou(5));
    const p = rodar(25);
    await vi.runAllTimersAsync();
    const t = await p;
    expect(t.estado).toBe("ok");
    expect((t.dados as DadosMassa).progresso.despachadas).toBe(25);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("lote em voo não é falha: espera e repete a MESMA leva", async () => {
    rpc.mockResolvedValueOnce(fila(3)).mockResolvedValueOnce(fila(0));
    invoke
      .mockResolvedValueOnce({ data: { pulada: "o lote 123 ainda está em processamento no Omie" }, error: null })
      .mockResolvedValueOnce(despachou(3));
    const p = rodar(3);
    await vi.runAllTimersAsync();
    const t = await p;
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][1].body.ids).toEqual(invoke.mock.calls[1][1].body.ids);
    expect((t.dados as DadosMassa).progresso.despachadas).toBe(3);
  });

  it("teto do dia para a rodada e sobe como atenção, não como erro", async () => {
    rpc.mockResolvedValue(fila(20));
    invoke.mockResolvedValue({ data: { pulada: "teto do dia atingido (200 notas)" }, error: null });
    const p = rodar(60);
    await vi.runAllTimersAsync();
    const t = await p;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(t.estado).toBe("atencao");
    expect(t.avisos.join(" ")).toMatch(/teto do dia/);
  });
});
