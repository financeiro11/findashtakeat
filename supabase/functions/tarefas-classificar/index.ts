// Edge Function: tarefas-classificar
//
// Propõe natureza / área / rotina para tarefas que o carimbo automático não
// conseguiu classificar. PROPÕE — não grava. Quem grava é a tela, depois que
// alguém confirmou, e é por isso que esta função não toca no banco: o carimbo
// que a Análise soma tem de ter um humano por trás, senão a leitura executiva
// vira IA lendo IA.
//
// É o mesmo desenho da Parametrização de contrapartes: a máquina levanta a
// hipótese, a pessoa decide, e o que ficou decidido (`cat_origem='manual'`) o
// automático nunca mais sobrescreve.
//
// POR QUE PRECISA DE IA. O regex do banco (`fn_classifica_texto`) resolve o que
// tem palavra-chave: "remessa" é Tesouraria, "rescisão" é Pessoas. Sobram ~23
// títulos que só um humano — ou um modelo com conhecimento de mundo — entende:
// "Situação KXC", "Problemão VERISURE", "FUP <> Miguel", "Slide DGF". Para esses,
// palavra-chave nenhuma vai funcionar, e é exatamente onde a IA ganha.
//
// Body: { tarefas: [{ id, titulo, observacao? }] }   // no máximo 60 por chamada
// Resposta: { propostas: [{ id, natureza, area, rotina, motivo, confianca }] }
//
// As tarefas vêm do cliente (que já as tem na tela) em vez de serem lidas aqui:
// sem acesso ao banco, esta função não tem como vazar nada que quem chamou já
// não pudesse ler.

import { requireUser } from "../_shared/auth.ts";
import { generateJSON, handleCors, jsonResponse, errorResponse } from "../_shared/openai.ts";

/* O vocabulário é FIXO e vive em três lugares que precisam concordar: aqui, em
   src/lib/tarefas/classificacao.ts (a tela) e em fn_classifica_texto (o banco).
   Se divergirem, a IA devolve uma área que o seletor não oferece e a aba Análise
   ganha uma fatia órfã — ela agrupa por igualdade exata da string. */
const NATUREZAS = ["Operacional", "Estratégico", "Automação"] as const;

const AREAS = [
  "Tesouraria",
  "Recebíveis",
  "Notas Fiscais",
  "Fechamento",
  "Auditoria",
  "Planejamento",
  "Pessoas & Folha",
  "Societário & Jurídico",
  "Facilities & Compras",
  "Sistema & Dados",
  "Editais",
  "Recargas",
  "Outros",
] as const;

/* O que cada rótulo QUER dizer. Sem isto o modelo classifica pelo nome — e
   "Planejamento" atrai qualquer coisa que pareça pensar no futuro, enquanto
   "Fechamento" fica vazio. As glosas são o contrato. */
const GLOSSARIO = `
NATUREZA (uma só, escolhida pelo VERBO da tarefa, não pelo assunto):
• Operacional — manter de pé o que já roda: pagar, conferir, emitir, conciliar,
  responder, organizar. Fechar a DRE de todo mês é Operacional.
• Estratégico — decidir para onde ir: analisar, planejar, negociar, preparar
  material de conselho/investidor, desenhar processo novo. ANALISAR a DRE é
  Estratégico.
• Automação — construir a máquina: automatizar um passo, montar RPA/agente/
  integração, mexer no Hub para que algo passe a rodar sozinho.

ÁREA (uma só — são os módulos do Hub Financeiro da Takeat):
• Tesouraria — pagamentos, remessa bancária, cartão corporativo, extratos,
  Sicoob/Banestes/Itaú, PIX, saldo, capital de giro, comprovantes, custos.
• Recebíveis — Asaas, cobrança, estorno, inadimplência, negativação, churn,
  assinaturas/MRR, faturas em aberto de clientes.
• Notas Fiscais — NF/NFS-e: emitir, corrigir, anexar, retenção, nota de
  fornecedor, recibo.
• Fechamento — DRE, DFC, balancete, balanço, plano de contas, competência,
  depreciação, contador, reclassificação contábil.
• Auditoria — achados, exceções, conciliação de auditoria, divergências.
• Planejamento — BP, orçamento, tracker, CAC, metas, cenários, reporte para
  conselho/investidor, pauta e preparação de reunião, calendário.
• Pessoas & Folha — folha, salário, rescisão, desligamento, admissão, vaga,
  estágio, PDI, benefícios, comissão/variável, proporcionais.
• Societário & Jurídico — contrato, minuta, acordo, procuração, captable, flip,
  holding, entidades no exterior (LLC/Ltd/Cayman), tax return, due diligence,
  documentos para investidor.
• Facilities & Compras — compra de equipamento, cotação, licença de software,
  fornecedor de facilities.
• Sistema & Dados — o próprio Hub, Supabase, GitHub, Vercel, MCP, RPA, APIs,
  integrações, estrutura de dados.
• Editais — fomento, FAPES/FINEP/BNDES/SEBRAE, prestação de contas de edital.
• Recargas — recarga de celular e de viagem.
• Outros — SÓ quando o título realmente não permite decidir. Use com parcimônia:
  é ela que a revisão existe para esvaziar.

ROTINA (verdadeiro/falso):
Verdadeiro quando o trabalho VOLTA sozinho — toda semana, todo mês, a cada
fatura, a cada remessa. "Relatório Caixa - Rotina Segunda", "Remessa 25/08" e
"Emissão de NFs de agosto" são rotina. Um contrato específico, uma negociação,
uma migração — não são.
`.trim();

const SISTEMA = `
Você classifica tarefas do time financeiro da Takeat (Henrique e Júlia) para um
painel interno em português do Brasil.

${GLOSSARIO}

REGRAS
1. Escolha SEMPRE um valor de cada lista literal — nunca invente rótulo, nunca
   traduza, nunca mude acento ou "&".
2. O título é curto e cheio de convenções internas: "A <> B" significa "assunto A
   com a pessoa/empresa B"; "[NOME]" é a frente ou a pessoa dona do assunto;
   "-->" indica destino ("NFs --> Omie" = levar as notas para o Omie).
3. O campo "motivo" tem no máximo 12 palavras e cita a evidência do título. Nada
   de "classificado como X porque parece X".
4. O campo "confianca" é "alta" quando o título nomeia o assunto, "media" quando você
   inferiu pelo contexto, "baixa" quando chutou. Prefira "baixa" + área "Outros"
   a fingir certeza: quem revisa consegue decidir rápido o que veio marcado como
   incerto, e não consegue desconfiar do que veio marcado como certo.
`.trim();

const SCHEMA = {
  type: "object",
  properties: {
    propostas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          natureza: { type: "string", enum: NATUREZAS as unknown as string[] },
          area: { type: "string", enum: AREAS as unknown as string[] },
          rotina: { type: "boolean" },
          motivo: { type: "string" },
          confianca: { type: "string", enum: ["alta", "media", "baixa"] },
        },
        required: ["id", "natureza", "area", "rotina", "motivo", "confianca"],
      },
    },
  },
  required: ["propostas"],
};

interface Entrada { id: string; titulo: string; observacao?: string | null }
interface Proposta {
  id: string; natureza: string; area: string; rotina: boolean;
  motivo: string; confianca: string;
}

/* 60 por chamada, e não "todas": o corte não é de contexto (cabem muitas mais),
   é de resposta — um lote grande demais volta cortado por `max_tokens` e o
   helper, com razão, prefere falhar a entregar meia lista. Quem chama pagina. */
const TETO_LOTE = 60;

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    await requireUser(req);

    const body = await req.json().catch(() => ({}));
    const entrada: Entrada[] = Array.isArray(body?.tarefas) ? body.tarefas : [];

    const tarefas = entrada
      .filter((t) => t && typeof t.id === "string" && typeof t.titulo === "string" && t.titulo.trim())
      .slice(0, TETO_LOTE)
      .map((t) => ({
        id: t.id,
        titulo: t.titulo.trim().slice(0, 200),
        observacao: (t.observacao ?? "").trim().slice(0, 300) || null,
      }));

    if (tarefas.length === 0) return jsonResponse({ propostas: [] });

    const lista = tarefas
      .map((t) => `- id=${t.id} | título: ${t.titulo}${t.observacao ? ` | observação: ${t.observacao}` : ""}`)
      .join("\n");

    const { propostas } = await generateJSON<{ propostas: Proposta[] }>({
      messages: [
        { role: "system", content: SISTEMA },
        {
          role: "user",
          content:
            `Classifique as ${tarefas.length} tarefas abaixo. Devolva uma proposta por id, ` +
            `na mesma ordem.\n\n${lista}`,
        },
      ],
      responseSchema: SCHEMA,
      temperature: 0.1,
      // ~90 tokens por proposta, com folga para o motivo.
      maxTokens: Math.min(16000, 200 + tarefas.length * 120),
      timeoutMs: 120000,
    });

    /* Cinto e suspensório sobre o Structured Outputs: um id que não estava no
       pedido, ou um rótulo fora da lista, é descartado aqui. A tela grava o que
       vier daqui — não vale a pena descobrir uma área inventada só quando ela
       aparecer como fatia órfã no gráfico. */
    const pedidos = new Set(tarefas.map((t) => t.id));
    const limpas = (Array.isArray(propostas) ? propostas : []).filter(
      (p) =>
        p && pedidos.has(p.id)
        && (NATUREZAS as unknown as string[]).includes(p.natureza)
        && (AREAS as unknown as string[]).includes(p.area),
    );

    return jsonResponse({ propostas: limpas });
  } catch (e) {
    if ((e as Error)?.message === "Não autenticado.") {
      return jsonResponse({ error: "Não autenticado." }, 401);
    }
    return errorResponse(e);
  }
});
