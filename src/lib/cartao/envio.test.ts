/**
 * O guarda da chave de envio, e o contrato do título que vai ao Omie.
 *
 * A primeira metade não testa uma função — vigia uma promessa. Com a chave
 * DESLIGADA, não pode existir no repo código capaz de criar título no ERP; com
 * ela LIGADA, o caminho de escrita tem de existir e estar confinado aos
 * arquivos autorizados. Nos dois estados o teste cobra alguma coisa, então
 * ligar ou desligar a chave nunca deixa a suíte "sem opinião".
 *
 * A segunda metade prende o payload ao título real que a analista já lançou à
 * mão (5504552123, lido no Omie em 24/08/2026). É esse título que define o que
 * "certo" significa aqui — não a documentação do Omie, que não diz qual campo a
 * empresa usa para quê.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTA_CORRENTE_CARTAO, ENVIO_AO_OMIE_LIBERADO, FORNECEDOR_CARTAO, MARCO_FORA_DO_HUB,
  TIPO_DOCUMENTO_CARTAO, bloqueioDeEnvio, dataBR, ehTeste, integracaoDe, montarTitulo,
  recusaDoEnvio, type TituloParaOmie,
} from "../../../supabase/functions/_shared/cartao-envio.ts";
import { expandir, type LinhaClassificada } from "./provisionar";

const RAIZ = join(__dirname, "..", "..", "..");

/** Chamadas da API do Omie que CRIAM ou ALTERAM um título a pagar. */
const ESCRITA_NO_OMIE = /Incluir(Conta(Pagar|Receber)|TituloPagar)|IncluirContasPagar/;

/**
 * Os únicos arquivos onde a escrita pode aparecer.
 *
 * `_shared/omie.ts` é a porta (a chamada de verdade), `_shared/cartao-envio.ts`
 * monta o payload e a Edge Function orquestra. Qualquer outro arquivo que
 * aprenda a criar título é um caminho paralelo, sem as travas — e é exatamente
 * o que este teste existe para pegar.
 */
const AUTORIZADOS = [
  "supabase/functions/_shared/omie.ts",
  "supabase/functions/_shared/cartao-envio.ts",
  "supabase/functions/cartao-omie-enviar/index.ts",
];

function arquivos(dir: string): string[] {
  let out: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".git" || nome === "dist") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out = out.concat(arquivos(caminho));
    else if (/\.(ts|tsx|mjs|js)$/.test(nome)) out.push(caminho);
  }
  return out;
}

const quemEscreveNoOmie = (): string[] =>
  [join(RAIZ, "src"), join(RAIZ, "supabase"), join(RAIZ, "scripts")]
    .flatMap((d) => { try { return arquivos(d); } catch { return []; } })
    .filter((f) => f !== __filename)
    .filter((f) => ESCRITA_NO_OMIE.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(RAIZ.length + 1).replace(/\\/g, "/"));

describe("chave de envio ao Omie", () => {
  it("a tela e o servidor leem a MESMA chave", () => {
    // `src/lib/cartao/envio.ts` só reexporta; se alguém voltar a declarar a
    // constante lá, as duas cópias passam a poder discordar — e a que vale para
    // quem chama a Edge Function direto é a do servidor.
    const frontend = readFileSync(join(RAIZ, "src/lib/cartao/envio.ts"), "utf8");
    expect(frontend, "a chave não pode ser declarada de novo no frontend")
      .not.toMatch(/^\s*export const ENVIO_AO_OMIE_LIBERADO\s*=/m);
    expect(frontend).toContain("_shared/cartao-envio.ts");
  });

  it("desligada, nada no repo cria título no Omie", () => {
    if (ENVIO_AO_OMIE_LIBERADO) return;

    expect(bloqueioDeEnvio()).toContain("desligado");
    expect(
      quemEscreveNoOmie(),
      "Apareceu código que cria título no Omie enquanto ENVIO_AO_OMIE_LIBERADO é false. "
      + "Se o envio foi autorizado, ligue a chave em supabase/functions/_shared/cartao-envio.ts "
      + "(e leia o comentário de lá antes). Se não foi, este código não deveria existir ainda.",
    ).toEqual([]);
  });

  it("ligada, o caminho de escrita existe e está confinado", () => {
    if (!ENVIO_AO_OMIE_LIBERADO) return;

    expect(bloqueioDeEnvio()).toBeNull();

    const porta = readFileSync(join(RAIZ, "supabase/functions/_shared/omie.ts"), "utf8");
    expect(porta, "a chave está ligada mas ninguém sabe criar título").toMatch(/IncluirContaPagar/);
    expect(porta, "sem ExcluirContaPagar não há como limpar a fatura de teste").toMatch(/ExcluirContaPagar/);

    const intrusos = quemEscreveNoOmie().filter((f) => !AUTORIZADOS.includes(f));
    expect(
      intrusos,
      "Criar título no Omie só pode passar por _shared/omie.ts, com o payload de "
      + "_shared/cartao-envio.ts e pela função cartao-omie-enviar — é lá que estão o marco, "
      + "a idempotência e o registro em cartao_envios_omie. Um caminho paralelo não tem nada disso.",
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

const TITULO: TituloParaOmie = {
  fitid: "0001234567",
  integracao: "CARTAO-0001234567-01",
  dataCompra: "2026-11-14",
  vencimento: "2026-12-10",
  competencia: "2026-12-01",
  valor: 315.666,
  parcela: { n: 1, de: 3 },
  codigoCategoria: "2.04.06",
  estabelecimento: "NET MICRO INFORMATIC",
  chave: "NET MICRO INFORMATIC",
  memo: "NET MICRO INFORMATIC  01/03   VILA VELHA",
};

describe("montarTitulo", () => {
  it("espelha os códigos fixos do cartão", () => {
    const p = montarTitulo(TITULO);
    expect(p.codigo_cliente_fornecedor).toBe(FORNECEDOR_CARTAO);
    expect(p.id_conta_corrente).toBe(CONTA_CORRENTE_CARTAO);
    expect(p.codigo_tipo_documento).toBe(TIPO_DOCUMENTO_CARTAO);
    expect(p.codigo_lancamento_integracao).toBe("CARTAO-0001234567-01");
  });

  it("ancora a DRE na data da COMPRA, não no vencimento da parcela", () => {
    // É a regra que faz uma compra em 12× reconhecer o valor cheio no mês da
    // compra — o comportamento que o Omie já tem. Trocar isto muda a DRE.
    const p = montarTitulo({ ...TITULO, parcela: { n: 3, de: 3 }, vencimento: "2027-02-10" });
    expect(p.data_entrada).toBe("14/11/2026");
    expect(p.data_emissao).toBe("14/11/2026");
    expect(p.data_vencimento).toBe("10/02/2027");
    expect(p.data_previsao).toBe("10/02/2027");
  });

  it("manda a parcela em três dígitos e omite nas compras à vista", () => {
    expect(montarTitulo({ ...TITULO, parcela: { n: 3, de: 12 } }).numero_parcela).toBe("003/012");
    expect(montarTitulo({ ...TITULO, parcela: null }).numero_parcela).toBeUndefined();
  });

  it("leva o MEMO cru para a observação — é dele que a DRE tira o lojista", () => {
    expect(montarTitulo(TITULO).observacao).toBe("NET MICRO INFORMATIC  01/03   VILA VELHA");
  });

  it("arredonda o valor para centavos", () => {
    expect(montarTitulo(TITULO).valor_documento).toBe(315.67);
  });

  it("carimba a fatura sintética em dois lugares", () => {
    const p = montarTitulo({ ...TITULO, fitid: "TESTEHUB0001", integracao: "CARTAO-TESTEHUB0001-01" });
    expect(String(p.observacao)).toMatch(/^\[TESTE HUB\] /);
    expect(p.numero_documento).toBe("TESTE-HUB");
  });

  it("o título de verdade não leva número de documento", () => {
    expect(montarTitulo(TITULO).numero_documento).toBeUndefined();
  });
});

describe("ehTeste", () => {
  it("reconhece o prefixo do OFX sintético e só ele", () => {
    expect(ehTeste("TESTEHUB0001")).toBe(true);
    expect(ehTeste("testehub0001")).toBe(true);
    expect(ehTeste("0001234567")).toBe(false);
    expect(ehTeste("")).toBe(false);
  });
});

describe("dataBR", () => {
  it("vira o formato que o Omie aceita", () => {
    expect(dataBR("2026-11-30")).toBe("30/11/2026");
  });
});

describe("recusaDoEnvio", () => {
  const ok: Parameters<typeof recusaDoEnvio>[0] = {
    competencia: "2026-12-01",
    estadoDaFatura: null,
    titulos: [{ codigoCategoria: "2.04.06" }],
  };

  it("deixa passar a fatura em ordem", () => {
    expect(recusaDoEnvio({ ...ok })).toBeNull();
  });

  it("barra o que é anterior ao marco", () => {
    expect(recusaDoEnvio({ ...ok, competencia: "2026-08-01" })).toMatch(/à mão/);
    expect(recusaDoEnvio({ ...ok, competencia: "2026-07-01" })).toMatch(/à mão/);
    expect(recusaDoEnvio({ ...ok, competencia: "2026-09-01" })).toBeNull();
  });

  it("barra fatura já enviada ou lançada fora do Hub", () => {
    expect(recusaDoEnvio({ ...ok, estadoDaFatura: "enviado" })).toMatch(/já foi enviada/);
    expect(recusaDoEnvio({ ...ok, estadoDaFatura: "fora_do_hub" })).toMatch(/fora do Hub/);
    expect(recusaDoEnvio({ ...ok, estadoDaFatura: "pendente" })).toBeNull();
  });

  it("barra lojista sem categoria, dizendo quantos", () => {
    const r = recusaDoEnvio({
      ...ok,
      titulos: [{ codigoCategoria: "2.04.06" }, { codigoCategoria: "" }, { codigoCategoria: null }],
    });
    expect(r).toMatch(/^2 título/);
  });

  it("barra lote vazio e competência ausente", () => {
    expect(recusaDoEnvio({ ...ok, titulos: [] })).toMatch(/Não há título/);
    expect(recusaDoEnvio({ ...ok, competencia: "" })).toMatch(/Competência/);
  });
});

describe("a integração do expandir é a mesma do integracaoDe", () => {
  it("não deixa as duas fórmulas se separarem", () => {
    // `expandir` monta a chave de idempotência e `integracaoDe` é quem a tela e
    // a limpeza usam para reconhecê-la. Se divergirem, o Omie deixa de recusar o
    // reenvio e a limpeza deixa de achar a fatura de teste.
    const linha = {
      fitid: "TESTEHUB0009", data: "2026-11-14", valor: 100, sinal: "debito",
      memo: "X", estabelecimento: "X", chave: "X", parcela: { n: 1, de: 3 },
      cidade: null, exterior: null, tarifa: false, balde: "primeira", motivo: "",
    } as unknown as LinhaClassificada;

    const provisoes = expandir([linha], "2026-12-01", "2026-12-10");
    expect(provisoes.map((p) => p.integracao)).toEqual([1, 2, 3].map((k) => integracaoDe("TESTEHUB0009", k)));
    expect(provisoes[0].dataCompra).toBe("2026-11-14");
  });
});

describe("o marco", () => {
  it("é o mesmo do trigger no banco", () => {
    const sql = readFileSync(
      join(RAIZ, "supabase/migrations/20260806120000_cartao_provisionamento.sql"), "utf8",
    );
    expect(sql).toContain(`date '${MARCO_FORA_DO_HUB}'`);
  });
});
