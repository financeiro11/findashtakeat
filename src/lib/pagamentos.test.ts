import { describe, it, expect } from "vitest";
import { conciliarPagamentos, lerEventoPagamento, extrairValor, limparObservacao, descreverTitulo, type TituloOmie } from "./pagamentos";

/**
 * Os casos abaixo são o dia 05/08/2026 de verdade: os eventos são os que a skill
 * gravou em `briefing_diario.agenda` e os títulos são os que `pagamentos_previstos`
 * devolve do cache do Omie. Se a conferência mudar de comportamento, é aqui que
 * aparece — e a comparação com o Omie é o tipo de coisa que não pode "quase" funcionar.
 */
const DIA = "2026-08-05";

const t = (p: Partial<TituloOmie> & { cod_titulo: number; valor: number }): TituloOmie => ({
  vencimento: DIA, fornecedor: null, categoria_descricao: null, status: "VENCE HOJE", ...p,
});

const TITULOS: TituloOmie[] = [
  t({ cod_titulo: 1, fornecedor: "ALUDE TECNOLOGIA", categoria_descricao: "3.1.2.07 Aluguel - Administrativo", valor: 30000 }),
  t({ cod_titulo: 2, fornecedor: "SINGULAR FACILITIES SERVICE S.A.", categoria_descricao: "3.1.2.21 Limpeza - Administrativo", valor: 5031 }),
  t({ cod_titulo: 3, fornecedor: null, categoria_descricao: "3.1.1.10 Pro Labore", valor: 4361 }),
  t({ cod_titulo: 4, fornecedor: "45.228.294 KELVEN SILVA SANTOS", categoria_descricao: "3.2.7.1. Pessoal - Onboarding", valor: 2800 }),
  t({ cod_titulo: 5, fornecedor: "PREF MUN.VITORIA ES", categoria_descricao: "2.6 Parcelamento de Impostos", valor: 1928.11 }),
  t({ cod_titulo: 6, fornecedor: "FLASH APP", categoria_descricao: "3.1.2.6 Confraternizações - Administrativo", valor: 360 }),
  t({ cod_titulo: 7, fornecedor: "36.761.952 VINICIUS MORAES BUTERI", categoria_descricao: "3.1.1.4. Pessoal - Tecnologia", valor: 9500 }),
  // fora do dia, dentro da janela
  t({ cod_titulo: 8, fornecedor: "EDP ESPIRITO SANTO", categoria_descricao: "3.1.2.9 Energia - Administrativo", valor: 3823.95, vencimento: "2026-08-10", status: "A VENCER" }),
];

const conferir = (titulos: string[], omie = TITULOS) =>
  conciliarPagamentos(titulos.map((titulo) => ({ titulo })), omie, DIA);
const por = (c: ReturnType<typeof conferir>, evento: string) => c.itens.find((i) => i.evento === evento)!;

describe("leitura do evento da agenda", () => {
  it("tira o verbo e o valor do rótulo", () => {
    const ev = lerEventoPagamento("Pagar: Pró Labore - R$ 4.361,00");
    expect(ev.rotulo).toBe("Pró Labore");
    expect(ev.valor).toBe(4361);
    expect(ev.tokens).toEqual(["PRO", "LABORE"]);
  });

  it("pega o valor na nota que o briefing junta com ' · '", () => {
    const ev = lerEventoPagamento("Pagar: Kelven - Manutenção · Checkout Nubank, R$ 90,00");
    expect(ev.valor).toBe(90);
    // a nota não vira token: e-mail de Pix e número de NF casariam com qualquer coisa
    expect(ev.tokens).not.toContain("NUBANK");
  });

  it("entende os separadores que o time usa", () => {
    expect(lerEventoPagamento("Pagar: Singular | Limpeza").tokens).toEqual(["SINGULAR", "LIMPEZA"]);
    expect(lerEventoPagamento("Pagar: Aluguel - Sede").tokens).toEqual(["ALUGUEL", "SEDE"]);
  });

  it("extrai valor com e sem centavos", () => {
    expect(extrairValor("R$ 6.000,00")).toBe(6000);
    expect(extrairValor("R$ 90")).toBe(90);
    expect(extrairValor("sem valor")).toBeNull();
  });
});

describe("conferência agenda × Omie", () => {
  it("casa pelo nome do fornecedor", () => {
    const c = conferir(["Pagar: Singular | Limpeza"]);
    expect(por(c, "Pagar: Singular | Limpeza").situacao).toBe("provisionado");
    expect(por(c, "Pagar: Singular | Limpeza").titulos[0].cod_titulo).toBe(2);
  });

  it("casa pela categoria quando a agenda nomeia a despesa e não o fornecedor", () => {
    // "Aluguel" não aparece em "ALUDE TECNOLOGIA" — quem casa é a categoria
    const c = conferir(["Pagar: Aluguel | Sede"]);
    expect(por(c, "Pagar: Aluguel | Sede").situacao).toBe("provisionado");
    expect(por(c, "Pagar: Aluguel | Sede").titulos[0].cod_titulo).toBe(1);
  });

  it("casa por categoria + valor mesmo sem nome de fornecedor no Omie", () => {
    const c = conferir(["Pagar: Pró Labore - R$ 4.361,00"]);
    expect(por(c, "Pagar: Pró Labore - R$ 4.361,00").situacao).toBe("provisionado");
    expect(por(c, "Pagar: Pró Labore - R$ 4.361,00").titulos[0].cod_titulo).toBe(3);
  });

  it("acusa o que não tem título nenhum no Omie", () => {
    const c = conferir(["Reembolsos"]);
    expect(por(c, "Reembolsos").situacao).toBe("ausente");
    expect(c.resumo.naoProvisionados).toBe(1);
    expect(c.alertas).toHaveLength(1);
  });

  it("não promove a provisionado quando o valor da agenda não bate", () => {
    // caso real: agenda pede Kelven R$ 90 (manutenção); o Omie tem Kelven R$ 2.800 (onboarding)
    const c = conferir(["Pagar: Kelven - Manutenção - R$ 90,00"]);
    const i = por(c, "Pagar: Kelven - Manutenção - R$ 90,00");
    expect(i.situacao).toBe("valor_diverge");
    // toLocaleString("pt-BR") separa "R$" do número com espaço fino (U+00A0)
    expect(i.motivo).toMatch(/R\$\s?90,00/);
    // e o título de R$ 2.800 continua contando como "no Omie e fora da agenda"
    expect(c.semAgenda.some((x) => x.cod_titulo === 4)).toBe(true);
  });

  it("nome que só aparece na nota não casa título", () => {
    // "Pagar: Pró Labore · CPF Miguel" não pode casar com o PJ "MIGUEL KNUPP
    // AYRES BARBOZA" da folha — a nota descreve o pagamento, não o fornecedor.
    const c = conferir(["Pagar: Pró Labore - R$ 4.361,00 · CPF Miguel"], [
      t({ cod_titulo: 11, fornecedor: "66.264.256 MIGUEL KNUPP AYRES BARBOZA", categoria_descricao: "3.2.7.2. Pessoal - Suporte", valor: 2200 }),
      TITULOS[2],
    ]);
    const i = por(c, "Pagar: Pró Labore - R$ 4.361,00 · CPF Miguel");
    expect(i.situacao).toBe("provisionado");
    expect(i.titulos.map((x) => x.cod_titulo)).toEqual([3]);
  });

  it("casa pela observação quando o cadastro do título não diz o que é", () => {
    // caso real: a agenda pedia "Donos de Hamburgueria (2ª parcela) - R$ 6.000,00"
    // e o Omie tinha isso lançado como PLENUS SOLUCOES / Eventos e Feiras. Nem o
    // fornecedor nem a categoria identificam — quem identifica é a observação.
    const c = conferir(["Pagar: Donos de Hamburgueria (2ª parcela) - R$ 6.000,00"], [
      t({ cod_titulo: 10, fornecedor: "PLENUS SOLUCOES", categoria_descricao: "3.1.3.8 Eventos e Feiras - Marketing",
          valor: 6000, observacao: "Donos de Hamburgueria (2 parcela)" }),
    ]);
    const i = por(c, "Pagar: Donos de Hamburgueria (2ª parcela) - R$ 6.000,00");
    expect(i.situacao).toBe("provisionado");
    expect(i.titulos[0].cod_titulo).toBe(10);
  });

  it("valor coincidente, sozinho, não vira provisionado", () => {
    // o MESMO título sem observação: R$ 6.000 igual não basta para dizer que é o
    // mesmo pagamento — em dia de folha há vários títulos de valor redondo.
    const c = conferir(["Pagar: Donos de Hamburgueria (2ª parcela) - R$ 6.000,00"], [
      t({ cod_titulo: 10, fornecedor: "PLENUS SOLUCOES", categoria_descricao: "3.1.3.8 Eventos e Feiras - Marketing", valor: 6000 }),
    ]);
    const i = por(c, "Pagar: Donos de Hamburgueria (2ª parcela) - R$ 6.000,00");
    expect(i.situacao).toBe("ausente");
    expect(i.titulos).toHaveLength(0);
  });

  it("limpa o carimbo de importação da observação", () => {
    // a folha de PJ vem toda com "Conta a Pagar importada automaticamente…|Nome"
    const obs = "Conta a Pagar importada automaticamente em 31/07/2026 às 14:17.|Thayrone Panitz Diniz";
    expect(limparObservacao(obs)).toBe("Thayrone Panitz Diniz");

    // e o nome dentro dela casa o evento, mesmo com o fornecedor cadastrado como razão social
    const c = conferir(["Pagar: Thayrone"], [
      t({ cod_titulo: 12, fornecedor: "THAYRONE PANITZ DINIZ LTDA", categoria_descricao: "3.1.1.2. Pessoal - Comercial", valor: 27500, observacao: obs }),
    ]);
    expect(por(c, "Pagar: Thayrone").situacao).toBe("provisionado");
  });

  it("mostra a observação junto de quem recebe", () => {
    expect(descreverTitulo(t({ cod_titulo: 13, fornecedor: "PLENUS SOLUCOES", valor: 6000, observacao: "Donos de Hamburgueria (2 parcela)" })))
      .toBe("PLENUS SOLUCOES — Donos de Hamburgueria (2 parcela)");
  });

  it("avisa quando o título existe mas vence noutro dia", () => {
    const c = conferir(["Pagar: EDP | Sede"]);
    const i = por(c, "Pagar: EDP | Sede");
    expect(i.situacao).toBe("outra_data");
    expect(i.motivo).toContain("10/08");
    expect(c.alertas).toHaveLength(1);
  });

  it("não confronta rotina do time", () => {
    const c = conferir(["Fechamento do Tracker", "Pagamento - Quinto Dia Útil · Checar data"]);
    expect(c.itens.every((i) => i.situacao === "rotina")).toBe(true);
    expect(c.resumo.naAgenda).toBe(0);
    expect(c.alertas).toHaveLength(0);
  });

  it("não casa por pedaço de palavra", () => {
    // "ISS" está dentro de "COMISSAO": casar por substring inventaria provisão
    const c = conferir(["Pagar: Parcelamento ISS"], [
      t({ cod_titulo: 9, fornecedor: "FULANO", categoria_descricao: "3.1.1.5. Comissão - Comercial", valor: 750 }),
    ]);
    expect(por(c, "Pagar: Parcelamento ISS").situacao).toBe("ausente");
  });

  it("casa 'Parcelamento ISS' com a categoria de parcelamento de impostos", () => {
    const c = conferir(["Pagar: Parcelamento ISS"]);
    expect(por(c, "Pagar: Parcelamento ISS").titulos[0].cod_titulo).toBe(5);
  });

  it("tolera plural, mas não radical parecido", () => {
    // "Reembolsos" (agenda) casa "Reembolso:" (observação)…
    const reemb = conferir(["Reembolsos"], [
      t({ cod_titulo: 14, fornecedor: "59.267.956 LUIZA FREITAS PINHEIRO", categoria_descricao: "3.1.3.9 Outros - Marketing",
          valor: 378, observacao: "Reembolso: Conteúdo de Marketing (transporte, alimentação)" }),
    ]);
    expect(por(reemb, "Reembolsos").situacao).toBe("provisionado");

    // …e "Parcelamento" NÃO casa "(2 parcela)" de um título que é outra coisa
    const iss = conferir(["Pagar: Parcelamento ISS"], [
      t({ cod_titulo: 15, fornecedor: "PLENUS SOLUCOES", categoria_descricao: "3.1.3.8 Eventos e Feiras - Marketing",
          valor: 6000, observacao: "Donos de Hamburgueria (2 parcela)" }),
    ]);
    expect(por(iss, "Pagar: Parcelamento ISS").situacao).toBe("ausente");
  });

  it("resume o dia e separa o que está no Omie e não está na agenda", () => {
    const c = conferir([
      "Pagar: Singular | Limpeza",
      "Pagar: Aluguel | Sede",
      "Pagar: Pró Labore - R$ 4.361,00",
      "Reembolsos",
      "Fechamento do Tracker",
    ]);
    expect(c.resumo.naAgenda).toBe(4);          // a rotina não conta
    expect(c.resumo.provisionados).toBe(3);
    expect(c.resumo.naoProvisionados).toBe(1);
    expect(c.resumo.nOmieDia).toBe(7);
    // sobram no Omie: Kelven, Prefeitura, Flash e o PJ de tecnologia
    expect(c.resumo.nSemAgenda).toBe(4);
    expect(c.semAgendaPorCategoria[0].categoria).toContain("Tecnologia");
  });

  it("aguenta dia sem pagamento na agenda", () => {
    const c = conferir([]);
    expect(c.itens).toHaveLength(0);
    expect(c.resumo.nSemAgenda).toBe(7);
    expect(c.alertas).toHaveLength(0);
  });
});
