/* ---------------------------------------------------------------------------
 * O REFAZER COMO TAREFA — corrigir o tomador, cancelar a velha, emitir a certa.
 *
 * Um andamento só, em segundo plano, do primeiro degrau ao número da nota nova.
 * Até 18/09/2026 isto era um diálogo que não se podia fechar e que, no fim,
 * entregava a emissão a OUTRO diálogo — e foi nessa emenda que a EMME ficou sem
 * nota: a 19649 caiu, e a certa foi barrada.
 *
 * A NOTA NOVA SAI PELA MESMA RÉGUA DA VELHA. A 19649 tinha sido emitida como
 * avulsa, sobre uma cobrança CONFIRMADA (cartão, parcela 1 de 12, dinheiro ainda
 * não liquidado). O refazer mandava emitir com a chave "avulsa" da tela, que
 * estava desligada, e a régua estreita barrou: "confirmada e ainda não
 * liquidada". Substituir uma nota não é uma decisão nova de emitir antes do
 * dinheiro — essa decisão já foi tomada e assinada quando a velha saiu — então
 * o refazer emite com `avulsa: true`. A avulsa só alcança a CONFIRMADA:
 * estorno, cobrança excluída e cobrança não paga continuam barrando no servidor.
 *
 * O CANCELAMENTO QUE DEMORA A CONFIRMAR é espera, não pergunta. Antes a tela
 * dizia "clique de novo em alguns minutos"; agora a tarefa espera e pergunta de
 * novo sozinha. O servidor reconhece o que já foi feito (o carimbo volta ao
 * original quando não confirma, e a volta seguinte o troca outra vez), e o
 * intervalo de 90s fica longe da trava de chamada redundante do Omie.
 * ------------------------------------------------------------------------- */

import { supabase } from "@/integrations/supabase/client";
import type { LinhaNota } from "@/lib/notasFiscais";
import { iniciarTarefa, type ParaVoce, type Tarefa } from "@/lib/segundo-plano";
import { PASSOS_EMISSAO, correrEmissao } from "./EmitirAgora";

const sb = supabase as any;
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ESPERA_CANCELAMENTO_MS = 90_000;
const VOLTAS_CANCELAMENTO = 6;

async function mensagemDe(error: any, data: any): Promise<string> {
  if (data?.erro) return String(data.erro);
  try {
    const corpo = await error?.context?.json?.();
    if (corpo?.erro) return String(corpo.erro);
  } catch { /* sem corpo legível */ }
  return error?.message ?? "Erro sem mensagem.";
}

export interface ParamsRefazer {
  linha: LinhaNota;
  justificativa: string;
  observacao: string;
  /** Há o que mudar no cadastro e o endereço proposto é confiável. */
  corrigirCadastro: boolean;
  docCadastro: string | null;
  valorAgora: number | null;
  /** A cobrança foi excluída no Asaas: a certa sai por esta, se houver uma só. */
  excluida: boolean;
  substituta: LinhaNota | null;
}

export function iniciarRefazer(p: ParamsRefazer, aoTerminar?: (t: Tarefa) => void): string {
  const { linha } = p;
  const id = linha.id_asaas;
  const nome = linha.cliente_asaas ?? id;
  return iniciarTarefa(
    {
      chave: `refazer:${id}`,
      titulo: `Refazer a NFS-e ${linha.nfse_numero ?? ""} · ${nome}`.replace(/\s+·/, " ·"),
      subtitulo: `${id} — cancela a nota errada e emite a certa`,
      passos: [
        { id: "tomador", titulo: "Cadastro do tomador corrigido com o do Asaas" },
        { id: "cancelar", titulo: `NFS-e ${linha.nfse_numero ?? ""} cancelada no Omie e na prefeitura` },
        ...PASSOS_EMISSAO.filter((x) => x.id !== "destravar"),
      ],
    },
    async (ctx) => {
      const pendencias: ParaVoce[] = [];

      /* 1) CADASTRO — primeiro, porque se desfaz. Falhar aqui para tudo antes de cancelar. */
      if (p.corrigirCadastro && p.docCadastro) {
        ctx.passo("tomador", "correndo", "Escrevendo no Omie o endereço do Asaas…");
        const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
          body: { action: "corrigir_cadastro", doc: p.docCadastro, alvos: ["omie"], ids: [id] },
        });
        const om = data?.resultado?.omie;
        if (error || data?.erro || (om && om.ok === false && !om.nada_a_propor)) {
          const msg = error || data?.erro ? await mensagemDe(error, data) : om?.motivo ?? "";
          ctx.passo("tomador", "falhou", `Nada foi cancelado. ${msg}`);
          ctx.atualizar({ paraVoce: [{
            id_asaas: id, nome, titulo: "O cadastro do tomador não foi corrigido",
            oQueFazer: `${msg} A nota ${linha.nfse_numero} continua de pé. Corrija o cadastro à mão (Ficha do cliente › Editar cadastro) e refaça.`,
            tentado: ["corrigir o cadastro do Omie com o endereço do Asaas"],
          }] });
          return { estado: "falhou", resumo: "Cadastro não corrigido — nada foi cancelado." };
        }
        ctx.passo("tomador", "ok", "Cadastro do Omie igual ao do Asaas.");
      } else {
        ctx.passo("tomador", "pulado", "Nada a mudar no cadastro.");
      }
      if (!ctx.segue()) return { resumo: "Parada antes de cancelar — a nota continua de pé." };

      /* 2) CANCELAR — e só vale confirmado. Pendente, espera e pergunta de novo. */
      let r: any = null;
      for (let volta = 1; volta <= VOLTAS_CANCELAMENTO; volta++) {
        ctx.passo("cancelar", "correndo", volta === 1
          ? "Soltando o carimbo e pedindo o cancelamento…"
          : `A prefeitura ainda não confirmou — perguntando de novo (${volta}ª vez).`);
        const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
          body: { action: "refazer_omie", id, justificativa: p.justificativa },
        });
        if (error || data?.erro) {
          const msg = await mensagemDe(error, data);
          ctx.passo("cancelar", "falhou", msg);
          ctx.atualizar({ paraVoce: [{
            id_asaas: id, nome, titulo: "O Omie não cancelou a nota",
            oQueFazer: `${msg} Enquanto a nota velha estiver de pé, a certa não é emitida — seriam duas notas.`,
            tentado: [`${volta} pedido(s) de cancelamento`],
          }] });
          return { estado: "falhou", resumo: `A NFS-e ${linha.nfse_numero} não foi cancelada.` };
        }
        if (!data?.cancelamento_em_andamento) { r = data; break; }
        if (!ctx.segue()) break;
        ctx.passo("cancelar", "correndo",
          `Cancelamento pedido; a prefeitura ainda não confirmou. Nova conferência em ${ESPERA_CANCELAMENTO_MS / 1000}s.`);
        await dorme(ESPERA_CANCELAMENTO_MS);
      }
      if (!r) {
        ctx.passo("cancelar", "atencao", "O cancelamento foi pedido e não confirmou a tempo. Nada novo foi emitido.");
        ctx.atualizar({ paraVoce: [{
          id_asaas: id, nome, titulo: "A prefeitura não confirmou o cancelamento",
          oQueFazer: `Refaça daqui a pouco pela mesma tela: o Hub reconhece o que já foi feito. A nota ${linha.nfse_numero} ` +
            "pode ainda constar como válida até lá.",
          tentado: [`${VOLTAS_CANCELAMENTO} conferências, com ${ESPERA_CANCELAMENTO_MS / 1000}s entre elas`],
        }] });
        return { estado: "atencao", resumo: "Cancelamento pedido, ainda não confirmado." };
      }
      ctx.passo("cancelar", "ok", `NFS-e ${linha.nfse_numero} cancelada. O carimbo ${id} ficou livre.`);

      /* 3) EMITIR A CERTA — nesta cobrança, ou pela substituta se esta foi excluída. */
      let alvo: { id: string; valor: number } | null = { id, valor: Number(r.valor_agora ?? p.valorAgora ?? linha.valor) };
      if (r.cobranca_excluida) {
        alvo = p.substituta ? { id: p.substituta.id_asaas, valor: Number(p.substituta.valor) } : null;
      }
      if (!alvo) {
        for (const x of PASSOS_EMISSAO) ctx.passo(x.id, "pulado", null);
        pendencias.push({
          id_asaas: id, nome, titulo: "A cobrança desta nota foi excluída no Asaas",
          oQueFazer: "A nota errada foi cancelada. A certa sai pela cobrança nova deste cliente: abra a Ficha do cliente " +
            "e use “Emitir nota” na linha dela (ou traga-a com “Atualizar do Asaas”, se ainda não aparecer).",
          tentado: ["procurar uma cobrança nova do mesmo cliente e valor, sem nota"],
        });
        ctx.atualizar({ paraVoce: pendencias });
        return { estado: "atencao", resumo: `NFS-e ${linha.nfse_numero} cancelada; falta emitir pela cobrança nova.` };
      }
      if (!ctx.segue()) {
        return { resumo: `NFS-e ${linha.nfse_numero} cancelada; a emissão da certa não começou. Emita pela Ficha do cliente.` };
      }
      const fim = await correrEmissao({
        ids: [alvo.id],
        cobrancas: [{ id_asaas: alvo.id, nome, valor: alvo.valor }],
        observacao: p.observacao || null,
        avulsa: true,
      }, ctx);
      return fim;
    },
    { aoTerminar },
  );
}
