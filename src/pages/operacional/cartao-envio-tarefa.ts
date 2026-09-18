/* ---------------------------------------------------------------------------
 * O ENVIO DA FATURA DO CARTÃO AO OMIE, como tarefa em segundo plano.
 *
 * Uma fatura real tem ~470 títulos e o Omie serializa as chamadas do mesmo
 * método: a função devolve `restantes` e o laço chama de novo até zerar. Até
 * 18/09/2026 esse laço morava na página — sair dela deixava o envio seguindo sem
 * placar, e voltar mostrava o botão livre sobre uma fatura pela metade. Agora é
 * tarefa de `lib/segundo-plano`: o placar e o resultado moram em `tarefa.dados`.
 *
 * A trava de envio (`recusaDoEnvio`) continua na página, ANTES de disparar: é a
 * mesma função que a Edge Function usa para recusar.
 * ------------------------------------------------------------------------- */

import { supabase } from "@/integrations/supabase/client";
import { iniciarTarefa, type Tarefa } from "@/lib/segundo-plano";

export interface ResultadoEnvio {
  status: string;
  erro?: string;
  total?: number;
  ja_estavam?: number;
  criados?: number;
  recuperados?: number;
  restantes?: number;
  fatura_fechada?: boolean;
  falhas?: { integracao: string; estabelecimento: string; erro: string }[];
}

/** O rótulo do botão enquanto roda e o resultado quando termina. */
export interface DadosEnvioCartao { rotulo: string; resultado: ResultadoEnvio | null }

export const chaveEnvioCartao = (competencia: string) => `cartao:enviar:${competencia}`;

export function iniciarEnvioCartao(
  p: { competencia: string; escopo: unknown; titulos: unknown[] },
  aoTerminar?: (t: Tarefa) => void,
): string {
  return iniciarTarefa(
    {
      chave: chaveEnvioCartao(p.competencia),
      titulo: `Fatura do cartão ${p.competencia.slice(0, 7)} → Omie`,
      subtitulo: `${p.titulos.length} título(s) a criar`,
      passos: [{ id: "enviar", titulo: "Títulos criados no Omie" }],
    },
    async (ctx) => {
      const acc: ResultadoEnvio = { status: "ok", criados: 0, ja_estavam: 0, recuperados: 0, falhas: [] };
      const publicar = (rotulo: string, resultado: ResultadoEnvio | null) =>
        ctx.atualizar({ dados: { rotulo, resultado } satisfies DadosEnvioCartao });

      for (let volta = 1; ctx.segue(); volta++) {
        const rotulo = volta === 1 ? "Enviando…" : `Enviando… (lote ${volta})`;
        publicar(rotulo, null);
        ctx.passo("enviar", "correndo",
          `${rotulo} · ${acc.criados} criado(s)${acc.restantes ? ` · faltam ${acc.restantes}` : ""}`);
        const { data, error } = await supabase.functions.invoke("cartao-omie-enviar", {
          // O escopo vai junto para a função saber que um envio parcial não
          // fecha a fatura — fechar com o resto de fora barraria a continuação.
          body: { action: "enviar", competencia: p.competencia, escopo: p.escopo, titulos: p.titulos },
        });
        if (error) throw new Error(error.message);
        const r = data as ResultadoEnvio;
        if (r.status === "erro") {
          publicar("", r);
          ctx.passo("enviar", "falhou", r.erro ?? "Envio recusado.");
          return { estado: "falhou", resumo: r.erro ?? "Envio recusado." };
        }
        acc.criados = (acc.criados ?? 0) + (r.criados ?? 0);
        acc.recuperados = (acc.recuperados ?? 0) + (r.recuperados ?? 0);
        acc.ja_estavam = r.ja_estavam ?? 0;
        acc.falhas = [...(acc.falhas ?? []), ...(r.falhas ?? [])];
        acc.total = r.total;
        acc.restantes = r.restantes;
        acc.fatura_fechada = r.fatura_fechada;

        if (!r.restantes) break;
        // Sem progresso e ainda com fila é o único jeito de isto virar laço
        // infinito — para em vez de martelar o Omie.
        if (!r.criados && !r.falhas?.length) {
          acc.status = "parcial";
          ctx.atualizar({ avisos: ["O envio parou sem conseguir criar nenhum título neste lote. Mande de novo em alguns minutos."] });
          break;
        }
      }

      if (acc.status !== "parcial") acc.status = acc.falhas?.length ? "parcial" : "ok";
      publicar("", { ...acc });
      const resumo = `${acc.criados} título(s) criado(s) no Omie` +
        (acc.falhas?.length ? `, ${acc.falhas.length} com erro` : "") +
        (acc.restantes ? ` · faltam ${acc.restantes}` : "") +
        (acc.fatura_fechada ? " · fatura fechada" : "");
      if (!ctx.segue()) {
        ctx.passo("enviar", "atencao", `Interrompido. ${resumo}. O que entrou no Omie não repete no próximo envio.`);
        return { resumo };
      }
      const ruim = acc.status !== "ok" || !!acc.restantes;
      ctx.passo("enviar", ruim ? "atencao" : "ok", resumo);
      if (acc.falhas?.length) {
        ctx.atualizar({ paraVoce: acc.falhas.slice(0, 20).map((f) => ({
          id_asaas: null, nome: f.estabelecimento, titulo: "O Omie recusou o título",
          oQueFazer: f.erro, tentado: [f.integracao],
        })) });
      }
      return { estado: ruim ? "atencao" : "ok", resumo };
    },
    { aoTerminar },
  );
}
