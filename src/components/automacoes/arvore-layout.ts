/* ============================================================================
 * Árvore de Automações — dados, geometria e cálculo do desenho.
 *
 * Fica separado do componente de propósito: é a parte que erra em silêncio
 * (posição sobreposta, banda fantasma, corrente que não fecha) e a que dá para
 * testar sem montar o React. Ver ArvoreAutomacoes.test.ts.
 * ========================================================================== */

export type Automacao = {
  id: string;
  automacao: string;
  categoria: string | null;
  nivel: number | null;
  status: string;
  horas_mes: number | null;
  ferramentas: string | null;
  responsavel: string | null;
  impacto: string | null;
  dor: string | null;
  solucao: string | null;
  observacao: string | null;
  depende_de?: string | null;
  pos_x?: number | null;
  pos_y?: number | null;
  icone?: string | null;
  ordem: number;
};

/** Nível da pirâmide — vem da tabela `automacoes_niveis`, não do código. */
export type Nivel = { n: number; nome: string; bullets?: string[] };

/* ------------------------------- trilhas -------------------------------
 * Uma trilha agrupa categorias afins — é o "galho grosso" da árvore. Toda
 * categoria que não estiver aqui vira uma trilha própria, então criar uma
 * categoria nova no editor cria um galho novo sem precisar mexer no código. */
export const TRILHAS: { nome: string; cor: string; categorias: string[] }[] = [
  { nome: "Inteligência & IA", cor: "#f43f5e", categorias: ["IA & Categorização", "Dashboard"] },
  { nome: "Pagamentos & Notas", cor: "#8b5cf6", categorias: ["Pagamentos & Cobrança", "Notas Fiscais", "Reembolsos"] },
  { nome: "Reportes & FP&A", cor: "#38bdf8", categorias: ["Reportes & DRE", "Fechamento Mensal"] },
  { nome: "Comunicação & Radar", cor: "#f59e0b", categorias: ["Comunicação Interna", "Editais"] },
];
const CAT_FALLBACK = ["#2dd4bf", "#818cf8", "#ec4899", "#a3e635", "#fb923c", "#22d3ee"];

export function trilhaDe(categoria: string | null): string {
  const c = categoria || "Sem categoria";
  return TRILHAS.find((t) => t.categorias.includes(c))?.nome ?? c;
}

export function corTrilha(nome: string): string {
  const t = TRILHAS.find((x) => x.nome === nome);
  if (t) return t.cor;
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return CAT_FALLBACK[h % CAT_FALLBACK.length];
}

/* ---------------------------- status do nó ---------------------------- */
export type Tier = "on" | "wip" | "todo";
const STATUS_TIER: Record<string, Tier> = {
  "Rodando": "on",
  "Em teste": "wip",
  "Em andamento": "wip",
  "A fazer": "todo",
  "Ideias": "todo",
};
export const STATUS_OPTS = ["Ideias", "A fazer", "Em andamento", "Em teste", "Rodando"];
export const tierDe = (s: string): Tier => STATUS_TIER[s] ?? "todo";
export const TIER_META: Record<Tier, { cor: string; label: string }> = {
  on: { cor: "#34d399", label: "Rodando" },
  wip: { cor: "#fbbf24", label: "Em teste / andamento" },
  todo: { cor: "#7c8698", label: "Ideia / a fazer" },
};

/* ---------------------------- níveis (pirâmide) ----------------------------
 * Usado só como semente/fallback quando a tabela `automacoes_niveis` ainda não
 * respondeu. A fonte da verdade é o banco — criar um nível novo lá faz a banda
 * aparecer na árvore sozinha. */
export const NIVEIS_PADRAO: Nivel[] = [
  { n: 1, nome: "Fundação Operacional" },
  { n: 2, nome: "Controles & Auditoria" },
  { n: 3, nome: "Relatórios, Insights & FP&A" },
  { n: 4, nome: "Projeções & Cenários" },
  { n: 5, nome: "Financeiro Autônomo" },
];

/** bandas da base para o topo (0 = ainda sem nível definido, fica no topo) */
export function bandasDe(niveis: Nivel[]) {
  return [
    ...[...niveis].sort((a, b) => a.n - b.n).map((x) => ({ k: x.n, label: `N${x.n} · ${x.nome.toUpperCase()}` })),
    { k: 0, label: "SEM NÍVEL AINDA" },
  ];
}
export const nomeNivel = (niveis: Nivel[], n: number | null | undefined) =>
  n ? `N${n} · ${(niveis.find((x) => x.n === n)?.nome ?? "").toUpperCase()}` : "SEM NÍVEL";

/* ----------------------------- geometria ----------------------------- */
export const COL_W = 320;   // largura da trilha
export const ROW_H = 128;   // altura de uma linha de nós
export const DX = 74;       // deslocamento do nó em relação ao tronco
export const PAD_X = 150;   // respiro lateral (rótulos das bandas moram aqui)
const PAD_TOP = 90;
const HUB_H = 190;          // espaço do hub abaixo da última linha

export type NoPos = {
  r: Automacao; x: number; y: number; trilha: string; cor: string; tier: Tier;
  banda: number; fixo: boolean; // fixo = posição salva pelo usuário (arrastado)
};

const ordemTier: Record<Tier, number> = { on: 0, wip: 1, todo: 2 };
export const horasDe = (r: Automacao) => Number(r.horas_mes) || 0;
/** nível válido do registro — 0 quando não há nível ou o nível não existe mais */
export const bandaDe = (r: Automacao, niveis: Nivel[] = NIVEIS_PADRAO) =>
  r.nivel && niveis.some((x) => x.n === r.nivel) ? r.nivel : 0;

/**
 * Posiciona cada automação em trilha (X) × banda de nível (Y), com o hub embaixo.
 * Quem tem pos_x/pos_y salvos (arrastado pelo usuário) usa a posição salva; o
 * resto é calculado. O canvas cresce para caber os nós arrastados para fora.
 */
export function montarLayout(rows: Automacao[], niveis: Nivel[] = NIVEIS_PADRAO) {
  const BANDAS = bandasDe(niveis);
  const banda = (r: Automacao) => bandaDe(r, niveis); // liga o nível ao conjunto recebido
  const trilhas = Array.from(new Set(rows.map((r) => trilhaDe(r.categoria)))).sort((a, b) => {
    const ia = TRILHAS.findIndex((t) => t.nome === a), ib = TRILHAS.findIndex((t) => t.nome === b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, "pt-BR");
  });

  // Só entram as bandas que têm alguma automação — evita canvas vazio.
  const bandasPresentes = BANDAS.filter((b) => rows.some((r) => banda(r) === b.k));

  // Altura de cada banda = maior "pilha" de uma trilha dentro dela (nós em ziguezague, 2 por linha).
  const linhasPorBanda = bandasPresentes.map((b) => {
    const maxNaBanda = Math.max(
      1,
      ...trilhas.map((t) => rows.filter((r) => trilhaDe(r.categoria) === t && banda(r) === b.k).length),
    );
    return Math.ceil(maxNaBanda / 2);
  });

  const totalLinhas = linhasPorBanda.reduce((a, c) => a + c, 0);
  let W = PAD_X * 2 + Math.max(1, trilhas.length) * COL_W;
  let H = PAD_TOP + totalLinhas * ROW_H + HUB_H;
  const hubY = H - HUB_H / 2;
  const hubX = W / 2;

  // y da 1ª linha de cada banda, contando de baixo para cima
  const inicioBanda: number[] = [];
  let acc = 0;
  bandasPresentes.forEach((_, i) => { inicioBanda[i] = acc; acc += linhasPorBanda[i]; });
  const yDaLinha = (linhaGlobal: number) => hubY - HUB_H / 2 - 30 - linhaGlobal * ROW_H;

  const nos: NoPos[] = [];
  trilhas.forEach((t, ti) => {
    const colX = PAD_X + ti * COL_W + COL_W / 2;
    bandasPresentes.forEach((b, bi) => {
      const daCelula = rows
        .filter((r) => trilhaDe(r.categoria) === t && banda(r) === b.k)
        .sort((a, z) =>
          ordemTier[tierDe(a.status)] - ordemTier[tierDe(z.status)] ||
          (a.automacao || "").localeCompare(z.automacao || "", "pt-BR"),
        );
      daCelula.forEach((r, k) => {
        const linha = inicioBanda[bi] + Math.floor(k / 2);
        // nó sozinho na linha fica centrado no tronco; em par, um de cada lado
        const sozinho = k === daCelula.length - 1 && k % 2 === 0;
        const lado = sozinho ? 0 : k % 2 === 0 ? -1 : 1;
        const fixo = r.pos_x != null && r.pos_y != null;
        nos.push({
          r, trilha: t, cor: corTrilha(t), tier: tierDe(r.status), banda: b.k, fixo,
          x: fixo ? (r.pos_x as number) : colX + lado * DX,
          y: fixo ? (r.pos_y as number) : yDaLinha(linha),
        });
      });
    });
  });

  // o canvas precisa caber quem foi arrastado para fora da área calculada
  nos.forEach((n) => {
    W = Math.max(W, n.x + PAD_X);
    H = Math.max(H, n.y + 120);
  });

  // faixas horizontais das bandas (para o rótulo lateral)
  const faixas = bandasPresentes.map((b, i) => {
    const topo = yDaLinha(inicioBanda[i] + linhasPorBanda[i] - 1) - ROW_H / 2;
    const base = yDaLinha(inicioBanda[i]) + ROW_H / 2;
    return { ...b, topo, base };
  });

  // tronco de cada trilha: sobe do hub até o nó mais alto que ela tem
  const troncos = trilhas.map((t, ti) => {
    const meus = nos.filter((n) => n.trilha === t);
    const topo = meus.length ? Math.min(...meus.map((n) => n.y)) : hubY - 160;
    const base = meus.length ? Math.max(...meus.map((n) => n.y)) : hubY - 160;
    return { trilha: t, x: PAD_X + ti * COL_W + COL_W / 2, topo, base, cor: corTrilha(t) };
  });

  return { trilhas, nos, faixas, troncos, W, H, hubX, hubY };
}

export type Faixa = ReturnType<typeof montarLayout>["faixas"][number];

/**
 * Em que banda cai um ponto Y do canvas — é o que diz, durante o arraste, se o
 * nó está cruzando a barreira e subindo/descendo de nível.
 * Acima da faixa mais alta o nó continua na banda mais alta; abaixo da base,
 * na mais baixa (arrastar para fora não pode virar "sem nível" por acidente).
 */
export function bandaNoY(faixas: Faixa[], y: number): Faixa | null {
  if (!faixas.length) return null;
  const dentro = faixas.find((f) => y <= f.base && y >= f.topo);
  if (dentro) return dentro;
  const maisAlta = faixas.reduce((a, b) => (b.topo < a.topo ? b : a));
  const maisBaixa = faixas.reduce((a, b) => (b.base > a.base ? b : a));
  return y < maisAlta.topo ? maisAlta : y > maisBaixa.base ? maisBaixa : null;
}

/** Resumo por trilha para os cartões do topo. */
export function resumoTrilhas(rows: Automacao[]) {
  const nomes = Array.from(new Set(rows.map((r) => trilhaDe(r.categoria)))).sort((a, b) => {
    const ia = TRILHAS.findIndex((t) => t.nome === a), ib = TRILHAS.findIndex((t) => t.nome === b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, "pt-BR");
  });
  return nomes.map((nome) => {
    const meus = rows.filter((r) => trilhaDe(r.categoria) === nome);
    return {
      nome,
      cor: corTrilha(nome),
      on: meus.filter((r) => tierDe(r.status) === "on").length,
      total: meus.length,
      categorias: Array.from(new Set(meus.map((r) => r.categoria || "Sem categoria"))),
    };
  });
}

/** Corrente do nó: ele + os pré-requisitos acima dele + tudo que ele destrava abaixo. */
export function correnteDe(rows: Automacao[], sel: string | null): Set<string> | null {
  if (!sel) return null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = new Set<string>([sel]);
  let cur = byId.get(sel);
  while (cur?.depende_de && !ids.has(cur.depende_de)) { ids.add(cur.depende_de); cur = byId.get(cur.depende_de); }
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const r of rows) if (r.depende_de && ids.has(r.depende_de) && !ids.has(r.id)) { ids.add(r.id); mudou = true; }
  }
  return ids;
}

/** Só os descendentes do nó (o que passa a ser possível se ele for concluído). */
export function destravadasPor(rows: Automacao[], sel: string | null): { ids: Set<string>; horas: number } {
  const ids = new Set<string>();
  if (!sel) return { ids, horas: 0 };
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const r of rows) {
      if (!r.depende_de || ids.has(r.id) || r.id === sel) continue;
      if (r.depende_de === sel || ids.has(r.depende_de)) { ids.add(r.id); mudou = true; }
    }
  }
  let horas = 0;
  ids.forEach((id) => { const r = rows.find((x) => x.id === id); if (r) horas += horasDe(r); });
  return { ids, horas };
}

/**
 * Alvos válidos para virar pré-requisito de `id`: qualquer um menos ele mesmo e
 * quem já depende dele (direta ou indiretamente) — senão o grafo cria ciclo.
 */
export function alvosValidos(rows: Automacao[], id: string): Automacao[] {
  const bloq = new Set<string>([id]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const r of rows) if (r.depende_de && bloq.has(r.depende_de) && !bloq.has(r.id)) { bloq.add(r.id); mudou = true; }
  }
  return rows.filter((r) => !bloq.has(r.id)).sort((a, b) => (a.automacao || "").localeCompare(b.automacao || "", "pt-BR"));
}

export const iniciaisDe = (nome: string | null | undefined) => {
  if (!nome) return "";
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase();
};

export const listaFerramentas = (s: string | null | undefined) =>
  (s || "").split(/[,;|/\n]+/).map((x) => x.trim()).filter(Boolean);
