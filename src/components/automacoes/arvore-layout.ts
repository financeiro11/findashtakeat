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
  /** custo de construir — a outra metade da prioridade na esteira */
  esforco?: string | null;
  dor: string | null;
  solucao: string | null;
  observacao: string | null;
  /** melhoria possível numa automação que já roda — acende a seta de oportunidade */
  upgrade?: string | null;
  /** posição fixada na mão na esteira; null = a esteira ordena sozinha */
  esteira_ordem?: number | null;
  /** automação que já roda e entrou na fila pelo upgrade dela (opt-in) */
  esteira_upgrade?: boolean | null;
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

/* -------------------------- impacto & esforço --------------------------
 * As duas metades da prioridade na esteira. Mesma escala de três degraus do
 * Catálogo, com cor calibrada para o fundo escuro da árvore (as classes do
 * Catálogo são de tema claro e sumiriam aqui). Valor ausente ou fora da escala
 * — inclusive o "Média" que existe em um registro antigo — cai em "Médio", que
 * é o default da tabela.
 *
 * A cor sinaliza coisas opostas nas duas: impacto Alto é o que a gente quer
 * (destaque), esforço Alto é o que custa caro (alerta). Por isso "Baixo" é
 * cinza no impacto e verde no esforço. */
export const IMPACTO_OPTS = ["Baixo", "Médio", "Alto"];
export const ESFORCO_OPTS = ["Baixo", "Médio", "Alto"];

const IMPACTO_CORES: Record<string, string> = { Baixo: "#94a3b8", Médio: "#fbbf24", Alto: "#fb7185" };
const ESFORCO_CORES: Record<string, string> = { Baixo: "#34d399", Médio: "#fbbf24", Alto: "#fb7185" };

const naEscala = (v: string | null | undefined) =>
  IMPACTO_OPTS.find((x) => x === (v || "").trim()) || "Médio";

export function impactoDe(r: { impacto?: string | null }): { nome: string; cor: string } {
  const nome = naEscala(r.impacto);
  return { nome, cor: IMPACTO_CORES[nome] };
}

export function esforcoDe(r: { esforco?: string | null }): { nome: string; cor: string } {
  const nome = naEscala(r.esforco);
  return { nome, cor: ESFORCO_CORES[nome] };
}

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

/* ----------------------------- geometria -----------------------------
 * O X do nó não é livre: cada trilha se divide em "lanes", e uma lane é uma
 * CORRENTE de dependência. Um filho puxa a lane do pai, então uma corrente sobe
 * reta e o galho que a liga é curto. Trilha larga = trilha com muitas correntes
 * paralelas, não com muitos nós. */
export const LANE_W = 200;    // distância entre duas correntes vizinhas
export const MAX_LANES = 4;   // acima disso a banda empilha em sub-linhas
export const TRILHA_GAP = 130;// respiro entre trilhas
export const ROW_H = 128;     // altura de uma linha de nós
export const PAD_X = 150;     // respiro lateral (rótulos das bandas moram aqui)
const PAD_TOP = 90;
const HUB_H = 190;            // espaço do hub abaixo da última linha
const ANCORA_DY = 104;        // altura da âncora da trilha acima do hub

export type NoPos = {
  r: Automacao; x: number; y: number; trilha: string; cor: string; tier: Tier;
  banda: number; fixo: boolean; // fixo = posição salva pelo usuário (arrastado)
  lane: number; sub: number;
};

const ordemTier: Record<Tier, number> = { on: 0, wip: 1, todo: 2 };

/** Primeiro slot livre da banda a partir da lane preferida (a do pai). */
function alocarSlot(ocupado: Set<string>, lanes: number, pref: number) {
  const alvo = Math.min(lanes - 1, Math.max(0, pref));
  for (let sub = 0; ; sub++) {
    for (let d = 0; d < lanes; d++) {
      for (const s of d === 0 ? [1] : [-1, 1]) {
        const lane = alvo + d * s;
        if (lane < 0 || lane >= lanes) continue;
        const k = `${lane}:${sub}`;
        if (!ocupado.has(k)) { ocupado.add(k); return { lane, sub }; }
      }
    }
  }
}
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
  const trilhas = ordenarTrilhas(Array.from(new Set(rows.map((r) => trilhaDe(r.categoria)))));

  // Só entram as bandas que têm alguma automação — evita canvas vazio.
  // Vêm de baixo (N1) para cima, que é a ordem em que as lanes são atribuídas:
  // quando um filho é posicionado, o pai (banda menor) já tem lane.
  const bandasPresentes = BANDAS.filter((b) => rows.some((r) => banda(r) === b.k));

  const porId = new Map(rows.map((r) => [r.id, r]));
  // Só o pai da MESMA trilha dita a lane. A dependência que cruza trilha continua
  // desenhada (é justamente a interessante), mas não arrasta o nó para longe da
  // sua coluna — senão a trilha deixa de existir como coluna.
  const paiLocal = (r: Automacao) => {
    const p = r.depende_de ? porId.get(r.depende_de) : null;
    return p && p.id !== r.id && trilhaDe(p.categoria) === trilhaDe(r.categoria) ? p : null;
  };

  // ---- lanes: uma corrente de dependência por lane, dentro de cada trilha ----
  const laneDe = new Map<string, number>();
  const subDe = new Map<string, number>();
  const lanesDaTrilha = new Map<string, number>();
  const subsPorBanda = bandasPresentes.map(() => 1);

  trilhas.forEach((t) => {
    const doT = rows.filter((r) => trilhaDe(r.categoria) === t);
    const maxNaBanda = Math.max(1, ...bandasPresentes.map((b) => doT.filter((r) => banda(r) === b.k).length));
    const lanes = Math.min(MAX_LANES, maxNaBanda);
    lanesDaTrilha.set(t, lanes);

    bandasPresentes.forEach((b, bi) => {
      const daCelula = doT
        .filter((r) => banda(r) === b.k)
        .sort((a, z) =>
          ordemTier[tierDe(a.status)] - ordemTier[tierDe(z.status)] ||
          (a.automacao || "").localeCompare(z.automacao || "", "pt-BR"),
        );
      // quem herda lane do pai escolhe primeiro; o resto preenche o que sobrou
      const laneDoPai = (r: Automacao) => laneDe.get(paiLocal(r)?.id ?? "");
      const comPai = daCelula.filter((r) => laneDoPai(r) != null);
      const semPai = daCelula.filter((r) => laneDoPai(r) == null);
      const ocupado = new Set<string>();
      [...comPai, ...semPai].forEach((r, i) => {
        const { lane, sub } = alocarSlot(ocupado, lanes, laneDoPai(r) ?? i);
        laneDe.set(r.id, lane);
        subDe.set(r.id, sub);
        subsPorBanda[bi] = Math.max(subsPorBanda[bi], sub + 1);
      });
    });
  });

  // ---- geometria: X pela lane, Y pela banda ----
  const centroX = new Map<string, number>();
  let cursor = PAD_X;
  trilhas.forEach((t) => {
    const larg = (lanesDaTrilha.get(t) ?? 1) * LANE_W;
    centroX.set(t, cursor + larg / 2);
    cursor += larg + TRILHA_GAP;
  });

  const totalLinhas = subsPorBanda.reduce((a, c) => a + c, 0);
  let W = Math.max(PAD_X * 2 + LANE_W, cursor - TRILHA_GAP + PAD_X);
  let H = PAD_TOP + totalLinhas * ROW_H + HUB_H;
  const hubY = H - HUB_H / 2;
  const hubX = W / 2;

  // y da 1ª sub-linha de cada banda, contando de baixo para cima
  const inicioBanda: number[] = [];
  let acc = 0;
  bandasPresentes.forEach((_, i) => { inicioBanda[i] = acc; acc += subsPorBanda[i]; });
  const yDaLinha = (linhaGlobal: number) => hubY - HUB_H / 2 - 30 - linhaGlobal * ROW_H;

  const nos: NoPos[] = [];
  trilhas.forEach((t) => {
    const lanes = lanesDaTrilha.get(t) ?? 1;
    const cx = centroX.get(t) ?? PAD_X;
    bandasPresentes.forEach((b, bi) => {
      rows
        .filter((r) => trilhaDe(r.categoria) === t && banda(r) === b.k)
        .forEach((r) => {
          const lane = laneDe.get(r.id) ?? 0;
          const sub = subDe.get(r.id) ?? 0;
          const fixo = r.pos_x != null && r.pos_y != null;
          nos.push({
            r, trilha: t, cor: corTrilha(t), tier: tierDe(r.status), banda: b.k, fixo, lane, sub,
            x: fixo ? (r.pos_x as number) : cx + (lane - (lanes - 1) / 2) * LANE_W,
            y: fixo ? (r.pos_y as number) : yDaLinha(inicioBanda[bi] + sub),
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
    const topo = yDaLinha(inicioBanda[i] + subsPorBanda[i] - 1) - ROW_H / 2;
    const base = yDaLinha(inicioBanda[i]) + ROW_H / 2;
    return { ...b, topo, base };
  });

  // Âncora da trilha: o ponto logo acima do hub de onde saem as raízes dela.
  const troncos = trilhas.map((t) => {
    const meus = nos.filter((n) => n.trilha === t);
    const x = centroX.get(t) ?? PAD_X;
    const topo = meus.length ? Math.min(...meus.map((n) => n.y)) : hubY - 160;
    const base = meus.length ? Math.max(...meus.map((n) => n.y)) : hubY - 160;
    return { trilha: t, x, topo, base, cor: corTrilha(t), ancora: { x, y: hubY - ANCORA_DY } };
  });

  return { trilhas, nos, faixas, troncos, W, H, hubX, hubY };
}

function ordenarTrilhas(nomes: string[]) {
  return [...nomes].sort((a, b) => {
    const ia = TRILHAS.findIndex((t) => t.nome === a), ib = TRILHAS.findIndex((t) => t.nome === b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, "pt-BR");
  });
}

export type Faixa = ReturnType<typeof montarLayout>["faixas"][number];

export type Ponto = { x: number; y: number };

/**
 * Fios de uma trilha. TODA linha desenhada aqui quer dizer alguma coisa:
 *
 *   hub → âncora   = a trilha existe (é o tronco dela)
 *   âncora → raiz  = essa automação não depende de nenhuma outra
 *
 * O que liga um nó a outro nó é a aresta de pré-requisito (`depende_de`),
 * desenhada à parte. Aqui entram SÓ as raízes — a versão antiga costurava os nós
 * pela proximidade no eixo X, o que produzia galho entre automações sem relação
 * nenhuma e era a origem do espaguete.
 */
export function fiosDoTronco(raizes: Ponto[], ancora: Ponto, hub: Ponto): Ponto[][] {
  const tronco: Ponto[] = [hub, { x: (hub.x + ancora.x) / 2, y: ancora.y + (hub.y - ancora.y) * 0.35 }, ancora];
  if (!raizes.length) return [];
  return [
    tronco,
    // sobe reto da âncora e só então se inclina até a raiz — dá o movimento de
    // galho sem inventar ligação entre raízes vizinhas
    ...[...raizes].sort((a, b) => b.y - a.y).map((p) => [
      ancora,
      { x: ancora.x + (p.x - ancora.x) * 0.18, y: ancora.y + (p.y - ancora.y) * 0.55 },
      p,
    ]),
  ];
}

/**
 * Arestas que DESCEM de nível: o pré-requisito está num nível maior que quem ele
 * destrava, então a seta aponta para baixo. Ou o nível está errado, ou a
 * dependência está invertida — de todo jeito é a árvore acusando dado incoerente,
 * não um caso a esconder.
 *
 * Mesmo nível não conta: uma sequência dentro da mesma faixa de maturidade
 * (categorizar → lançar no Omie → revisar o lançamento) é legítima e comum.
 * Quem está sem nível de um dos lados também não entra — não dá para julgar.
 */
export function inversoesDe(rows: Automacao[], niveis: Nivel[] = NIVEIS_PADRAO) {
  const porId = new Map(rows.map((r) => [r.id, r]));
  return rows.flatMap((r) => {
    const pai = r.depende_de ? porId.get(r.depende_de) : null;
    if (!pai) return [];
    const nf = bandaDe(r, niveis), np = bandaDe(pai, niveis);
    return nf && np && nf < np ? [{ filho: r, pai }] : [];
  });
}

/**
 * Curva suave passando POR todos os pontos (Catmull-Rom convertida em Bézier).
 * É o que dá o movimento orgânico das linhas em vez de segmentos retos.
 */
export function caminhoSuave(pts: Ponto[], tensao = 0.22): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * tensao;
    const c1y = p1.y + (p2.y - p0.y) * tensao;
    const c2x = p2.x - (p3.x - p1.x) * tensao;
    const c2y = p2.y - (p3.y - p1.y) * tensao;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

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

/** Tem oportunidade de melhoria registrada? (só conta texto de verdade) */
export const temUpgrade = (r: { upgrade?: string | null }) => !!r.upgrade && r.upgrade.trim().length > 0;

export const iniciaisDe = (nome: string | null | undefined) => {
  if (!nome) return "";
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase();
};

export const listaFerramentas = (s: string | null | undefined) =>
  (s || "").split(/[,;|/\n]+/).map((x) => x.trim()).filter(Boolean);
