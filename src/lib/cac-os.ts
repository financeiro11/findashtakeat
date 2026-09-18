// "O Takeat OS diz o mesmo?" — a matriz do Painel CAC contra a matriz de custos do OS.
//
// O Painel CAC é o OFICIAL (decisão de 18/09/2026): ele sai do Omie pela mesma base da
// DRE. O OS tem a mesma matriz (Equipes / Investimentos / Comissões × categoria), digitada
// ou importada pelo time de RPA, e é dela que sai o CAC que o OS e a tela Metas &
// Indicadores calculam. Este cruzamento mostra linha a linha onde as duas divergem, para o
// RPA corrigir do lado dele. Em ago/26 eram 3 de 19: Branding (+1.000 no OS), Onboarding
// (−930) e Suporte (−3.315).

import type { PainelRow } from "./cac";

export type CustoOSMes = { competencia: string; grupo: string; categoria: string; valor: number | null };

export type LinhaConferenciaOS = {
  grupo: string;
  rotulo: string;
  hub: number;
  os: number | null; // null = o OS não tem essa categoria no mês
  diferenca: number; // os − hub
  bate: boolean;
};

/** Tolerância de centavos: as duas contas arredondam em lugares diferentes. */
export const TOLERANCIA_OS = 1;

const chave = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Linhas do mês lado a lado. Casa por grupo + rótulo da linha = categoria do OS (sem
 * acento, sem caixa). Linha que só existe de um lado aparece mesmo assim — é justamente o
 * tipo de divergência que ninguém vê olhando uma tela só.
 */
export function conferirComOS(rows: PainelRow[], os: CustoOSMes[], ano: number, mes: number): LinhaConferenciaOS[] {
  const comp = `${ano}-${String(mes).padStart(2, "0")}`;
  const doMes = os.filter((c) => c.competencia?.slice(0, 7) === comp);

  const hub = new Map<string, { grupo: string; rotulo: string; valor: number; ordem: number }>();
  for (const r of rows.filter((r) => r.mes === mes)) {
    const k = `${chave(r.grupo)}|${chave(r.rotulo)}`;
    const atual = hub.get(k);
    hub.set(k, { grupo: r.grupo, rotulo: r.rotulo, valor: (atual?.valor ?? 0) + Number(r.valor || 0), ordem: r.ordem });
  }
  const noOS = new Map<string, { grupo: string; categoria: string; valor: number }>();
  for (const c of doMes) {
    const k = `${chave(c.grupo)}|${chave(c.categoria)}`;
    const atual = noOS.get(k);
    noOS.set(k, { grupo: c.grupo, categoria: c.categoria, valor: (atual?.valor ?? 0) + Number(c.valor ?? 0) });
  }

  const chaves = [...new Set([...hub.keys(), ...noOS.keys()])];
  const linhas = chaves.map((k) => {
    const h = hub.get(k);
    const o = noOS.get(k);
    const valorHub = h?.valor ?? 0;
    const valorOS = o ? o.valor : null;
    // Linha que o OS não tem e que o Hub zera não é divergência: ninguém gastou.
    const diferenca = (valorOS ?? 0) - valorHub;
    return {
      grupo: h?.grupo ?? o!.grupo,
      rotulo: h?.rotulo ?? o!.categoria,
      hub: valorHub,
      os: valorOS,
      diferenca,
      bate: Math.abs(diferenca) < TOLERANCIA_OS,
      ordem: h?.ordem ?? 999,
    };
  });

  const ORDEM_GRUPO = ["equipes", "investimentos", "comissoes"];
  return linhas
    .sort((a, b) =>
      (ORDEM_GRUPO.indexOf(chave(a.grupo)) + 1 || 9) - (ORDEM_GRUPO.indexOf(chave(b.grupo)) + 1 || 9)
      || a.ordem - b.ordem || a.rotulo.localeCompare(b.rotulo))
    .map(({ ordem: _o, ...l }) => l);
}

/** Os meses do ano em que pelo menos um dos lados tem valor. */
export function mesesComCusto(rows: PainelRow[], os: CustoOSMes[], ano: number): number[] {
  const doHub = rows.filter((r) => Number(r.valor)).map((r) => r.mes);
  const doOS = os.filter((c) => c.competencia?.startsWith(String(ano)) && Number(c.valor)).map((c) => Number(c.competencia.slice(5, 7)));
  return [...new Set([...doHub, ...doOS])].sort((a, b) => a - b);
}
