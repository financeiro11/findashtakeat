/**
 * Paleta dos gráficos do BP.
 *
 * As seis áreas do headcount são uma paleta categórica — hues em ordem fixa,
 * nunca cicladas. Cada modo tem seus próprios passos (não é o claro invertido),
 * validados contra a superfície do respectivo tema:
 *
 *   claro — passa banda de luminosidade, croma, separação CVD e piso de visão
 *           normal; o âmbar fica em 2,09:1 de contraste (abaixo de 3:1).
 *   escuro — passa tudo; o par Tecnologia↔Onboarding fica em ΔE 6,3 (deutan),
 *            dentro da faixa de piso 6–8.
 *
 * Os dois pontos acima exigem encoding secundário, que a aba Equipe entrega:
 * legenda sempre visível, rótulo direto do total em cima de cada barra, 2px de
 * respiro entre os segmentos empilhados e a tabela "Custo por time" logo abaixo
 * com o headcount de jan e dez por área.
 */
import { useEffect, useState } from "react";
import type { Area } from "./plano2026";

export const CORES_AREA_CLARO: Record<Area, string> = {
  Administrativo: "#0891b2",
  Marketing: "#8b5cf6",
  Comercial: "#D51A1A",
  Operacional: "#3b82f6",
  Onboarding: "#f59e0b",
  Tecnologia: "#15803d",
};

export const CORES_AREA_ESCURO: Record<Area, string> = {
  Administrativo: "#0891b2",
  Marketing: "#8b5cf6",
  Comercial: "#e03535",
  Operacional: "#3b82f6",
  Onboarding: "#b8690f",
  Tecnologia: "#34a853",
};

/** Séries monetárias — duas séries, com legenda; não é paleta categórica. */
export const COR_RECEITA = "#3b82f6";
export const COR_EBITDA = "#D51A1A";
export const COR_CAIXA = "#D51A1A";
export const COR_POSITIVO = "#15803d";
export const COR_NEGATIVO = "#D51A1A";

/** Observa o tema ativo (a classe .dark no <html>) — cada modo tem seus passos. */
export function useTemaEscuro(): boolean {
  const [escuro, setEscuro] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const ler = () => setEscuro(el.classList.contains("dark"));
    ler();
    const obs = new MutationObserver(ler);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return escuro;
}

export function coresArea(escuro: boolean): Record<Area, string> {
  return escuro ? CORES_AREA_ESCURO : CORES_AREA_CLARO;
}
