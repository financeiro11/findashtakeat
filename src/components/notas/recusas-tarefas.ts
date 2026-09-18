/* ---------------------------------------------------------------------------
 * AS DUAS AÇÕES DAS RECUSAS COMO TAREFAS — devolver à esteira e consertar cadastros.
 *
 * Os dois laços moravam no componente `RecusasATratar`: sair da aba deixava o
 * laço rodando sem placar, e voltar mostrava o botão livre para mandar de novo.
 * Agora são tarefas de `lib/segundo-plano` (18/09/2026); o componente lê o
 * placar de `tarefa.dados`.
 *
 * EM LEVAS, e o laço mora no navegador pelo mesmo motivo da emissão em massa:
 * cada volta custa chamadas ao Omie (StatusOS por OS, ou três consultas por
 * cliente) e a Edge morre aos 150s. O teto de voltas impede laço infinito quando
 * o servidor deixa de avançar — o que acontece por desenho.
 * ------------------------------------------------------------------------- */

import { supabase } from "@/integrations/supabase/client";
import { iniciarTarefa, type Tarefa } from "@/lib/segundo-plano";

const sb = supabase as any;

export const CHAVE_DEVOLVER = "recusas:devolver";
export const CHAVE_CONSERTAR = "recusas:consertar";

export interface DadosDevolver { devolvidas: number; cobrancas: number; faltam: number }
export interface DadosConsertar { corrigidos: number; alvos: number; precisam: number }

/**
 * Aposenta as OS recusadas para as cobranças voltarem à fila de emissão. NÃO
 * emite: quem emite é a esteira, com a conferência ao vivo no Asaas e a guarda
 * anti-duplicata de sempre (ver o cabeçalho de `RecusasATratar`).
 */
export function iniciarDevolucao(dias: number, aoTerminar?: (t: Tarefa) => void): string {
  return iniciarTarefa(
    {
      chave: CHAVE_DEVOLVER,
      titulo: "Devolver recusadas à esteira",
      subtitulo: `OS recusadas nos últimos ${dias} dias`,
      passos: [{ id: "devolver", titulo: "OS recusadas aposentadas, cobranças de volta à fila" }],
    },
    async (ctx) => {
      const d: DadosDevolver = { devolvidas: 0, cobrancas: 0, faltam: 0 };
      const cobrancas = new Set<string>();
      ctx.atualizar({ dados: { ...d } });
      ctx.passo("devolver", "correndo", "Conferindo cada OS no Omie antes de aposentar…");
      for (let volta = 0; volta < 12 && ctx.segue(); volta++) {
        const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
          body: { action: "devolver_a_esteira", dias, limite: 50 },
        });
        if (error) throw new Error(error.message ?? String(error));
        if (data?.erro) throw new Error(String(data.erro));
        d.devolvidas += Number(data?.devolvidas ?? 0);
        for (const x of (data?.detalhe?.devolvidas ?? [])) cobrancas.add(String(x.id_cobranca));
        d.cobrancas = cobrancas.size;
        d.faltam = Number(data?.faltam ?? 0);
        ctx.atualizar({ dados: { ...d } });
        ctx.passo("devolver", "correndo",
          `${d.devolvidas} OS devolvida(s) · ${d.cobrancas} cobrança(s)${d.faltam ? ` · faltam ${d.faltam}` : ""}`);
        if (!d.faltam || !Number(data?.devolvidas ?? 0)) break;
      }
      const resumo = `${d.devolvidas} OS devolvida(s) à esteira · ${d.cobrancas} cobrança(s)` +
        (d.faltam ? ` · ${d.faltam} ficaram para a próxima` : "");
      ctx.passo("devolver", d.faltam ? "atencao" : "ok", resumo);
      return {
        estado: d.faltam ? "atencao" : "ok",
        resumo: `${resumo}. A emissão roda de 10 em 10 minutos das 13h às 21h (UTC) e vai pegando a fila — ` +
          "acompanhe no Registro de emissões.",
      };
    },
    { aoTerminar },
  );
}

/**
 * A rodada de conserto de cadastro das recusas, disparada na hora. Conserta o
 * CADASTRO, não emite nota: depois dela, "Devolver à esteira".
 */
export function iniciarConserto(aoTerminar?: (t: Tarefa) => void): string {
  return iniciarTarefa(
    {
      chave: CHAVE_CONSERTAR,
      titulo: "Consertar cadastros das recusas",
      subtitulo: "Endereço, CEP, e-mail, telefone e município, pelo que a prefeitura recusou",
      passos: [{ id: "consertar", titulo: "Cadastros corrigidos no Omie" }],
    },
    async (ctx) => {
      const d: DadosConsertar = { corrigidos: 0, alvos: 0, precisam: 0 };
      ctx.atualizar({ dados: { ...d } });
      ctx.passo("consertar", "correndo", "Lendo as recusas e escrevendo no cadastro…");
      for (let volta = 0; volta < 6 && ctx.segue(); volta++) {
        const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
          body: { action: "corrigir_recusados", operador: "tela-recusas" },
        });
        if (error) throw new Error(error.message ?? String(error));
        if (data?.erro) throw new Error(String(data.erro));
        if (data?.pulada) throw new Error(String(data.pulada));
        const nesta = Number(data?.alvos ?? 0);
        d.alvos += nesta;
        d.corrigidos += Number(data?.corrigidos ?? 0);
        d.precisam += Number(data?.precisam_de_gente ?? 0);
        ctx.atualizar({ dados: { ...d } });
        ctx.passo("consertar", "correndo", `${d.corrigidos} de ${d.alvos} corrigido(s)`);
        // Fila vazia: nada mais a tentar até a próxima recusa.
        if (!nesta) break;
      }
      if (!d.alvos) {
        ctx.passo("consertar", "ok", "Nenhum cadastro na fila do conserto.");
        return {
          resumo: "Nenhum cadastro na fila do conserto: ou já foram tentados depois da última recusa, ou alguém " +
            "os editou à mão — nos dois casos a máquina não redecide.",
        };
      }
      const resumo = `${d.corrigidos} de ${d.alvos} cadastro(s) corrigidos no Omie` +
        (d.precisam ? ` · ${d.precisam} seguem precisando de gente` : "");
      ctx.passo("consertar", d.precisam ? "atencao" : "ok", resumo);
      return {
        estado: d.precisam ? "atencao" : "ok",
        resumo: `${resumo}. Isto conserta o CADASTRO, não emite nota: use “Devolver à esteira” para a nota sair de novo.`,
      };
    },
    { aoTerminar },
  );
}
