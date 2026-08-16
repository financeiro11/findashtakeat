-- Asaas — espelho local dos registros crus + agregação em SQL.
--
-- POR QUÊ: a asaas-sync recalculava a página /asaas baixando TUDO da API a cada
-- clique — ~115 requisições por sync (26 páginas de payments por pagamento, 29 por
-- vencimento, 32 de subscriptions, 28 de invoices). Boa parte disso só existia para
-- fazer `.length` num array, sendo que a API devolve `totalCount` na 1ª página.
-- A conta tem cota de 25.000 req/12h e limites por endpoint, então cliques repetidos
-- estouravam o 429.
--
-- COMO: mesmo desenho do omie_cache e do asaas_extrato — as linhas cruas ficam aqui,
-- o cálculo lê do Postgres e a API só é consultada quando se pede explicitamente
-- (e mesmo aí, incrementalmente). Recalcular um mês passa a custar 0 requisições.
--
-- A agregação é uma RPC (e não um SELECT no cliente) de propósito: são ~3.100
-- assinaturas e o PostgREST corta a resposta em 1.000 linhas caladamente — somar no
-- banco elimina esse risco e devolve tudo numa viagem só.

-- ---------------------------------------------------------------------------
-- 1) Espelho dos registros crus
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asaas_cache (
  tipo            text NOT NULL,        -- 'payment' | 'subscription' | 'invoice'
  id_asaas        text NOT NULL,
  status          text,
  valor           numeric,
  valor_liquido   numeric,              -- payments: netValue
  ciclo           text,                 -- subscriptions: cycle (MONTHLY, YEARLY, …)
  data_pagamento  date,                 -- payments: paymentDate
  data_vencimento date,                 -- payments: dueDate
  data_efetiva    date,                 -- invoices: effectiveDate
  data_criacao    date,                 -- dateCreated — é a marca d'água do incremental
  dados           jsonb NOT NULL,       -- registro cru, para não precisar re-puxar ao mudar um KPI
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tipo, id_asaas)
);

-- Os índices espelham exatamente os recortes que a RPC faz.
CREATE INDEX IF NOT EXISTS asaas_cache_pagamento_idx  ON public.asaas_cache (tipo, data_pagamento)  WHERE data_pagamento  IS NOT NULL;
CREATE INDEX IF NOT EXISTS asaas_cache_vencimento_idx ON public.asaas_cache (tipo, data_vencimento) WHERE data_vencimento IS NOT NULL;
CREATE INDEX IF NOT EXISTS asaas_cache_efetiva_idx    ON public.asaas_cache (tipo, data_efetiva)    WHERE data_efetiva    IS NOT NULL;
CREATE INDEX IF NOT EXISTS asaas_cache_status_idx     ON public.asaas_cache (tipo, status);
CREATE INDEX IF NOT EXISTS asaas_cache_criacao_idx    ON public.asaas_cache (tipo, data_criacao DESC);

-- ---------------------------------------------------------------------------
-- 2) Estado do sync — quando cada escopo foi puxado por inteiro pela última vez
-- ---------------------------------------------------------------------------
-- Assinaturas são um retrato do AGORA (não do mês): uma cancelada some do filtro
-- ACTIVE e, num incremental, ficaria viva no espelho inflando o MRR para sempre.
-- Por isso a carga completa delas tem TTL — ver asaas-sync.
CREATE TABLE IF NOT EXISTS public.asaas_sync_estado (
  escopo            text PRIMARY KEY,   -- 'subscription' | 'payment:YYYY-MM' | 'invoice:YYYY-MM'
  ultima_completa   timestamptz,
  ultima_incremental timestamptz,
  detalhe           jsonb
);

-- ---------------------------------------------------------------------------
-- 3) Agregação — a mesma conta que a Edge Function fazia em JS, agora em SQL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asaas_metricas(p_referencia text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH periodo AS (
  SELECT
    (p_referencia || '-01')::date                          AS de,
    ((p_referencia || '-01')::date + INTERVAL '1 month - 1 day')::date AS ate
),
-- Recebimentos: quem foi PAGO dentro do mês.
pagos AS (
  SELECT c.* FROM public.asaas_cache c, periodo p
  WHERE c.tipo = 'payment'
    AND c.data_pagamento BETWEEN p.de AND p.ate
),
-- Conversão / a-receber: quem VENCE dentro do mês (qualquer status).
vencem AS (
  SELECT c.* FROM public.asaas_cache c, periodo p
  WHERE c.tipo = 'payment'
    AND c.data_vencimento BETWEEN p.de AND p.ate
),
notas AS (
  SELECT c.* FROM public.asaas_cache c, periodo p
  WHERE c.tipo = 'invoice'
    AND c.data_efetiva BETWEEN p.de AND p.ate
),
-- MRR: valor de cada assinatura trazido para base mensal.
assin AS (
  SELECT
    COUNT(*) AS ativas,
    COALESCE(SUM(
      CASE upper(COALESCE(ciclo, 'MONTHLY'))
        WHEN 'WEEKLY'       THEN valor * 52 / 12.0
        WHEN 'BIWEEKLY'     THEN valor * 26 / 12.0
        WHEN 'MONTHLY'      THEN valor
        WHEN 'BIMONTHLY'    THEN valor / 2.0
        WHEN 'QUARTERLY'    THEN valor / 3.0
        WHEN 'SEMIANNUALLY' THEN valor / 6.0
        WHEN 'YEARLY'       THEN valor / 12.0
        ELSE valor
      END
    ), 0) AS mrr
  FROM public.asaas_cache
  WHERE tipo = 'subscription' AND status = 'ACTIVE'
),
receb AS (
  SELECT
    COALESCE(SUM(valor) FILTER (WHERE status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')), 0) AS recebido_valor,
    COALESCE(SUM(COALESCE(valor_liquido, valor)) FILTER (WHERE status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')), 0) AS recebido_liquido,
    COUNT(*) FILTER (WHERE status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')) AS recebido_qtd,
    COALESCE(SUM(valor) FILTER (WHERE status = 'REFUNDED'), 0) AS estornos_valor,
    COUNT(*) FILTER (WHERE status = 'REFUNDED') AS estornos_qtd
  FROM pagos
),
conv AS (
  SELECT
    COUNT(*) AS venc_total,
    COUNT(*) FILTER (WHERE status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')) AS venc_pagos,
    COALESCE(SUM(valor) FILTER (WHERE status IN ('PENDING','OVERDUE','AWAITING_RISK_ANALYSIS')), 0) AS a_receber_valor,
    -- Ciclo médio, na MESMA cascata do código antigo em JS:
    --   paymentDate → confirmedDate → clientPaymentDate.
    -- Vale um aviso, porque o número que sai daqui é estranho de propósito: ~949 dos
    -- ~2.500 pagos de um mês são CONFIRMED (cartão autorizado, ainda não liquidado) e
    -- NÃO têm paymentDate. Neles o confirmedDate cai ~95 dias ANTES do vencimento, o
    -- que joga a média para -31d — ou seja, o indicador mistura "data de autorização"
    -- com "data de recebimento". Só com paymentDate a média seria +7,5d.
    -- Está reproduzido assim para a troca de motor (JS → SQL) não mexer no número
    -- exibido; corrigir a DEFINIÇÃO é uma decisão à parte.
    AVG(
      COALESCE(data_pagamento, (dados->>'confirmedDate')::date, (dados->>'clientPaymentDate')::date)
      - data_vencimento
    ) FILTER (
      WHERE status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')
        AND COALESCE(data_pagamento, (dados->>'confirmedDate')::date, (dados->>'clientPaymentDate')::date) IS NOT NULL
        AND data_vencimento IS NOT NULL
    ) AS dias_ate_recebimento
  FROM vencem
),
nf AS (
  SELECT
    COUNT(*) FILTER (WHERE upper(status) = 'AUTHORIZED') AS emitidas,
    COUNT(*) FILTER (WHERE upper(status) = 'ERROR')      AS erro,
    COUNT(*) FILTER (WHERE upper(status) IN ('SCHEDULED','SYNCHRONIZED','PROCESSING','PENDING')) AS pendentes,
    COALESCE(SUM(valor) FILTER (WHERE upper(status) = 'AUTHORIZED'), 0) AS valor_emitido,
    COALESCE(SUM(valor) FILTER (WHERE upper(status) = 'ERROR'), 0)      AS valor_erro
  FROM notas
)
SELECT jsonb_build_object(
  'recebimentos', jsonb_build_object(
    'recebido_valor',   receb.recebido_valor,
    'recebido_liquido', receb.recebido_liquido,
    'recebido_qtd',     receb.recebido_qtd,
    'estornos_valor',   receb.estornos_valor,
    'estornos_qtd',     receb.estornos_qtd,
    'a_receber_valor',  conv.a_receber_valor,
    'venc_total',       conv.venc_total,
    'venc_pagos',       conv.venc_pagos,
    'conversao',        CASE WHEN conv.venc_total > 0 THEN conv.venc_pagos::numeric / conv.venc_total ELSE 0 END,
    'dias_ate_recebimento', conv.dias_ate_recebimento
  ),
  'assinaturas', jsonb_build_object(
    'ativas', assin.ativas,
    'mrr',    assin.mrr,
    'arr',    assin.mrr * 12,
    'arpu',   CASE WHEN assin.ativas > 0 THEN assin.mrr / assin.ativas ELSE 0 END,
    'receita_projetada', assin.mrr
  ),
  'nfe', jsonb_build_object(
    'emitidas',  nf.emitidas,
    'erro',      nf.erro,
    'pendentes', nf.pendentes,
    'taxa_sucesso', CASE WHEN (nf.emitidas + nf.erro) > 0
                         THEN nf.emitidas::numeric / (nf.emitidas + nf.erro) ELSE NULL END,
    'valor_emitido', nf.valor_emitido,
    'valor_erro',    nf.valor_erro
  )
)
FROM receb, conv, assin, nf;
$$;

-- ---------------------------------------------------------------------------
-- 4) Permissões — o espelho é escrito só pela Edge Function (service_role)
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.asaas_cache       TO authenticated;
GRANT ALL    ON public.asaas_cache       TO service_role;
GRANT SELECT ON public.asaas_sync_estado TO authenticated;
GRANT ALL    ON public.asaas_sync_estado TO service_role;

ALTER TABLE public.asaas_cache       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_sync_estado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_asaas_cache" ON public.asaas_cache;
CREATE POLICY "auth_read_asaas_cache" ON public.asaas_cache FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read_asaas_sync_estado" ON public.asaas_sync_estado;
CREATE POLICY "auth_read_asaas_sync_estado" ON public.asaas_sync_estado FOR SELECT TO authenticated USING (true);

-- Função nova em `public` nasce chamável por anon (grant automático do Supabase).
-- Esta lê faturamento, então só usuário logado.
REVOKE ALL ON FUNCTION public.asaas_metricas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_metricas(text) TO authenticated, service_role;