import { describe, expect, it } from "vitest";
import {
  DA_ESTEIRA, ESTEIRA_NOTAS, O_QUE_FAZ, falhou, situacao, type Automacao,
} from "./automacoes";

const base: Automacao = {
  jobname: "x", schedule: "*/5 * * * *", ativo: true, alvo: "x", chama_funcao: true,
  ultimo_em: "2026-08-27T12:00:00Z", status_http: 200, resposta: "{}", aguardando: false,
  status_sql: "succeeded", erro_sql: null, falhas_24h: 0, execucoes_24h: 12,
};
const com = (p: Partial<Automacao>): Automacao => ({ ...base, ...p });

describe("falhou", () => {
  it("a resposta HTTP manda quando existe", () => {
    expect(falhou(com({ status_http: 500 }))).toBe(true);
    expect(falhou(com({ status_http: 200 }))).toBe(false);
  });

  it("HTTP 500 vence o `succeeded` do job_run_details", () => {
    // O caso `omie-cartao-nome`: o cron enfileirou o POST (SQL "succeeded") e a
    // função respondeu 500 por dias. Perguntar ao SQL primeiro pintaria de verde.
    expect(falhou(com({ status_http: 500, status_sql: "succeeded" }))).toBe(true);
  });

  it("quem chama função e ainda não teve resposta colhida não é falha", () => {
    expect(falhou(com({ status_http: null, aguardando: true, status_sql: "failed" }))).toBe(false);
  });

  it("cron de SQL puro responde pelo job_run_details", () => {
    expect(falhou(com({ chama_funcao: false, status_http: null, status_sql: "failed" }))).toBe(true);
    expect(falhou(com({ chama_funcao: false, status_http: null, status_sql: "succeeded" }))).toBe(false);
  });

  it("desligada não é falha", () => {
    expect(falhou(com({ ativo: false, status_http: 500 }))).toBe(false);
  });
});

describe("situacao", () => {
  it("sem execução guardada não é falha — o histórico dura 7 dias", () => {
    // Um cron mensal passa a maior parte do tempo assim.
    expect(situacao(com({ ultimo_em: null, status_http: null }))).toBe("sem_registro");
  });

  it("disparou e ainda não colheu", () => {
    expect(situacao(com({ status_http: null, aguardando: true }))).toBe("esperando");
  });

  it("desfecho colhido sem status HTTP não é verde", () => {
    // pg_net desistiu de esperar ("Timeout of 5000 ms reached") ou a resposta
    // expirou antes da colheita: o disparo saiu e ninguém viu o 2xx. Dizer "deu
    // certo" aqui é exatamente a mentira que este painel existe para evitar.
    expect(situacao(com({ status_http: null, aguardando: false, resposta: "Timeout of 5000 ms reached" })))
      .toBe("sem_resposta");
    // E o cron que ainda não passa por `disparar_automacao` cai no mesmo lugar:
    // só o `job_run_details` sabe dele, e ele considera sucesso o simples disparo.
    expect(situacao(com({ status_http: null, aguardando: false, resposta: "" }))).toBe("sem_resposta");
  });

  it("cron de SQL puro que deu certo é verde", () => {
    expect(situacao(com({ chama_funcao: false, status_http: null }))).toBe("ok");
  });

  it("os demais estados", () => {
    expect(situacao(com({}))).toBe("ok");
    expect(situacao(com({ status_http: 401 }))).toBe("falha");
    expect(situacao(com({ ativo: false }))).toBe("desligada");
  });
});

describe("esteira das notas", () => {
  it("nenhum cron aparece em duas etapas", () => {
    const todos = ESTEIRA_NOTAS.flatMap((e) => e.jobs);
    expect(todos.length).toBe(new Set(todos).size);
  });

  it("o conjunto de marcação cobre exatamente as etapas", () => {
    expect(DA_ESTEIRA.size).toBe(ESTEIRA_NOTAS.flatMap((e) => e.jobs).length);
  });

  it("toda automação da esteira diz o que faz — é o ponto da tela", () => {
    for (const j of DA_ESTEIRA) expect(O_QUE_FAZ[j], j).toBeTruthy();
  });
});
