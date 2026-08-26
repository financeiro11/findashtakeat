import { describe, it, expect } from "vitest";
import {
  lerSpecs, avaliar, classificar, pisoDePreco, condicaoDoTitulo, textoWhats, resumoDoAlvo,
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

  it("recusa acima do teto", () => {
    const r = avaliar(ALVO, TETO, oferta("Notebook Lenovo i5 16GB RAM 512GB SSD", 3400));
    expect(r.aprovado).toBe(false);
    expect(r.recusa).toMatch(/teto/i);
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
      reputacao: 0.9, frete_gratis: true, vendas: 300, condicao: "novo",
    }));
    expect(r.aprovado).toBe(true);
    expect(r.recusa).toBeNull();
    expect(r.motivos.join(" ")).toMatch(/abaixo do teto/);
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
