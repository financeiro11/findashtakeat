/**
 * O ASAAS DO FLUXO PROJETADO, LIDO NA HORA (16/09/2026).
 *
 * A foto do /caixa (`omie_caixa_snapshot`) sai uma vez por dia, às 09:00, e leva
 * junto as entradas do Asaas daquele instante. Com o webhook o espelho muda o dia
 * todo — a cobrança criada às 10h só entrava no gráfico no dia seguinte.
 *
 * A troca é barata porque a foto já guarda, em cada dia, o saldo SEM o Asaas
 * (`saldo_sem_asaas`): o saldo com o Asaas é esse mais o acumulado das entradas.
 * A tela relê as entradas pela mesma RPC que o servidor usa
 * (`asaas_entradas_projetadas`, uma consulta local) e refaz a série. O Omie fica
 * como a foto disse — ele não tem aviso.
 *
 * Foto anterior a 16/08/2026 (sem `saldo_sem_asaas`) volta intacta: sem a linha
 * de base não há como separar as duas parcelas sem inventar.
 */

export type LinhaEntradaAsaas = {
  data: string; valor: number | string; qtd: number | string;
  a_vencer: number | string; confirmado: number | string;
};

type Ponto = {
  data: string; saldo: number; entradas: number; saidas: number;
  entradas_asaas?: number; asaas_a_vencer?: number; asaas_confirmado?: number; asaas_qtd?: number;
  saldo_sem_asaas?: number;
};

export type FluxoProjetado<P extends Ponto = Ponto> = {
  menor: { valor: number; data: string };
  maior_desembolso: { valor: number; data: string };
  saldo_final: { data: string; saldo: number };
  saldo_atual: number;
  asaas?: {
    total: number; a_vencer: number; confirmado: number; cobrancas: number;
    origem: "espelho" | "vazio" | "erro"; atualizado_em: string | null;
    ao_vivo?: boolean;
  };
  pontos: P[];
};

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

export function comAsaasAoVivo<F extends FluxoProjetado>(
  fluxo: F, linhas: LinhaEntradaAsaas[], lidoEm: string | null,
): F {
  const pts = fluxo?.pontos ?? [];
  if (!pts.length || pts.some((p) => typeof p.saldo_sem_asaas !== "number")) return fluxo;

  const porDia = new Map<string, LinhaEntradaAsaas>();
  for (const l of linhas) porDia.set(String(l.data).slice(0, 10), l);

  let acumulado = 0;
  const pontos = pts.map((p) => {
    const a = porDia.get(p.data);
    const entradasAsaas = n(a?.valor);
    acumulado += entradasAsaas;
    return {
      ...p,
      saldo: (p.saldo_sem_asaas as number) + acumulado,
      entradas_asaas: entradasAsaas,
      asaas_a_vencer: n(a?.a_vencer),
      asaas_confirmado: n(a?.confirmado),
      asaas_qtd: n(a?.qtd),
    };
  });

  const menor = pontos.reduce((m, p) => (p.saldo < m.saldo ? p : m), pontos[0]);
  const soma = pontos.reduce(
    (s, p) => ({
      total: s.total + p.entradas_asaas, a_vencer: s.a_vencer + p.asaas_a_vencer,
      confirmado: s.confirmado + p.asaas_confirmado, cobrancas: s.cobrancas + p.asaas_qtd,
    }),
    { total: 0, a_vencer: 0, confirmado: 0, cobrancas: 0 },
  );
  const ultimo = pontos[pontos.length - 1];

  return {
    ...fluxo,
    menor: { valor: menor.saldo, data: menor.data },
    // `saidas` não muda, então o maior desembolso é o da foto.
    saldo_final: { ...fluxo.saldo_final, ...ultimo },
    asaas: {
      ...soma,
      origem: linhas.length ? "espelho" : "vazio",
      atualizado_em: lidoEm ?? fluxo.asaas?.atualizado_em ?? null,
      ao_vivo: true,
    },
    pontos,
  } as F;
}
