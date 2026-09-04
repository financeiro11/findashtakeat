/* ============================================================================
 * "Meios de Pagamento" da DRE/DFC = o somatório das taxas do Asaas do mês.
 *
 * POR QUE ESTA LINHA NÃO PODE VIR DO OMIE. As três categorias que o de-para
 * aponta para ela — "3.2.3. Meios de Pagamento", "3.1.2.16 Emissão NF" e
 * "3.1.2.17 Cobrança Clientes", cuja descrição no próprio Omie diz "Taxa pela
 * emissão de Notas Fiscais pelo Asaas" — não têm UM movimento sequer no ERP, e
 * nunca terão: a taxa do Asaas é descontada na liquidação, então ela nunca vira
 * conta a pagar. Até aqui o número só existia porque alguém digitava na planilha
 * do tracker; em agosto/26 ninguém digitou, e a célula ficou vazia.
 *
 * A fonte de verdade é o extrato (`asaas_extrato`), onde cada taxa é uma linha.
 * A RPC `asaas_taxas_mes` soma; este módulo decide QUAIS meses podem ser
 * escritos, e é a parte que precisava de teste — as duas armadilhas moram aqui:
 *
 *  1. MEIO MÊS PARECE O MÊS INTEIRO. O espelho do extrato começou em 25/07/2026.
 *     Somar julho daria R$ 5.688 (sete dias) numa célula que hoje diz R$ 20.866,
 *     e ninguém olhando a tela desconfiaria — é um número plausível. Por isso um
 *     mês só entra se o espelho cobrir o DIA 1 dele. Mês corrente é exceção
 *     consciente: ele é parcial como toda a coluna do mês corrente é.
 *
 *  2. A CHAVE DE COLUNA É EM INGLÊS. 'Aug-26', não 'Ago-26' — escrever em
 *     português cria uma célula que a tela nunca lê e um mês que não existe.
 * ========================================================================== */

/** Rótulo da linha, igual nos dois esquemas (DRE e DFC). */
export const RUBRICA_MEIOS_PAGAMENTO = "Meios de Pagamento";

/** Uma linha da RPC `asaas_taxas_mes`. */
export type TaxaDoMes = {
  /** 'YYYY-MM' */
  mes: string;
  /** POSITIVO — o quanto o Asaas cobrou, já abatidos os estornos de taxa. */
  total: number;
  lancamentos: number;
  detalhe: Record<string, number> | null;
  /** primeiro/último dia COM movimento dentro do mês */
  de: string | null;
  ate: string | null;
  /** o espelho já existia no dia 1 deste mês */
  coberto: boolean;
};

export type Aplicavel = {
  aplicar: true;
  mes: string;
  /** 'Aug-26' */
  col_key: string;
  /** NEGATIVO: despesa entra negativa no blob, como todo o resto. */
  valor: number;
  lancamentos: number;
  detalhe: Record<string, number> | null;
  /** mês ainda em curso — o número cresce até o fim dele */
  parcial: boolean;
};

export type Pulado = { aplicar: false; mes: string; motivo: string };

export type Decisao = Aplicavel | Pulado;

const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * '2026-08' → 'Aug-26'. Devolve null para o que não for um mês — a chave errada
 * não pode virar uma coluna nova no blob.
 */
export function colKeyDoMes(mes: string): string | null {
  const m = String(mes ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const i = parseInt(m[2], 10) - 1;
  if (i < 0 || i > 11) return null;
  return `${EN[i]}-${m[1].slice(2)}`;
}

const ptBR = (iso: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "?";

/**
 * Decide o que escrever. `hoje` é 'YYYY-MM-DD' em BRT — o mês dele é o mês
 * corrente, o único que pode entrar parcial.
 *
 * `primeiroDoEspelho` é a menor data do extrato inteiro; entra só para o motivo
 * do pulo ser legível na tela ("o extrato só começa em 25/07/2026") em vez de um
 * "mês descoberto" que ninguém sabe interpretar.
 */
export function decidirMeses(
  linhas: TaxaDoMes[],
  hoje: string,
  primeiroDoEspelho: string | null,
): Decisao[] {
  const mesCorrente = String(hoje ?? "").slice(0, 7);

  return linhas
    .slice()
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((l): Decisao => {
      const col = colKeyDoMes(l.mes);
      if (!col) return { aplicar: false, mes: l.mes, motivo: "mês irreconhecível" };

      // Mês no futuro só existe se alguma data do extrato veio errada. Escrever
      // criaria uma coluna à frente do fechamento — a demonstração ganharia um
      // mês que ainda não aconteceu.
      if (l.mes > mesCorrente) return { aplicar: false, mes: l.mes, motivo: "mês no futuro" };

      if (!l.coberto) {
        return {
          aplicar: false,
          mes: l.mes,
          motivo: `o extrato do Asaas só começa em ${ptBR(primeiroDoEspelho)}`
            + `; deste mês há apenas de ${ptBR(l.de)} a ${ptBR(l.ate)}`,
        };
      }

      const total = Number(l.total) || 0;
      // Zero não é "sem taxa", é sinal de que o extrato daquele mês não chegou:
      // um mês com cobrança tem taxa. Escrever zero apagaria a linha.
      if (total <= 0) return { aplicar: false, mes: l.mes, motivo: "nenhuma taxa no mês" };

      return {
        aplicar: true,
        mes: l.mes,
        col_key: col,
        valor: -Math.round(total * 100) / 100,
        lancamentos: Number(l.lancamentos) || 0,
        detalhe: l.detalhe ?? null,
        parcial: l.mes === mesCorrente,
      };
    });
}

/** Só os que entram, para quem não quer filtrar na mão. */
export const aplicaveis = (d: Decisao[]): Aplicavel[] => d.filter((x): x is Aplicavel => x.aplicar);
