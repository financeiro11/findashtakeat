/* ============================================================================
 * Linha de produção — a ordem em que as automações vão ser construídas.
 *
 * A regra é a mesma matriz impacto × esforço que se usa para priorizar produto:
 * o que rende muito e custa pouco vem primeiro. Empate cai no nível da pirâmide,
 * porque não adianta atacar "financeiro autônomo" (N5) com a fundação (N1) ainda
 * aberta. Fica fora do componente de propósito: é a parte que precisa ser óbvia
 * e conferível — a Júlia vai trabalhar nessa ordem. Ver esteira.test.ts.
 * ========================================================================== */
import {
  type Automacao, type Nivel,
  NIVEIS_PADRAO, bandaDe, tierDe, impactoDe, esforcoDe, temUpgrade,
} from "./arvore-layout";

/** "novo" = construir do zero; "upgrade" = melhorar algo que já roda. */
export type TipoItem = "novo" | "upgrade";

export type ItemEsteira = {
  r: Automacao;
  tipo: TipoItem;
  /** 2 a 6 — quanto maior, mais cedo na fila */
  score: number;
  /** posição travada na mão; a esteira não mexe mais nela sozinha */
  fixo: boolean;
};

const PESO: Record<string, number> = { Baixo: 1, Médio: 2, Alto: 3 };

/**
 * Impacto e esforço pesam igual: "alto impacto / esforço médio" empata com
 * "impacto médio / esforço baixo", e aí quem decide é o nível. Escolha
 * deliberada — dar mais peso ao impacto empurraria os agentes de N5 para cima
 * da fila com a base ainda por fazer, que é justamente o que se quer evitar.
 */
export const scoreEsteira = (r: Automacao) =>
  PESO[impactoDe(r).nome] + (4 - PESO[esforcoDe(r).nome]);

/**
 * Quem ocupa a linha: tudo que ainda não está rodando, mais as que já rodam e
 * foram postas na fila pelo upgrade delas. Automação rodando sem upgrade
 * marcado não aparece — já está pronta, não é trabalho pendente.
 */
export function itemDe(r: Automacao): ItemEsteira | null {
  const rodando = tierDe(r.status) === "on";
  if (rodando && !(r.esteira_upgrade && temUpgrade(r))) return null;
  return {
    r,
    tipo: rodando ? "upgrade" : "novo",
    score: scoreEsteira(r),
    fixo: r.esteira_ordem != null,
  };
}

/** Nível para desempate — sem nível vai para o fim, não dá para chamar de base. */
const nivelOrdem = (r: Automacao, niveis: Nivel[]) => bandaDe(r, niveis) || Number.MAX_SAFE_INTEGER;

/** Entre dois itens de mesmo score e nível, quem já saiu do papel vem antes. */
const ordemTier: Record<string, number> = { on: 0, wip: 1, todo: 2 };

function comparar(niveis: Nivel[]) {
  return (a: ItemEsteira, b: ItemEsteira) =>
    b.score - a.score ||
    nivelOrdem(a.r, niveis) - nivelOrdem(b.r, niveis) ||
    ordemTier[tierDe(a.r.status)] - ordemTier[tierDe(b.r.status)] ||
    (a.r.automacao || "").localeCompare(b.r.automacao || "", "pt-BR");
}

/**
 * A fila pronta para desenhar. Os itens soltos se ordenam pela regra; os que
 * foram arrastados entram à força no índice que o usuário escolheu. Inserir os
 * fixos em ordem crescente é o que faz cada um cair exatamente onde foi solto,
 * mesmo com vários fixos na lista.
 */
export function ordenarEsteira(rows: Automacao[], niveis: Nivel[] = NIVEIS_PADRAO): ItemEsteira[] {
  const itens = rows.map(itemDe).filter((x): x is ItemEsteira => x !== null);
  const fila = itens.filter((i) => !i.fixo).sort(comparar(niveis));
  const fixos = itens.filter((i) => i.fixo).sort((a, b) => (a.r.esteira_ordem ?? 0) - (b.r.esteira_ordem ?? 0));
  for (const f of fixos) {
    const destino = Math.max(0, Math.min(f.r.esteira_ordem ?? 0, fila.length));
    fila.splice(destino, 0, f);
  }
  return fila;
}

/**
 * Os dois cantos da matriz que merecem nome. O resto do meio não ganha rótulo —
 * etiquetar tudo faria o destaque perder a função.
 */
export function quadranteDe(r: Automacao): { rotulo: string; cor: string } | null {
  const imp = impactoDe(r).nome;
  const esf = esforcoDe(r).nome;
  if (imp === "Alto" && esf === "Baixo") return { rotulo: "GANHO RÁPIDO", cor: "#34d399" };
  if (imp === "Baixo" && esf === "Alto") return { rotulo: "VALE A PENA?", cor: "#fb7185" };
  return null;
}

export function resumoEsteira(itens: ItemEsteira[]) {
  return {
    total: itens.length,
    upgrades: itens.filter((i) => i.tipo === "upgrade").length,
    rapidos: itens.filter((i) => quadranteDe(i.r)?.rotulo === "GANHO RÁPIDO").length,
    fixos: itens.filter((i) => i.fixo).length,
  };
}
