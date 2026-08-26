import { describe, it, expect } from "vitest";
import {
  chaveDeAcesso, chaveValida, dadosDaChave, descricaoDaNota, lerCorpoDeEmail,
  ehAvisoDeCobranca, lerDanfes, lerNomeDeArquivo, lerXmlFiscal, tipoDoDocumento,
} from "@/lib/notaFiscal";

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

/* ---------------------------------------------------------------------------
 * A NOTA SEM ABRIR O ARQUIVO
 *
 * As chaves daqui são REAIS, copiadas dos arquivos da pasta "0. Gmail" do
 * Drive, e conferidas contra o e-mail que as trouxe: a chave que termina em
 * ...058314 é a NF 130941 da FRACALOSSI (CNPJ 27.250.919/0001-90), e o e-mail
 * dela diz exatamente esse número e esse CNPJ. É essa conferência cruzada que
 * dá confiança no DV — não o algoritmo estar bonito.
 * ------------------------------------------------------------------------- */

const FRACALOSSI = "32260827250919000190550000001309411003058314";
const EXCLUSIVE = "32260836977317000120550010000937351584821609";

describe("chave de acesso", () => {
  it("aceita chave real", () => {
    expect(chaveValida(FRACALOSSI)).toBe(true);
    expect(chaveValida(EXCLUSIVE)).toBe(true);
    expect(chaveValida("32260815056118000109550030000023821082212052")).toBe(true);
  });

  it("recusa 44 dígitos que não são chave", () => {
    // Um dígito trocado no meio: o DV denuncia.
    expect(chaveValida("32260827250919000190550000001309411003058315")).toBe(false);
    expect(chaveValida("00000000026855605451000000404512345678901234")).toBe(false);
    expect(chaveValida("123")).toBe(false);
    expect(chaveValida("")).toBe(false);
  });

  it("acha a chave grudada em outro texto", () => {
    expect(chaveDeAcesso(`2026-08-10_${FRACALOSSI}-nfe.pdf`)).toBe(FRACALOSSI);
    expect(chaveDeAcesso(`DANFE_${FRACALOSSI}_v4.00`)).toBe(FRACALOSSI);
    expect(chaveDeAcesso(`Chave de acesso: ${EXCLUSIVE}`)).toBe(EXCLUSIVE);
  });

  it("não inventa chave onde não há", () => {
    // Nome real de arquivo da pasta, com dois números compridos e nenhuma chave.
    expect(chaveDeAcesso("ESCEFATELBT06_00000000026855605451_0000004045A")).toBeNull();
    expect(chaveDeAcesso("2026-08-03_BOLETO - 4535")).toBeNull();
    expect(chaveDeAcesso(null)).toBeNull();
  });

  it("desmonta a chave em CNPJ, competência e número", () => {
    expect(dadosDaChave(FRACALOSSI)).toEqual({
      cnpj: "27250919000190", competencia: "2026-08", numero: "130941",
    });
    // O e-mail da Exclusive dizia "Número: 000093735" — bate.
    expect(dadosDaChave(EXCLUSIVE)?.numero).toBe("93735");
    expect(dadosDaChave("123")).toBeNull();
  });
});

describe("tipo do documento", () => {
  it("boleto ganha de nota quando os dois nomes aparecem", () => {
    // Nome real: contém "Serviço" e "Boletos". Marcar como nota faria a
    // auditoria dar por resolvido um lançamento que segue sem documento fiscal.
    expect(tipoDoDocumento("Boletos 3x Serviço Os. 1-453 Tekeat App.pdf")).toBe("boleto");
    expect(tipoDoDocumento("2026-08-03_BOLETO - 4535.pdf")).toBe("boleto");
  });

  it("reconhece a nota nas grafias que chegam", () => {
    expect(tipoDoDocumento("notafiscal_998_10418.pdf")).toBe("nota");
    expect(tipoDoDocumento("2026-08-01_DANFE_32260815056118000109550030000023821082212052_v4.00.pdf")).toBe("nota");
    expect(tipoDoDocumento("NFSE Os. 1-453 Tekeat App.pdf")).toBe("nota");
    expect(tipoDoDocumento("NF Kingbier (Chopp HH + Festa junina).pdf")).toBe("nota");
  });

  it("separa recibo e extrato do resto", () => {
    expect(tipoDoDocumento("2026-08-05_Alude_Recibo-Aluguel_Takeat.pdf")).toBe("recibo");
    expect(tipoDoDocumento("99Receipt - 23Jul2026 - R$57,00 - Pop - Vitória.pdf")).toBe("recibo");
    expect(tipoDoDocumento("Cópia de ClientStatements_082426.pdf")).toBe("extrato");
    expect(tipoDoDocumento("2026-08-04_Junho_2026.pdf")).toBe("outro");
  });
});

describe("aviso de cobrança não é o documento", () => {
  /* Assuntos REAIS da caixa financeiro@, das 489 linhas que chegaram sem anexo
     e estavam todas gravadas como tipo_documento='nota'. */
  it("pega o recado sobre a nota", () => {
    expect(ehAvisoDeCobranca("VICTORIA PARTNERS - Aviso de Vencimento do Pix da NFS-e nº 1234")).toBe(true);
    expect(ehAvisoDeCobranca("VICTORIA PARTNERS - Lembrete de Vencimento do Boleto da NFS-e")).toBe(true);
    expect(ehAvisoDeCobranca("Focus NFe - Lembrete de Fatura vencendo hoje")).toBe(true);
    expect(ehAvisoDeCobranca("Focus NFe - Sua fatura mensal com vencimento em 10/08/2026")).toBe(true);
    expect(ehAvisoDeCobranca("Acras Sistemas | Recebemos seu pagamento!")).toBe(true);
    expect(ehAvisoDeCobranca("Seu pagamento foi confirmado - Fatura 867429394")).toBe(true);
    expect(ehAvisoDeCobranca("Sua nota fiscal do Google Ads está pronta")).toBe(true);
    expect(ehAvisoDeCobranca("O boleto da BuzzLead vence hoje")).toBe(true);
    expect(ehAvisoDeCobranca("Financeiro Acras - Fatura com atraso de 5 dias")).toBe(true);
  });

  it("não confunde ENTREGA com recado", () => {
    // Estes trazem (ou tentam trazer) o documento. Se o anexo falhar, ainda é
    // uma nota faltando — e alguém precisa ir atrás.
    expect(ehAvisoDeCobranca("Envio da NFS-e - N.Doc 000035651 - Série 001")).toBe(false);
    expect(ehAvisoDeCobranca("Nota Fiscal Eletrônica")).toBe(false);
    expect(ehAvisoDeCobranca("Sua fatura e nota fiscal")).toBe(false);
    expect(ehAvisoDeCobranca("Nota Fiscal + Boleto Os. 1-0453")).toBe(false);
    expect(ehAvisoDeCobranca("CONFIRMAÇÃO DE FATURAMENTO DO DOCUMENTO 000000230234-NF-001")).toBe(false);
    expect(ehAvisoDeCobranca("")).toBe(false);
    expect(ehAvisoDeCobranca(null)).toBe(false);
  });
});

describe("nome do arquivo", () => {
  it("lê o carimbo de data e a chave — os dois de graça", () => {
    const n = lerNomeDeArquivo(`2026-08-10_${FRACALOSSI}-nfe.pdf`);
    expect(n.data).toBe("2026-08-10");
    expect(n.chave).toBe(FRACALOSSI);
    expect(n.cnpj).toBe("27250919000190");
    expect(n.competencia).toBe("2026-08");   // da chave, não da pasta
    expect(n.tipo).toBe("nota");
  });

  it("aceita o carimbo sem hífen", () => {
    const n = lerNomeDeArquivo("20260817_Takeat - 0003198.pdf");
    expect(n.data).toBe("2026-08-17");
    expect(n.descricao).toBe("Takeat - 0003198");
    expect(n.chave).toBeNull();
  });

  it("pega o valor quando ele está escrito no nome", () => {
    const n = lerNomeDeArquivo("2026-08-05_TAKEAT TECNOLOGIA LTDA; ORION; NFSe; 012888; R$ 870,00.pdf");
    expect(n.data).toBe("2026-08-05");
    expect(n.valor).toBe(870);
    expect(n.tipo).toBe("nota");
    expect(n.descricao).toContain("ORION");
  });

  it("não confunde número de nota com dinheiro", () => {
    // "0003198" é número de nota. Sem o "R$" à frente, não é valor.
    expect(lerNomeDeArquivo("20260817_Takeat - 0003198.pdf").valor).toBeNull();
    expect(lerNomeDeArquivo("2026-08-03_4535 - TAKEAT.pdf").valor).toBeNull();
  });

  it("nome sem carimbo nenhum não quebra", () => {
    const n = lerNomeDeArquivo("verisure.pdf");
    expect(n.data).toBeNull();
    expect(n.descricao).toBe("verisure");
    expect(lerNomeDeArquivo("").descricao).toBeNull();
  });
});

const XML_NFE = `<?xml version="1.0"?>
<nfeProc versao="4.00"><NFe><infNFe Id="NFe${FRACALOSSI}" versao="4.00">
<ide><cUF>32</cUF><nNF>130941</nNF><dhEmi>2026-08-10T10:42:00-03:00</dhEmi></ide>
<emit><CNPJ>27250919000190</CNPJ><xNome>FRACALOSSI MATERIAL ELETRICO LTDA</xNome></emit>
<dest><CNPJ>37511891000150</CNPJ><xNome>TAKEAT TECNOLOGIA LTDA</xNome></dest>
<total><ICMSTot><vProd>2135.74</vProd><vNF>2135.74</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

const XML_NFSE = `<?xml version="1.0"?>
<CompNfse><Nfse><InfNfse><Numero>012888</Numero><DataEmissao>2026-08-05T00:00:00</DataEmissao>
<ValoresNfse><ValorLiquidoNfse>870.00</ValorLiquidoNfse></ValoresNfse>
<PrestadorServico><IdentificacaoPrestador><Cnpj>09.352.984/0001-01</Cnpj></IdentificacaoPrestador>
<RazaoSocial>ORION TELECOM LTDA</RazaoSocial></PrestadorServico>
</InfNfse></Nfse></CompNfse>`;

describe("XML fiscal", () => {
  it("lê a NF-e sem OCR e sem layout", () => {
    const x = lerXmlFiscal(XML_NFE)!;
    expect(x.cnpj).toBe("27250919000190");        // o emitente, não o destinatário
    expect(x.emitente).toBe("FRACALOSSI MATERIAL ELETRICO LTDA");
    expect(x.valor).toBe(2135.74);                 // ponto decimal, não pt-BR
    expect(x.data).toBe("2026-08-10");
    expect(x.chave).toBe(FRACALOSSI);
    expect(x.numero).toBe("130941");
  });

  it("não confunde o destinatário com quem emitiu", () => {
    // Nós somos o `dest`. Ler o CNPJ errado casaria a nota com a Takeat.
    expect(lerXmlFiscal(XML_NFE)!.cnpj).not.toBe("37511891000150");
  });

  it("lê a NFS-e municipal, que não tem padrão nacional", () => {
    const x = lerXmlFiscal(XML_NFSE)!;
    expect(x.cnpj).toBe("09352984000101");
    expect(x.emitente).toBe("ORION TELECOM LTDA");
    expect(x.valor).toBe(870);
    expect(x.data).toBe("2026-08-05");
    expect(x.numero).toBe("012888");
  });

  it("o que não é XML fiscal devolve nulo", () => {
    expect(lerXmlFiscal("<html><body>oi</body></html>")).toBeNull();
    expect(lerXmlFiscal("")).toBeNull();
    expect(lerXmlFiscal(null)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
 * O CORPO DO E-MAIL
 *
 * Todos os textos abaixo são REAIS, copiados da caixa `financeiro@takeat.app`
 * em 25/08/2026. Três deles são de e-mails cuja nota NÃO estava no Drive — a
 * automação que salva anexos tinha parado quinze dias antes, e é exatamente
 * essa a fatia que ler o corpo recupera.
 * ------------------------------------------------------------------------- */

const NOSSO = "37511891000150";

describe("corpo do e-mail", () => {
  it("pega o CNPJ do FORNECEDOR quando o nosso está ao lado", () => {
    // O texto tem os dois CNPJs. Pegar "o primeiro" casaria a nota com a Takeat.
    const c = lerCorpoDeEmail(
      "Fornecedor/Prestador FRACALOSSI MATERIAL ELETRICO LTDA CNPJ: 27.250.919/0001-90 " +
      "Cliente/Tomador TAKEAT TECNOLOGIA LTDA CNPJ: 37.511.891/0001-50 " +
      "Data de emissão: Ago 21 2026 02:49 PM Valor: R$275,80", NOSSO);
    expect(c.cnpj).toBe("27250919000190");
    expect(c.valor).toBe(275.8);
  });

  it("lê número, data e valor da frase corrida", () => {
    const c = lerCorpoDeEmail(
      "Prezado TAKEAT, Segue em anexo a Nota Fiscal nº 000001296, série 1, " +
      "emitida em 20/08/2026, no valor de R$ 797,70.", NOSSO);
    expect(c.numero).toBe("1296");
    expect(c.data).toBe("2026-08-20");
    expect(c.valor).toBe(797.7);
  });

  it("a chave de acesso no corpo entrega o emitente sozinha", () => {
    const c = lerCorpoDeEmail(
      "Seguem dados da NF-e em anexo. Autorizado o uso da NF-e Chave de acesso: " +
      "32260836977317000120550010000937351584821609 Dados da NF-e Número: 000093735 " +
      "Série: 1 Data de Emissão: 21/08/2026", NOSSO);
    expect(c.chave).toBe("32260836977317000120550010000937351584821609");
    expect(c.cnpj).toBe("36977317000120");
    expect(c.data).toBe("2026-08-21");
  });

  it("não confunde vencimento com emissão", () => {
    // O vencimento é outro dia e jogaria a janela do casamento para o mês seguinte.
    const c = lerCorpoDeEmail(
      "identificamos o pagamento de aluguel com vencimento em 20/08/2026. " +
      "Recebemos o pagamento de aluguel + encargos no valor de R$ 1.444,41", NOSSO);
    expect(c.data).toBeNull();
    expect(c.valor).toBe(1444.41);
  });

  it("dólar não é real", () => {
    const c = lerCorpoDeEmail("O valor da fatura é US$ 0,00, com vencimento em 19 de Ago", NOSSO);
    expect(c.valor).toBeNull();
  });

  it("e-mail sem nada fiscal devolve tudo nulo", () => {
    const c = lerCorpoDeEmail("Clarity digest: Your weekly recap for auto.takeat", NOSSO);
    expect(c).toEqual({ chave: null, cnpj: null, valor: null, data: null, numero: null });
    expect(lerCorpoDeEmail(null, NOSSO).cnpj).toBeNull();
  });

  it("só o nosso CNPJ no texto não vira fornecedor", () => {
    const c = lerCorpoDeEmail("TAKEAT TECNOLOGIA LTDA CNPJ 37.511.891/0001-50 segue anexo", NOSSO);
    expect(c.cnpj).toBeNull();
  });
});
