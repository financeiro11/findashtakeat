// A régua do painel de notícias do briefing.
//
// Testa o módulo do servidor direto (`_shared/briefing-noticias.ts`, sem
// imports), como já fazem os testes da vigilância e do radar de preços.
//
// O que está em jogo: esta régua decide o que a pessoa vê às 8 da manhã. Errar
// para o lado de mostrar demais enche o painel de "as 10 melhores IAs de 2026" e
// mata a seção pelo tédio; errar para o lado de mostrar de menos deixa o painel
// vazio, que é indistinguível de "não rodou". Os dois erros são silenciosos, e
// por isso os casos abaixo são todos escritos a partir de manchete real do tipo
// que a busca devolve.

import { describe, expect, it } from "vitest";
import {
  CORTE, chaveDaUrl, chaveDoItem, contemTermo, ehRedirecionador, lerQuando,
  mesmaNoticia, normalizarTexto, pontuar, valeMostrar,
  type Bruto,
} from "../../supabase/functions/_shared/briefing-noticias";

const HOJE = new Date("2026-08-28T11:00:00Z");
const item = (titulo: string, descricao = "", extra: Partial<Bruto> = {}): Bruto => ({
  titulo, descricao, url: "https://exemplo.com/noticia", ...extra,
});

describe("normalizarTexto", () => {
  it("tira acento e pontuação", () => {
    expect(normalizarTexto("Lançamento: Ação & Preço!")).toBe("lancamento acao preco");
  });

  it("PRESERVA dígitos", () => {
    // Guarda contra uma classe de caracteres mal escrita na remoção de acentos:
    // um range trocado apaga os algarismos em silêncio, e "GPT-5" vira "gpt",
    // "R$ 3,60" vira "r". Nada quebra — só se para de reconhecer versão e preço.
    expect(normalizarTexto("GPT-5.2 custa US$ 3,60")).toBe("gpt 5 2 custa us 3 60");
  });
});

describe("contemTermo", () => {
  it("casa palavra inteira", () => {
    expect(contemTermo(normalizarTexto("OpenAI muda a API"), "api")).toBe(true);
    expect(contemTermo(normalizarTexto("GPT-5 chega ao Brasil"), "gpt")).toBe(true);
  });

  it("não casa dentro de outra palavra", () => {
    // Estes três são o motivo de a função existir: com `includes`, matéria de
    // mercado de capitais pontuaria como notícia de API.
    expect(contemTermo(normalizarTexto("mercado de capitais"), "api")).toBe(false);
    expect(contemTermo(normalizarTexto("o discurso do presidente"), "curso")).toBe(false);
    expect(contemTermo(normalizarTexto("percurso da maratona"), "curso")).toBe(false);
  });
});

describe("chaveDaUrl", () => {
  it("colapsa utm, âncora, www e barra final", () => {
    const a = chaveDaUrl("https://www.techcrunch.com/2026/08/28/openai-preco/?utm_source=news#topo");
    const b = chaveDaUrl("http://techcrunch.com/2026/08/28/openai-preco");
    expect(a).toBe(b);
  });

  it("distingue matérias diferentes do mesmo veículo", () => {
    expect(chaveDaUrl("https://x.com/a")).not.toBe(chaveDaUrl("https://x.com/b"));
  });

  it("não explode com endereço torto", () => {
    expect(chaveDaUrl("nao é url")).toBe("naoeurl");
    expect(chaveDaUrl("")).toBe("");
  });
});

describe("chaveDoItem — o link da aba de notícias é um redirecionador", () => {
  // Medido em 28/08/2026: a aba `news` do Firecrawl devolve
  // `https://www.google.com/goto?url=CAESfwHrOzAV…` — caminho IGUAL para todas
  // as matérias e parâmetro opaco. Sem tratamento, a chave de todas seria
  // `google.com/goto`, o índice único aceitaria a primeira notícia da história
  // do painel e recusaria calado todas as seguintes.
  const goto = (t: string) => ({ url: `https://www.google.com/goto?url=CAES${t}`, titulo: t });

  it("reconhece o redirecionador", () => {
    expect(ehRedirecionador("https://www.google.com/goto?url=CAESfw")).toBe(true);
    expect(ehRedirecionador("https://techcrunch.com/2026/08/28/x")).toBe(false);
  });

  it("dá chaves DIFERENTES para notícias diferentes atrás do mesmo redirecionador", () => {
    const a = goto("Anthropic reduz o preço do Claude");
    const b = goto("Salesforce e Anthropic anunciam parceria");
    expect(chaveDoItem(a.url, a.titulo)).not.toBe(chaveDoItem(b.url, b.titulo));
  });

  it("dá a MESMA chave para a mesma matéria com token diferente", () => {
    // O token do redirecionador muda entre buscas; o título, não.
    expect(chaveDoItem("https://www.google.com/goto?url=AAA", "Anthropic reduz o preço"))
      .toBe(chaveDoItem("https://www.google.com/goto?url=BBB", "Anthropic reduz o preço"));
  });

  it("continua usando a URL quando o link é de verdade", () => {
    const u = "https://techcrunch.com/2026/08/28/openai-preco/?utm_source=x";
    expect(chaveDoItem(u, "qualquer título")).toBe(chaveDaUrl(u));
  });
});

describe("lerQuando", () => {
  const agora = new Date("2026-08-28T12:00:00Z");

  it("entende a data relativa em inglês que a aba de notícias devolve", () => {
    expect(lerQuando("16 minutes ago", agora)).toBe("2026-08-28T11:44:00.000Z");
    expect(lerQuando("10 hours ago", agora)).toBe("2026-08-28T02:00:00.000Z");
    expect(lerQuando("1 day ago", agora)).toBe("2026-08-27T12:00:00.000Z");
    expect(lerQuando("2 weeks ago", agora)).toBe("2026-08-14T12:00:00.000Z");
  });

  it("entende português também", () => {
    expect(lerQuando("há 3 horas", agora)).toBe("2026-08-28T09:00:00.000Z");
  });

  it("aceita data absoluta", () => {
    expect(lerQuando("2026-08-27T09:00:00Z", agora)).toBe("2026-08-27T09:00:00.000Z");
  });

  it("devolve null no que não reconhece, em vez de uma data inventada", () => {
    expect(lerQuando("ontem à noite", agora)).toBeNull();
    expect(lerQuando("", agora)).toBeNull();
    expect(lerQuando(null, agora)).toBeNull();
  });

  it("faz a recência pontuar para data relativa", () => {
    // Este é o teste que importa: antes, "10 hours ago" virava NaN e o item
    // perdia os 2 pontos de "das últimas 36h" sem que nada acusasse.
    const n = pontuar(
      item("Anthropic lança novo modelo", "Anúncio da empresa.", { publicado: "10 hours ago" }),
      "ia_ferramentas", agora,
    );
    expect(n.motivos).toContain("das últimas 36h");
  });
});

describe("mesmaNoticia", () => {
  it("junta o mesmo lançamento contado por dois veículos", () => {
    expect(mesmaNoticia(
      "OpenAI lança GPT-5 para empresas com preço menor",
      "OpenAI anuncia GPT-5 para empresas e reduz preço",
    )).toBe(true);
  });

  it("mantém separadas duas notícias diferentes da mesma empresa", () => {
    expect(mesmaNoticia(
      "OpenAI lança GPT-5 para empresas",
      "OpenAI enfrenta processo judicial na Europa",
    )).toBe(false);
  });

  it("não funde títulos curtos que só compartilham a empresa e o verbo", () => {
    // Sem o piso de três palavras comuns, a sobreposição destes dois é 1,0 — o
    // título curto não tem miolo suficiente para provar que é a mesma notícia.
    expect(mesmaNoticia(
      "OpenAI lança GPT-5",
      "OpenAI lança novo plano",
    )).toBe(false);
  });
});

describe("pontuar", () => {
  it("aprova anúncio de ferramenta que usamos", () => {
    const n = pontuar(
      item("Anthropic reduz o preço do Claude na API",
           "A empresa anunciou nova tabela por milhão de tokens.",
           { publicado: "2026-08-28T09:00:00Z" }),
      "ia_ferramentas", HOJE,
    );
    expect(valeMostrar(n)).toBe(true);
    expect(n.motivos.join(" ")).toContain("anthropic");
  });

  it("descarta listicle mesmo citando nossas ferramentas", () => {
    // Este texto casa com TODO o vocabulário — é feito para isso. Sem o veto
    // explícito, seria o item mais bem pontuado do painel todo santo dia.
    const n = pontuar(
      item("As 10 melhores IAs de 2026: ChatGPT, Gemini, Claude e mais",
           "Descubra qual usar e veja como economizar."),
      "ia_ferramentas", HOJE,
    );
    expect(n.ruido).toBe(true);
    expect(valeMostrar(n)).toBe(false);
  });

  it("derruba a menção sem fato, por mais nomes que cite", () => {
    // Os dois casos reais da rodada de estreia. Citam nossos fornecedores, não
    // anunciam nada, e antes desta regra eram os melhores pontuados do painel.
    const perfil = pontuar(
      item("Dario and Daniela Amodei: The 100 Most Influential People in AI 2026",
           "Anthropic founders on the list.", { publicado: "5 hours ago" }),
      "ia_ferramentas", HOJE,
    );
    expect(valeMostrar(perfil)).toBe(false);

    const analise = pontuar(
      item("OpenAI's Mid-Game Battle: Strategic Shifts and Competitive Evolution",
           "An analysis of where OpenAI, Anthropic and Google stand.", { publicado: "3 hours ago" }),
      "ia_ferramentas", HOJE,
    );
    expect(valeMostrar(analise)).toBe(false);
    expect(analise.motivos).toContain("só menção — nada aconteceu");
  });

  it("aprova o anúncio de produto em inglês", () => {
    // O mesmo item que a versão só-em-português deixava de fora: a aba de
    // notícias responde em inglês, e o vocabulário de fato precisa acompanhar.
    const n = pontuar(
      item("Anthropic makes first move into physical AI",
           "Anthropic is opening a research preview of a shared specification for AI agents to operate equipment.",
           { publicado: "8 hours ago" }),
      "ia_ferramentas", HOJE,
    );
    expect(valeMostrar(n)).toBe(true);
  });

  it("não confunde mercado de capitais com notícia de API", () => {
    const n = pontuar(
      item("Mercado de capitais fecha em alta", "Investidores acompanham a curva de juros."),
      "ia_ferramentas", HOJE,
    );
    expect(n.pontos).toBeLessThan(CORTE);
  });

  it("não conta 'consumer' como concorrente sem contexto do setor", () => {
    const semSetor = pontuar(
      item("US consumer prices rise in August", "Inflation data came in above expectations."),
      "concorrentes", HOJE,
    );
    expect(semSetor.pontos).toBeLessThan(CORTE);

    const comSetor = pontuar(
      item("Consumer lança integração para restaurantes",
           "O sistema para restaurantes anunciou nova função de cardápio."),
      "concorrentes", HOJE,
    );
    expect(valeMostrar(comSetor)).toBe(true);
  });

  it("descarta matéria de setor que não cita concorrente nenhum", () => {
    // A consulta da pauta é do setor (os nomes das empresas não existem no
    // índice de notícias). Sem esta regra, "restaurante da Serra lança novo
    // cardápio" entraria: contexto de setor + verbo de fato dá exatamente o
    // corte, e o painel de concorrentes viraria coluna de gastronomia.
    const n = pontuar(
      item("Restaurante do centro lança novo cardápio de inverno",
           "A casa anunciou pratos sazonais para os clientes.", { publicado: "5 hours ago" }),
      "concorrentes", HOJE,
    );
    expect(valeMostrar(n)).toBe(false);
    expect(n.motivos).toContain("setor sim, concorrente não");
  });

  it("aprova movimento de concorrente na pauta de concorrentes", () => {
    const n = pontuar(
      item("Goomer anuncia aporte e compra a Neemo",
           "A empresa de cardápio digital para restaurantes fechou rodada."),
      "concorrentes", HOJE,
    );
    expect(valeMostrar(n)).toBe(true);
  });

  it("exige dois sinais para aprovar caso de backoffice", () => {
    const vago = pontuar(
      item("Empresa usa inteligência artificial para crescer", "Sem detalhes."),
      "ia_backoffice", HOJE,
    );
    expect(valeMostrar(vago)).toBe(false);

    const concreto = pontuar(
      item("Como a varejista automatizou a conciliação e o contas a pagar com IA",
           "O time financeiro cortou o fechamento pela metade."),
      "ia_backoffice", HOJE,
    );
    expect(valeMostrar(concreto)).toBe(true);
  });

  it("penaliza matéria de três semanas atrás", () => {
    const velha = pontuar(
      item("Anthropic reduz o preço do Claude na API", "Nova tabela.",
           { publicado: "2026-07-20T09:00:00Z" }),
      "ia_ferramentas", HOJE,
    );
    const nova = pontuar(
      item("Anthropic reduz o preço do Claude na API", "Nova tabela.",
           { publicado: "2026-08-28T09:00:00Z" }),
      "ia_ferramentas", HOJE,
    );
    expect(velha.pontos).toBeLessThan(nova.pontos);
  });

  it("não penaliza quem não informa data", () => {
    // Metade dos veículos não devolve data no resultado da busca. Descontar por
    // isso puniria o veículo pelo HTML dele, não pela idade da matéria.
    const semData = pontuar(item("Supabase lança nova função de branch", "Recurso disponível hoje."), "ia_ferramentas", HOJE);
    expect(valeMostrar(semData)).toBe(true);
  });
});
