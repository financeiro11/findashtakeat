// De onde a pergunta saiu — a tela que a pessoa está olhando quando abre o Assistente.
//
// O PROBLEMA QUE ISTO RESOLVE: "por que a fatura saltou de julho para agosto?" perguntado
// na frente da tela do Cartão caía no caminho geral e voltava com uma varredura de DRE e
// DFC de 2024, 2025 e 2026 — correta em cada linha e inútil na pergunta. Faltava a coisa
// mais óbvia: saber que a pessoa estava olhando a fatura de agosto/2026 ao lado da de
// julho/2026. Com a tela declarada, o planejador escolhe a consulta daquela área e o mês
// vem do período à vista em vez de ser adivinhado.
//
// O QUE NÃO VAI DAQUI: valores. A garantia do caminho conferido é que todo número escrito
// veio de consulta ao banco naquela requisição; mandar os números da tela abriria uma
// segunda origem que ninguém confere. Vai o RECORTE — período, aba, filtros —, e a
// consulta refaz as contas no servidor. O resultado bate com a tela porque lê a mesma
// regra, não porque copiou o texto.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { descreverRota } from "@/lib/rotas";

export type ContextoPagina = {
  /** Rota atual, para o assistente citar de onde veio. */
  rota: string;
  /** Nome legível da tela ("Governança › Cartão — Evolução da fatura · Sicoob"). */
  tela: string;
  /** O recorte à vista: período, aba, filtros. Sem valores. */
  resumo?: string;
};

// Estado de módulo em vez de contexto do React: quem lê é uma função de envio dentro de um
// callback, não um componente que renderiza. Um provider daria o mesmo resultado com um
// re-render a cada tecla digitada no painel.
let publicado: ContextoPagina | null = null;

export function publicarContextoPagina(c: ContextoPagina | null): void {
  publicado = c;
}

/**
 * O contexto a mandar junto com a pergunta. A rota sempre existe; o resumo só quando a
 * página publicou o dela.
 */
export function contextoDaPagina(rota: string): ContextoPagina {
  if (publicado && publicado.rota === rota) return publicado;
  return { rota, tela: descreverRota(rota) || rota };
}

/**
 * Publica o recorte da tela enquanto a página estiver montada.
 *
 * `resumo` é uma frase curta com o que está à vista — "Período: Julho/2026 → Agosto/2026
 * (2 faturas). Aba: Evolução por Estabelecimento." Refaça-a quando os controles mudarem;
 * o hook republica sozinho.
 */
export function useContextoDaPagina(resumo: string): void {
  const { pathname } = useLocation();
  useEffect(() => {
    publicarContextoPagina({ rota: pathname, tela: descreverRota(pathname) || pathname, resumo });
    return () => publicarContextoPagina(null);
  }, [pathname, resumo]);
}
