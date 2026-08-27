import { describe, it, expect } from "vitest";
import { desde, faltam, lerCron, proximoDisparo } from "@/lib/cronProximo";

/* Tudo em UTC de propósito: é o fuso em que o pg_cron do Supabase agenda, e
   ler "40 12 * * *" como horário de Brasília mostraria "faltam 3 horas" para
   algo que já rodou. */
const utc = (s: string) => new Date(`${s}Z`);

describe("lerCron", () => {
  it("aceita os formatos que os crons do Hub usam", () => {
    expect(lerCron("5,13,20,28,35,43,50,58 * * * *")?.minutos.size).toBe(8);
    expect(lerCron("*/5 * * * *")?.minutos.size).toBe(12);
    expect(lerCron("0 12 5 * *")?.dias.has(5)).toBe(true);
    expect(lerCron("40 8 * * 1")?.semana.has(1)).toBe(true);
  });

  it("recusa o que não sabe ler, em vez de inventar", () => {
    expect(lerCron("* * * *")).toBeNull();          // faltou um campo
    expect(lerCron("99 * * * *")).toBeNull();       // minuto fora da faixa
    expect(lerCron("")).toBeNull();
    expect(lerCron("abc * * * *")).toBeNull();
  });

  it("domingo vale 0 e 7", () => {
    expect(lerCron("0 0 * * 7")?.semana.has(0)).toBe(true);
  });
});

describe("proximoDisparo", () => {
  it("acha o próximo minuto da lista", () => {
    // Envio ao Omie: 5,13,20,28,35,43,50,58
    const p = proximoDisparo("5,13,20,28,35,43,50,58 * * * *", utc("2026-08-27T10:41:30"));
    expect(p?.toISOString()).toBe("2026-08-27T10:43:00.000Z");
  });

  it("vira a hora quando não há mais minuto no restante dela", () => {
    const p = proximoDisparo("5,13,20,28,35,43,50,58 * * * *", utc("2026-08-27T10:58:10"));
    expect(p?.toISOString()).toBe("2026-08-27T11:05:00.000Z");
  });

  /* O disparo é no minuto CHEIO: às 10:30:00 em ponto o próximo é 11:00, não
     "agora de novo" — senão a faixa mostraria "agora" por sessenta segundos. */
  it("não repete o minuto em que já está", () => {
    const p = proximoDisparo("0,30 * * * *", utc("2026-08-27T10:30:00"));
    expect(p?.toISOString()).toBe("2026-08-27T11:00:00.000Z");
  });

  it("vira o dia num cron diário", () => {
    const p = proximoDisparo("40 12 * * *", utc("2026-08-27T13:00:00"));
    expect(p?.toISOString()).toBe("2026-08-28T12:40:00.000Z");
  });

  it("acha o dia 5 do mês que vem", () => {
    const p = proximoDisparo("0 12 5 * *", utc("2026-08-27T10:00:00"));
    expect(p?.toISOString()).toBe("2026-09-05T12:00:00.000Z");
  });

  it("acha a próxima segunda-feira", () => {
    // 27/08/2026 é uma quinta.
    const p = proximoDisparo("40 8 * * 1", utc("2026-08-27T10:00:00"));
    expect(p?.getUTCDay()).toBe(1);
    expect(p?.toISOString()).toBe("2026-08-31T08:40:00.000Z");
  });

  it("cron de várias horas por dia", () => {
    // Emissão de NF: 0,10,20,30,40,50 nas horas 13,14,15
    const p = proximoDisparo("0,10,20,30,40,50 13,14,15 * * *", utc("2026-08-27T15:51:00"));
    expect(p?.toISOString()).toBe("2026-08-28T13:00:00.000Z");
  });

  it("expressão que não dá para ler devolve nulo, não um horário qualquer", () => {
    expect(proximoDisparo("nonsense", utc("2026-08-27T10:00:00"))).toBeNull();
  });
});

describe("faltam", () => {
  const agora = utc("2026-08-27T10:00:00");

  /* Segundos só abaixo de dez minutos: acima disso eles piscam sem informar, e
     número que muda o tempo todo cansa quem só quer saber se é "já". */
  it("mostra segundos só quando falta pouco", () => {
    expect(faltam(utc("2026-08-27T10:03:12"), agora)).toBe("3m12s");
    expect(faltam(utc("2026-08-27T10:00:45"), agora)).toBe("45s");
    expect(faltam(utc("2026-08-27T10:25:00"), agora)).toBe("25min");
    expect(faltam(utc("2026-08-27T12:04:00"), agora)).toBe("2h04");
    expect(faltam(utc("2026-08-28T10:00:00"), agora)).toBe("amanhã");
    expect(faltam(utc("2026-08-30T10:00:00"), agora)).toBe("3 dias");
  });

  it("já passou vira 'agora'", () => {
    expect(faltam(utc("2026-08-27T09:59:00"), agora)).toBe("agora");
    expect(faltam(null, agora)).toBe("—");
  });
});

describe("desde", () => {
  const agora = utc("2026-08-27T10:00:00");
  it("conta para trás", () => {
    expect(desde(utc("2026-08-27T09:57:00").toISOString(), agora)).toBe("há 3min");
    expect(desde(utc("2026-08-27T08:00:00").toISOString(), agora)).toBe("há 2h");
    expect(desde(utc("2026-08-26T10:00:00").toISOString(), agora)).toBe("ontem");
    expect(desde(null, agora)).toBe("nunca");
  });
});
