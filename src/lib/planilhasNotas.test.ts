import { describe, expect, it } from "vitest";
import {
  competenciaDe, dizQueAnexou, drivesEm, notasDaPlanilha, ordemDasDatas,
} from "./planilhasNotas";

/* Todas as linhas daqui são REAIS, copiadas do CSV exportado de cada planilha.
   Fixture inventada não teria descoberto nem a data americana do Reembolsos nem
   a linha com dois arquivos na mesma célula. */

describe("ordemDasDatas", () => {
  it("lê dd/mm quando o dia passa de 12 (Compras, NFs, Parceiros)", () => {
    const ler = ordemDasDatas(["30/09/2025 13:23:02", "22/10/2025 16:42:13", "04/04/2026 03:22:54"]);
    expect(ler("30/09/2025 13:23:02")).toBe("2025-09-30");
    expect(ler("04/04/2026 03:22:54")).toBe("2026-04-04");
  });

  it("lê mm/dd quando a evidência do conjunto é americana (Reembolsos)", () => {
    // 316 linhas da planilha real têm o segundo componente > 12.
    const ler = ordemDasDatas(["11/19/2024 12:27:13", "11/27/2025 13:14:41", "01/05/2026 09:00:00"]);
    expect(ler("11/19/2024 12:27:13")).toBe("2024-11-19");
    // A linha ambígua segue a ordem do grupo — não vira 5 de janeiro.
    expect(ler("01/05/2026 09:00:00")).toBe("2026-01-05");
  });

  it("separa as duas safras de Eventos pela hora no carimbo", () => {
    // Com hora é o carimbo automático (americano); sem hora é data digitada à
    // mão numa migração antiga (brasileira). Na planilha real: 327 × 121.
    const ler = ordemDasDatas([
      "12/16/2025 15:00:13", "11/19/2025 10:00:00", // com hora, mm/dd
      "03/12/2024", "25/11/2024",                   // sem hora, dd/mm
    ]);
    expect(ler("12/16/2025 15:00:13")).toBe("2025-12-16");
    expect(ler("03/12/2024")).toBe("2024-12-03");
    expect(ler("25/11/2024")).toBe("2024-11-25");
  });

  it("devolve nulo para o que não é data", () => {
    const ler = ordemDasDatas(["30/09/2025"]);
    expect(ler("")).toBeNull();
    expect(ler("mês que vem")).toBeNull();
    expect(ler("45/13/2026")).toBeNull();
  });
});

describe("competenciaDe", () => {
  it("resolve o mês pelo nome usando o ano do envio", () => {
    expect(competenciaDe("Junho", "2026-06-30")).toBe("2026-06");
    expect(competenciaDe("Abril", "2026-04-28")).toBe("2026-04");
  });

  it("mês maior que o do envio é do ano anterior", () => {
    // Quem manda a nota de dezembro em janeiro está fechando o ano passado.
    expect(competenciaDe("Dezembro", "2026-01-05")).toBe("2025-12");
    expect(competenciaDe("Novembro", "2025-12-16")).toBe("2025-11");
  });

  it("aceita o que já vem pronto", () => {
    expect(competenciaDe("2026-06", null)).toBe("2026-06");
    expect(competenciaDe("2026-6", null)).toBe("2026-06");
    expect(competenciaDe("06/2026", null)).toBe("2026-06");
  });

  it("não inventa competência", () => {
    expect(competenciaDe("", "2026-06-30")).toBeNull();
    expect(competenciaDe("qualquer coisa", "2026-06-30")).toBeNull();
    expect(competenciaDe("Junho", null)).toBeNull();
  });
});

describe("drivesEm", () => {
  it("acha o id em todas as grafias de link", () => {
    expect(drivesEm("https://drive.google.com/open?id=1L0wbQByK4TFEcX5ZRTfCOMRuTQg25rMq"))
      .toEqual(["1L0wbQByK4TFEcX5ZRTfCOMRuTQg25rMq"]);
    expect(drivesEm("https://drive.google.com/file/d/1L0wbQByK4TFEcX5ZRTfCOMRuTQg25rMq/view?usp=sharing"))
      .toEqual(["1L0wbQByK4TFEcX5ZRTfCOMRuTQg25rMq"]);
    expect(drivesEm("veja em https://drive.google.com/uc?export=download&id=1L0wbQByK4TFEcX5ZRTfCOMRuTQg25rMq"))
      .toEqual(["1L0wbQByK4TFEcX5ZRTfCOMRuTQg25rMq"]);
  });

  it("acha os dois arquivos da mesma célula, sem repetir", () => {
    const celula = "https://drive.google.com/open?id=1Z4UIoyyYhzBU26j3XPK_8VSAbUD4kh74, https://drive.google.com/open?id=1q7kiVGnXK9Qm2LO8r3Jvn7TJcQ0J6q5u";
    expect(drivesEm(celula)).toEqual([
      "1Z4UIoyyYhzBU26j3XPK_8VSAbUD4kh74",
      "1q7kiVGnXK9Qm2LO8r3Jvn7TJcQ0J6q5u",
    ]);
    expect(drivesEm(`${celula}, https://drive.google.com/open?id=1Z4UIoyyYhzBU26j3XPK_8VSAbUD4kh74`)).toHaveLength(2);
  });

  it("ignora texto sem link", () => {
    expect(drivesEm("não consegui anexar")).toEqual([]);
    expect(drivesEm(null)).toEqual([]);
  });
});

describe("dizQueAnexou", () => {
  it("reconhece o que a automação escreveu de volta", () => {
    expect(dizQueAnexou("Anexado! ✓ — 08/07/2026 14:02")).toBe(true);
    expect(dizQueAnexou("Lançado e Anexado!!!")).toBe(true);
    // Anexou e tropeçou DEPOIS, na categoria: o anexo aconteceu.
    expect(dizQueAnexou("Lançado e Anexado!!! |  - erro ao parsear resposta IA")).toBe(true);
  });

  it("não confunde promessa com fracasso", () => {
    expect(dizQueAnexou("Aguardando")).toBe(false);
    expect(dizQueAnexou("Erro: CAP não encontrado")).toBe(false);
    expect(dizQueAnexou("REPROVADO | Duplicada")).toBe(false);
    expect(dizQueAnexou("CONFERIR | Falha na leitura da NF (Gemini nao retornou dados)")).toBe(false);
    expect(dizQueAnexou("Atenção: Tomador incorreto")).toBe(false);
    expect(dizQueAnexou("")).toBe(false);
    expect(dizQueAnexou(null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * As cinco planilhas
 * ---------------------------------------------------------------------- */

const CSV_COMPRAS = [
  `Carimbo de data/hora,Nome Completo,Setor,Tipo de Compra,Valor (Apenas números e vírgula),Forma de Pagamento,Número de Parcelas,Valor da Parcela,"Caso tenha sido uma compra online, indique o site em que foi realizada",Descreva aqui a justificativa desta compra. Seja detalhista. ,"Espaço para anexar recibos, invoices, notas fiscais ou qualquer tipo de comprovantes. ",Tarifa`,
  `30/09/2025 13:23:02,Henrique dos Anjos Moura,Financeiro,Equipamentos,"1616,56",Cartão de Crédito,12,"134,71",Kabum,Memórias RAM para o os notebooks do Pessoal,https://drive.google.com/open?id=1jz7x36OqjNnLlhUqAAAAAAAA,`,
  `22/10/2025 16:42:13,Maria Fernandes Araujo,Produto,Consultorias e/ou Cursos,"3239,1",Cartão de Crédito,12,"269,93",PM3,Curso de formação em Product Design,"https://drive.google.com/open?id=1Z4UIoyyYhzBU26j3XPK_8VSAbUD4kh74, https://drive.google.com/open?id=1q7kiVGnXK9Qm2LO8r3Jvn7TJcQ0J6q5u",`,
  `04/04/2026 03:22:54,Thais Lima,Novos Canais,Estadias (Hotel ou Airbnb),"1324,19",PIX,1,"1324,19",Airbnb,Airbnb Evento Fora do Cardápio - Salvador,,`,
].join("\n");

describe("notasDaPlanilha · compras", () => {
  const notas = notasDaPlanilha("compras", CSV_COMPRAS);

  it("ignora a linha sem anexo — pedido não é nota", () => {
    // A terceira linha de dados (Thais Lima) não tem arquivo nenhum.
    expect(notas.map((n) => n.nome)).not.toContain("Thais Lima");
  });

  it("quebra a célula com dois arquivos em duas notas da mesma linha", () => {
    const daMaria = notas.filter((n) => n.nome === "Maria Fernandes Araujo");
    expect(daMaria).toHaveLength(2);
    expect(daMaria.map((n) => n.ordem)).toEqual([1, 2]);
    expect(daMaria[0].linha).toBe(daMaria[1].linha);
    expect(new Set(daMaria.map((n) => n.chave)).size).toBe(2);
  });

  it("guarda o total e a parcela separados, e a forma de pagamento", () => {
    const n = notas[0];
    expect(n.enviadoEm).toBe("2025-09-30");
    expect(n.valor).toBe(1616.56);
    expect(n.valorParcela).toBe(134.71);       // é ela que aparece na fatura
    expect(n.formaPagamento).toBe("Cartão de Crédito");
    expect(n.oQueE).toBe("Equipamentos");
    expect(n.detalhe).toContain("Memórias RAM");
    expect(n.link).toBe("https://drive.google.com/file/d/1jz7x36OqjNnLlhUqAAAAAAAA/view");
  });
});

const CSV_REEMBOLSOS = [
  `Timestamp,Nome completo,Setor,Valor total do reembolso (apenas número e virgula),Status Auto,Motivo do reembolso,Espaço para inserir notas fiscais,Descrição do reembolso,"Espaço para inserir notas, comprovantes, recibos etc",CNPJ`,
  `11/19/2024 12:27:13,Franco,Onboarding,24.92,,Visita a cliente (operacional),https://drive.google.com/open?id=1-N_knQon-F2ecYGvncot9GgWe9mgFdFO,Ida e Volta do GolBurger VIX,,`,
  `11/27/2025 13:14:41,Tarcisio Antonio de Lima,Onboarding,"46,43",Lançado e Anexado!!!,Visita a cliente (operacional),https://drive.google.com/open?id=1VxZLSizG-BW_-v27RjA_7-jgmz39bOsN,Uber do estabelecimento do cliente,https://drive.google.com/open?id=1OUTROARQUIVOxxxxxxxxxx,12.345.678/0001-90`,
].join("\n");

describe("notasDaPlanilha · reembolsos", () => {
  const notas = notasDaPlanilha("reembolsos", CSV_REEMBOLSOS);

  it("lê a data americana do formulário", () => {
    expect(notas[0].enviadoEm).toBe("2024-11-19");
  });

  it("aceita valor com ponto decimal — o formulário recebe de tudo", () => {
    expect(notas[0].valor).toBe(24.92);
    expect(notas.find((n) => n.nome?.startsWith("Tarcisio"))?.valor).toBe(46.43);
  });

  it("junta os arquivos das DUAS colunas de upload", () => {
    const doTarcisio = notas.filter((n) => n.nome?.startsWith("Tarcisio"));
    expect(doTarcisio).toHaveLength(2);
    expect(doTarcisio.map((n) => n.driveId)).toEqual([
      "1VxZLSizG-BW_-v27RjA_7-jgmz39bOsN",
      "1OUTROARQUIVOxxxxxxxxxx",
    ]);
  });

  it("carrega o veredito da automação que já existe", () => {
    const n = notas.find((x) => x.nome?.startsWith("Tarcisio"))!;
    expect(n.statusPlanilha).toBe("Lançado e Anexado!!!");
    expect(n.dizAnexado).toBe(true);
    expect(n.cnpj).toBe("12345678000190");
    expect(notas[0].dizAnexado).toBe(false);
  });
});

const CSV_NFS = [
  `Carimbo de data/hora,Nome completo,Informe o valor exato da sua nota:,Número CNPJ (sem pontos ou traços),Setor,A nota se refere a: ,Mês de competência:,Insira a nota aqui,"Fique a vontade para desabafar, dúvidas, choros e apelos desesperados",Endereço de e-mail,Status Automação `,
  `30/06/2026 10:39:03,Bruno de Souza Bartz,6000,44036792000120,Marketing,Remuneração,Junho,https://drive.google.com/open?id=126i8yKVApx00olEDwx3mViK3FVpV8QyM,,,Anexado! ✓ — 08/07/2026`,
  `28/04/2026 19:03:22,Michael Cardoso Thomé,"R$ 9.500,00",46.148.025/0001-38,Comercial,Remuneração,Abril,https://drive.google.com/open?id=1yXfV1EYkzFxqSMl3UaUKlumPXFvuq4YQ,,,Aguardando`,
].join("\n");

describe("notasDaPlanilha · nfs_colaboradores", () => {
  const notas = notasDaPlanilha("nfs_colaboradores", CSV_NFS);

  it("é a fonte mais limpa: CNPJ em todas as linhas", () => {
    expect(notas[0].cnpj).toBe("44036792000120");
    expect(notas[1].cnpj).toBe("46148025000138");  // com pontuação, mesma coisa
  });

  it("lê o valor com R$ e milhar", () => {
    expect(notas[0].valor).toBe(6000);
    expect(notas[1].valor).toBe(9500);
  });

  it("resolve a competência escrita por extenso", () => {
    expect(notas[0].competencia).toBe("2026-06");
    expect(notas[1].competencia).toBe("2026-04");
    expect(notas[0].oQueE).toBe("Remuneração");
  });

  it("separa quem já foi anexado de quem está na fila", () => {
    expect(notas[0].dizAnexado).toBe(true);
    expect(notas[1].dizAnexado).toBe(false);
  });
});

const CSV_EVENTOS = [
  `Timestamp,Nome da consultoria/Cliente/Garçom,Canal,Valor da NF (apenas número e vírgula),Beneficiário,User do Instagram,Insira aqui a NF (Formato .pdf),Observações (Opcional),Mes de referência,Email Address,CNPJ do Beneficiário`,
  `03/12/2024,João Victor - Gerenciando Docerias,Consultor e Influenciador,"1.200,00",,,https://drive.google.com/open?id=1dD9AfTTPkxmldPI-kYxpkoaos1e8SGU9,,Outubro,,`,
  `12/16/2025 15:00:13,Pedro Henrique Christ,,"800,00",Garçom - Indique e Ganhe,,https://drive.google.com/open?id=1SXYFHds6TbU2tM9jXEFGsWMrPTLKc_H-,PIX para pagamento 34723501000118 Cuer negócios,Novembro,t@x.com,`,
].join("\n");

describe("notasDaPlanilha · eventos", () => {
  const notas = notasDaPlanilha("eventos", CSV_EVENTOS);

  it("aplica a ordem de data certa para cada safra da mesma aba", () => {
    expect(notas[0].enviadoEm).toBe("2024-12-03");   // sem hora, dd/mm
    expect(notas[1].enviadoEm).toBe("2025-12-16");   // com hora, mm/dd
  });

  it("desenterra o CNPJ escrito na observação", () => {
    // Metade dos CNPJs desta planilha não está na coluna de CNPJ.
    expect(notas[1].cnpj).toBe("34723501000118");
    expect(notas[0].cnpj).toBeNull();
  });

  it("resolve a competência para trás quando o mês passou do envio", () => {
    expect(notas[0].competencia).toBe("2024-10");
    expect(notas[1].competencia).toBe("2025-11");
  });
});

const CSV_PARCEIROS = [
  `Carimbo de data/hora,Nome do Parceiro(a),CNPJ,Categoria,Valor (somente números e vírgula),Chave PIX CNPJ,Status Automação,Detalhamento,Envie sua NF,Observações ,Competencia`,
  `10/06/2026 19:17:05,Orgânica Delivery,65568361000184,Consultor ou Influenciador,"R$ 350,00",65568361000184,,,https://drive.google.com/open?id=1L0wbQByK4TFEcX5ZRTfCOMRuTQg25rMq,,`,
  `18/06/2026 18:40:29,Julie Moura Fé,33.973.328/0001-43,Consultor ou Influenciador,"R$ 104,90",47.710.028/0001-86,PAGO! Em 20/08,,https://drive.google.com/open?id=1u__Nyc64mVxiww_YDFIv4xqJPA_t8MVr,,2026-06`,
].join("\n");

describe("notasDaPlanilha · parceiros", () => {
  const notas = notasDaPlanilha("parceiros", CSV_PARCEIROS);

  it("lê CNPJ, valor e categoria", () => {
    expect(notas[0].cnpj).toBe("65568361000184");
    expect(notas[0].valor).toBe(350);
    expect(notas[0].oQueE).toBe("Consultor ou Influenciador");
    expect(notas[0].enviadoEm).toBe("2026-06-10");
  });

  it("guarda a chave PIX à parte quando ela DISCORDA do emitente", () => {
    // Acontece de verdade: NF de um CNPJ, pagamento na chave de outro. É o
    // segundo que casa com o extrato — e por isso os dois são guardados.
    expect(notas[1].cnpj).toBe("33973328000143");
    expect(notas[1].documento).toBe("47710028000186");
    // Quando são iguais, não se repete o mesmo número em duas colunas.
    expect(notas[0].documento).toBeNull();
  });

  it("a competência já vem pronta nesta planilha", () => {
    expect(notas[1].competencia).toBe("2026-06");
    expect(notas[1].statusPlanilha).toBe("PAGO! Em 20/08");
  });
});

describe("notasDaPlanilha · bordas", () => {
  it("planilha vazia não quebra", () => {
    expect(notasDaPlanilha("compras", "")).toEqual([]);
    expect(notasDaPlanilha("compras", "Carimbo de data/hora,Nome Completo")).toEqual([]);
  });

  it("a chave é estável entre rodadas e única por arquivo", () => {
    const a = notasDaPlanilha("parceiros", CSV_PARCEIROS);
    const b = notasDaPlanilha("parceiros", CSV_PARCEIROS);
    expect(a.map((n) => n.chave)).toEqual(b.map((n) => n.chave));
    expect(a[0].chave).toBe("parceiros|2|1L0wbQByK4TFEcX5ZRTfCOMRuTQg25rMq");
  });
});
