/* ---------------------------------------------------------------------------
 * A EMISSÃO EM MASSA COMO TAREFA — a fila inteira, uma leva por vez.
 *
 * Até 18/09/2026 o laço morava na página de Notas Fiscais, com o placar num
 * `useState`: sair da tela deixava o laço rodando às cegas — sem botão de parar
 * e sem placar — e voltar mostrava a faixa zerada, convidando a mandar de novo.
 * A confirmação pedia "ESTA ABA PRECISA FICAR ABERTA", e na prática a TELA
 * também precisava. Agora o laço é uma tarefa de `lib/segundo-plano`: a faixa
 * lê o placar de `tarefa.dados`, e ele sobrevive a trocar de tela.
 *
 * DE ONDE SAI A LISTA: da FILA (`notas_fiscais_fila_emissao`), a mesma que o
 * cron consome — não do que está selecionado nem do que a tela mostra. A fila é
 * relida A CADA LEVA: o teto de 1.000 linhas do PostgREST não alcança a lista
 * inteira, e a fila já exclui quem acabou de ser despachado.
 *
 * O LAÇO É BURRO DE PROPÓSITO. Só separa os três motivos de uma leva não andar:
 * lote em voo (espera e REPETE — nada foi criado), teto do dia (para: só abre
 * amanhã) e o resto (segue para a próxima leva: uma leva ruim não pode impedir
 * o mês de fechar).
 * ------------------------------------------------------------------------- */

import { supabase } from "@/integrations/supabase/client";
import {
  CABEM_NUMA_CHAMADA, PROGRESSO_ZERO, esperaAntesDeRepetir, precisaEsperarOLote, somarBloco,
  tetoDoDiaAtingido, type ProgressoMassa,
} from "@/lib/notasFiscais";
import { iniciarTarefa, type Tarefa } from "@/lib/segundo-plano";

const sb = supabase as any;
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const CHAVE_MASSA = "emitir-massa";

/** O que a faixa da página lê enquanto a tarefa roda. */
export interface DadosMassa { progresso: ProgressoMassa; esperando: number }

export function iniciarEmissaoEmMassa(total: number, aoTerminar?: (t: Tarefa) => void): string {
  const levas = Math.max(1, Math.ceil(total / CABEM_NUMA_CHAMADA));
  return iniciarTarefa(
    {
      chave: CHAVE_MASSA,
      titulo: "Emissão em massa",
      subtitulo: `${total.toLocaleString("pt-BR")} cobranças da fila da esteira, em ${levas} leva(s) de até ${CABEM_NUMA_CHAMADA}`,
      passos: [{ id: "levas", titulo: "Levas despachadas ao Omie" }],
    },
    async (ctx) => {
      let acc = PROGRESSO_ZERO(levas);
      const publicar = (esperando = 0) => {
        const d: DadosMassa = { progresso: { ...acc }, esperando };
        ctx.atualizar({ dados: d });
        ctx.passo("levas", "correndo",
          `Leva ${Math.min(acc.blocosFeitos + 1, acc.blocosTotal)} de ${acc.blocosTotal} · ` +
          `${acc.despachadas} despachada(s)` +
          (esperando ? ` · o Omie ainda fatura a leva anterior, nova tentativa em ${esperando}s` : ""));
      };
      publicar();
      let teto = false;

      for (let leva = 0; leva < levas + 5 && ctx.segue(); leva++) {
        // A fila de agora, não a de um minuto atrás.
        const { data: proximas, error: erroFila } = await sb.rpc(
          "notas_fiscais_fila_emissao", { p_limite: CABEM_NUMA_CHAMADA },
        );
        if (erroFila) throw new Error(erroFila.message ?? String(erroFila));
        const ids = ((proximas ?? []) as Array<{ id_asaas: string }>).map((l) => l.id_asaas);
        if (!ids.length) break; // acabou

        for (let tentativa = 1; ctx.segue(); tentativa++) {
          const { data, error } = await sb.functions.invoke("omie-nfse-sync", { body: { action: "emitir", ids } });
          const r = error ? { erro: error.message ?? String(error) } : (data ?? {});

          /* O LOTE ANTERIOR AINDA ESTÁ NO FORNO. Nada foi criado, então repetir
           * é seguro — e é a única coisa que faz o mês fechar. */
          if (precisaEsperarOLote(r) && tentativa <= 12) {
            // Conta regressiva: sem ela o andamento fica parado e parece pane.
            for (let s = Math.round(esperaAntesDeRepetir(tentativa) / 1000); s > 0 && ctx.segue(); s--) {
              publicar(s);
              await dorme(1000);
            }
            continue;
          }
          acc = somarBloco(acc, r);
          publicar();
          if (tetoDoDiaAtingido(r)) teto = true;
          break;
        }
        if (teto) break;
      }

      const d: DadosMassa = { progresso: { ...acc }, esperando: 0 };
      const resumoNumeros = [
        `${acc.despachadas} despachada(s) ao Omie`,
        acc.jaEmitidas ? `${acc.jaEmitidas} já tinham nota` : "",
        acc.barradas ? `${acc.barradas} barrada(s) no Asaas` : "",
        acc.falhas ? `${acc.falhas} não saíram` : "",
      ].filter(Boolean).join(" · ");
      ctx.atualizar({
        dados: d,
        destaques: [
          { rotulo: "Despachadas ao Omie", valor: String(acc.despachadas) },
          ...(acc.jaEmitidas ? [{ rotulo: "Já tinham nota", valor: String(acc.jaEmitidas) }] : []),
          ...(acc.barradas ? [{ rotulo: "Barradas no Asaas", valor: String(acc.barradas) }] : []),
          ...(acc.falhas ? [{ rotulo: "Não saíram", valor: String(acc.falhas) }] : []),
        ],
        avisos: [
          ...(teto ? ["O teto do dia foi atingido: a esteira para por hoje e retoma amanhã sozinha. " +
            "Para empurrar mais, suba o teto do dia em nf_config."] : []),
          ...(acc.motivos.length
            ? [`O que não saiu: ${acc.motivos.slice(0, 5).map(([m, n]) => `${n}× ${m}`).join(" · ")}` +
              (acc.motivos.length > 5 ? ` · +${acc.motivos.length - 5} motivo(s)` : "")]
            : []),
        ],
      });
      if (!ctx.segue()) {
        ctx.passo("levas", "atencao", `Interrompida. ${resumoNumeros}. O que saiu não se desfaz; o resto continua na fila.`);
        return { resumo: `Interrompida — ${resumoNumeros}.` };
      }
      ctx.passo("levas", teto || acc.falhas ? "atencao" : "ok",
        `${resumoNumeros}. Despachada não é emitida: os números chegam nos próximos minutos.`);
      return {
        estado: teto || acc.falhas ? "atencao" : "ok",
        resumo: `${resumoNumeros}${teto ? " · teto do dia atingido" : ""}.`,
      };
    },
    { aoTerminar },
  );
}
