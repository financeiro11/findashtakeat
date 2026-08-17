-- Asaas — o KPI de Estornos passa a ler o array `refunds`, não o status da cobrança.
--
-- O QUE ESTAVA ERRADO: `estornos_valor` somava as cobranças com status = 'REFUNDED'
-- DENTRO da CTE `pagos`, isto é, recortadas por `paymentDate` caindo no mês
-- (20260815120000_asaas_cache.sql:73-77 e :113). Os dois lados desse filtro falham:
--
--   1) O paymentDate NÃO APONTA PARA O ESTORNO. Medido no espelho em 17/08/26: das
--      162 cobranças REFUNDED, 153 estão com data_pagamento NULA (o Asaas limpa o
--      campo ao estornar) e as 9 restantes guardam a data do PAGAMENTO — todas as 9
--      pagas em JULHO e estornadas em AGOSTO. Então o recorte `data_pagamento
--      BETWEEN de AND ate` erra das duas maneiras: ou não acha a linha (153 casos),
--      ou acha e credita o estorno ao mês em que o dinheiro ENTROU (9 casos, que
--      cairiam em julho por devoluções feitas em agosto).
--      Em agosto/26 o efeito líquido é zero: nenhuma cobrança paga em agosto foi
--      estornada — as 45 devoluções do mês são todas de cobranças pagas antes.
--
--   2) ESTORNO PARCIAL NÃO TEM STATUS. A cobrança devolvida pela metade continua
--      RECEIVED/CONFIRMED, o `value` continua cheio, e o valor devolvido só existe
--      dentro de `refunds[]`. Filtrar por status perde todos eles — e, pior, o valor
--      cheio segue somando em `recebido_valor` (tratado abaixo).
--
-- COMO FICA: a unidade de conta passa a ser o ESTORNO, não a cobrança — uma cobrança
-- pode ter vários. É a mesma escolha já feita em 20260817120000_estornos.sql:12-17.
--
-- QUAL É O MÊS DE UM ESTORNO — e por que aqui difere do módulo de churn.
-- Esta RPC alimenta o /asaas, que é um painel de CAIXA: cada número dele responde
-- "o que se moveu neste mês" (recebido = paymentDate, a receber = dueDate, NF-e =
-- effectiveDate). Para essa leitura o mês do estorno é o dia em que o dinheiro
-- voltou: `refunds[].dateCreated`.
-- Já 20260817120000_estornos.sql:19-23 usa a COMPETÊNCIA (mês do vencimento da
-- cobrança), porque lá a pergunta é de churn e o painel casa com a aba ESTORNOS da
-- planilha. As duas convivem de propósito, mas NÃO são o mesmo número: um estorno
-- feito em abril de uma cobrança que vence em julho aparece em abril aqui e em julho
-- lá. Se algum dia forem exibidas lado a lado, rotule qual é qual.

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
-- Todo estorno do espelho, achatado: UMA LINHA POR ELEMENTO de `refunds[]`.
-- Sem recorte de mês aqui de propósito — o recorte é feito adiante pela data do
-- próprio estorno, e a cobrança de origem pode ser de qualquer mês passado.
-- A data é lida com os 10 primeiros caracteres, e não com um cast direto, porque o
-- Asaas manda ora "2026-08-14", ora "2026-08-14 10:22:33" — mesma convenção do
-- isoDate() da asaas-sync. O regex evita que uma linha malformada derrube a RPC.
estornos_todos AS (
  SELECT
    c.id_asaas,
    c.status                                                AS status_cobranca,
    -- Estorno sem status vira DONE: ele só é excluído da conta quando o Asaas diz
    -- explicitamente CANCELLED, e "não sei" não é motivo para sumir com dinheiro.
    COALESCE(NULLIF(r->>'status', ''), 'DONE')              AS status_estorno,
    COALESCE((r->>'value')::numeric, 0)                     AS valor_estornado,
    CASE WHEN left(r->>'dateCreated', 10) ~ '^\d{4}-\d{2}-\d{2}$'
         THEN left(r->>'dateCreated', 10)::date END         AS data_estorno
  FROM public.asaas_cache c
  CROSS JOIN LATERAL jsonb_array_elements(c.dados->'refunds') r
  WHERE c.tipo = 'payment'
    AND jsonb_typeof(c.dados->'refunds') = 'array'
),
-- CANCELLED fica de fora: é o estorno que foi pedido e desfeito, dinheiro nenhum
-- saiu. Mesma regra de estornos_serie() em 20260817120000_estornos.sql:151.
-- PENDING entra no total (a saída está contratada) mas também vai separado, para a
-- tela poder dizer quanto ainda não liquidou.
estornos AS (
  SELECT
    COALESCE(SUM(valor_estornado), 0)                                              AS estornos_valor,
    COUNT(*)                                                                       AS estornos_qtd,
    COUNT(DISTINCT id_asaas)                                                       AS estornos_cobrancas,
    COALESCE(SUM(valor_estornado) FILTER (WHERE status_cobranca <> 'REFUNDED'), 0) AS estornos_parcial_valor,
    COUNT(*)         FILTER (WHERE status_cobranca <> 'REFUNDED')                  AS estornos_parcial_qtd,
    COALESCE(SUM(valor_estornado) FILTER (WHERE status_estorno = 'PENDING'), 0)    AS estornos_pendente_valor
  FROM estornos_todos e, periodo p
  WHERE e.status_estorno IS DISTINCT FROM 'CANCELLED'
    AND e.data_estorno BETWEEN p.de AND p.ate
),
-- Quanto do que foi recebido NESTE mês já voltou para o cliente (em qualquer data).
-- Na prática são só os PARCIAIS, e quem garante isso é o `g.status IN (...)` abaixo:
-- a cobrança totalmente estornada já virou REFUNDED e não passa no filtro (não basta
-- confiar no paymentDate limpo — 9 REFUNDED ainda têm o campo preenchido). É esta a
-- linha que impedia `recebido_valor` de mentir para mais.
--
-- EFEITO COLATERAL QUE VEM DE ANTES e não foi mexido aqui: quando um pagamento de
-- julho é totalmente estornado em agosto, o status vira REFUNDED e a cobrança sai do
-- `recebido_valor` DE JULHO — o mês passado encolhe sozinho (hoje, R$ 4.576,30 em 9
-- cobranças). Discutível para um painel de caixa (o dinheiro entrou mesmo em julho e
-- só saiu em agosto), mas é o comportamento que a tela sempre teve; mudar isso é
-- decisão à parte.
receb_estornado AS (
  SELECT COALESCE(SUM(e.valor_estornado), 0) AS recebido_estornado
  FROM estornos_todos e
  JOIN pagos g ON g.id_asaas = e.id_asaas
  WHERE e.status_estorno IS DISTINCT FROM 'CANCELLED'
    AND g.status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')
),
-- EM DISPUTA — retrato do AGORA, sem recorte de mês (igual a "assinaturas ativas").
--
-- Estes status são o limbo: o dinheiro entrou, está sendo contestado e ainda não
-- voltou. Não cabem em `recebido` (que exige RECEIVED/CONFIRMED/RECEIVED_IN_CASH)
-- nem em `estornos` (ainda não há elemento em refunds[]), então a cobrança sumia
-- das duas contas enquanto durasse o estado. Agora ela tem onde aparecer.
-- Sem mês porque não existe data confiável para o início da disputa: paymentDate
-- pode já ter sido limpo, e dueDate é de outra pergunta.
disputa AS (
  SELECT
    COUNT(*)                AS disputa_qtd,
    COALESCE(SUM(valor), 0) AS disputa_valor
  FROM public.asaas_cache
  WHERE tipo = 'payment'
    AND status IN ('REFUND_REQUESTED','REFUND_IN_PROGRESS',
                   'CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL')
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
    COUNT(*) FILTER (WHERE status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')) AS recebido_qtd
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
    -- Quanto do recebido do mês já foi devolvido (estorno parcial). O bruto continua
    -- sendo o número de capa — é o que entrou no banco —, mas agora acompanhado.
    'recebido_estornado', receb_estornado.recebido_estornado,
    'recebido_apos_estorno', receb.recebido_valor - receb_estornado.recebido_estornado,
    'estornos_valor',   estornos.estornos_valor,
    'estornos_qtd',     estornos.estornos_qtd,
    'estornos_cobrancas',      estornos.estornos_cobrancas,
    'estornos_parcial_valor',  estornos.estornos_parcial_valor,
    'estornos_parcial_qtd',    estornos.estornos_parcial_qtd,
    'estornos_pendente_valor', estornos.estornos_pendente_valor,
    'disputa_valor',    disputa.disputa_valor,
    'disputa_qtd',      disputa.disputa_qtd,
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
FROM receb, conv, assin, nf, estornos, receb_estornado, disputa;
$$;

-- A assinatura não muda, então o CREATE OR REPLACE substitui a função no lugar e não
-- deixa uma sobrecarga velha viva ao lado. Os GRANTs de 20260815120000 sobrevivem ao
-- REPLACE, mas repetimos por garantia: função em `public` nasce chamável por anon, e
-- esta lê faturamento.
REVOKE ALL ON FUNCTION public.asaas_metricas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_metricas(text) TO authenticated, service_role;

-- Índice para a varredura de refunds: sem ele o unnest varre a tabela inteira de
-- payments a cada recálculo. O predicado parcial mantém o índice pequeno — são
-- poucas centenas de cobranças com estorno em ~dezenas de milhares de linhas.
-- O predicado é `jsonb_typeof(...) = 'array'` e não `jsonb_array_length(...) > 0`:
-- o segundo ESTOURA ("cannot get array length of a non-array") se alguma linha vier
-- com `refunds` que não seja array, e um predicado de índice que levanta erro derruba
-- o CREATE INDEX. Além disso é exatamente o predicado usado na CTE, o que deixa o
-- planner casar os dois sem precisar provar nada.
CREATE INDEX IF NOT EXISTS asaas_cache_refunds_idx
  ON public.asaas_cache (tipo)
  WHERE jsonb_typeof(dados->'refunds') = 'array';