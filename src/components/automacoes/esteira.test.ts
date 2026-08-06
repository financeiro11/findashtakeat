import { describe, it, expect } from "vitest";
import { ordenarEsteira, scoreEsteira, itemDe, quadranteDe, resumoEsteira } from "./esteira";
import { type Automacao } from "./arvore-layout";

/* A esteira é a ordem em que o time vai trabalhar de verdade, então o que
   importa cobrir é: a regra ordena como prometido, o pino manual ganha da
   regra, e automação pronta não fica ocupando a fila. */

let seq = 0;
const auto = (p: Partial<Automacao> & { automacao: string }): Automacao => ({
  id: `id-${++seq}`, categoria: "Reportes & DRE", nivel: 3, status: "Ideias",
  horas_mes: null, ferramentas: null, responsavel: null, impacto: "Médio",
  esforco: "Médio", dor: null, solucao: null, observacao: null, ordem: 0, ...p,
});

const nomes = (rows: Automacao[]) => ordenarEsteira(rows).map((i) => i.r.automacao);

/* ------------------------------- score ------------------------------- */
describe("scoreEsteira", () => {
  it("alto impacto com baixo esforço é o topo da escala", () => {
    expect(scoreEsteira(auto({ automacao: "a", impacto: "Alto", esforco: "Baixo" }))).toBe(6);
    expect(scoreEsteira(auto({ automacao: "b", impacto: "Baixo", esforco: "Alto" }))).toBe(2);
  });

  it("impacto e esforço pesam igual — as duas trocas empatam", () => {
    const a = auto({ automacao: "a", impacto: "Alto", esforco: "Médio" });
    const b = auto({ automacao: "b", impacto: "Médio", esforco: "Baixo" });
    expect(scoreEsteira(a)).toBe(scoreEsteira(b));
  });

  it("campo vazio ou fora da escala vale Médio", () => {
    expect(scoreEsteira(auto({ automacao: "a", impacto: null, esforco: null }))).toBe(4);
    // "Média" existe num registro antigo do catálogo
    expect(scoreEsteira(auto({ automacao: "b", impacto: "Média", esforco: undefined }))).toBe(4);
  });
});

/* ------------------------------ ordenação ------------------------------ */
describe("ordenarEsteira", () => {
  it("põe o barato e impactante na frente do caro e impactante", () => {
    expect(nomes([
      auto({ automacao: "cara", impacto: "Alto", esforco: "Alto" }),
      auto({ automacao: "barata", impacto: "Alto", esforco: "Baixo" }),
    ])).toEqual(["barata", "cara"]);
  });

  it("empate no score cai para o nível mais baixo — fundação antes do topo", () => {
    expect(nomes([
      auto({ automacao: "n5", nivel: 5, impacto: "Alto", esforco: "Médio" }),
      auto({ automacao: "n1", nivel: 1, impacto: "Médio", esforco: "Baixo" }),
    ])).toEqual(["n1", "n5"]);
  });

  it("o nível é só desempate — não passa na frente de um score maior", () => {
    expect(nomes([
      auto({ automacao: "n1-cara", nivel: 1, impacto: "Baixo", esforco: "Alto" }),
      auto({ automacao: "n5-barata", nivel: 5, impacto: "Alto", esforco: "Baixo" }),
    ])).toEqual(["n5-barata", "n1-cara"]);
  });

  it("automação sem nível desempata por último, não como se fosse base", () => {
    expect(nomes([
      auto({ automacao: "sem-nivel", nivel: null }),
      auto({ automacao: "n4", nivel: 4 }),
    ])).toEqual(["n4", "sem-nivel"]);
  });

  it("mesmo score e nível: o que já saiu do papel vem antes", () => {
    expect(nomes([
      auto({ automacao: "so-ideia", status: "Ideias" }),
      auto({ automacao: "andando", status: "Em andamento" }),
    ])).toEqual(["andando", "so-ideia"]);
  });

  it("nível que não existe mais não vale como desempate", () => {
    // nivel 9 não está na pirâmide — cai para o fim junto com quem não tem nível
    expect(nomes([
      auto({ automacao: "fantasma", nivel: 9 }),
      auto({ automacao: "real", nivel: 5 }),
    ])).toEqual(["real", "fantasma"]);
  });
});

/* ----------------------------- quem entra ----------------------------- */
describe("quem ocupa a esteira", () => {
  it("automação rodando sai da fila — já está pronta", () => {
    expect(itemDe(auto({ automacao: "pronta", status: "Rodando" }))).toBeNull();
    expect(nomes([
      auto({ automacao: "pronta", status: "Rodando" }),
      auto({ automacao: "pendente" }),
    ])).toEqual(["pendente"]);
  });

  it("rodando volta para a fila quando o upgrade é posto na esteira", () => {
    const r = auto({ automacao: "melhorar", status: "Rodando", upgrade: "dá para continuar", esteira_upgrade: true });
    expect(itemDe(r)?.tipo).toBe("upgrade");
    expect(nomes([r])).toEqual(["melhorar"]);
  });

  it("pôr na esteira sem ter upgrade escrito não cria item vazio", () => {
    expect(itemDe(auto({ automacao: "x", status: "Rodando", esteira_upgrade: true, upgrade: "   " }))).toBeNull();
    expect(itemDe(auto({ automacao: "y", status: "Rodando", esteira_upgrade: true, upgrade: null }))).toBeNull();
  });

  it("upgrade escrito não entra sozinho — é opt-in", () => {
    expect(itemDe(auto({ automacao: "x", status: "Rodando", upgrade: "dá para melhorar" }))).toBeNull();
  });

  it("pendente é sempre item novo, mesmo tendo upgrade escrito", () => {
    expect(itemDe(auto({ automacao: "x", status: "Ideias", upgrade: "algo" }))?.tipo).toBe("novo");
  });
});

/* --------------------------- pino manual --------------------------- */
describe("posição fixada na mão", () => {
  const fila = () => [
    auto({ automacao: "1a", impacto: "Alto", esforco: "Baixo" }),
    auto({ automacao: "2a", impacto: "Alto", esforco: "Médio" }),
    auto({ automacao: "3a", impacto: "Médio", esforco: "Alto" }),
  ];

  it("sem pino, vale a regra", () => {
    expect(nomes(fila())).toEqual(["1a", "2a", "3a"]);
  });

  it("item arrastado para o topo fica no topo", () => {
    const rows = fila();
    rows[2].esteira_ordem = 0;
    expect(nomes(rows)).toEqual(["3a", "1a", "2a"]);
  });

  it("cada fixo cai exatamente no índice escolhido, mesmo com vários", () => {
    const rows = fila();
    rows[0].esteira_ordem = 2; // a melhor da regra, empurrada para o fim
    rows[2].esteira_ordem = 0; // a pior da regra, puxada para o topo
    expect(nomes(rows)).toEqual(["3a", "2a", "1a"]);
  });

  it("pino além do fim da lista encosta no fim, sem buraco", () => {
    const rows = fila();
    rows[0].esteira_ordem = 99;
    expect(nomes(rows)).toEqual(["2a", "3a", "1a"]);
  });

  it("soltar o pino devolve o item para o lugar da regra", () => {
    const rows = fila();
    rows[2].esteira_ordem = 0;
    expect(nomes(rows)).toEqual(["3a", "1a", "2a"]);
    rows[2].esteira_ordem = null;
    expect(nomes(rows)).toEqual(["1a", "2a", "3a"]);
  });

  it("pino em 0 vale como fixo — não confundir com ausência", () => {
    const rows = fila();
    rows[2].esteira_ordem = 0;
    expect(ordenarEsteira(rows)[0].fixo).toBe(true);
  });
});

/* ------------------------------ rótulos ------------------------------ */
describe("quadranteDe e resumo", () => {
  it("nomeia só os dois cantos da matriz", () => {
    expect(quadranteDe(auto({ automacao: "a", impacto: "Alto", esforco: "Baixo" }))?.rotulo).toBe("GANHO RÁPIDO");
    expect(quadranteDe(auto({ automacao: "b", impacto: "Baixo", esforco: "Alto" }))?.rotulo).toBe("VALE A PENA?");
    expect(quadranteDe(auto({ automacao: "c", impacto: "Alto", esforco: "Médio" }))).toBeNull();
    expect(quadranteDe(auto({ automacao: "d", impacto: "Médio", esforco: "Médio" }))).toBeNull();
  });

  it("conta a fila do jeito que o cabeçalho mostra", () => {
    const rows = [
      auto({ automacao: "a", impacto: "Alto", esforco: "Baixo" }),
      auto({ automacao: "b", status: "Rodando", upgrade: "x", esteira_upgrade: true }),
      auto({ automacao: "c", esteira_ordem: 0 }),
      auto({ automacao: "d", status: "Rodando" }),
    ];
    expect(resumoEsteira(ordenarEsteira(rows))).toEqual({ total: 3, upgrades: 1, rapidos: 1, fixos: 1 });
  });
});
