import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

import { _zerar, desfechoPadrao, iniciarTarefa, parar, rodando, type Tarefa } from "./segundo-plano";

const passos = [{ id: "a", titulo: "A" }, { id: "b", titulo: "B" }];
const terminar = (id: string) =>
  new Promise<Tarefa>((ok) => {
    const t0 = Date.now();
    const olhar = () => {
      const t = (globalThis as any).__ultimo as Tarefa | undefined;
      if (t && t.id === id) return ok(t);
      if (Date.now() - t0 > 2000) throw new Error("não terminou");
      setTimeout(olhar, 5);
    };
    olhar();
  });
const guardar = (t: Tarefa) => { (globalThis as any).__ultimo = t; };

afterEach(() => { _zerar(); (globalThis as any).__ultimo = undefined; });

describe("segundo plano", () => {
  it("a mesma chave rodando devolve a MESMA tarefa — dois cliques não emitem duas vezes", async () => {
    let soltar!: () => void;
    const trabalho = vi.fn(() => new Promise<void>((r) => { soltar = r; }));
    const um = iniciarTarefa({ chave: "emitir:pay_1", titulo: "x", passos }, trabalho, { aoTerminar: guardar });
    const dois = iniciarTarefa({ chave: "emitir:pay_1", titulo: "x", passos }, trabalho);
    expect(dois).toBe(um);
    expect(trabalho).toHaveBeenCalledTimes(1);
    soltar();
    await terminar(um);
    // Terminada, a chave volta a poder rodar.
    const tres = iniciarTarefa({ chave: "emitir:pay_1", titulo: "x", passos }, async () => {});
    expect(tres).not.toBe(um);
  });

  it("parar só para entre degraus e termina como 'parada'", async () => {
    let passou = false;
    const id = iniciarTarefa({ titulo: "x", passos }, async (ctx) => {
      ctx.passo("a", "correndo");
      await new Promise((r) => setTimeout(r, 20));
      if (!ctx.segue()) return;
      passou = true;
    }, { aoTerminar: guardar });
    parar(id);
    const t = await terminar(id);
    expect(passou).toBe(false);
    expect(t.estado).toBe("parada");
    // O degrau que corria não fica girando para sempre.
    expect(t.passos.find((p) => p.id === "a")?.estado).toBe("espera");
  });

  it("exceção vira 'falhou' com a mensagem no degrau em curso — nunca some calada", async () => {
    const id = iniciarTarefa({ titulo: "x", passos }, async (ctx) => {
      ctx.passo("b", "correndo");
      throw new Error("Omie caiu");
    }, { aoTerminar: guardar });
    const t = await terminar(id);
    expect(t.estado).toBe("falhou");
    expect(t.passos.find((p) => p.id === "b")).toMatchObject({ estado: "falhou", detalhe: "Omie caiu" });
    expect(rodando()).toHaveLength(0);
  });

  it("passo desconhecido é ignorado (o refazer reusa a corrente de emissão sem o 'destravar')", async () => {
    const id = iniciarTarefa({ titulo: "x", passos }, async (ctx) => {
      ctx.passo("destravar", "pulado");
      ctx.passo("a", "ok");
    }, { aoTerminar: guardar });
    const t = await terminar(id);
    expect(t.passos.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("desfecho padrão: falha manda, pendência vira atenção", () => {
    const p = (estado: any) => ({ id: "a", titulo: "A", estado, detalhe: null });
    expect(desfechoPadrao({ passos: [p("ok"), p("falhou")], paraVoce: [] })).toBe("falhou");
    expect(desfechoPadrao({ passos: [p("ok")], paraVoce: [{ id_asaas: null, nome: "", titulo: "", oQueFazer: "", tentado: [] }] })).toBe("atencao");
    expect(desfechoPadrao({ passos: [p("ok"), p("pulado")], paraVoce: [] })).toBe("ok");
  });
});
