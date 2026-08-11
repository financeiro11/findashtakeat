/* ============================================================================
 * O registro de cards do Hub — o catálogo que atravessa as telas.
 *
 * O montador de apresentações nasceu lendo os cards de UMA página (os cinco
 * blocos da Revisão do Mês). Isso resolve a reunião de tracker e trava tudo o
 * mais: um material de Conselho quer churn, carteira e capital de giro, que
 * moram em outras telas, e sem um lugar comum cada apresentação nova teria de
 * redesenhar o que já existe.
 *
 * DUAS PROCEDÊNCIAS, DE PROPÓSITO
 *   · Cards LOCAIS — os da página anfitriã, montados a partir de dados que ela
 *     já carregou. São a maioria e não pagam nenhuma consulta extra.
 *   · Cards REGISTRADOS — os daqui. Cada um é AUTOSSUFICIENTE: recebe o mês em
 *     foco e busca sozinho o que precisa. É o que permite pôr o churn numa folha
 *     sem que a página do deck saiba o que é churn.
 *
 * POR QUE LISTA EXPLÍCITA, E NÃO AUTO-REGISTRO POR IMPORT
 *   "Cada tela se registra sozinha" depende de import com efeito colateral —
 *   que o bundler tem todo direito de podar, e aí o card some do catálogo sem
 *   erro nenhum. Aqui a lista é uma constante: para saber o que existe, se lê um
 *   arquivo; para acrescentar, se edita uma linha.
 *
 * O QUE UM CARD REGISTRADO PRECISA HONRAR
 *   1. Desenhar-se com o mês que recebeu, ou dizer na cara que está mostrando
 *      outro (o capital de giro é foto do último mês fechado, e ele avisa).
 *   2. Não depender de nada da página anfitriã além do `ctx`.
 *   3. Sobreviver a "não tem dado": card de apresentação que quebra derruba a
 *      folha inteira no meio da reunião.
 * ========================================================================== */

import type { ComponentType } from "react";
import type { Periodo } from "@/lib/periodo";
import { CardCapitalGiro } from "@/components/demonstracoes/cards/CardCapitalGiro";
import { CardCarteira } from "@/components/demonstracoes/cards/CardCarteira";
import { CardChurn } from "@/components/demonstracoes/cards/CardChurn";
import { CardResultadoPeriodo } from "@/components/demonstracoes/cards/CardResultadoPeriodo";

/**
 * O que a apresentação informa ao card.
 *
 * `periodo` é a janela inteira (ver `lib/periodo.ts`); `mes` é o fechamento
 * dela. Card de FLUXO (churn, receita, EBITDA) soma a janela; card de ESTOQUE
 * (carteira, caixa) vale no último mês — somar contaria o mesmo cliente três
 * vezes. Cada card escolhe, e diz na tela o que escolheu.
 */
export type ContextoCard = {
  periodo: Periodo;
  /** Atalho para `periodo.mesFoco` — a coluna do blob do mês de fechamento. */
  mes: string;
  /** "Julho/26" — para o card escrever o próprio subtítulo. */
  rotuloMes: string;
};

export type CardRegistrado = {
  /** Chave estável e salva no roteiro. Renomear o rótulo é seguro; a chave não. */
  chave: string;
  rotulo: string;
  /** De onde o dado vem — vira o agrupador do card no catálogo do montador. */
  fonte: string;
  Card: ComponentType<{ ctx: ContextoCard }>;
};

/**
 * Tudo o que uma apresentação pode chamar de fora da página anfitriã.
 *
 * Acrescentar um card é: escrever o componente autossuficiente em
 * `components/demonstracoes/cards/` e pôr uma linha aqui.
 */
export const REGISTRO_CARDS: CardRegistrado[] = [
  {
    chave: "resultado.periodo",
    rotulo: "Resultado do período (receita, EBITDA, margem)",
    fonte: "DRE",
    Card: CardResultadoPeriodo,
  },
  {
    chave: "churn.resumo",
    rotulo: "Churn do período",
    fonte: "Assinaturas",
    Card: CardChurn,
  },
  {
    chave: "carteira.porte",
    rotulo: "Carteira por porte",
    fonte: "Assinaturas",
    Card: CardCarteira,
  },
  {
    chave: "capital-giro.resumo",
    rotulo: "Necessidade de capital de giro",
    fonte: "Caixa",
    Card: CardCapitalGiro,
  },
];
