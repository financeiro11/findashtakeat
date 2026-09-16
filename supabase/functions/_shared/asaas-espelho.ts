// O formato das linhas de `asaas_cache` — o espelho local do Asaas.
//
// POR QUE MORA AQUI. Até 15/09/2026 estes mapeadores viviam dentro da
// `asaas-sync`, e só ela escrevia no espelho (fora a carga histórica, que tem a
// sua cópia). Com o `asaas-webhook` passam a ser DOIS escritores permanentes na
// mesma tabela, e dois formatos na mesma tabela quebram quem lê: a
// `notas_fiscais_painel` e a `asaas_metricas` confiam em `status`, `valor`, as
// datas e nas colunas GERADAS a partir de `dados` (`cliente_ref`, `estornos`,
// `pagamento_ref`, `documento`, `nome`...). Uma cópia colada no webhook
// divergiria na primeira vez que alguém mexesse numa das duas — a mesma
// armadilha do `_shared/folha-envio.ts` no CLAUDE.md.
//
// O conteúdo é o que estava na `asaas-sync`, sem mudança de formato. A única
// diferença é que o erro do `gravar` agora carrega o `codigo` do Postgres — a
// mensagem é a mesma, e quem só lê `message` (a asaas-sync) não percebe nada.
// Quem usa o código é o webhook, para decidir se vale pedir ao Asaas que repita.
//
// A `asaas-carga-historica` e o `resolverClientes` da `estornos-sync` ainda têm
// cópias próprias dos mapeadores (idênticas em conteúdo hoje). Ao mexer no
// formato, mexa lá também — ou traga as duas para cá.

export type Linha = Record<string, unknown>;

export const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return isNaN(n) ? 0 : n; };

export function isoDate(s?: string | null): string | null {
  if (!s) return null;
  const d = String(s).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function mapPayment(p: any): Linha {
  return {
    tipo: "payment",
    id_asaas: String(p?.id ?? ""),
    /* COBRANÇA APAGADA VIRA 'DELETED', como o cliente apagado (15/09/2026). As
     * listas do `/payments` não devolvem apagada, então a varredura nunca a via;
     * quem a vê é quem lê POR ID — o webhook e a ação `cobranca`. Se só o webhook
     * marcasse, a próxima leitura por id desmarcaria a linha com o status que a
     * cobrança tinha antes de ser apagada. O `dados` guarda o resto. */
    status: p?.deleted ? "DELETED" : String(p?.status ?? ""),
    valor: num(p?.value),
    valor_liquido: p?.netValue == null ? null : num(p.netValue),
    ciclo: null,
    // paymentDate é o mesmo campo em que a API filtra; usar um fallback aqui faria a
    // linha cair num mês diferente do que a busca disse que ela é.
    data_pagamento: isoDate(p?.paymentDate),
    data_vencimento: isoDate(p?.dueDate),
    data_efetiva: null,
    data_criacao: isoDate(p?.dateCreated),
    // Forma e data de crédito alimentam o fluxo projetado do /caixa: lá o que importa
    // não é quando a cobrança vence, e sim quando o dinheiro fica disponível. Quando o
    // Asaas não diz (cobrança ainda não paga), o prazo sai da forma — ver a função
    // asaas_prazo_credito na migration.
    forma: p?.billingType ?? null,
    data_credito: isoDate(p?.creditDate) ?? isoDate(p?.estimatedCreditDate),
    dados: p,
  };
}
export function mapSubscription(s: any): Linha {
  return {
    tipo: "subscription",
    id_asaas: String(s?.id ?? ""),
    status: String(s?.status ?? ""),
    valor: num(s?.value),
    valor_liquido: null,
    ciclo: s?.cycle ?? null,
    data_pagamento: null,
    data_vencimento: isoDate(s?.nextDueDate),
    data_efetiva: null,
    data_criacao: isoDate(s?.dateCreated),
    dados: s,
  };
}
/** Mesmo formato da `asaas-carga-historica` — dois formatos na mesma tabela
 *  quebrariam a `notas_fiscais_painel`, que lê `nome` e `documento` (colunas
 *  geradas a partir de `dados`). */
export function mapCustomer(c: any): Linha {
  return {
    tipo: "customer",
    id_asaas: String(c?.id ?? ""),
    // `deleted` importa: cliente apagado no Asaas some da lista `/customers` e só
    // volta pelo id. É por isso que alguns órfãos eram de 2022 — a carga completa
    // de agosto não tinha como alcançá-los, e a busca por id tem.
    status: c?.deleted ? "DELETED" : "ACTIVE",
    valor: null,
    valor_liquido: null,
    ciclo: null,
    data_pagamento: null,
    data_vencimento: null,
    data_efetiva: null,
    data_criacao: isoDate(c?.dateCreated),
    dados: c,
  };
}
export function mapInvoice(i: any): Linha {
  return {
    tipo: "invoice",
    id_asaas: String(i?.id ?? ""),
    status: String(i?.status ?? ""),
    valor: num(i?.value),
    valor_liquido: null,
    ciclo: null,
    data_pagamento: null,
    data_vencimento: null,
    data_efetiva: isoDate(i?.effectiveDate),
    data_criacao: isoDate(i?.dateCreated),
    dados: i,
  };
}

/**
 * Grava no espelho em blocos — um upsert de 3.000 linhas estoura o payload.
 *
 * O `Map` não é economia, é obrigatório: as buscas que alimentam isto se SOBREPÕEM
 * (uma cobrança que vence em julho e foi paga em julho volta nas duas), e o Postgres
 * recusa o lote inteiro com "ON CONFLICT DO UPDATE command cannot affect row a second
 * time" quando a mesma chave aparece duas vezes no MESMO upsert. Na carga completa o
 * erro ficava escondido só porque as duas cópias caíam em lotes diferentes.
 * Vence a última ocorrência, que é a leitura mais recente da API.
 *
 * O erro sai com `codigo` (SQLSTATE do Postgres, ou PGRSTxxx do PostgREST; vazio
 * quando a falha foi de rede). Ver `valeRepetir` no asaas-webhook.
 */
export async function gravar(supabase: any, linhas: Linha[]): Promise<number> {
  const unicas = new Map<string, Linha>();
  for (const l of linhas) {
    if (l.id_asaas) unicas.set(`${l.tipo}:${l.id_asaas}`, l);
  }
  const validas = [...unicas.values()];
  const LOTE = 500;
  for (let i = 0; i < validas.length; i += LOTE) {
    const { error } = await supabase
      .from("asaas_cache")
      .upsert(validas.slice(i, i + LOTE).map((l) => ({ ...l, atualizado_em: new Date().toISOString() })),
              { onConflict: "tipo,id_asaas" });
    if (error) {
      throw Object.assign(new Error(`asaas_cache upsert: ${error.message}`), { codigo: String(error.code ?? "") });
    }
  }
  return validas.length;
}
