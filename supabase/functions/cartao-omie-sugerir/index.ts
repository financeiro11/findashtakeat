// Edge Function: cartao-omie-sugerir
//
// A categoria do lojista que a empresa NUNCA classificou.
//
// O de-para (`cartao_omie_map`) responde por quem já apareceu antes — e responde
// bem, porque lê a decisão que a analista tomou no Omie. O que ele não resolve é
// a cauda: toda fatura traz lojistas inéditos, e a maioria aparece uma vez só.
// Para esses não existe histórico, e a pessoa vai procurar na árvore de 133
// categorias do Omie o que "MP*JDMTECH" pode ser.
//
// ESTA FUNÇÃO NÃO CLASSIFICA NADA — ELA PROPÕE.
// A saída não entra no de-para. Volta para a tela, onde cada proposta aparece ao
// lado do lojista com o motivo escrito, e é preciso um clique para aceitar. O
// clique grava como `manual`, que é o que de fato aconteceu: uma pessoa decidiu,
// com a IA tendo adiantado a procura.
//
// Por que não gravar direto com `origem='ia'`, que o schema até prevê: porque
// `recusaDoEnvio` só pergunta se o título TEM categoria. Uma sugestão gravada
// passaria por essa porta e iria ao ERP sem ninguém ter olhado. Enquanto a
// proposta não é aceita, o lojista continua contando como "sem categoria" e a
// fatura continua travada — que é o comportamento certo.
//
// O QUE A IA RECEBE: o nome cru do lojista (várias grafias, quando há), o MEMO
// da fatura com cidade e câmbio, quantas linhas e quanto somam, e a lista de
// categorias REAIS do Omie. Ela escolhe DENTRO dessa lista — código inventado é
// descartado aqui, não na tela.
//
// Body: { lojistas: [{ chave, exemplos, memos, linhas, total }] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, handleCors, jsonResponse } from "../_shared/gemini.ts";
import { buildOrgContext } from "../_shared/org-context.ts";

/** Um lojista sem de-para, como a tela o descreve. */
type Pedido = {
  chave: string;
  /** Grafias cruas do mesmo lojista na fatura ("MP*JDMTECH", "EC *JDMTECH"). */
  exemplos?: string[];
  /** MEMOs de amostra — trazem cidade e, no exterior, domínio e câmbio. */
  memos?: string[];
  linhas?: number;
  total?: number;
};

type Sugerida = {
  chave: string;
  codigo_categoria: string;
  motivo: string;
};

/* O teto existe porque a fatura tem cauda longa e a chamada é uma só. 120 cobre
   com folga o que uma fatura real traz de lojista inédito (a de ago/26 tem ~60);
   acima disso a tela manda em duas levas em vez de a função estourar o tempo. */
const MAX_LOJISTAS = 120;

/** Amostra por lojista. Três MEMOs dizem o que um só não diz (cidade varia). */
const MAX_MEMOS = 3;

const SISTEMA = `
Você classifica gastos de cartão corporativo da Takeat no plano de contas do
Omie. Recebe lojistas que a empresa NUNCA classificou antes e a lista de
categorias disponíveis.

REGRAS
1. Escolha SEMPRE um "codigo" que esteja na lista de categorias fornecida.
   Nunca invente código nem devolva descrição no lugar do código.
2. Se não souber o que o lojista é, escolha a categoria mais genérica que ainda
   seja defensável e diga isso no motivo. Não invente um negócio para o nome.
3. O "motivo" é uma frase curta, para o time financeiro ler na tela: o que você
   entendeu que o estabelecimento é e por que essa categoria. Diga quando o nome
   for ambíguo — quem lê precisa saber que precisa conferir.
4. Use o contexto organizacional (fornecedores e políticas da casa) quando o
   nome bater com algo que já existe lá. Um fornecedor conhecido vale mais que
   um palpite pelo nome.
5. Não classifique como despesa de marketing o que é claramente operação, nem o
   contrário. Na dúvida entre duas rubricas, prefira a que a empresa já usa para
   o tipo de gasto e escreva a dúvida no motivo.

O nome vem de fatura de cartão: é truncado em 22 caracteres, tem prefixo de
adquirente ("MP*", "EC *", "DL *", "PG *") e às vezes código de pedido colado.
Leia através disso.
`.trim();

const ESQUEMA = {
  type: "object",
  properties: {
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chave: { type: "string" },
          codigo_categoria: { type: "string" },
          motivo: { type: "string" },
        },
        required: ["chave", "codigo_categoria", "motivo"],
      },
    },
  },
  required: ["sugestoes"],
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = await req.json().catch(() => ({}));
    const pedidos = (Array.isArray(body?.lojistas) ? body.lojistas : []) as Pedido[];
    // O contrato de erro é o da `cartao-omie-enviar`: status 200 com
    // `{status:"erro", erro}`. `supabase.functions.invoke` engole o corpo de uma
    // resposta 4xx/5xx e devolve só "non-2xx status code" — a tela perderia
    // justamente a frase que explica o que fazer.
    if (!pedidos.length) {
      return jsonResponse({ status: "erro", erro: "Nenhum lojista para sugerir." });
    }
    if (pedidos.length > MAX_LOJISTAS) {
      return jsonResponse({
        status: "erro",
        erro: `São ${pedidos.length} lojistas de uma vez; o limite é ${MAX_LOJISTAS}. Mande em levas.`,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    /* As categorias REAIS, e com quantos títulos cada uma já foi usada: o `usos`
       não é enfeite, é o que faz a IA preferir a rubrica que a casa de fato usa
       em vez da que existe no plano e ninguém nunca escolheu. */
    const { data: cats, error: erroCats } = await supabase.rpc("omie_categorias_disponiveis");
    if (erroCats) throw new Error(`Não consegui ler as categorias do Omie: ${erroCats.message}`);

    const categorias = (cats ?? [])
      .filter((c: { despesa: boolean }) => c.despesa)
      .map((c: { codigo: string; descricao: string; usos: number }) =>
        `${c.codigo} | ${c.descricao} | ${c.usos ?? 0} usos`);
    if (!categorias.length) throw new Error("O cache de categorias do Omie está vazio.");

    const validos = new Set(
      (cats ?? []).filter((c: { despesa: boolean }) => c.despesa)
        .map((c: { codigo: string }) => String(c.codigo)),
    );

    // O contexto da Biblioteca é o que permite reconhecer o fornecedor que a
    // empresa já cadastrou — nome de fatura raramente é o nome de cadastro.
    const orgContext = await buildOrgContext(supabase).catch(() => "");

    const lista = pedidos.map((p) => {
      const partes = [`CHAVE: ${p.chave}`];
      const nomes = [...new Set(p.exemplos ?? [])].slice(0, 5);
      if (nomes.length) partes.push(`nomes na fatura: ${nomes.join(" / ")}`);
      for (const m of (p.memos ?? []).slice(0, MAX_MEMOS)) {
        partes.push(`memo: ${String(m).trim()}`);
      }
      if (p.linhas) partes.push(`${p.linhas} compra(s) nesta fatura`);
      if (typeof p.total === "number") {
        partes.push(`total R$ ${p.total.toFixed(2).replace(".", ",")}`);
      }
      return partes.join("\n");
    }).join("\n\n---\n\n");

    const resposta = await generateJSON<{ sugestoes?: Sugerida[] }>({
      messages: [
        { role: "system", content: SISTEMA },
        {
          role: "user",
          content: [
            orgContext ? `CONTEXTO DA EMPRESA\n${orgContext}` : "",
            `CATEGORIAS DISPONÍVEIS (código | descrição | quantos títulos já usaram)\n${categorias.join("\n")}`,
            `LOJISTAS A CLASSIFICAR (${pedidos.length})\n\n${lista}`,
            "Devolva uma sugestão para CADA chave listada, usando a chave exatamente como veio.",
          ].filter(Boolean).join("\n\n"),
        },
      ],
      json: true,
      responseSchema: ESQUEMA,
      // Isto é julgamento sobre nome truncado e ambíguo, não transcrição.
      thinking: "high",
      temperature: 0.2,
    });

    /* A validação é aqui, e não na tela: código fora do plano de contas seria
       recusado pelo Omie no meio de um envio de 470 títulos, quando já não dá
       para consertar sem desfazer o que subiu. */
    const pedidas = new Set(pedidos.map((p) => p.chave));
    const vistas = new Set<string>();
    const sugestoes: Sugerida[] = [];
    const descartadas: { chave: string; motivo: string }[] = [];

    for (const s of resposta?.sugestoes ?? []) {
      const chave = String(s?.chave ?? "").trim();
      const codigo = String(s?.codigo_categoria ?? "").trim();
      if (!pedidas.has(chave)) {
        descartadas.push({ chave, motivo: "chave que não foi pedida" });
        continue;
      }
      if (vistas.has(chave)) continue;
      if (!validos.has(codigo)) {
        descartadas.push({ chave, motivo: `categoria inexistente: ${codigo}` });
        continue;
      }
      vistas.add(chave);
      sugestoes.push({ chave, codigo_categoria: codigo, motivo: String(s?.motivo ?? "").trim() });
    }

    return jsonResponse({
      status: "ok",
      sugestoes,
      // Quem não veio é tão informativo quanto quem veio: a tela diz que
      // sobraram lojistas sem proposta em vez de dar a lista por completa.
      sem_sugestao: [...pedidas].filter((c) => !vistas.has(c)),
      descartadas,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("cartao-omie-sugerir", msg);
    return jsonResponse({ status: "erro", erro: msg });
  }
});
