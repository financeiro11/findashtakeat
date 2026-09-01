import { describe, it, expect } from "vitest";
import {
  descricaoEmTexto, extrairValor, lerEvento, montarRotulo,
} from "../../../supabase/functions/_shared/agenda-parse";

/**
 * Eventos REAIS da agenda de financeiro@takeat.app (agosto/2026), copiados da
 * resposta da API. São eles que definem o que a leitura precisa acertar — e cada
 * um está aqui porque representa um formato diferente de escrever a mesma coisa:
 * valor no título, valor na descrição, valor dentro de parênteses, descrição em
 * HTML, evento com hora (que não é pagamento) e recorrência arrastada de dia.
 */
const ALUGUEL = {
  id: "5gaqb6cmgjqj8tguual859vdlc_20260820",
  summary: "Aluguel | Sala Centro",
  description: "R$ 1444",
  start: { date: "2026-08-20" },
  htmlLink: "https://www.google.com/calendar/event?eid=x",
};
const PRO_LABORE = {
  id: "0c4jnknuvmrodb19m7ungsod9i_20260805",
  summary: "Pró Labore",
  description: "CPF Miguel: \nR$ 4.361,00",
  // Arrastada: a instância era do dia 5 e foi movida para o 6.
  originalStartTime: { date: "2026-08-05" },
  start: { date: "2026-08-06" },
};
const NOTA_DO_FORMULARIO = {
  id: "s44870ie5quobqic1pdm5pc2ms",
  summary: "Donos de Hamburgueria (2 parcela)",
  description:
    "Valor NF: R$6000,00\n\nLink NF PDF: \nhttps://drive.google.com/uc?export=download&id=1D2B\n\n" +
    "Data pagamento:\n2026-08-05\n\nMês referência:\njulho\n\nObservações:\nChave Pix: mentoria@gmail.com",
  start: { date: "2026-08-06" },
  colorId: "4",
};
const MONBEE = {
  id: "0c19td1dnmm6lmfr434pak9fh5_20260815",
  summary: "Monbee - R$ 250,00",
  description: "CNPJ: 18393904000190\nAcordo ExtraJudicial",
  start: { date: "2026-08-17" },
};
const BALTAZAR = {
  id: "2nes5b2dc3am144lnh751ik1fo",
  summary: "Baltazar - Parcela 2 (R$ 4035,28)",
  start: { date: "2026-08-17" },
};
const ALGAR_HTML = {
  id: "172p1hn6cfc62kdqtb9al6it5m_20260820",
  summary: "Algar | Internet Sede",
  description:
    '<a href="https://customeridentity.algar.com.br/auth?client_id=0d86&amp;state=123">Fatura aqui</a>',
  start: { date: "2026-08-20" },
};
const REUNIAO = {
  id: "3hudsk2mfgkfdnecqajdr9hmus_20260824T170000Z",
  summary: "Reunião Financeiro I Estratégico + One-a-One",
  start: { dateTime: "2026-08-24T14:00:00-03:00", timeZone: "America/Sao_Paulo" },
};
const ISS = {
  id: "1q444tir7p7fif8bs8c0l3fdcj_20260820",
  summary: "ISS",
  start: { date: "2026-08-20" },
};

describe("extrairValor — os formatos que a agenda usa de verdade", () => {
  it("lê valor com e sem separador de milhar, com e sem espaço", () => {
    expect(extrairValor("R$ 4.361,00")).toBe(4361);
    expect(extrairValor("Valor NF: R$6000,00")).toBe(6000);
    expect(extrairValor("R$ 1444")).toBe(1444);
    expect(extrairValor("(R$ 4035,28)")).toBe(4035.28);
    expect(extrairValor("R$ 7.142,85")).toBe(7142.85);
  });

  it("não inventa valor onde não há", () => {
    expect(extrairValor("ISS")).toBeNull();
    expect(extrairValor("")).toBeNull();
    expect(extrairValor("CNPJ: 18393904000190")).toBeNull();
  });
});

describe("lerEvento — dia e classificação", () => {
  it("evento de dia inteiro é pagamento", () => {
    const e = lerEvento(ISS)!;
    expect(e.dia).toBe("2026-08-20");
    expect(e.diaInteiro).toBe(true);
    expect(e.ehPagamento).toBe(true);
  });

  it("evento com hora não é pagamento — e reunião cai fora sozinha", () => {
    const e = lerEvento(REUNIAO)!;
    expect(e.diaInteiro).toBe(false);
    expect(e.ehPagamento).toBe(false);
    expect(e.dia).toBe("2026-08-24");
  });

  it("o filtro de 'não é pagamento' enxerga através do acento", () => {
    // Sem tirar o acento, "Férias" em NFD ("Fe" + ́ + "rias") não bate com
    // /ferias/ e o evento passaria como pagamento.
    const ferias = { id: "x", summary: "Férias Júlia", start: { date: "2026-09-10" } };
    const anivers = { id: "y", summary: "Aniversário Henrique", start: { date: "2026-09-11" } };
    expect(lerEvento(ferias)!.ehPagamento).toBe(false);
    expect(lerEvento(anivers)!.ehPagamento).toBe(false);
  });

  it("o rótulo não guarda espaço não-quebrável — a busca do quadro depende disso", () => {
    expect(lerEvento(ALUGUEL)!.rotulo).not.toContain(" ");
    expect(lerEvento(ALUGUEL)!.rotulo).toContain("R$ 1.444,00");
  });

  it("a instância arrastada vale pelo dia para onde foi, não pelo original", () => {
    // "Pró Labore" tem originalStartTime dia 5 e start dia 6: quem paga, paga no 6.
    expect(lerEvento(PRO_LABORE)!.dia).toBe("2026-08-06");
  });

  it("o id guardado é o da INSTÂNCIA, que é o que tem data", () => {
    expect(lerEvento(ALUGUEL)!.eventId).toBe("5gaqb6cmgjqj8tguual859vdlc_20260820");
  });
});

describe("lerEvento — de onde sai o valor", () => {
  it("acha o valor escondido na descrição", () => {
    expect(lerEvento(ALUGUEL)!.valor).toBe(1444);
    expect(lerEvento(PRO_LABORE)!.valor).toBe(4361);
    expect(lerEvento(NOTA_DO_FORMULARIO)!.valor).toBe(6000);
  });

  it("o título ganha do texto da descrição quando os dois têm valor", () => {
    expect(lerEvento(MONBEE)!.valor).toBe(250);
  });

  it("valor entre parênteses no título conta", () => {
    expect(lerEvento(BALTAZAR)!.valor).toBe(4035.28);
  });
});

describe("montarRotulo — o que vira subtarefa", () => {
  it("acrescenta o valor quando o título não o traz", () => {
    expect(lerEvento(ALUGUEL)!.rotulo).toBe("Aluguel | Sala Centro — R$ 1.444,00");
    expect(lerEvento(NOTA_DO_FORMULARIO)!.rotulo)
      .toBe("Donos de Hamburgueria (2 parcela) — R$ 6.000,00");
  });

  it("não repete o valor que o título já mostra", () => {
    expect(lerEvento(MONBEE)!.rotulo).toBe("Monbee - R$ 250,00");
    expect(lerEvento(BALTAZAR)!.rotulo).toBe("Baltazar - Parcela 2 (R$ 4035,28)");
  });

  it("sem valor, o rótulo é o título limpo", () => {
    expect(lerEvento(ISS)!.rotulo).toBe("ISS");
    expect(montarRotulo("  ISS  ", null)).toBe("ISS");
  });
});

describe("descricaoEmTexto", () => {
  it("tira as tags e devolve as entidades ao normal", () => {
    const t = lerEvento(ALGAR_HTML)!.descricao;
    expect(t).toContain("Fatura aqui");
    expect(t).not.toContain("<a href");
    expect(t).not.toContain("&amp;");
  });

  it("quebra de linha do <br> vira quebra de verdade", () => {
    expect(descricaoEmTexto("um<br>dois")).toBe("um\ndois");
  });
});
