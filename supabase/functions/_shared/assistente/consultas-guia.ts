// A consulta "como_fazer" — o guia do Hub servido no mesmo formato das outras.
//
// Ela não lê o banco, e é a única assim. O contrato do Assistente é que todo número escrito
// veio de consulta conferida; o contrato DESTA é irmão daquele e igualmente restrito: todo
// PROCEDIMENTO escrito veio de um verbete revisado em `guia.ts`. Por isso ela devolve um
// `Resultado` como qualquer outra — o sintetizador não precisa saber que este bloco é de
// outra natureza, e o painel mostra o selo certo a partir do `nivel`.
//
// `ok` é sempre true, inclusive quando nenhum verbete casa. "O passo a passo disto não está
// no guia, e isto se faz na tela X" é uma resposta — e é a resposta que faltava. Devolver
// `ok: false` jogaria a pergunta no texto genérico de "não tenho esse dado", que fala de
// dado quando a pessoa perguntou de caminho.

import { Resultado } from "./base.ts";
import { blocoDoGuia, buscarNoGuia, type Achado } from "./guia.ts";

export type ConsultaGuia = Resultado & { achados: Achado[] };

export function comoFazer(
  pergunta: string,
  opts: { rotaAtual?: string | null; pode: (c: string) => boolean },
): ConsultaGuia {
  const achados = buscarNoGuia(pergunta, { rotaAtual: opts.rotaAtual, pode: opts.pode, limite: 3 });

  const avisos = achados.length
    ? achados
        .filter((a) => !a.verbete.passos?.length)
        .map((a) => `O guia descreve o que é "${a.verbete.titulo}", mas ainda não tem o passo a passo dela.`)
    : ["Nenhum verbete do guia cobre esta pergunta — a resposta aponta a tela, sem descrever o procedimento."];

  return {
    consulta: "como_fazer",
    ok: true,
    nivel: "guia",
    numeros: [],
    achados,
    avisos,
    paraModelo: blocoDoGuia(achados, opts.pode),
  };
}
