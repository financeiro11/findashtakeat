// O guia do Hub não pode envelhecer em silêncio.
//
// `supabase/functions/_shared/assistente/guia.ts` é a única coisa que o Assistente sabe
// sobre as telas — e ele é um arquivo escrito à mão, em Deno, longe do catálogo de
// navegação. Sem este teste, a próxima tela criada nasceria invisível para o Assistente
// (que responderia "essa tela não existe" sobre uma tela que existe) e uma capacidade
// trocada no PORTÃO deixaria o guia contando a tela errada para a pessoa errada.
//
// Três invariantes, e nenhuma delas é de estilo:
//   1. Toda tela do menu tem verbete. Se não tem, o Assistente não sabe que ela existe.
//   2. A capacidade declarada no verbete é a MESMA que o PORTÃO exige da rota. O guia é
//      recortado por ela antes de ir ao modelo; divergir aqui é contar a quem não pode.
//   3. A busca acha o que precisa achar — inclusive a pergunta que originou tudo isto.

import { describe, expect, it } from "vitest";
import {
  GUIA, buscarNoGuia, mapaDoHub, verbeteVisivel,
} from "../../supabase/functions/_shared/assistente/guia.ts";
import { comoFazer } from "../../supabase/functions/_shared/assistente/consultas-guia.ts";
import {
  GRUPOS_FINANCEIRO, GRUPO_FACILITIES, GRUPO_BUSCA_EXTRA, itensDe,
} from "./navegacao";
import { capacidadesDaRota } from "./modules";

const TODOS = itensDe([...GRUPOS_FINANCEIRO, GRUPO_FACILITIES, GRUPO_BUSCA_EXTRA]);

/** O verbete que cobre esta rota — por prefixo, como o PORTÃO. `/bp` cobre `/bp/2026`. */
const verbeteDaRota = (url: string) =>
  GUIA.filter((v) => v.rota && (url === v.rota || url.startsWith(v.rota + "/")))
    // O mais específico ganha: `/editais/projetos-aprovados` antes de `/editais`.
    .sort((a, b) => (b.rota?.length ?? 0) - (a.rota?.length ?? 0))[0];

const tudoLiberado = () => true;

describe("guia do Hub × catálogo de navegação", () => {
  it("toda tela do menu tem verbete", () => {
    const orfas = TODOS.filter((i) => !verbeteDaRota(i.url)).map((i) => `${i.title} (${i.url})`);
    expect(
      orfas,
      "Tela no menu sem verbete no guia: o Assistente não sabe que ela existe e vai " +
      "responder que não conhece. Acrescente a entrada em " +
      "supabase/functions/_shared/assistente/guia.ts.",
    ).toEqual([]);
  });

  it("a capacidade do verbete é a mesma que o PORTÃO exige da rota", () => {
    const divergentes: string[] = [];
    for (const v of GUIA) {
      if (!v.rota) continue;
      const portao = capacidadesDaRota(v.rota);
      const noGuia = v.capacidades === null ? null : [...v.capacidades].sort().join(",");
      const naRota = portao === null ? null : [...portao].sort().join(",");
      if (noGuia !== naRota) {
        divergentes.push(`${v.rota}: guia=${noGuia ?? "livre"} portão=${naRota ?? "livre"}`);
      }
    }
    expect(
      divergentes,
      "O guia é filtrado pelas capacidades antes de ir ao modelo. Divergir do PORTÃO " +
      "significa explicar uma tela a quem não pode abri-la — ou esconder de quem pode.",
    ).toEqual([]);
  });

  it("nenhum verbete de tela fica sem grupo, sem o que é e sem quem usa", () => {
    const incompletos = GUIA
      .filter((v) => !v.oQueE.trim() || !v.quemUsa.trim() || (v.rota && !v.grupo.trim()))
      .map((v) => v.titulo);
    expect(incompletos).toEqual([]);
  });

  it("não há duas entradas para a mesma rota", () => {
    const rotas = GUIA.map((v) => v.rota).filter(Boolean) as string[];
    expect(new Set(rotas).size).toBe(rotas.length);
  });
});

describe("busca no guia", () => {
  const acha = (pergunta: string, rotaAtual: string | null = null) =>
    buscarNoGuia(pergunta, { rotaAtual, pode: tudoLiberado }).map((a) => a.verbete.titulo);

  it("acha a nota de comissão — a pergunta que o assistente errava", () => {
    // 12/09/2026: o assistente respondeu "emita manualmente no Omie". O Hub tem a
    // liberação na própria linha da cobrança, e é isso que o verbete precisa entregar.
    expect(acha("como eu emito a nota de comissão? Ela é uma exceção")).toContain("Notas Fiscais");
  });

  it("leva quem quer comprar alguma coisa para as Solicitações", () => {
    expect(acha("preciso comprar cadeiras novas, como faço?")).toContain("Solicitações");
    expect(acha("onde peço um notebook")).toContain("Solicitações");
  });

  it("responde a quem esbarrou numa tela fechada", () => {
    expect(acha("não consigo abrir a tela de remuneração")).toContain(
      "Acesso: por que não consigo abrir uma tela",
    );
  });

  it("aceita o verbo como a pessoa escreve", () => {
    // "emitir", "emito", "emissão" são a mesma pergunta.
    for (const forma of ["como emitir nota fiscal", "quero emitir uma nota", "emissão de nota"]) {
      expect(acha(forma), forma).toContain("Notas Fiscais");
    }
  });

  it("a tela aberta entra na disputa mesmo sem casar palavra", () => {
    expect(acha("como eu faço isso aqui", "/facilities/solicitacoes")).toContain("Solicitações");
  });

  it("não inventa resposta para pergunta de fora do Hub", () => {
    // A busca é sobreposição de termos, então ela responde ao VOCABULÁRIO e não ao assunto:
    // "qual a capital da França" casaria com Caixa pelo "capital de giro". Quem barra a
    // pergunta fora do Hub é o planejador, que nem chama esta consulta. Aqui o que se
    // garante é o que dá para garantir neste nível: sem palavra em comum, sem verbete.
    expect(acha("me conta uma piada sobre girafas")).toEqual([]);
  });
});

describe("recorte por capacidade", () => {
  const soFacilities = (c: string) => c === "facilities";

  it("quem só tem Facilities não recebe a tela de folha", () => {
    const achados = buscarNoGuia("quanto fulano ganha de salário", {
      pode: soFacilities,
      rotaAtual: null,
    });
    expect(achados.map((a) => a.verbete.titulo)).not.toContain("Remuneração");
  });

  it("o mapa entregue ao modelo só lista o que a pessoa abre", () => {
    const mapa = mapaDoHub(soFacilities);
    expect(mapa).toContain("/facilities/solicitacoes");
    expect(mapa).not.toContain("/operacional/remuneracao");
    expect(mapa).not.toContain("/captable");
  });

  it("tela livre aparece para todo mundo", () => {
    const novidades = GUIA.find((v) => v.rota === "/briefing/novidades")!;
    expect(verbeteVisivel(novidades, () => false)).toBe(true);
  });
});

describe("consulta como_fazer", () => {
  it("responde com o verbete e marca o nível como guia", () => {
    const r = comoFazer("como peço uma compra?", { pode: tudoLiberado });
    expect(r.ok).toBe(true);
    expect(r.nivel).toBe("guia");
    expect(r.numeros).toEqual([]);
    expect(r.paraModelo).toContain("/facilities/solicitacoes");
  });

  it("sem verbete, manda o modelo NÃO descrever procedimento", () => {
    const r = comoFazer("como faço para trocar o pneu do carro", { pode: tudoLiberado });
    expect(r.ok).toBe(true);
    expect(r.paraModelo).toContain("Não descreva nenhum procedimento");
    // O mapa continua indo: "não sei o passo a passo" só é útil com "isso fica em tal tela".
    expect(r.paraModelo).toContain("Telas que esta pessoa pode abrir");
  });

  it("avisa quando o verbete existe mas o passo a passo ainda não foi escrito", () => {
    const semPassos = GUIA.find((v) => v.rota && !v.passos?.length)!;
    const r = comoFazer(semPassos.titulo, { pode: tudoLiberado });
    expect(r.paraModelo).toContain("PASSO A PASSO: não está escrito no guia");
    expect(r.avisos.join(" ")).toContain("ainda não tem o passo a passo");
  });
});
