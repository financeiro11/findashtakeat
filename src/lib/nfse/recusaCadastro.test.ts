/**
 * O QUE A RECUSA DA PREFEITURA AUTORIZA A MÁQUINA A CONSERTAR.
 *
 * Este teste prende uma ESCRITA EM CADASTRO DE TERCEIRO num sistema fiscal.
 * Errar para o lado frouxo não dá tela torta: dá nota recusada com carimbo de
 * "consertado" — a linha sai de "precisa de você", ninguém mais olha, e o
 * cliente fica sem nota. É o mesmo falso verde que a trava do CEP de 09/09/2026
 * existe para matar.
 *
 * As mensagens aqui são as REAIS, lidas de `nf_os_omie.nfse_mensagem` em
 * 12/09/2026, e os telefones são os que de fato estão no espelho do Asaas dos
 * dois clientes recusados por E1235.
 */

import { describe, expect, it } from "vitest";
import {
  camposAcusados, telefoneBR, telefonePlausivel, telefoneQueSubstitui,
} from "../../../supabase/functions/_shared/recusa-cadastro";

/* A recusa de telefone, como a prefeitura a escreveu (OS 3709 e 2188). */
const E1235 = "E1235 : Atenção: O campo 'http://www.sped.fazenda.gov.br/nfse:fone' foi "
  + "preenchido com um valor inválido ou deixado em branco. Verifique a informação digitada "
  + "e tente novamente.";
const E1235_CURTO = "E1235 : Falha no esquema XML do DF-e.";
const E0240 = "E0240 : O CEP informado para o endereço nacional do tomador do serviço não "
  + "existe ou não pertence ao município do endereço do tomador.";

describe("camposAcusados — a prefeitura diz qual campo recusou", () => {
  it("E1235 acusa o telefone", () => {
    expect([...camposAcusados(E1235)]).toEqual(["telefone"]);
  });

  /* A segunda variante do E1235 não tem a palavra "telefone" em lugar nenhum —
     só o código e "falha no esquema". É por ela que o código entra na régua
     junto com o texto: quem casasse só por palavra perderia esta. */
  it("E1235 sem a palavra 'telefone' também acusa, pelo código", () => {
    expect(camposAcusados(E1235_CURTO).has("telefone")).toBe(true);
  });

  it("E0921/E0922 acusam o código do município", () => {
    expect([...camposAcusados("E0921 : Código do município inválido")]).toEqual(["cidade_ibge"]);
    expect(camposAcusados("E0922 : algo").has("cidade_ibge")).toBe(true);
  });

  /* O E0240 diz "não existe OU não pertence ao município". Com o CEP existindo
     nos Correios, o que sobra é a incoerência CEP↔município — e quem a conserta
     é o código do município, não reescrever o mesmo CEP sobre si mesmo. */
  it("E0240 acusa o código do município, e NÃO o CEP", () => {
    const a = camposAcusados(E0240);
    expect(a.has("cidade_ibge")).toBe(true);
    expect([...a]).toEqual(["cidade_ibge"]);
  });

  /* SEM RECUSA, NADA É AUTORIZADO. É o caso do pré-voo, que age antes de existir
     recusa: ali ninguém afirmou que algum valor preenchido está errado, e a
     regra "só sobre campo vazio" continua sendo a única. */
  it("sem mensagem não autoriza campo nenhum", () => {
    expect(camposAcusados(null).size).toBe(0);
    expect(camposAcusados(undefined).size).toBe(0);
    expect(camposAcusados("").size).toBe(0);
  });

  it("recusa de endereço não autoriza mexer no telefone", () => {
    expect(camposAcusados("Para emitir a NFS-e falta preencher o Número do Endereço").size).toBe(0);
    expect(camposAcusados("E0207 : CPF não consta na base da Receita").size).toBe(0);
  });

  it("a instabilidade da prefeitura não acusa cadastro nenhum", () => {
    const m = 'A prefeitura respondeu "502 - Web server received an invalid response while '
      + 'acting as a gateway or proxy server." (recusa do webservice, não crítica da nota).';
    expect(camposAcusados(m).size).toBe(0);
    expect(camposAcusados("Falha no processamento da NFS-e por indisponibilidade na NFS-e Nacional.").size).toBe(0);
  });
});

describe("telefonePlausivel — contagem certa não é telefone", () => {
  /* O CASO QUE MOTIVOU A FUNÇÃO. Os dois clientes recusados por E1235 têm
     "0000000000" no Asaas: dez dígitos, aprovado por `telefoneBR`, e um número
     que não existe. Escrevê-lo no Omie produziria a mesma recusa com carimbo de
     consertado. */
  it("rejeita o preenchimento 0000000000 que o Asaas guarda", () => {
    expect(telefoneBR("0000000000")).not.toBeNull();      // passa no tamanho…
    expect(telefonePlausivel("0000000000")).toBeNull();    // …e não é telefone
  });

  it("rejeita qualquer dígito repetido de ponta a ponta", () => {
    for (const n of ["0000000000", "11111111111", "9999999999", "99999999999"]) {
      expect(telefonePlausivel(n), n).toBeNull();
    }
  });

  it("rejeita DDD que não existe", () => {
    for (const n of ["0027998814130", "0198814130", "1098814130", "0198814130"]) {
      expect(telefonePlausivel(n), n).toBeNull();
    }
  });

  it("aceita celular de nove dígitos começando em 9", () => {
    expect(telefonePlausivel("27998814130")).toEqual({ ddd: "27", numero: "998814130" });
    expect(telefonePlausivel("(11) 91234-5678")).toEqual({ ddd: "11", numero: "912345678" });
  });

  /* A nona virou obrigatória em todo o país em 2016: nove dígitos que não
     começam em 9 é número montado errado, não celular antigo. */
  it("rejeita nove dígitos que não começam em 9", () => {
    expect(telefonePlausivel("27898814130")).toBeNull();
  });

  it("aceita fixo de oito dígitos começando de 2 a 5", () => {
    expect(telefonePlausivel("2733251020")).toEqual({ ddd: "27", numero: "33251020" });
    expect(telefonePlausivel("1125551234")).toEqual({ ddd: "11", numero: "25551234" });
  });

  it("rejeita oito dígitos fora da faixa de fixo", () => {
    for (const n of ["2798814130", "2718814130", "2768814130"]) {
      expect(telefonePlausivel(n), n).toBeNull();
    }
  });

  it("vazio, curto e comprido são nada", () => {
    for (const n of ["", null, undefined, "998814130", "279988141301"]) {
      expect(telefonePlausivel(n as unknown), String(n)).toBeNull();
    }
  });
});

describe("telefoneQueSubstitui — o que escrever no lugar do recusado", () => {
  const nada: Array<{ de: string; valor: unknown }> = [];

  /* O CONSERTO MAIS BARATO E O MAIS COMUM: os onze dígitos inteiros dentro de
     `telefone1_numero`, com o DDD vazio. Formalmente preenchido, materialmente
     um telefone que o esquema da NFS-e recusa — e o conserto não precisa de
     informação nova de ninguém. */
  it("reagrupa os próprios dígitos quando o DDD está no campo errado", () => {
    const r = telefoneQueSubstitui({ telefone1_ddd: "", telefone1_numero: "27998814130" }, nada);
    expect(r).toEqual({
      ddd: "27", numero: "998814130",
      de: "os mesmos dígitos, com o DDD no campo certo",
    });
  });

  it("não reescreve o que já está certo", () => {
    const r = telefoneQueSubstitui(
      { telefone1_ddd: "27", telefone1_numero: "998814130" },
      [{ de: "asaas", valor: "27998814130" }],
    );
    expect(r).toBeNull();
  });

  it("cai para a primeira fonte externa plausível, na ordem dada", () => {
    const r = telefoneQueSubstitui(
      { telefone1_ddd: "00", telefone1_numero: "00000000" },
      [
        { de: "cadastro federal", valor: "0000000000" },   // implausível: pula
        { de: "asaas", valor: "2733251020" },
      ],
    );
    expect(r).toEqual({ ddd: "27", numero: "33251020", de: "asaas" });
  });

  /* O DESFECHO QUE IMPORTA MAIS. Sem substituto plausível, devolve null — e
     quem chama transforma isso em "peça o telefone ao cliente", que é uma
     frase. O erro a evitar é escrever qualquer coisa e carimbar consertado. */
  it("devolve null quando nenhum candidato é plausível — inclusive o próprio", () => {
    const r = telefoneQueSubstitui(
      { telefone1_ddd: "00", telefone1_numero: "00000000" },
      [
        { de: "cadastro federal", valor: "" },
        { de: "asaas", valor: "0000000000" },
      ],
    );
    expect(r).toBeNull();
  });

  it("campo em branco no ERP também é atendido pelas fontes externas", () => {
    const r = telefoneQueSubstitui(
      { telefone1_ddd: null, telefone1_numero: null },
      [{ de: "asaas", valor: "27998814130" }],
    );
    expect(r).toEqual({ ddd: "27", numero: "998814130", de: "asaas" });
  });

  it("cadastro nulo não quebra — devolve o primeiro candidato plausível", () => {
    expect(telefoneQueSubstitui(null, [{ de: "asaas", valor: "27998814130" }]))
      .toEqual({ ddd: "27", numero: "998814130", de: "asaas" });
    expect(telefoneQueSubstitui(null, nada)).toBeNull();
  });
});
