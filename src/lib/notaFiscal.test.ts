import { describe, it, expect } from "vitest";
import { lerDanfes, descricaoDaNota } from "@/lib/notaFiscal";

/* Os dois textos abaixo são recortes REAIS, extraídos dos PDFs da pasta de
   comprovantes do Mercado Livre em 13/08/2026 (NF_2000017630918484.pdf e
   NF_compra_2000014180117577.pdf). Reduzi o meio, mas mantive as âncoras e o
   embaralhamento de campos que o extrator de texto produz — é justamente esse
   embaralhamento que quebra parser ingênuo. */

const UMA_NOTA = `NF-e RECEBEMOS DE PURE WATER COMERCIO DE PECAS, FILTROS E ACESSORIOS PARA PURI OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO

DATA DE RECEBIMENTO IDENTIFICACAO E ASSINATURA DO RECEBEDOR

Nº000.080.300 SÉRIE

135263028750 28/07/2026 12:44:35

Nº3526 0732 6982 8500 0172 5500 2000 0803 0016 4538 5338 SÉRIE:

NATUREZA DA OPERAÇÃO Venda de mercadoria para consumidor final

INSCRIÇÃO ESTADUAL INSC. ESTADUAL DO SUBST. TRIBUTÁRIO CNPJ 123584445111 32.698.285/0001-72

DESTINATÁRIO / REMETENTE NOME/RAZÃO TAKEAT SOCIAL TECNOLOGIA LTDA C.N.P.J / C.P.F.

DATA DA EMISSÃO 37.511.891/0001-50

28/07/2026

BASE DE CÁLCULO DO ICMS VALOR DO ICMS BASE DE CÁLCULO DO ICMS SUBSTITUIÇÃO VALOR DO ICMS SUBSTITUIÇÃO VALOR TOTAL DOS PRODUTOS

0,00 0,00 0,00 0,00 45,60

VALOR DO FRETE VALOR DO SEGURO DESCONTO OUTRAS DESPESAS ACESSÓRIAS VALOR DO IPI VALOR TOTAL DA NOTA

0,00 0,00 0,00 0,00 0,00 45,60 TRANSPORTADOR/VOLUME

RAZÃO SOCIAL FRETE POR CONTA CODIGO ANTT PLACA DO VEÍCULO UF CNPJ/CPF Ebazar.com.br LTDA.

CÓDIGO DESCRIÇAO DOS PRODUTOS / SERVIÇOS NCM/SH CSOSN CFOP UNID. QTD. VLR UNIT. VALOR TOTAL B. CALC.

ICMS IPI

10210320 PINGADEIRA FR CINZA 39269090 0102 6102 UN 1 30,40 30,40 0,00 0,00 0,00 0,00 0,00

10210321 TAMPA DA PINGADEIRA FUME FR IBBL 39269090 0102 6102 UN 1 15,20 15,20 0,00 0,00 0,00 0,00 0,00

CÁLCULO DO ISSQN

DADOS ADICIONAIS

Valor aproximado dos tributos (IBPT) R$20,28.`;

const DUAS_NOTAS = `RECEBEMOS DE MULTIMIX VENDAS ONLINE LTDA OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO

000.063.420 002

135262988708 25/07/2026 19:12:32

3526 0753 7278 1200 0108 5500 2000 0634 2013 3714 0165

INSCRIÇÃO ESTADUAL INSC. ESTADUAL DO SUBST. TRIBUTÁRIO CNPJ 135691970110 53.727.812/0001-08

DATA DA EMISSÃO 37.511.891/0001-50

25/07/2026

VALOR DO FRETE VALOR DO SEGURO DESCONTO OUTRAS DESPESAS ACESSÓRIAS VALOR DO IPI VALOR TOTAL DA NOTA

0,00 0,00 0,00 0,00 0,00 135,50 TRANSPORTADOR/VOLUME

CÓDIGO DESCRIÇAO DOS PRODUTOS / SERVIÇOS NCM/SH CSOSN CFOP UNID. QTD. VLR UNIT. VALOR TOTAL B. CALC.

ICMS IPI

V789985036464

5 Conjunto 6 xicaras e pires ceramica 90ml 69120000 0102 6106 pc 1 135,50 135,50 0,00 0,00 0,00 0,00 0,00

CÁLCULO DO ISSQN

DADOS ADICIONAIS

Nota fiscal de retorno simbolico n 63419, emitida em 25/07/2026, serie 2.

MULTIMIX VENDAS ONLINE LTDA

RECEBEMOS DE DEPOSITO DOS COPOS LTDA OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO

001.105.257 002

135262988708 25/07/2026 19:12:33

3526 0700 7907 5100 0310 5500 2001 1052 5719 7866 2310

INSCRIÇÃO ESTADUAL INSC. ESTADUAL DO SUBST. TRIBUTÁRIO CNPJ 379422210113 00.790.751/0003-10

DATA DA EMISSÃO 37.511.891/0001-50

25/07/2026

VALOR DO FRETE VALOR DO SEGURO DESCONTO OUTRAS DESPESAS ACESSÓRIAS VALOR DO IPI VALOR TOTAL DA NOTA

0,00 0,00 0,00 0,00 0,00 26,00 TRANSPORTADOR/VOLUME

CÓDIGO DESCRIÇAO DOS PRODUTOS / SERVIÇOS NCM/SH CST CFOP UNID. QTD. VLR UNIT. VALOR TOTAL B. CALC.

ICMS IPI

9680703 Jogo De Copos De Vidro 6 Pecas Para Agua Suco

255ml Ruvolo 70133700 000 6106 UN 1 26,00 26,00 26,00 1,82 0,00 7,00 0,00

CÁLCULO DO ISSQN

DADOS ADICIONAIS

Valor aproximado dos tributos (IBPT) R$9,19.`;

describe("uma nota", () => {
  const [nf] = lerDanfes(UMA_NOTA);

  it("acha o vendedor de verdade, não o Mercado Livre", () => {
    expect(nf.emitente).toBe("PURE WATER COMERCIO DE PECAS, FILTROS E ACESSORIOS PARA PURI");
  });

  // O total é o ÚLTIMO da fileira de seis; o primeiro é o frete, que é 0,00 e
  // casaria com nada.
  it("pega o total da nota, não o frete", () => {
    expect(nf.valor).toBe(45.6);
  });

  it("lê a data de emissão", () => {
    expect(nf.data).toBe("2026-07-28");
  });

  // A página tem três CNPJs (emitente, destinatário, transportadora) em ordem
  // que muda de layout para layout. A chave de acesso não muda.
  it("tira o CNPJ do emitente da chave de acesso", () => {
    expect(nf.chave).toHaveLength(44);
    expect(nf.cnpjEmitente).toBe("32698285000172");
  });

  it("lista os produtos sem o código interno do vendedor", () => {
    expect(nf.itens).toEqual(["PINGADEIRA FR CINZA", "TAMPA DA PINGADEIRA FUME FR IBBL"]);
  });

  it("monta a frase da linha da DRE", () => {
    expect(descricaoDaNota(nf)).toBe("PINGADEIRA FR CINZA + TAMPA DA PINGADEIRA FUME FR IBBL");
  });
});

describe("duas notas no mesmo PDF", () => {
  // Um pedido do Mercado Livre com dois vendedores gera dois DANFEs no mesmo
  // arquivo. Ler como nota única casaria R$ 161,50, que não existe na fatura.
  const notas = lerDanfes(DUAS_NOTAS);

  it("quebra por nota", () => {
    expect(notas).toHaveLength(2);
    expect(notas.map((n) => n.emitente)).toEqual([
      "MULTIMIX VENDAS ONLINE LTDA", "DEPOSITO DOS COPOS LTDA",
    ]);
  });

  it("cada nota tem o seu valor", () => {
    expect(notas.map((n) => n.valor)).toEqual([135.5, 26]);
  });

  it("cada nota tem o seu CNPJ", () => {
    expect(notas.map((n) => n.cnpjEmitente)).toEqual(["53727812000108", "00790751000310"]);
  });

  // "Jogo De Copos De Vidro 6 Pecas Para Agua Suco\n\n255ml Ruvolo" — a
  // descrição quebra no meio, e é por isso que a âncora é o FIM do item.
  it("junta a descrição que quebrou em duas linhas", () => {
    expect(notas[1].itens).toEqual(["Jogo De Copos De Vidro 6 Pecas Para Agua Suco 255ml Ruvolo"]);
  });

  it("descarta o CSOSN de 4 dígitos e o CST de 3 igualmente", () => {
    expect(notas[0].itens).toEqual(["Conjunto 6 xicaras e pires ceramica 90ml"]);
  });
});

describe("entrada ruim", () => {
  it("texto vazio não quebra", () => {
    expect(lerDanfes("")).toEqual([]);
    expect(lerDanfes("   ")).toEqual([]);
  });

  // PDF escaneado sai do `unpdf` sem texto útil: aqui é onde o fluxo tem de
  // cair para o OCR em vez de gravar uma nota vazia.
  it("texto sem DANFE devolve nada, para o chamador cair no OCR", () => {
    expect(lerDanfes("uma foto de recibo qualquer")).toEqual([]);
  });

  it("nota sem itens usa o emitente como descrição", () => {
    const [nf] = lerDanfes("RECEBEMOS DE FULANO LTDA OS PRODUTOS CONSTANTES DA NOTA");
    expect(nf.itens).toEqual([]);
    expect(descricaoDaNota(nf)).toBe("FULANO LTDA");
  });
});
