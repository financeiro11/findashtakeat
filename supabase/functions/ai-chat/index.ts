import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  type ChatImage, type ChatMessage, corsHeaders, errorResponse, handleCors,
  jsonResponse, streamAsOpenAISSE,
} from "../_shared/gemini.ts";
import { buildOrgContext } from "../_shared/org-context.ts";
import { contextoAjustesEbitda } from "../_shared/ebitda-ajustado.ts";

type Msg = ChatMessage;

/* ---- Imagens anexadas -------------------------------------------------------------
 * O que a IA lê de uma imagem NUNCA é número conferido — por isso imagem só entra por
 * aqui, o caminho geral, e nunca pelo `assistente-responder`. A tela marca a resposta
 * como "lido da imagem".
 *
 * Os tetos abaixo existem porque o custo e o tempo de resposta crescem com a imagem, não
 * com a pergunta: uma conversa longa com print em toda mensagem reenviaria tudo a cada
 * turno. Sobram as MAIS RECENTES, que é o que a pessoa está olhando. */
const MIMES_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_IMAGENS = 6;
/** ~4,5 MB por imagem depois do base64. O cliente manda bem menos que isso. */
const MAX_BASE64 = 6_000_000;

/** Só entra no prompt quando há imagem — texto solto sobre imagem em conversa sem imagem
 *  faz o modelo inventar que viu alguma coisa. */
const INSTRUCAO_IMAGEM = `

A pessoa anexou uma ou mais IMAGENS (print de tela, foto de nota/comprovante, gráfico,
extrato, planilha). Leia o que está nelas e responda sobre o conteúdo delas.
- Diga sempre o que veio DA IMAGEM e o que veio dos dados internos. São coisas diferentes:
  número lido de imagem não é número conferido, e não pode ser apresentado como se fosse.
- Se algo estiver ilegível, cortado ou ambíguo, diga exatamente o que não deu para ler em
  vez de adivinhar o valor.
- Quando a imagem contradiz os dados internos, aponte a divergência com os dois valores em
  vez de escolher um.`;

/* ---- A tela de onde a pergunta veio -----------------------------------------------
 * O contexto amplo daqui é DRE, DFC, BP e histórico — e isso vira uma armadilha quando a
 * pergunta é de outra área: perguntada sobre o salto da fatura do cartão, a IA varria os
 * três anos de DRE e devolvia uma comparação de 2024 que ninguém pediu. Ter dado sobre
 * OUTRA coisa não é ter a resposta.
 *
 * A tela chega do painel (src/lib/contexto-pagina.ts) sem valores: diz onde a pessoa está
 * e qual é o recorte à vista. */
type Pagina = { rota?: string; tela?: string; resumo?: string };

function blocoTela(bruto: unknown): string {
  if (!bruto || typeof bruto !== "object") return "";
  const p = bruto as Pagina;
  const tela = String(p.tela ?? "").trim().slice(0, 120);
  const rota = String(p.rota ?? "").trim().slice(0, 120);
  const resumo = String(p.resumo ?? "").trim().slice(0, 1200);
  if (!tela && !rota) return "";

  return `

A PERGUNTA VEIO DESTA TELA: ${tela || rota}${rota && tela ? ` (${rota})` : ""}
${resumo ? `O QUE ESTÁ À VISTA: ${resumo}` : ""}
- Responda sobre a área DESTA tela. Quem pergunta "por que subiu?" olhando a fatura do
  cartão está perguntando da fatura, não do EBITDA.
- Se você não tem os dados desta área aqui, diga isso em UMA frase e ofereça o que tem.
  NÃO troque a pergunta por uma fonte parecida: varrer DRE e DFC quando a pergunta era da
  fatura do cartão não é meia resposta, é resposta errada.
- Mês sem ano é o ano corrente (ou o do período à vista). Não compare anos diferentes a
  menos que a pergunta peça isso com todas as letras.`;
}

function sanitizarImagens(messages: Msg[]): Msg[] {
  let restantes = MAX_IMAGENS;
  const invertido = [...messages].reverse().map((m) => {
    const brutas = Array.isArray(m.imagens) ? m.imagens : [];
    const validas: ChatImage[] = [];
    for (const img of brutas) {
      if (restantes <= 0) break;
      const data = typeof img?.data === "string" ? img.data : "";
      const mimeType = String(img?.mimeType ?? "");
      if (!data || data.length > MAX_BASE64 || !MIMES_ACEITOS.has(mimeType)) continue;
      validas.push({ mimeType, data });
      restantes--;
    }
    return { role: m.role, content: String(m.content ?? ""), imagens: validas };
  });
  return invertido.reverse();
}

async function buildContext(supabase: any): Promise<string> {
  const parts: string[] = [];
  const { data: dem } = await supabase
    .from("demonstracoes_contabeis")
    .select("tipo,periodo,dados,observacao,updated_at")
    .order("updated_at", { ascending: false });
  const byTipo: Record<string, any[]> = {};
  for (const d of dem ?? []) (byTipo[d.tipo] ||= []).push(d);
  for (const tipo of Object.keys(byTipo)) {
    for (const d of byTipo[tipo].slice(0, 6)) {
      const rows = Array.isArray(d.dados) ? d.dados.slice(0, 200) : d.dados;
      parts.push(`### ${tipo.toUpperCase()} — período ${d.periodo}${d.observacao ? ` (${d.observacao})` : ""}\n${JSON.stringify(rows)}`);
    }
  }
  // O blob acima já traz a linha "EBITDA Ajustado"; isto traz o PORQUÊ de cada
  // ajuste — sem ele a IA explica como queda de rentabilidade o que foi uma
  // rescisão que não se repete.
  const ajustes = await contextoAjustesEbitda(supabase);
  if (ajustes) parts.push(ajustes);
  const { data: ed } = await supabase.from("editais").select("titulo,orgao,modalidade,numero,objeto,valor_estimado,data_publicacao,data_abertura,prazo_envio,status,responsavel,observacao").limit(100);
  if (ed?.length) parts.push(`### Editais\n${JSON.stringify(ed)}`);
  const { data: bk } = await supabase.from("base_conhecimento").select("titulo,tipo,conteudo").limit(40);
  if (bk?.length) parts.push(`### Base de Conhecimento\n${bk.map((b: any) => `- [${b.tipo}] ${b.titulo}: ${b.conteudo}`).join("\n")}`);
  const { data: cen } = await supabase.from("cenarios").select("nome,descricao,premissas,analise").limit(10);
  if (cen?.length) parts.push(`### Cenários\n${JSON.stringify(cen)}`);
  const { data: bp } = await supabase.from("bp_anual").select("ano,dados,observacao").limit(5);
  if (bp?.length) parts.push(`### BP Anual\n${JSON.stringify(bp)}`);
  const { data: hist } = await supabase.from("historico_financeiro").select("metrica,ano,mes,valor,origem").order("ano").order("mes").limit(5000);
  if (hist?.length) {
    const agg = new Map<string, number>();
    for (const r of hist as any[]) {
      const k = `${r.metrica}|${r.ano}`;
      agg.set(k, (agg.get(k) || 0) + Number(r.valor));
    }
    const resumo = Array.from(agg.entries()).map(([k, v]) => {
      const [metrica, ano] = k.split("|");
      return { metrica, ano: +ano, total: v };
    });
    parts.push(`### Histórico Financeiro (totais por ano)\n${JSON.stringify(resumo)}`);
    parts.push(`### Histórico Financeiro (mensal, primeiros 1500)\n${JSON.stringify((hist as any[]).slice(0, 1500))}`);
  }
  return parts.join("\n\n");
}

Deno.serve(async (req) => {
  const pre = handleCors(req); if (pre) return pre;
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);

    const { messages, pagina } = await req.json() as { messages: Msg[]; pagina?: unknown };
    if (!Array.isArray(messages) || messages.length === 0) return jsonResponse({ error: "messages obrigatório" }, 400);

    const conversa = sanitizarImagens(messages);
    const temImagem = conversa.some((m) => (m.imagens?.length ?? 0) > 0);
    const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

    const [ctx, org] = await Promise.all([buildContext(supabase), buildOrgContext(supabase)]);
    const system = `Você é o assistente financeiro da Takeat. Hoje é ${hoje}. Responda em português brasileiro, direto, com números formatados em R$ e %. Use markdown e bullet points quando ajudar a leitura. Você tem acesso a TODOS os dados da empresa: DRE, DFC, Balancete, Balanço, BP Anual, Cenários, Histórico Financeiro, Editais, Base de Conhecimento e ao contexto organizacional (Biblioteca: colaboradores, departamentos, fornecedores, políticas). Baseie-se SEMPRE nos dados reais abaixo. Se a informação não estiver disponível, diga claramente.${blocoTela(pagina)}${temImagem ? INSTRUCAO_IMAGEM : ""}\n\n${org}\n\n=== DADOS FINANCEIROS ===\n${ctx}`;

    return await streamAsOpenAISSE({
      messages: [{ role: "system", content: system }, ...conversa],
      temperature: 0.4,
    });
  } catch (e) {
    return errorResponse(e);
  }
});
