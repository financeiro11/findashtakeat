-- Validação do KPI de Estornos do /asaas — rodar no SQL Editor do Supabase.
-- Custo: ZERO requisições ao Asaas (tudo sai do espelho local `asaas_cache`).
--
-- Ordem sugerida: 1 → 2 → 3. A query 2 é a que responde "o KPI está certo agora?".
--
-- ===========================================================================
-- RODADO EM 17/08/2026, contra o projeto lgcxyxyidoirqmbdlldh. Resultado:
--
--   (1) 162 cobranças REFUNDED, 153 com data_pagamento NULA e 9 com a data do
--       PAGAMENTO (todas pagas em julho, estornadas em agosto). Nenhuma cobrança
--       paga em agosto foi estornada — daí o zero do card.
--   (2) agosto/26: 45 estornos, R$ 40.692,12 — dos quais 3 parciais (R$ 7.933,94,
--       ainda PENDING). Julho: 30 / R$ 23.697,12. A série sobe mês a mês desde
--       jul/25 (1 estorno), o que é coerente com o crescimento da base.
--   (3) A RPC devolveu exatamente 45 / 40.692,12 — bate no centavo com a query 2.
--       recebido_estornado = R$ 4.747,20 (2 parciais de cobranças pagas em agosto).
--   (4) Cobertura: só existem parciais com vencimento entre jun e set/26 — é o
--       desenho da janela (±45/31 dias), não a história real. O buraco descrito em
--       puxarEstornos() está ativo para parciais antigos.
--
--   NÃO EXISTE estorno CANCELLED no espelho (167 DONE + 7 PENDING, zero cancelado),
--   então o filtro de CANCELLED não muda nenhum número hoje — ele é uma defesa.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) A premissa do bug: o Asaas limpa o paymentDate ao estornar?
-- ---------------------------------------------------------------------------
-- `com_data_pagto = 0` na linha REFUNDED confirma o diagnóstico e explica por que o
-- KPI antigo (que recortava por paymentDate) só podia mostrar zero.
SELECT status,
       count(*)              AS linhas,
       count(data_pagamento) AS com_data_pagto,
       sum(valor)            AS valor
FROM public.asaas_cache
WHERE tipo = 'payment'
GROUP BY status
ORDER BY linhas DESC;

-- ---------------------------------------------------------------------------
-- 2) A série mensal de estornos pela data do EVENTO — o que o KPI deve mostrar
-- ---------------------------------------------------------------------------
-- Reproduz exatamente as CTEs `estornos_todos` + `estornos` da RPC, inclusive o
-- descarte de CANCELLED. É essa linha do mês corrente que tem de bater com o card.
--
-- ATENÇÃO ao comparar com uma contagem crua de `refunds[]`: uma varredura que NÃO
-- exclua `status = 'CANCELLED'` devolve um número maior. Estorno cancelado é pedido
-- desfeito — dinheiro nenhum saiu — e fica de fora aqui, na mesma regra já usada por
-- estornos_serie() em 20260817120000_estornos.sql.
WITH estornos_todos AS (
  SELECT c.id_asaas,
         c.status                                          AS status_cobranca,
         COALESCE(NULLIF(r->>'status', ''), 'DONE')        AS status_estorno,
         COALESCE((r->>'value')::numeric, 0)               AS valor_estornado,
         CASE WHEN left(r->>'dateCreated', 10) ~ '^\d{4}-\d{2}-\d{2}$'
              THEN left(r->>'dateCreated', 10)::date END   AS data_estorno
  FROM public.asaas_cache c
  CROSS JOIN LATERAL jsonb_array_elements(c.dados->'refunds') r
  WHERE c.tipo = 'payment'
    AND jsonb_typeof(c.dados->'refunds') = 'array'
)
SELECT date_trunc('month', data_estorno)::date              AS mes,
       count(*)                                             AS qtd,
       sum(valor_estornado)                                 AS valor,
       count(*) FILTER (WHERE status_cobranca <> 'REFUNDED') AS qtd_parciais,
       sum(valor_estornado) FILTER (WHERE status_cobranca <> 'REFUNDED') AS valor_parciais,
       sum(valor_estornado) FILTER (WHERE status_estorno = 'PENDING')    AS valor_a_liquidar
FROM estornos_todos
WHERE status_estorno IS DISTINCT FROM 'CANCELLED'
  AND data_estorno IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;

-- ---------------------------------------------------------------------------
-- 3) A RPC ela mesma — o número que a tela vai ler
-- ---------------------------------------------------------------------------
-- `estornos_valor` / `estornos_qtd` daqui têm de ser idênticos à linha do mês na
-- query 2. `recebido_estornado` é o item 5 do pedido: o quanto do recebido bruto do
-- mês já voltou ao cliente por estorno parcial (o Asaas não abate isso do `value`).
SELECT jsonb_pretty(public.asaas_metricas(to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM'))->'recebimentos');

-- ---------------------------------------------------------------------------
-- 4) Cobertura da coleta — o que a varredura por status NÃO alcança
-- ---------------------------------------------------------------------------
-- Estorno parcial não tem status próprio, então só chega ao espelho quando a cobrança
-- é revisitada por vencimento. Esta query mostra a idade das cobranças parcialmente
-- estornadas que já temos: se não houver nada antigo, é sinal de que o buraco descrito
-- em puxarEstornos() (asaas-sync) está ativo, e não de que não existem casos antigos.
SELECT date_trunc('month', c.data_vencimento)::date AS mes_vencimento,
       count(DISTINCT c.id_asaas)                   AS cobrancas_parciais
FROM public.asaas_cache c
CROSS JOIN LATERAL jsonb_array_elements(c.dados->'refunds') r
WHERE c.tipo = 'payment'
  AND jsonb_typeof(c.dados->'refunds') = 'array'
  AND c.status <> 'REFUNDED'
GROUP BY 1
ORDER BY 1 DESC;
