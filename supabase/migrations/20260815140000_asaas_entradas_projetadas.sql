-- Asaas no fluxo de caixa projetado do /caixa.
--
-- POR QUÊ: o gráfico "Fluxo de caixa projetado · próximos 30 dias" só somava título
-- em aberto do Omie, e por lá quase não passa receita — o card mostrava "Entradas
-- 30d +R$ 199" contra "Saídas 30d -R$ 362,2 k". A receita da empresa entra pelo
-- Asaas, então o menor saldo projetado (-R$ 326 k) era um susto sem lastro.
--
-- O QUE ENTRA: as cobranças que ainda não caíram no saldo, em dois baldes —
--   • a vencer   (PENDING / AWAITING_RISK_ANALYSIS, vencimento daqui pra frente)
--   • confirmado (CONFIRMED: o cliente pagou, o Asaas ainda não creditou)
-- RECEIVED fica DE FORA: já está no saldo disponível que a omie-caixa-sync lê da
-- API do Asaas, e somar de novo contaria o mesmo dinheiro duas vezes. Vencidas
-- (OVERDUE) também ficam de fora — o recorte é "a vencer", não inadimplência.
--
-- QUANDO ENTRA: no dia do CRÉDITO, não no do vencimento — o gráfico mede saldo
-- disponível. Vale, nesta ordem: a data que o próprio Asaas informa (creditDate /
-- estimatedCreditDate) e, na falta dela, vencimento + o prazo da forma de cobrança.

-- ---------------------------------------------------------------------------
-- 1) Duas colunas novas no espelho
-- ---------------------------------------------------------------------------
ALTER TABLE public.asaas_cache ADD COLUMN IF NOT EXISTS forma        text; -- billingType: PIX, BOLETO, CREDIT_CARD…
ALTER TABLE public.asaas_cache ADD COLUMN IF NOT EXISTS data_credito date; -- creditDate ?? estimatedCreditDate

-- ---------------------------------------------------------------------------
-- 2) Prazo de crédito por forma de cobrança
-- ---------------------------------------------------------------------------
-- Só é usado quando o Asaas não informou a data de crédito — o que é o caso normal
-- de uma cobrança ainda não paga. Números da liquidação do Asaas: Pix e boleto no
-- dia seguinte; cartão de crédito à vista em ~30 dias.
CREATE OR REPLACE FUNCTION public.asaas_prazo_credito(p_forma text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE upper(COALESCE(p_forma, 'UNDEFINED'))
    WHEN 'CREDIT_CARD' THEN 30
    WHEN 'DEBIT_CARD'  THEN 2
    ELSE 1                      -- PIX, BOLETO, TRANSFER, DEPOSIT, UNDEFINED
  END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Entradas projetadas, somadas POR DIA de crédito
-- ---------------------------------------------------------------------------
-- Agregar no banco (e não no cliente) não é gosto: são ~2.900 cobranças por mês e o
-- PostgREST corta a resposta em 1.000 linhas caladamente — a soma sairia menor sem
-- ninguém notar. Aqui volta uma linha por dia.
CREATE OR REPLACE FUNCTION public.asaas_entradas_projetadas(p_de date, p_ate date)
RETURNS TABLE (
  data       date,
  valor      numeric,   -- líquido (netValue): é o que de fato cai na conta
  qtd        bigint,
  a_vencer   numeric,
  confirmado numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH base AS (
  SELECT
    COALESCE(
      data_credito,
      data_vencimento + public.asaas_prazo_credito(forma)
    )                                   AS dia,
    COALESCE(valor_liquido, valor)      AS liquido,
    status
  FROM public.asaas_cache
  WHERE tipo = 'payment'
    AND (
      -- a vencer: ainda não pagas, com vencimento daqui pra frente
      (status IN ('PENDING', 'AWAITING_RISK_ANALYSIS') AND data_vencimento >= CURRENT_DATE)
      -- confirmadas: pagas, aguardando o crédito cair no saldo
      OR status = 'CONFIRMED'
    )
)
SELECT
  dia AS data,
  COALESCE(SUM(liquido), 0)                                          AS valor,
  COUNT(*)                                                            AS qtd,
  COALESCE(SUM(liquido) FILTER (WHERE status <> 'CONFIRMED'), 0)      AS a_vencer,
  COALESCE(SUM(liquido) FILTER (WHERE status =  'CONFIRMED'), 0)      AS confirmado
FROM base
WHERE dia BETWEEN p_de AND p_ate
GROUP BY dia
ORDER BY dia;
$$;

-- O índice que este recorte pede: varrer em aberto por vencimento.
CREATE INDEX IF NOT EXISTS asaas_cache_aberto_idx
  ON public.asaas_cache (tipo, status, data_vencimento)
  WHERE tipo = 'payment';

-- ---------------------------------------------------------------------------
-- 4) Permissões
-- ---------------------------------------------------------------------------
-- Função nova em `public` nasce chamável por anon (grant automático do Supabase).
-- Esta lê faturamento a receber, então só usuário logado e a Edge Function.
REVOKE ALL ON FUNCTION public.asaas_entradas_projetadas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_entradas_projetadas(date, date) TO authenticated, service_role;