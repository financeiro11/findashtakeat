// Edge Function: hub-novidades-sync
//
// Monta as "Novidades do Hub" — o que mudou na PRÓPRIA ferramenta, dia a dia —
// a partir dos commits do repositório no GitHub.
//
// POR QUE O GIT É A FONTE: um changelog escrito à mão sobrevive duas semanas.
// Os commits deste repositório, ao contrário, já são texto em português dizendo
// o que mudou e por quê (assunto + corpo longo). Falta só condensar para quem
// não lê commit. O caminho é sempre o mesmo:
//
//   commits do dia  →  sinal determinístico (dia, hora, autor, arquivos, rota)
//                   →  IA só REDIGE (título curto + "o que muda para você")
//
// A IA não decide o que existe: ela recebe a lista fechada de commits e devolve
// itens que apontam para shas dessa lista. Sha que ela não citar vira item
// sozinho, com o assunto do commit — nenhuma mudança some por causa da redação.
// Sem OPENAI_API_KEY, ou com a IA fora do ar, o dia sai inteiro nesse plano B.
//
// Body (tudo opcional):
//   { dias?: number = 2 }        → hoje + os N-1 dias anteriores (BRT)
//   { dia?: "YYYY-MM-DD" }       → um dia só
//   { forcar?: boolean }         → reprocessa dia fechado que já tem linha
//   { max_commits?: number = 40 } teto de commits lidos em detalhe por dia
//
// Resposta: { ok, dias: [{ dia, commits, itens, redigido_por, pulado? }], ms }
//
// Autenticação: usuário logado (botão "Atualizar" da tela) OU header
// `x-cron-token` casando com `internal_cron_tokens` (agendamento das 08:35 BRT).
//
// Segredos: GITHUB_TOKEN é OPCIONAL — sem ele a API do GitHub responde como
// anônima (repositório é público) com teto de 60 chamadas/hora POR IP, que é
// compartilhado entre as Edge Functions. Um dia com 28 commits gasta 29. Com o
// token, o teto vira 5.000/h. Quando o teto estoura, a função não inventa: ela
// devolve o erro dizendo a que horas o limite se renova.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, temChave } from "../_shared/openai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const REPO = Deno.env.get("GITHUB_REPO") || "financeiro11/findashtakeat";
const BRANCH = Deno.env.get("GITHUB_BRANCH") || "main";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") || Deno.env.get("CHAVE_GITHUB") || "";

/* ------------------------------- datas (BRT) ------------------------------- */
// O Brasil não tem mais horário de verão desde 2019, então o fuso é -03:00 fixo
// e a janela do dia pode ser escrita direto no ISO que o GitHub aceita.
const hojeBRT = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const diaISO = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const somaDias = (dia: string, n: number) => {
  const [y, m, d] = dia.split("-").map(Number);
  return diaISO(new Date(Date.UTC(y, m - 1, d + n, 12)));
};
const horaBRT = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/* --------------------------- de arquivo para tela --------------------------- */
// Qual tela do Hub aquele arquivo é. É um PALPITE, e assumido como tal: quando
// erra, o item perde o link "abrir a tela" — não mente sobre a mudança. A ordem
// importa (a primeira regra que casa vence), por isso o que é mais específico
// vem antes do que é mais genérico.
const MAPA: { re: RegExp; area: string; rota: string | null }[] = [
  { re: /pages\/Briefing|briefing/i,                          area: "Briefing",            rota: "/briefing" },
  { re: /novidades/i,                                          area: "Novidades do Hub",    rota: "/briefing/novidades" },
  { re: /pages\/Tarefas|components\/tarefas|lib\/tarefas/i,    area: "Tarefas",             rota: "/tarefas" },
  { re: /revisao|apresentac/i,                                 area: "Revisão Mensal",      rota: "/apresentacoes/revisao" },
  { re: /reportes/i,                                           area: "Reportes",            rota: "/apresentacoes/reportes" },
  { re: /pages\/DFC|dfc/i,                                     area: "DFC",                 rota: "/demonstracoes/dfc" },
  { re: /pages\/DRE|demonstracoes|dre/i,                       area: "DRE",                 rota: "/demonstracoes/dre" },
  { re: /balancete/i,                                          area: "Balancete",           rota: "/demonstracoes/balancete" },
  { re: /balanco/i,                                            area: "Balanço",             rota: "/demonstracoes/balanco" },
  { re: /auditoria/i,                                          area: "Auditoria",           rota: "/governanca/auditoria" },
  { re: /cartao|cartão/i,                                      area: "Cartão",              rota: "/operacional/cartao" },
  { re: /nfse|nota[-_]?fiscal|notas-fiscais/i,                 area: "Notas Fiscais",       rota: "/operacional/notas-fiscais" },
  { re: /estorno/i,                                            area: "Estornos",            rota: "/operacional/estornos" },
  { re: /asaas/i,                                              area: "Asaas",               rota: "/asaas" },
  { re: /assinatura|churn/i,                                   area: "Assinaturas",         rota: "/assinaturas" },
  { re: /caixa|conta-?corrente|sicoob/i,                       area: "Caixa",               rota: "/caixa" },
  { re: /orcamento|orçamento/i,                                area: "Orçamento",           rota: "/orcamento" },
  { re: /parceiro/i,                                           area: "Parceiros",           rota: "/operacional/parceiros" },
  { re: /facilities/i,                                         area: "Facilities",          rota: "/facilities" },
  { re: /editais/i,                                            area: "Radar de Editais",    rota: "/editais" },
  { re: /parametrizacao|apelido/i,                             area: "Parametrização",      rota: "/configuracoes/parametrizacao" },
  { re: /rescis/i,                                             area: "Rescisões",           rota: "/governanca/rescisoes" },
  { re: /\bcac\b/i,                                            area: "Painel CAC",          rota: "/governanca/cac" },
  { re: /playbook|pages\/.*Nota|notas/i,                       area: "Anotações",           rota: "/playbook" },
  { re: /investimento/i,                                       area: "Investimentos",       rota: "/investimentos" },
  { re: /captable/i,                                           area: "Captable",            rota: "/captable" },
  { re: /\bbp\b|business-?plan/i,                              area: "BP",                  rota: "/bp/versoes" },
  { re: /time|colaborador/i,                                   area: "Time Financeiro",     rota: "/time/visao" },
  { re: /automac/i,                                            area: "Automações",          rota: "/automacoes/projetos" },
  { re: /recarga/i,                                            area: "Recargas",            rota: "/recargas/celulares" },
  { re: /assistente|ai-chat|AIAssistant/i,                     area: "Assistente",          rota: null },
  { re: /mobile/i,                                             area: "Celular",             rota: null },
  { re: /AppSidebar|navegacao|PageHeader|AppLayout|CommandMenu/i, area: "Navegação",        rota: null },
  { re: /pages\/Dashboard|pages\/Index/i,                      area: "Dashboard",           rota: "/" },
  { re: /usuarios|useAuth|login/i,                             area: "Acesso",              rota: "/usuarios" },
  { re: /tokens\.css|index\.css|design-system|components\/ui\//i, area: "Design",           rota: "/design-system" },
];

/** Catálogo de rotas que a IA pode escolher (e que a gente valida na volta). */
const ROTAS_VALIDAS = new Set(MAPA.map((m) => m.rota).filter(Boolean) as string[]);
const AREA_DA_ROTA = new Map(MAPA.filter((m) => m.rota).map((m) => [m.rota as string, m.area]));

/** A área de um commit: a regra que mais arquivos dele acionam; empate fica com
 *  a primeira do MAPA. Se nenhum arquivo casar, tenta o assunto ("Tarefas: …"). */
function areaDoCommit(arquivos: string[], assunto: string) {
  const placar = new Map<number, number>();
  for (const f of arquivos) {
    const i = MAPA.findIndex((m) => m.re.test(f));
    if (i >= 0) placar.set(i, (placar.get(i) ?? 0) + 1);
  }
  let melhor = -1, melhorN = 0;
  for (const [i, n] of placar) if (n > melhorN || (n === melhorN && melhor >= 0 && i < melhor)) { melhor = i; melhorN = n; }
  if (melhor < 0) melhor = MAPA.findIndex((m) => m.re.test(assunto.split("\n")[0]));
  if (melhor < 0) return { area: "Bastidor", rota: null as string | null };
  return { area: MAPA[melhor].area, rota: MAPA[melhor].rota };
}

/* ---------------------------------- GitHub ---------------------------------- */
type Commit = {
  sha: string; assunto: string; corpo: string; autor: string; data: string;
  url: string; arquivos: string[]; area: string; rota: string | null;
};

class GitHubError extends Error {}

async function gh(path: string): Promise<any> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "findash-hub-novidades",
      ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
    },
  });
  if (r.status === 403 || r.status === 429) {
    const reset = Number(r.headers.get("x-ratelimit-reset") ?? 0);
    const quando = reset ? ` O limite se renova às ${horaBRT(new Date(reset * 1000).toISOString())}.` : "";
    throw new GitHubError(
      `O GitHub recusou a leitura por excesso de chamadas.${quando}` +
      (GH_TOKEN ? "" : " Cadastrar o segredo GITHUB_TOKEN no Supabase eleva o teto de 60 para 5.000 por hora."),
    );
  }
  if (!r.ok) throw new GitHubError(`GitHub respondeu ${r.status} em ${path}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

/** Tira do corpo do commit o que é assinatura de ferramenta, não conteúdo. */
const limparCorpo = (msg: string) =>
  msg.split("\n").slice(1).join("\n")
    .replace(/^Co-Authored-By:.*$/gim, "")
    .replace(/^🤖 Generated with.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

async function commitsDoDia(dia: string, maxDetalhe: number): Promise<Commit[]> {
  const lista: any[] = await gh(
    `/repos/${REPO}/commits?sha=${encodeURIComponent(BRANCH)}` +
    `&since=${dia}T00:00:00-03:00&until=${dia}T23:59:59-03:00&per_page=100`,
  );

  // Merge (mais de um pai) não é mudança: é costura de branch. Some da lista.
  const uteis = (Array.isArray(lista) ? lista : [])
    .filter((c) => (c?.parents?.length ?? 1) <= 1)
    .filter((c) => String(c?.commit?.message ?? "").trim().length > 0);

  const out: Commit[] = [];
  for (const [i, c] of uteis.entries()) {
    const msg = String(c.commit.message);
    const assunto = msg.split("\n")[0].trim();
    // Os arquivos só vêm no detalhe — UMA chamada por commit. Passado o teto,
    // o commit entra sem a lista de arquivos (a área sai do assunto) em vez de
    // a função inteira parar no meio do dia.
    let arquivos: string[] = [];
    if (i < maxDetalhe) {
      try {
        const det = await gh(`/repos/${REPO}/commits/${c.sha}`);
        arquivos = (det?.files ?? []).map((f: any) => String(f.filename)).slice(0, 60);
      } catch (e) {
        if (e instanceof GitHubError && /excesso de chamadas/.test(e.message)) break; // sem detalhe daqui pra frente
        throw e;
      }
    }
    const { area, rota } = areaDoCommit(arquivos, assunto);
    out.push({
      sha: String(c.sha), assunto, corpo: limparCorpo(msg).slice(0, 1400),
      autor: String(c.commit?.author?.name ?? "—"),
      data: String(c.commit?.author?.date ?? ""),
      url: String(c.html_url ?? `https://github.com/${REPO}/commit/${c.sha}`),
      arquivos, area, rota,
    });
  }
  // do mais antigo para o mais novo: é como se lê a história de um dia
  return out.reverse();
}

/* --------------------------------- redação --------------------------------- */
type Item = {
  titulo: string; o_que_muda: string; tipo: string;
  area: string; rota: string | null; commits: string[]; hora: string;
};

const TIPOS = new Set(["novidade", "melhoria", "correcao", "bastidor"]);

/** Plano B (e rede de segurança do plano A): o commit vira item sozinho. */
function itemDoCommit(c: Commit): Item {
  const primeiroParagrafo = c.corpo.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  const s = c.assunto.toLowerCase();
  const tipo = /corrig|conserta|arruma|deixa de|para de|volta a|não .*(some|quebra)/.test(s)
    ? "correcao"
    : /agora|passa a|ganha|vira|nova|novo/.test(s) ? "novidade" : "melhoria";
  return {
    titulo: c.assunto.slice(0, 120),
    o_que_muda: primeiroParagrafo.slice(0, 400),
    tipo: c.area === "Bastidor" ? "bastidor" : tipo,
    area: c.area, rota: c.rota, commits: [c.sha], hora: c.data ? horaBRT(c.data) : "",
  };
}

const SISTEMA = `Você escreve o "o que mudou no Hub" para duas pessoas do time financeiro da Takeat
(Henrique, gerente, e Júlia, analista). Elas USAM a ferramenta todo dia e NÃO programam.

O Hub é a Central do Financeiro: DRE, DFC, Caixa, Auditoria, Cartão, Asaas, Assinaturas,
Notas Fiscais, Tarefas, Briefing, Facilities, Editais.

Você recebe os commits de UM dia (assunto, corpo explicando o porquê, arquivos, área) e
devolve a lista de mudanças que essas duas pessoas percebem.

REGRAS
- Escreva em português do Brasil, na voz do produto: "a coluna agora ordena por prioridade",
  não "refatorado o sort do kanban".
- Um item por mudança percebida. Commits que são a mesma mudança (mesma tela, mesmo assunto,
  ajuste em cima do anterior) viram UM item, citando todos os shas.
- "titulo": até 70 caracteres, sem nome de arquivo, função, tabela ou biblioteca.
- "o_que_muda": 1 a 2 frases. O que ela vê de diferente na tela e o que ganha com isso.
  Quando o commit explica o motivo, use o motivo — é o que faz a mudança fazer sentido.
- "tipo": "novidade" (não existia), "melhoria" (existia e ficou melhor),
  "correcao" (estava errado e voltou ao lugar), "bastidor" (nada muda na tela:
  migração, cron, deploy, tipo, teste, organização interna do código).
- "rota": o endereço da tela onde a mudança aparece, escolhido do catálogo. Se não aparece
  em tela nenhuma, use null.
- NÃO INVENTE. Se o commit não diz, não diga. Nada de promessa de ganho que não está escrita.
- "resumo": UMA frase sobre o dia inteiro, sem número inventado.`;

const ESQUEMA = {
  type: "object",
  properties: {
    resumo: { type: "string" },
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          o_que_muda: { type: "string" },
          tipo: { type: "string", enum: ["novidade", "melhoria", "correcao", "bastidor"] },
          rota: { type: "string" },
          commits: { type: "array", items: { type: "string" } },
        },
        required: ["titulo", "o_que_muda", "tipo", "commits"],
      },
    },
  },
  required: ["resumo", "itens"],
};

async function redigir(dia: string, commits: Commit[]): Promise<{ resumo: string; itens: Item[]; por: string }> {
  const porSha = new Map(commits.map((c) => [c.sha, c]));
  const plano_b = () => ({
    resumo: `${commits.length} mudança${commits.length === 1 ? "" : "s"} no Hub.`,
    itens: commits.map(itemDoCommit),
    por: "commits",
  });
  if (!temChave() || commits.length === 0) return plano_b();

  const catalogo = [...ROTAS_VALIDAS].map((r) => `${r} (${AREA_DA_ROTA.get(r)})`).join(", ");
  const corpoPrompt = commits.map((c) => [
    `### ${c.sha.slice(0, 7)} · ${horaBRT(c.data)} · ${c.autor} · área ${c.area}`,
    c.assunto,
    c.corpo ? c.corpo : "(sem corpo)",
    c.arquivos.length ? `arquivos: ${c.arquivos.slice(0, 12).join(", ")}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");

  let bruto: { resumo?: string; itens?: any[] };
  try {
    bruto = await generateJSON({
      consumidor: "rotina_diaria",
      messages: [
        { role: "system", content: SISTEMA },
        {
          role: "user",
          content:
            `Dia ${dia}. Catálogo de rotas: ${catalogo}\n\n` +
            `Commits do dia (do mais antigo para o mais novo):\n\n${corpoPrompt}`,
        },
      ],
      responseSchema: ESQUEMA,
      temperature: 0.3,
      maxTokens: 4000,
    });
  } catch (e) {
    console.error("redação falhou, caindo no assunto do commit:", (e as Error)?.message);
    return plano_b();
  }

  const usados = new Set<string>();
  const itens: Item[] = [];
  for (const it of (bruto.itens ?? [])) {
    // Só valem shas do dia — a redação não pode inventar mudança.
    const shas = (Array.isArray(it?.commits) ? it.commits : [])
      .map((s: unknown) => String(s ?? "").trim())
      .map((s: string) => commits.find((c) => c.sha === s || c.sha.startsWith(s))?.sha)
      .filter((s: string | undefined): s is string => !!s);
    if (!shas.length || !String(it?.titulo ?? "").trim()) continue;
    shas.forEach((s) => usados.add(s));

    const base = porSha.get(shas[0])!;
    const rota = ROTAS_VALIDAS.has(String(it?.rota ?? "")) ? String(it.rota) : base.rota;
    itens.push({
      titulo: String(it.titulo).trim().slice(0, 120),
      o_que_muda: String(it?.o_que_muda ?? "").trim().slice(0, 500),
      tipo: TIPOS.has(String(it?.tipo)) ? String(it.tipo) : "melhoria",
      area: (rota && AREA_DA_ROTA.get(rota)) || base.area,
      rota,
      commits: shas,
      hora: base.data ? horaBRT(base.data) : "",
    });
  }
  // Sha que a IA não citou entra pelo caminho determinístico: o dia mostra tudo
  // o que aconteceu, mesmo quando a redação esquece uma linha.
  for (const c of commits) if (!usados.has(c.sha)) itens.push(itemDoCommit(c));

  itens.sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
  return { resumo: String(bruto.resumo ?? "").trim(), itens, por: itens.length ? "ia" : "commits" };
}

/* --------------------------------- handler --------------------------------- */
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "hub-novidades-sync").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (!(await chamadaDeCron(req, supabase))) {
      await requireUser(req);
    }

    const body = await req.json().catch(() => ({}));
    const maxDetalhe = Math.max(1, Math.min(100, Number(body?.max_commits) || 40));
    const forcar = !!body?.forcar;

    const hoje = hojeBRT();
    const alvos: string[] = body?.dia
      ? [String(body.dia)]
      : Array.from({ length: Math.max(1, Math.min(14, Number(body?.dias) || 2)) }, (_, i) => somaDias(hoje, -i));

    const resultado: any[] = [];
    for (const dia of alvos) {
      // Dia fechado que já foi lido não se relê: o passado não muda, e cada
      // releitura custa chamadas do GitHub e uma redação da IA.
      if (!forcar && dia < hoje) {
        const { data: ja } = await supabase
          .from("hub_novidades").select("dia,gerado_em").eq("dia", dia).maybeSingle();
        // comparação em instante, não em texto: `gerado_em` volta em UTC e o fim
        // do dia está escrito em -03:00 — comparar as strings daria falso.
        const fimDoDia = new Date(`${dia}T23:59:59-03:00`).getTime();
        if (ja?.gerado_em && new Date(ja.gerado_em).getTime() > fimDoDia) {
          resultado.push({ dia, pulado: "já lido" });
          continue;
        }
      }

      const commits = await commitsDoDia(dia, maxDetalhe);
      const { resumo, itens, por } = await redigir(dia, commits);

      const { error } = await supabase.from("hub_novidades").upsert({
        dia,
        resumo: resumo || null,
        itens,
        commits: commits.map((c) => ({
          sha: c.sha, assunto: c.assunto, autor: c.autor, data: c.data, url: c.url,
          arquivos: c.arquivos.slice(0, 20), area: c.area,
        })),
        n_commits: commits.length,
        redigido_por: por,
        gerado_em: new Date().toISOString(),
      }, { onConflict: "dia" });
      if (error) throw new Error(`Falha ao gravar o dia ${dia}: ${error.message}`);

      resultado.push({ dia, commits: commits.length, itens: itens.length, redigido_por: por });
    }

    return json({ ok: true, dias: resultado, ms: Date.now() - t0 });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("hub-novidades-sync:", msg);
    return json({ ok: false, erro: msg }, e instanceof GitHubError ? 502 : 400);
  }
});
