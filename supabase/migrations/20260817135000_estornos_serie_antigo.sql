-- A série passa a dizer quanto do churn do mês veio de dinheiro que já tinha voltado.
--
-- DE ONDE ISSO APARECEU: conferência contra a rodada manual da skill de julho/26. O
-- painel mostrava R$ 30.917 de churn real e a skill tinha dado ~23k. A maior parte da
-- diferença era esperada — R$ 5.938 em 15 estornos feitos em agosto sobre cobranças
-- que vencem em julho, que a rodada de fechamento não podia conhecer. Mas a conferência
-- descobriu outra coisa, essa invisível:
--
--   PARCELAMENTO NO CARTÃO É CAPTURADO À VISTA PELO ASAAS. Um plano 12× comprado em
--   setembro/2025 vira 12 cobranças com paymentDate de setembro/2025 e vencimentos até
--   agosto/2026. Quando o cliente cancela e é estornado — dias depois, ainda em 2025 —
--   todas as parcelas restantes voltam de uma vez, cada uma guardando o vencimento dela
--   lá na frente.
--
-- Com competência = vencimento (a regra da casa, e ela está certa: é onde a receita da
-- parcela é reconhecida), o churn de julho/2026 carrega clientes que saíram em 2025.
-- Medido: R$ 8.394 de R$ 30.917 em julho — 27% do mês, sendo R$ 5.880 de um único
-- cliente pago e estornado em julho/2025 com vencimento em julho/2026.
--
-- Nada disso muda a conta. O que muda é que dá para ver: a tela mostra o tamanho da
-- fatia na barra de status e um filtro abre quais são.
--
-- 180 dias é o corte. O caso que motivou a regra de competência (estorno em abril de
-- uma parcela que vence em julho) tem ~90 dias e continua fora do aviso, como deve.
-- O mesmo número está em Estornos.tsx (DIAS_ESTORNO_ANTIGO) — mudou aqui, mude lá.
--
-- `drop` antes do `create`: mexer no RETURNS TABLE de uma função existente não passa em
-- `create or replace`.

DROP FUNCTION IF EXISTS public.estornos_serie(boolean);

CREATE FUNCTION public.estornos_serie(p_pendentes boolean DEFAULT false)
RETURNS TABLE (
  competencia          date,
  qtd                  integer,
  qtd_parciais         integer,
  estornado            numeric,
  indevida             numeric,
  qtd_indevida         integer,
  churn_real           numeric,
  nao_classificado     numeric,
  qtd_nao_classificado integer,
  pendente             numeric,
  qtd_pendente         integer,
  antigo               numeric,
  qtd_antigo           integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    e.competencia,
    count(*) FILTER (WHERE e.status_estorno = 'DONE' OR p_pendentes)::int                     AS qtd,
    count(*) FILTER (WHERE e.parcial AND (e.status_estorno = 'DONE' OR p_pendentes))::int     AS qtd_parciais,
    coalesce(sum(e.valor_estornado) FILTER (WHERE e.status_estorno = 'DONE' OR p_pendentes), 0)                          AS estornado,
    coalesce(sum(e.valor_estornado) FILTER (WHERE e.cobranca_indevida AND (e.status_estorno = 'DONE' OR p_pendentes)), 0) AS indevida,
    count(*) FILTER (WHERE e.cobranca_indevida AND (e.status_estorno = 'DONE' OR p_pendentes))::int                       AS qtd_indevida,
    coalesce(sum(e.valor_estornado) FILTER (WHERE NOT e.cobranca_indevida AND (e.status_estorno = 'DONE' OR p_pendentes)), 0) AS churn_real,
    coalesce(sum(e.valor_estornado) FILTER (WHERE e.linha_planilha IS NULL AND (e.status_estorno = 'DONE' OR p_pendentes)), 0) AS nao_classificado,
    count(*) FILTER (WHERE e.linha_planilha IS NULL AND (e.status_estorno = 'DONE' OR p_pendentes))::int                  AS qtd_nao_classificado,
    coalesce(sum(e.valor_estornado) FILTER (WHERE e.status_estorno = 'PENDING'), 0)           AS pendente,
    count(*) FILTER (WHERE e.status_estorno = 'PENDING')::int                                 AS qtd_pendente,
    -- a fatia do CHURN REAL (já sem o que foi descartado) que veio de estorno antigo
    coalesce(sum(e.valor_estornado) FILTER (
      WHERE NOT e.cobranca_indevida AND (e.status_estorno = 'DONE' OR p_pendentes)
        AND e.data_vencimento IS NOT NULL AND e.data_estorno IS NOT NULL
        AND e.data_vencimento - e.data_estorno >= 180), 0)                                    AS antigo,
    count(*) FILTER (
      WHERE NOT e.cobranca_indevida AND (e.status_estorno = 'DONE' OR p_pendentes)
        AND e.data_vencimento IS NOT NULL AND e.data_estorno IS NOT NULL
        AND e.data_vencimento - e.data_estorno >= 180)::int                                   AS qtd_antigo
  FROM public.estornos_asaas e
  WHERE e.competencia IS NOT NULL
    AND e.status_estorno <> 'CANCELLED'
  GROUP BY e.competencia
  ORDER BY e.competencia;
$$;

REVOKE ALL ON FUNCTION public.estornos_serie(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.estornos_serie(boolean) TO authenticated, service_role;
