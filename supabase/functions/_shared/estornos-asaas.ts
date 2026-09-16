// Os estornos do Asaas como linhas de `estornos_asaas` — a tabela que alimenta
// /operacional/estornos.
//
// POR QUE MORA AQUI. Até 16/09/2026 isto vivia dentro da `estornos-sync`, que era
// a única a escrever na tabela. Com o `asaas-webhook` são dois escritores: o
// webhook grava o estorno no minuto em que ele acontece, a sync varre como rede.
// Duas cópias do `estornosDaCobranca` divergiriam na primeira mudança de regra
// ("o que é parcial?") e a mesma cobrança sairia com dois formatos — a armadilha
// do `_shared/folha-envio.ts` no CLAUDE.md.

import { isoDate, num } from "./asaas-espelho.ts";

export type Estorno = {
  id: string; id_pagamento: string; indice: number;
  cliente_id: string | null; descricao: string | null; assinatura: string | null;
  forma: string | null; status_cobranca: string | null; status_estorno: string | null;
  parcial: boolean; valor_cobranca: number; valor_estornado: number;
  data_estorno: string | null; data_vencimento: string | null; data_pagamento: string | null;
  competencia: string | null; invoice_url: string | null; comprovante_url: string | null;
  dados: unknown;
};

const competenciaDe = (ymd: string | null) => (ymd ? `${ymd.slice(0, 7)}-01` : null);

/** Explode uma cobrança nos seus estornos. Sem `refunds`, não é estorno — devolve []. */
export function estornosDaCobranca(p: any): Estorno[] {
  const refunds = Array.isArray(p?.refunds) ? p.refunds : [];
  if (!refunds.length) return [];
  const valor = num(p?.value);
  const somaDone = refunds
    .filter((r: any) => String(r?.status).toUpperCase() === "DONE")
    .reduce((s: number, r: any) => s + num(r?.value), 0);
  // "Parcial" é sobre a COBRANÇA, não sobre cada devolução: três estornos de R$ 100
  // numa cobrança de R$ 300 não são parciais. Por isso a soma dos concluídos.
  const parcial = String(p?.status).toUpperCase() !== "REFUNDED" || (somaDone > 0 && somaDone + 0.005 < valor);
  const venc = isoDate(p?.dueDate);

  return refunds.map((r: any, i: number) => ({
    id: `${p.id}#${i}`,
    id_pagamento: String(p?.id ?? ""),
    indice: i,
    cliente_id: p?.customer ? String(p.customer) : null,
    descricao: p?.description ?? null,
    assinatura: p?.subscription ?? null,
    forma: p?.billingType ?? null,
    status_cobranca: p?.status ?? null,
    status_estorno: String(r?.status ?? "").toUpperCase() || null,
    parcial,
    valor_cobranca: valor,
    valor_estornado: num(r?.value),
    data_estorno: isoDate(r?.dateCreated),
    data_vencimento: venc,
    data_pagamento: isoDate(p?.paymentDate) ?? isoDate(p?.confirmedDate),
    competencia: competenciaDe(venc),
    invoice_url: p?.invoiceUrl ?? null,
    comprovante_url: r?.transactionReceiptUrl ?? p?.transactionReceiptUrl ?? null,
    dados: r,
  }));
}

export async function gravarEstornos(supabase: any, estornos: Estorno[], mapaClientes: Map<string, any>) {
  const linhas = estornos.map((e) => {
    const c = e.cliente_id ? mapaClientes.get(e.cliente_id) : null;
    return {
      ...e,
      cliente_nome: c?.name ?? null,
      cliente_documento: c?.cpfCnpj ?? null,
      atualizado_em: new Date().toISOString(),
    };
  });
  const LOTE = 400;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await supabase.from("estornos_asaas")
      .upsert(linhas.slice(i, i + LOTE), { onConflict: "id", ignoreDuplicates: false });
    if (error) throw new Error(`gravar estornos_asaas: ${error.message}`);
  }
  return linhas.length;
}

/**
 * Apaga o estorno que sumiu do Asaas — só entre as cobranças que ACABAMOS de ver
 * NA API.
 *
 * Estorno cancelado no Asaas some do array `refunds`; a linha antiga ficaria viva
 * no espelho somando um dinheiro que voltou. O recorte por cobrança visitada é o
 * que torna isso seguro sob fatiamento: uma rodada que só viu março não pode
 * concluir nada sobre abril, e por não concluir, não apaga.
 *
 * NUNCA a partir do `asaas_cache`. O espelho de uma cobrança paga em julho não é
 * revisitado por varredura nenhuma, e um estorno parcial de agosto sobre ela não
 * chega lá (medido em 16/09/2026: `pay_hh854h2fbx15ukhd`, espelho de 23/08,
 * estorno de 25/08). Apagar pelo espelho apagaria estorno de verdade.
 */
export async function limparOrfaos(supabase: any, visitados: string[], vivos: Set<string>): Promise<number> {
  let removidos = 0;
  for (let i = 0; i < visitados.length; i += 300) {
    const { data } = await supabase.from("estornos_asaas").select("id").in("id_pagamento", visitados.slice(i, i + 300));
    const orfaos = (data ?? []).map((r: any) => r.id).filter((id: string) => !vivos.has(id));
    if (orfaos.length) {
      await supabase.from("estornos_asaas").delete().in("id", orfaos);
      removidos += orfaos.length;
    }
  }
  return removidos;
}

/** Os nomes que já estão no espelho — sem nenhuma ida ao Asaas. */
export async function clientesDoEspelho(supabase: any, ids: string[]): Promise<Map<string, any>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const mapa = new Map<string, any>();
  for (let i = 0; i < unicos.length; i += 300) {
    const { data } = await supabase.from("asaas_cache")
      .select("id_asaas, dados").eq("tipo", "customer").in("id_asaas", unicos.slice(i, i + 300));
    for (const r of (data ?? []) as any[]) mapa.set(r.id_asaas, r.dados);
  }
  return mapa;
}

/**
 * Amarra cada estorno a uma linha da planilha. A conta mora no Postgres
 * (`estornos_conciliar`) e não aqui: são 1.300 estornos × 222 linhas, e o casamento
 * é um join — em SQL isso é uma passada, em JS seriam 288 mil comparações puxadas
 * pela rede. E a regra fica calibrável por migration, sem reimplantar a função.
 */
export async function conciliar(supabase: any) {
  const { data, error } = await supabase.rpc("estornos_conciliar");
  if (error) throw new Error(`conciliar: ${error.message}`);
  return data;
}
