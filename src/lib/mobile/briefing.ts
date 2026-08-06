// Normalização do briefing para as três listas do celular (Agenda, E-mails, Notícias).
//
// O JSONB de `briefing_diario` é escrito por um agente (skill), não por um schema: os
// mesmos campos já apareceram como `summary`/`titulo`/`title`, `agenda.pessoas[]` ou
// `agenda.henrique[]`, `emails[]` ou `emails.itens[]`. As chaves reconhecidas aqui são as
// mesmas que src/pages/Briefing.tsx (desktop) já trata — quando aparecer um formato novo,
// os dois lugares precisam mudar juntos.

export type ItemAgenda = { hora: string; titulo: string; quem: string[] };
export type ItemEmail = { remetente: string; resumo: string; badge: string | null; link: string | null };
export type ItemNoticia = { titulo: string; resumo: string };

const CHAVES_IGNORADAS = new Set([
  "conflitos", "bloqueios_compartilhados", "data", "dia_semana", "total_compromissos",
  "total_pessoas", "proximo_evento", "resumo_ia", "resumo_tags", "timeline", "pessoas",
]);

const NOME_PESSOA: Record<string, string> = {
  financeiro: "Você", voce: "Você", henrique: "Henrique", julia: "Júlia",
};

const TEMA_TITULO: Record<string, string> = {
  macro: "Mercado financeiro / macro Brasil",
  tech_saas: "Tecnologia / SaaS", tech: "Tecnologia / SaaS", saas: "Tecnologia / SaaS",
  foodservice: "Restaurantes / foodservice", restaurantes: "Restaurantes / foodservice",
};

const semAcento = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

const hostDe = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "fonte"; } };

/** Extrai hora e título de um evento em qualquer um dos formatos já vistos. */
function lerEvento(ev: any): { hora: string; titulo: string; ordem: string } | null {
  if (ev == null) return null;
  if (typeof ev === "string") return { hora: "", titulo: ev, ordem: "99:99" };

  const titulo = ev.summary ?? ev.titulo ?? ev.title ?? ev.nome ?? "(sem título)";
  const bruto = ev.horario ?? ev.hora ?? ev.time ?? "";
  const diaTodo =
    !!(ev.all_day ?? ev.allDay ?? ev.dia_todo) ||
    (typeof bruto === "string" && /dia\s*todo|all[\s-]*day/i.test(bruto)) ||
    (!!ev.date && !ev.start && !bruto);

  if (diaTodo) return { hora: "dia todo", titulo, ordem: "00:00" };

  const noTexto = typeof bruto === "string" ? bruto.match(/(\d{1,2}:\d{2})/) : null;
  if (noTexto) return { hora: String(bruto).trim(), titulo, ordem: noTexto[1].padStart(5, "0") };

  const inicio = /[T\s](\d{1,2}:\d{2})/.exec(String(ev.start ?? ev.inicio ?? ""));
  if (inicio) {
    const fim = /[T\s](\d{1,2}:\d{2})/.exec(String(ev.end ?? ev.fim ?? ""));
    return { hora: fim ? `${inicio[1]}–${fim[1]}` : inicio[1], titulo, ordem: inicio[1].padStart(5, "0") };
  }
  return { hora: "", titulo, ordem: "99:99" };
}

export function lerAgenda(agenda: any): ItemAgenda[] {
  const a = agenda ?? {};
  const porPessoa: { nome: string; eventos: any[] }[] = [];

  if (Array.isArray(a.pessoas) && a.pessoas.length) {
    for (const p of a.pessoas) {
      porPessoa.push({ nome: p.nome ?? NOME_PESSOA[p.id] ?? p.id ?? "—", eventos: p.eventos ?? [] });
    }
  } else {
    for (const chave of Object.keys(a)) {
      if (CHAVES_IGNORADAS.has(chave) || !Array.isArray(a[chave])) continue;
      porPessoa.push({ nome: NOME_PESSOA[chave] ?? chave.charAt(0).toUpperCase() + chave.slice(1), eventos: a[chave] });
    }
  }

  // O mesmo compromisso aparece uma vez por pessoa (o calendário é compartilhado);
  // deduplica por título+hora e junta os participantes num item só.
  const mapa = new Map<string, ItemAgenda & { ordem: string }>();
  for (const pessoa of porPessoa) {
    for (const bruto of pessoa.eventos) {
      const ev = lerEvento(bruto);
      if (!ev) continue;
      const chave = `${semAcento(ev.titulo)}|${ev.hora}`;
      const atual = mapa.get(chave);
      if (atual) {
        if (!atual.quem.includes(pessoa.nome)) atual.quem.push(pessoa.nome);
      } else {
        mapa.set(chave, { hora: ev.hora, titulo: ev.titulo, quem: [pessoa.nome], ordem: ev.ordem });
      }
    }
  }

  return [...mapa.values()]
    .sort((x, y) => x.ordem.localeCompare(y.ordem))
    .map(({ hora, titulo, quem }) => ({ hora, titulo, quem }));
}

export function lerEmails(emails: any): ItemEmail[] {
  const lista: any[] = Array.isArray(emails) ? emails : (emails?.itens ?? []);
  return lista.map((e: any) => {
    if (e?.resumo || e?.tipo || e?.badge) {
      return { remetente: e.remetente ?? "—", resumo: e.resumo ?? "", badge: e.badge ?? null, link: e.link ?? null };
    }
    // formato da skill: { remetente, assunto, acao, data }
    const resumo = e?.assunto ? `**${e.assunto}** — ${e.acao ?? ""}` : (e?.acao ?? e?.resumo ?? "");
    return { remetente: e?.remetente ?? "—", resumo, badge: "AÇÃO", link: e?.link ?? null };
  });
}

export function lerNoticias(noticias: any): ItemNoticia[] {
  const n = noticias ?? {};
  if (Array.isArray(n.temas)) {
    return n.temas.map((t: any) => ({ titulo: t?.titulo ?? "", resumo: t?.resumo ?? "" }));
  }

  const ordem = ["macro", "tech_saas", "tech", "saas", "foodservice", "restaurantes"];
  const chaves = Object.keys(n).filter((k) => k !== "janela" && n[k] && typeof n[k] === "object");
  chaves.sort((x, y) => (ordem.indexOf(x) === -1 ? 99 : ordem.indexOf(x)) - (ordem.indexOf(y) === -1 ? 99 : ordem.indexOf(y)));

  return chaves.map((k) => {
    const t = n[k];
    let resumo: string = t.resumo ?? t.texto ?? "";
    const fontes: string[] = Array.isArray(t.fontes) ? t.fontes : (Array.isArray(t.links) ? t.links : []);
    if (fontes.length && !/\]\(/.test(resumo)) {
      resumo += ` (${fontes.map((u: string) => `[${hostDe(u)}](${u})`).join(", ")})`;
    }
    return { titulo: TEMA_TITULO[k] ?? k.replace(/_/g, " "), resumo };
  });
}
