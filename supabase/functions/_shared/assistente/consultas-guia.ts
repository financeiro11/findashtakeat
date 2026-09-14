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
//
// OS AVISOS SÃO LIDOS DE VOLTA. A view `assistente_lacunas_do_guia` (migration
// 20260913170000) acha as perguntas que o guia não respondeu procurando estas duas frases
// em `assistente_execucao.avisos`. Reescrever o texto sem reescrever a view faria a lista
// voltar vazia — que se lê como "o guia respondeu tudo". `src/lib/guia.test.ts` trava as
// duas pontas juntas.

import { Resultado } from "./base.ts";
import { blocoDoGuia, buscarNoGuia, type Achado } from "./guia.ts";

/** Nenhum verbete casou. Lido pela view de lacunas — não mude sem mudar a migration. */
export const AVISO_SEM_VERBETE = "Nenhum verbete do guia cobre esta pergunta";
/** O verbete principal não tem passo a passo. Lido pela view de lacunas — idem. */
export const AVISO_SEM_PASSOS = "mas ainda não tem o passo a passo";

export type ConsultaGuia = Resultado & { achados: Achado[] };

export function comoFazer(
  pergunta: string,
  opts: { rotaAtual?: string | null; pode: (c: string) => boolean },
): ConsultaGuia {
  const achados = buscarNoGuia(pergunta, { rotaAtual: opts.rotaAtual, pode: opts.pode, limite: 3 });

  /* O aviso de "sem passo a passo" fala só do verbete PRINCIPAL — o que sustenta a
     resposta. Antes ele saía para cada um dos três achados sem passos, e uma pergunta bem
     respondida pelo primeiro verbete ganhava um aviso por causa do terceiro: a tela
     mostrava uma ressalva que não se aplicava, e a lista de lacunas enchia de falso
     positivo. */
  const principal = achados[0]?.verbete;
  const avisos = !principal
    ? [`${AVISO_SEM_VERBETE} — a resposta aponta a tela, sem descrever o procedimento.`]
    : principal.passos?.length
      ? []
      : [`O guia descreve o que é "${principal.titulo}", ${AVISO_SEM_PASSOS} dela.`];

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
