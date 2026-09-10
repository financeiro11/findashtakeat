import { describe, it, expect } from "vitest";
import {
  CAPACIDADES, CAPACIDADES_ORDEM, PERFIS, PERFIS_ESCOLHIVEIS, PERFIS_REMUNERACAO,
  acessoDe, perfilDe, podeVerRota, capacidadeDaRota, matrizDeLinhas,
  type Capacidade, type PerfilId,
} from "./modules";
import { GRUPOS_FINANCEIRO, GRUPO_FACILITIES, GRUPO_BUSCA_EXTRA, itensDe, telasDaCapacidade } from "./navegacao";
import { abasVisiveis, primeiraAbaDe } from "@/components/mobile/MobileBottomNav";

const de = (perfil: PerfilId) => acessoDe({ perfil });

describe("perfilDe — o padrão é o mínimo", () => {
  /* O bug de 10/09/2026: cargo que o código não reconhecia ganhava o Hub inteiro.
     Sete contas estavam assim, incluindo três de fora da empresa. */
  it("cargo desconhecido não vira acesso", () => {
    expect(perfilDe({ cargo: "Head de Produto", perfil: null })).toBe("restrito");
    expect(perfilDe({ cargo: "", perfil: null })).toBe("restrito");
    expect(perfilDe({ cargo: null, perfil: null })).toBe("restrito");
  });

  it("perfil inventado não passa", () => {
    expect(perfilDe({ perfil: "superadmin" })).toBe("restrito");
    expect(perfilDe({ perfil: "ADMIN" })).toBe("restrito"); // a lista é exata
  });

  it("sem profile nenhum, restrito", () => {
    expect(perfilDe(null)).toBe("restrito");
    expect(perfilDe(undefined)).toBe("restrito");
  });

  /* `perfil === undefined` é a COLUNA ausente — front no ar antes da migration.
     Só aí o cargo antigo vale, e mesmo assim sem reabrir o padrão velho. */
  it("banco sem a coluna cai no de-para por cargo", () => {
    expect(perfilDe({ cargo: "CEO" })).toBe("admin");
    expect(perfilDe({ cargo: "Financeiro" })).toBe("admin");
    expect(perfilDe({ cargo: "diretoria" })).toBe("diretoria");
    expect(perfilDe({ cargo: "facilities" })).toBe("facilities");
    expect(perfilDe({ cargo: "Parcerias" })).toBe("parcerias");
    expect(perfilDe({ cargo: "Head de RH" })).toBe("restrito");
  });
});

describe("restrito não abre nada", () => {
  const acesso = de("restrito");

  it("nem as rotas livres", () => {
    for (const rota of ["/", "/briefing/novidades", "/design-system", "/assistente/memoria"]) {
      expect(podeVerRota(acesso, rota)).toBe(false);
    }
    expect(acesso.semAcesso).toBe(true);
  });
});

describe("a home de cada perfil é alcançável", () => {
  /* Se a home de um perfil for uma rota que ele não vê, o AppLayout redireciona
     para ela, o portão barra de novo, e o navegador entra em laço. */
  it.each(PERFIS_ESCOLHIVEIS.map((p) => p.id))("%s", (id) => {
    const acesso = de(id);
    expect(podeVerRota(acesso, acesso.home)).toBe(true);
  });
});

describe("a matriz, perfil a perfil", () => {
  it("admin vê tudo", () => {
    const acesso = de("admin");
    for (const item of itensDe([...GRUPOS_FINANCEIRO, GRUPO_FACILITIES, GRUPO_BUSCA_EXTRA])) {
      expect(podeVerRota(acesso, item.url), item.url).toBe(true);
    }
  });

  it("diretoria vê o número e o societário, não a conciliação nem a administração", () => {
    const acesso = de("diretoria");
    expect(podeVerRota(acesso, "/demonstracoes/dre")).toBe(true);
    expect(podeVerRota(acesso, "/captable")).toBe(true);
    expect(podeVerRota(acesso, "/apresentacoes/reportes")).toBe(true);
    expect(podeVerRota(acesso, "/operacional/remuneracao")).toBe(true);
    expect(podeVerRota(acesso, "/governanca/auditoria")).toBe(false);
    expect(podeVerRota(acesso, "/usuarios")).toBe(false);
    expect(podeVerRota(acesso, "/facilities")).toBe(false);
  });

  /* Decisão do Miguel em 10/09/2026: liderança PODE ver a DRE inteira e o BP. */
  it("liderança vê resultado e plano, não vê folha nem societário", () => {
    const acesso = de("lideranca");
    expect(podeVerRota(acesso, "/demonstracoes/dre")).toBe(true);
    expect(podeVerRota(acesso, "/bp/2026")).toBe(true);
    expect(podeVerRota(acesso, "/assinaturas")).toBe(true);
    expect(podeVerRota(acesso, "/governanca/cac")).toBe(true);
    expect(podeVerRota(acesso, "/operacional/remuneracao")).toBe(false);
    expect(podeVerRota(acesso, "/captable")).toBe(false);
    expect(podeVerRota(acesso, "/caixa")).toBe(false);
    expect(podeVerRota(acesso, "/governanca/auditoria")).toBe(false);
  });

  it("RH vê pessoas, não vê os números do negócio", () => {
    const acesso = de("rh");
    expect(podeVerRota(acesso, "/operacional/remuneracao")).toBe(true);
    expect(podeVerRota(acesso, "/operacional/colaboradores")).toBe(true);
    expect(podeVerRota(acesso, "/governanca/rescisoes")).toBe(true);
    expect(podeVerRota(acesso, "/time/visao")).toBe(true);
    expect(podeVerRota(acesso, "/demonstracoes/dre")).toBe(false);
    expect(podeVerRota(acesso, "/captable")).toBe(false);
    expect(podeVerRota(acesso, "/caixa")).toBe(false);
  });

  /* A consultoria estratégica (VPX): demonstrações e plano, nada mais. */
  it("externo vê demonstrações e plano, e mais nada", () => {
    const acesso = de("externo");
    expect(podeVerRota(acesso, "/demonstracoes/dre")).toBe(true);
    expect(podeVerRota(acesso, "/demonstracoes/balanco")).toBe(true);
    expect(podeVerRota(acesso, "/bp/2026")).toBe(true);
    expect(podeVerRota(acesso, "/analise/cenarios")).toBe(true);

    expect(podeVerRota(acesso, "/captable")).toBe(false);
    expect(podeVerRota(acesso, "/investimentos/flip")).toBe(false);
    expect(podeVerRota(acesso, "/apresentacoes/reportes")).toBe(false);
    expect(podeVerRota(acesso, "/operacional/remuneracao")).toBe(false);
    expect(podeVerRota(acesso, "/caixa")).toBe(false);
    expect(podeVerRota(acesso, "/governanca/auditoria")).toBe(false);
    expect(podeVerRota(acesso, "/usuarios")).toBe(false);
    expect(podeVerRota(acesso, "/orcamento")).toBe(false);
  });

  it("automação vê o maquinário, não vê os números", () => {
    const acesso = de("automacao");
    expect(podeVerRota(acesso, "/monitoramento")).toBe(true);
    expect(podeVerRota(acesso, "/recargas/celulares")).toBe(true);
    expect(podeVerRota(acesso, "/tarefas")).toBe(true);
    expect(podeVerRota(acesso, "/demonstracoes/dre")).toBe(false);
    expect(podeVerRota(acesso, "/caixa")).toBe(false);
    expect(podeVerRota(acesso, "/operacional/remuneracao")).toBe(false);
  });

  it("facilities e parcerias continuam travados no que já era deles", () => {
    const fac = de("facilities");
    expect(podeVerRota(fac, "/facilities/cotacoes")).toBe(true);
    expect(podeVerRota(fac, "/")).toBe(false);
    expect(podeVerRota(fac, "/demonstracoes/dre")).toBe(false);

    const par = de("parcerias");
    expect(podeVerRota(par, "/operacional/parceiros")).toBe(true);
    expect(podeVerRota(par, "/")).toBe(false);
    expect(podeVerRota(par, "/facilities")).toBe(false);
  });
});

describe("a tela de Usuários é só do admin", () => {
  it.each(PERFIS_ESCOLHIVEIS.filter((p) => p.id !== "admin").map((p) => p.id))(
    "%s não abre /usuarios",
    (id) => { expect(podeVerRota(de(id), "/usuarios")).toBe(false); },
  );
});

describe("o portão", () => {
  /* A ordem importa: `/briefing/novidades` tem de escapar de `/briefing`. */
  it("o mais específico ganha do prefixo", () => {
    expect(capacidadeDaRota("/briefing")).toBe("tesouraria");
    expect(capacidadeDaRota("/briefing/novidades")).toBe(null);
  });

  it("cobre as subrotas, não só o caminho exato", () => {
    expect(capacidadeDaRota("/caixa/conta-corrente/sicoob")).toBe("tesouraria");
    expect(capacidadeDaRota("/editais/projetos-aprovados/prestacao")).toBe("editais");
    expect(capacidadeDaRota("/bp/2027")).toBe("planejamento");
    expect(capacidadeDaRota("/notas/abc-123")).toBe("time");
  });

  it("não confunde prefixo de palavra com prefixo de caminho", () => {
    // "/caixa" não pode capturar uma futura "/caixanova".
    expect(capacidadeDaRota("/caixanova")).toBe(null);
  });

  /* Toda tela do menu tem de ter dono. Uma tela nova que caia em `null` sem
     querer fica visível para os oito perfis — e ninguém percebe. */
  it("nenhuma tela do menu ficou sem capacidade", () => {
    const orfas = itensDe([...GRUPOS_FINANCEIRO, GRUPO_FACILITIES, GRUPO_BUSCA_EXTRA])
      .filter((i) => capacidadeDaRota(i.url) === null)
      .map((i) => i.url)
      .sort();
    /* As exceções CONSCIENTES: o changelog do próprio Hub e as duas telas de
       diagnóstico de interface, que não mostram dado nenhum do negócio.
       Qualquer outra que apareça aqui está visível para os oito perfis. */
    expect(orfas).toEqual(["/assistente/teste-voz", "/briefing/novidades", "/design-system"]);
  });
});

describe("a matriz vinda do banco", () => {
  it("substitui o padrão do código", () => {
    const acesso = acessoDe({ perfil: "lideranca" }, { lideranca: ["metricas"] });
    expect(podeVerRota(acesso, "/assinaturas")).toBe(true);
    expect(podeVerRota(acesso, "/demonstracoes/dre")).toBe(false); // o padrão dava
  });

  it("perfil ausente na matriz mantém o padrão", () => {
    const acesso = acessoDe({ perfil: "rh" }, { lideranca: ["metricas"] });
    expect(podeVerRota(acesso, "/operacional/remuneracao")).toBe(true);
  });

  /* Falha de leitura (rede, RLS) chega aqui como null. Cair no padrão do código
     é o único fallback auditável: vazio trancaria todo mundo, e "tudo" abriria. */
  it("matriz nula usa o padrão do código", () => {
    expect(podeVerRota(acessoDe({ perfil: "rh" }, null), "/operacional/remuneracao")).toBe(true);
    expect(podeVerRota(acessoDe({ perfil: "externo" }, null), "/captable")).toBe(false);
  });

  /* Se desse para tirar "Administração" do admin, a própria tela que conserta
     isso ficaria inalcançável. O trigger no Postgres garante o mesmo. */
  it("o admin ignora a matriz e continua com tudo", () => {
    const acesso = acessoDe({ perfil: "admin" }, { admin: [] });
    expect(acesso.semAcesso).toBe(false);
    expect(podeVerRota(acesso, "/usuarios")).toBe(true);
    expect(podeVerRota(acesso, "/captable")).toBe(true);
  });

  it("matriz que zera um perfil deixa a conta sem acesso", () => {
    const acesso = acessoDe({ perfil: "externo" }, { externo: [] });
    expect(acesso.semAcesso).toBe(true);
    expect(podeVerRota(acesso, "/demonstracoes/dre")).toBe(false);
  });

  /* Fechar a capacidade da home deixaria o AppLayout redirecionando para uma
     rota vedada — e o navegador em laço. */
  it("a home acompanha quando a matriz fecha a tela padrão do perfil", () => {
    const acesso = acessoDe({ perfil: "rh" }, { rh: ["biblioteca"] });
    expect(acesso.home).not.toBe("/operacional/remuneracao");
    expect(podeVerRota(acesso, acesso.home)).toBe(true);
  });

  it("descarta perfil e capacidade que não reconhece", () => {
    const m = matrizDeLinhas([
      { perfil: "rh", capacidades: ["remuneracao", "voar"] },
      { perfil: "presidente", capacidades: ["metricas"] },
      { perfil: "restrito", capacidades: ["metricas"] },
    ]);
    expect(m.rh).toEqual(["remuneracao"]);
    expect(m).not.toHaveProperty("presidente");
    expect(m).not.toHaveProperty("restrito");
  });
});

describe("o Assistente é capacidade, não exceção", () => {
  it("externo não fala com a IA; os de dentro falam", () => {
    expect(acessoDe({ perfil: "externo" }).assistente).toBe(false);
    for (const id of ["admin", "diretoria", "lideranca", "rh", "automacao"] as PerfilId[]) {
      expect(acessoDe({ perfil: id }).assistente, id).toBe(true);
    }
  });

  it("sai da matriz como qualquer outra", () => {
    expect(acessoDe({ perfil: "lideranca" }, { lideranca: ["metricas"] }).assistente).toBe(false);
    expect(acessoDe({ perfil: "externo" }, { externo: ["assistente"] }).assistente).toBe(true);
  });

  /* Ter só o Assistente não faz de ninguém usuário do Hub Financeiro — senão a
     pessoa entraria num módulo sem nenhuma tela. */
  it("não conta como módulo", () => {
    expect(acessoDe({ perfil: "facilities" }, { facilities: ["facilities", "assistente"] }).modules)
      .toEqual(["facilities"]);
  });
});

describe("as duas listas da folha andam juntas", () => {
  /* A metade que esconde está aqui; a que protege é `pode_ver_remuneracao()` no
     Postgres. Se divergirem, a tela vem vazia para quem deveria ver — ou cheia
     para quem não deveria. */
  it("PERFIS_REMUNERACAO é exatamente o que a policy lista", () => {
    expect([...PERFIS_REMUNERACAO].sort()).toEqual(["admin", "diretoria", "rh"]);
  });

  it("o atalho `remuneracao` do acesso concorda com a capacidade", () => {
    for (const p of PERFIS_ESCOLHIVEIS) {
      expect(de(p.id).remuneracao).toBe(PERFIS_REMUNERACAO.includes(p.id));
    }
  });
});

describe("módulos", () => {
  it("só o admin alterna entre Hub Financeiro e Facilities", () => {
    expect(de("admin").canSwitch).toBe(true);
    expect(de("admin").modules).toEqual(["financeiro", "facilities"]);
    expect(de("facilities").modules).toEqual(["facilities"]);
    expect(de("diretoria").modules).toEqual(["financeiro"]);
    expect(de("restrito").modules).toEqual([]);
  });

  it("isAdmin — quem aprova compra no Facilities — é só o perfil admin", () => {
    for (const p of PERFIS_ESCOLHIVEIS) {
      expect(de(p.id).isAdmin).toBe(p.id === "admin");
    }
  });
});

describe("as abas do celular seguem o mesmo portão", () => {
  it("admin vê as seis; RH não vê Extratos nem Tarefas", () => {
    expect(abasVisiveis(de("admin")).map((a) => a.url)).toHaveLength(6);
    const rh = abasVisiveis(de("rh")).map((a) => a.url);
    expect(rh).not.toContain("/extratos");
    expect(rh).not.toContain("/tarefas");
    expect(rh).toContain("/perfil");
  });

  /* Chat e Perfil não têm entrada no portão de propósito: sem elas a barra
     ficaria vazia para quem só tem uma capacidade, e o app pareceria quebrado. */
  it("todo perfil pousa em alguma aba", () => {
    for (const p of PERFIS_ESCOLHIVEIS) {
      const primeira = primeiraAbaDe(de(p.id));
      expect(podeVerRota(de(p.id), primeira), p.id).toBe(true);
    }
  });
});

describe("a tela de Perfis de acesso tem o que mostrar", () => {
  it("toda capacidade aparece na ordem da tela, uma vez só", () => {
    const doTipo = Object.keys(CAPACIDADES) as Capacidade[];
    expect([...CAPACIDADES_ORDEM].sort()).toEqual([...doTipo].sort());
    expect(CAPACIDADES_ORDEM).toHaveLength(new Set(CAPACIDADES_ORDEM).size);
  });

  it("toda capacidade tem rótulo e explicação", () => {
    for (const c of CAPACIDADES_ORDEM) {
      expect(CAPACIDADES[c].label.trim(), c).not.toBe("");
      expect(CAPACIDADES[c].descricao.trim(), c).not.toBe("");
    }
  });

  /* A linha da tela lista as telas que a capacidade abre. Uma capacidade sem
     tela nenhuma seria um checkbox que não explica o que faz — só `assistente`
     pode estar nessa situação, porque ela não é tela, é conversa. */
  it("só o Assistente não lista telas", () => {
    const vazias = CAPACIDADES_ORDEM.filter((c) => telasDaCapacidade(c).length === 0);
    expect(vazias).toEqual(["assistente"]);
  });
});

describe("catálogo de perfis", () => {
  it("restrito não é escolhível na tela de Usuários", () => {
    expect(PERFIS_ESCOLHIVEIS.map((p) => p.id)).not.toContain("restrito");
    expect(PERFIS_ESCOLHIVEIS).toHaveLength(8);
  });

  it("todo perfil tem rótulo, resumo e home", () => {
    for (const p of Object.values(PERFIS)) {
      expect(p.label.trim()).not.toBe("");
      expect(p.resumo.trim()).not.toBe("");
      expect(p.home.startsWith("/")).toBe(true);
    }
  });
});
