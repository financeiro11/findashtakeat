/* Período do extrato de conta corrente: os atalhos (Hoje, 7 dias, ...) e o
   intervalo escolhido à mão. Datas são "AAAA-MM-DD" e comparam como texto. */

export type PeriodoExtrato = "tudo" | "hoje" | "7d" | "30d" | "mes" | "personalizado";

export type Intervalo = { de: string; ate: string };

function menosDias(hoje: string, n: number) {
  const d = new Date(hoje + "T12:00:00");
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
}

/** Limites inclusivos do período; "" deixa o lado aberto. */
export function intervaloDoPeriodo(periodo: PeriodoExtrato, hoje: string, escolhido?: Partial<Intervalo>): Intervalo {
  switch (periodo) {
    case "hoje": return { de: hoje, ate: "" };
    case "7d": return { de: menosDias(hoje, 7), ate: "" };
    case "30d": return { de: menosDias(hoje, 30), ate: "" };
    case "mes": return { de: hoje.slice(0, 7) + "-01", ate: "" };
    case "personalizado": {
      const de = escolhido?.de ?? "";
      const ate = escolhido?.ate ?? "";
      // Quem digita as datas trocadas quer o intervalo entre elas, não uma lista vazia.
      return de && ate && de > ate ? { de: ate, ate: de } : { de, ate };
    }
    default: return { de: "", ate: "" };
  }
}

export function dentroDoIntervalo(data: string, { de, ate }: Intervalo) {
  if (de && data < de) return false;
  if (ate && data > ate) return false;
  return true;
}
