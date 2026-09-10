import { describe, it, expect } from "vitest";
import {
  COLUNAS, alternar, clonar, mesmasCapacidades, paraGravar, paraLinhas,
  perfisAlterados, restaurarPadrao,
} from "./matriz";
import { PERFIS, type Capacidade } from "@/lib/modules";

const base = () => paraLinhas({});

describe("paraLinhas", () => {
  it("parte do padrão do código para quem não está na matriz do banco", () => {
    const l = base();
    expect([...l.rh].sort()).toEqual([...PERFIS.rh.capacidades].sort());
    expect([...l.externo].sort()).toEqual([...PERFIS.externo.capacidades].sort());
  });

  it("a matriz do banco vence o padrão", () => {
    const l = paraLinhas({ rh: ["metricas"] });
    expect([...l.rh]).toEqual(["metricas"]);
    expect([...l.lideranca].sort()).toEqual([...PERFIS.lideranca.capacidades].sort()); // intocado
  });

  it("tem uma coluna por perfil escolhível", () => {
    expect(Object.keys(base())).toHaveLength(COLUNAS.length);
    expect(Object.keys(base())).not.toContain("restrito");
  });
});

describe("clonar", () => {
  /* O bug que isto previne: com os mesmos `Set` nos dois lados, marcar um
     checkbox mudaria o "salvo" junto — e a tela nunca acharia diferença
     nenhuma, então o botão Salvar jamais apareceria. */
  it("os conjuntos são novos, não os mesmos", () => {
    const a = base();
    const b = clonar(a);
    b.rh.add("metricas");
    expect(a.rh.has("metricas")).toBe(false);
  });
});

describe("perfisAlterados", () => {
  it("vazio quando nada mudou", () => {
    const a = base();
    expect(perfisAlterados(a, clonar(a))).toEqual([]);
  });

  it("acha quem mudou, e só quem mudou", () => {
    const salvo = base();
    const rascunho = alternar(clonar(salvo), "lideranca", "societario");
    expect(perfisAlterados(salvo, rascunho)).toEqual(["lideranca"]);
  });

  it("pega remoção tanto quanto adição", () => {
    const salvo = base();
    const rascunho = alternar(clonar(salvo), "rh", "remuneracao"); // tinha, tira
    expect(rascunho.rh.has("remuneracao")).toBe(false);
    expect(perfisAlterados(salvo, rascunho)).toEqual(["rh"]);
  });

  /* O admin nunca entra: a coluna dele vem desabilitada e o trigger no Postgres
     reescreve a linha cheia. Se entrasse, a tela diria "salvo" sobre algo que o
     banco desfez. */
  it("ignora o admin mesmo se o estado divergir", () => {
    const salvo = base();
    const rascunho = clonar(salvo);
    rascunho.admin = new Set<Capacidade>([]);
    expect(perfisAlterados(salvo, rascunho)).toEqual([]);
  });

  it("alternar não mexe no admin", () => {
    const l = base();
    expect(alternar(l, "admin", "usuarios")).toBe(l);
  });
});

describe("restaurarPadrao", () => {
  it("devolve a coluna ao que está escrito no código", () => {
    const mexido = alternar(alternar(base(), "externo", "societario"), "externo", "demonstracoes");
    const voltou = restaurarPadrao(mexido, "externo");
    expect(mesmasCapacidades(voltou.externo, new Set(PERFIS.externo.capacidades))).toBe(true);
  });
});

describe("paraGravar", () => {
  it("gera uma linha por perfil alterado, com quem mexeu", () => {
    const rascunho = alternar(base(), "lideranca", "societario");
    const linhas = paraGravar(rascunho, ["lideranca"], "u-123");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].perfil).toBe("lideranca");
    expect(linhas[0].capacidades).toContain("societario");
    expect(linhas[0].atualizado_por).toBe("u-123");
    expect(Date.parse(linhas[0].atualizado_em)).not.toBeNaN();
  });

  it("um perfil zerado grava lista vazia, não vira omissão", () => {
    const rascunho = clonar(base());
    rascunho.externo = new Set();
    const linhas = paraGravar(rascunho, ["externo"], null);
    expect(linhas[0].capacidades).toEqual([]);
  });
});
