import { describe, it, expect } from "vitest";
import { memoDaObservacao, lerObservacaoTitulo, ehCartao, lerGastoDeCartao } from "./observacaoTitulo";

/* Observações reais do Omie (cache contas_pagar, 05/08/2026) — o formato tem que
   ser lido como está lá, não como seria bonito. */
const PREFIXO = "Conta a Pagar importada automaticamente em 04/08/2026 às 12:51.|";

describe("memoDaObservacao", () => {
  it("descarta o carimbo da importação e devolve o MEMO", () => {
    expect(memoDaObservacao(PREFIXO + "APPLE.COM/BILL                SAO PAULO"))
      .toBe("APPLE.COM/BILL                SAO PAULO");
  });

  it("preserva os espaços do começo — as colunas do MEMO são posicionais", () => {
    const memo = memoDaObservacao(PREFIXO + "DL          *UberRid          Sao Paulo")!;
    expect(memo.startsWith("DL ")).toBe(true);
    expect(memo).toHaveLength("DL          *UberRid          Sao Paulo".length);
  });

  it("observação sem carimbo passa inteira", () => {
    expect(memoDaObservacao("Donos de Hamburgueria (2 parcela)")).toBe("Donos de Hamburgueria (2 parcela)");
  });

  it("vazio e nulo devolvem null", () => {
    expect(memoDaObservacao(null)).toBeNull();
    expect(memoDaObservacao("")).toBeNull();
    expect(memoDaObservacao(PREFIXO)).toBeNull();
    expect(memoDaObservacao(PREFIXO + "    ")).toBeNull();
  });
});

describe("lerObservacaoTitulo", () => {
  it("tira o lojista do meio do carimbo", () => {
    const r = lerObservacaoTitulo(PREFIXO + "APPLE.COM/BILL                SAO PAULO")!;
    expect(r.estabelecimento).toBe("APPLE.COM/BILL");
    expect(r.detalhe).toBe("SAO PAULO");
  });

  /* Aqui vale o nome de EXIBIÇÃO (espaços colapsados), não a chave de
     agrupamento do de-para — que resolveria o adquirente e devolveria só
     "GOOGLE ADS". Na auditoria o que importa é ver o que está escrito no
     título, não a versão normalizada dele. */
  it("mantém o texto do lojista como a fatura escreveu", () => {
    const r = lerObservacaoTitulo(PREFIXO + "DL     *GOOGLE ADS78          SAO PAULO")!;
    expect(r.estabelecimento).toBe("DL *GOOGLE ADS78");
    expect(r.detalhe).toBe("SAO PAULO");
  });

  it("mostra a conversão de câmbio quando a compra é no exterior", () => {
    const r = lerObservacaoTitulo(
      PREFIXO + "OPENAI *CHATGPT SUBS          OPENAI.COM - R$ 525,00    U$ 102,79    V.DOL 5,1075",
    )!;
    expect(r.estabelecimento).toBe("OPENAI *CHATGPT SUBS");
    expect(r.detalhe).toBe("OPENAI.COM · R$ 525,00");
  });

  it("lê a parcela quando a fatura marcou", () => {
    const r = lerObservacaoTitulo(PREFIXO + "HOTEIS.COM            02/06 HOTEIS.COM")!;
    expect(r.parcela).toBe("02/06");
  });

  it("descrição curta do emissor vira o próprio texto", () => {
    const r = lerObservacaoTitulo(PREFIXO + "IOF OPERACAO EXTERIOR")!;
    expect(r.estabelecimento).toBe("IOF OPERACAO EXTERIOR");
    expect(r.parcela).toBeNull();
  });

  it("sem observação não inventa linha", () => {
    expect(lerObservacaoTitulo(null)).toBeNull();
    expect(lerObservacaoTitulo("")).toBeNull();
  });
});

describe("ehCartao", () => {
  it("reconhece as contrapartes-carimbo da fatura", () => {
    expect(ehCartao("Lancamento Fatura Cartao")).toBe(true);
    expect(ehCartao("Lancamento cartão itau")).toBe(true);
    expect(ehCartao("LANÇAMENTO FATURA CARTÃO")).toBe(true);
  });

  it("não confunde com fornecedor de verdade", () => {
    expect(ehCartao("PLENUS SOLUCOES")).toBe(false);
    expect(ehCartao("Cartão de Todos Franquia")).toBe(false); // tem "cartão", não é balde
    expect(ehCartao(null)).toBe(false);
    expect(ehCartao("")).toBe(false);
  });
});

/* A varredura diária guarda a observação de TODA conta a pagar, não só das do
   cartão. Num título comum esse texto é o que o fornecedor escreveu, e lê-lo
   como MEMO (que corta por posição) transformava o começo da frase no nome da
   linha — foi assim que o GETDEMO virou "Link para visualizar a NFS-e:". */
describe("lerGastoDeCartao", () => {
  it("título comum não é lido pela regra do cartão, por mais texto que tenha", () => {
    expect(lerGastoDeCartao(
      "GETDEMO",
      "Link para visualizar a NFS-e: https://www.nfse.gov.br/consulta/12345 - venc. 29/07",
    )).toBeNull();
  });

  it("nem quando a observação por acaso tem o formato do MEMO", () => {
    expect(lerGastoDeCartao("PLENUS SOLUCOES", PREFIXO + "APPLE.COM/BILL                SAO PAULO")).toBeNull();
  });

  it("no balde da fatura vale a observação — é ela que diz qual é o gasto", () => {
    const r = lerGastoDeCartao("Lancamento Fatura Cartao", PREFIXO + "APPLE.COM/BILL                SAO PAULO")!;
    expect(r.estabelecimento).toBe("APPLE.COM/BILL");
    expect(r.detalhe).toBe("SAO PAULO");
  });

  it("cartão sem observação continua null — a tela mostra o que já mostrava", () => {
    expect(lerGastoDeCartao("Lancamento Fatura Cartao", null)).toBeNull();
  });
});
