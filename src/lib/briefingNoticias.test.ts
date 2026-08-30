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
  CORTE, SLOTS, aplicarPreferencias, chaveDaUrl, chaveDoAssunto, chaveDoItem,
  contemTermo, ehRedirecionador, escalaDoDia, escolherDoDia, lerQuando,
  limparTermos, mesmaNoticia, normalizarTexto, pautaAtual, pontuar, valeMostrar,
  type Bruto, type Candidato, type Preferencia,
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
      "foodservice", HOJE,
    );
    expect(semSetor.pontos).toBeLessThan(CORTE);

    const comSetor = pontuar(
      item("Consumer lança integração para restaurantes",
           "O sistema para restaurantes anunciou nova função de cardápio."),
      "foodservice", HOJE,
    );
    expect(valeMostrar(comSetor)).toBe(true);
  });

  it("descarta matéria de gastronomia que não é nem rival nem dado do setor", () => {
    // A consulta da pauta é do setor (os nomes das empresas não existem no
    // índice de notícias). Sem esta regra, "restaurante da Serra lança novo
    // cardápio" entraria: contexto de setor + verbo de fato dá exatamente o
    // corte, e a frente de foodservice viraria coluna de gastronomia.
    const n = pontuar(
      item("Restaurante do centro lança novo cardápio de inverno",
           "A casa anunciou pratos sazonais para os clientes.", { publicado: "5 hours ago" }),
      "foodservice", HOJE,
    );
    expect(valeMostrar(n)).toBe(false);
    expect(n.motivos).toContain("setor sim, nada de novo");
  });

  it("aprova movimento de concorrente na frente de foodservice", () => {
    const n = pontuar(
      item("Goomer anuncia aporte e compra a Neemo",
           "A empresa de cardápio digital para restaurantes fechou rodada."),
      "foodservice", HOJE,
    );
    expect(valeMostrar(n)).toBe(true);
  });

  it("aprova o DADO do setor, que chega sem verbo de anúncio", () => {
    // O item que herdou a função do "Panorama do dia": o número que servia de
    // munição comercial na prosa. Não cita concorrente e não anuncia nada — a
    // manchete de dado setorial é substantivo e número. Antes da segunda porta,
    // caía no "só menção" e a frente perdia justamente o que ela ganhou.
    const n = pontuar(
      item("Foodservice bate recorde no 2T26: R$ 62,9 bilhões",
           "Levantamento aponta crescimento de 1% e faturamento recorde em bares e restaurantes.",
           { publicado: "6 hours ago" }),
      "foodservice", HOJE,
    );
    expect(valeMostrar(n)).toBe(true);
    expect(n.motivos.join(" ")).toContain("dado do setor");
  });

  it("aprova a decisão do Copom e derruba o palpite sobre ela", () => {
    // A frente de finanças nasceu da prosa repetitiva do panorama. O que a
    // salva de repetir é o mesmo que salva as outras: exigir que algo tenha
    // ACONTECIDO. "Copom mantém" aconteceu; "o que esperar dos juros" não.
    const decisao = pontuar(
      item("Copom mantém a Selic em 14% ao ano",
           "O Banco Central decidiu por unanimidade manter os juros.", { publicado: "4 hours ago" }),
      "financas", HOJE,
    );
    expect(valeMostrar(decisao)).toBe(true);

    const palpite = pontuar(
      item("Juros: analistas divergem sobre o próximo passo",
           "O mercado discute o cenário para a Selic."),
      "financas", HOJE,
    );
    expect(valeMostrar(palpite)).toBe(false);
  });

  it("não deixa matéria de tecnologia entrar pela porta de finanças", () => {
    const n = pontuar(
      item("Empresa lança novo aplicativo de fotos", "O app chegou hoje às lojas."),
      "financas", HOJE,
    );
    expect(valeMostrar(n)).toBe(false);
    expect(n.motivos).toContain("não é assunto de finanças");
  });

  it("aceita a cifra no lugar do verbo na frente de startups", () => {
    // O formato mais comum da manchete de captação é nome + valor + estágio,
    // sem um único verbo de anúncio.
    const rodada = pontuar(
      item("Foodtech brasileira capta US$ 20 milhões em Series A",
           "A startup de SaaS para restaurantes fechou a rodada com fundo americano.",
           { publicado: "3 hours ago" }),
      "startups", HOJE,
    );
    expect(valeMostrar(rodada)).toBe(true);

    const semNada = pontuar(
      item("Startups discutem o futuro do trabalho", "Painel reuniu fundadores."),
      "startups", HOJE,
    );
    expect(valeMostrar(semNada)).toBe(false);
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

/* ============================================================ o revezamento */

describe("escalaDoDia", () => {
  it("entrega uma consulta por slot — quatro buscas, e nem uma a mais", () => {
    // O teto de créditos é a razão de a grade existir. Se um dia alguém
    // acrescentar um slot sem olhar a conta, o custo mensal sobe ~25% em
    // silêncio: o freio só avisa depois, e no meio do mês.
    const hoje = escalaDoDia("2026-08-29");
    expect(hoje).toHaveLength(SLOTS.length);
    expect(SLOTS).toHaveLength(4);
  });

  it("reveza as consultas do mesmo slot de um dia para o outro", () => {
    const a = escalaDoDia("2026-08-29").map((e) => e.consulta.q);
    const b = escalaDoDia("2026-08-30").map((e) => e.consulta.q);
    // Todo slot desta grade tem duas consultas: nenhuma se repete no dia seguinte.
    a.forEach((q, i) => expect(q).not.toBe(b[i]));
  });

  it("é função da data e não de um contador — a mesma data dá a mesma grade", () => {
    // O botão "buscar agora" e uma reenfileirada do cron rodam o mesmo dia duas
    // vezes. Com contador no banco, a grade andaria e uma frente pularia o dia
    // seguinte inteiro sem ninguém notar.
    expect(escalaDoDia("2026-08-29")).toEqual(escalaDoDia("2026-08-29"));
    expect(escalaDoDia("2026-08-29T07:40:00-03:00").map((e) => e.consulta.q))
      .toEqual(escalaDoDia("2026-08-29").map((e) => e.consulta.q));
  });

  it("cobre as quatro frentes em dois dias", () => {
    const frentes = new Set([
      ...escalaDoDia("2026-08-29").map((e) => e.pauta.chave),
      ...escalaDoDia("2026-08-30").map((e) => e.pauta.chave),
    ]);
    expect(frentes).toEqual(new Set(["ia_ferramentas", "ia_backoffice", "foodservice", "financas", "startups"]));
  });

  it("não devolve pauta que a régua não conhece", () => {
    // `escalaDoDia` resolve a pauta por `pautaPorChave`, que devolve `undefined`
    // para chave desconhecida — e o `!` na função esconderia isso até virar
    // "cannot read property 'chave' of undefined" às 07:40 da manhã.
    for (const dia of ["2026-08-29", "2026-08-30", "2026-09-01"]) {
      escalaDoDia(dia).forEach((e) => expect(e.pauta?.chave).toBeTruthy());
    }
  });
});

describe("pautaAtual", () => {
  it("traduz a pauta velha para a nova", () => {
    // Linhas gravadas antes de 29/08/2026 têm `concorrentes`, que virou
    // `foodservice`. Sem esta tradução, a rodada de conserto pula essas linhas
    // caladas e elas ficam mudas para sempre.
    expect(pautaAtual("concorrentes")).toBe("foodservice");
    expect(pautaAtual("financas")).toBe("financas");
  });
});

/* ======================================================== o gosto declarado */

describe("aplicarPreferencias", () => {
  const pref = (rotulo: string, termos: string[], peso: number): Preferencia =>
    ({ assunto: rotulo, rotulo, termos, peso });

  it("exige DOIS termos — um só é coincidência", () => {
    const p = [pref("preço de API de IA", ["preco", "api", "token"], 2)];
    // "preço" aparece em metade das manchetes de tecnologia. Sozinho, um 👎 em
    // "aumento de preço da maquininha" calaria todo anúncio de preço da Anthropic.
    expect(aplicarPreferencias(normalizarTexto("Preço do aluguel sobe em agosto"), p).delta).toBe(0);
    expect(aplicarPreferencias(normalizarTexto("OpenAI muda o preço da API"), p).delta).toBe(2);
  });

  it("respeita o teto por assunto e o teto da soma", () => {
    const muito = [pref("um", ["alfa", "beta"], 99), pref("dois", ["alfa", "beta"], 99)];
    // 99 vira 4 por assunto, e 4+4 vira 6 no total: preferência empurra a fila,
    // não substitui a régua.
    expect(aplicarPreferencias(normalizarTexto("alfa e beta"), muito).delta).toBe(6);
  });

  it("veta a partir do segundo 👎, e não antes", () => {
    const um = aplicarPreferencias(normalizarTexto("alfa e beta"), [pref("x", ["alfa", "beta"], -1)]);
    expect(um.vetado).toBe(false);
    expect(um.delta).toBe(-1);

    const dois = aplicarPreferencias(normalizarTexto("alfa e beta"), [pref("x", ["alfa", "beta"], -2)]);
    expect(dois.vetado).toBe(true);
  });

  it("o veto derruba o item mesmo bem pontuado", () => {
    const bruto = item("Anthropic reduz o preço do Claude na API",
                       "A empresa anunciou nova tabela por milhão de tokens.",
                       { publicado: "2 hours ago" });
    expect(valeMostrar(pontuar(bruto, "ia_ferramentas", HOJE))).toBe(true);

    const vetado = pontuar(bruto, "ia_ferramentas", HOJE, [pref("preço de API", ["preco", "api"], -2)]);
    expect(vetado.ruido).toBe(true);
    expect(vetado.motivos.join(" ")).toContain("evitado a seu pedido");
  });

  it("o 👍 aprova o que ficaria de fora por um ponto", () => {
    // A intenção declarada do botão: "quero mais disso" precisa poder mudar o
    // resultado, senão é enfeite. Sem preferência este item morre no corte.
    const bruto = item("Prefeitura discute a coleta de lixo dos restaurantes",
                       "Bares e restaurantes terão nova regra de coleta.");
    expect(valeMostrar(pontuar(bruto, "ia_backoffice", HOJE))).toBe(false);

    const querido = pontuar(bruto, "ia_backoffice", HOJE, [pref("regra municipal", ["coleta", "restaurantes"], 4)]);
    expect(valeMostrar(querido)).toBe(true);
    expect(querido.motivos.join(" ")).toContain("você pediu mais");
  });

  it("ignora preferência sem termos ou com peso zero", () => {
    // O caso do assunto recém-criado cujo voto foi desfeito: peso 0. Sem esta
    // guarda ele empataria a soma com um motivo escrito na tela dizendo que
    // pesou — mentira barata e difícil de rastrear.
    const nada = aplicarPreferencias(normalizarTexto("alfa e beta"), [
      pref("sem termos", [], 3), pref("sem peso", ["alfa", "beta"], 0),
    ]);
    expect(nada.delta).toBe(0);
    expect(nada.motivos).toHaveLength(0);
  });
});

/* ============================================================== a vitrine */

describe("escolherDoDia", () => {
  const cand = (pauta: any, pontos: number, titulo: string): Candidato => ({
    titulo, descricao: "", url: `https://exemplo.com/${titulo}`, pauta, nota: { pontos, motivos: [], ruido: false },
  });

  it("dois por pauta, para caberem três frentes na manhã", () => {
    const dia = [
      cand("ia_ferramentas", 9, "a"), cand("ia_ferramentas", 8, "b"), cand("ia_ferramentas", 7, "c"),
      cand("financas", 6, "d"), cand("foodservice", 5, "e"), cand("startups", 4, "f"),
    ];
    const escolhidos = escolherDoDia(dia);
    expect(escolhidos.filter((c) => c.pauta === "ia_ferramentas")).toHaveLength(2);
    expect(new Set(escolhidos.map((c) => c.pauta)).size).toBe(4);
  });
});

/* =================================================== o voto vira vocabulário */

describe("chaveDoAssunto", () => {
  it("junta as grafias do mesmo assunto", () => {
    // Sem isto, o peso de um assunto nunca passa de 1: cada voto cria uma linha
    // parecida, e a tela de preferências vira uma lista de sinônimos.
    expect(chaveDoAssunto("Preço de API de IA")).toBe(chaveDoAssunto("preco de api de ia"));
  });
});

describe("limparTermos", () => {
  it("descarta o que casaria com tudo e corta em cinco", () => {
    expect(limparTermos(["Preço", "API", "ia", "de", "token", "modelo", "tabela", "custo"]))
      .toEqual(["preco", "api", "token", "modelo", "tabela"]);
  });

  it("não repete termo e aguenta lixo", () => {
    expect(limparTermos(["preco", "PREÇO", null, 3, ""])).toEqual(["preco"]);
    expect(limparTermos(undefined)).toEqual([]);
  });
});
