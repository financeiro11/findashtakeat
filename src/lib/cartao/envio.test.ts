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
  TIPO_DOCUMENTO_CARTAO, bloqueioDeEnvio, dataBR, ehParcial, ehTeste, integracaoDe, lerEscopo,
  montarTitulo, recusaDoEnvio, titulosDoEscopo, type TituloParaOmie,
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
  // Folha → Omie, autorizado em 26/08/2026. Monta o payload do título de folha
  // e carrega as MESMAS travas do cartão: marco de competência, chave de
  // idempotência por pessoa e função de recusa compartilhada com a tela. A
  // chave própria (`ENVIO_FOLHA_LIBERADO`) nasceu desligada, então hoje este
  // arquivo sabe montar o título mas nada o envia.
  "supabase/functions/_shared/folha-envio.ts",
  // O único caminho de escrita da folha, autorizado em 26/08/2026. Carrega o
  // marco, a idempotência por pessoa e o registro em `folha_envios_omie` — as
  // mesmas travas do cartão. Também sabe EXCLUIR, e só o que tem chave
  // `FOLHA-`: o primeiro envio real é um teste de dois títulos, e teste sem
  // desfazer é aposta.
  "supabase/functions/folha-omie-enviar/index.ts",
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

/**
 * Tira comentários antes de procurar a chamada.
 *
 * Citar `IncluirContaPagar` explicando POR QUE um fornecedor precisa existir
 * não é criar título — e é o que os módulos de cadastro de colaborador fazem.
 * Sem isto, o guarda pega prosa e a saída é reescrever o comentário para
 * escapar, que é justamente o falso negativo que ele não deve ensinar.
 *
 * Só remove linhas que COMEÇAM com `//` ou `*` e os blocos `/* ... *\/`. Um
 * `//` no meio de uma linha fica — assim `"https://app.omie.com.br"` não é
 * mutilado, e uma chamada de verdade nunca some.
 */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const quemEscreveNoOmie = (): string[] =>
  [join(RAIZ, "src"), join(RAIZ, "supabase"), join(RAIZ, "scripts")]
    .flatMap((d) => { try { return arquivos(d); } catch { return []; } })
    // Teste DESCREVE quem escreve; não escreve. Este arquivo já se excluía por
    // esse motivo, e a regra vale igual para o teste da folha, que cita
    // `IncluirContaPagarPorLote` para prender o formato do lote. A suíte não
    // vai para produção — o que se vigia aqui é o caminho de runtime.
    .filter((f) => !/\.test\.[cm]?[jt]sx?$/.test(f))
    .filter((f) => ESCRITA_NO_OMIE.test(semComentarios(readFileSync(f, "utf8"))))
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

/**
 * O escopo do envio.
 *
 * O risco que estes testes guardam não é filtrar errado — é fechar a fatura com
 * metade dela de fora. Se `ehParcial` passar a devolver false para um escopo de
 * balde, a Edge Function marca `provisionamento = 'enviado'` e a própria
 * `recusaDoEnvio` barra a continuação no dia seguinte com "já foi enviada".
 */
describe("escopo do envio", () => {
  const avista = { ...TITULO, parcela: null };
  const primeira = { ...TITULO, parcela: { n: 1, de: 3 } };
  const terceira = { ...TITULO, parcela: { n: 3, de: 3 } };

  it("'tudo' devolve a lista inteira", () => {
    expect(titulosDoEscopo([avista, primeira], "tudo")).toHaveLength(2);
  });

  it("separa pela parcela, não pelo balde da tela", () => {
    // Toda a série da 1ª parcela vem junto: quem manda a 1ª manda as N−1 que
    // nascem com ela, senão os meses à frente chegam vazios.
    expect(titulosDoEscopo([avista, primeira, terceira], "primeira")).toEqual([primeira, terceira]);
    expect(titulosDoEscopo([avista, primeira, terceira], "avista")).toEqual([avista]);
  });

  it("só 'tudo' pode fechar a fatura", () => {
    expect(ehParcial("tudo")).toBe(false);
    expect(ehParcial("avista")).toBe(true);
    expect(ehParcial("primeira")).toBe(true);
  });

  it("escopo desconhecido cai em 'tudo' — e 'tudo' é o que a recusa julga inteiro", () => {
    expect(lerEscopo(undefined)).toBe("tudo");
    expect(lerEscopo("balde-novo")).toBe("tudo");
    expect(lerEscopo("primeira")).toBe("primeira");
  });

  it("o escopo não afrouxa a recusa: o que for mandado continua precisando de categoria", () => {
    const lote = [
      { ...avista, codigoCategoria: "" },
      { ...primeira, codigoCategoria: "2.04.06" },
    ];
    const base = { competencia: "2026-12-01", estadoDaFatura: null } as const;

    // É o caso de set/26: 1ª parcela conferida por inteiro, à vista ainda não.
    expect(recusaDoEnvio({ ...base, titulos: lote })).toMatch(/^1 título/);
    expect(recusaDoEnvio({ ...base, titulos: titulosDoEscopo(lote, "primeira") })).toBeNull();
    expect(recusaDoEnvio({ ...base, titulos: titulosDoEscopo(lote, "avista") })).toMatch(/^1 título/);
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
