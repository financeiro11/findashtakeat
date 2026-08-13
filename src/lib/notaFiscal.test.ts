import { describe, it, expect } from "vitest";
import { lerDanfes, descricaoDaNota } from "@/lib/notaFiscal";

/* ---------------------------------------------------------------------------
 * ESTES RECORTES SAÍRAM DO `unpdf`, e isso é o ponto.
 *
 * A primeira versão deste teste usava o texto de OUTRO extrator, e passou com
 * 14 casos verdes enquanto a função em produção lia 37 notas e casava ZERO: o
 * `unpdf` entrega o DANFE numa linha só, com os onze rótulos do quadro de
 * totais antes dos onze números, e ainda gruda alguns deles.
 *
 * Testar parser contra texto que não veio do extrator de produção é testar
 * outra coisa. Os recortes abaixo foram gerados rodando `unpdf` nos PDFs reais
 * (NF_2000017630918484.pdf e NF_compra_2000014180117577.pdf) em 13/08/2026.
 * ------------------------------------------------------------------------- */

const PURE_WATER = `NF-e Nº SÉRIE DATA DE RECEBIMENTO IDENTIFICACAO E ASSINATURA DO RECEBEDOR RECEBEMOS DE PURE WATER COMERCIO DE PECAS, FILTROS E ACESSORIOS PARA PURI OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO Rua Nossa Senhora da Natividade, 92, Nao consta - Piqueri, Sao Paulo, SP - CEP: 02914060 Fone: 1125978384 PURE WATER COMERCIO DE PECAS, FILTROS E DANFE Documento Auxiliar da Nota Fiscal Eletrônica 0: Entrada 1: Saída Nº SÉRIE: Folha CHAVE DE ACESSO Consulta de autenticidade no portal nacional da NF-e 1 3526 0732 6982 8500 0172 5500 2000 0803 0016 4538 5338 NATUREZA DA OPERAÇÃO Venda de mercadoria para consumidor final INSCRIÇÃO ESTADUAL INSC. ESTADUAL DO SUBST. TRIBUTÁRIO CNPJ 123584445111 32.698.285/0001-72 002 000.080.300 000.080.300 002 135263028750 28/07/2026 12:44:35 1 d 1 DATA DA EMISSÃO NOME/RAZÃO SOCIAL TAKEAT TECNOLOGIA LTDA 37.511.891/0001-50 DESTINATÁRIO / REMETENTE Rua Coronel Schwab Filho, 234 29050780 Vitoria 0000000000 ES 084032197 28/07/2026 28/07/2026 12:44:33 BASE DE CÁLCULO DO ICMS VALOR DO ICMS BASE DE CÁLCULO DO ICMS SUBSTITUIÇÃO VALOR DO ICMS SUBSTITUIÇÃO VALOR TOTAL DOS PRODUTOS VALOR DO FRETE VALOR DO SEGURO DESCONTO OUTRAS DESPESAS ACESSÓRIAS VALOR DO IPI VALOR TOTAL DA NOTA 0,00 0,00 0,00 0,00 45,60 0,00 0,00 0,00 0,00 45,600,00 CÁLCULO DO IMPOSTO TRANSPORTADOR/VOLUME RAZÃO SOCIAL Ebazar.com.br LTDA. 03.007.331/0001-41 DADOS DO PRODUTO / SERVIÇOS CÓDIGO DESCRIÇAO DOS PRODUTOS / SERVIÇOS NCM/SH CSOSN CFOP UNID. QTD. VLR UNIT. VALOR TOTAL ICMS IPI ALÍQUOTASB. CALC. ICMS VALOR ICMS IPI VALOR PRODUTO 10210320 PINGADEIRA FR CINZA 39269090 0102 6102 UN 1 30,40 30,40 0,00 0,000,00 0,00 0,00 10210321 TAMPA DA PINGADEIRA FUME FR IBBL 39269090 0102 6102 UN 1 15,20 15,20 0,00 0,000,00 0,00 0,00 INSCRIÇÃO MUNICIPAL CÁLCULO DO ISSQN DADOS ADICIONAIS Valor aproximado dos tributos (IBPT) R$20,28. RESERVADO AO FISCO`;

const DOIS_VENDEDORES = `RECEBEMOS DE MULTIMIX VENDAS ONLINE LTDA OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO Avenida Santiago Rodilha, 1169 - Veloso, Osasco, SP - CEP: 06154000 Fone: 00000000 MULTIMIX VENDAS ONLINE LTDA DANFE Documento Auxiliar da Nota Fiscal Eletrônica CHAVE DE ACESSO 1 3526 0753 7278 1200 0108 5500 2000 0634 2013 3714 0165 INSCRIÇÃO ESTADUAL CNPJ 135691970110 53.727.812/0001-08 000.063.420 002 135262988708 25/07/2026 19:12:32 DATA DA EMISSÃO 37.511.891/0001-50 25/07/2026 VALOR DO IPI VALOR TOTAL DA NOTA 0,00 0,00 0,00 0,00 135,50 0,00 0,00 0,00 0,00 135,500,00 CÁLCULO DO IMPOSTO TRANSPORTADOR/VOLUME EBAZAR.COM.BR LTDA CÓDIGO DESCRIÇAO DOS PRODUTOS / SERVIÇOS NCM/SH CSOSN CFOP UNID. QTD. VLR UNIT. VALOR TOTAL ICMS IPI ALÍQUOTASB. CALC. ICMS VALOR ICMS IPI VALOR PRODUTO V789985036464 5 Conjunto 6 xicaras e pires ceramica 90ml 69120000 0102 6106 pc 1 135,50 135,50 0,00 0,000,00 0,00 0,00 CÁLCULO DO ISSQN DADOS ADICIONAIS Nota fiscal de retorno simbolico n 63419. RESERVADO AO FISCO RECEBEMOS DE DEPOSITO DOS COPOS LTDA OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO Estrada Alberto Hinoto, 7085 - JARDIM NASCENTE, Itaquaquecetuba, SP - CEP: 08586415 Fone: 0011957950466 DEPOSITO DOS COPOS LTDA DANFE CHAVE DE ACESSO 1 3526 0700 7907 5100 0310 5500 2001 1052 5719 7866 2310 INSCRIÇÃO ESTADUAL CNPJ 379422210113 00.790.751/0003-10 001.105.257 002 135262988708 25/07/2026 19:12:33 DATA DA EMISSÃO 37.511.891/0001-50 25/07/2026 VALOR DO IPI VALOR TOTAL DA NOTA 26,00 1,82 0,00 0,00 26,00 0,00 0,00 0,00 0,00 26,000,00 CÁLCULO DO IMPOSTO TRANSPORTADOR/VOLUME CÓDIGO DESCRIÇAO DOS PRODUTOS / SERVIÇOS NCM/SH CST CFOP UNID. QTD. VLR UNIT. VALOR TOTAL ICMS IPI ALÍQUOTASB. CALC. ICMS VALOR ICMS IPI VALOR PRODUTO 9680703 Jogo De Copos De Vidro 6 Pecas Para Agua Suco 255ml Ruvolo 70133700 000 6106 UN 1 26,00 26,00 26,00 1,82 0,00 7,000,00 CÁLCULO DO ISSQN DADOS ADICIONAIS RESERVADO AO FISCO`;

describe("uma nota", () => {
  const [nf] = lerDanfes(PURE_WATER);

  it("acha o vendedor de verdade, não o Mercado Livre", () => {
    expect(nf.emitente).toBe("PURE WATER COMERCIO DE PECAS, FILTROS E ACESSORIOS PARA PURI");
  });

  /* O quadro do `unpdf` vem com os onze rótulos e DEPOIS os onze números, fora
     da ordem dos rótulos — o total sai antes do IPI. Contar posição não serve;
     o total é o maior, porque é a soma dos componentes. */
  it("pega o total mesmo com os números fora da ordem dos rótulos", () => {
    expect(nf.valor).toBe(45.6);
  });

  /* "45,600,00" são DOIS números colados, "45,60" e "0,00". Lido como um só
     daria R$ 45.600 e casaria com nada. */
  it("separa os números que o extrator grudou", () => {
    expect(lerDanfes(PURE_WATER.replace("45,600,00", "45,600,00"))[0].valor).toBe(45.6);
    expect(nf.valor).toBeLessThan(1000);
  });

  it("lê a data de emissão", () => {
    expect(nf.data).toBe("2026-07-28");
  });

  // A página tem três CNPJs em ordem que muda de layout para layout; a chave não.
  it("tira o CNPJ do emitente da chave de acesso", () => {
    expect(nf.chave).toHaveLength(44);
    expect(nf.cnpjEmitente).toBe("32698285000172");
  });

  /* A armadilha que quebrou a primeira versão: o CEP ("02914060") tem cara de
     código de item, e a descrição saía do endereço atravessando o documento
     todo até achar o NCM do primeiro produto. */
  it("não confunde o CEP do endereço com código de produto", () => {
    expect(nf.itens).toEqual(["PINGADEIRA FR CINZA", "TAMPA DA PINGADEIRA FUME FR IBBL"]);
    expect(descricaoDaNota(nf)).not.toContain("Fone");
    expect(descricaoDaNota(nf)).not.toContain("CEP");
  });

  it("monta a frase da linha da DRE", () => {
    expect(descricaoDaNota(nf)).toBe("PINGADEIRA FR CINZA + TAMPA DA PINGADEIRA FUME FR IBBL");
  });
});

describe("dois vendedores no mesmo PDF", () => {
  /* Um pedido do Mercado Livre com dois vendedores gera dois DANFEs no mesmo
     arquivo e UMA cobrança de R$ 161,50 na fatura. Ler como nota única casaria
     um valor que não existe. */
  const notas = lerDanfes(DOIS_VENDEDORES);

  it("quebra por nota", () => {
    expect(notas).toHaveLength(2);
    expect(notas.map((n) => n.emitente)).toEqual([
      "MULTIMIX VENDAS ONLINE LTDA", "DEPOSITO DOS COPOS LTDA",
    ]);
  });

  it("cada nota tem o seu valor, e a soma é o que a fatura cobra", () => {
    expect(notas.map((n) => n.valor)).toEqual([135.5, 26]);
    expect(notas.reduce((s, n) => s + (n.valor ?? 0), 0)).toBe(161.5);
  });

  it("cada nota tem o seu CNPJ", () => {
    expect(notas.map((n) => n.cnpjEmitente)).toEqual(["53727812000108", "00790751000310"]);
  });

  // Aqui o quadro tem ICMS de verdade (26,00 e 1,82), então o "maior do quadro"
  // continua sendo o total e não a base de cálculo.
  it("ICMS preenchido não confunde o total", () => {
    expect(notas[1].valor).toBe(26);
  });

  // A descrição vem partida pelo extrator; o que a delimita é o código à
  // esquerda e a trinca fiscal à direita, não a quebra.
  it("junta a descrição que o extrator partiu", () => {
    expect(notas[1].itens).toEqual(["Jogo De Copos De Vidro 6 Pecas Para Agua Suco 255ml Ruvolo"]);
  });

  it("tira o código do vendedor e o número do item", () => {
    expect(notas[0].itens).toEqual(["Conjunto 6 xicaras e pires ceramica 90ml"]);
  });
});

describe("entrada ruim", () => {
  it("texto vazio não quebra", () => {
    expect(lerDanfes("")).toEqual([]);
    expect(lerDanfes("   ")).toEqual([]);
  });

  // PDF escaneado sai do `unpdf` sem texto útil: é aqui que o chamador cai no
  // OCR em vez de gravar uma nota vazia.
  it("texto sem DANFE devolve nada, para o chamador cair no OCR", () => {
    expect(lerDanfes("uma foto de recibo qualquer")).toEqual([]);
  });

  it("nota sem itens usa o emitente como descrição", () => {
    const [nf] = lerDanfes("RECEBEMOS DE FULANO LTDA OS PRODUTOS CONSTANTES DA NOTA");
    expect(nf.itens).toEqual([]);
    expect(descricaoDaNota(nf)).toBe("FULANO LTDA");
  });
});
