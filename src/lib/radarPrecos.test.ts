import { describe, it, expect } from "vitest";
import {
  lerSpecs, avaliar, classificar, pisoDePreco, condicaoDoTitulo, textoWhats, resumoDoAlvo,
  disponibilidade, totalDaOferta, economiaDe, pesoDaNota, textoNota, sugerirTeto, lerEmbalagem,
  type AlvoSpecs, type OfertaBruta,
} from "./radarPrecos";

/** O pedido típico do Facilities: notebook de trabalho, teto de R$ 3.000. */
const ALVO: AlvoSpecs = {
  categoria: "notebook",
  cpu_tier_min: 5,
  ram_gb_min: 16,
  armazenamento_gb_min: 512,
  armazenamento_tipo: "ssd",
  condicoes: ["novo"],
};
const TETO = 3000;

function oferta(titulo: string, preco: number, extra: Partial<OfertaBruta> = {}): OfertaBruta {
  return { fonte: "mercado_livre", id_externo: "MLB1", titulo, url: "https://x", preco, ...extra };
}

describe("lerSpecs — separar RAM de armazenamento", () => {
  it("lê as duas memórias quando o título traz as etiquetas", () => {
    const s = lerSpecs("Notebook Lenovo IdeaPad 3i i5-1235U 16GB RAM 512GB SSD 15.6");
    expect(s.ram_gb).toBe(16);
    expect(s.armazenamento_gb).toBe(512);
    expect(s.armazenamento_tipo).toBe("ssd");
    expect(s.cpu_tier).toBe(5);
    expect(s.cpu_geracao).toBe(12);
    expect(s.tela_pol).toBe(15.6);
    expect(s.marca).toBe("lenovo");
  });

  it("não se perde quando o anúncio inverte a ordem", () => {
    const s = lerSpecs("Notebook Dell Inspiron 512GB SSD 16GB Memória i7 11ª geração");
    expect(s.ram_gb).toBe(16);
    expect(s.armazenamento_gb).toBe(512);
    expect(s.cpu_tier).toBe(7);
    expect(s.cpu_geracao).toBe(11);
  });

  it("cai na grandeza quando não há etiqueta nenhuma", () => {
    // "8GB 256GB" sem dizer qual é qual: 8 nunca é disco, 256 nunca é memória
    const s = lerSpecs("Notebook Acer Aspire 5 i5 8GB 256GB");
    expect(s.ram_gb).toBe(8);
    expect(s.armazenamento_gb).toBe(256);
  });

  it("converte TB em GB", () => {
    expect(lerSpecs("Notebook Asus i7 16GB RAM 1TB SSD").armazenamento_gb).toBe(1024);
  });

  it("não deixa a palavra colada mentir sobre a grandeza", () => {
    // "16GB SSD": a etiqueta diz disco, mas 16GB de disco não existe em notebook.
    // Era esta a leitura que produzia "16GB de armazenamento, abaixo dos 512GB".
    const s = lerSpecs("Notebook Lenovo i5 16GB SSD");
    expect(s.ram_gb).toBe(16);
    expect(s.armazenamento_gb).toBeNull();

    // E o inverso: 512 perto de "RAM" continua sendo disco.
    const t = lerSpecs("Notebook Dell i7 512GB RAM DDR4");
    expect(t.armazenamento_gb).toBe(512);
    expect(t.ram_gb).toBeNull();
  });

  it("marca de qual fabricante é o processador", () => {
    expect(lerSpecs("Notebook Dell i5-1235U").cpu_marca).toBe("intel");
    expect(lerSpecs("Notebook Acer Ryzen 7 7730U").cpu_marca).toBe("amd");
    expect(lerSpecs("MacBook Air M2").cpu_marca).toBe("apple");
    // Geração é escala da Intel: fora dela não se inventa número.
    expect(lerSpecs("Notebook Acer Ryzen 7 7730U").cpu_geracao).toBeNull();
  });

  it("devolve null no que o anúncio não diz", () => {
    const s = lerSpecs("Notebook Samsung Book");
    expect(s.ram_gb).toBeNull();
    expect(s.cpu_tier).toBeNull();
    expect(s.tela_pol).toBeNull();
  });

  it("entende Ryzen e Apple", () => {
    expect(lerSpecs("Notebook Acer Nitro Ryzen 7 7730U 16GB").cpu_tier).toBe(7);
    expect(lerSpecs("MacBook Air M2 8GB 256GB").cpu_tier).toBe(7);
  });
});

describe("avaliar — o que NÃO pode passar", () => {
  it("recusa o carregador, que é o falso positivo clássico", () => {
    const r = avaliar(ALVO, TETO, oferta("Carregador Para Notebook Dell Inspiron 65W Original", 89));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/acess[óo]rio|pe[çc]a/i);
  });

  it("recusa a memória avulsa de 16GB", () => {
    const r = avaliar(ALVO, TETO, oferta("Memória RAM 16GB DDR4 3200MHz Notebook Kingston", 240));
    expect(r.aprovado).toBe(false);
  });

  it("recusa sucata mesmo quando o preço é ótimo", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Dell i7 16GB 512GB SSD Não Liga Para Retirada de Peças", 800));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/defeito|pe[çc]as/i);
  });

  it("recusa preço abaixo do piso, que é bom demais para ser verdade", () => {
    expect(pisoDePreco(TETO)).toBe(750);
    const r = avaliar(ALVO, TETO, oferta("Notebook Lenovo i5 16GB 512GB SSD", 400));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/piso/i);
  });

  it("recusa acima do teto, mas marca que é o produto certo (vale histórico)", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Lenovo i5 16GB RAM 512GB SSD", 3400));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/teto/i);
    // É o produto certo pelo preço errado: guardar a linha é o que permite
    // dizer, depois, "R$ 2.900 é o menor preço em 90 dias".
    expect(r.apenas_preco).toBe(true);
  });

  it("recusa que NÃO é de preço não entra no histórico", () => {
    // Acessório, sucata e spec abaixo do pedido não são histórico de nada.
    expect(avaliar(ALVO, TETO, oferta("Carregador Para Notebook Dell 65W", 2000)).apenas_preco).toBe(false);
    expect(avaliar(ALVO, TETO, oferta("Notebook Lenovo i5 8GB RAM 512GB SSD", 2400)).apenas_preco).toBe(false);
    expect(avaliar(ALVO, TETO, oferta("Notebook Lenovo i5 16GB 512GB SSD Seminovo", 2000)).apenas_preco).toBe(false);
  });

  it("o frete pode ser o que joga o produto certo para fora do teto", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2950, { frete_valor: 120 }));
    expect(r.aprovado).toBe(false);
    expect(r.apenas_preco).toBe(true);
    expect(r.total).toBe(3070);
  });

  it("recusa spec declarada abaixo do pedido", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Lenovo i5 8GB RAM 512GB SSD", 2400));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toContain("8GB");
  });

  it("recusa HD mecânico quando o pedido é SSD", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 1TB HD SATA", 2500));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/HD/);
  });

  it("recusa usado quando o pedido é só novo", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Lenovo i5 16GB 512GB SSD Seminovo Revisado", 2000));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/usado/);
  });

  it("recusa processador inferior", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Positivo Celeron 16GB RAM 512GB SSD", 1500));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/inferior/);
  });

  it("recusa marca fora da lista quando o pedido restringe", () => {
    const r = avaliar({ ...ALVO, marcas: ["dell", "lenovo"] }, TETO, oferta("Notebook Acer Aspire i5 16GB 512GB SSD", 2600));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/marca/);
  });
});

describe("avaliar — o que TEM de passar", () => {
  it("aprova o anúncio certo e explica por quê", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Lenovo IdeaPad i5-1235U 16GB RAM 512GB SSD", 2590, {
      reputacao: 0.9, frete_gratis: true, vendas: 300, condicao: "novo", disponivel: true,
      avaliacao: 4.6, avaliacoes: 1842,
    }));
    expect(r.aprovado).toBe(true);
    expect(r.recusa).toBeNull();
    expect(r.motivos.join(" ")).toMatch(/abaixo do teto/);
    expect(r.motivos.join(" ")).toMatch(/frete grátis/);
    expect(r.motivos.join(" ")).toMatch(/4,6 ★/);
    // Nada pendente: specs, estoque, frete e avaliações, tudo confirmado.
    expect(r.conferir).toHaveLength(0);
    expect(r.score).toBeGreaterThan(70);
  });

  it("não reprova por spec que o anúncio simplesmente não informou — manda conferir", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Samsung Book Intel Core i5", 2700, { condicao: "novo" }));
    expect(r.aprovado).toBe(true);
    expect(r.conferir).toContain("memória RAM");
    expect(r.conferir).toContain("armazenamento");
  });

  it("spec não informada custa pontos — o certinho ganha do incompleto", () => {
    const completo = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2700, { condicao: "novo", reputacao: 0.9 }));
    const vago = avaliar(ALVO, TETO, oferta("Notebook Dell Core i5", 2700, { condicao: "novo", reputacao: 0.9 }));
    expect(completo.score).toBeGreaterThan(vago.score);
  });

  it("mais barato pontua mais que mais caro, tudo o mais igual", () => {
    const barato = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2100, { condicao: "novo", reputacao: 0.8 }));
    const caro = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2950, { condicao: "novo", reputacao: 0.8 }));
    expect(barato.score).toBeGreaterThan(caro.score);
  });

  it("aceita 'com carregador' no meio do título — o filtro só olha o começo", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Lenovo i5 16GB RAM 512GB SSD com carregador original", 2600, { condicao: "novo" }));
    expect(r.aprovado).toBe(true);
  });

  it("não reprova Ryzen por causa de uma exigência de geração Intel", () => {
    const alvo: AlvoSpecs = { ...ALVO, cpu_geracao_min: 12 };
    const r = avaliar(alvo, TETO, oferta("Notebook Acer Ryzen 7 7730U 16GB RAM 512GB SSD", 2700, { condicao: "novo" }));
    expect(r.aprovado).toBe(true);
    expect(r.conferir).toContain("geração do processador");
  });

  it("ainda reprova Intel velha quando a geração é exigida", () => {
    const alvo: AlvoSpecs = { ...ALVO, cpu_geracao_min: 12 };
    const r = avaliar(alvo, TETO, oferta("Notebook Dell i5-7200U 16GB RAM 512GB SSD", 2200, { condicao: "novo" }));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/7ª geração/);
  });

  it("aceita usado quando o pedido aceita usado", () => {
    const r = avaliar({ ...ALVO, condicoes: ["novo", "recondicionado"] }, TETO,
      oferta("Notebook Dell i5 16GB RAM 512GB SSD Recondicionado", 1900));
    expect(r.aprovado).toBe(true);
  });
});

describe("disponibilidade — produto esgotado não é achado", () => {
  it("recusa o que a fonte marcou como indisponível", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Lenovo i5 16GB RAM 512GB SSD", 2400, { disponivel: false }));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/indispon|esgotad/i);
  });

  it("lê 'esgotado' do próprio texto quando a fonte não diz nada", () => {
    expect(disponibilidade("Notebook Dell i5 - PRODUTO ESGOTADO")).toBe(false);
    expect(disponibilidade("Notebook Dell i5", "Avise-me quando chegar")).toBe(false);
    expect(disponibilidade("Notebook Dell i5", "Sem estoque no momento")).toBe(false);
  });

  it("NÃO confunde o selo 'mais vendido' com produto vendido", () => {
    // Selo de destaque em quase toda loja — barrá-lo mataria justamente os bons.
    expect(disponibilidade("Notebook Lenovo i5 16GB | MAIS VENDIDO")).not.toBe(false);
  });

  it("não inventa disponibilidade: silêncio vira 'conferir', não recusa", () => {
    expect(disponibilidade("Notebook Dell i5 16GB")).toBeNull();
    const r = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2400));
    expect(r.aprovado).toBe(true);
    expect(r.conferir).toContain("se está em estoque");
  });

  it("estoque confirmado pontua mais que estoque desconhecido", () => {
    const base = { condicao: "novo" as const, reputacao: 0.9, frete_gratis: true };
    const confirmado = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2400, { ...base, disponivel: true }));
    const incerto = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2400, base));
    expect(confirmado.score).toBeGreaterThan(incerto.score);
  });
});

describe("frete — entra na conta, e desconhecido não vira zero", () => {
  it("soma o frete no total", () => {
    const { total, frete, frete_conhecido } = totalDaOferta(oferta("x", 2400, { frete_valor: 120 }));
    expect(total).toBe(2520);
    expect(frete).toBe(120);
    expect(frete_conhecido).toBe(true);
  });

  it("frete grátis é zero de verdade", () => {
    const r = totalDaOferta(oferta("x", 2400, { frete_gratis: true }));
    expect(r.total).toBe(2400);
    expect(r.frete).toBe(0);
    expect(r.frete_conhecido).toBe(true);
  });

  it("frete desconhecido NÃO é somado como zero", () => {
    const r = totalDaOferta(oferta("x", 2400));
    expect(r.total).toBe(2400);
    expect(r.frete).toBeNull();
    expect(r.frete_conhecido).toBe(false); // o total é só o produto, e a tela precisa saber
  });

  it("recusa quando é o frete que estoura o teto", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2980, { frete_valor: 140, disponivel: true }));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/frete/);
    expect(r.recusa).toMatch(/2980/);
  });

  it("o mesmo produto mais barato porém com frete caro perde do mais caro com frete grátis", () => {
    const comFrete = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2400, { frete_valor: 300, disponivel: true, reputacao: 0.8 }));
    const semFrete = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2550, { frete_gratis: true, disponivel: true, reputacao: 0.8 }));
    expect(comFrete.total).toBe(2700);
    expect(semFrete.total).toBe(2550);
    expect(semFrete.score).toBeGreaterThan(comFrete.score);
  });

  it("frete desconhecido vai para 'conferir'", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2400, { disponivel: true }));
    expect(r.conferir).toContain("valor do frete");
  });
});

describe("nota do produto — só vale com massa de avaliações", () => {
  it("ignora nota alta com amostra minúscula", () => {
    // "5,0 estrelas" com duas avaliações é ruído com cara de sinal.
    expect(pesoDaNota(5.0, 2)).toBeNull();
    expect(pesoDaNota(4.9, 4)).toBeNull();
  });

  it("premia nota alta com massa", () => {
    expect(pesoDaNota(4.7, 1800)).toBe(6);
    expect(pesoDaNota(4.2, 300)).toBe(3);
  });

  it("penaliza produto mal avaliado com massa — é aviso, não detalhe", () => {
    expect(pesoDaNota(2.8, 400)).toBe(-8);
  });

  it("nota ausente não é zero: é 'não sei'", () => {
    expect(pesoDaNota(null, 900)).toBeNull();
    expect(pesoDaNota(4.8, null)).toBeNull();
  });

  it("a nota nunca aparece na tela sem a contagem ao lado", () => {
    expect(textoNota(4.6, 1842)).toBe("4,6 ★ (1.842)");
    expect(textoNota(5, 0)).toBe("5,0 ★ (sem contagem)");
    expect(textoNota(null, 10)).toBeNull();
  });

  it("bem avaliado ganha de sem avaliação, tudo o mais igual", () => {
    const base = { condicao: "novo" as const, reputacao: 0.8, frete_gratis: true, disponivel: true };
    const bom = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2500, { ...base, avaliacao: 4.7, avaliacoes: 1800 }));
    const mudo = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2500, base));
    expect(bom.score).toBeGreaterThan(mudo.score);
    expect(mudo.conferir).toContain("avaliações do produto");
  });

  it("mal avaliado perde para quem não tem nota nenhuma", () => {
    const base = { condicao: "novo" as const, reputacao: 0.8, frete_gratis: true, disponivel: true };
    const ruim = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2500, { ...base, avaliacao: 2.5, avaliacoes: 400 }));
    const mudo = avaliar(ALVO, TETO, oferta("Notebook Dell i5 16GB RAM 512GB SSD", 2500, base));
    expect(ruim.score).toBeLessThan(mudo.score);
    expect(ruim.motivos.join(" ")).toMatch(/mal avaliado/);
  });
});

describe("economiaDe", () => {
  it("é o que sobra do teto, vezes a quantidade", () => {
    expect(economiaDe(3000, 2590)).toBe(410);
    expect(economiaDe(3000, 2590, 4)).toBe(1640);
  });
  it("nunca é negativa", () => {
    expect(economiaDe(3000, 3200)).toBe(0);
  });
  it("conta o frete, porque o total já vem com ele", () => {
    expect(economiaDe(3000, 2590 + 200)).toBe(210);
  });
});

describe("condicaoDoTitulo", () => {
  it("prefere o que a fonte informou", () => {
    expect(condicaoDoTitulo("Notebook Seminovo", "novo")).toBe("novo");
  });
  it("cai no título quando a fonte não informa", () => {
    expect(condicaoDoTitulo("Notebook Dell Recondicionado")).toBe("recondicionado");
    expect(condicaoDoTitulo("Notebook Dell Seminovo")).toBe("usado");
    expect(condicaoDoTitulo("Notebook Dell Lacrado")).toBe("novo");
  });
});

describe("classificar — só avisa o que merece aviso", () => {
  it("não avisa nada acima do teto", () => {
    expect(classificar(3200, 3000, [])).toBeNull();
  });

  it("avisa na primeira vez que entra no teto", () => {
    expect(classificar(2800, 3000, [])?.tipo).toBe("alvo_batido");
  });

  it("cala a boca quando o preço está parado há semanas", () => {
    const h = [{ preco: 2800, coletado_em: "2026-08-01" }, { preco: 2800, coletado_em: "2026-08-20" }];
    expect(classificar(2800, 3000, h)).toBeNull();
  });

  it("avisa mínimo histórico", () => {
    const h = [{ preco: 2800, coletado_em: "2026-08-01" }, { preco: 2750, coletado_em: "2026-08-20" }];
    const r = classificar(2500, 3000, h);
    expect(r?.tipo).toBe("minimo_historico");
    expect(r?.texto).toMatch(/menor pre[çc]o/);
  });

  it("avisa queda forte mesmo sem bater o mínimo", () => {
    const h = [{ preco: 2400, coletado_em: "2026-08-01" }, { preco: 2900, coletado_em: "2026-08-20" }];
    const r = classificar(2550, 3000, h);
    expect(r?.tipo).toBe("queda_forte");
  });
});

describe("sugerirTeto — o número é regra, não opinião", () => {
  /** 20 dias com mínimo 3.800 e típico ~4.200. */
  const curva = Array.from({ length: 20 }, (_, i) => ({
    dia: `2026-08-${String(i + 1).padStart(2, "0")}`,
    menor: i === 7 ? 3800 : 3950 + i * 10,
    mediana: 4200,
    ofertas: 6,
  }));

  it("não opina com pouco histórico, mas já devolve os números", () => {
    const s = sugerirTeto(curva.slice(0, 5));
    expect(s.pode).toBe(false);
    expect(s.dias).toBe(5);
    expect(s.minimo).toBeGreaterThan(0);
  });

  it("libera a opinião a partir de 14 dias", () => {
    expect(sugerirTeto(curva.slice(0, 13)).pode).toBe(false);
    expect(sugerirTeto(curva.slice(0, 14)).pode).toBe(true);
  });

  it("ancora no menor preço + 5%, arredondado para cima", () => {
    const s = sugerirTeto(curva);
    expect(s.minimo).toBe(3800);
    // 3800 × 1,05 = 3990 → sobe para os 50 seguintes
    expect(s.teto).toBe(4000);
  });

  it("acusa o teto que nunca vai disparar — o erro mais caro", () => {
    const s = sugerirTeto(curva, 3000);
    expect(s.veredito).toBe("abaixo_do_minimo");
    expect(s.resumo).toMatch(/nunca vai avisar/);
  });

  it("acusa o teto apertado, que só bate repetindo a melhor promoção", () => {
    expect(sugerirTeto(curva, 3850).veredito).toBe("apertado");
  });

  it("aprova o teto na faixa entre o mínimo e o típico", () => {
    expect(sugerirTeto(curva, 4100).veredito).toBe("bom");
  });

  it("acusa o teto folgado, que avisaria todo dia", () => {
    const s = sugerirTeto(curva, 5000);
    expect(s.veredito).toBe("folgado");
    expect(s.resumo).toMatch(/aviso nenhum/);
  });

  it("o teto que a própria regra sugere jamais é reprovado por ela", () => {
    // Parece óbvio e não era: com poucos anúncios por dia a mediana diária cola
    // no mínimo, o "típico" fica ABAIXO do sugerido, e a regra passava a chamar
    // de folgado justamente o valor que acabara de recomendar.
    // Preço quase parado (~3.820) com um dia de queda: o mínimo puxa o teto
    // sugerido para R$ 4.000, mas o típico fica em R$ 3.820.
    const rala = Array.from({ length: 20 }, (_, i) => ({
      dia: `2026-08-${String(i + 1).padStart(2, "0")}`,
      menor: i === 8 ? 3800 : 3820,
      mediana: i === 8 ? 3800 : 3820, // um anúncio por dia: mediana = menor
      ofertas: 1,
    }));
    const s = sugerirTeto(rala);
    expect(s.teto).toBe(4000);
    expect(s.tipico).toBeLessThan(s.teto); // a faixa colapsou
    expect(sugerirTeto(rala, s.teto).veredito).toBe("bom");
  });

  it("sem histórico não inventa número nenhum", () => {
    const s = sugerirTeto([]);
    expect(s.pode).toBe(false);
    expect(s.teto).toBe(0);
    expect(s.veredito).toBeNull();
  });
});

describe("textoWhats", () => {
  it("monta a mensagem com preço, loja, link e o que conferir", () => {
    const t = textoWhats({
      alvo_titulo: "Notebook para o time de vendas",
      preco_alvo: 3000,
      ofertas: [{
        titulo: "Notebook Lenovo i5 16GB 512GB SSD",
        preco: 2590, url: "https://ml/x", fonte: "Mercado Livre",
        vendedor: "Loja Oficial Lenovo", motivo: "menor preço já visto",
        conferir: ["reputação do vendedor"],
      }],
    });
    expect(t).toContain("R$ 2.590");
    expect(t).toContain("https://ml/x");
    expect(t).toContain("Loja Oficial Lenovo");
    expect(t).toContain("conferir no anúncio");
    expect(t).toContain("Teto: R$ 3.000");
  });
});

describe("resumoDoAlvo", () => {
  it("descreve o pedido numa linha", () => {
    expect(resumoDoAlvo(ALVO)).toBe("notebook · i5+ · 16GB RAM · SSD 512GB");
  });
  it("mostra a condição quando não é só novo", () => {
    expect(resumoDoAlvo({ ...ALVO, condicoes: ["novo", "recondicionado"] })).toMatch(/recondicionado/);
  });
});

/* ================================================== compra recorrente ==== */

/** Café para a copa: o teto é POR QUILO, que é como se compra consumível. */
const CAFE: AlvoSpecs = {
  categoria: "consumivel",
  unidade: "kg",
  termos_obrigatorios: ["cafe"],
  condicoes: ["novo"],
};
const TETO_KG = 60;

describe("lerEmbalagem — quanto vem no pacote", () => {
  it("lê peso e converte para quilo", () => {
    expect(lerEmbalagem("Café Pilão Torrado e Moído 500g")).toEqual({ quantidade: 0.5, unidade: "kg", texto: "500g" });
    expect(lerEmbalagem("Sabão em pó OMO 1,6kg")).toEqual({ quantidade: 1.6, unidade: "kg", texto: "1,6kg" });
  });

  it("lê volume e converte para litro", () => {
    expect(lerEmbalagem("Detergente Ypê Neutro 500ml")?.quantidade).toBe(0.5);
    expect(lerEmbalagem("Água Sanitária Qboa 2 litros")?.quantidade).toBe(2);
  });

  it("o fardo é o multiplicador, não a garrafa", () => {
    // Sem isto, um fardo de seis litros passaria por uma garrafa de um.
    expect(lerEmbalagem("Água Mineral Crystal 6x1,5L")).toEqual({ quantidade: 9, unidade: "l", texto: "6x1,5l" });
    expect(lerEmbalagem("Leite Integral Italac 12 x 1L")?.quantidade).toBe(12);
  });

  it("conta peças quando não há peso nem volume", () => {
    expect(lerEmbalagem("Papel Higiênico Neve Folha Dupla 12 rolos")).toEqual({ quantidade: 12, unidade: "un", texto: "12 rolos" });
    // O "200ml" é o tamanho de UM copo, não do pacote. Quem compra copo compra
    // peça — e é por isso que a unidade pedida decide a leitura.
    expect(lerEmbalagem("Copo Descartável 200ml c/ 100 unidades", "un")).toEqual({ quantidade: 100, unidade: "un", texto: "100 unidades" });
    /* Pedido em LITRO, o mesmo anúncio não responde em litro: os 200 ml são o
       tamanho de UM copo, e não há como saber se o pacote são 100 deles.
       Devolver 0,2 L daria um R$/L calculado sobre um copo — número errado com
       cara de certo. O que volta é a leitura honesta, em peça, e é `avaliar`
       quem recusa dizendo que a unidade não bate. */
    expect(lerEmbalagem("Copo Descartável 200ml c/ 100 unidades", "l")).toEqual({
      quantidade: 100, unidade: "un", texto: "100 unidades",
    });
  });

  it("GRAMATURA NÃO É EMBALAGEM — a resma são as folhas, não os 75g/m²", () => {
    const e = lerEmbalagem("Papel Sulfite A4 75g/m² Chamex 500 folhas");
    expect(e).toEqual({ quantidade: 500, unidade: "un", texto: "500 folhas" });
  });

  it("CONTINENTE multiplica, PEÇA não — a diferença entre um kit e uma caixa de cápsulas", () => {
    // "5 pacotes DE 250g": cada pacote tem 250 g → 1,25 kg.
    expect(lerEmbalagem("Café Pilão Torrado E Moído Tradicional 5 Pacotes De 250g", "kg")?.quantidade).toBeCloseTo(1.25);
    // "10 unidades 170g": dez cápsulas que JUNTAS pesam 170 g → 0,17 kg.
    // Lido como multiplicação, a caixa de R$ 20 virava café a R$ 11 o quilo.
    expect(lerEmbalagem("Café em Cápsula KitKat Nescafé Dolce Gusto 10 Unidades 170g", "kg")?.quantidade).toBeCloseTo(0.17);
    // O continente também conta quando vem depois: "500g Kit 5".
    expect(lerEmbalagem("Café Melitta Torrado E Moído Extra Forte 500g Kit 5", "kg")?.quantidade).toBeCloseTo(2.5);
    // E a peça multiplica quando o título escreve a ligação.
    expect(lerEmbalagem("Café solúvel 10 sachês de 50g", "kg")?.quantidade).toBeCloseTo(0.5);
  });

  it("devolve null quando o título não diz o tamanho", () => {
    expect(lerEmbalagem("Cafeteira Elétrica Mondial Inox")).toBeNull();
  });
});

describe("avaliar — consumível se compara por unidade, não por etiqueta", () => {
  it("aprova o pacote grande e recusa o pequeno que parecia mais barato", () => {
    // O de 500g custa MENOS na etiqueta e MAIS por quilo. É a armadilha inteira.
    const grande = avaliar(CAFE, TETO_KG, oferta("Café Pilão Torrado e Moído 1kg", 52));
    const pequeno = avaliar(CAFE, TETO_KG, oferta("Café Pilão Torrado e Moído 500g", 34));

    expect(grande.aprovado).toBe(true);
    expect(grande.comparavel).toBe(52);
    expect(pequeno.aprovado).toBe(false);
    expect(pequeno.comparavel).toBe(68);
    expect(pequeno.recusa).toMatch(/passa do teto/);
    // A recusa mostra a conta, senão parece que o radar recusou R$ 34 num teto de R$ 60.
    expect(pequeno.recusa).toMatch(/500g/);
  });

  it("o total continua sendo o que se paga", () => {
    const a = avaliar(CAFE, TETO_KG, oferta("Café em grãos 250g", 12, { frete_valor: 3 }));
    expect(a.total).toBe(15);        // o que sai do caixa
    expect(a.comparavel).toBe(60);   // R$ 60/kg, com frete rateado
    expect(a.aprovado).toBe(true);   // exatamente no teto
  });

  it("recusa o que não diz o tamanho — inclusive a cafeteira", () => {
    const a = avaliar(CAFE, TETO_KG, oferta("Cafeteira Elétrica Mondial 30 xícaras", 189));
    expect(a.aprovado).toBe(false);
    expect(a.recusa).toMatch(/tamanho da embalagem/);
  });

  it("recusa quando a embalagem está em OUTRA unidade — e diz qual", () => {
    // Medido numa varredura real: "filtro de café c/ 30 unidades" devolvia 30
    // peças, e dividir o preço por 30 num alvo por quilo dava R$ 0,50/kg —
    // número absurdo recusado pelo motivo errado ("abaixo do piso").
    const a = avaliar(CAFE, TETO_KG, oferta("Filtro de Papel para Café 103 c/ 30 unidades", 9));
    expect(a.aprovado).toBe(false);
    expect(a.recusa).toMatch(/mede em un/);
    expect(a.recusa).toMatch(/teto é por kg/);
    expect(a.comparavel).toBe(a.total); // sem embalagem válida, não se inventa unitário
  });

  it("não confunde memória com peso em alvo de equipamento", () => {
    // A leitura de embalagem nem acorda fora do consumível — "16GB" não é peso.
    const a = avaliar(ALVO, TETO, oferta("Notebook Lenovo i5-1235U 16GB RAM 512GB SSD", 2890));
    expect(a.embalagem).toBeNull();
    expect(a.comparavel).toBe(a.total);
  });
});
